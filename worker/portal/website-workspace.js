/**
 * The Website review workspace, client side (migration 0030; see WEBSITES.md): three areas on one page, in this order.
 *   1. Environments: Main (Production) and Staging, each with its status, address, one line and one action. Staging is the review environment.
 *   2. Updates & requests: what Framework changed (approve, or reject with revision notes, when it needs a decision) and what Framework needs from the client (a due date, a status, an action).
 *   3. Request changes: a short form that creates an ordinary website change request (the existing support workflow: thread, attachments, Admin queue).
 * Pure string building from what the router already scoped to the member's own organization; every dynamic value is escaped. No inline style and no inline script: the reject and respond
 * forms are native <details> disclosures, so they work without script. Framework styling: near monochrome, sharp corners, hairline rules (assets/css/portal-website-workspace.css).
 */
import { e, fmtDay, dayKey } from "./ui.js";
import { UPDATE_STATUS_LABEL, TASK_STATUS_LABEL } from "./repo/website-workspace.js";
import { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY } from "./repo/support.js";

const isWebUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/.test(u);
const shortUrl = (u) => String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const plainDay = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}` : ""; };
const href = (vm, p) => `${vm.base}${p}`;
const ENV_LABEL = { staging: "Staging", production: "Production" };

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

const mark = (tone, label) => `<span class="status status--${tone}">${e(label)}</span>`;
const UPDATE_TONE = { awaiting_review: "active", approved: "done", rejected: "paused", info: "idle" };
const TASK_TONE = { open: "active", submitted: "idle", done: "done", cancelled: "idle" };

/* ------------------------------------------------------------------ 1. environments */

function environments(vm, s, ws) {
  const live = isWebUrl(s.url) && s.status !== "in_development";
  const stagingUrl = ws && ws.stagingUrl;
  const awaiting = ws && ws.needsReview ? ws.needsReview : 0;
  const action = (url, label, cls, name) => `<a class="btn ${cls}" href="${e(url)}" target="_blank" rel="noopener noreferrer">${e(label)}<span class="visually-hidden"> ${e(name)} (opens in a new tab)</span></a>`;
  const prod = `<li class="wk-card wk-env">
<header class="wk-card__head"><p class="wk-eyebrow">Main · Production</p>${live ? mark("live", "Live") : mark("idle", "Not launched")}</header>
<h3 class="wk-card__title">${live ? e(shortUrl(s.url)) : "Not launched yet"}</h3>
<p class="wk-card__text">${live ? "The public website your customers see." : "This website has not launched. It will appear here as soon as it is live."}</p>
<p class="wk-card__act">${live ? action(s.url, "View live site", "", "live site") : `<span class="btn" aria-disabled="true">Not launched</span>`}</p></li>`;
  const stage = `<li class="wk-card wk-env wk-env--review">
<header class="wk-card__head"><p class="wk-eyebrow">Staging · Review here</p>${stagingUrl ? (awaiting ? mark("active", `${awaiting} to review`) : mark("live", "Available")) : mark("idle", "Not set up yet")}</header>
<h3 class="wk-card__title">${stagingUrl ? e(shortUrl(stagingUrl)) : "Not set up yet"}</h3>
<p class="wk-card__text">${stagingUrl ? "Where we show you changes before they go live. Look around, then approve or send notes below." : "Framework will add the staging address when there is something to review."}</p>
<p class="wk-card__act">${stagingUrl ? action(stagingUrl, "View staging", "btn--primary", "staging site") : `<span class="btn" aria-disabled="true">Not available yet</span>`}</p></li>`;
  return `<section class="wk-sec" aria-labelledby="wk-env-h"><h2 class="wk-h" id="wk-env-h">Environments</h2><ul class="wk-env-grid">${stage}${prod}</ul></section>`;
}

/* ------------------------------------------------------------------ 2. updates & requests */

function decisionForms(vm, s, u, o) {
  if (u.kind !== "approval" || u.status !== "awaiting_review") return "";
  if (!o.canDecide) return `<p class="wk-note muted small">${o.staff ? "Only the client’s account owner can approve or reject updates." : "An account owner can approve or reject this update."}</p>`;
  const base = `/website/${s.id}/updates/${u.id}`;
  const csrf = `<input type="hidden" name="csrf" value="${e(o.csrf)}">`;
  return `<div class="wk-decide"><form class="wk-inline" method="post" action="${e(href(vm, `${base}/approve`))}">${csrf}<button class="btn btn--primary" type="submit">Approve<span class="visually-hidden"> ${e(u.title)}</span></button></form>
<details class="wk-reject"><summary class="btn">Reject<span class="visually-hidden"> ${e(u.title)}</span></summary>
<form method="post" action="${e(href(vm, `${base}/reject`))}">${csrf}<div class="field"><label for="rj-${e(u.id)}">What should change?</label><span class="field__hint" id="rj-${e(u.id)}-h">Tell us what is wrong or what you would like instead. We will revise it and ask you to look again.</span><textarea id="rj-${e(u.id)}" name="note" rows="4" minlength="3" maxlength="1000" aria-describedby="rj-${e(u.id)}-h" required></textarea></div>
<p class="wk-form__act"><button class="btn btn--primary" type="submit">Send revision notes</button></p></form></details></div>`;
}

function updateItem(vm, s, u, o) {
  const tone = u.status;
  const note = u.status === "rejected" && u.decisionNote ? `<p class="wk-note"><strong>Your notes:</strong> ${e(u.decisionNote)}</p><p class="wk-note muted small">Framework will revise this and ask you to look again.</p>` : "";
  const decided = u.decidedAt && (u.status === "approved" || u.status === "rejected") ? `<span class="wk-meta__sep" aria-hidden="true">·</span><span>${u.status === "approved" ? "Approved" : "Decided"} ${e(fmtDay(u.decidedAt))}</span>` : "";
  return `<li class="wk-item wk-item--${e(tone)}" id="update-${e(u.id)}">
<p class="wk-meta">${mark(UPDATE_TONE[u.status], UPDATE_STATUS_LABEL[u.status])}<span class="wk-tag">${e(ENV_LABEL[u.environment] || "")}</span><span>${e(fmtDay(u.publishedAt || u.createdAt))}</span>${decided}</p>
<h3 class="wk-item__title">${e(u.title)}</h3>${u.detail ? `<p class="wk-item__text">${e(u.detail)}</p>` : ""}${note}${decisionForms(vm, s, u, o)}</li>`;
}

function taskAction(vm, s, t, ws, o) {
  if (t.status === "done" || t.status === "cancelled") return "";
  if (t.cta === "none") return "";
  if (t.cta === "upload") return `<p class="wk-item__act"><a class="btn" href="${e(href(vm, `/website/${s.id}/requests/new?kind=change&title=${encodeURIComponent(t.title)}`))}">Upload files<span class="visually-hidden"> for ${e(t.title)}</span></a></p>`;
  const stage = t.cta === "review" && ws && ws.stagingUrl ? `<a class="btn" href="${e(ws.stagingUrl)}" target="_blank" rel="noopener noreferrer">View staging<span class="visually-hidden"> (opens in a new tab)</span></a> ` : "";
  if (!o.canRespond) return stage ? `<p class="wk-item__act">${stage}</p>` : "";
  const label = t.status === "submitted" ? "Change your answer" : t.cta === "review" ? "Send your review" : "Respond";
  return `<div class="wk-item__act">${stage}<details class="wk-reject"><summary class="btn">${e(label)}<span class="visually-hidden"> for ${e(t.title)}</span></summary>
<form method="post" action="${e(href(vm, `/website/${s.id}/tasks/${t.id}/respond`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="field"><label for="tk-${e(t.id)}">Your answer</label><textarea id="tk-${e(t.id)}" name="text" rows="4" maxlength="1000" required>${e(t.responseText || "")}</textarea></div>
<p class="wk-form__act"><button class="btn btn--primary" type="submit">Send to Framework</button></p></form></details></div>`;
}

function taskItem(vm, s, t, ws, o) {
  const overdue = t.dueDate && t.status === "open" && t.dueDate < o.today;
  const due = t.dueDate ? `<span class="wk-due${overdue ? " wk-due--late" : ""}">${overdue ? "Overdue · " : "Due "}${e(plainDay(t.dueDate))}</span>` : "";
  const answer = t.status === "submitted" && t.responseText ? `<p class="wk-note"><strong>You wrote:</strong> ${e(t.responseText)}</p>` : "";
  return `<li class="wk-item wk-item--task-${e(t.status)}" id="task-${e(t.id)}">
<p class="wk-meta">${mark(overdue ? "attention" : TASK_TONE[t.status], TASK_STATUS_LABEL[t.status])}${due}</p>
<h3 class="wk-item__title">${e(t.title)}</h3>${t.detail ? `<p class="wk-item__text">${e(t.detail)}</p>` : ""}${answer}${taskAction(vm, s, t, ws, o)}</li>`;
}

function updatesAndRequests(vm, s, ws, o) {
  const updates = ws.updates.length ? `<ul class="wk-list">${ws.updates.map((u) => updateItem(vm, s, u, o)).join("")}</ul>` : `<p class="wk-empty">No updates yet. When Framework changes your website, you will see what changed here.</p>`;
  const tasks = ws.tasks.length ? `<ul class="wk-list">${ws.tasks.map((t) => taskItem(vm, s, t, ws, o)).join("")}</ul>` : `<p class="wk-empty">Nothing is needed from you right now.</p>`;
  const counts = [ws.needsReview ? `${ws.needsReview} to review` : "", ws.needed ? `${ws.needed} needed from you` : ""].filter(Boolean).join(" · ");
  return `<section class="wk-sec" id="updates" aria-labelledby="wk-ur-h"><div class="wk-sec__head"><h2 class="wk-h" id="wk-ur-h">Updates &amp; requests</h2>${counts ? `<p class="wk-sec__count">${e(counts)}</p>` : ""}</div>
<div class="wk-cols"><div class="wk-col" aria-labelledby="wk-up-h"><h3 class="wk-sub" id="wk-up-h">Website updates</h3>${updates}</div>
<div class="wk-col" id="needed" aria-labelledby="wk-nd-h"><h3 class="wk-sub" id="wk-nd-h">Needed from you</h3>${tasks}</div></div></section>`;
}

/* ------------------------------------------------------------------ 3. request changes */

function requestChanges(vm, s, o) {
  if (!o.canRequest) return "";
  return `<section class="wk-sec" id="request" aria-labelledby="wk-rq-h"><h2 class="wk-h" id="wk-rq-h">Request changes</h2>
<p class="wk-lead">Tell us what you would like changed or fixed. We reply on the request, and you can follow it from Website requests.</p>
<form class="wk-form" method="post" action="${e(href(vm, `/website/${s.id}/requests`))}" enctype="multipart/form-data"><input type="hidden" name="csrf" value="${e(o.csrf)}">
<div class="wk-form__row"><div class="field wk-form__kind"><label for="wk-kind">About <span class="field__opt">Optional</span></label><select id="wk-kind" name="kind"><option value="change">A change to my website</option><option value="support">A problem or technical help</option></select></div>
<div class="field wk-form__title"><label for="wk-title">Title</label><input id="wk-title" name="title" type="text" maxlength="120" required></div></div>
<div class="field"><label for="wk-desc">What would you like?</label><textarea id="wk-desc" name="description" rows="5" maxlength="${MAX_BODY}" required></textarea></div>
<div class="field"><label for="wk-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="wk-files-h">Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1048576} MB each: images, PDF, text, Word, Excel, PowerPoint or ZIP.</span><input id="wk-files" name="file" type="file" multiple aria-describedby="wk-files-h"></div>
<p class="wk-form__act"><button class="btn btn--primary" type="submit">Send request</button> <a class="text-link" href="${e(href(vm, "/website/requests"))}">Your website requests${o.requestSummary ? ` <span class="muted small">${e(o.requestSummary)}</span>` : ""}</a></p></form></section>`;
}

/* ------------------------------------------------------------------ the whole workspace */

/**
 * @param o { workspace (repo getWorkspaceForClient or null/{available:false}), csrf, canDecide, canRespond, canRequest, staff, flash, error, requestSummary, now }
 */
export function workspaceSections(vm, s, o = {}) {
  const ws = o.workspace || { available: false, stagingUrl: null, updates: [], tasks: [], needsReview: 0, needed: 0 };
  const ctx = { ...o, today: dayKey(o.now || new Date()) };
  const banner = o.flash && FLASH[o.flash] ? `<p class="form-banner" role="status">${e(FLASH[o.flash])}</p>` : o.error && WORKSPACE_ERRORS[o.error] ? `<p class="form-banner form-banner--error" role="alert">${e(WORKSPACE_ERRORS[o.error])}</p>` : "";
  return `<div class="wk">${banner}${environments(vm, s, ws)}${ws.available ? updatesAndRequests(vm, s, ws, ctx) : ""}${requestChanges(vm, s, ctx)}</div>`;
}
