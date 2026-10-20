/**
 * The guided client workspace (demonstration): Home, the six areas, questionnaires, prerequisites and service-request previews. Pure string
 * rendering from guided-data.js; no request, database, environment or storage access. Every control is either a link or a native input that
 * is NOT inside a form, so nothing can be submitted, and every page says so. There is no script and no inline style (the portal CSP forbids both).
 */
import { e, status, meter, fmtDay, relative } from "./ui.js";
import { AREAS, PROFILE_STEPS, WORKSPACES, BRAND_PATHS, UPLOAD_SLOTS, DISCOVERY, SERVICES, serviceById, serviceReadiness, progressSummary, profileDone, workspaceDone } from "./guided-data.js";

const NOTE = "Demonstration only. Nothing you type or choose here is saved, uploaded or sent.";
const COMMERCIAL = "Requests are subject to Framework’s review, scoping and quotation. Sending a request does not authorise any paid work: you will receive a proposal to approve or decline first.";

const href = (vm, path) => `${vm.base}${path}`;
const area = (key) => AREAS.find((a) => a.key === key);
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const first = (user) => (user.name || "").trim().split(/\s+/)[0] || "there";

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
  if (fd.kind === "choice") return `<fieldset class="field choice"><legend>${e(fd.label)}</legend>${(fd.options || []).map((o, i) => `<label class="choice__opt"><input type="radio" name="${e(id)}" value="${e(o)}"${o === fd.value ? " checked" : ""}> <span>${e(o)}</span></label>`).join("")}</fieldset>`;
  const label = `<label for="${e(id)}">${e(fd.label)}</label>${hint}`;
  if (fd.kind === "textarea") return `<div class="field">${label}<textarea id="${e(id)}" rows="4"${desc} placeholder="${e(fd.placeholder || "")}">${e(fd.value)}</textarea></div>`;
  if (fd.kind === "select") return `<div class="field">${label}<select id="${e(id)}"${desc}><option value="">Choose…</option>${(fd.options || []).map((o) => `<option${o === fd.value ? " selected" : ""}>${e(o)}</option>`).join("")}</select></div>`;
  return `<div class="field">${label}<input id="${e(id)}" type="${e(fd.kind)}" value="${e(fd.value)}" placeholder="${e(fd.placeholder || "")}"${desc} autocomplete="off"></div>`;
}

/* ------------------------------------------------------------------ prerequisites (reusable) */

function reqItem(vm, r) {
  if (r.anyOf) return `<li class="${r.met ? "is-met" : "is-needed"}"><span class="prereq__mark" aria-hidden="true"></span><span class="prereq__body"><span class="prereq__label">One of these: ${e(r.label)}</span><span class="prereq__state">${r.met ? "Met" : "Needed"}</span><ul class="prereq__sub">${r.anyOf.map((o) => `<li>${e(o.label)} ${o.met ? "(provided)" : `· <a class="text-link" href="${e(href(vm, o.href))}">Provide this</a>`}</li>`).join("")}</ul></span></li>`;
  return `<li class="${r.met ? "is-met" : "is-needed"}"><span class="prereq__mark" aria-hidden="true"></span><span class="prereq__body"><span class="prereq__label">${e(r.label)}</span><span class="prereq__state">${r.met ? "Complete" : `<a class="text-link" href="${e(href(vm, r.href))}">Complete this</a>`}</span></span></li>`;
}

/** What a service specifically needs, what is already in place, and a direct link to each missing piece. */
function prereqPanel(vm, service, heading = "Before you request") {
  const { reqs, missing } = serviceReadiness(service);
  const summary = missing.length ? `${plural(missing.length, "thing")} still needed. Everything else you can explore freely.` : "Everything needed for this request is in place.";
  return `<section class="prereq" aria-labelledby="h-pre-${e(service.id)}"><h3 id="h-pre-${e(service.id)}" class="prereq__title">${e(heading)}: ${e(service.title)}</h3><p class="muted">${e(summary)}</p><ul class="prereq__list">${reqs.map((r) => reqItem(vm, r)).join("")}</ul></section>`;
}

const readinessLine = (service) => { const { missing } = serviceReadiness(service); return missing.length ? `Needs ${plural(missing.length, "thing")}` : "Ready to request"; };

function serviceList(vm, areaKey) {
  const items = SERVICES.filter((s) => s.area === areaKey);
  if (!items.length) return "";
  return `<section class="section" aria-labelledby="h-svc-${e(areaKey)}">${head("Request a service")}<h2 id="h-svc-${e(areaKey)}" class="visually-hidden">Request a service</h2><p class="muted">${e(COMMERCIAL)}</p><ul class="rows">${items.map((s) => { const { missing } = serviceReadiness(s); return `<li><a class="row row--service" href="${e(href(vm, `/requests/${s.id}`))}"><span><strong class="row__name">${e(s.title)}</strong><span class="row__meta">${e(s.blurb)}</span></span><span class="status status--${missing.length ? "idle" : "done"}">${e(readinessLine(s))}</span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`; }).join("")}</ul></section>`;
}

/* ------------------------------------------------------------------ home */

export function home(vm) {
  const sum = progressSummary();
  const cur = PROFILE_STEPS.find((s) => s.state === "current") || PROFILE_STEPS.find((s) => s.state === "todo");
  const reviewCount = vm.projects.reduce((n, p) => n + (p.deliverables || []).filter((d) => d.state === "review").length, 0);
  const tileStatus = {
    profile: [`${profileDone()} of ${PROFILE_STEPS.length} steps`, "active"],
    branding: ["Choose your path", "idle"],
    website: [`${workspaceDone("website")} of ${WORKSPACES.website.topics.length} topics`, "active"],
    marketing: ["Not started", "idle"],
    content: [`${workspaceDone("content")} of ${WORKSPACES.content.topics.length} topics`, "active"],
    files: [reviewCount ? `${plural(reviewCount, "item")} to review` : "Up to date", reviewCount ? "attention" : "done"],
  };
  const tiles = AREAS.map((a) => `<li><a class="tile" href="${e(href(vm, a.path))}"><span class="tile__n" aria-hidden="true">${e(a.n)}</span><span class="tile__title">${e(a.title)}</span><span class="tile__desc">${e(a.desc)}</span><span class="tile__foot"><span class="status status--${tileStatus[a.key][1]}">${e(tileStatus[a.key][0])}</span><span class="tile__arrow" aria-hidden="true">→</span></span></a></li>`).join("");
  return `<header class="page-head"><span class="eyebrow">${e(vm.org.name)}</span><h1 class="h1">Let’s get you set up, ${e(first(vm.user))}.</h1><p class="lead">Six areas, in any order. Share what you have, tell us what you need, and follow your projects.</p></header>
<section class="next" aria-labelledby="h-next"><div><span class="eyebrow">Recommended next step</span><h2 id="h-next" class="next__title">${e(cur.title)}</h2><p class="muted">${e(cur.intro)} About ${e(String(cur.minutes))} minutes.</p><p><a class="btn btn--primary" href="${e(href(vm, `/profile/${cur.id}`))}">Continue your Business Profile <span aria-hidden="true">→</span></a></p></div>
<div class="next__progress"><span class="eyebrow">Onboarding progress</span>${meter(sum.percent, "Onboarding progress")}<p class="muted small">${e(`${sum.done} of ${sum.total} steps complete across your profile, website, marketing and content.`)}</p></div></section>
<section class="section" aria-labelledby="h-areas">${head("Your workspace")}<h2 id="h-areas" class="visually-hidden">Your workspace</h2><ul class="tiles">${tiles}</ul></section>
<section class="section" aria-labelledby="h-follow">${head("Follow your projects")}<h2 id="h-follow" class="visually-hidden">Follow your projects</h2><ul class="rows"><li><a class="row row--service" href="${e(href(vm, "/progress"))}"><span><strong class="row__name">Progress &amp; activity</strong><span class="row__meta">Your project overview, next actions and recent updates.</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li><li><a class="row row--service" href="${e(href(vm, "/projects"))}"><span><strong class="row__name">Projects</strong><span class="row__meta">${e(plural(vm.projects.length, "project"))}: milestones, deliverables and documents.</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li></ul></section>`;
}

/* ------------------------------------------------------------------ business profile */

export function profile(vm) {
  const done = profileDone(), total = PROFILE_STEPS.length;
  const next = PROFILE_STEPS.find((s) => s.state !== "done");
  const rows = PROFILE_STEPS.map((s, i) => `<li><a class="row row--step" href="${e(href(vm, `/profile/${s.id}`))}"><span class="step__n" aria-hidden="true">${i + 1}</span><span><strong class="row__name">${e(s.title)}</strong><span class="row__meta">${e(s.intro)} About ${e(String(s.minutes))} min.</span></span>${chip(s.state)}<span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("");
  return `<header class="page-head">${crumb(vm, [["Business Profile"]])}${pageHead("01 · Business Profile", "Business Profile", "Seven short steps. Answer what you can now and come back to the rest. Each service only asks for the parts it needs.")}</header>
${note()}
<section aria-label="Progress">${meter(Math.round((done / total) * 100), "Business Profile progress")}<p class="muted small">${e(`${done} of ${total} steps complete`)}${next ? ` · <a class="text-link" href="${e(href(vm, `/profile/${next.id}`))}">Continue: ${e(next.title)}</a>` : ""}</p></section>
<section class="section" aria-labelledby="h-steps">${head("Steps")}<h2 id="h-steps" class="visually-hidden">Steps</h2><ol class="rows rows--plain">${rows}</ol></section>`;
}

export function profileStep(vm, step) {
  const i = PROFILE_STEPS.indexOf(step), total = PROFILE_STEPS.length;
  const prev = PROFILE_STEPS[i - 1], next = PROFILE_STEPS[i + 1];
  const neededFor = SERVICES.filter((s) => s.needs.some(([k, id]) => k === "profile" && id === step.id));
  return `<header class="page-head">${crumb(vm, [["Business Profile", "/profile"], [step.title]])}${pageHead(`Step ${i + 1} of ${total}`, step.title, step.intro)}</header>
<nav class="stepper" aria-label="Business Profile steps"><ol>${PROFILE_STEPS.map((s, n) => `<li class="is-${s.state}"><a href="${e(href(vm, `/profile/${s.id}`))}"${s === step ? ' aria-current="step"' : ""}><span class="visually-hidden">Step ${n + 1}: ${e(s.title)}, ${e(STATE[s.state][1])}</span><span aria-hidden="true">${n + 1}</span></a></li>`).join("")}</ol></nav>
${note()}
<div class="questions">${step.fields.map((fd) => field(`p-${step.id}`, fd)).join("")}</div>
${neededFor.length ? `<p class="muted small">Needed for: ${neededFor.map((s) => `<a class="text-link" href="${e(href(vm, `/requests/${s.id}`))}">${e(s.title)}</a>`).join(", ")}</p>` : ""}
<div class="step-nav">${prev ? `<a class="btn" href="${e(href(vm, `/profile/${prev.id}`))}"><span aria-hidden="true">←</span> Previous</a>` : `<a class="btn" href="${e(href(vm, "/profile"))}"><span aria-hidden="true">←</span> All steps</a>`}${inert("Save (not available in the demo)", false)}${next ? `<a class="btn btn--primary" href="${e(href(vm, `/profile/${next.id}`))}">Next <span aria-hidden="true">→</span></a>` : `<a class="btn btn--primary" href="${e(href(vm, "/profile"))}">Back to your steps</a>`}</div>`;
}

/* ------------------------------------------------------------------ branding */

export function branding(vm, pathId) {
  const sel = BRAND_PATHS.find((p) => p.id === pathId);
  const chooser = `<nav class="choices" aria-label="Branding path"><ul>${BRAND_PATHS.map((p) => `<li><a href="${e(href(vm, `/branding/${p.id}`))}"${p === sel ? ' aria-current="true"' : ""}><span class="choices__t">${e(p.title)}</span><span class="choices__d">${e(p.blurb)}</span></a></li>`).join("")}</ul></nav>`;
  let body;
  if (!sel) body = `<p class="muted">Choose the option that fits. You can change your mind at any time.</p>`;
  else if (sel.id === "existing") {
    body = `<section class="section" aria-labelledby="h-up">${head("Share your brand assets")}<h2 id="h-up" class="visually-hidden">Share your brand assets</h2>${note("Demonstration only. No files can be uploaded, and nothing is stored.")}<ul class="uploads">${UPLOAD_SLOTS.map((u) => `<li class="upload"><span><strong class="row__name">${e(u.title)}</strong><span class="row__meta">${e(u.hint)}</span></span>${inert("Choose files (not available in the demo)")}</li>`).join("")}</ul></section>
<section class="section" aria-labelledby="h-need">${head("What you need first")}<h2 id="h-need" class="visually-hidden">What you need first</h2><p>Nothing. You can share existing brand assets without completing your Business Profile.</p><p class="muted">Not sure the assets are enough? You can also <a class="text-link" href="${e(href(vm, "/branding/guidelines"))}">ask for brand guidelines</a>.</p></section>`;
  } else {
    const svc = serviceById(sel.service);
    body = `<section class="section" aria-labelledby="h-disc">${head("What we will ask you for")}<h2 id="h-disc" class="visually-hidden">What we will ask you for</h2><p class="muted">Brand discovery helps Framework understand the business before any design starts.</p><ul class="bullets">${DISCOVERY.map((d) => `<li>${e(d)}</li>`).join("")}</ul></section>
<section class="section" aria-labelledby="h-pre">${head("Requirements")}<h2 id="h-pre" class="visually-hidden">Requirements</h2>${prereqPanel(vm, svc)}</section>
<section class="section" aria-labelledby="h-go">${head("Next step")}<h2 id="h-go" class="visually-hidden">Next step</h2><p class="muted">${e(COMMERCIAL)}</p><p><a class="btn btn--primary" href="${e(href(vm, `/requests/${svc.id}`))}">Preview the request <span aria-hidden="true">→</span></a></p></section>`;
  }
  return `<header class="page-head">${crumb(vm, [["Branding"]])}${pageHead("02 · Branding", "Branding", "Tell us where your brand is today. We will show what happens next for your choice.")}</header>${chooser}${body}`;
}

/* ------------------------------------------------------------------ website / marketing / content */

export function workspace(vm, key) {
  const w = WORKSPACES[key], a = area(key), done = workspaceDone(key), total = w.topics.length;
  const topics = w.topics.map((t) => `<details class="topic"${t.state === "current" ? " open" : ""}><summary><span class="topic__t">${e(t.title)}</span><span class="topic__s">${chip(t.state)}</span><span class="topic__x" aria-hidden="true"></span></summary><div class="topic__body"><p class="muted">${e(t.summary)}</p><div class="questions">${t.fields.map((fd) => field(`${key}-${t.id}`, fd)).join("")}</div><fieldset class="field choice"><legend>Who will provide this?</legend><label class="choice__opt"><input type="radio" name="${e(`${key}-${t.id}-who`)}" value="client"${t.helpWith === "client" ? " checked" : ""}> <span>I will provide it</span></label><label class="choice__opt"><input type="radio" name="${e(`${key}-${t.id}-who`)}" value="framework"${t.helpWith === "framework" ? " checked" : ""}> <span>I would like Framework’s help</span></label></fieldset>${note()}</div></details>`).join("");
  return `<header class="page-head">${crumb(vm, [[a.title]])}${pageHead(`${a.n} · ${a.title}`, a.title, w.intro)}</header>
<section aria-label="Progress">${meter(Math.round((done / total) * 100), `${a.title} progress`)}<p class="muted small">${e(`${done} of ${total} topics complete`)}</p></section>
<section class="section" aria-labelledby="h-topics">${head("Topics")}<h2 id="h-topics" class="visually-hidden">Topics</h2><div class="topics">${topics}</div></section>
${serviceList(vm, key)}`;
}

/* ------------------------------------------------------------------ files & deliverables */

export function files(vm) {
  const review = vm.projects.flatMap((p) => (p.deliverables || []).filter((d) => d.state === "review" && d.id).map((d) => ({ p, d })));
  const docs = [...vm.documents].sort((x, y) => (x.at < y.at ? 1 : -1)).slice(0, 4);
  return `<header class="page-head">${crumb(vm, [["Files & Deliverables"]])}${pageHead("06 · Files & Deliverables", "Files & Deliverables", "What Framework has shared with you, and what you have shared with Framework.")}</header>
${review.length ? `<section class="section" aria-labelledby="h-rev">${head("Waiting for your review")}<h2 id="h-rev" class="visually-hidden">Waiting for your review</h2><ul class="rows">${review.map(({ p, d }) => `<li><a class="row row--service" href="${e(href(vm, `/projects/${p.id}/deliverables/${d.id}`))}"><span><strong class="row__name">${e(d.name)}</strong><span class="row__meta">${e(p.name)} · due ${e(fmtDay(d.due, vm.now))}</span></span><span class="status status--attention">In review</span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("")}</ul></section>` : ""}
<section class="section" aria-labelledby="h-docs">${head("Latest documents", `<a class="text-link" href="${e(href(vm, "/documents"))}">Document library</a>`)}<h2 id="h-docs" class="visually-hidden">Latest documents</h2><ul class="rows">${docs.map((d) => `<li><a class="row row--service" href="${e(href(vm, "/documents"))}"><span><strong class="row__name">${e(d.name)}</strong><span class="row__meta">${e(d.ext.toUpperCase())} · ${e(d.size)} · added ${e(relative(d.at, vm.now))}</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("")}</ul></section>
<section class="section" aria-labelledby="h-yours">${head("Files you have shared")}<h2 id="h-yours" class="visually-hidden">Files you have shared</h2>${note("Demonstration only. File sharing is not connected yet.")}<p class="muted">Logos, fonts and other files you share will be listed here. <a class="text-link" href="${e(href(vm, "/branding/existing"))}">Preview the brand asset upload</a></p></section>
<section class="section" aria-labelledby="h-proj">${head("Projects")}<h2 id="h-proj" class="visually-hidden">Projects</h2><ul class="rows">${vm.projects.map((p) => `<li><a class="row row--service" href="${e(href(vm, `/projects/${p.id}`))}"><span><strong class="row__name">${e(p.name)}</strong><span class="row__meta">${e(p.summary)}</span></span><span></span><span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("")}</ul></section>`;
}

/* ------------------------------------------------------------------ service request (preview) */

export function request(vm, service) {
  const a = area(service.area), { missing } = serviceReadiness(service);
  const nextMissing = missing[0];
  return `<header class="page-head">${crumb(vm, [[a.title, a.path], [service.title]])}${pageHead(`Service request · ${a.title}`, service.title, service.blurb)}</header>
<p class="notice-line">${e(COMMERCIAL)}</p>
${note("Demonstration only. Requests cannot be submitted yet.")}
<div class="cols cols--even"><div>${prereqPanel(vm, service, "What this needs")}${nextMissing ? `<p><a class="btn btn--primary" href="${e(href(vm, (nextMissing.anyOf || [nextMissing])[0].href))}">${e(nextMissing.anyOf ? "Provide what is needed" : `Complete: ${nextMissing.label}`)} <span aria-hidden="true">→</span></a></p>` : ""}</div>
<section aria-labelledby="h-det">${head("Your request")}<h2 id="h-det" class="visually-hidden">Your request</h2><div class="questions"><div class="field"><label for="rq-notes">Anything we should know?</label><textarea id="rq-notes" rows="4" placeholder="Context, deadlines, examples you like."></textarea></div><div class="field"><label for="rq-when">Preferred timing</label><select id="rq-when"><option value="">Choose…</option><option>As soon as possible</option><option>Within the next month</option><option>In two to three months</option><option>Flexible</option></select></div></div><p>${inert(missing.length ? "Submit request (complete the requirements first)" : "Submit request (not available in the demo)", false)}</p></section></div>
<section class="section" aria-labelledby="h-next2">${head("What happens next")}<h2 id="h-next2" class="visually-hidden">What happens next</h2><ol class="bullets bullets--num"><li>Check what this request needs.</li><li>Add the details above.</li><li>Framework reviews the request and scopes the work.</li><li>You receive a quotation to approve or decline. No paid work begins before you approve it.</li></ol></section>`;
}
