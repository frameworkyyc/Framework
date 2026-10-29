/**
 * Pages of the connected Branding section (Phase 3). Rendered only from what the tenant guard already scoped to the member's OWN organization:
 * the published brand kit (repo/brand.js getClientBrand: never drafts, keys or hashes) and that organization's own uploads. Like every portal page there is
 * no inline style and no inline script; colour swatches are SVG fills, and /assets/js/portal-branding.js only adds a "Copy" button for colour codes.
 * Every file link is a plain link to a route that re-checks organization, publication and permission, so nothing here is a capability by itself.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { UPLOAD_CATEGORIES } from "./repo/brand.js";
import { BRAND_REQUESTS, BRANDING_SERVICES } from "./brand-services.js";
import { LOGO_VARIATIONS } from "../../admin/assets/logo-variations.js";
import { BRAND_SECTIONS, TYPE_SLOT_DEFS, sectionOf } from "../../admin/assets/brand-sections.js";
import { typefaceOf, filesOf, specimenSlots, faceOf, WEIGHT_NAME } from "./brand-type.js";
import { requirementsFor, completionOf, REQUIREMENT_LABEL } from "./brand-requirements.js";
import { designOffer, designOfferList, requestKeyOf, priceLabel, ESTIMATE_NOTE } from "./branding-pricing.js";
import { exampleTypeCard, exampleColours, exampleTagline, exampleImagery, exampleLayout, exampleTextures, exampleIcons, exampleStyle, EXAMPLE_LABEL } from "./brand-examples.js";

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
<div class="swatch__body"><p class="swatch__name">${e(c.name)}</p><p class="muted small">${e(COLOUR_ROLE_LABEL[c.role] || "")}</p><p class="swatch__code"><code>${e(c.hex)}</code> <button class="copy" type="button" data-copy="${e(c.hex)}" hidden>Copy<span class="visually-hidden"> ${e(c.name)} ${e(c.hex)}</span></button></p><p class="swatch__code muted small">RGB <code>${e(rgb(c.hex))}</code> <button class="copy" type="button" data-copy="${e(rgb(c.hex))}" hidden>Copy<span class="visually-hidden"> ${e(c.name)} RGB ${e(rgb(c.hex))}</span></button></p>${c.note ? `<p class="small">${e(c.note)}</p>` : ""}</div></li>`;
}

const SAMPLE_TEXT = "The quick brown fox jumps over the lazy dog";

/** One typeface: its name, role, the weights Framework set up, example text, usage, a link to get it and any licensed font files. */
function typeface(vm, t, fontFiles) {
  const files = filesOf(t, fontFiles).usable;
  const weights = t.weights && t.weights.length ? `<ul class="bk-weights" aria-label="Available weights">${t.weights.map((w) => `<li>${e(WEIGHT_NAME[w] || "Weight")} <span class="muted">${e(w)}</span></li>`).join("")}</ul>` : "";
  return `<li class="type bk-type"><p class="bk-type__glyphs" aria-hidden="true">Aa</p><div class="bk-type__body"><p class="type__family">${e(t.family)}</p><p class="muted small">${e(TYPE_ROLE_LABEL[t.role] || "")}</p>${weights}<p class="bk-type__sample">${SAMPLE_TEXT}</p>${t.usage ? `<p class="small">${e(t.usage)}</p>` : ""}${isHttps(t.source_url) ? `<p class="small"><a class="text-link" href="${e(t.source_url)}" rel="noopener noreferrer" target="_blank">Get this font<span class="visually-hidden"> (${e(t.family)}, opens the font provider)</span></a></p>` : ""}${files.length ? `<div class="logo-card__actions">${files.map((a) => downloadLink(vm, a, `Download ${e(upper(a.format))}`)).join("")}</div>` : ""}</div></li>`;
}

const ALPHABET = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 & ! ? @ #"];
const STYLE_LABEL = { normal: "Normal", italic: "Italic" };
const NO_SHARE_NOTE = "This font’s licence doesn’t allow sharing the file. Use the link to get it from its provider, or ask us.";

/** One of the three typeface slots, laid out like a Logo card: a 16:9 specimen frame, then the role, family, weights and styles, characters, usage and downloads. */
function typeCard(vm, def, raw, fonts, spec) {
  const t = typefaceOf(raw);
  const { all, usable } = filesOf(t, fonts);
  const cls = spec ? `sp-${def.key}` : "";
  const faces = spec ? spec.faces : [];
  const weights = t.weights.length ? `<ul class="bk-weights" aria-label="Approved weights">${t.weights.map((w) => `<li>${e(WEIGHT_NAME[w] || "Weight")} <span class="muted">${e(w)}</span></li>`).join("")}</ul>` : "";
  const styles = t.styles.length ? `<p class="muted small">Styles: ${e(t.styles.map((x) => STYLE_LABEL[x]).join(", "))}</p>` : "";
  const lines = spec ? t.weights.filter((w) => faces.some((f) => f.weight === w && f.style === "normal")).map((w) => `<p class="tf-card__weight ${cls} fw-w${w}"><span class="tf-card__wname">${e(WEIGHT_NAME[w])} ${e(w)}</span> The quick brown fox jumps over the lazy dog</p>`).join("") : "";
  const stage = `<div class="tf-card__stage${spec ? "" : " tf-card__stage--fallback"}"><p class="tf-card__aa ${cls}">Aa Bb Cc 123</p>${spec ? "" : `<span class="tag tf-card__flag">Fallback preview</span>`}</div>`;
  const note = spec
    ? `<p class="tf-card__note muted small" data-font-check="fwb-${e(def.key)}" data-ok="Specimen set in the font file Framework uploaded for you." data-fail="Fallback preview: your font file couldn’t be loaded here, so this is not ${e(t.family)}.">Specimen set in the font file Framework uploaded for you.</p>`
    : `<p class="tf-card__note muted small">Fallback preview: shown in this page’s own typeface, not in ${e(t.family)}.${all.length ? "" : " No font file has been added."}</p>`;
  const chars = `<div class="tf-card__chars ${cls}">${ALPHABET.map((l) => `<p>${e(l)}</p>`).join("")}</div>`;
  const get = isHttps(t.source_url) ? `<p class="small"><a class="text-link" href="${e(t.source_url)}" rel="noopener noreferrer" target="_blank">Get this font<span class="visually-hidden"> (${e(t.family)}, opens the font provider)</span></a></p>` : "";
  const dl = `${usable.length ? `<div class="lv-card__actions">${usable.map((a) => downloadLink(vm, a, `Download ${e(upper(a.format))}`)).join("")}</div>` : ""}${all.length > usable.length ? `<p class="muted small">${e(NO_SHARE_NOTE)}</p>` : ""}`;
  return `<li class="tf-card tf-card--has">${stage}<div class="tf-card__body"><p class="lv-card__no" aria-hidden="true">${e(def.no)}</p><h3 class="lv-card__title">${e(def.title)}</h3><p class="tf-card__family">${e(t.family)}</p><p class="lv-card__desc muted">${e(def.desc)}</p>${weights}${styles}${chars}${lines}${t.usage ? `<p class="small">${e(t.usage)}</p>` : ""}${note}${get}${dl}</div></li>`;
}

const LEVELS = [["Heading 1", "h1", "primary", 700, "Largest", "Headlines that stand out"], ["Heading 2", "h2", "primary", 600, "Large", "Section headlines"], ["Heading 3", "h3", "primary", 600, "Medium", "Sub-headings"], ["Body Text", "body", "secondary", 400, "Base", "Paragraphs and everyday communication read comfortably when the body font and size stay steady."], ["Caption / Small Label", "caption", "secondary", 400, "Smallest", "Captions, labels and fine print"]];

/**
 * The Typography Hierarchy: how the fonts work together. A level set in the client's own typeface shows it (in the real font when its file is available); a level whose role the
 * client hasn't set shows a muted Framework example (Switzer for headings, General Sans for text) and says so. Illustrative: no approved type scale is stored, so no sizes or
 * line heights are shown as specifications.
 */
function hierarchy(bySlot, specimen) {
  const fallbackNote = []; let examples = 0;
  const EX = { primary: ["eg-sw", "Switzer"], secondary: ["eg-gs", "General Sans"] };
  const rows = LEVELS.map(([name, key, slot, weight, size, sample]) => {
    const t = bySlot[slot];
    const meta = `<div class="tf-level__meta"><p class="tf-level__name">${e(name)}</p>`;
    const rel = `<p class="muted small">Relative size: ${e(size)}</p></div>`;
    if (!t) {
      examples++;
      const [cls, family] = EX[slot];
      return `<div class="tf-level tf-level--example">${meta}<p class="muted small">${e(EXAMPLE_LABEL)} · ${e(family)}</p>${rel}<p class="tf-level__sample tf-l-${key} ${cls} fw-w${weight}">${e(sample)}</p></div>`;
    }
    const real = specimen[slot];
    if (!real && !fallbackNote.includes(t.family)) fallbackNote.push(t.family);
    return `<div class="tf-level">${meta}<p class="muted small">${e(`${slot === "primary" ? "Primary" : "Secondary"} Typeface · ${t.family}`)}</p>${rel}<p class="tf-level__sample tf-l-${key}${real ? ` sp-${slot} fw-w${weight}` : ""}">${e(sample)}</p></div>`;
  }).join("");
  const none = examples === LEVELS.length;
  return `<div class="tf-hier" id="typography-hierarchy"><h3 class="tf-hier__title">Typography Hierarchy</h3><p class="muted">${none ? "An example of how different sizes, weights and roles work together, from the largest headline to the smallest label." : "How your fonts work together, from the largest headline to the smallest label."}</p><p class="muted small"><strong>Illustrative preview.</strong> ${none ? "This uses Framework’s typography." : ""} A formal type scale hasn’t been recorded for your brand, so these sizes and weights show the intended hierarchy only. They are not approved specifications.</p>${examples && !none ? `<p class="muted small">Rows labelled “${e(EXAMPLE_LABEL)}” stand in for roles you haven’t added yet. They are not your typefaces.</p>` : ""}${fallbackNote.length ? `<p class="muted small">Rows set in ${e(fallbackNote.join(" and "))} use a standard typeface here, because no font file is available to preview.</p>` : ""}<div class="tf-levels">${rows}</div></div>`;
}

function docRow(vm, a) {
  return `<li class="file-row"><div class="file-row__main"><p class="file-row__name">${e(a.title)}</p><p class="muted small">${e(upper(a.format))} · ${e(fileSize(a.size))}${a.usageNote ? ` · ${e(a.usageNote)}` : ""}</p></div>${downloadLink(vm, a, "Download")}</li>`;
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

const MORE_COPY = Object.freeze({
  "brand-guidelines": "No guidelines or documents have been added yet.",
  "brand-additional": "No additional brand assets have been added yet.",
});

/** A file placed in a brand section (imagery, layout, textures, iconography, design style): a picture tile with its name and a download, or a file tile when it is not an image. */
function fileTile(vm, a, key) {
  const picture = IMAGE_FORMATS.includes(a.format);
  const stage = picture
    ? `<div class="bk-tile__stage bk-tile__stage--${e(key)}"><img src="${e(previewUrl(vm, a))}" alt="${e(a.title)}" loading="lazy" decoding="async"></div>`
    : `<div class="bk-tile__stage bk-tile__stage--file"><span class="bk-tile__ext">${e(upper(a.format))}</span></div>`;
  return `<li class="bk-tile">${stage}<div class="bk-tile__body"><p class="bk-tile__name">${e(a.title)}</p><p class="muted small">${e(upper(a.format))} · ${e(fileSize(a.size))}${a.usageNote ? ` · ${e(a.usageNote)}` : ""}</p><div class="logo-card__actions">${downloadLink(vm, a, "Download")}</div></div></li>`;
}

const SECTION_EXAMPLE = { imagery: exampleImagery, layout: exampleLayout, textures: exampleTextures, iconography: exampleIcons, style: exampleStyle };
const copyButton = (text, label) => `<button class="copy" type="button" data-copy="${e(text)}" hidden>Copy<span class="visually-hidden"> ${e(label)}</span></button>`;

/** 04 Tagline: the approved primary tagline set large, then alternates and usage guidelines, each tagline with a Copy button (shown by script; the text stays selectable without it). */
function taglineBlock(t) {
  const primary = t.primary
    ? `<div class="bk-tag"><p class="bk-tag__label">Primary tagline</p><div class="bk-tag__row"><p class="bk-tag__primary">${e(t.primary)}</p>${copyButton(t.primary, "primary tagline")}</div></div>`
    : `<div class="bk-tag"><p class="bk-tag__label">Primary tagline</p><p class="muted">The primary tagline hasn’t been added yet.</p></div>`;
  const alts = (t.alternates || []).length ? `<div class="bk-tag"><p class="bk-tag__label">Alternate taglines</p><ul class="bk-tag__alts">${t.alternates.map((a) => `<li class="bk-tag__row"><p class="bk-tag__alt">${e(a)}</p>${copyButton(a, "alternate tagline")}</li>`).join("")}</ul></div>` : "";
  const guide = t.guidelines ? `<div class="bk-tag"><p class="bk-tag__label">Usage guidelines</p><div class="bk-tag__guide">${String(t.guidelines).split(/\n{2,}/).map((p) => `<p>${e(p).replace(/\n/g, "<br>")}</p>`).join("")}</div></div>` : "";
  return `<div class="bk-tagline">${primary}${alts}${guide}</div>`;
}

const emptyState = (text) => `<div class="bk-empty"><p class="bk-empty__title">Not added yet</p><p class="muted">${e(text)}</p></div>`;

const serviceName = (key) => { const q = BRANDING_SERVICES.find((x) => x.key === key); if (q) return q.title; const r = BRAND_REQUESTS.find((x) => x.key === key); return r ? r.section : key; };

/** The small "Required" / "Recommended" label beside a section name; when a request of this client makes a Recommended section Required, it says why (the service's own title). */
function requirementTag(req) {
  if (!req) return "";
  const why = req.becauseOf && req.becauseOf.length ? `<span class="bk-req__why"> · for your ${e(req.becauseOf.map((k) => serviceName(k)).join(" and "))} request</span>` : "";
  return ` <span class="bk-req bk-req--${e(req.level)}"><span class="visually-hidden">(</span>${e(REQUIREMENT_LABEL[req.level] || "")}${why}<span class="visually-hidden">)</span></span>`;
}

/** One of the nine numbered sections: a large two-digit number, the title, a short description, then the section's content or its empty state. All nine are always shown. */
function bkSection(def, inner, req = null) {
  return `<section class="bk-sec" id="${e(def.id)}" aria-labelledby="h-${e(def.id)}"><header class="bk-sec__head"><p class="bk-sec__no" aria-hidden="true">${e(def.no)}</p><div class="bk-sec__intro"><h2 class="bk-sec__title" id="h-${e(def.id)}"><span class="visually-hidden">${e(def.no)} </span>${e(def.title)}${requirementTag(req)}</h2><p class="bk-sec__desc muted">${e(def.desc)}</p></div></header><div class="bk-sec__body">${inner}</div></section>`;
}

/**
 * The Branding page: a digital brand guidelines document of nine numbered sections (Logo, Typography, Brand Colours, Tagline, Brand Imagery, Layout System, Textures,
 * Iconography, Design Style), always all nine, in this order, whatever Framework has published. A section with content shows it (with the existing viewing,
 * copying and download links); an empty one says so. Below them, files that belong to no section (guidelines, documents, packages, other files) stay listed, each
 * group with its request control, and nothing is moved or hidden by guesswork.
 * @param brand   getClientBrand() result
 * @param o       { canUpload, uploadCount, brandName, canRequest, csrf, requests: { [key]: newest request }, notice: "sent" | "dup" | "" }
 */
export function brandingOverview(vm, brand, o = {}) {
  const { canUpload = false, uploadCount = 0, brandName = "", canRequest = false, csrf = "", requests = {}, notice = "" } = o;
  const live = Boolean(brand.published);
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Branding"]])}<h1 class="h1 h1--section">Branding</h1><p class="lead">${live ? `${brandName ? `The approved ${e(brandName)} brand` : "Your approved brand"}: logos, typography, colours and more. Download what you need, any time.` : "Your brand kit in nine parts. Anything that isn’t here yet can be requested below."}</p></header>`;
  const banner = notice === "sent" ? `<p class="form-banner" role="status">Request sent. Framework will follow up.</p>` : notice === "dup" ? `<p class="form-banner" role="status">That request is already open, so we didn’t send it twice.</p>` : "";

  const assets = live ? brand.assets || [] : [];
  const colours = live ? brand.colours || [] : [];
  const fonts = assets.filter((a) => a.kind === "font");
  const fontFiles = fonts.filter((a) => a.canDownload);
  const type = live ? brand.typography || [] : [];
  const guideDocs = ["guideline", "document"].map((k) => [k, assets.filter((a) => a.kind === k)]).filter(([, l]) => l.length);
  const extraDocs = ["package", "other"].map((k) => [k, assets.filter((a) => a.kind === k && !sectionOf(a))]).filter(([, l]) => l.length);
  const reqDef = (key) => BRAND_REQUESTS.find((d) => d.key === key);
  // Required / Recommended per section for this client (defaults, plus sections a service they have open genuinely depends on: see brand-requirements.js).
  const reqs = requirementsFor(Object.values(requests), o.requirementTable);
  const sec = (d, inner) => bkSection(d, inner, reqs[d.key]);
  const control = (key, hasContent) => requestControl(vm, reqDef(key), { r: requests[key], canRequest, csrf, label: hasContent ? "Request additions or changes" : "Request" });
  // Design-service pricing (Admin -> Settings -> Service Pricing): a quiet note with the price beside the request button, only for a section the client has nothing in yet and only when
  // that service has a stored price. Uploading existing branding is always free and always offered next to it.
  const pricing = o.pricing || {};
  const uploadHref = canUpload ? href(vm, "/branding/uploads") : "";
  const offerRequest = (pk) => requestControl(vm, reqDef(requestKeyOf(pk)), { r: requests[requestKeyOf(pk)], canRequest, csrf, label: "Request design" });
  const offer = (pk) => designOffer(pricing[pk], { action: offerRequest(pk), uploadHref });
  const groups = (docs) => docs.map(([k, l]) => `${docs.length > 1 ? `<p class="acc__group">${e(DOC_LABEL[k])}</p>` : ""}<ul class="file-list">${l.map((a) => docRow(vm, a)).join("")}</ul>`).join("");
  const def = Object.fromEntries(BRAND_SECTIONS.map((d) => [d.key, d]));

  // 01 Logo: the four variation cards, then any older logo files that have no type.
  const logoFiles = assets.filter((a) => a.kind === "logo");
  const byVariation = new Map(LOGO_VARIATIONS.map((d) => [d.key, []]));
  const unassigned = [];
  for (const a of logoFiles) { const k = variationOf(a); if (k) byVariation.get(k).push(a); else unassigned.push(a); }
  const filled = LOGO_VARIATIONS.filter((d) => byVariation.get(d.key).length).length;
  const cards = LOGO_VARIATIONS.map((d) => (byVariation.get(d.key).length ? variationCard(vm, d, byVariation.get(d.key)) : exampleCard(d))).join("");
  const others = unassigned.length ? `<p class="acc__group">Other logo files</p><ul class="logo-grid">${logoGroups(unassigned).map((g) => logoCard(vm, g)).join("")}</ul>` : "";
  const examples = filled < 4 ? `<p class="muted small">Cards labelled “Example: Framework” show Framework’s own logo to illustrate that variation. They are not your logos and are not available to download.</p>` : "";
  const LOGO_PRICE = { primary: "logo-primary", secondary: "logo-secondary", simplified: "logo-simplified", submark: "logo-submark" };
  const missingLogos = LOGO_VARIATIONS.filter((d) => !byVariation.get(d.key).length).map((d) => ({ entry: pricing[LOGO_PRICE[d.key]], action: offerRequest(LOGO_PRICE[d.key]) }));
  const logoOffer = designOfferList(missingLogos, { lead: filled ? "Framework can design the logo variations you don’t have yet." : "Framework can design your logo.", uploadHref });
  const parts = [sec(def.logo, `<ul class="lv-grid">${cards}</ul>${examples}${others}${logoOffer}${logoFiles.length > 0 || !logoOffer ? control("brand-logos", logoFiles.length > 0) : ""}`)];

  // 02 Typography: three typeface slots (Primary, Secondary, Accent), the hierarchy preview, older typefaces and fonts that belong to no typeface; then 03 Brand Colours.
  const typeList = type.map(typefaceOf);
  const bySlot = {}; const loose = [];
  for (const t of typeList) { if (t.slot && !bySlot[t.slot]) bySlot[t.slot] = t; else loose.push(t); }
  const specimen = specimenSlots(type, fonts);
  const owned = new Set(typeList.flatMap((t) => filesOf(t, fonts).all.map((f) => f.id)));
  const unlisted = fontFiles.filter((f) => !owned.has(f.id));
  // Slots the client hasn't filled show a muted Framework example (Primary and Secondary in Switzer and General Sans, Accent as a generic optional example); the hierarchy always shows.
  const slotCards = `<ul class="tf-grid">${TYPE_SLOT_DEFS.map((d) => (bySlot[d.key] ? typeCard(vm, d, bySlot[d.key], fonts, specimen[d.key]) : exampleTypeCard(d))).join("")}</ul>`;
  const hier = hierarchy(bySlot, specimen);
  if (typeList.length || fonts.length) {
    const note = fonts.some((f) => !f.canDownload) ? `<p class="muted small">Some fonts can’t be shared as files because of their licence. Use the link beside each one to get it from its provider, or ask us.</p>` : "";
    const othersHtml = loose.length ? `<p class="acc__group">Other typefaces</p><p class="muted small">${Object.keys(bySlot).length ? "These typefaces aren’t assigned to a role." : "Framework hasn’t assigned these typefaces to a role yet."}</p><ul class="types bk-types">${loose.map((t) => typeface(vm, t, fontFiles)).join("")}</ul><p class="muted small">Example text is shown in this page’s own typeface, for layout only. It is not set in the font.</p>` : "";
    parts.push(sec(def.typography, `${slotCards}${hier}${othersHtml}${unlisted.length ? `<p class="acc__group">Font files</p><ul class="file-list">${unlisted.map((a) => docRow(vm, a)).join("")}</ul>` : ""}${note}${control("brand-typography", typeList.length > 0)}`));
  } else {
    const share = canUpload ? `<p class="muted small">Already have your fonts? <a class="text-link" href="${e(href(vm, "/branding/uploads"))}">Share them with Framework</a>.</p>` : "";
    parts.push(sec(def.typography, `<p class="muted">${e(def.typography.empty)} Here is an example of a typography system, set in Framework’s own typefaces.</p>${slotCards}${hier}${offer("typography") || control("brand-typography", false)}${share}`));
  }
  parts.push(sec(def.colours, colours.length ? `<ul class="swatches">${colours.map(swatch).join("")}</ul>${control("brand-colours", true)}` : exampleColours() + (offer("colours") || control("brand-colours", false))));

  // 04 Tagline: the approved tagline (kit published), or the labelled Framework example while none has been added.
  parts.push(sec(def.tagline, live && brand.tagline ? taglineBlock(brand.tagline) : exampleTagline() + offer("tagline")));

  // 05 to 09: files an admin placed in the section.
  for (const key of ["imagery", "layout", "textures", "iconography", "style"]) {
    const files = assets.filter((a) => sectionOf(a) === key);
    parts.push(sec(def[key], files.length ? `<ul class="bk-tiles bk-tiles--${key}">${files.map((a) => fileTile(vm, a, key)).join("")}</ul>` : SECTION_EXAMPLE[key]() + offer(key)));
  }

  // Completion beside each section in the navigation: Logo counts its four slots (1/4 to 3/4, a checkmark at 4/4); every other section shows a checkmark only once the client has real
  // published content in it. Examples never count, nothing shows while a section is empty, and a request never completes a section (see brand-requirements.js).
  const comp = completionOf({ logoFilled: filled, typefaces: typeList.length, fontFiles: fonts.length, colours: colours.length, tagline: live && brand.tagline ? brand.tagline.primary : null,
    files: Object.fromEntries(["imagery", "layout", "textures", "iconography", "style"].map((k) => [k, assets.filter((a) => sectionOf(a) === k).length])) });
  const CHECK = `<svg class="bk-nav__tick" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false"><path d="M3 8.6l3.2 3.2L13 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="square"/></svg>`;
  const markOf = (d) => {
    const c = comp[d.key];
    if (c.done) return `<span class="bk-nav__mark bk-nav__mark--done">${CHECK}<span class="visually-hidden">, complete</span></span>`;
    if (d.key === "logo" && c.count > 0) return `<span class="bk-nav__mark"><span aria-hidden="true">${c.count}/${c.total}</span><span class="visually-hidden">, ${c.count} of ${c.total} logo variations added</span></span>`;
    return "";
  };
  const nav = `<nav class="bk-nav" aria-label="Brand kit sections"><ol>${BRAND_SECTIONS.map((d) => `<li><a href="#${e(d.id)}"><span class="bk-nav__no" aria-hidden="true">${e(d.no)}</span> ${e(d.title)}${markOf(d)}<span class="visually-hidden">, ${e(REQUIREMENT_LABEL[reqs[d.key].level].toLowerCase())}</span></a></li>`).join("")}</ol></nav>`;
  const more = `<section class="bk-more" aria-labelledby="h-more"><h2 class="h2" id="h-more">Documents and other files</h2><p class="muted">Guidelines, documents and other files from Framework that aren’t part of the nine sections above.</p>
<div class="bk-more__group" id="guidelines"><h3 class="h3">Brand guidelines &amp; documents</h3>${guideDocs.length ? groups(guideDocs) : emptyState(MORE_COPY["brand-guidelines"])}${control("brand-guidelines", guideDocs.length > 0)}</div>
<div class="bk-more__group" id="additional"><h3 class="h3">Additional brand assets</h3>${extraDocs.length ? groups(extraDocs) : emptyState(MORE_COPY["brand-additional"])}${control("brand-additional", extraDocs.length > 0)}</div></section>`;
  const share = canUpload
    ? `<aside class="brand-aside" aria-labelledby="h-share"><h2 class="h3" id="h-share">Have brand materials of your own?</h2><p class="muted">Share your existing logo, fonts or guidelines and Framework will review them.</p><p><a class="btn" href="${e(href(vm, "/branding/uploads"))}">Upload your materials${uploadCount ? ` (${uploadCount} shared)` : ""}</a></p></aside>`
    : "";
  // The complete-kit price is shown only while something is still missing: with all nine sections done there is nothing to sell.
  const allDone = filled === 4 && typeList.length > 0 && colours.length > 0 && Boolean(live && brand.tagline) && ["imagery", "layout", "textures", "iconography", "style"].every((k) => assets.some((a) => sectionOf(a) === k));
  const kitPrice = !allDone && priceLabel(pricing["brand-kit"]) ? `<p class="bk-design__line"><span class="bk-design__price">${e(priceLabel(pricing["brand-kit"]))}</span></p><p class="muted small">${e(ESTIMATE_NOTE)}</p>` : "";
  const kit = `<section class="brand-kit" aria-labelledby="h-kit"><h2 class="h2" id="h-kit">Need a complete brand identity?</h2><p class="muted">Logo, colours, typography and guidelines, designed together as one system.</p>${kitPrice}${requestControl(vm, reqDef("brand-full-kit"), { r: requests["brand-full-kit"], canRequest, csrf, label: "Request full brand kit", primary: true })}</section>`;
  const meta = brand.publishedAt && live ? `<p class="muted small">Last published ${e(dateOnly(brand.publishedAt))}.</p>` : "";
  return head + banner + nav + `<div class="bk">${parts.join("")}</div>` + more + meta + share + kit;
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
