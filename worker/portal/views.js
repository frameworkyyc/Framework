/**
 * Portal page views. One set of renderers serves BOTH the connected portal (data from the database, scoped by the tenant guard) and the static
 * demo (worker/portal/demo-data.js). A view receives a plain view-model and returns the HTML of the page body; it never reads the request,
 * the environment or the database. Sections that have no backend yet are rendered only when the view-model says the capability exists
 * (`vm.has`), otherwise as an honest "not connected yet" block, so the live portal never pretends.
 *
 * view-model:
 *   mode      "live" | "demo"
 *   base      "/portal/o/<slug>" | "/portal/demo"
 *   now       Date
 *   org       { name, website, role, people }
 *   user      { name, email }
 *   projects  [{ id, name, kind, status, summary, liveUrl, updatedAt, progress, started, target, lead, milestones, deliverables, scope }]
 *   activity  [{ type, title, detail, at, projectId, projectName }]
 *   updates   [{ title, detail, at, projectId, tone }]       (demo only)
 *   actions   [{ text, due, who, projectId, done }]           (demo only)
 *   documents [{ id, name, ext, size, desc, projectId, category, at, version, isNew }]  (demo only)
 *   team      [{ name, email, role }]
 *   has       { progress, milestones, deliverables, documents, updates, actions, settings }
 */
import { e, status, statusLabel, stageTrack, meter, humanize, safeHttps, relative, fmtDay, fmtTime, dayHeading, dayKey, notConnected, empty } from "./ui.js";

const first = (user) => {
  const n = (user.name || "").trim().split(/\s+/)[0];
  return n || String(user.email || "").split("@")[0] || "there";
};
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const projectHref = (vm, id) => `${vm.base}/projects/${id}`;
const isActive = (p) => !["live", "maintenance", "archived"].includes(p.status);

export const ACTIVITY_TYPES = Object.freeze([["all", "All"], ["milestone", "Milestones"], ["update", "Updates"], ["document", "Documents"], ["review", "Reviews"]]);
const KIND = { milestone: "Milestone", update: "Update", document: "Document", review: "Review requested", system: "Account" };

export const roleLabel = (r) => (r === "owner" ? "Owner" : r === "member" ? "Member" : humanize(r));
/** A readable title for a stored action name such as "project.created". */
export const actionTitle = (a) => humanize(a);

/** Map a stored activity action (such as "project.created") to a display type. */
export function activityType(action) {
  const a = String(action || "");
  if (/milestone/.test(a)) return "milestone";
  if (/document|file/.test(a)) return "document";
  if (/review|feedback|approval|approve/.test(a)) return "review";
  if (/^(auth|user|member|org)\./.test(a)) return "system";
  return "update";
}

/* ------------------------------------------------------------------ pieces */

const sectionHead = (title, aside = "") => `<div class="section__head"><h2 class="section__title">${e(title)}</h2>${aside ? `<span class="section__aside">${aside}</span>` : ""}</div>`;

function projectRow(vm, p) {
  const third = vm.has.progress ? meter(p.progress, `${p.name} progress`) : `<span class="row__meta">${p.updatedAt ? `Updated ${e(relative(p.updatedAt, vm.now))}` : ""}</span>`;
  const next = vm.has.milestones && p.milestones ? p.milestones.find((m) => m.state !== "done") : null;
  const meta = [humanize(p.kind), p.lead && vm.has.milestones ? `Led by ${p.lead}` : ""].filter(Boolean).map(e).join(" · ");
  return `<li><a class="row row--project" href="${e(projectHref(vm, p.id))}"><span class="row__lead"><span class="row__title">${e(p.name)}</span><br><span class="row__meta">${meta}</span></span>
<span class="row__stage">${status(p.status)}${next ? `<br><span class="row__meta">Next: ${e(next.name)}${next.date ? ` · ${e(fmtDay(next.date, vm.now))}` : ""}</span>` : ""}</span>
<span class="row__progress">${third}</span>${p.summary ? `<span class="row__summary muted">${e(p.summary)}</span>` : ""}</a></li>`;
}

function projectList(vm, projects, { summaries = true } = {}) {
  if (!projects.length) return empty("No projects yet", "Projects Framework is working on with you will be listed here.");
  const rows = summaries ? projects : projects.map((p) => ({ ...p, summary: "" }));
  return `<div class="table-head" aria-hidden="true"><span>Project</span><span>Stage</span><span>${vm.has.progress ? "Progress" : "Last update"}</span></div><ul class="rows">${rows.map((p) => projectRow(vm, p)).join("")}</ul>`;
}

function feedItem(vm, a, { showProject = true } = {}) {
  const type = KIND[a.type] ? a.type : "update";
  const proj = showProject && a.projectId ? vm.projects.find((p) => p.id === a.projectId) : null;
  const title = proj && vm.has.documents ? `<a href="${e(projectHref(vm, proj.id))}">${e(a.title)}</a>` : e(a.title);
  return `<li><span class="feed__time">${e(fmtTime(a.at))}</span><span class="mark mark--${e(type)}" aria-hidden="true"></span>
<div><span class="feed__kind${type === "review" ? " feed__kind--review" : ""}">${e(KIND[type])}${proj ? ` · ${e(proj.name)}` : ""}</span>
<div class="feed__title">${title}</div>${a.detail ? `<p class="feed__detail">${e(a.detail)}</p>` : ""}</div></li>`;
}

function feed(vm, items, opts) {
  if (!items.length) return empty("Nothing to show yet", "Project activity will appear here as it happens.");
  let html = "", day = null, open = false;
  for (const a of items) {
    const k = dayKey(a.at);
    if (k !== day) {
      if (open) html += "</ol>";
      html += `<h3 class="feed-day">${e(dayHeading(a.at, vm.now))}</h3><ol class="feed">`;
      day = k; open = true;
    }
    html += feedItem(vm, a, opts);
  }
  return html + (open ? "</ol>" : "");
}

/* ------------------------------------------------------------------ dashboard */

export function dashboard(vm) {
  const active = vm.projects.filter(isActive);
  const latest = vm.activity[0] ? ` · Last update ${relative(vm.activity[0].at, vm.now)}` : "";
  const attention = vm.has.updates ? vm.updates.length : 0;
  const line = `${plural(active.length, "active project")}${attention ? ` · ${plural(attention, "item")} for your attention` : ""}${latest}`;

  const updates = vm.has.updates
    ? vm.updates.length
      ? vm.updates.map((u) => `<div class="notice">${u.tone === "attention" ? `<span class="status status--attention">Needs you</span>` : `<span class="status status--done">Update</span>`}${u.projectId ? `<a class="notice__title" href="${e(projectHref(vm, u.projectId))}">${e(u.title)}</a>` : `<span class="notice__title">${e(u.title)}</span>`}<p class="muted small">${e(u.detail)} · ${e(relative(u.at, vm.now))}</p></div>`).join("")
      : empty("Nothing needs your attention", "We’ll flag anything that does right here.")
    : notConnected("Important updates", "When Framework needs your decision or has news to share, it will be flagged here.");

  const actions = vm.has.actions
    ? `<div>${vm.actions.map((a) => `<div class="todo"><span class="todo__box${a.who === "Framework" ? " todo__box--framework" : ""}" aria-hidden="true"></span><span class="todo__text">${a.projectId ? `<a href="${e(projectHref(vm, a.projectId))}">${e(a.text)}</a>` : e(a.text)}</span><span class="todo__due">${e(relative(a.due, vm.now))}</span><span class="todo__who">${a.who === "Framework" ? "Framework is doing this" : "Waiting on you"}</span></div>`).join("")}</div>`
    : notConnected("Next actions", "A short list of what is needed from you, and from Framework, will live here.");

  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Welcome back, ${e(first(vm.user))}.</h1><p class="lead">${e(line)}</p></header>
<div class="dash">
<section class="section dash__updates" aria-labelledby="h-updates">${sectionHead("Needs your attention")}<h2 id="h-updates" class="visually-hidden">Needs your attention</h2>${updates}</section>
<section class="section dash__projects" aria-labelledby="h-projects">${sectionHead("Active projects", `<a class="text-link" href="${e(vm.base)}/projects">All projects</a>`)}<h2 id="h-projects" class="visually-hidden">Active projects</h2>${projectList(vm, active.length ? active : vm.projects, { summaries: false })}</section>
<section class="section dash__actions" aria-labelledby="h-actions">${sectionHead("Next actions")}<h2 id="h-actions" class="visually-hidden">Next actions</h2>${actions}</section>
<section class="section dash__activity" aria-labelledby="h-activity">${sectionHead("Recent activity", `<a class="text-link" href="${e(vm.base)}/activity">All activity</a>`)}<h2 id="h-activity" class="visually-hidden">Recent activity</h2>${feed(vm, vm.activity.slice(0, 5), { showProject: true })}</section>
</div>`;
}

/* ------------------------------------------------------------------ projects */

export function projects(vm) {
  const act = vm.projects.filter(isActive), done = vm.projects.filter((p) => !isActive(p));
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Projects</h1><p class="lead">${e(plural(vm.projects.length, "project"))} with Framework${act.length ? `, ${act.length} in progress` : ""}.</p></header>
${act.length || !vm.projects.length ? `<section class="section">${sectionHead("In progress")}${projectList(vm, act)}</section>` : ""}
${done.length ? `<section class="section">${sectionHead("Live and completed")}${projectList(vm, done)}</section>` : ""}`;
}

function milestones(vm, p) {
  if (!vm.has.milestones || !p.milestones) return notConnected("Milestones", "The key dates of this project, and where each one stands, will be shown here.");
  return `<ol class="miles">${p.milestones.map((m) => `<li class="is-${m.state === "done" ? "done" : m.state === "current" ? "current" : "next"}"><span class="miles__dot" aria-hidden="true"></span><span><span class="miles__name">${e(m.name)}</span> ${m.state === "done" ? '<span class="tag tag--ink">Done</span>' : m.state === "current" ? '<span class="tag tag--ink">In progress</span>' : ""}</span><span class="miles__date${m.state === "done" ? " is-done" : ""}">${m.date ? `<span class="miles__when">${m.state === "done" ? "Completed" : "Target"}</span> ${e(fmtDay(m.date, vm.now))}` : ""}</span>${m.note ? `<span class="miles__note">${e(m.note)}</span>` : ""}</li>`).join("")}</ol>`;
}

const DELIV = { delivered: ["Delivered", "done"], review: ["In review", "attention"], progress: ["In progress", "active"], todo: ["Not started", "idle"] };
const delivHref = (vm, p, d) => `${vm.base}/projects/${p.id}/deliverables/${d.id}`;
const delivDate = (vm, d) => (d.due ? (d.state === "delivered" ? `Delivered ${fmtDay(d.due, vm.now)}` : `Due ${fmtDay(d.due, vm.now)}`) : "");
function deliverables(vm, p) {
  if (!vm.has.deliverables || !p.deliverables) return notConnected("Deliverables", "What Framework is producing for you, and its status, will be listed here.");
  return `<div>${p.deliverables.map((d) => {
    const inner = `<span class="deliv__name">${e(d.name)}</span><span class="deliv__due">${e(delivDate(vm, d))}</span><span class="status status--${e(DELIV[d.state][1])}">${e(DELIV[d.state][0])}</span>`;
    return d.id ? `<a class="deliv deliv--link" href="${e(delivHref(vm, p, d))}">${inner}</a>` : `<div class="deliv">${inner}</div>`;
  }).join("")}</div>`;
}

/** Items waiting on the client for this project: deliverables in review. Empty when nothing is pending. */
function pending(vm, p) {
  if (!vm.has.deliverables || !p.deliverables) return "";
  const items = p.deliverables.filter((d) => d.state === "review" && d.id);
  if (!items.length) return "";
  return `<section class="attention" aria-labelledby="h-att"><h2 id="h-att" class="section__title">Needs your attention</h2><ul>${items.map((d) => `<li><a href="${e(delivHref(vm, p, d))}"><span class="status status--attention">Feedback needed</span> <span class="attention__name">${e(d.name)}</span></a><span class="attention__due">${e(delivDate(vm, d))}</span></li>`).join("")}</ul></section>`;
}

/** A single deliverable: what it is, where it stands and when. Nothing here is actionable; approval and files are not connected. */
export function deliverable(vm, p, d) {
  const st = DELIV[d.state];
  const dates = d.state === "delivered" ? [["Delivered", d.due]] : [["Due", d.due]];
  const review = d.state === "review";
  return `<header class="page-head"><p class="crumb"><a href="${e(vm.base)}/projects">Projects</a> / <a href="${e(projectHref(vm, p.id))}">${e(p.name)}</a> / ${e(d.name)}</p><span class="eyebrow">Deliverable · ${e(p.name)}</span><h1 class="h1">${e(d.name)}</h1>${d.desc ? `<p class="lead">${e(d.desc)}</p>` : ""}</header>
<div class="cols">
<div><section aria-labelledby="h-pv">${sectionHead("Preview")}<h2 id="h-pv" class="visually-hidden">Preview</h2><div class="doc__preview doc__preview--tall" role="img" aria-label="Sample deliverable: no preview available">Sample deliverable. Preview only: there is no file behind this entry.</div></section>
${review ? `<section class="section" aria-labelledby="h-fb">${sectionHead("Your feedback")}<h2 id="h-fb" class="visually-hidden">Your feedback</h2><p class="muted">In the live portal this is where you will review and respond. Commenting and approval are not available in this demonstration.</p><p class="actions-inert"><span class="btn btn--small" aria-disabled="true">Approve</span> <span class="btn btn--small" aria-disabled="true">Request changes</span></p></section>` : ""}</div>
<section aria-labelledby="h-dt">${sectionHead("Details")}<h2 id="h-dt" class="visually-hidden">Details</h2><dl class="kv"><dt>Status</dt><dd><span class="status status--${e(st[1])}">${e(st[0])}</span></dd><dt>Version</dt><dd>${e(d.version || "—")}</dd>${dates.map(([k, v]) => (v ? `<dt>${k}</dt><dd>${e(fmtDay(v, vm.now))}</dd>` : "")).join("")}<dt>Project</dt><dd><a class="text-link" href="${e(projectHref(vm, p.id))}">${e(p.name)}</a></dd><dt>Download</dt><dd class="muted">Not available in the demo</dd></dl>
<p><a class="text-link" href="${e(projectHref(vm, p.id))}#deliverables">Back to ${e(p.name)}</a></p></section>
</div>`;
}

function projectDocs(vm, p) {
  if (!vm.has.documents) return notConnected("Documents", "Files shared with you for this project will appear here.");
  const docs = vm.documents.filter((d) => d.projectId === p.id);
  if (!docs.length) return empty("No documents yet", "Nothing has been shared for this project.");
  return `<ul class="rows">${docs.map((d) => `<li>${docRow(vm, d, { showProject: false })}</li>`).join("")}</ul><p><a class="text-link" href="${e(vm.base)}/documents?project=${e(p.id)}">Open in the document library</a></p>`;
}

export function project(vm, p) {
  const live = safeHttps(p.liveUrl);
  const facts = vm.has.progress
    ? `<dl class="facts"><div><dt>Stage</dt><dd>${e(statusLabel(p.status))}</dd></div><div><dt>Progress</dt><dd>${e(`${p.progress}%`)}</dd></div><div><dt>Started</dt><dd>${e(fmtDay(p.started, vm.now))}</dd></div><div><dt>Target launch</dt><dd>${e(fmtDay(p.target, vm.now))}</dd></div><div><dt>Project lead</dt><dd>${e(p.lead)}</dd></div></dl>`
    : `<dl class="facts"><div><dt>Stage</dt><dd>${e(statusLabel(p.status))}</dd></div><div><dt>Type</dt><dd>${e(humanize(p.kind))}</dd></div>${p.updatedAt ? `<div><dt>Last update</dt><dd>${e(relative(p.updatedAt, vm.now))}</dd></div>` : ""}</dl>`;
  const details = `<dl class="kv"><dt>Type</dt><dd>${e(humanize(p.kind))}</dd><dt>Stage</dt><dd>${status(p.status)}</dd>${live ? `<dt>Live site</dt><dd><a class="text-link" href="${e(live)}" rel="noopener noreferrer">${e(live.replace(/^https:\/\//, ""))}</a></dd>` : ""}${p.scope ? `<dt>Scope</dt><dd>${p.scope.map((s) => e(s)).join("<br>")}</dd>` : ""}${p.lead && vm.has.progress ? `<dt>Your contact</dt><dd>${e(p.lead)}</dd>` : ""}</dl>`;
  return `<header class="page-head"><p class="crumb"><a href="${e(vm.base)}/projects">Projects</a> / ${e(p.name)}</p><span class="eyebrow">${e(humanize(p.kind))}</span><h1 class="h1">${e(p.name)}</h1>${p.summary ? `<p class="lead">${e(p.summary)}</p>` : ""}</header>
<section aria-label="Project summary">${facts}<div class="section">${stageTrack(p.status)}${vm.has.progress ? `<div class="meter-wrap">${meter(p.progress, "Overall progress")}</div>` : ""}</div></section>
${pending(vm, p)}
<nav class="jump" aria-label="On this page"><a href="#milestones">Milestones</a><a href="#deliverables">Deliverables</a><a href="#documents">Documents</a><a href="#details">Details</a></nav>
<div class="cols cols--stacks">
<div class="stack">
<section class="section" id="milestones" aria-labelledby="h-m">${sectionHead("Milestones")}<h2 id="h-m" class="visually-hidden">Milestones</h2>${milestones(vm, p)}</section>
<section class="section" id="documents" aria-labelledby="h-f">${sectionHead("Documents")}<h2 id="h-f" class="visually-hidden">Documents</h2>${projectDocs(vm, p)}</section>
</div>
<div class="stack">
<section class="section" id="deliverables" aria-labelledby="h-d">${sectionHead("Deliverables")}<h2 id="h-d" class="visually-hidden">Deliverables</h2>${deliverables(vm, p)}</section>
<section class="section" id="details" aria-labelledby="h-i">${sectionHead("Project information")}<h2 id="h-i" class="visually-hidden">Project information</h2>${details}</section>
</div>
</div>`;
}

/* ------------------------------------------------------------------ activity */

export function activity(vm, filters = {}) {
  const type = ACTIVITY_TYPES.some(([k]) => k === filters.type) ? filters.type : "all";
  const items = type === "all" ? vm.activity : vm.activity.filter((a) => a.type === type);
  const bar = `<nav class="filters" aria-label="Filter activity">${ACTIVITY_TYPES.map(([k, label]) => `<a href="${e(vm.base)}/activity${k === "all" ? "" : `?type=${k}`}"${k === type ? ' aria-current="true"' : ""}>${e(label)}</a>`).join("")}</nav>`;
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Activity</h1><p class="lead">Everything that has happened across your projects, newest first.</p></header>
${bar}${feed(vm, items, { showProject: true })}`;
}

/* ------------------------------------------------------------------ documents */

function docRow(vm, d, { showProject = true } = {}) {
  const proj = showProject && d.projectId ? vm.projects.find((p) => p.id === d.projectId) : null;
  return `<div class="doc"><details><summary><span class="doc__type" aria-label="${e(d.ext.toUpperCase())} file">${e(d.ext.toUpperCase())}</span>
<span><span class="doc__name">${e(d.name)}${d.isNew ? ' <span class="tag tag--ink tag-new">New</span>' : ""}</span><span class="doc__desc">${e(d.desc)}</span></span>
<span class="doc__meta">${e(d.size)}<br>${e(fmtDay(d.at, vm.now))}</span></summary>
<div class="doc__more"><dl class="kv"><dt>Type</dt><dd>${e(d.ext.toUpperCase())} · ${e(d.size)}</dd><dt>Version</dt><dd>${e(d.version)}</dd><dt>Added</dt><dd>${e(fmtDay(d.at, vm.now))}</dd>${proj ? `<dt>Project</dt><dd><a class="text-link" href="${e(projectHref(vm, proj.id))}">${e(proj.name)}</a></dd>` : `<dt>Filed under</dt><dd>${e(d.category)}</dd>`}</dl>
<div class="doc__preview" role="img" aria-label="Sample document: no preview available">Sample document. Preview only: there is no file behind this entry.</div>
<p><span class="btn btn--small" role="link" aria-disabled="true">Download (not available in the demo)</span></p></div></details></div>`;
}

export function documents(vm, filters = {}) {
  if (!vm.has.documents) {
    return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Documents</h1><p class="lead">Contracts, strategy, designs and invoices, organized by project.</p></header>
${notConnected("Document library", "Sharing files through the portal isn’t switched on yet. Until it is, Framework sends documents by email, and nothing is stored here.")}
<p class="auth__alt"><a class="text-link" href="/portal/demo">See how the library will look in the demo</a></p>`;
  }
  const chosen = vm.projects.find((p) => p.id === filters.project) || null;
  const list = chosen ? vm.documents.filter((d) => d.projectId === chosen.id) : vm.documents;
  const bar = `<nav class="filters" aria-label="Filter by project"><a href="${e(vm.base)}/documents"${chosen ? "" : ' aria-current="true"'}>All documents</a>${vm.projects.map((p) => `<a href="${e(vm.base)}/documents?project=${e(p.id)}"${chosen && chosen.id === p.id ? ' aria-current="true"' : ""}>${e(p.name)}</a>`).join("")}</nav>`;
  const groups = [];
  for (const p of chosen ? [chosen] : vm.projects) { const g = list.filter((d) => d.projectId === p.id); if (g.length) groups.push([p.name, g]); }
  const general = list.filter((d) => !d.projectId);
  if (general.length && !chosen) groups.push(["Agreements and billing", general]);
  const body = groups.length ? groups.map(([title, g]) => `<section class="doc-group" aria-label="${e(title)}"><h2 class="doc-group__title">${e(title)}</h2><ul class="rows">${g.map((d) => `<li>${docRow(vm, d, { showProject: !chosen })}</li>`).join("")}</ul></section>`).join("") : empty("No documents here", "Nothing has been shared for this project yet.");
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Documents</h1><p class="lead">${e(plural(vm.documents.length, "document"))}, organized by project. Select any file for details.</p></header>${bar}${body}`;
}

/* ------------------------------------------------------------------ account */

export function account(vm, { signOut = "" } = {}) {
  const site = safeHttps(vm.org.website);
  const settings = vm.has.settings
    ? `<ul class="prefs"><li><label for="p1">Weekly project summary<span class="small">One email every Monday with what changed.</span></label><input class="switch" id="p1" type="checkbox" checked disabled></li><li><label for="p2">Review requests<span class="small">An email when something needs your feedback.</span></label><input class="switch" id="p2" type="checkbox" checked disabled></li><li><label for="p3">New documents<span class="small">An email when a file is shared with you.</span></label><input class="switch" id="p3" type="checkbox" disabled></li></ul><p class="muted small">Preview only: these switches are not connected to anything.</p>`
    : notConnected("Notifications", "Email preferences aren’t editable yet. Framework will contact you directly for now.");
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Account</h1><p class="lead">Your details and your organization’s.</p></header>
<div class="cols cols--even">
<section class="section" aria-labelledby="h-org">${sectionHead("Organization")}<h2 id="h-org" class="visually-hidden">Organization</h2><dl class="kv"><dt>Name</dt><dd>${e(vm.org.name)}</dd>${site ? `<dt>Website</dt><dd><a class="text-link" href="${e(site)}" rel="noopener noreferrer">${e(site.replace(/^https:\/\//, ""))}</a></dd>` : ""}<dt>Your role</dt><dd>${e(humanize(vm.org.role))}</dd>${vm.org.people ? `<dt>People</dt><dd>${e(String(vm.org.people))}</dd>` : ""}</dl></section>
<section class="section" aria-labelledby="h-you">${sectionHead("You")}<h2 id="h-you" class="visually-hidden">You</h2><dl class="kv"><dt>Name</dt><dd>${e(vm.user.name || "Not set")}</dd><dt>Email</dt><dd>${e(vm.user.email)}</dd><dt>Sign-in</dt><dd>One-time code sent to your email</dd><dt>Session</dt><dd>Ends after 12 hours of inactivity</dd></dl></section>
<section class="section" aria-labelledby="h-set">${sectionHead("Notifications")}<h2 id="h-set" class="visually-hidden">Notifications</h2>${settings}</section>
<section class="section" aria-labelledby="h-help">${sectionHead("Help and privacy")}<h2 id="h-help" class="visually-hidden">Help and privacy</h2><p>To change your name or email, add or remove a teammate, or ask about your information, contact your Framework lead or <a class="text-link" href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a>.</p><p><a class="text-link" href="/privacy.html">Privacy notice</a></p>${signOut ? `<div class="section">${signOut}</div>` : ""}</section>
</div>`;
}

/* ------------------------------------------------------------------ team (owners, connected portal only) */

export function team(vm) {
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Team</h1><p class="lead">The people at ${e(vm.org.name)} who can sign in to this portal.</p></header>
<section class="section">${sectionHead("People")}<ul class="rows">${vm.team.map((u) => `<li><div class="row"><span class="row__title">${e(u.name || u.email)}</span><span class="row__meta">${e(u.email)} · ${e(humanize(u.role))}</span></div></li>`).join("")}</ul></section>`;
}
