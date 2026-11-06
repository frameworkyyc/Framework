/**
 * Client views for the request engine. Pure string building: a view receives a plain view-model and returns the HTML of a page body; it never reads the request, the
 * environment or the database. Every dynamic value is escaped with `e`. Pages carry no script and no inline style (the portal CSP forbids both), so presentation is in
 * /assets/css/portal-requests.css and colour swatches are SVG fills.
 *
 * vm: { base: "/portal/o/<slug>", now: Date }
 */
import { e, fmtDay, fmtTime, relative } from "../ui.js";
import { formatMoney } from "../repo/invoices.js";
import { KINDS, getType, typesOfKind, effectiveSettings, optionLabel, typeLabel } from "./registry.js";
import { STAGES, stageIndex, STATUS_LABEL, STATUS_TONE, ACTION_LABEL, isClosed, revisionsLeft } from "./workflow.js";

const href = (vm, path) => `${vm.base}${path}`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const nl = (s) => e(s).replace(/\n/g, "<br>");

export const SUBMISSION_NOTICE = "Sending a request does not authorize any paid work. Framework will review it and, if it involves extra work, send you a quote to approve before anything starts.";

/* ------------------------------------------------------------------ icons: one geometric glyph set (24 x 24, 1.75 strokes, square caps) */

const G = {
  card: '<rect x="3" y="6" width="18" height="12"/><path d="M7 10h6M7 14h4"/>', phone: '<rect x="7" y="3" width="10" height="18"/><path d="M11 18h2"/>', poster: '<rect x="5" y="3" width="14" height="18"/><path d="M8 7h8M8 11h8M8 15h4"/>',
  flyer: '<rect x="6" y="3" width="12" height="18"/><path d="M6 9h12"/>', brochure: '<path d="M3 5h6v14H3zM9 5h6v14H9zM15 5h6v14h-6z"/>', social: '<rect x="4" y="4" width="16" height="16"/><path d="M4 15l5-5 4 4 3-3 4 4"/>',
  letter: '<rect x="5" y="3" width="14" height="18"/><path d="M8 7h4M8 12h8M8 15h8M8 18h5"/>', mail: '<rect x="3" y="5" width="18" height="14"/><path d="M3 6l9 7 9-7"/>', custom: '<path d="M12 3l9 5v8l-9 5-9-5V8z"/><path d="M12 12v9M3 8l9 4 9-4"/>',
  audit: '<rect x="4" y="3" width="16" height="18"/><path d="M8 8h8M8 12h8M8 16h4"/><path d="M15 15l3 3"/>', pin: '<path d="M12 21s-6-6-6-11a6 6 0 0 1 12 0c0 5-6 11-6 11z"/><path d="M12 8v4"/>', repeat: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h7"/>', wrench: '<path d="M14 6a4 4 0 0 0 5 5L9 21l-4-4L15 7"/>', app: '<rect x="3" y="4" width="18" height="16"/><path d="M3 9h18M7 6.5h.01M10 6.5h.01"/>',
  dashboard: '<rect x="3" y="3" width="8" height="10"/><rect x="13" y="3" width="8" height="6"/><rect x="13" y="11" width="8" height="10"/><rect x="3" y="15" width="8" height="6"/>', spark: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  flow: '<rect x="3" y="4" width="6" height="5"/><rect x="15" y="4" width="6" height="5"/><rect x="9" y="15" width="6" height="5"/><path d="M6 9v3h12V9M12 12v3"/>', link: '<path d="M10 14l4-4M8 12l-2 2a3 3 0 0 0 4 4l2-2M16 12l2-2a3 3 0 0 0-4-4l-2 2"/>',
  calc: '<rect x="5" y="3" width="14" height="18"/><path d="M8 7h8M8 11h2M12 11h2M8 15h2M12 15h2M16 11v6"/>', plus: '<rect x="4" y="4" width="16" height="16"/><path d="M12 8v8M8 12h8"/>',
  deliverable: '<rect x="4" y="4" width="16" height="16"/><path d="M4 15l5-5 4 4 3-3 4 4"/>', seo: '<circle cx="11" cy="11" r="6"/><path d="M16 16l5 5"/>', development: '<path d="M8 8l-5 4 5 4M16 8l5 4-5 4M14 5l-4 14"/>', requests: '<path d="M4 6h16M4 12h16M4 18h10"/>',
};
export const icon = (key, cls = "rq-icon") => `<svg class="${e(cls)}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${G[key] || G.plus}</svg>`;

/* ------------------------------------------------------------------ small pieces */

export const tag = (s) => `<span class="status status--${e(STATUS_TONE[s] || "idle")}">${e(STATUS_LABEL[s] || s)}</span>`;
const crumbs = (vm, items) => `<nav class="crumb" aria-label="Breadcrumb">${items.map(([label, h]) => (h ? `<a href="${e(href(vm, h))}">${e(label)}</a>` : `<span aria-current="page">${e(label)}</span>`)).join(" / ")}</nav>`;
const banner = (kind, text) => (text ? `<p class="form-banner${kind === "error" ? " form-banner--error" : ""}" role="${kind === "error" ? "alert" : "status"}"${kind === "error" ? ' tabindex="-1" data-error-summary' : ""}>${e(text)}</p>` : "");
const priceLine = (cfg) => (cfg.pricing.mode === "fixed" ? `Fixed price: ${formatMoney(cfg.pricing.fixedPriceCents)}` : "Custom quote");

/** A seven-stage track: done, current, upcoming. A request that ended without delivery shows no track. */
export function stageTrack(status) {
  const i = stageIndex(status);
  if (i < 0) return "";
  return `<ol class="rq-stages" aria-label="Progress: ${e(STATUS_LABEL[status])}">${STAGES.map((s, n) => `<li class="${n < i ? "is-done" : n === i ? "is-current" : ""}"${n === i ? ' aria-current="step"' : ""}><span class="rq-stages__n" aria-hidden="true">${n + 1}</span><span class="rq-stages__t">${e(s.label)}</span></li>`).join("")}</ol>`;
}

/** One request as a row: title, what it is, status, where it is on the track and what it waits for. */
function row(vm, r, { reason = "" } = {}) {
  const i = stageIndex(r.status);
  const meter = i < 0 ? "" : `<progress class="meter" max="6" value="${i}" aria-label="Stage ${i + 1} of 7">${i + 1}/7</progress>`;
  return `<li><a class="rq-row${reason ? " rq-row--action" : ""}" href="${e(href(vm, `/requests/${r.id}`))}">
<span class="rq-row__icon">${icon((getType(r.typeKey) || {}).icon || r.kind)}</span>
<span class="rq-row__main"><span class="rq-row__title">${e(r.title)}</span><span class="rq-row__meta">${e(r.typeLabel || typeLabel(r.typeKey))} · ${e(relative(r.lastMessageAt, vm.now))}</span></span>
<span class="rq-row__state">${tag(r.status)}${reason ? `<span class="rq-row__need">${e(ACTION_LABEL[reason] || "")}</span>` : ""}</span>
<span class="rq-row__bar">${meter}</span></a></li>`;
}
const rowsOf = (vm, list, reasons = {}) => `<ul class="rq-rows">${list.map((r) => row(vm, r, { reason: reasons[r.id] || "" })).join("")}</ul>`;

function tile(vm, type, cfg) {
  const facts = [priceLine(cfg), type.proofs ? `${plural(cfg.revisionsIncluded, "revision round")} included` : "", cfg.turnaroundNote].filter(Boolean);
  return `<li><a class="rq-tile" href="${e(href(vm, `/requests/new?type=${encodeURIComponent(type.key)}`))}">
${icon(type.icon, "rq-tile__icon")}<span class="rq-tile__title">${e(type.label)}</span><span class="rq-tile__text">${e(type.summary)}</span>
<span class="rq-tile__facts">${facts.map((f) => `<span>${e(f)}</span>`).join("")}</span><span class="rq-tile__go">Request this</span></a></li>`;
}

/* ------------------------------------------------------------------ section pages (Deliverables, SEO, Custom Development) */

/**
 * d: { requests: [...of this kind], settings: Map(type_key -> row), actions: [{id, reason}], canRequest, extra: html }
 * Active = requests in progress; Available = what can be requested; Completed = closed requests. Prices appear only when Admin entered one.
 */
export function sectionPage(vm, kind, d) {
  const K = KINDS[kind];
  const open = d.requests.filter((r) => !isClosed(r.status)), closed = d.requests.filter((r) => isClosed(r.status));
  const reasons = Object.fromEntries((d.actions || []).map((a) => [a.id, a.reason]));
  const needs = open.filter((r) => reasons[r.id]);
  const types = typesOfKind(kind).map((t) => ({ t, cfg: { ...effectiveSettings(t, d.settings && d.settings.get(t.key)), } })).filter((x) => x.cfg.enabled);
  const status = open.length ? `<span class="status status--active">${plural(open.length, "request")} in progress</span>` : `<span class="status status--idle">Nothing in progress</span>`;
  return `<header class="page-head page-head--compact">${crumbs(vm, [[K.label]])}<h1 class="h1 h1--section">${e(K.label)}</h1><p class="lead">${e(K.blurb)}</p><p class="rq-state">${status}</p></header>
${needs.length ? `<section class="rq-block rq-block--action" aria-labelledby="rq-need"><h2 class="h3" id="rq-need">Needs your action</h2>${rowsOf(vm, needs, reasons)}</section>` : ""}
<section class="rq-block" aria-labelledby="rq-active"><h2 class="h3" id="rq-active">Active</h2>${open.length ? rowsOf(vm, open, reasons) : `<p class="muted">No ${e(K.noun)} requests are in progress. Choose one below to start.</p>`}</section>
${d.extra || ""}
<section class="rq-block" aria-labelledby="rq-avail"><h2 class="h3" id="rq-avail">Available to request</h2>${d.canRequest === false ? `<p class="muted">Ask an owner of your organization to make a request.</p>` : ""}
<ul class="rq-tiles">${types.map((x) => tile(vm, x.t, x.cfg)).join("")}</ul><p class="muted small rq-fine">${e(SUBMISSION_NOTICE)}</p></section>
${closed.length ? `<section class="rq-block" aria-labelledby="rq-done"><h2 class="h3" id="rq-done">Completed and closed</h2>${rowsOf(vm, closed)}</section>` : ""}`;
}

/** The extra block on the SEO page: what exists for each website, and what is not connected. Nothing is shown that is not stored and published. */
export function seoOverview(vm, sites, seoOf) {
  const rows = sites.map((s) => {
    const d = seoOf.get(s.id);
    const items = d ? d.checklist || [] : [];
    const done = items.filter((i) => i.status === "done").length;
    const recs = d ? (d.recommendations || []).filter((i) => i.status !== "done").length : 0;
    const latest = d && d.metrics && d.metrics[0];
    const state = d ? `<span class="status status--${d.status === "not_started" ? "idle" : "active"}">${e({ not_started: "Not started", in_progress: "In progress", optimised: "Optimised", monitoring: "Monitoring" }[d.status] || d.status)}</span>` : `<span class="status status--idle">Not set up</span>`;
    const bits = d ? [items.length ? `${done} of ${items.length} checklist items done` : "", recs ? plural(recs, "open recommendation") : "", latest && (latest.clicks != null || latest.impressions != null) ? `Latest figures: ${latest.clicks != null ? plural(latest.clicks, "click") : ""}${latest.clicks != null && latest.impressions != null ? ", " : ""}${latest.impressions != null ? plural(latest.impressions, "impression") : ""} (${e(latest.periodStart)} to ${e(latest.periodEnd)}, ${latest.source === "search_console" ? "Search Console" : "entered by Framework"})` : "", d.reports && d.reports.length ? plural(d.reports.length, "monthly report") + " available" : ""].filter(Boolean) : [];
    return `<li class="rq-site"><div class="rq-site__head"><strong>${e(s.name)}</strong>${state}</div>${d && d.summary ? `<p class="muted">${e(d.summary)}</p>` : ""}
${bits.length ? `<ul class="rq-site__facts">${bits.map((b) => `<li>${b}</li>`).join("")}</ul>` : `<p class="muted small">No SEO work is recorded for this website yet.</p>`}
<a class="text-link" href="${e(href(vm, `/website/${s.id}/seo`))}">${d ? "Open the SEO details" : "Open the website"}</a></li>`;
  }).join("");
  const ready = [
    ["Google Search Console", "Not connected", "A connection will let Framework show your real search figures here. It is planned, not available yet."],
    ["Google Business Profile", "Not set up", "Ask for Local SEO and Google Business Profile below and Framework will check what you have."],
    ["Keyword rankings", "Not tracked", "Rankings are not shown because no ranking data is connected. Nothing here is estimated."],
  ];
  return `<section class="rq-block" aria-labelledby="rq-sites"><h2 class="h3" id="rq-sites">Your websites</h2>${sites.length ? `<ul class="rq-sites">${rows}</ul>` : `<p class="muted">No website is listed for your organization yet.</p>`}</section>
<section class="rq-block" aria-labelledby="rq-ready"><h2 class="h3" id="rq-ready">Connections and reporting</h2><ul class="rq-ready">${ready.map(([t, s, w]) => `<li><span class="rq-ready__t">${e(t)}</span><span class="status status--idle">${e(s)}</span><span class="muted small">${e(w)}</span></li>`).join("")}</ul></section>`;
}

/* ------------------------------------------------------------------ the guided request form */

/**
 * o: { values, errors, error, csrf, websites: [{id, name}], brand: null | { colours, typography, logos: [{id,title,role,tone}] }, cfg }
 * Posted as multipart (reference files). Each checkbox is its own field (d_<field>__<value>) because the upload reader refuses repeated names.
 */
export function formPage(vm, type, o = {}) {
  const values = o.values || {}, errors = o.errors || {}, cfg = o.cfg || effectiveSettings(type, null), K = KINDS[type.kind];
  const field = (f) => {
    const id = `rq-${f.key}`, err = errors[f.key], v = values[f.key];
    const label = `<label for="${id}">${e(f.label)}${f.required ? "" : ' <span class="field__opt">Optional</span>'}</label>`;
    const help = f.help ? `<span class="field__hint" id="${id}-h">${e(f.help)}</span>` : "";
    const msg = err ? `<span class="field__error" id="${id}-e">${e(err)}</span>` : "";
    const aria = ` aria-describedby="${[f.help ? `${id}-h` : "", err ? `${id}-e` : ""].filter(Boolean).join(" ")}"${err ? ' aria-invalid="true"' : ""}`;
    if (f.type === "checks") {
      const picked = new Set(Array.isArray(v) ? v : []);
      return `<fieldset class="field choice${err ? " field--error" : ""}"><legend>${e(f.label)}${f.required ? "" : ' <span class="field__opt">Optional</span>'}</legend>${help}${f.options.map(([val, lab]) => `<label class="choice__opt"><input type="checkbox" name="d_${e(f.key)}__${e(val)}" value="1"${picked.has(val) ? " checked" : ""}><span>${e(lab)}</span></label>`).join("")}${msg}</fieldset>`;
    }
    if (f.type === "select") return `<div class="field${err ? " field--error" : ""}">${label}${help}<select id="${id}" name="d_${e(f.key)}"${aria}>${f.options.map(([val, lab]) => `<option value="${e(val)}"${(v || "") === val ? " selected" : ""}>${e(lab)}</option>`).join("")}</select>${msg}</div>`;
    if (f.type === "textarea") return `<div class="field${err ? " field--error" : ""}">${label}${help}<textarea id="${id}" name="d_${e(f.key)}" rows="${f.max > 1200 ? 6 : 4}" maxlength="${f.max}"${aria}>${e(v || "")}</textarea>${msg}</div>`;
    return `<div class="field${err ? " field--error" : ""}">${label}${help}<input id="${id}" name="d_${e(f.key)}" type="text" maxlength="${f.max}" value="${e(v || "")}"${aria}>${msg}</div>`;
  };
  let n = 0;
  const step = (title, body) => `<section class="rq-step"><h2 class="rq-step__t"><span class="rq-step__n" aria-hidden="true">${String(++n).padStart(2, "0")}</span>${e(title)}</h2>${body}</section>`;
  const brand = o.brand;
  const brandBody = !type.brand ? "" : brand
    ? `<p class="muted">Your published brand is saved with the request, so Framework designs with exactly what you chose.</p>
<label class="choice__opt"><input type="checkbox" name="use_brand" value="1"${values.use_brand === "1" ? " checked" : ""}><span><strong>Use my brand</strong><br><span class="muted small">Colours and fonts from your Branding page${brand.logos.length ? ", and the logos you choose" : ""}.</span></span></label>
${brand.logos.length ? `<fieldset class="field choice"><legend>Logos to use</legend>${brand.logos.map((l) => `<label class="choice__opt"><input type="checkbox" name="logo_${e(l.id)}" value="1"${values["logo_" + l.id] === "1" ? " checked" : ""}><span>${e(l.title)}<span class="muted small"> ${[l.role, l.tone].filter(Boolean).map(e).join(" · ")}</span></span></label>`).join("")}</fieldset>` : ""}
${brand.colours.length ? `<p class="rq-sw-row" aria-label="Your brand colours">${brand.colours.slice(0, 8).map((c) => `<svg class="rq-sw" viewBox="0 0 24 24" role="img" aria-label="${e(c.name || c.hex)} ${e(c.hex)}"><rect width="24" height="24" fill="${e(c.hex)}"/></svg>`).join("")}</p>` : ""}`
    : `<p class="muted">Your brand isn't published yet, so it can't be attached automatically. Add logos and notes as references below, or <a class="text-link" href="${e(href(vm, "/branding"))}">see Branding</a>.</p>`;
  const websiteBody = type.website && o.websites && o.websites.length ? `<div class="field"><label for="rq-site">Website <span class="field__opt">Optional</span></label><select id="rq-site" name="website_id"><option value="">Not about one website</option>${o.websites.map((w) => `<option value="${e(w.id)}"${values.website_id === w.id ? " selected" : ""}>${e(w.name)}</option>`).join("")}</select></div>` : "";
  const terms = [priceLine(cfg), type.proofs ? `${plural(cfg.revisionsIncluded, "revision round")} included` : "", ...type.includes, type.note, cfg.turnaroundNote].filter(Boolean);
  const head = `<header class="page-head page-head--compact">${crumbs(vm, [[K.label, K.path], [type.label]])}<h1 class="h1 h1--section">${icon(type.icon, "rq-icon rq-icon--head")}${e(type.label)}</h1><p class="lead">${e(type.summary)}</p></header>`;
  const facts = `<ul class="rq-facts" aria-label="What is included">${terms.map((t) => `<li>${e(t)}</li>`).join("")}</ul>`;
  const errCount = Object.keys(errors).length;
  const top = o.error ? banner("error", o.error) : errCount ? banner("error", "Please check the highlighted questions and send it again.") : "";
  return `${head}${top}${facts}<form class="req-form rq-form" method="post" action="${e(href(vm, "/requests"))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(o.csrf || "")}"><input type="hidden" name="type" value="${e(type.key)}">
${step("The basics", `<div class="questions"><div class="field${errors.title ? " field--error" : ""}"><label for="rq-title">Name this request</label><span class="field__hint" id="rq-title-h">A short name you will recognise, for example "Spring business cards".</span><input id="rq-title" name="title" type="text" maxlength="120" value="${e(values.title || "")}" aria-describedby="rq-title-h${errors.title ? " rq-title-e" : ""}"${errors.title ? ' aria-invalid="true"' : ""}>${errors.title ? `<span class="field__error" id="rq-title-e">${e(errors.title)}</span>` : ""}</div>${websiteBody}
<div class="field${errors.needed_by ? " field--error" : ""}"><label for="rq-needed">When do you need it? <span class="field__opt">Optional</span></label><input id="rq-needed" name="needed_by" type="date" value="${e(values.needed_by || "")}">${errors.needed_by ? `<span class="field__error">${e(errors.needed_by)}</span>` : ""}</div></div>`)}
${step("The details", `<div class="questions">${type.fields.map(field).join("")}</div>`)}
${type.brand ? step("Your brand", brandBody) : ""}
${step("References", `<div class="field"><label for="rq-files">Reference files <span class="field__opt">Optional</span></label><span class="field__hint" id="rq-files-h">${e(type.files || "Anything that helps.")} Up to 4 files of 10 MB each: images, PDF, logos (SVG, AI, EPS), fonts, Word, Excel, PowerPoint or ZIP. You can add more later in the conversation.</span><input id="rq-files" name="file" type="file" multiple aria-describedby="rq-files-h"></div>`)}
<p class="muted small rq-fine">${e(SUBMISSION_NOTICE)}</p>
<p class="step-nav"><button class="btn btn--primary" type="submit">Send request</button> <a class="btn" href="${e(href(vm, K.path))}">Cancel</a></p></form>`;
}

/* ------------------------------------------------------------------ My Requests (the hub) */

/** d: { requests, legacy: [] (support requests, read-only rows), actions, kind } */
export function hubPage(vm, d) {
  const reasons = Object.fromEntries((d.actions || []).map((a) => [a.id, a.reason]));
  const filter = d.kind && KINDS[d.kind] ? d.kind : "";
  const list = d.requests.filter((r) => !filter || r.kind === filter);
  const needs = list.filter((r) => reasons[r.id] && !isClosed(r.status));
  const open = list.filter((r) => !isClosed(r.status) && !reasons[r.id]), closed = list.filter((r) => isClosed(r.status));
  const tabs = [["", "All"], ...Object.values(KINDS).map((k) => [k.key, k.label])].map(([k, l]) => `<li><a href="${e(href(vm, k ? `/requests?kind=${k}` : "/requests"))}"${k === filter ? ' aria-current="page"' : ""}>${e(l)}</a></li>`).join("");
  const legacy = !filter && d.legacy && d.legacy.length ? `<section class="rq-block" aria-labelledby="rq-sup"><h2 class="h3" id="rq-sup">Support and change requests</h2><ul class="rq-rows">${d.legacy.map((r) => `<li><a class="rq-row" href="${e(href(vm, `/services/requests/${r.id}`))}"><span class="rq-row__icon">${icon("wrench")}</span><span class="rq-row__main"><span class="rq-row__title">${e(r.title)}</span><span class="rq-row__meta">Support · ${e(relative(r.lastMessageAt, vm.now))}</span></span><span class="rq-row__state"><span class="status status--${r.closed ? "idle" : r.unreadForClient || r.status === "quoted" ? "attention" : "active"}">${e(r.statusLabel)}</span></span><span class="rq-row__bar"></span></a></li>`).join("")}</ul></section>` : "";
  const empty = !list.length && !legacy;
  return `<header class="page-head page-head--compact">${crumbs(vm, [["My Requests"]])}<h1 class="h1 h1--section">My Requests</h1><p class="lead">Every request across Deliverables, SEO and Custom Development, with what each is waiting for.</p>
<ul class="rq-tabs" aria-label="Filter by service">${tabs}</ul></header>
${needs.length ? `<section class="rq-block rq-block--action" aria-labelledby="rq-need"><h2 class="h3" id="rq-need">Needs your action</h2>${rowsOf(vm, needs, reasons)}</section>` : ""}
${open.length ? `<section class="rq-block" aria-labelledby="rq-act"><h2 class="h3" id="rq-act">In progress</h2>${rowsOf(vm, open)}</section>` : ""}
${legacy}
${closed.length ? `<section class="rq-block" aria-labelledby="rq-cl"><h2 class="h3" id="rq-cl">Completed and closed</h2>${rowsOf(vm, closed)}</section>` : ""}
${empty ? `<div class="empty"><strong>No requests yet.</strong>Start with <a class="text-link" href="${e(href(vm, "/deliverables"))}">Deliverables</a>, <a class="text-link" href="${e(href(vm, "/seo"))}">SEO</a> or <a class="text-link" href="${e(href(vm, "/development"))}">Custom Development</a>.</div>` : ""}`;
}

/** The block at the top of Home: what waits for the person, and the services as active or available. */
export function homeBlock(vm, summary, { counts = {}, canRequest = true } = {}) {
  const need = summary.actions.length
    ? `<section class="rq-home__need" aria-labelledby="rq-hn"><h2 class="h3" id="rq-hn">Needs your action <span class="rq-count">${summary.actionCount}</span></h2><ul class="rq-rows">${summary.actions.slice(0, 5).map((a) => `<li><a class="rq-row rq-row--action" href="${e(href(vm, `/requests/${a.id}`))}"><span class="rq-row__icon">${icon((getType(a.typeKey) || {}).icon || a.kind)}</span><span class="rq-row__main"><span class="rq-row__title">${e(a.title)}</span><span class="rq-row__meta">${e(a.typeLabel)}</span></span><span class="rq-row__state"><span class="rq-row__need">${e(ACTION_LABEL[a.reason] || "")}</span></span><span class="rq-row__bar"></span></a></li>`).join("")}</ul>${summary.actionCount > 5 ? `<p><a class="text-link" href="${e(href(vm, "/requests"))}">See all ${summary.actionCount}</a></p>` : ""}</section>` : "";
  const cells = Object.values(KINDS).map((k) => {
    const c = counts[k.key] || 0;
    return `<li><a class="rq-svc" href="${e(href(vm, k.path))}">${icon(k.key, "rq-svc__icon")}<span class="rq-svc__t">${e(k.label)}</span><span class="rq-svc__s"><span class="status status--${c ? "active" : "idle"}">${c ? `${plural(c, "request")} in progress` : canRequest ? "Available to request" : "Available"}</span></span><span class="rq-svc__d">${e(k.blurb)}</span></a></li>`;
  }).join("");
  return `<div class="rq-home">${need}<section class="rq-home__svc" aria-labelledby="rq-hs"><h2 class="h3" id="rq-hs">Your services</h2><ul class="rq-svcs">${cells}</ul><p><a class="text-link" href="${e(href(vm, "/requests"))}">My Requests${summary.open ? ` (${summary.open} open)` : ""}</a></p></section></div>`;
}

/* ------------------------------------------------------------------ one request */

const FLASH = { sent: "Your request was sent. Framework will review it and reply here.", replied: "Your message was sent.", partial: "Your message was sent, but one or more files could not be saved. Please attach them again.", approved: "You approved the design. Your final files are below.", revised: "Your revision request was sent to Framework.", cancelled: "Your request was withdrawn.", declined: "You declined the quote. Framework will review it and reply here." };
const ERRORS = {
  forbidden: "You don't have permission to do that.", closed: "This request is closed.", not_permitted_move: "That isn't possible at this stage of the request.", conflict: "This request changed while you were looking. Please check it and try again.",
  message_required: "Please write a message first.", invalid_message: "That message couldn't be sent. Please shorten it and try again.", revision_limit: "All included revision rounds have been used. Reply below and Framework will discuss more with you.",
  no_proof: "There is no design to approve yet.", acceptance_closed: "Accepting a quote in the portal isn't available yet. Reply below and Framework will confirm your approval.", name_required: "Please type your full name to accept.",
  file_too_large: "A file is larger than 10 MB.", too_many_attachments: "You can attach up to 4 files at a time.", too_many_files: "This request has reached its limit of 20 files.", type_not_allowed: "That kind of file can't be attached.", invalid_name: "That file name can't be used.",
  content_mismatch: "A file's contents don't match its type.", active_content: "A file contains active content and can't be attached.", storage_unavailable: "File storage isn't available right now.", quote_not_open: "That quote is no longer open.",
};
export const errorText = (code) => ERRORS[code] || "That couldn't be done. Please try again.";

function detailsList(r) {
  const type = getType(r.typeKey);
  const items = [];
  if (type) for (const f of type.fields) {
    const v = r.details[f.key]; if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue;
    const shown = Array.isArray(v) ? v.map((x) => optionLabel(f, x)).join(", ") : f.type === "select" ? optionLabel(f, v) : v;
    items.push(`<div class="rq-dl__r"><dt>${e(f.label)}</dt><dd>${nl(shown)}</dd></div>`);
  }
  if (r.neededBy) items.push(`<div class="rq-dl__r"><dt>Needed by</dt><dd>${e(fmtDay(r.neededBy + "T12:00:00Z"))}</dd></div>`);
  const b = r.brand;
  if (b && (b.logos.length || b.colours.length || b.fonts.length)) {
    items.push(`<div class="rq-dl__r"><dt>Brand used</dt><dd>${b.logos.length ? `<span>${b.logos.map((l) => e(l.title)).join(", ")}</span><br>` : ""}${b.colours.length ? `<span class="rq-sw-row">${b.colours.map((c) => `<svg class="rq-sw" viewBox="0 0 24 24" role="img" aria-label="${e(c.name || c.hex)} ${e(c.hex)}"><rect width="24" height="24" fill="${e(c.hex)}"/></svg>`).join("")}</span>` : ""}${b.fonts.length ? `<br><span class="muted">${b.fonts.map((f) => e(f.family)).join(", ")}</span>` : ""}</dd></div>`);
  }
  return items.length ? `<section class="rq-block" aria-labelledby="rq-det"><h2 class="h3" id="rq-det">Details</h2><dl class="rq-dl">${items.join("")}</dl></section>` : "";
}

function quotePanel(vm, t, o) {
  const r = t.request, open = t.quotes.find((q) => q.status === "sent");
  if (!t.quotes.length) return "";
  const money = (q) => `${formatMoney(q.amountCents)}${q.taxCents != null ? ` plus ${e(q.taxLabel || "tax")} ${formatMoney(q.taxCents)}` : ""}`;
  const cards = [...t.quotes].reverse().map((q) => `<article class="rq-quote rq-quote--${e(q.status)}"><header><strong>${e(q.title)}</strong><span class="status status--${q.status === "sent" ? "attention" : q.status === "accepted" ? "live" : "idle"}">${e({ sent: "Awaiting your decision", accepted: "Accepted", declined: "Declined", superseded: "Replaced by a newer quote" }[q.status] || q.status)}</span></header>
<p class="rq-quote__amt">${e(money(q))}</p><p>${nl(q.scope)}</p><p class="muted small">Version ${q.version} · sent ${e(fmtDay(q.createdAt, vm.now))}${q.validUntil ? ` · valid until ${e(fmtDay(q.validUntil + "T12:00:00Z", vm.now))}` : ""}${q.status === "accepted" ? ` · ${q.decidedVia === "staff_record" ? "agreement recorded by Framework" : `accepted by ${e(q.acceptedName || "your organization")}`}` : ""}</p></article>`).join("");
  let action = "";
  if (open && r.status === "quoted" && o.owner) {
    const decline = `<form class="rq-inline" method="post" action="${e(href(vm, `/requests/${r.id}/quote/${open.id}/decline`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="field"><label for="rq-dn">Not right? Tell Framework why <span class="field__opt">Optional</span></label><textarea id="rq-dn" name="note" rows="2" maxlength="1000"></textarea></div><button class="btn" type="submit">Decline this quote</button></form>`;
    action = o.quoteOpen
      ? `<form class="rq-inline" method="post" action="${e(href(vm, `/requests/${r.id}/quote/${open.id}/accept`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="rq-terms">${nl(o.terms || "")}</div><div class="field"><label for="rq-an">Type your full name to accept</label><input id="rq-an" name="name" type="text" maxlength="120" autocomplete="name"></div><button class="btn btn--primary" type="submit">Accept this quote</button></form>${decline}`
      : `<p class="rq-note">To go ahead, reply below. No work starts until Framework confirms your approval.</p>${decline}`;
  } else if (open && r.status === "quoted") action = `<p class="rq-note">An owner of your organization decides on quotes. You can ask a question below.</p>`;
  return `<section class="rq-block" aria-labelledby="rq-q"><h2 class="h3" id="rq-q">Quote</h2>${cards}${action}</section>`;
}

function proofPanel(vm, t, o) {
  const proofs = t.files.filter((f) => f.role === "proof");
  if (!proofs.length) return "";
  const r = t.request, round = r.revisionsUsed;
  const current = proofs.filter((f) => f.round === round).sort((a, b) => b.version - a.version);
  const earlier = proofs.filter((f) => f.round !== round).sort((a, b) => b.version - a.version);
  const fig = (f, big) => { const shown = f.hasPreview || ["png", "jpg", "webp"].includes(f.format); return `<figure class="rq-proof${big ? " rq-proof--big" : ""}">${shown ? `<a href="${e(href(vm, `/requests/${r.id}/files/${f.id}/view`))}"><img src="${e(href(vm, `/requests/${r.id}/files/${f.id}/view`))}" alt="Design proof, version ${f.version}" loading="lazy"></a>` : `<div class="rq-proof__none">No preview picture</div>`}<figcaption>Version ${f.version}${f.round ? ` · revision ${f.round}` : ""} · ${e(fmtDay(f.createdAt, vm.now))}</figcaption></figure>`; };
  const left = revisionsLeft(r);
  const decide = r.status === "client_review" && o.canApprove
    ? `<div class="rq-decide"><form class="rq-inline" method="post" action="${e(href(vm, `/requests/${r.id}/approve`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="field"><label for="rq-ap">Note for Framework <span class="field__opt">Optional</span></label><textarea id="rq-ap" name="note" rows="2" maxlength="1000"></textarea></div><button class="btn btn--primary" type="submit">Approve this design</button></form>
${left > 0 ? `<form class="rq-inline" method="post" action="${e(href(vm, `/requests/${r.id}/revise`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><div class="field"><label for="rq-rv">What should change?</label><span class="field__hint">${plural(left, "revision round")} left of ${r.revisionsIncluded + r.revisionsPaid}. Put all the changes in one request.</span><textarea id="rq-rv" name="note" rows="4" maxlength="2000" required></textarea></div><button class="btn" type="submit">Request revisions</button></form>` : `<p class="rq-note">All ${r.revisionsIncluded + r.revisionsPaid} revision rounds have been used. Reply below and Framework will talk through additional changes with you.</p>`}</div>` : "";
  return `<section class="rq-block${r.status === "client_review" ? " rq-block--action" : ""}" aria-labelledby="rq-pf"><h2 class="h3" id="rq-pf">${r.status === "client_review" ? "Review your design" : "Design proofs"}</h2>
<p class="muted small">Revision rounds: ${r.revisionsUsed} used of ${r.revisionsIncluded + r.revisionsPaid}${r.revisionsPaid ? ` (including ${r.revisionsPaid} added by Framework)` : ""}.</p>
<div class="rq-proofs">${current.map((f) => fig(f, true)).join("") || earlier.slice(0, 1).map((f) => fig(f, true)).join("")}</div>${decide}
${earlier.length ? `<details class="rq-earlier"><summary>Earlier versions (${earlier.length})</summary><div class="rq-proofs">${earlier.map((f) => fig(f, false)).join("")}</div></details>` : ""}</section>`;
}

function filesPanel(vm, t) {
  const r = t.request;
  const list = (items, label) => `<h3 class="rq-sub">${e(label)}</h3><ul class="file-list">${items.map((f) => `<li class="file-row"><span class="file-row__main"><span class="file-row__name">${e(f.name)}</span><span class="muted small"> ${e(f.format.toUpperCase())} · ${e(Math.max(1, Math.round(f.size / 1024)) + " KB")} · ${e(fmtDay(f.createdAt, vm.now))}</span></span><span class="file-row__actions"><a class="btn btn--small" href="${e(href(vm, `/requests/${r.id}/files/${f.id}`))}">Download</a></span></li>`).join("")}</ul>`;
  const finals = t.files.filter((f) => f.role === "final"), refs = t.files.filter((f) => f.role === "reference" || f.role === "attachment");
  if (!finals.length && !refs.length) return "";
  return `<section class="rq-block${finals.length ? " rq-block--done" : ""}" aria-labelledby="rq-fl"><h2 class="h3" id="rq-fl">Files</h2>${finals.length ? list(finals, "Final files") : r.status === "completed" ? "" : ""}${refs.length ? list(refs, "Your references and attachments") : ""}</section>`;
}

const NEXT = {
  new: "Framework has your request and will review it. You'll hear back here.", in_review: "Framework is reviewing your request.", quoted: "A quote is ready for you to review below.", approved: "Approved. Framework will start work soon.",
  in_progress: "Framework is working on it.", client_review: "Your design is ready. Review it below.", revision_requested: "Your revision request was sent. Framework is working on the changes.", completed: "This request is complete. Your final files are below.",
  declined: "Framework couldn't take this request on. See the conversation for why.", cancelled: "This request was withdrawn.",
};

function timeline(vm, t) {
  const when = (ev) => `${fmtDay(ev.createdAt, vm.now)} ${fmtTime(ev.createdAt)}`;
  const label = (ev) => (ev.kind === "quote" ? `Quote sent${ev.body ? `: ${ev.body}` : ""}` : ev.kind === "revision" ? "Revision requested" : ev.kind === "approval" ? "Approved" : ev.statusTo === "new" ? "Request submitted" : `Status: ${STATUS_LABEL[ev.statusTo] || ev.statusTo}`);
  const items = t.events.map((ev) => {
    if (ev.kind === "message") return `<li class="msg ${ev.authorType === "staff" ? "msg--staff" : "msg--client"}"><p class="msg__who"><strong>${e(ev.authorType === "staff" ? "Framework" : ev.authorName || "Your team")}</strong> <span class="muted small">${e(when(ev))}</span></p><p class="msg__body">${nl(ev.body)}</p></li>`;
    const body = ev.kind === "quote" ? "" : ev.body;
    return `<li class="msg msg--status"><p><strong>${e(label(ev))}</strong> <span class="muted small">${e(when(ev))}</span></p>${body ? `<p class="msg__body">${nl(body)}</p>` : ""}</li>`;
  }).join("");
  return `<ol class="thread rq-thread" aria-label="Activity">${items}</ol>`;
}

/**
 * o: { csrf, flash, error, owner, canApprove, canCancel, quoteOpen, terms }  (all booleans/strings computed by the route from role and environment)
 */
export function detailPage(vm, t, o = {}) {
  const r = t.request;
  const top = o.error ? banner("error", errorText(o.error)) : o.flash && FLASH[o.flash] ? banner("ok", FLASH[o.flash]) : "";
  const reply = r.closed
    ? `<p class="muted">This request is ${r.status === "completed" ? "complete" : r.status}. For anything else, <a class="text-link" href="${e(href(vm, KINDS[r.kind] ? KINDS[r.kind].path : "/requests"))}">start a new request</a>.</p>`
    : `<form class="req-form" method="post" action="${e(href(vm, `/requests/${r.id}/reply`))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(o.csrf)}"><h2 class="h3" id="rp-h">Write to Framework</h2><div class="questions"><div class="field"><label for="rp-body">Your message</label><textarea id="rp-body" name="body" rows="4" maxlength="4000" aria-describedby="rp-h"></textarea></div><div class="field"><label for="rp-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="rp-files-h">Up to 4 files of 10 MB each.</span><input id="rp-files" name="file" type="file" multiple aria-describedby="rp-files-h"></div></div><p class="step-nav"><button class="btn btn--primary" type="submit">Send</button></p></form>`;
  const cancel = o.canCancel && ["new", "in_review", "quoted"].includes(r.status) ? `<form class="rq-inline rq-cancel" method="post" action="${e(href(vm, `/requests/${r.id}/cancel`))}"><input type="hidden" name="csrf" value="${e(o.csrf)}"><button class="btn btn--quiet" type="submit">Withdraw this request</button></form>` : "";
  return `<header class="page-head page-head--compact">${crumbs(vm, [["My Requests", "/requests"], [r.title]])}<h1 class="h1 h1--section">${e(r.title)}</h1><p class="rq-meta">${tag(r.status)} <span class="muted small">${e(r.typeLabel)} · sent ${e(fmtDay(r.createdAt, vm.now))}</span></p></header>
${top}${stageTrack(r.status)}<p class="rq-next">${e(NEXT[r.status] || "")}</p>
${quotePanel(vm, t, o)}${proofPanel(vm, t, o)}${filesPanel(vm, t)}${detailsList(r)}
<section class="rq-block" aria-labelledby="rq-act"><h2 class="h3" id="rq-act">Conversation</h2>${timeline(vm, t)}${reply}${cancel}</section>`;
}
