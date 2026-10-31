/**
 * The client's Website page (Phase 2; only where PORTAL_WEBSITE is on). Rendered only from what the tenant guard already scoped to the member's OWN organization:
 * the websites Framework published for it (repo/client-websites.js: never management notes or storage details). No website at all is an empty state, not a record.
 * Like every portal page there is no inline style and no inline script; the live preview is a sandboxed frame of the website itself (see visual()), and the optional screenshot a plain image from an authorised route of this site.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { CONTACT_EMAIL, SUPPORT_ERRORS, statusTag, when, notice } from "./services-live.js";
import { CATEGORY_LABEL, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY } from "./repo/support.js";
import { fileSize } from "./branding-live.js";
import { ESTIMATE_NOTE } from "./branding-pricing.js";
import { stageOf, milestoneProgress } from "./website-stage.js";
import { serviceCatalogue } from "./service-catalogue.js";
import { SEO_STATUS_LABEL } from "./repo/website-seo.js";

const href = (vm, p) => `${vm.base}${p}`;
const isWebUrl = (u) => typeof u === "string" && /^https?:\/\/[^\s"'<>]+$/.test(u);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A stored YYYY-MM-DD as "Oct 29, 2026" (a plain date: no time zone shifts it). */
const day = (d) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ""); return m ? `${MONTHS[Number(m[2]) - 1] || ""} ${Number(m[3])}, ${m[1]}` : ""; };
const shortUrl = (u) => String(u).replace(/^https?:\/\//, "").replace(/\/$/, "");

export const STATUS_LABEL = Object.freeze({ existing: "Existing website", in_development: "In development", live: "Live" });
const STATUS_CLASS = { existing: "idle", in_development: "active", live: "live" };
const PARTY = { framework: "Framework", client: "You", unknown: "Not recorded" };

const statusChip = (s) => { const st = stageOf(s); return `<span class="status status--${e(st.tone)}">${e(st.label)}</span>`; };
const managedChip = (s) => `<span class="ws__managed">${s.managedByFramework ? "Managed by Framework" : "Not managed by Framework"}</span>`;
const link = (s, label) => (isWebUrl(s.url) ? `<a class="text-link" href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${label || e(shortUrl(s.url))}<span class="visually-hidden"> (opens in a new tab)</span></a>` : "");

/** What this website's state means for the client, in plain words. */
function statement(s) {
  const phase = stageOf(s).key;
  if (phase === "awaiting_feedback") return "Framework is building this website and needs your feedback to keep moving. Reply on your latest request, or send us a note, and the work continues.";
  if (phase === "awaiting_approval") return "Your website is ready for your review. Framework is waiting for your approval before the next step.";
  if (phase === "maintenance") return s.managedByFramework ? "This website is live and in maintenance: Framework keeps it up to date and running smoothly." : "This website is live and in maintenance.";
  if (s.status === "in_development") return "Framework is building this website. You will see its progress here as the work moves forward.";
  if (s.status === "live") return s.managedByFramework ? "This website is live, and Framework looks after it for you." : "This website is live. Framework does not manage it; you or your own provider do. If you would like help with it, just ask.";
  return s.managedByFramework ? "This is your current website, and Framework looks after it for you." : "This is your current website. Framework does not manage it, and it is listed here so everything about your online presence is in one place.";
}

function facts(s) {
  const row = (label, value) => (value ? `<div><dt>${e(label)}</dt><dd>${value}</dd></div>` : "");
  const party = (p) => (p && p !== "unknown" ? `${e(PARTY[p])}` : "");
  const domain = [s.domain.registrar && e(s.domain.registrar), s.domain.owner !== "unknown" ? `owned by ${party(s.domain.owner)}` : ""].filter(Boolean).join(" · ");
  const hosting = [s.hosting.provider && e(s.hosting.provider), s.hosting.owner !== "unknown" ? `owned by ${party(s.hosting.owner)}` : ""].filter(Boolean).join(" · ");
  const rows = [
    row("Address", link(s)),
    row("Launched", e(day(s.launchDate))),
    row("Domain", domain),
    row("Domain renews", e(day(s.domain.renewal))),
    row("Hosting", hosting),
    row("Hosting renews", e(day(s.hosting.renewal))),
  ].join("");
  return rows ? `<dl class="contact ws__facts">${rows}</dl>` : "";
}

const host = (s) => shortUrl(s.url).replace(/\/.*$/, "");
const visit = (s, cls = "btn btn--primary") => (isWebUrl(s.url) ? `<a class="${cls}" href="${e(s.url)}" target="_blank" rel="noopener noreferrer">Visit website<span class="visually-hidden"> ${e(s.name)} (opens in a new tab)</span></a>` : "");

/** The desktop-style frame around a preview: a browser bar with the address, then the page. `inner` is the live iframe or the screenshot. */
const frame = (s, inner, note) => `<figure class="ws-frame"><div class="ws-frame__bar" aria-hidden="true"><span class="ws-frame__dots"><i></i><i></i><i></i></span><span class="ws-frame__url">${e(host(s))}</span></div><div class="ws-frame__view">${inner}</div>${note ? `<figcaption class="ws-frame__note">${note}</figcaption>` : ""}</figure>`;

/**
 * The picture of a website, best first: its live page in a sandboxed frame (only when the website itself permits framing: see website-preview.js); otherwise the optional uploaded
 * screenshot; otherwise a plain card. The frame is lazy-loaded, has no referrer, no permissions, and a sandbox WITHOUT allow-same-origin, so the page inside can neither read the portal
 * nor its cookies, whatever it is. A Visit website button always follows.
 */
function visual(vm, s, preview) {
  if (!isWebUrl(s.url) && !s.hasScreenshot) return "";
  if (preview && preview.embeddable && /^https:\/\//.test(s.url)) {
    const iframe = `<iframe class="ws-frame__page" src="${e(s.url)}" title="${e(`Live preview of ${s.name}`)}" loading="lazy" referrerpolicy="no-referrer" allow="" sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"></iframe>`;
    return `${frame(s, iframe, "Live preview. Some features may not work inside the preview; use Visit website for the full site.")}<p class="ws__visit">${visit(s)}</p>`;
  }
  if (s.hasScreenshot) {
    const img = `<img class="ws-frame__img" src="${e(href(vm, `/website/${s.id}/screenshot`))}" alt="${e(`Screenshot of ${s.name}`)}" loading="lazy" decoding="async">`;
    return `${frame(s, img, "")}<p class="ws__visit">${visit(s)}</p>`;
  }
  return `<div class="ws-card"><p class="ws-card__host">${e(host(s))}</p><p class="muted">Open the website to see it in a new tab.</p><p class="ws__visit">${visit(s)}</p></div>`;
}

/* ------------------------------------------------------------------ progress, milestones and the SEO teaser */

const MILE_MARK = { done: "Done", in_progress: "In progress", todo: "To do" };
/** Progress of a website being built, from its real milestones: a thin bar, "n of m milestones complete", the next one, then the list. Nothing for a live website: its status says Live. */
export function progressBlock(s, milestones) {
  const p = milestoneProgress(s, milestones);
  if (!p.show) return "";
  const list = milestones.map((m) => `<li class="ws-mile is-${e(m.status)}"><span class="ws-mile__mark" aria-hidden="true"></span><span class="ws-mile__body"><span class="ws-mile__title">${e(m.title)}</span>${m.detail ? `<span class="ws-mile__detail muted small">${e(m.detail)}</span>` : ""}</span><span class="ws-mile__meta small"><span class="visually-hidden">Status: </span>${e(MILE_MARK[m.status] || "")}${m.dueDate && m.status !== "done" ? ` · due ${e(day(m.dueDate))}` : ""}</span></li>`).join("");
  return `<section class="ws-sec ws-progress" aria-labelledby="ws-prog-h"><h2 class="h2" id="ws-prog-h">Progress</h2><div class="progress-line"><progress class="meter" max="100" value="${p.percent}" aria-hidden="true">${p.percent}%</progress><p class="tile__pct">${p.percent}% complete</p></div><p class="muted small">${e(`${p.done} of ${p.total} milestones complete${p.next ? `. Next: ${p.next}` : ""}`)}</p><ol class="ws-miles">${list}</ol></section>`;
}

/** The SEO & Search Visibility entry inside Website: the status, Framework's summary and one link. Shown only once Admin has published something for this website. */
function seoTeaser(vm, s, seo) {
  if (!seo) return "";
  return `<section class="ws-sec" aria-labelledby="ws-seo-h"><h2 class="h2" id="ws-seo-h">SEO &amp; Search Visibility</h2><p class="ws__badges"><span class="status status--${seo.status === "not_started" ? "idle" : seo.status === "in_progress" ? "active" : "live"}">${e(SEO_STATUS_LABEL[seo.status] || "")}</span></p>${seo.summary ? `<p class="ws-sec__lead">${e(seo.summary)}</p>` : ""}<p><a class="btn" href="${e(href(vm, `/website/${s.id}/seo`))}">View SEO details<span class="visually-hidden"> for ${e(s.name)}</span></a></p></section>`;
}

function detailBody(vm, s, preview, extra = {}) {
  return `<div class="ws__badges">${statusChip(s)}${managedChip(s)}</div>
<p class="lead ws__lead">${e(statement(s))}</p>
${visual(vm, s, preview)}${progressBlock(s, extra.milestones || [])}${facts(s)}${seoTeaser(vm, s, extra.seo)}${management(vm, s, extra.management)}${serviceCatalogue(vm, extra.services)}`;
}

/* ------------------------------------------------------------------ Website management and Additional Services */

const action = (title, text, control) => `<li class="ws-action"><div class="ws-action__text"><h3 class="ws-action__title">${e(title)}</h3><p class="ws-action__desc">${e(text)}</p></div><div class="ws-action__cta">${control}</div></li>`;
const disabledButton = (label) => `<span class="btn" aria-disabled="true">${e(label)}</span>`;

/**
 * Website management for ONE website: download its files (when Framework has published them), ask for a change, get support. Requests are ordinary support requests (the existing workflow, its
 * thread and statuses) linked to this website, and work whether or not Client Services is switched on. `m`: { package, canRequest, requests: { total, open, unread } }.
 */
function management(vm, s, m) {
  if (!m) return "";
  const pkg = m.package;
  const download = pkg
    ? `<a class="btn" href="${e(href(vm, `/website/${s.id}/files/download`))}" download>Download<span class="visually-hidden"> website files for ${e(s.name)} (ZIP, ${e(fileSize(pkg.size))})</span></a>`
    : disabledButton("Not available yet");
  const downloadText = pkg ? `Your website’s files as a ZIP (${fileSize(pkg.size)}), provided by Framework.` : "Framework will make your website’s files available here when they are ready.";
  const ask = (kind, label) => (m.canRequest ? `<a class="btn" href="${e(href(vm, `/website/${s.id}/requests/new?kind=${kind}`))}">${e(label)}</a>` : disabledButton(label));
  const r = m.requests;
  const summary = r && r.total ? `<p class="ws-sec__more"><a class="text-link" href="${e(href(vm, "/website/requests"))}">Your website requests</a> <span class="muted small">${[r.unread ? `${r.unread} new ${r.unread === 1 ? "reply" : "replies"}` : "", r.open ? `${r.open} open` : "None open"].filter(Boolean).join(" · ")}</span></p>` : "";
  return `<section class="ws-sec" aria-labelledby="ws-mgmt-h"><h2 class="h2" id="ws-mgmt-h">Website management</h2>
<ul class="ws-actions">${action("Download website files", downloadText, download)}${action("Request a change", "Ask for an update to your website, with details and files.", ask("change", "Request a change"))}${action("Get support", "Report a problem or ask for technical help.", ask("support", "Get support"))}</ul>${summary}${m.canRequest ? "" : `<p class="muted small">Only people with access to this account can send requests.</p>`}</section>`;
}

/** The empty state: no website has been added for this organization. */
function emptyState() {
  const subject = encodeURIComponent("Website enquiry");
  return `<section class="ws__empty" aria-labelledby="ws-empty-h"><h2 class="h2" id="ws-empty-h">No website yet</h2>
<p class="lead">There is no website listed for your business here. If you are thinking about a new site, or have one you would like to bring under Framework, we would be glad to talk it through.</p>
<p><a class="btn btn--primary" href="mailto:${e(CONTACT_EMAIL)}?subject=${subject}">Talk to us about a website</a></p></section>`;
}

function card(vm, s) {
  return `<li><a class="hub" href="${e(href(vm, `/website/${s.id}`))}"><span class="hub__top"><span class="hub__title">${e(s.name)}</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span>${s.url ? `<span class="hub__desc">${e(shortUrl(s.url))}</span>` : ""}<span class="hub__status"><span class="ws__badges">${statusChip(s)}${managedChip(s)}</span></span></a></li>`;
}

const requestsLink = (vm, m) => (m && m.requests && m.requests.total ? `<p class="ws-sec__more"><a class="text-link" href="${e(href(vm, "/website/requests"))}">Your website requests</a> <span class="muted small">${[m.requests.unread ? `${m.requests.unread} new ${m.requests.unread === 1 ? "reply" : "replies"}` : "", m.requests.open ? `${m.requests.open} open` : "None open"].filter(Boolean).join(" · ")}</span></p>` : "");

/** /website: nothing yet (empty state), one website (shown in full), or several (a list; each opens its own page). */
export function websiteOverview(vm, sites, preview = null, extra = {}) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Website"]])}<h1 class="h1 h1--section">Website</h1></header>`;
  if (!sites.length) return `${head}${emptyState()}${serviceCatalogue(vm, extra.services)}`;
  if (sites.length === 1) return `${head}<h2 class="h2 ws__name">${e(sites[0].name)}</h2>${detailBody(vm, sites[0], preview, extra)}`;
  return `${head}<p class="lead">${e(`${sites.length} websites are listed for your business.`)}</p><ul class="hubs ws__list">${sites.map((s) => card(vm, s)).join("")}</ul>${requestsLink(vm, extra.management)}${serviceCatalogue(vm, extra.services)}`;
}

/** /website/:id — one website in full (also reachable when it is the only one). */
export function websiteDetail(vm, s, preview = null, extra = {}) {
  return `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], [s.name]])}<h1 class="h1 h1--section">${e(s.name)}</h1></header>${detailBody(vm, s, preview, extra)}
<p class="ws__back"><a class="text-link" href="${e(href(vm, "/website"))}"><span aria-hidden="true">←</span> Back to Website</a></p>`;
}

/* ------------------------------------------------------------------ website requests (the existing support workflow, linked to a website) */

const KINDS = Object.freeze({
  change: { category: "website_change", title: "Request a change", lead: "Tell us what you would like changed on your website. Add screenshots or files if they help.", send: "Send request", label: "What would you like changed?" },
  support: { category: "technical_issue", title: "Get support", lead: "Tell us what isn’t working, or what you need help with. Screenshots help.", send: "Send request", label: "What’s happening?" },
});
export const kindOf = (k) => (Object.prototype.hasOwnProperty.call(KINDS, k) ? k : null);
export const categoryOfKind = (k) => KINDS[k].category;
const TRAIL = [["Website", "/website"], ["Requests", "/website/requests"]];
export const WEBSITE_REQUEST_ROOT = "/website/requests";
export const WEBSITE_REQUEST_TRAIL = TRAIL;

/** The form for a new change or support request about one website. */
export function requestForm(vm, site, kind, { values = {}, error = "", csrf = "" } = {}) {
  const k = KINDS[kind];
  const banner = error ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(SUPPORT_ERRORS[error] || "That request couldn’t be sent. Please check it and try again.")}</p>` : "";
  return `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], [site.name, `/website/${site.id}`], [k.title]])}<h1 class="h1 h1--section">${e(k.title)}</h1><p class="lead">${e(k.lead)}</p><p class="muted">About: ${e(site.name)}</p></header>${kind === "change" ? notice() : ""}${banner}
<form class="req-form" method="post" action="${e(href(vm, `/website/${site.id}/requests`))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="kind" value="${e(kind)}">
<div class="questions"><div class="field"><label for="rq-title">Title</label><input id="rq-title" name="title" type="text" maxlength="120" value="${e(values.title || "")}" required></div>
<div class="field"><label for="rq-desc">${e(k.label)}</label><span class="field__hint" id="rq-desc-h">Say where it is, what you see, and what you would like instead.</span><textarea id="rq-desc" name="description" rows="7" maxlength="${MAX_BODY}" aria-describedby="rq-desc-h" required>${e(values.description || "")}</textarea></div>
<div class="field"><label for="rq-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="rq-files-h">Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1048576} MB each: images, PDF, text, Word, Excel, PowerPoint or ZIP.</span><input id="rq-files" name="file" type="file" multiple aria-describedby="rq-files-h"></div></div>
<p class="step-nav"><button class="btn btn--primary" type="submit">${e(k.send)}</button> <a class="btn" href="${e(href(vm, `/website/${site.id}`))}">Cancel</a></p></form>`;
}

/** Every request linked to a website, newest activity first, with its status. */
export function requestsList(vm, items) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], ["Requests"]])}<h1 class="h1 h1--section">Website requests</h1><p class="lead">Changes and support requests about your website, and where each one stands.</p></header>`;
  const rows = items.map((r) => `<li><a class="req-row" href="${e(href(vm, `${WEBSITE_REQUEST_ROOT}/${r.id}`))}"><span class="req-row__main"><span class="req-row__title">${e(r.title)}${r.unreadForClient ? ' <span class="req-new">New reply</span>' : ""}</span><span class="muted small">${e(CATEGORY_LABEL[r.category] || "")} · ${e(r.websiteName)} · Updated ${e(when(r.lastMessageAt))}</span></span>${statusTag(r.status)}<span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("");
  return `${head}${items.length ? `<ul class="req-list">${rows}</ul>` : `<div class="empty"><strong>No requests yet</strong>Ask for a change or get support from your website’s page. We’ll reply here.</div>`}<p class="ws__back"><a class="text-link" href="${e(href(vm, "/website"))}"><span aria-hidden="true">←</span> Back to Website</a></p>`;
}

/* ------------------------------------------------------------------ SEO & Search Visibility (a subsection of one website) */

const ITEM_MARK = { done: "Done", in_progress: "In progress", todo: "To do" };
const PRIORITY_LABEL = { high: "High priority", medium: "Medium priority", low: "Low priority" };
const num = (n) => (Number.isInteger(n) ? n.toLocaleString("en-CA") : "");
const period = (m) => (m.periodStart === m.periodEnd ? day(m.periodStart) : `${day(m.periodStart)} to ${day(m.periodEnd)}`);

/**
 * /website/:id/seo. Everything here was written by Framework and published for this website; nothing is fetched from Google or anywhere else. The figures say so, and say they are entered by
 * hand, so they are never mistaken for a live connection (a future Search Console import would fill the same figures; none exists).
 */
export function seoPage(vm, site, seo) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Website", "/website"], [site.name, `/website/${site.id}`], ["SEO & Search Visibility"]])}<h1 class="h1 h1--section">SEO &amp; Search Visibility</h1><p class="lead">How ${e(site.name)} shows up in search, what has been done, and what to do next.</p></header>`;
  const tone = seo.status === "not_started" ? "idle" : seo.status === "in_progress" ? "active" : "live";
  const status = `<section class="ws-sec" aria-labelledby="seo-status-h"><h2 class="h2" id="seo-status-h">Status</h2><p class="ws__badges"><span class="status status--${tone}">${e(SEO_STATUS_LABEL[seo.status] || "")}</span></p>${seo.summary ? `<p class="ws-sec__lead">${e(seo.summary)}</p>` : ""}</section>`;
  const done = seo.checklist.filter((i) => i.status === "done").length;
  const row = (i) => `<li class="seo-item is-${e(i.status)}"><span class="seo-item__mark" aria-hidden="true"></span><span class="seo-item__body"><span class="seo-item__title">${e(i.title)}</span>${i.detail ? `<span class="seo-item__detail muted small">${e(i.detail)}</span>` : ""}</span><span class="seo-item__meta small"><span class="visually-hidden">Status: </span>${e(ITEM_MARK[i.status] || "")}</span></li>`;
  const checklist = `<section class="ws-sec" aria-labelledby="seo-check-h"><h2 class="h2" id="seo-check-h">Checklist</h2>${seo.checklist.length ? `<p class="muted small">${e(`${done} of ${seo.checklist.length} complete`)}</p><ul class="seo-items">${seo.checklist.map(row).join("")}</ul>` : `<p class="muted">Framework hasn’t added a checklist for this website yet.</p>`}</section>`;
  const order = { high: 0, medium: 1, low: 2 };
  const recs = seo.recommendations.slice().sort((a, b) => (a.status === "done") - (b.status === "done") || (order[a.priority] ?? 3) - (order[b.priority] ?? 3));
  const rec = (i) => `<li class="seo-item is-${e(i.status)}"><span class="seo-item__mark" aria-hidden="true"></span><span class="seo-item__body"><span class="seo-item__title">${e(i.title)}</span>${i.detail ? `<span class="seo-item__detail muted small">${e(i.detail)}</span>` : ""}</span><span class="seo-item__meta small">${i.priority && i.status !== "done" ? `${e(PRIORITY_LABEL[i.priority])} · ` : ""}<span class="visually-hidden">Status: </span>${e(ITEM_MARK[i.status] || "")}</span></li>`;
  const recommendations = `<section class="ws-sec" aria-labelledby="seo-rec-h"><h2 class="h2" id="seo-rec-h">Recommendations</h2>${recs.length ? `<ul class="seo-items">${recs.map(rec).join("")}</ul>` : `<p class="muted">No recommendations right now.</p>`}</section>`;
  const latest = seo.metrics[0];
  const stat = (label, value) => (value === "" ? "" : `<div><dt>${e(label)}</dt><dd>${e(value)}</dd></div>`);
  const figures = latest
    ? `<p class="muted small">${e(period(latest))}</p><dl class="seo-stats">${stat("Impressions", num(latest.impressions))}${stat("Clicks", num(latest.clicks))}${stat("Average position", latest.position == null ? "" : String(latest.position))}${stat("Pages in search", num(latest.indexedPages))}</dl>${latest.note ? `<p class="muted small">${e(latest.note)}</p>` : ""}`
    : `<p class="muted">Search figures haven’t been added yet.</p>`;
  const older = seo.metrics.slice(1, 7);
  const table = older.length ? `<div class="seo-table" role="region" aria-label="Earlier periods" tabindex="0"><table><thead><tr><th scope="col">Period</th><th scope="col">Impressions</th><th scope="col">Clicks</th><th scope="col">Avg. position</th><th scope="col">Pages in search</th></tr></thead><tbody>${older.map((m) => `<tr><th scope="row">${e(period(m))}</th><td>${e(num(m.impressions))}</td><td>${e(num(m.clicks))}</td><td>${m.position == null ? "" : e(String(m.position))}</td><td>${e(num(m.indexedPages))}</td></tr>`).join("")}</tbody></table></div>` : "";
  const visibility = `<section class="ws-sec" aria-labelledby="seo-vis-h"><h2 class="h2" id="seo-vis-h">Search visibility</h2>${figures}${table}<p class="muted small">These figures are collected and entered by Framework, and updated periodically. They are not a live feed.</p></section>`;
  const rep = (r) => `<li class="seo-report"><span class="seo-report__title">${e(r.title)}</span>${r.period ? `<span class="muted small"> · ${e(r.period)}</span>` : ""}${r.summary ? `<span class="seo-report__text muted">${e(r.summary)}</span>` : ""}${r.link ? `<a class="text-link" href="${e(r.link)}" target="_blank" rel="noopener noreferrer">Open the full report<span class="visually-hidden"> (${e(r.title)}, opens in a new tab)</span></a>` : ""}</li>`;
  const reports = `<section class="ws-sec" aria-labelledby="seo-rep-h"><h2 class="h2" id="seo-rep-h">Reports</h2>${seo.reports.length ? `<ul class="seo-reports">${seo.reports.map(rep).join("")}</ul>` : `<p class="muted">No reports yet. Framework will add them here.</p>`}</section>`;
  return `${head}${status}${checklist}${recommendations}${visibility}${reports}<p class="ws__back"><a class="text-link" href="${e(href(vm, `/website/${site.id}`))}"><span aria-hidden="true">←</span> Back to ${e(site.name)}</a></p>`;
}
