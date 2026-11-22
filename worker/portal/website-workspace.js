/**
 * The Website dashboard, client side (migration 0030 for the updates and tasks; see WEBSITES.md): one page of modular cards, in this order on a wide screen.
 *   1. Live website and Preview changes: two cards, each with the picture of that site (the screenshot Framework uploaded, else a neutral panel: never a stock or invented image),
 *      a plain status, the address as small secondary text, and a direct link. "Production" and "Staging" are not shown as titles.
 *   2. Needs your attention: updates waiting for the client's decision (approve, or reject with revision notes) and the tasks Framework needs done. Compact rows that open in place.
 *   3. Recent updates: what changed and how each was decided, the answered and finished tasks.
 *   4. Website traffic: a compact preview of the genuine Cloudflare Web Analytics figures, linking to the existing Analytics page. Not connected or unreadable says so; nothing is invented.
 *   5. Request a change: a closed expander holding the form for an ordinary website change request (the existing support workflow: thread, attachments, Admin queue).
 * Pure string building from what the router already scoped to the member's own organization; every dynamic value is escaped. No inline style and no inline script: every disclosure is a native
 * <details>, so it works without script under the strict portal CSP. Nothing is open by default. Styling: assets/css/portal-website-workspace.css.
 */
import { e, dayKey } from "./ui.js";
import { UPDATE_STATUS_LABEL, TASK_STATUS_LABEL } from "./repo/website-workspace.js";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY } from "./repo/support.js";

const isWebUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/.test(u);
const shortUrl = (u) => String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
const hostOf = (u) => shortUrl(u).replace(/\/.*$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plainDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
/** "Nov 21" (the year only when it is not this year) from a stored time or a YYYY-MM-DD. */
const shortDay = (v, nowKey) => { const k = /^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : dayKey(v); const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(k || ""); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}${nowKey && nowKey.slice(0, 4) !== m[1] ? `, ${m[1]}` : ""}` : ""; };
const href = (vm, p) => `${vm.base}${p}`;
const ENV_LABEL = { staging: "Preview update", production: "Live update" };

export const FLASH = Object.freeze({
  approved: "Thank you. The update is approved.",
  rejected: "Thank you. Your revision notes were sent to Framework.",
  answered: "Thank you. Your answer was sent to Framework.",
  sent: "Your request was sent. We’ll reply on it.",
});
export const WORKSPACE_ERRORS = Object.freeze({
  invalid_note: "Please say what should change (at least a few words).",
  invalid_text: "Please write your answer first.",
  already_decided: "That update was already decided. The page shows where it stands.",
  not_found: "That is no longer available. The page shows what is current.",
  unavailable: "That couldn’t be saved right now. Please try again in a moment.",
});

/** A status: a small square plus words (never colour alone). tone: ink (needs you), open (to do), late (overdue), done (finished). */
const st = (tone, label) => `<span class="wd-s"><i class="wd-mk wd-mk--${e(tone)}" aria-hidden="true"></i>${e(label)}</span>`;
const chev = `<i class="wd-pl" aria-hidden="true"></i>`;
/** The external-link arrow as an SVG (a text arrow renders as a colour emoji in Safari on iPadOS). */
const arrow = `<svg class="wd-ar" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M5 11l6-6M6 5h5v5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const newTab = (name) => `<span class="visually-hidden"> ${e(name)} (opens in a new tab)</span>`;

/* ------------------------------------------------------------------ 1. the two website cards */

/** The picture of a site: the uploaded screenshot, else a neutral panel that says plainly why there is none. */
function shot(vm, s, src, none) {
  if (src) return `<div class="wd-shot"><img src="${e(src)}" alt="${e(`Screenshot of ${s.name}`)}" loading="lazy" decoding="async"></div>`;
  return `<div class="wd-shot wd-shot--none"><p class="wd-tag">${e(none.title)}</p><p class="wd-none">${e(none.text)}</p></div>`;
}

function liveCard(vm, s) {
  const live = isWebUrl(s.url) && s.status !== "in_development";
  const link = live ? `<a class="wd-btn wd-btn--line" href="${e(s.url)}" target="_blank" rel="noopener noreferrer">Open live site${arrow}${newTab("live site")}</a>` : `<span class="wd-btn wd-btn--line" aria-disabled="true">Not launched</span>`;
  const none = live ? { title: "No screenshot yet", text: "A picture of your website appears here once Framework adds one. You can still open it." } : { title: "Not launched yet", text: "This website has not launched. It will appear here as soon as it is live." };
  return `<article class="wd-card wd-live" aria-labelledby="wd-live-h">
<header class="wd-ct"><div><h2 id="wd-live-h">Live website</h2><p class="wd-u">${live ? e(hostOf(s.url)) : "Not launched yet"}</p></div>${live ? st("live", "Live") : st("open", "Not launched")}</header>
${shot(vm, s, s.hasScreenshot ? href(vm, `/website/${s.id}/screenshot`) : "", none)}
<footer class="wd-foot">${link}</footer></article>`;
}

function previewCard(vm, s, ws) {
  const url = ws && ws.stagingUrl, n = ws && ws.needsReview ? ws.needsReview : 0;
  // The preview picture is one Framework uploads by hand (the preview itself may be password protected); until then this card shows the neutral panel.
  const none = url ? { title: "No preview image yet", text: "A picture of your preview appears here once Framework adds one. You can still open it." } : { title: "No preview yet", text: "Framework will add the preview when there is something to review." };
  const link = url ? `<a class="wd-btn wd-btn--solid" href="${e(url)}" target="_blank" rel="noopener noreferrer">Open preview${arrow}${newTab("preview")}</a>` : `<span class="wd-btn" aria-disabled="true">Not available yet</span>`;
  return `<article class="wd-card wd-card--ink wd-prev" aria-labelledby="wd-prev-h">
<header class="wd-ct"><div><h2 id="wd-prev-h">Preview changes</h2><p class="wd-u">${url ? e(hostOf(url)) : "Not set up yet"}</p></div>${url ? (n ? st("ink", `${n} to review`) : st("live", "Available")) : st("open", "Not set up")}</header>
${shot(vm, s, s.hasStagingScreenshot ? href(vm, `/website/${s.id}/screenshot/staging`) : "", none)}
<footer class="wd-foot">${link}</footer></article>`;
}

/* ------------------------------------------------------------------ 2. needs your attention and 3. recent updates */

function decisionForms(vm, s, u, o) {
  if (u.kind !== "approval" || u.status !== "awaiting_review") return "";
  if (!o.canDecide) return `<p class="wd-note wd-muted">${o.staff ? "Only the client’s account owner can approve or reject updates." : "An account owner can approve or reject this update."}</p>`;
  const base = `/website/${s.id}/updates/${u.id}`;
  const csrf = `<input type="hidden" name="csrf" value="${e(o.csrf)}">`;
  return `<div class="wd-acts"><form class="wd-inline" method="post" action="${e(href(vm, `${base}/approve`))}">${csrf}<button class="wd-btn wd-btn--solid" type="submit">Approve<span class="visually-hidden"> ${e(u.title)}</span></button></form>
<details class="wd-reject"><summary class="wd-link">Reject…<span class="visually-hidden"> ${e(u.title)}</span></summary>
<form method="post" action="${e(href(vm, `${base}/reject`))}">${csrf}<div class="field"><label for="rj-${e(u.id)}">What should change?</label><span class="field__hint" id="rj-${e(u.id)}-h">Tell us what is wrong or what you would like instead. We will revise it and ask you to look again.</span><textarea id="rj-${e(u.id)}" name="note" rows="4" minlength="3" maxlength="1000" aria-describedby="rj-${e(u.id)}-h" required></textarea></div>
<p class="wd-acts"><button class="wd-btn wd-btn--solid" type="submit">Send revision notes</button></p></form></details></div>`;
}

const row = (id, title, meta, status, body) => `<details class="wd-row" id="${e(id)}"><summary><span class="wd-row__main"><span class="wd-t">${e(title)}</span><span class="wd-m">${meta}</span></span>${status}${chev}</summary><div class="wd-b">${body}</div></details>`;
const flat = (title, date, status) => `<div class="wd-row wd-row--flat"><span class="wd-d">${e(date)}</span><span class="wd-row__main"><span class="wd-t">${e(title)}</span></span>${status}</div>`;

function updateRow(vm, s, u, ws, o) {
  const when = shortDay((u.status === "approved" || u.status === "rejected") && u.decidedAt ? u.decidedAt : u.publishedAt || u.createdAt, o.today);
  const open = u.status === "awaiting_review";
  const preview = open && u.environment === "staging" && ws.stagingUrl ? `<a class="wd-link" href="${e(ws.stagingUrl)}" target="_blank" rel="noopener noreferrer">Open preview ${arrow}${newTab("preview")}</a>` : "";
  const note = u.status === "rejected" && u.decisionNote ? `<p class="wd-note"><strong>Your notes:</strong> ${e(u.decisionNote)}</p><p class="wd-note wd-muted">Framework will revise this and ask you to look again.</p>` : "";
  const body = `${u.detail ? `<p>${e(u.detail)}</p>` : ""}${note}${decisionForms(vm, s, u, o)}${preview ? `<p class="wd-acts">${preview}</p>` : ""}`;
  const tone = open ? "ink" : u.status === "approved" ? "done" : u.status === "rejected" ? "open" : "done";
  return { open, row: row(`update-${u.id}`, u.title, `${e(ENV_LABEL[u.environment] || "Update")} · ${e(when)}`, st(tone, UPDATE_STATUS_LABEL[u.status]), body), sort: u.decidedAt || u.publishedAt || u.createdAt, flat: !body.trim() ? flat(u.title, shortDay(u.decidedAt || u.publishedAt || u.createdAt, o.today), st(tone, UPDATE_STATUS_LABEL[u.status])) : "" };
}

function taskAction(vm, s, t, ws, o) {
  if (t.status === "done" || t.status === "cancelled" || t.cta === "none") return "";
  if (t.cta === "upload") return `<p class="wd-acts"><a class="wd-btn wd-btn--solid" href="${e(href(vm, `/website/${s.id}/requests/new?kind=change&title=${encodeURIComponent(t.title)}`))}">Upload files<span class="visually-hidden"> for ${e(t.title)}</span></a></p>`;
  const stage = t.cta === "review" && ws && ws.stagingUrl ? `<a class="wd-link" href="${e(ws.stagingUrl)}" target="_blank" rel="noopener noreferrer">Open preview ${arrow}${newTab("preview")}</a>` : "";
  if (!o.canRespond) return stage ? `<p class="wd-acts">${stage}</p>` : "";
  const label = t.status === "submitted" ? "Change your answer" : t.cta === "review" ? "Send your review" : "Respond";
  return `<div class="wd-acts"><details class="wd-reject"><summary class="wd-btn wd-btn--solid">${e(label)}<span class="visually-hidden"> for ${e(t.title)}</span></summary>
<form method="post" action="${e(href(vm, `/website/${s.id}/tasks/${t.id}/respond`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="field"><label for="tk-${e(t.id)}">Your answer</label><textarea id="tk-${e(t.id)}" name="text" rows="4" maxlength="1000" required>${e(t.responseText || "")}</textarea></div>
<p class="wd-acts"><button class="wd-btn wd-btn--solid" type="submit">Send to Framework</button></p></form></details>${stage}</div>`;
}

function taskRow(vm, s, t, ws, o) {
  const overdue = t.dueDate && t.status === "open" && t.dueDate < o.today;
  const due = t.dueDate ? `<span class="${overdue ? "wd-late" : ""}">${overdue ? "Overdue since " : "Due "}${e(shortDay(t.dueDate, o.today))}</span>` : "";
  const meta = `Task${due ? ` · ${due}` : ""}`;
  const answer = t.status === "submitted" && t.responseText ? `<p class="wd-note"><strong>You wrote:</strong> ${e(t.responseText)}</p>` : "";
  const open = t.status === "open";
  const tone = overdue ? "late" : open ? "open" : "done";
  const body = `${t.detail ? `<p>${e(t.detail)}</p>` : ""}${answer}${taskAction(vm, s, t, ws, o)}`;
  return { open, row: row(`task-${t.id}`, t.title, meta, st(tone, TASK_STATUS_LABEL[t.status]), body), sort: t.updatedAt || t.createdAt, flat: !body.trim() ? flat(t.title, shortDay(t.updatedAt || t.createdAt, o.today), st(tone, TASK_STATUS_LABEL[t.status])) : "" };
}

function needsCard(vm, s, ws, o) {
  const items = [...ws.updates.map((u) => updateRow(vm, s, u, ws, o)), ...ws.tasks.map((t) => taskRow(vm, s, t, ws, o))];
  const need = items.filter((i) => i.open);
  const count = ws.needsReview + ws.needed;
  const list = need.length ? `<div class="wd-list">${need.map((i) => i.row).join("")}</div>` : `<p class="wd-empty">Nothing needs you right now.</p>`;
  return `<section class="wd-card wd-needs" id="needed" aria-labelledby="wd-needs-h"><header class="wd-ct"><h2 id="wd-needs-h">Needs your attention${count ? ` <span class="wd-count">${count}<span class="visually-hidden"> items</span></span>` : ""}</h2></header>${list}</section>`;
}

const RECENT_SHOWN = 5;
function recentCard(vm, s, ws, o) {
  const done = [...ws.updates.map((u) => updateRow(vm, s, u, ws, o)), ...ws.tasks.map((t) => taskRow(vm, s, t, ws, o))].filter((i) => !i.open).sort((a, b) => (a.sort < b.sort ? 1 : a.sort > b.sort ? -1 : 0));
  const show = (i) => i.flat || i.row;
  const first = done.slice(0, RECENT_SHOWN), rest = done.slice(RECENT_SHOWN);
  const list = done.length
    ? `<div class="wd-list">${first.map(show).join("")}</div>${rest.length ? `<details class="wd-earlier"><summary class="wd-link">Earlier updates (${rest.length})</summary><div class="wd-list">${rest.map(show).join("")}</div></details>` : ""}`
    : `<p class="wd-empty">No updates yet. When Framework changes your website, you will see what changed here.</p>`;
  return `<section class="wd-card wd-recent" id="updates" aria-labelledby="wd-recent-h"><header class="wd-ct"><h2 id="wd-recent-h">Recent updates</h2></header>${list}</section>`;
}

/* ------------------------------------------------------------------ 4. website traffic: genuine figures only */

const nf = (n) => (Number.isFinite(n) ? n.toLocaleString("en-CA") : "");
const BAR_W = 10, BAR_H = 84;
function bars(series) {
  const v = series.map((d) => d.visits), max = Math.max(1, ...v);
  return v.map((n, i) => { const h = n > 0 ? Math.max(2, Math.round((n / max) * (BAR_H - 4))) : 1; return `<rect x="${i * BAR_W + 1}" y="${BAR_H - h}" width="${BAR_W - 3}" height="${h}"/>`; }).join("");
}
const changeWords = (cur, prev) => { if (!(prev > 0)) return ""; const p = Math.round(((cur - prev) / prev) * 100); return p === 0 ? "No change" : `${p > 0 ? "▲" : "▼"} ${Math.abs(p)}%`; };

/** `src` is the analytics service's answer for Cloudflare Web Analytics (state ok, stale, error, not_enabled, not_connected) or null when analytics is not available. */
function trafficCard(vm, s, o) {
  const src = o.traffic || null;
  const link = o.analyticsLink ? `<a class="wd-more" href="${e(href(vm, `/website/${s.id}/analytics`))}">Open analytics →<span class="visually-hidden"> for ${e(s.name)}</span></a>` : "";
  const d = src && (src.state === "ok" || src.state === "stale") && src.data && src.data.totals ? src.data : null;
  const days = d ? d.series.length : 0;
  let inner;
  if (d) {
    const cur = d.totals, prev = d.previous || {};
    const delta = changeWords(cur.visits, prev.visits);
    const stale = src.state === "stale" ? `<p class="wd-m">Showing the figures read on ${e(shortDay(src.fetchedAt, o.today))}.</p>` : "";
    inner = `<div class="wd-tr"><div><p class="wd-big">${e(nf(cur.visits))}</p><p class="wd-m"><span>visits</span>${delta ? ` · <strong>${e(delta)}</strong> vs the period before` : ""}</p></div><p class="wd-pv"><strong>${e(nf(cur.pageViews))}</strong><span class="wd-m">Page views</span></p></div>
<svg class="wd-spark" viewBox="0 0 ${Math.max(1, days) * BAR_W} ${BAR_H}" preserveAspectRatio="none" role="img" aria-label="${e(`Visits per day, ${shortDay(d.period.from, o.today)} to ${shortDay(d.period.to, o.today)}: ${nf(cur.visits)} in total`)}"><g>${bars(d.series)}</g></svg>${stale}`;
  } else if (src && src.state === "error") {
    inner = `<div class="wd-none-b"><p class="wd-tag">Couldn’t load right now</p><p class="wd-none">The traffic figures can’t be read at the moment. Nothing has changed; please try again later.</p></div>`;
  } else {
    inner = `<div class="wd-none-b"><p class="wd-tag">Not connected yet</p><p class="wd-none">Visits and page views appear here once analytics is set up for this website.</p></div>`;
  }
  const period = d ? `<span class="wd-m">Last ${days} days</span>` : "";
  return `<section class="wd-card wd-card--tone wd-traffic" aria-labelledby="wd-tr-h"><header class="wd-ct"><h2 id="wd-tr-h">Website traffic</h2>${period}</header>${inner}${link}${d ? `<p class="wd-m wd-src">Cloudflare Web Analytics · through ${e(shortDay(d.period.to, o.today))}. Counts visits, not people.</p>` : ""}</section>`;
}

/* ------------------------------------------------------------------ 5. request a change */

function requestCard(vm, s, o) {
  if (!o.canRequest) return "";
  return `<section class="wd-card wd-card--ink wd-req" id="request" aria-labelledby="wd-rq-h"><header class="wd-ct"><h2 id="wd-rq-h">Need something changed?</h2></header>
<p class="wd-m wd-rq-sub">Tell us what to update. We reply on the request.</p>
<details class="wd-rq"><summary class="wd-btn">Request a change${chev}</summary>
<form class="wd-form" method="post" action="${e(href(vm, `/website/${s.id}/requests`))}" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${e(o.csrf)}">
<div class="field"><label for="wk-kind">About</label><select id="wk-kind" name="kind"><option value="change">A change to my website</option><option value="support">A problem or technical help</option></select></div>
<div class="field"><label for="wk-title">Title</label><input id="wk-title" name="title" type="text" maxlength="120" required></div>
<div class="field"><label for="wk-desc">What would you like?</label><textarea id="wk-desc" name="description" rows="5" maxlength="${MAX_BODY}" required></textarea></div>
<div class="field"><label for="wk-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="wk-files-h">Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1048576} MB each: images, PDF, text, Word, Excel, PowerPoint or ZIP.</span><input id="wk-files" name="file" type="file" multiple aria-describedby="wk-files-h"></div>
<p class="wd-acts"><button class="wd-btn wd-btn--solid" type="submit">Send request</button><a class="wd-link" href="${e(href(vm, "/website/requests"))}">Your website requests${o.requestSummary ? ` <span class="wd-m">${e(o.requestSummary)}</span>` : ""}</a></p></form></details></section>`;
}

/* ------------------------------------------------------------------ the whole dashboard */

/**
 * @param o { workspace (repo getWorkspaceForClient or null/{available:false}), csrf, canDecide, canRespond, canRequest, staff, flash, error, requestSummary, now,
 *            traffic (analytics service answer for Cloudflare or null), analyticsLink (the Analytics page exists), title (render the website's name as the page heading),
 *            details / services (html placed in two collapsed groups under the cards) }
 */
export function workspaceSections(vm, s, o = {}) {
  const ws = o.workspace || { available: false, stagingUrl: null, updates: [], tasks: [], needsReview: 0, needed: 0 };
  const ctx = { ...o, today: dayKey(o.now || new Date()) };
  const banner = o.flash && FLASH[o.flash] ? `<p class="form-banner" role="status">${e(FLASH[o.flash])}</p>` : o.error && WORKSPACE_ERRORS[o.error] ? `<p class="form-banner form-banner--error" role="alert">${e(WORKSPACE_ERRORS[o.error])}</p>` : "";
  const need = ws.available ? ws.needsReview + ws.needed : 0;
  const head = `<header class="wd-head">${o.title ? `<h1 class="wd-title">${e(s.name)}</h1>` : "<span></span>"}<p class="wd-head__r">${s.managedByFramework ? "<span>Managed by Framework</span>" : ""}${need ? `<a class="wd-need" href="#needed">${need} need${need === 1 ? "s" : ""} you</a>` : ""}</p></header>`;
  const left = ws.available ? `${needsCard(vm, s, ws, ctx)}${recentCard(vm, s, ws, ctx)}` : "";
  const more = (title, hint, html, open = false) => (html ? `<details class="wd-moreg"${open ? " open" : ""}><summary><b>${e(title)}</b><span>${e(hint)}</span>${chev}</summary><div class="wd-moreg__b">${html}</div></details>` : "");
  return `<div class="wd">${banner}${head}<div class="wd-grid">${liveCard(vm, s)}${previewCard(vm, s, ws)}<div class="wd-col wd-col--l">${left}</div><div class="wd-col wd-col--r">${trafficCard(vm, s, ctx)}${requestCard(vm, s, ctx)}</div></div>
<div class="wd-extra">${more("Details", "Address, progress, SEO, files and support", o.details)}${more("Additional services", "Add-ons Framework can set up for you", o.services, o.servicesOpen)}</div></div>`;
}
