/**
 * The guided client workspace (demonstration): Home, the six areas, questionnaires, prerequisites and service-request previews. Pure string
 * rendering from guided-data.js; no request, database, environment or storage access. Every control is either a link or a native input that
 * is NOT inside a form, so nothing can be submitted, and every page says so. There is no script and no inline style (the portal CSP forbids both).
 */
import { e, status, meter, fmtDay, relative } from "./ui.js";
import { welcomeFor } from "./welcome.js";
import { WORKSPACE_ROWS, rowState, rowProgress, AREAS, SERVICE_AREAS, projectsFor, categoriesOf, PROFILE_STEPS, WORKSPACES, BRAND_PATHS, UPLOAD_SLOTS, DISCOVERY, SERVICES, serviceById, serviceReadiness, progressSummary, profileDone, workspaceDone } from "./guided-data.js";

const NOTE = "Demonstration only. Nothing you type or choose here is saved, uploaded or sent.";
const COMMERCIAL = "Requests are subject to Framework’s review, scoping and quotation. Sending a request does not authorise any paid work: you will receive a proposal to approve or decline first.";

const href = (vm, path) => `${vm.base}${path}`;
const area = (key) => AREAS.find((a) => a.key === key);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

const STATE = { done: ["done", "Complete"], current: ["active", "In progress"], todo: ["idle", "Not started"] };
const chip = (state) => `<span class="status status--${STATE[state][0]}">${STATE[state][1]}</span>`;
const head = (title, aside = "") => `<div class="section__head"><h2 class="section__title">${e(title)}</h2>${aside ? `<span class="section__aside">${aside}</span>` : ""}</div>`;
const note = (text = NOTE) => `<p class="demo-note" role="note"><span class="tag tag--ink">Demo</span> ${e(text)}</p>`;
const inert = (label, small = true) => `<span class="btn${small ? " btn--small" : ""}" aria-disabled="true">${e(label)}</span>`;
const crumb = (vm, trail) => `<p class="crumb"><a href="${e(vm.base)}">Home</a>${trail.map(([label, p]) => ` / ${p ? `<a href="${e(href(vm, p))}">${e(label)}</a>` : e(label)}`).join("")}</p>`;
const pageHead = (eyebrow, title, lead = "") => `<span class="eyebrow">${e(eyebrow)}</span><h1 class="h1">${e(title)}</h1>${lead ? `<p class="lead">${e(lead)}</p>` : ""}`;

/* ------------------------------------------------------------------ fields (inert) */

function field(scope, fd) {
  const id = `${scope}-${fd.id}`, hint = fd.hint ? `<span class="field__hint" id="${id}-h">${e(fd.hint)}</span>` : "", desc = fd.hint ? ` aria-describedby="${id}-h"` : "";
  if (fd.kind === "multi") return `<fieldset class="field choice"><legend>${e(fd.label)}</legend>${hint}${(fd.options || []).map((o, i) => `<label class="choice__opt"><input type="checkbox" name="${e(id)}-${i}" value="${e(o)}"> <span>${e(o)}</span></label>`).join("")}</fieldset>`;
  if (fd.kind === "choice") return `<fieldset class="field choice"><legend>${e(fd.label)}</legend>${(fd.options || []).map((o, i) => `<label class="choice__opt"><input type="radio" name="${e(id)}" value="${e(o)}"${o === fd.value ? " checked" : ""}> <span>${e(o)}</span></label>`).join("")}</fieldset>`;
  const label = `<label for="${e(id)}">${e(fd.label)}</label>${hint}`;
  if (fd.kind === "textarea") return `<div class="field">${label}<textarea id="${e(id)}" rows="4"${desc} placeholder="${e(fd.placeholder || "")}">${e(fd.value)}</textarea></div>`;
  if (fd.kind === "select") return `<div class="field">${label}<select id="${e(id)}"${desc}><option value="">Choose…</option>${(fd.options || []).map((o) => `<option${o === fd.value ? " selected" : ""}>${e(o)}</option>`).join("")}</select></div>`;
  if (fd.kind === "website") return `<div class="field">${label}<input id="${e(id)}" type="text" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" value="${e(fd.value)}" placeholder="${e(fd.placeholder || "")}"${desc} autocomplete="url"></div>`;
  return `<div class="field">${label}<input id="${e(id)}" type="${e(fd.kind)}" value="${e(fd.value)}" placeholder="${e(fd.placeholder || "")}"${desc} autocomplete="off"></div>`;
}

/* ------------------------------------------------------------------ return-to-request context */

/** A service request the client came from, carried as ?from=<id> so a questionnaire can offer a way back. */
const q = (from) => (from ? `?from=${from.id}` : "");
const backLink = (vm, from) => (from ? `<p class="backlink"><a class="text-link" href="${e(href(vm, `/requests/${from.id}`))}"><span aria-hidden="true">←</span> Back to request: ${e(from.title)}</a></p>` : "");

/* ------------------------------------------------------------------ home */

const HOME_BLURB = { profile: "Your business, customers and goals", branding: "Logos, colours, fonts and brand guidelines", website: "Plan or improve your site", marketing: "Goals, audience and channels", content: "Photos, video and creative", files: "Shared files and approvals" };

/**
 * The home screen is a navigation hub: a short greeting and the six areas. Progress and status live inside each area.
 * Signed-in clients (vm.liveAreas) get a link only for sections that are built; the others are plain, muted list items that say "Coming soon" and
 * are not links, so nothing suggests they can be opened. The demo (no vm.liveAreas) links every section.
 */
/**
 * The progress and required-action block of a live module's tile (shared by every module: see module-status.js for the contract).
 * Text carries the meaning (the percentage and "Action required" are words); the bar and the red dot are decorative and hidden from assistive technology.
 * An unavailable status says so and shows no percentage and no indicator, so a failed read is never mistaken for "0% complete".
 */
export function tileStatus(s) {
  if (!s || typeof s !== "object") return "";
  if (s.state === "unavailable") return `<div class="tile__status"><p class="tile__pct tile__pct--muted">Progress unavailable right now</p></div>`;
  if (s.state !== "ready" || !Number.isInteger(s.percent) || s.percent < 0 || s.percent > 100) return "";
  // The same words as the Business Profile overview: REQUIRED work is counted ("3 required answers left"); once it is done the tile says so and
  // optional questions are never described as outstanding work.
  const left = Number.isInteger(s.requiredRemaining) ? s.requiredRemaining : 0;
  const note = s.actionRequired
    ? `<p class="tile__action"><span class="dot dot--attention" aria-hidden="true"></span>${left > 0 ? `${left} required ${left === 1 ? "answer" : "answers"} left` : "Required answers left"}</p>`
    : s.complete
      ? ""
      : `<p class="tile__note">All required answers are complete</p>`;
  return `<div class="tile__status"><progress class="meter" max="100" value="${s.percent}" aria-hidden="true">${s.percent}%</progress><p class="tile__pct">${s.percent}% complete</p>${note}</div>`;
}

/** The Branding card's status: whether a brand system is published, and how many files the client has shared. Words carry the meaning; the square is decoration. */
export function brandStatus(b) {
  if (!b || b.state === "unavailable") return b ? `<div class="tile__status"><p class="tile__pct tile__pct--muted">Status unavailable right now</p></div>` : "";
  const shared = b.uploads > 0 ? `<p class="tile__note">${plural(b.uploads, "file")} shared with Framework</p>` : "";
  return b.state === "published"
    ? `<div class="tile__status"><p class="tile__pct"><span class="status status--live">Brand system published</span></p>${shared}</div>`
    : `<div class="tile__status"><p class="tile__pct"><span class="status status--idle">Not published yet</span></p>${shared || `<p class="tile__note">Upload your existing brand materials</p>`}</div>`;
}

export function home(vm) {
  const isLive = (key) => !vm.liveAreas || vm.liveAreas.includes(key);
  if (!vm.liveAreas) {
    // the demonstration: every section is a link, as before
    const tiles = AREAS.map((a) => `<li><a class="tile" href="${e(href(vm, a.path))}"><span class="tile__n" aria-hidden="true">${e(a.n)}</span><span class="tile__title">${e(a.title)}</span><span class="tile__desc">${e(HOME_BLURB[a.key])}</span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("");
    return `<header class="page-head page-head--home"><h1 class="h1 h1--home">${e(welcomeFor(vm))}</h1><p class="lead">What would you like to work on?</p></header>
<nav aria-label="Your workspace"><ul class="tiles">${tiles}</ul></nav>`;
  }
  // The signed-in home: a short greeting and one card per built section. Each card is one link (title, short description, status, arrow). Sections that are
  // not built yet are a single quiet line, never a card, so nothing suggests they can be opened.
  const card = (a) => {
    const st = a.key === "branding" ? brandStatus(vm.brand) : vm.moduleStatus ? tileStatus(vm.moduleStatus[a.key]) : "";
    return `<li><a class="hub" href="${e(href(vm, a.path))}"><span class="hub__top"><span class="hub__title">${e(a.title)}</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span><span class="hub__desc">${e(HOME_BLURB[a.key])}</span>${st ? `<span class="hub__status">${st}</span>` : ""}</a></li>`;
  };
  const servicesCard = vm.services
    ? `<li><a class="hub" href="${e(href(vm, "/services"))}"><span class="hub__top"><span class="hub__title">Client Services</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span><span class="hub__desc">Invoices, support requests and how to reach us</span>${vm.servicesStatus ? `<span class="hub__status">${vm.servicesStatus}</span>` : ""}</a></li>`
    : "";
  const active = AREAS.filter((a) => isLive(a.key)).map(card).join("") + servicesCard;
  const soon = AREAS.filter((a) => !isLive(a.key));
  return `<header class="page-head page-head--home">${vm.org && vm.org.name ? `<span class="eyebrow">${e(vm.org.name)}</span>` : ""}<h1 class="h1 h1--home">${e(welcomeFor(vm))}</h1></header>
<nav aria-label="Your workspace"><ul class="hubs">${active}</ul></nav>
${soon.length ? `<p class="soon-line"><span class="soon-line__label">Coming soon</span> ${soon.map((a) => e(a.title)).join(" · ")}</p>` : ""}`;
}

/* ------------------------------------------------------------------ standard workspace overview (shared) */

/** One navigation row: number, short title, optional plain-text status, arrow. Rows are hairline-divided, never boxed; the arrow is always present. */
function navRow(vm, n, r) {
  const label = r.state === "done" ? "Complete" : r.state === "current" ? `In progress${r.status ? ` · ${r.status}` : ""}` : r.status || "";
  const st = label ? `<span class="rowstat${r.attention ? " rowstat--attention" : ""}">${e(label)}</span>` : "";
  const sr = r.state === "todo" ? '<span class="visually-hidden">, not started</span>' : "";
  return `<li><a class="row row--step" href="${e(href(vm, r.href))}"><span class="step__n" aria-hidden="true">${String(n).padStart(2, "0")}</span><span class="row__name">${e(r.title)}${sr}</span><span class="row__st">${st}</span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`;
}
/** The standard workspace overview: breadcrumb, title, one progress indicator when meaningful, rows. */
function overview(vm, { key, title, progress, action = "", rows }) {
  const a = area(key);
  return `<header class="page-head page-head--compact">${crumb(vm, [[title || a.title]])}<h1 class="h1 h1--section">${e(title || a.title)}</h1></header>
${progress ? `<div class="progress-line">${meter(Math.round((progress.done / progress.total) * 100), `${title || a.title} progress`)}<p class="muted small">${e(`${progress.done} of ${progress.total} ${progress.noun || "areas"} complete`)}</p></div>` : ""}${action}
<nav aria-label="${e(title || a.title)}"><ol class="rows rows--plain rows--nav">${rows.map((r, i) => navRow(vm, i + 1, r)).join("")}</ol></nav>`;
}
/** Back navigation + breadcrumb for a detail page under an area. */
const detailHead = (vm, key, title, extra = []) => `<header class="page-head page-head--compact">${crumb(vm, [[area(key).title, area(key).path], ...extra, [title]])}<h1 class="h1 h1--section">${e(title)}</h1></header>`;

/* ------------------------------------------------------------------ business profile */

export function profile(vm) {
  const done = profileDone(), total = PROFILE_STEPS.length;
  return overview(vm, { key: "profile", progress: { done, total, noun: "steps" }, rows: PROFILE_STEPS.map((st) => ({ title: st.title, href: `/profile/${st.id}`, state: st.state })) });
}

export function profileStep(vm, step, from = null) {
  const i = PROFILE_STEPS.indexOf(step), total = PROFILE_STEPS.length;
  const prev = PROFILE_STEPS[i - 1], next = PROFILE_STEPS[i + 1];
  return `<header class="page-head">${crumb(vm, [["Business Profile", "/profile"], [step.title]])}${pageHead(`Step ${i + 1} of ${total}`, step.title, step.intro)}</header>
${backLink(vm, from)}<nav class="stepper" aria-label="Business Profile steps"><ol>${PROFILE_STEPS.map((s, n) => `<li class="is-${s.state}"><a href="${e(href(vm, `/profile/${s.id}${q(from)}`))}"${s === step ? ' aria-current="step"' : ""}><span class="visually-hidden">Step ${n + 1}: ${e(s.title)}, ${e(STATE[s.state][1])}</span><span aria-hidden="true">${n + 1}</span></a></li>`).join("")}</ol></nav>
${note()}
<div class="questions">${step.fields.map((fd) => field(`p-${step.id}`, fd)).join("")}</div>
<div class="step-nav">${prev ? `<a class="btn" href="${e(href(vm, `/profile/${prev.id}${q(from)}`))}"><span aria-hidden="true">←</span> Previous</a>` : `<a class="btn" href="${e(href(vm, `/profile${q(from)}`))}"><span aria-hidden="true">←</span> All steps</a>`}${inert("Save (not available in the demo)", false)}${next ? `<a class="btn btn--primary" href="${e(href(vm, `/profile/${next.id}${q(from)}`))}">Next <span aria-hidden="true">→</span></a>` : `<a class="btn btn--primary" href="${e(href(vm, `/profile${q(from)}`))}">Back to your steps</a>`}</div>`;
}

/* ------------------------------------------------------------------ projects inside a service workspace */

const isActive = (p) => !["live", "maintenance", "archived"].includes(p.status);

/** "Part of: Website · Content & Photography". A project can belong to several services, so no single parent is assumed. */
export function partOf(vm, p) {
  const cats = categoriesOf(p);
  return cats.length ? `Part of: ${cats.map((k) => `<a href="${e(href(vm, area(k).path))}">${e(area(k).title)}</a>`).join(" · ")}` : "";
}

function projectItem(vm, key, p) {
  const act = isActive(p);
  return `<li class="proj"><div class="proj__top"><h3 class="proj__name">${e(p.name)}</h3>${act ? status(p.status) : '<span class="status status--done">Completed</span>'}</div><p class="muted proj__desc">${e(p.summary)}</p>${act && vm.has.progress ? `<div class="proj__meter">${meter(p.progress, `${p.name} progress`)}</div>` : ""}<a class="text-link proj__go" href="${e(href(vm, `/${key}/projects/${p.id}`))}">View project <span aria-hidden="true">→</span><span class="visually-hidden">: ${e(p.name)}</span></a></li>`;
}

/** The projects page of one service: active, then completed, or a useful empty state. */
export function projectsPage(vm, key) {
  const list = projectsFor(vm.projects, key), act = list.filter(isActive), done = list.filter((p) => !isActive(p));
  const sec = (id, heading, items) => `<section class="section" aria-labelledby="h-${id}">${head(heading)}<h2 id="h-${id}" class="visually-hidden">${e(heading)}</h2><ul class="projs">${items.map((p) => projectItem(vm, key, p)).join("")}</ul></section>`;
  const body = list.length ? (act.length ? sec("active", "Active", act) : "") + (done.length ? sec("done", "Completed", done) : "") : `<div class="empty"><strong>No ${e(area(key).title)} projects yet</strong>A project appears here once Framework has reviewed, scoped and agreed a service with you.<p><a class="text-link" href="${e(href(vm, `/${key}/requests`))}">Request a service</a></p></div>`;
  return `${detailHead(vm, key, "Projects")}${body}`;
}

const projectsRow = (vm, key) => { const list = projectsFor(vm.projects, key), n = list.filter(isActive).length; return { title: "Projects", href: `/${key}/projects`, status: list.length ? (n ? `${n} active` : "Completed") : "None yet" }; };
const requestsRow = (key) => ({ title: "Request a service", href: `/${key}/requests` });

/** Every service request for one area. The request flow itself carries the prerequisites and the quotation terms. */
export function requestsPage(vm, key) {
  const items = SERVICES.filter((s) => s.area === key);
  return `${detailHead(vm, key, "Request a service")}<p class="notice-line">${e(COMMERCIAL)}</p><ul class="rows rows--plain rows--nav">${items.map((s) => { const { missing } = serviceReadiness(s); return `<li><a class="row row--step row--plainstep" href="${e(href(vm, `/requests/${s.id}`))}"><span class="row__name">${e(s.title)}</span><span class="row__st"><span class="rowstat">${e(missing.length ? `Needs ${plural(missing.length, "thing")}` : "Ready")}</span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`; }).join("")}</ul>`;
}

/* ------------------------------------------------------------------ branding */

const BRAND_ROWS = [["Existing brand assets", "/branding/existing"], ["Logo and identity", "/branding/logo"], ["Brand guidelines", "/branding/guidelines"], ["Brand discovery", "/branding/discovery"]];

export function brandingOverview(vm) {
  return overview(vm, { key: "branding", rows: [...BRAND_ROWS.map(([title, h]) => ({ title, href: h })), projectsRow(vm, "branding"), requestsRow("branding")] });
}

export function branding(vm, pathId, from = null) {
  const sel = BRAND_PATHS.find((p) => p.id === pathId);
  const chooser = `<nav class="choices" aria-label="Branding path"><ul>${BRAND_PATHS.map((p) => `<li><a href="${e(href(vm, `/branding/${p.id}${q(from)}`))}"${p === sel ? ' aria-current="true"' : ""}><span class="choices__t">${e(p.title)}</span><span class="choices__d">${e(p.blurb)}</span></a></li>`).join("")}</ul></nav>`;
  let body;
  if (sel.id === "existing") {
    body = `<section class="section" aria-labelledby="h-up">${head("Share your brand assets")}<h2 id="h-up" class="visually-hidden">Share your brand assets</h2>${note("Demonstration only. No files can be uploaded, and nothing is stored.")}<ul class="uploads">${UPLOAD_SLOTS.map((u) => `<li class="upload"><span><strong class="row__name">${e(u.title)}</strong><span class="row__meta">${e(u.hint)}</span></span>${inert("Choose files (not available in the demo)")}</li>`).join("")}</ul></section>`;
  } else {
    const svc = serviceById(sel.service);
    body = `<section class="section" aria-labelledby="h-disc">${head("What we will ask you for")}<h2 id="h-disc" class="visually-hidden">What we will ask you for</h2><p class="muted">Brand discovery helps Framework understand the business before any design starts.</p><ul class="bullets">${DISCOVERY.map((d) => `<li>${e(d)}</li>`).join("")}</ul></section>
<section class="section" aria-labelledby="h-go">${head("Next step")}<h2 id="h-go" class="visually-hidden">Next step</h2><p class="muted">${e(COMMERCIAL)}</p><p><a class="btn btn--primary" href="${e(href(vm, `/requests/${svc.id}`))}">Preview the request <span aria-hidden="true">→</span></a></p></section>`;
  }
  return `${detailHead(vm, "branding", sel.id === "existing" ? "Existing brand assets" : sel.id === "logo" ? "Logo and identity" : sel.id === "guidelines" ? "Brand guidelines" : "Complete brand identity")}${backLink(vm, from)}${chooser}${body}`;
}

/** Brand discovery: the information Framework asks for before any new brand work. Fields are inert. */
export function brandDiscovery(vm, from = null) {
  return `${detailHead(vm, "branding", "Brand discovery")}${backLink(vm, from)}${note()}<div class="questions">${DISCOVERY.map((d, i) => field("bd", { id: String(i), label: d, kind: "textarea", value: "" })).join("")}</div><div class="step-nav"><a class="btn" href="${e(href(vm, "/branding"))}"><span aria-hidden="true">←</span> Back to Branding</a>${inert("Save (not available in the demo)", false)}</div>`;
}

/* ------------------------------------------------------------------ website / marketing / content */

export function workspace(vm, key) {
  const rows = WORKSPACE_ROWS[key].map((r) => ({ title: r.title, href: `/${key}/${r.id}`, state: rowState(key, r) }));
  return overview(vm, { key, progress: { ...rowProgress(key), noun: "areas" }, rows: [...rows, projectsRow(vm, key), requestsRow(key)] });
}

const who = (key, t) => `<fieldset class="field choice"><legend>Who will provide this?</legend><label class="choice__opt"><input type="radio" name="${e(`${key}-${t.id}-who`)}" value="client"${t.helpWith === "client" ? " checked" : ""}> <span>I will provide it</span></label><label class="choice__opt"><input type="radio" name="${e(`${key}-${t.id}-who`)}" value="framework"${t.helpWith === "framework" ? " checked" : ""}> <span>I would like Framework’s help</span></label></fieldset>`;

/** One row of a workspace: its questions, with Previous / Next through the questionnaire rows. */
export function workspaceRow(vm, key, row, from = null) {
  const rows = WORKSPACE_ROWS[key], i = rows.indexOf(row), prev = rows[i - 1], next = rows[i + 1], topics = row.topics.map((id) => WORKSPACES[key].topics.find((t) => t.id === id));
  const body = topics.map((t) => `<section class="qgroup">${topics.length > 1 ? `<h2 class="qgroup__title">${e(t.title)}</h2>` : ""}<div class="questions">${t.fields.map((fd) => field(`${key}-${t.id}`, fd)).join("")}</div>${who(key, t)}</section>`).join("");
  return `${detailHead(vm, key, row.title)}${backLink(vm, from)}${note()}${body}
<div class="step-nav">${prev ? `<a class="btn" href="${e(href(vm, `/${key}/${prev.id}${q(from)}`))}"><span aria-hidden="true">←</span> Previous</a>` : `<a class="btn" href="${e(href(vm, `/${key}`))}"><span aria-hidden="true">←</span> Back</a>`}${inert("Save (not available in the demo)", false)}${next ? `<a class="btn btn--primary" href="${e(href(vm, `/${key}/${next.id}${q(from)}`))}">Next <span aria-hidden="true">→</span></a>` : `<a class="btn btn--primary" href="${e(href(vm, `/${key}`))}">Back to ${e(area(key).title)}</a>`}</div>`;
}

/* ------------------------------------------------------------------ files & deliverables */

const docRow = (vm, d) => `<li><a class="row row--service" href="${e(href(vm, `/documents${d.projectId ? `?project=${d.projectId}` : ""}`))}"><span><strong class="row__name">${e(d.name)}</strong><span class="row__meta">${e(d.ext.toUpperCase())} · ${e(d.size)} · added ${e(relative(d.at, vm.now))}</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`;
const delivRow = (vm, p, d, tag) => `<li><a class="row row--service" href="${e(href(vm, `/projects/${p.id}/deliverables/${d.id}`))}"><span><strong class="row__name">${e(d.name)}</strong><span class="row__meta">${e(p.name)} · ${e(d.state === "delivered" ? "delivered" : "due")} ${e(fmtDay(d.due, vm.now))}</span></span>${tag}<span class="tile__arrow" aria-hidden="true">→</span></a></li>`;
const inReview = (vm) => vm.projects.flatMap((p) => (p.deliverables || []).filter((d) => d.state === "review" && d.id).map((d) => ({ p, d })));
const delivered = (vm) => vm.projects.flatMap((p) => (p.deliverables || []).filter((d) => d.state === "delivered" && d.id).map((d) => ({ p, d }))).sort((x, y) => (x.d.due < y.d.due ? 1 : -1));
const OLD_DAYS = 30;
const historical = (vm) => vm.documents.filter((d) => vm.now.getTime() - new Date(d.at).getTime() > OLD_DAYS * 86400000).sort((x, y) => (x.at < y.at ? 1 : -1));

/** Files & Deliverables is a library, not an onboarding area: same visual language, no progress indicator. */
export function filesOverview(vm) {
  const n = inReview(vm).length;
  return overview(vm, { key: "files", rows: [
    { title: "Waiting for your review", href: "/files/review", status: n ? String(n) : "", attention: true },
    { title: "Shared documents", href: "/documents" },
    { title: "Completed deliverables", href: "/files/completed" },
    { title: "Project files", href: "/files/projects" },
    { title: "Historical documents", href: "/files/history" },
    { title: "Project overview", href: "/progress" },
  ] });
}
const filesPage = (vm, title, body) => `<header class="page-head page-head--compact">${crumb(vm, [["Files & Deliverables", "/files"], [title]])}<h1 class="h1 h1--section">${e(title)}</h1></header>${body}`;
const emptyList = (text) => `<div class="empty"><strong>${e(text)}</strong></div>`;
export function filesReview(vm) { const r = inReview(vm); return filesPage(vm, "Waiting for your review", r.length ? `<ul class="rows">${r.map(({ p, d }) => delivRow(vm, p, d, '<span class="status status--attention">In review</span>')).join("")}</ul>` : emptyList("Nothing is waiting for your review.")); }
export function filesCompleted(vm) { const r = delivered(vm); return filesPage(vm, "Completed deliverables", r.length ? `<ul class="rows">${r.map(({ p, d }) => delivRow(vm, p, d, '<span class="status status--done">Delivered</span>')).join("")}</ul>` : emptyList("No deliverables have been completed yet.")); }
export function filesProjects(vm) { return filesPage(vm, "Project files", `<ul class="rows">${vm.projects.map((p) => { const n = vm.documents.filter((d) => d.projectId === p.id).length; return `<li><a class="row row--service" href="${e(href(vm, `/documents?project=${p.id}`))}"><span><strong class="row__name">${e(p.name)}</strong><span class="row__meta">${e(plural(n, "document"))}</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`; }).join("")}</ul>`); }
export function filesHistory(vm) { const r = historical(vm); return filesPage(vm, "Historical documents", r.length ? `<ul class="rows">${r.map((d) => docRow(vm, d)).join("")}</ul>` : emptyList("No older documents.")); }

/* ------------------------------------------------------------------ service request (preview) */

const reqLink = (vm, r, service) => href(vm, `${r.href}?from=${service.id}`);

/** One missing requirement: the section it belongs to, what is unanswered, and a direct link to the questionnaire. */
function reqRow(vm, r, service, optional) {
  const tone = optional ? "req--optional" : "req--missing";
  if (r.anyOf) return `<li class="req ${tone}"><span class="req__mark" aria-hidden="true"></span><span class="req__body"><span class="req__title">${e(r.label)}</span><span class="req__detail">${e(r.detail)}: ${r.anyOf.map((o) => `<a class="text-link" href="${e(reqLink(vm, o, service))}">${e(o.label)}</a>`).join(" or ")}</span></span></li>`;
  return `<li><a class="req ${tone}" href="${e(reqLink(vm, r, service))}"><span class="req__mark" aria-hidden="true"></span><span class="req__body"><span class="req__title">${e(r.label)}</span><span class="req__detail">${e(r.section)} · ${e(r.detail)}</span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`;
}

/**
 * A service request preview. Required requirements that are not met are shown prominently and block the (disabled, demonstration-only) submit;
 * optional ones never block. Met requirements are collapsed into one summary line.
 */
export function request(vm, service) {
  const a = area(service.area), { reqs, missing, optional, optionalMissing } = serviceReadiness(service);
  const met = [...reqs, ...optional].filter((r) => r.met);
  const blocked = missing.length > 0;
  const checklist = blocked
    ? `<section class="section" aria-labelledby="h-miss">${head("Needed before you request", `${missing.length} of ${reqs.length}`)}<h2 id="h-miss" class="visually-hidden">Needed before you request</h2><ul class="reqs">${missing.map((r) => reqRow(vm, r, service, false)).join("")}</ul><p class="muted small">Only what this request needs is listed. ${e("Demonstration only: answers are not saved, so these stay open.")}</p></section>`
    : `<p class="req-ok"><span class="rowstat">Complete</span> Everything this request needs is in place.</p>`;
  const optionalHtml = optionalMissing.length ? `<section class="section" aria-labelledby="h-opt">${head("Helpful to add")}<h2 id="h-opt" class="visually-hidden">Helpful to add</h2><p class="muted small">Optional. These improve the brief but never block your request.</p><ul class="reqs">${optionalMissing.map((r) => reqRow(vm, r, service, true)).join("")}</ul></section>` : "";
  const doneHtml = met.length ? `<details class="req-done"><summary>${e(plural(met.length, "item"))} already complete</summary><ul>${met.map((r) => `<li><span>${e(r.label)}</span><span class="rowstat">Complete</span></li>`).join("")}</ul></details>` : "";
  const form = blocked ? "" : `<section class="section" aria-labelledby="h-det">${head("Your request")}<h2 id="h-det" class="visually-hidden">Your request</h2><div class="questions"><div class="field"><label for="rq-notes">Anything we should know?</label><textarea id="rq-notes" rows="4" placeholder="Context, deadlines, examples you like."></textarea></div><div class="field"><label for="rq-when">Preferred timing</label><select id="rq-when"><option value="">Choose…</option><option>As soon as possible</option><option>Within the next month</option><option>In two to three months</option><option>Flexible</option></select></div></div></section>`;
  return `<header class="page-head page-head--compact">${crumb(vm, [[a.title, a.path], ["Request a service", `/${service.area}/requests`], [service.title]])}${pageHead(`Service request · ${a.title}`, service.title, service.blurb)}</header>
<p class="notice-line">${e(COMMERCIAL)}</p>
${note("Demonstration only. Requests cannot be submitted yet.")}
${checklist}${form}${optionalHtml}${doneHtml}
<p class="req-submit">${inert(blocked ? "Submit request (complete the required items first)" : "Submit request (not available in the demo)", false)}</p>`;
}

// Shared building blocks for the connected (authenticated) workspace pages, which use the same row layout as the demonstration.
export { overview, crumb };
