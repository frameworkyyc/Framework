/**
 * The Brand Book (PROTOTYPE, Staging only): the same Branding content as the Branding page, presented as a deck of large coloured cards that stack at the bottom of the screen and
 * rise over one another as the page is scrolled (assets/js/portal-branding-book.js). It is a READ-ONLY view: it shows the published brand kit and the files Framework placed in it,
 * every file link is the existing permission-checked route, and nothing here posts anything. Requests, uploads and Brand Discovery stay on the Branding page, linked from the cards.
 * Without script (or with reduced motion) it is a plain vertical stack of the same cards. No inline style or script: card colours come from /assets/css/portal-branding-book.css and,
 * when the client has published at least three brand colours, from a generated stylesheet (cardCss below) that only ever contains validated #rrggbb values.
 */
import { e } from "./ui.js";
import { BRAND_SECTIONS, TYPE_SLOT_DEFS, sectionOf } from "../../admin/assets/brand-sections.js";
import { typefaceOf, filesOf, specimenSlots } from "./brand-type.js";
import { completionOf } from "./brand-requirements.js";
import { exampleColours, exampleTagline, exampleTypeCard, exampleImagery, exampleLayout, exampleTextures, exampleIcons, exampleStyle } from "./brand-examples.js";
import { LOGO_VARIATIONS, variationOf, variationCard, exampleCard, swatch, typeCard, hierarchy, taglineBlock, fileTile, docRow, emptyState } from "./branding-live.js";

const href = (vm, p) => `${vm.base}${p}`;
const SECTION = Object.fromEntries(BRAND_SECTIONS.map((d) => [d.key, d]));

/** The seven cards, in order. `sections` are the Branding sections each one covers (BRAND_SECTIONS keys); the Overview and Documents cards cover none of the nine on their own except the tagline. */
export const CARDS = Object.freeze([
  Object.freeze({ id: "overview", title: "Brand Overview", desc: "Your brand at a glance: the idea in a line, and what is in the book.", keys: ["tagline"] }),
  Object.freeze({ id: "logo", title: "Logo System", desc: "Four logo variations, each made for a different use. Download the format you need.", keys: ["logo"] }),
  Object.freeze({ id: "colours", title: "Colour Palette", desc: "The exact colours to use on screen and in print.", keys: ["colours"] }),
  Object.freeze({ id: "typography", title: "Typography", desc: "The typefaces that give the brand its voice, and how they work together.", keys: ["typography"] }),
  Object.freeze({ id: "imagery", title: "Imagery & Textures", desc: "Approved photography, textures and patterns that show how the brand looks and feels.", keys: ["imagery", "textures"] }),
  Object.freeze({ id: "system", title: "Layout, Icons & Style", desc: "The grids, icons and design principles that keep everything consistent.", keys: ["layout", "iconography", "style"] }),
  Object.freeze({ id: "documents", title: "Documents & Assets", desc: "Guidelines, packages and everything else, ready to download.", keys: [] }),
]);

/* ------------------------------------------------------------------ colour of the cards */

/** Framework's own set, used until a client has published enough colours of their own. Every pair is checked for contrast by the tests. */
export const DEFAULT_PALETTE = Object.freeze(["#0A0A0A", "#EFEAE0", "#B3412A", "#1F3B34", "#D5DEE6", "#2D2A5A", "#F2C25B"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const channel = (h, i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (h) => 0.2126 * channel(h, 1) + 0.7152 * channel(h, 3) + 0.0722 * channel(h, 5);
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Text for a card background: Framework's ink or white, whichever reads better; only for the narrow band of mid-greys where neither reaches 4.5:1, pure black or white (which always does). */
export function textOn(bg) {
  const ink = contrast(bg, "#0A0A0A"), white = contrast(bg, "#FFFFFF");
  if (Math.max(ink, white) >= 4.5) return ink >= white ? "#0A0A0A" : "#FFFFFF";
  return contrast(bg, "#000000") >= white ? "#000000" : "#FFFFFF";
}

const ROLE_ORDER = { primary: 0, secondary: 1, accent: 2, neutral: 3 };
/** The card colours: the client's own published colours (primary, secondary, accent, neutral first) when there are at least three, else Framework's set. */
export function cardColours(colours) {
  const own = (colours || []).filter((c) => c && HEX.test(c.hex)).slice().sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9)).map((c) => c.hex.toUpperCase());
  const uniq = [...new Set(own)];
  const list = uniq.length >= 3 ? uniq : DEFAULT_PALETTE;
  return CARDS.map((_, i) => { const bg = list[i % list.length]; return { bg, fg: textOn(bg), own: list !== DEFAULT_PALETTE }; });
}
/** The generated stylesheet: custom properties per card, from validated hex only. Empty when the client has fewer than three colours (the static stylesheet's defaults apply). */
export function cardCss(colours) {
  const c = cardColours(colours);
  return c[0].own ? c.map((x, i) => `.bb-card--${i + 1}{--bb-bg:${x.bg};--bb-fg:${x.fg}}`).join("\n") + "\n" : "";
}

/* ------------------------------------------------------------------ what each card says about itself */

/** "Complete", "2 of 4 added" or "Not added yet" for the sections a card covers (the same completion as the Branding page). */
function statusOf(comp, keys) {
  if (!keys.length) return "";
  const parts = keys.map((k) => comp[k]);
  const done = parts.filter((c) => c.done).length;
  if (done === keys.length) return "Complete";
  const logo = comp.logo && keys.includes("logo") ? comp.logo : null;
  if (logo && logo.count > 0) return `${logo.count} of ${logo.total} added`;
  return done > 0 ? `${done} of ${keys.length} added` : "Not added yet";
}

function sheet(inner) { return inner; }

/** Everything the deck needs from the page's data; mirrors branding-live.js brandingOverview for the pieces it shows. */
export function brandBook(vm, brand, o = {}) {
  const { brandName = "", orgName = "", discovery = [], canUpload = false, requirementSettings = {} } = o;
  const live = Boolean(brand.published);
  const assets = live ? brand.assets || [] : [];
  const colours = live ? brand.colours || [] : [];
  const type = live ? brand.typography || [] : [];
  const fonts = assets.filter((a) => a.kind === "font");
  const fontFiles = fonts.filter((a) => a.canDownload);

  // completion (the same inputs as the Branding page, including variations Admin marked not applicable)
  const logoSlots = new Set(assets.filter((a) => a.kind === "logo").map(variationOf).filter(Boolean)).size;
  const FILE_KEYS = ["imagery", "layout", "textures", "iconography", "style"];
  const comp = completionOf({ logoFilled: logoSlots, typefaces: type.length, fontFiles: fonts.length, colours: colours.length, tagline: live && brand.tagline ? brand.tagline.primary : null,
    files: Object.fromEntries(FILE_KEYS.map((k) => [k, assets.filter((a) => sectionOf(a) === k).length])) });
  const na = new Set(LOGO_VARIATIONS.filter((d) => requirementSettings[`logo.${d.key}`] && requirementSettings[`logo.${d.key}`].level === "not_applicable").map((d) => d.key));
  if (na.size) {
    const have = new Set(assets.filter((a) => a.kind === "logo").map(variationOf).filter(Boolean));
    const need = LOGO_VARIATIONS.filter((d) => !na.has(d.key));
    comp.logo = { done: need.length > 0 && need.every((d) => have.has(d.key)), count: need.filter((d) => have.has(d.key)).length, total: need.length };
  }

  // 02 Logo System
  const byVariation = new Map(LOGO_VARIATIONS.map((d) => [d.key, []]));
  for (const a of assets.filter((x) => x.kind === "logo")) { const k = variationOf(a); if (k) byVariation.get(k).push(a); }
  const logoCards = LOGO_VARIATIONS.map((d) => (byVariation.get(d.key).length ? variationCard(vm, d, byVariation.get(d.key)) : exampleCard(d))).join("");
  const logoHtml = `<ul class="lv-grid">${logoCards}</ul>${LOGO_VARIATIONS.some((d) => !byVariation.get(d.key).length) ? `<p class="muted small">Cards labelled “Example: Framework” show Framework’s own logo to illustrate that variation. They are not your logos and are not available to download.</p>` : ""}`;

  // 03 Colour Palette
  const colourHtml = colours.length ? `<ul class="swatches">${colours.map(swatch).join("")}</ul>` : exampleColours();

  // 04 Typography
  const typeList = type.map(typefaceOf);
  const bySlot = {};
  for (const t of typeList) if (t.slot && !bySlot[t.slot]) bySlot[t.slot] = t;
  const specimen = specimenSlots(type, fonts);
  const slotCards = `<ul class="tf-grid">${TYPE_SLOT_DEFS.map((d) => (bySlot[d.key] ? typeCard(vm, d, bySlot[d.key], fonts, specimen[d.key]) : exampleTypeCard(d))).join("")}</ul>`;
  const owned = new Set(typeList.flatMap((t) => filesOf(t, fonts).all.map((f) => f.id)));
  const unlisted = fontFiles.filter((f) => !owned.has(f.id));
  const typeHtml = `${slotCards}${hierarchy(bySlot, specimen)}${unlisted.length ? `<p class="acc__group">Font files</p><ul class="file-list">${unlisted.map((a) => docRow(vm, a)).join("")}</ul>` : ""}`;

  // 05 and 06: the picture tiles Framework placed in each section, or the labelled example
  const EXAMPLE = { imagery: exampleImagery, layout: exampleLayout, textures: exampleTextures, iconography: exampleIcons, style: exampleStyle };
  const group = (key) => {
    const files = assets.filter((a) => sectionOf(a) === key);
    return `<section class="bb-group" aria-labelledby="bbg-${e(key)}"><h3 class="bb-group__title" id="bbg-${e(key)}">${e(SECTION[key].title)}</h3>${files.length ? `<ul class="bk-tiles bk-tiles--${e(key)}">${files.map((a) => fileTile(vm, a, key)).join("")}</ul>` : EXAMPLE[key]()}</section>`;
  };

  // 07 Documents & Assets
  const DOC_LABEL = { guideline: "Guidelines", document: "Documents", package: "Packages", other: "Other files" };
  const docs = ["guideline", "document", "package", "other"].map((k) => [k, assets.filter((a) => a.kind === k && (k === "guideline" || k === "document" || !sectionOf(a)))]).filter(([, l]) => l.length);
  const docsHtml = docs.length
    ? docs.map(([k, l]) => `<p class="acc__group">${e(DOC_LABEL[k])}</p><ul class="file-list">${l.map((a) => docRow(vm, a)).join("")}</ul>`).join("")
    : emptyState("No guidelines, documents or packages have been added yet.");
  const actions = `<p class="bb-actions"><a class="btn btn--small" href="${e(href(vm, "/branding"))}">Request additions or changes</a>${canUpload ? ` <a class="btn btn--small" href="${e(href(vm, "/branding/uploads"))}">Share your own brand files</a>` : ""}</p><p class="muted small">Requests, uploads and Brand Discovery are on the Branding page.</p>`;

  // 01 Overview
  const name = brandName || orgName || "Your brand";
  const tagline = live && brand.tagline && brand.tagline.primary ? `<p class="bb-tagline">${e(brand.tagline.primary)}</p>` : `<p class="bb-tagline bb-tagline--empty">Your tagline hasn’t been added yet.</p>`;
  const contents = CARDS.slice(1).map((c, i) => { const s = statusOf(comp, c.keys.length ? c.keys : []); return `<li><a class="bb-toc__link" href="#${e(c.id)}"><span class="bb-toc__no" aria-hidden="true">${String(i + 2).padStart(2, "0")}</span><span class="bb-toc__name">${e(c.title)}</span>${s ? `<span class="bb-toc__state">${e(s)}</span>` : ""}</a></li>`; }).join("");
  const dc = (discovery || []).filter((x) => x.status === "not_started" || x.status === "in_progress");
  const disc = dc.length ? `<p class="bb-note"><a class="text-link" href="${e(href(vm, "/branding/discovery"))}">Your Brand Discovery is waiting for you</a></p>` : "";
  const published = live && brand.publishedAt ? `<p class="bb-card__sub">Last published ${e(new Date(brand.publishedAt).toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "America/Edmonton" }))}.</p>` : `<p class="bb-card__sub">Your approved brand will appear here when it is ready.</p>`;
  const overview = `<p class="bb-name">${e(name)}</p>${tagline}<h3 class="bb-group__title">In this book</h3><ol class="bb-toc">${contents}</ol>${disc}`;

  const bodies = {
    overview, logo: logoHtml, colours: colourHtml, typography: typeHtml,
    imagery: `${group("imagery")}${group("textures")}`,
    system: `${group("layout")}${group("iconography")}${group("style")}`,
    documents: `${docsHtml}${actions}`,
  };
  const nav = `<nav class="bb-bar__nav" aria-label="Brand Book cards"><ol>${CARDS.map((c, i) => `<li><a href="#${e(c.id)}" data-bb-go="${i}"><span class="bb-bar__no">${String(i + 1).padStart(2, "0")}</span><span class="visually-hidden"> ${e(c.title)}</span></a></li>`).join("")}</ol></nav>`;
  const bar = `<div class="bb-bar"><p class="bb-bar__tag"><span class="bb-bar__label">Brand Book</span> <span class="bb-bar__proto">Prototype for review</span></p>${nav}<p class="bb-bar__exit"><a class="text-link" href="${e(href(vm, "/branding"))}">Current Branding page</a></p></div>`;
  const cards = CARDS.map((c, i) => {
    const no = String(i + 1).padStart(2, "0");
    const status = c.id === "overview" ? `${BRAND_SECTIONS.filter((d) => comp[d.key].done).length} of ${BRAND_SECTIONS.length} complete` : statusOf(comp, c.keys);
    const label = `${c.title} content`;
    return `<section class="bb-card bb-card--${i + 1}" id="${e(c.id)}" aria-labelledby="bbh-${e(c.id)}" data-bb-card><div class="bb-card__tab" aria-hidden="true"><span class="bb-card__tabno">${no}</span><span class="bb-card__tabname">${e(c.title)}</span></div><div class="bb-card__main"><div class="bb-card__head"><p class="bb-card__no" aria-hidden="true">${no}</p><h2 class="bb-card__title" id="bbh-${e(c.id)}"><span class="visually-hidden">${no}. </span>${e(c.title)}</h2><p class="bb-card__desc">${e(c.desc)}</p>${c.id === "overview" ? published : ""}${status ? `<p class="bb-card__status">${e(status)}</p>` : ""}</div><div class="bb-card__sheet" data-bb-sheet role="region" aria-label="${e(label)}">${sheet(bodies[c.id])}</div></div></section>`;
  }).join("");
  return `<h1 class="visually-hidden">Brand Book</h1><div class="bb" id="brand-book" data-bb-count="${CARDS.length}">${bar}<div class="bb-runway" data-bb-runway><div class="bb-stage" data-bb-stage><div class="bb-deck" data-bb-deck>${cards}</div></div></div><p class="visually-hidden" role="status" aria-live="polite" data-bb-live></p></div>`;
}
