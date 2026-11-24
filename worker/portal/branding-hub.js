/**
 * The Branding hub: four options (Logos, Typography, Brand Colours, Brand Kit), the shared header of each view, and the logo library with its upload form.
 * Server-rendered strings like every portal page: no inline style, no inline script. The upload review sheet is built by /assets/js/portal-logo-upload.js from the plain form
 * below (a file input and the three optional detail fields per file, named type_0, colour_0, background_0 ... in the order of the files), so the form also works without script.
 * Nothing here is a capability: every link is a route that re-checks organization, publication and permission.
 */
import { e } from "./ui.js";

const href = (vm, p) => `${vm.base}${p}`;
const MB = 1024 * 1024;
const upper = (f) => String(f || "").toUpperCase();
const fileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
};
const crumb = (vm, trail) => `<p class="crumb"><a href="${e(vm.base)}">Home</a>${trail.map(([label, p]) => ` / ${p ? `<a href="${e(href(vm, p))}">${e(label)}</a>` : e(label)}`).join("")}</p>`;

export const LOGO_TYPE_LABEL = Object.freeze({ primary: "Primary / Full logo", secondary: "Secondary", simplified: "Simplified", submark: "Sub-mark", other: "Other" });
export const LOGO_COLOUR_LABEL = Object.freeze({ full: "Full colour", light: "Light", dark: "Dark" });
export const LOGO_BACKGROUND_LABEL = Object.freeze({ transparent: "Transparent", solid: "Solid" });
const PICTURE = ["svg", "png", "webp", "jpg", "jpeg"];
/** What the file picker offers for logos (the server still decides what is accepted). */
export const LOGO_ACCEPT = ".png,.jpg,.jpeg,.webp,.svg,.pdf,.ai,.eps,.zip";
export const MAX_LOGO_FILES = 10;

/* ------------------------------------------------------------------ the landing */

const ICON = {
  logos: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M4 5h16v14H4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M8 15l3-4 2.5 3 1.5-2 2 3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  typography: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M5 18L11 5l6 13M7.5 13h7M18 18h2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  colours: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><circle cx="9" cy="10" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="15" cy="10" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="15" r="5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`,
  kit: `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false"><path d="M5 8h14v11H5zM9 8V6h6v2M5 13h14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
};
const GO = `<svg class="bh-card__go" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** The four options, in order. `meta` is a short live count (never a price, never a percentage). */
export const HUB_OPTIONS = Object.freeze([
  { key: "logos", path: "/branding/logos", title: "Logos", desc: "Your logo library: upload and download every version." },
  { key: "typography", path: "/branding/typography", title: "Typography", desc: "Approved fonts, how to use them, and where to get them." },
  { key: "colours", path: "/branding/colours", title: "Brand Colours", desc: "Approved colours. Tap a code to copy it." },
  { key: "kit", path: "/branding/brand-kit", title: "Brand Kit", desc: "The brand guide, visual style and packaged downloads." },
]);

/**
 * @param o { counts: { logos, typography, colours, kit } (numbers), discoveryHref: string ("" when Brand Discovery is not in progress), bookHref, lead }
 */
export function hubLanding(vm, o = {}) {
  const { counts = {}, discoveryHref = "", discoveryLabel = "Continue Brand Discovery", bookHref = "", lead = "Your logos, fonts, colours and brand guide, in one place." } = o;
  const meta = (k) => {
    const n = counts[k] || 0;
    const word = { logos: ["logo file", "logo files"], typography: ["typeface", "typefaces"], colours: ["colour", "colours"], kit: ["file", "files"] }[k];
    return n ? `${n} ${n === 1 ? word[0] : word[1]}` : "Nothing added yet";
  };
  const cards = HUB_OPTIONS.map((x) => `<li class="bh-item"><a class="bh-card" href="${e(href(vm, x.path))}"><span class="bh-card__icon">${ICON[x.key]}</span><span class="bh-card__text"><span class="bh-card__title">${e(x.title)}</span><span class="bh-card__desc">${e(x.desc)}</span><span class="bh-card__meta">${e(meta(x.key))}</span></span>${GO}</a></li>`).join("");
  const disc = discoveryHref ? `<p class="bh-discovery"><a class="text-link" href="${e(discoveryHref)}">${e(discoveryLabel)}</a></p>` : "";
  const book = bookHref ? `<p class="bk-preview"><a class="btn btn--small" href="${e(bookHref)}">Preview Brand Book</a> <span class="muted small">Prototype for review · visible to Framework master access only</span></p>` : "";
  return `<header class="page-head page-head--compact">${crumb(vm, [["Branding"]])}<h1 class="h1 h1--section">Branding</h1><p class="lead">${e(lead)}</p></header><ul class="bh-grid">${cards}</ul>${disc}${book}`;
}

/** The header every Branding view shares: breadcrumb, a clear way back to Branding, the title and a short lead. `actions` sits beside the title on desktop and under it on phones. */
export function viewHeader(vm, { title, lead = "", actions = "" }) {
  return `<header class="page-head page-head--compact bhv-head">${crumb(vm, [["Branding", "/branding"], [title]])}<p class="bhv-back"><a class="text-link" href="${e(href(vm, "/branding"))}"><span aria-hidden="true">←</span> Back to Branding</a></p><div class="bhv-bar"><h1 class="h1 h1--section">${e(title)}</h1>${actions}</div>${lead ? `<p class="lead">${e(lead)}</p>` : ""}</header>`;
}

/* ------------------------------------------------------------------ the logo library */

export const LOGO_ERRORS = Object.freeze({
  no_file: "Choose at least one file.",
  too_many_files: `Choose up to ${MAX_LOGO_FILES} files at a time.`,
  invalid_logo_detail: "One of the details for this file isn’t a valid choice. Try again.",
});

const detailLine = (u) => [LOGO_TYPE_LABEL[u.logoType], LOGO_COLOUR_LABEL[u.logoColour], u.logoBackground ? `${LOGO_BACKGROUND_LABEL[u.logoBackground]} background` : ""].filter(Boolean);
const previewable = (format) => PICTURE.includes(String(format || "").toLowerCase());
/** A tile behind a logo that is meant for dark backgrounds, so a white logo stays visible. */
const darkStage = (u) => u.logoColour === "dark" ? "" : u.logoColour === "light" ? " lg-stage--dark" : "";

function uploadCard(vm, u, { canDelete, csrf }) {
  const stage = previewable(u.format) && !u.held
    ? `<div class="lg-stage${darkStage(u)}"><img src="${e(href(vm, `/branding/uploads/${u.id}/download?preview=1`))}" alt="${e(u.name)}" loading="lazy" decoding="async"></div>`
    : `<div class="lg-stage lg-stage--file"><span class="lg-ext">${e(upper(u.format))}</span></div>`;
  const facts = detailLine(u);
  const dl = u.held
    ? `<span class="muted small">Not available to download while on hold</span>`
    : `<a class="btn btn--small" href="${e(href(vm, `/branding/uploads/${u.id}/download`))}" download>Download<span class="visually-hidden"> ${e(u.name)} (${e(upper(u.format))}, ${e(fileSize(u.size))})</span></a>`;
  const del = canDelete
    ? `<details class="remove"><summary class="btn btn--small btn--quiet">Remove<span class="visually-hidden"> ${e(u.name)}</span></summary><form method="post" action="${e(href(vm, `/branding/uploads/${u.id}/delete`))}"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="return" value="logos"><p class="muted small">Removing this file takes it off your organization’s library.</p><p class="step-nav"><button class="btn btn--small" type="submit">Remove file</button></p></form></details>`
    : "";
  return `<li class="lg-card"><div class="lg-card__stage">${stage}</div><div class="lg-card__body"><p class="lg-card__name">${u.held ? `<span class="tag">On hold</span> ` : ""}${e(u.name)}</p><p class="muted small">${e([...facts, upper(u.format), fileSize(u.size)].filter(Boolean).join(" · "))}</p><div class="lg-card__actions">${dl}${del}</div></div></li>`;
}

/** A logo file Framework published for this client (an existing brand asset): same card, its own preview and download routes. */
function assetCard(vm, group, labels) {
  const first = group[0];
  const shown = ["svg", "png", "webp", "jpg"].map((f) => group.find((a) => a.format === f)).find(Boolean);
  const dark = first.tone === "dark";
  const stage = shown
    ? `<div class="lg-stage${dark ? " lg-stage--dark" : ""}"><img src="${e(href(vm, `/branding/files/${shown.id}?preview=1`))}" alt="${e(first.title)}" loading="lazy" decoding="async"></div>`
    : `<div class="lg-stage lg-stage--file"><span class="lg-ext">${e(upper(first.format))}</span></div>`;
  const facts = [labels.role[first.logoRole], labels.orientation[first.orientation], labels.tone[first.tone], first.transparent ? "Transparent background" : ""].filter(Boolean);
  const buttons = group.map((a) => `<a class="btn btn--small" href="${e(href(vm, `/branding/files/${a.id}`))}" download>Download ${e(upper(a.format))}<span class="visually-hidden"> ${e(a.title)} (${e(upper(a.format))}, ${e(fileSize(a.size))})</span></a>`).join("");
  return `<li class="lg-card"><div class="lg-card__stage">${stage}</div><div class="lg-card__body"><p class="lg-card__name">${e(first.title)}</p><p class="muted small">${e([...facts, [...new Set(group.map((a) => upper(a.format)))].join(" · ")].filter(Boolean).join(" · "))}</p><div class="lg-card__actions">${buttons}</div></div></li>`;
}

const select = (name, label, options, id) => `<label class="lg-field" for="${e(id)}"><span class="lg-field__label">${e(label)}</span><select id="${e(id)}" name="${e(name)}"><option value="">Skip</option>${Object.entries(options).map(([v, l]) => `<option value="${e(v)}">${e(l)}</option>`).join("")}</select></label>`;

/** One row of the review form for file number i (the page script clones this template for every chosen file; without script the single row is the plain fallback). */
const detailFields = (i) => `<div class="lg-fields">${select(`type_${i}`, "Logo type", LOGO_TYPE_LABEL, `lg-type-${i}`)}${select(`colour_${i}`, "Logo colour", LOGO_COLOUR_LABEL, `lg-colour-${i}`)}${select(`background_${i}`, "Background", LOGO_BACKGROUND_LABEL, `lg-bg-${i}`)}</div>`;

/**
 * The upload form. The file input is the "+ Upload logos" button (a label over a visually hidden input), so the browser's own picker opens on every device. With the page script, choosing
 * files opens the review sheet (a preview, a name and the three optional details per file, and Upload / Cancel); without it, a visible plain form posts one file with its details.
 */
function uploadForm(vm, { csrf, limits }) {
  const maxMb = limits ? Math.floor(limits.maxFileBytes / MB) : 25;
  return `<form class="lg-form" id="lg-form" method="post" action="${e(href(vm, "/branding/logos"))}" enctype="multipart/form-data" novalidate data-max-bytes="${limits ? e(String(limits.maxFileBytes)) : ""}" data-max-files="${MAX_LOGO_FILES}">
<input type="hidden" name="csrf" value="${e(csrf)}">
<input class="lg-input" id="lg-files" name="file" type="file" multiple accept="${e(LOGO_ACCEPT)}" aria-describedby="lg-help">
<p class="muted small lg-help" id="lg-help">PNG, JPG, WebP, SVG, PDF, AI, EPS or ZIP. Up to ${maxMb} MB each, ${MAX_LOGO_FILES} files at a time. You don’t have to fill in the details.</p>
<div class="lg-nojs"><div class="lg-row lg-row--plain">${detailFields(0)}</div><p class="step-nav"><button class="btn btn--primary" type="submit">Upload logo</button></p></div>
<div class="lg-sheet" id="lg-sheet" role="dialog" aria-modal="true" aria-labelledby="lg-sheet-h" hidden><div class="lg-sheet__panel"><div class="lg-sheet__head"><h2 class="h3" id="lg-sheet-h">Review your files</h2><p class="muted small">Add details if you like. You can upload without them.</p></div><ul class="lg-list" id="lg-list"></ul><p class="lg-sheet__status muted small" id="lg-status" role="status"></p><div class="lg-sheet__actions"><button class="btn" type="button" id="lg-cancel">Cancel</button><button class="btn btn--primary" type="submit" id="lg-submit">Upload</button></div></div></div>
<template id="lg-row-template"><li class="lg-row"><div class="lg-row__thumb"></div><div class="lg-row__main"><p class="lg-row__name"></p><p class="muted small lg-row__note"></p>${detailFields("{i}")}</div><button class="btn btn--small btn--quiet lg-row__remove" type="button">Remove</button></li></template>
</form>`;
}

/** What happened to each file of the last upload (shown on the page the form posts back to). */
function resultList(results, errors) {
  if (!results || !results.length) return "";
  const rows = results.map((r) => `<li class="lg-result lg-result--${r.ok ? "ok" : "bad"}"><span class="lg-result__mark" aria-hidden="true">${r.ok ? "✓" : "!"}</span><div><p class="lg-result__name">${e(r.name || "File")}</p><p class="small">${r.ok ? (r.duplicate ? "Already in your library. Nothing was added twice." : "Uploaded.") : e(errors[r.error] || errors.invalid || "That file couldn’t be uploaded.")}</p></div></li>`).join("");
  const failed = results.filter((r) => !r.ok).length;
  const note = failed ? `<p class="muted small">Choose the files that didn’t upload again to retry them. Files that did upload won’t be uploaded twice.</p>` : "";
  return `<section class="lg-results" aria-labelledby="lg-results-h" tabindex="-1" data-error-summary><h2 class="h3" id="lg-results-h">${failed ? `${results.length - failed} of ${results.length} uploaded` : "Uploaded"}</h2><ul class="lg-result-list">${rows}</ul>${note}</section>`;
}

/**
 * The logo library view.
 * @param o { uploads (the organization's own files, all categories), assets (Framework-published brand assets), labels, canUpload, canDelete, csrf, limits, results, errors, notice, offerHtml, bannerError }
 */
export function logoLibrary(vm, o = {}) {
  const { banner: extraBanner = "", uploads = [], assets = [], labels, canUpload = false, canDelete = false, csrf = "", limits = null, results = null, errors = {}, notice = "", offerHtml = "", bannerError = "" } = o;
  const mine = uploads.filter((u) => u.category === "logo");
  const groups = new Map();
  for (const a of assets.filter((x) => x.kind === "logo")) { const k = a.variantKey || a.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(a); }
  const cards = [...mine.map((u) => uploadCard(vm, u, { canDelete, csrf })), ...[...groups.values()].map((g) => assetCard(vm, g, labels))].join("");
  const empty = `<div class="empty"><strong>No logos yet</strong>${canUpload ? "Use Upload logos to add your logo files. You can add as many versions as you like." : "Logo files appear here once your team or Framework adds them."}</div>`;
  const button = canUpload ? `<label class="btn btn--primary lg-upload" for="lg-files"><span aria-hidden="true">+</span> Upload logos</label>` : "";
  const banner = bannerError ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(bannerError)}</p>` : notice ? `<p class="form-banner" role="status">${e(notice)}</p>` : "";
  const count = mine.length + groups.size;
  const usage = limits && o.usage ? `<p class="muted small">${o.usage.files} of ${limits.maxFiles} files used · ${e(fileSize(o.usage.bytes))} of ${e(fileSize(limits.quotaBytes))}. Files are private to your organization and Framework.</p>` : "";
  const head = viewHeader(vm, { title: "Logos", lead: "Your logo library. Download any version, any time.", actions: button });
  return `${head}${banner}${extraBanner}${resultList(results, errors)}${canUpload ? uploadForm(vm, { csrf, limits }) : `<p class="muted small">Your role can view and download logos but not upload them.</p>`}<section aria-labelledby="h-lib"><h2 class="h2 visually-hidden" id="h-lib">Logo files</h2>${count ? `<ul class="lg-grid">${cards}</ul>` : empty}</section>${usage}${offerHtml ? `<details class="lg-more" id="logo-variations"><summary class="lg-more__sum">Need a logo variation?</summary><div class="lg-more__body">${offerHtml}</div></details>` : ""}`;
}
