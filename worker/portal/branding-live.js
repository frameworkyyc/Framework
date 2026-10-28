/**
 * Pages of the connected Branding section (Phase 3). Rendered only from what the tenant guard already scoped to the member's OWN organization:
 * the published brand kit (repo/brand.js getClientBrand: never drafts, keys or hashes) and that organization's own uploads. Like every portal page there is
 * no inline style and no inline script; colour swatches are SVG fills, and /assets/js/portal-branding.js only adds a "Copy" button for colour codes.
 * Every file link is a plain link to a route that re-checks organization, publication and permission, so nothing here is a capability by itself.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { UPLOAD_CATEGORIES } from "./repo/brand.js";
import { BRAND_REQUESTS } from "./brand-services.js";
import { LOGO_VARIATIONS } from "../../admin/assets/logo-variations.js";

const href = (vm, p) => `${vm.base}${p}`;
const MB = 1024 * 1024;

export const CATEGORY_LABEL = Object.freeze({ logo: "Logo", fonts: "Fonts", colours: "Colours", guidelines: "Brand guidelines", stationery: "Stationery", signature: "Email signature", other: "Other" });
const ROLE_LABEL = { primary: "Primary logo", simplified: "Simplified logo", icon: "Icon" };
const ORIENTATION_LABEL = { horizontal: "Horizontal", vertical: "Vertical", square: "Square" };
const TONE_LABEL = { light: "For light backgrounds", dark: "For dark backgrounds", colour: "Full colour", mono: "Single colour" };
const TYPE_ROLE_LABEL = { logo: "Logo", heading: "Headings", subheading: "Subheadings", body: "Body text", other: "Other" };
const COLOUR_ROLE_LABEL = { primary: "Primary", secondary: "Secondary", accent: "Accent", neutral: "Neutral" };
const DOC_KINDS = ["guideline", "document", "package", "other"];
const DOC_LABEL = { guideline: "Guidelines", document: "Documents", package: "Packages", other: "Other files" };
const IMAGE_FORMATS = ["svg", "png", "webp", "jpg"];

export function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < MB) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / MB).toFixed(bytes < 10 * MB ? 1 : 0)} MB`;
}

const rgb = (hex) => `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`;
const upper = (f) => String(f || "").toUpperCase();
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);
const dateOnly = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Edmonton" }); };

/* ------------------------------------------------------------------ the Branding page */

const downloadLink = (vm, a, label) => `<a class="btn btn--small" href="${e(href(vm, `/branding/files/${a.id}`))}" download>${label}<span class="visually-hidden"> ${e(a.title)} (${e(upper(a.format))}, ${e(fileSize(a.size))})</span></a>`;
const previewUrl = (vm, a) => href(vm, `/branding/files/${a.id}?preview=1`);

/** A stable order for formats (vector first), so buttons and summaries never depend on the order rows came back in. */
const formatRank = (f) => { const i = IMAGE_FORMATS.indexOf(f); return i < 0 ? IMAGE_FORMATS.length : i; };
const byFormat = (a, b) => formatRank(a.format) - formatRank(b.format) || a.format.localeCompare(b.format);

/** Logo files that are the same variation in several formats are one card with one download button per format. */
function logoGroups(assets) {
  const groups = new Map();
  for (const a of assets.filter((x) => x.kind === "logo")) {
    const key = a.variantKey || a.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups.values()].map((files) => files.sort(byFormat));
}

function logoCard(vm, files) {
  const first = files[0];
  const shown = IMAGE_FORMATS.map((f) => files.find((a) => a.format === f)).find(Boolean);
  const dark = first.tone === "dark"; // a logo meant for dark backgrounds is shown on a dark tile so it is visible
  const meta = [ROLE_LABEL[first.logoRole], ORIENTATION_LABEL[first.orientation], TONE_LABEL[first.tone], first.transparent ? "Transparent background" : ""].filter(Boolean);
  const stage = shown
    ? `<div class="logo-card__stage${dark ? " logo-card__stage--dark" : ""}"><img src="${e(previewUrl(vm, shown))}" alt="${e(first.title)}" loading="lazy" decoding="async"></div>`
    : `<div class="logo-card__stage logo-card__stage--none"><span class="muted small">No preview for this format</span></div>`;
  const buttons = files.map((a) => downloadLink(vm, a, `Download ${e(upper(a.format))}`)).join("");
  return `<li class="logo-card">${stage}<div class="logo-card__body"><p class="logo-card__title">${e(first.title)}</p>${meta.length ? `<p class="muted small">${e(meta.join(" · "))}</p>` : ""}${first.usageNote ? `<p class="small">${e(first.usageNote)}</p>` : ""}<div class="logo-card__actions">${buttons}</div></div></li>`;
}

function swatch(c) {
  // The fill is an SVG presentation attribute (not an inline style, so it is allowed by the portal's CSP). The colour is also written out in words and numbers,
  // so it never depends on being seen. The Copy button is added by script; without script the code is still selectable text.
  const light = parseInt(c.hex.slice(1, 3), 16) > 235 && parseInt(c.hex.slice(3, 5), 16) > 235 && parseInt(c.hex.slice(5, 7), 16) > 235;
  return `<li class="swatch"><svg class="swatch__chip${light ? " swatch__chip--edge" : ""}" viewBox="0 0 100 60" role="img" aria-label="${e(c.name)}, ${e(c.hex)}" focusable="false"><rect width="100" height="60" fill="${e(c.hex)}"/></svg>
<div class="swatch__body"><p class="swatch__name">${e(c.name)}</p><p class="muted small">${e(COLOUR_ROLE_LABEL[c.role] || "")}</p><p class="swatch__code"><code>${e(c.hex)}</code> <button class="copy" type="button" data-copy="${e(c.hex)}" hidden>Copy<span class="visually-hidden"> ${e(c.name)} ${e(c.hex)}</span></button></p><p class="muted small">RGB ${e(rgb(c.hex))}</p>${c.note ? `<p class="small">${e(c.note)}</p>` : ""}</div></li>`;
}

function typeface(vm, t, fontFiles) {
  const files = fontFiles.filter((f) => f.title.toLowerCase().includes(t.family.toLowerCase()));
  const weights = t.weights && t.weights.length ? `Weights ${t.weights.join(", ")}` : "";
  return `<li class="type"><p class="type__family">${e(t.family)}</p><p class="muted small">${e([TYPE_ROLE_LABEL[t.role], weights].filter(Boolean).join(" · "))}</p>${t.usage ? `<p class="small">${e(t.usage)}</p>` : ""}${isHttps(t.source_url) ? `<p class="small"><a class="text-link" href="${e(t.source_url)}" rel="noopener noreferrer" target="_blank">Get this font<span class="visually-hidden"> (${e(t.family)}, opens the font provider)</span></a></p>` : ""}${files.length ? `<div class="logo-card__actions">${files.map((a) => downloadLink(vm, a, `Download ${e(upper(a.format))}`)).join("")}</div>` : ""}</li>`;
}

function docRow(vm, a) {
  return `<li class="file-row"><div class="file-row__main"><p class="file-row__name">${e(a.title)}</p><p class="muted small">${e(upper(a.format))} · ${e(fileSize(a.size))}${a.usageNote ? ` · ${e(a.usageNote)}` : ""}</p></div>${downloadLink(vm, a, "Download")}</li>`;
}

/**
 * One accordion section: a native <details>, so it opens and closes with no script and is keyboard- and screen-reader-operable. It is rendered closed (compact on a
 * phone); /assets/js/portal-branding.js only opens the one a link (#hash) points at. `summary` is the concise line shown while closed.
 */
function section(id, title, summary, intro, inner, open = false) {
  return `<details class="acc" id="${id}"${open ? " open" : ""}><summary class="acc__head"><span class="acc__text"><h2 class="acc__title">${e(title)}</h2><span class="acc__sum">${e(summary)}</span></span><span class="acc__chev" aria-hidden="true"></span></summary><div class="acc__body">${intro ? `<p class="muted brand-section__intro">${e(intro)}</p>` : ""}${inner}</div></details>`;
}
const count = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const list = (items) => items.join(" · ");

/* ------------------------------------------------------------------ the four logo variations */

export { LOGO_VARIATIONS };
const ROLE_TO_VARIATION = Object.freeze({ primary: "primary", secondary: "secondary", simplified: "simplified", icon: "submark" });
/** Which variation a logo file belongs to, from the type Admin chose, or null when none was chosen (older files): those are listed separately, never guessed into a card. */
export const variationOf = (a) => (a && a.kind === "logo" ? ROLE_TO_VARIATION[a.logoRole] || null : null);

const TONE_RANK = { light: 0, colour: 1, mono: 2, dark: 3 };

/** The files of one variation grouped into versions (same shape, background and transparency), each version with its formats in the usual order. */
function versionsOf(files) {
  const groups = new Map();
  for (const a of files) {
    const key = `${a.orientation || ""}|${a.tone || ""}|${a.transparent ? 1 : 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(a);
  }
  return [...groups.values()].map((list) => list.sort(byFormat)).sort((x, y) => (TONE_RANK[x[0].tone] ?? 9) - (TONE_RANK[y[0].tone] ?? 9) || String(x[0].orientation).localeCompare(String(y[0].orientation)) || Number(Boolean(y[0].transparent)) - Number(Boolean(x[0].transparent)));
}
const versionLabel = (v) => [ORIENTATION_LABEL[v[0].orientation], TONE_LABEL[v[0].tone], v[0].transparent ? "Transparent background" : ""].filter(Boolean).join(" · ");
const previewable = (v) => IMAGE_FORMATS.map((f) => v.find((a) => a.format === f)).find(Boolean) || null;

function downloads(vm, version) { return version.map((a) => downloadLink(vm, a, `Download ${e(upper(a.format))}`)).join(""); }

/** A card whose variation has published files: the real preview, what it contains and a download button per format (all versions under "All versions" when there is more than one). */
function variationCard(vm, def, files) {
  const versions = versionsOf(files);
  const first = versions[0];
  const shownVersion = versions.find((v) => previewable(v)) || first;
  const shown = previewable(shownVersion);
  const dark = shownVersion[0].tone === "dark"; // a logo for dark backgrounds sits on a dark tile so it is visible
  const stage = shown
    ? `<div class="lv-card__stage lv-card__stage--logo${dark ? " lv-card__stage--dark" : ""}"><img src="${e(previewUrl(vm, shown))}" alt="${e(def.title)}${shownVersion[0].title ? `: ${e(shownVersion[0].title)}` : ""}" loading="lazy" decoding="async"></div>`
    : `<div class="lv-card__stage lv-card__stage--file"><span class="muted small">No preview for this format. Download it below.</span></div>`;
  const formats = [...new Set(files.slice().sort(byFormat).map((a) => upper(a.format)))].join(" · ");
  const more = versions.length > 1
    ? `<details class="lv-more"><summary>All versions (${versions.length})</summary><ul class="lv-more__list">${versions.map((v) => `<li><p class="small">${e(versionLabel(v) || v[0].title)}</p><div class="lv-card__actions">${downloads(vm, v)}</div></li>`).join("")}</ul></details>`
    : "";
  return `<li class="lv-card lv-card--has">${stage}<div class="lv-card__body"><p class="lv-card__no" aria-hidden="true">${e(def.no)}</p><h3 class="lv-card__title">${e(def.title)}</h3><p class="lv-card__status"><span class="tag">Available</span></p><p class="lv-card__desc muted">${e(def.desc)}</p><p class="lv-card__meta muted small">${e([formats, versions.length === 1 ? versionLabel(first) : `${versions.length} versions`].filter(Boolean).join(" · "))}</p><div class="lv-card__actions">${downloads(vm, versions.length > 1 ? shownVersion : first)}</div>${more}</div></li>`;
}

/**
 * A card whose variation has no published file yet: Framework's own logo for that variation (a static public image, 16:9, never cropped or stretched), the subtle label
 * "Example: Framework", the status "Not added yet" and what the variation is for. No link and no download: an example is not a client asset and is not in private storage.
 */
function exampleCard(def) {
  return `<li class="lv-card lv-card--example"><div class="lv-card__stage lv-card__stage--example"><img src="${e(def.example)}" alt="${e(def.alt)}" width="1920" height="1080" loading="lazy" decoding="async"></div><div class="lv-card__body"><p class="lv-card__no" aria-hidden="true">${e(def.no)}</p><h3 class="lv-card__title">${e(def.title)}</h3><p class="lv-card__status"><span class="tag">Not added yet</span></p><p class="lv-card__desc muted">${e(def.desc)}</p><p class="lv-card__meta muted small">Example: Framework</p></div></li>`;
}

const REQUEST_STATUS = Object.freeze({
  new: ["Requested", "Framework has your request and will follow up."],
  contacted: ["In progress", "Framework has been in touch about this request."],
  closed: ["Closed", "Your last request is closed."],
  declined: ["Declined", "Framework couldn’t take on your last request."],
});

/**
 * The request control under a section. One request per section can be open at a time (a database rule, so it holds even if the button is pressed twice): while one is
 * open the page shows its status instead of a button; once it is closed or declined a new one can be sent. Only an owner can send one; everyone sees the status.
 * `r` is the newest request for this section, or undefined.
 */
function requestControl(vm, def, { r, canRequest, csrf, label, primary = false }) {
  const open = r && (r.status === "new" || r.status === "contacted");
  const [word, line] = r ? REQUEST_STATUS[r.status] || ["", ""] : ["", ""];
  const status = r ? `<p class="brq__status"><span class="tag">${e(word)}</span> <span class="muted small">${e(line)} Sent ${e(dateOnly(r.createdAt))}.</span></p>` : "";
  if (open) return status;
  if (!canRequest) return `${status}<p class="muted small">Ask an owner of your organization to send a request${def.key === "brand-full-kit" ? "" : " for this section"}.</p>`;
  return `${status}<details class="brq"><summary class="btn ${primary ? "btn--primary" : "btn--small"}">${e(label)}<span class="visually-hidden">: ${e(def.section)}</span></summary>
<form method="post" action="${e(href(vm, "/branding/request"))}"><input type="hidden" name="csrf" value="${e(csrf)}"><input type="hidden" name="section" value="${e(def.key)}">
<div class="field"><label for="req-${e(def.key)}">Anything we should know? (optional)</label><textarea id="req-${e(def.key)}" name="note" rows="3" maxlength="1000"></textarea></div>
<p class="step-nav"><button class="btn btn--primary" type="submit">Send request</button></p></form></details>`;
}

const SECTION_COPY = Object.freeze({
  "brand-colours": "No brand colours have been added yet.",
  "brand-typography": "No typefaces or fonts have been added yet.",
  "brand-guidelines": "No guidelines or documents have been added yet.",
  "brand-additional": "No additional brand assets have been added yet.",
});

/**
 * The Branding dashboard. Every client always sees the same five sections, whatever Framework has published for them: a section with files shows them (with the
 * existing viewing and download links), an empty one says so and is open so its Request button is in view, and every section lets an owner request additions or
 * changes. A Full Brand Kit request sits at the bottom.
 * @param brand   getClientBrand() result
 * @param o       { canUpload, uploadCount, brandName, canRequest, csrf, requests: { [key]: newest request }, notice: "sent" | "dup" | "" }
 */
export function brandingOverview(vm, brand, { canUpload = false, uploadCount = 0, brandName = "", canRequest = false, csrf = "", requests = {}, notice = "" } = {}) {
  const live = Boolean(brand.published);
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Branding"]])}<h1 class="h1 h1--section">Branding</h1><p class="lead">${live ? `${brandName ? `The approved ${e(brandName)} brand` : "Your approved brand"}: logos, colours, fonts and guidelines. Download what you need, any time.` : "Your logos, colours, fonts and guidelines in one place. Anything that isn’t here yet can be requested below."}</p></header>`;
  const banner = notice === "sent" ? `<p class="form-banner" role="status">Request sent. Framework will follow up.</p>` : notice === "dup" ? `<p class="form-banner" role="status">That request is already open, so we didn’t send it twice.</p>` : "";

  const assets = live ? brand.assets || [] : [];
  const colours = live ? brand.colours || [] : [];
  const fonts = assets.filter((a) => a.kind === "font");
  const fontFiles = fonts.filter((a) => a.canDownload);
  const type = live ? brand.typography || [] : [];
  const guideDocs = ["guideline", "document"].map((k) => [k, assets.filter((a) => a.kind === k)]).filter(([, l]) => l.length);
  const extraDocs = ["package", "other"].map((k) => [k, assets.filter((a) => a.kind === k)]).filter(([, l]) => l.length);
  const reqDef = (key) => BRAND_REQUESTS.find((d) => d.key === key);
  const isOpen = (key) => requests[key] && (requests[key].status === "new" || requests[key].status === "contacted");
  const sum = (key, text) => (isOpen(key) ? `${text} · Request open` : text);
  const control = (key, hasContent) => requestControl(vm, reqDef(key), { r: requests[key], canRequest, csrf, label: hasContent ? "Request additions or changes" : "Request" });
  const groups = (docs) => docs.map(([k, l]) => `${docs.length > 1 ? `<p class="acc__group">${e(DOC_LABEL[k])}</p>` : ""}<ul class="file-list">${l.map((a) => docRow(vm, a)).join("")}</ul>`).join("");
  const empty = (key) => `<div class="empty"><strong>Nothing here yet</strong>${e(SECTION_COPY[key])}</div>`;
  const total = (docs) => docs.reduce((n, [, l]) => n + l.length, 0);

  const parts = [];
  const logoFiles = assets.filter((a) => a.kind === "logo");
  const byVariation = new Map(LOGO_VARIATIONS.map((d) => [d.key, []]));
  const unassigned = [];
  for (const a of logoFiles) { const k = variationOf(a); if (k) byVariation.get(k).push(a); else unassigned.push(a); }
  const filled = LOGO_VARIATIONS.filter((d) => byVariation.get(d.key).length).length;
  const logoFormats = [...new Set(logoFiles.slice().sort(byFormat).map((x) => upper(x.format)))];
  const logoSummary = filled ? list([`${filled} of 4 variations`, logoFormats.join(", ")]) : unassigned.length ? count(logoGroups(unassigned).length, "logo") : "Not added yet";
  const cards = LOGO_VARIATIONS.map((d) => (byVariation.get(d.key).length ? variationCard(vm, d, byVariation.get(d.key)) : exampleCard(d))).join("");
  const others = unassigned.length ? `<p class="acc__group">Other logo files</p><ul class="logo-grid">${logoGroups(unassigned).map((g) => logoCard(vm, g)).join("")}</ul>` : "";
  const examples = filled < 4 ? `<p class="muted small">Cards labelled “Example: Framework” show Framework’s own logo to illustrate that variation. They are not your logos and are not available to download.</p>` : "";
  // The Logos section is always open: its four cards are the page's centrepiece.
  parts.push(section("logos", "Logos", sum("brand-logos", logoSummary), "Four logo variations, each for a different use.", `<ul class="lv-grid">${cards}</ul>${examples}${others}${control("brand-logos", logoFiles.length > 0)}`, true));

  if (colours.length) parts.push(section("colours", "Colours", sum("brand-colours", count(colours.length, "colour")), "", `<ul class="swatches">${colours.map(swatch).join("")}</ul>${control("brand-colours", true)}`));
  else parts.push(section("colours", "Colours", sum("brand-colours", "Not added yet"), "", empty("brand-colours") + control("brand-colours", false), true));

  if (type.length || fonts.length) {
    const unlisted = fontFiles.filter((f) => !type.some((t) => f.title.toLowerCase().includes(t.family.toLowerCase())));
    const note = fonts.some((f) => !f.canDownload) ? `<p class="muted small">Some fonts can’t be shared as files because of their licence. Use the link beside each one to get it from its provider, or ask us.</p>` : "";
    const names = type.map((t) => t.family);
    parts.push(section("typography", "Typography & Fonts", sum("brand-typography", names.length ? list([count(names.length, "typeface"), names.slice(0, 2).join(", ") + (names.length > 2 ? "…" : "")]) : count(fontFiles.length, "font file")), "", `${type.length ? `<ul class="types">${type.map((t) => typeface(vm, t, fontFiles)).join("")}</ul>` : ""}${unlisted.length ? `<ul class="file-list">${unlisted.map((a) => docRow(vm, a)).join("")}</ul>` : ""}${note}${control("brand-typography", true)}`));
  } else parts.push(section("typography", "Typography & Fonts", sum("brand-typography", "Not added yet"), "", empty("brand-typography") + control("brand-typography", false), true));

  if (guideDocs.length) parts.push(section("guidelines", "Brand Guidelines & Documents", sum("brand-guidelines", count(total(guideDocs), "file")), "How to use your brand consistently.", groups(guideDocs) + control("brand-guidelines", true)));
  else parts.push(section("guidelines", "Brand Guidelines & Documents", sum("brand-guidelines", "Not added yet"), "", empty("brand-guidelines") + control("brand-guidelines", false), true));

  if (extraDocs.length) parts.push(section("additional", "Additional Brand Assets", sum("brand-additional", count(total(extraDocs), "file")), "", groups(extraDocs) + control("brand-additional", true)));
  else parts.push(section("additional", "Additional Brand Assets", sum("brand-additional", "Not added yet"), "", empty("brand-additional") + control("brand-additional", false), true));

  const share = canUpload
    ? `<aside class="brand-aside" aria-labelledby="h-share"><h2 class="h3" id="h-share">Have brand materials of your own?</h2><p class="muted">Share your existing logo, fonts or guidelines and Framework will review them.</p><p><a class="btn" href="${e(href(vm, "/branding/uploads"))}">Upload your materials${uploadCount ? ` (${uploadCount} shared)` : ""}</a></p></aside>`
    : "";
  const kit = `<section class="brand-kit" aria-labelledby="h-kit"><h2 class="h2" id="h-kit">Need a complete brand identity?</h2><p class="muted">Logo, colours, typography and guidelines, designed together as one system.</p>${requestControl(vm, reqDef("brand-full-kit"), { r: requests["brand-full-kit"], canRequest, csrf, label: "Request full brand kit", primary: true })}</section>`;
  const meta = brand.publishedAt && live ? `<p class="muted small">Last published ${e(dateOnly(brand.publishedAt))}.</p>` : "";
  return head + banner + `<div class="acc-list">${parts.join("")}</div>` + meta + share + kit;
}

/* ------------------------------------------------------------------ the uploads area */

export const UPLOAD_ERRORS = Object.freeze({
  no_file: "Choose a file to upload.",
  empty_file: "That file is empty.",
  file_too_large: "That file is too large.",
  invalid_name: "That file can’t be uploaded. Use an image, PDF, font, Office document or ZIP, and check the file name.",
  content_mismatch: "That file doesn’t look like the kind of file its name says. Check it opens on your computer, then try again.",
  active_content: "That file contains scripts or embedded content we can’t accept. Export a plain version and try again.",
  image_dimensions: "That image is too large or has unusual dimensions. Export a smaller version and try again.",
  pdf_encrypted: "That PDF is password-protected. Upload an unlocked copy.",
  archive_encrypted: "That ZIP is password-protected. Upload an unlocked copy.",
  archive_entries: "That ZIP holds too many files. Send fewer, or split it up.",
  archive_too_large: "That ZIP expands to more than we can accept. Send a smaller one.",
  archive_unsafe_entry: "That ZIP contains files we can’t accept. Send the files without it, or remove the unusual ones.",
  archive_unsupported: "That ZIP uses a format we can’t read. Create a standard ZIP and try again.",
  type_not_allowed: "That kind of file can’t be uploaded. Use an image, PDF, font, Office document or ZIP.",
  invalid_category: "Choose what the file is.",
  font_rights_required: "Please confirm you have the right to share this font.",
  file_limit: "Your organization has reached its limit on the number of files. Remove one to add another.",
  quota_exceeded: "That would go over your organization’s storage allowance. Remove a file to make room.",
  forbidden: "You don’t have permission to do that.",
  storage_unavailable: "File storage isn’t available right now. Nothing was uploaded. Please try again shortly.",
  storage_write_failed: "We couldn’t store that file. Nothing was uploaded. Please try again.",
  csrf: "Your session expired. Please try again.",
  too_many: "You’ve uploaded several files recently. Please try again in a minute.",
  invalid: "That upload couldn’t be read. Please try again.",
});

const NOTES = { uploaded: "Uploaded. Framework will review it.", removed: "File removed." };

function uploadRow(vm, u, { canDelete, csrf }) {
  const status = u.held ? `<span class="tag">On hold</span> ` : "";
  const dl = u.held ? `<span class="muted small">Not available to download while on hold</span>` : `<a class="btn btn--small" href="${e(href(vm, `/branding/uploads/${u.id}/download`))}" download>Download<span class="visually-hidden"> ${e(u.name)}</span></a>`;
  const del = canDelete
    ? `<details class="remove"><summary class="btn btn--small btn--quiet">Remove<span class="visually-hidden"> ${e(u.name)}</span></summary><form method="post" action="${e(href(vm, `/branding/uploads/${u.id}/delete`))}"><input type="hidden" name="csrf" value="${e(csrf)}"><p class="small">Remove this file? Framework will no longer be able to open it.</p><button class="btn btn--small btn--primary" type="submit">Yes, remove</button></form></details>`
    : "";
  return `<li class="file-row"><div class="file-row__main"><p class="file-row__name">${status}${e(u.name)}</p><p class="muted small">${e(CATEGORY_LABEL[u.category] || "Other")} · ${e(upper(u.format))} · ${e(fileSize(u.size))} · ${e(dateOnly(u.createdAt))}</p></div><div class="file-row__actions">${dl}${del}</div></li>`;
}

/**
 * @param o { uploads, canUpload, canDelete, csrf, limits, usage, notice, error, status }
 */
export function brandingUploads(vm, { uploads = [], canUpload = false, canDelete = false, csrf = "", limits, usage = { files: 0, bytes: 0 }, notice = "", error = "" } = {}) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Branding", "/branding"], ["Your brand materials"]])}<h1 class="h1 h1--section">Your brand materials</h1><p class="lead">Share the logos, fonts and guidelines you already have. Framework reviews them, and they stay separate from your approved brand assets.</p></header>`;
  const banner = error
    ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(UPLOAD_ERRORS[error] || UPLOAD_ERRORS.invalid)}</p>`
    : NOTES[notice] ? `<p class="form-banner" role="status">${e(NOTES[notice])}</p>` : "";
  const maxMb = Math.floor(limits.maxFileBytes / MB);
  const form = canUpload
    ? `<form class="upload" method="post" action="${e(href(vm, "/branding/uploads"))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(csrf)}">
<div class="questions"><div class="field"><label for="up-category">What is it?</label><select id="up-category" name="category" required>${UPLOAD_CATEGORIES.map((c) => `<option value="${c}">${e(CATEGORY_LABEL[c])}</option>`).join("")}</select></div>
<div class="field"><label for="up-file">File</label><span class="field__hint" id="up-file-h">PNG, JPG, WebP, SVG, PDF, AI, EPS, fonts (TTF, OTF, WOFF), Office documents or ZIP. Up to ${maxMb} MB each. ZIP files are kept as they are and can only be downloaded.</span><input id="up-file" name="file" type="file" required aria-describedby="up-file-h"></div>
<div class="field choice"><label class="choice__opt"><input type="checkbox" name="font_rights" value="1"><span>This is a font and I have the right to share it with Framework</span></label><span class="field__hint">Required for font files. We only use fonts you license for your own brand.</span></div></div>
<p class="step-nav"><button class="btn btn--primary" type="submit">Upload file</button></p>
<p class="muted small">${usage.files} of ${limits.maxFiles} files used · ${e(fileSize(usage.bytes))} of ${e(fileSize(limits.quotaBytes))}. Files are private to your organization and Framework.</p></form>`
    : `<p class="muted">Your role can view uploaded files but not add new ones.</p>`;
  const list = uploads.length
    ? `<ul class="file-list">${uploads.map((u) => uploadRow(vm, u, { canDelete, csrf })).join("")}</ul>`
    : `<div class="empty"><strong>No files shared yet</strong>Files you upload appear here. Anyone in your organization can see them.</div>`;
  const note = !canDelete && uploads.length ? `<p class="muted small">Only an owner of your organization can remove shared files.</p>` : "";
  return `${head}${banner}<section aria-labelledby="h-add"><h2 class="h2" id="h-add">Add a file</h2>${form}</section><section aria-labelledby="h-shared"><h2 class="h2" id="h-shared">Shared with Framework</h2>${list}${note}</section>`;
}
