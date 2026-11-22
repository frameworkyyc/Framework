/**
 * The Brand Book (PROTOTYPE, Staging only): the client's published brand presented as an editorial, full-screen brand guideline. A cover, three chapters (01 Logo, 02 Typography,
 * 03 Colours) of six spreads each, and a closing page of files. Each spread is a full-viewport card; the cards are stacked at the bottom of the screen and the next one rises over the
 * current one as the page scrolls natively (assets/js/portal-branding-book.js). READ-ONLY: it shows the published brand kit and the files Framework placed in it, every file link is
 * the existing permission-checked route, and nothing here posts anything (requests, uploads and Discovery stay on the Branding page).
 *
 * Honesty: a spread is built from the client's REAL logo, typefaces and colours. Where the brand holds no data for a page (clear space, misuse, applications, balance), the page is
 * built from the client's own logo and palette and says it is a Framework default guideline or an illustration, never an approved rule. Contrast figures are computed from the colours.
 * No inline style or script: card colours come from /assets/css/portal-branding-book.css and, when the client has published at least three colours, from a generated stylesheet of
 * validated #rrggbb values only (paletteCss); arbitrary colours elsewhere are SVG presentation attributes, which the portal's CSP allows.
 */
import { e } from "./ui.js";
import { TYPE_SLOT_DEFS, sectionOf } from "../../admin/assets/brand-sections.js";
import { typefaceOf, filesOf, specimenSlots, WEIGHT_NAME } from "./brand-type.js";
import { LOGO_VARIATIONS, variationOf, fileSize } from "./branding-live.js";

const href = (vm, p) => `${vm.base}${p}`;
const upper = (s) => String(s || "").toUpperCase();
const IMAGE_FORMATS = ["svg", "png", "webp", "jpg"];
const formatRank = (a) => { const i = IMAGE_FORMATS.indexOf(a.format); return i < 0 ? 9 : i; };
const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);

/* ------------------------------------------------------------------ the pages */

export const CHAPTERS = Object.freeze([
  Object.freeze({ no: "01", id: "logo", title: "Logo", first: "logo" }),
  Object.freeze({ no: "02", id: "typography", title: "Typography", first: "typography" }),
  Object.freeze({ no: "03", id: "colours", title: "Colours", first: "colours" }),
]);

/** Every card in order. `ch` is the chapter index (null for the cover and the closing page); `tone` is the card's background (ink, paper, sand, or c0 to c7 of the palette). */
export const CARDS = Object.freeze([
  { id: "cover", ch: null, title: "Cover", tone: "ink" },
  { id: "logo", ch: 0, title: "Logo", tone: "c0" },
  { id: "logo-variations", ch: 0, title: "Variations", tone: "paper" },
  { id: "logo-space", ch: 0, title: "Clear space & size", tone: "sand" },
  { id: "logo-placement", ch: 0, title: "Placement", tone: "ink" },
  { id: "logo-misuse", ch: 0, title: "Misuse", tone: "paper" },
  { id: "logo-application", ch: 0, title: "In application", tone: "c1" },
  { id: "typography", ch: 1, title: "Typography", tone: "c2" },
  { id: "type-primary", ch: 1, title: "Primary typeface", tone: "paper" },
  { id: "type-secondary", ch: 1, title: "Secondary & accent", tone: "sand" },
  { id: "type-weights", ch: 1, title: "Weights", tone: "ink" },
  { id: "type-hierarchy", ch: 1, title: "Hierarchy", tone: "paper" },
  { id: "type-use", ch: 1, title: "In use", tone: "c0" },
  { id: "colours", ch: 2, title: "Colours", tone: "ink" },
  { id: "colour-primary", ch: 2, title: "Primary palette", tone: "paper" },
  { id: "colour-support", ch: 2, title: "Supporting colours", tone: "sand" },
  { id: "colour-contrast", ch: 2, title: "Combinations & contrast", tone: "ink" },
  { id: "colour-balance", ch: 2, title: "Balance, light & dark", tone: "paper" },
  { id: "colour-application", ch: 2, title: "In application", tone: "c3" },
  { id: "files", ch: null, title: "Files", tone: "ink" },
].map((c) => Object.freeze(c)));

/* ------------------------------------------------------------------ colour */

/** Framework's own eight, used until a client has published at least three colours of their own. */
export const DEFAULT_PALETTE = Object.freeze(["#B3412A", "#1F3B34", "#2D2A5A", "#F2C25B", "#D5DEE6", "#C98B6B", "#5C6B3A", "#5B2A4A"]);
const HEX = /^#[0-9a-fA-F]{6}$/;
const channel = (h, i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const luminance = (h) => 0.2126 * channel(h, 1) + 0.7152 * channel(h, 3) + 0.0722 * channel(h, 5);
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** Text for a background: Framework's ink or white, whichever reads better; only in the narrow band of mid-greys where neither reaches 4.5:1, pure black or white (which always does). */
export function textOn(bg) {
  const ink = contrast(bg, "#0A0A0A"), white = contrast(bg, "#FFFFFF");
  if (Math.max(ink, white) >= 4.5) return ink >= white ? "#0A0A0A" : "#FFFFFF";
  return contrast(bg, "#000000") >= white ? "#000000" : "#FFFFFF";
}
const rgbOf = (h) => `${parseInt(h.slice(1, 3), 16)}, ${parseInt(h.slice(3, 5), 16)}, ${parseInt(h.slice(5, 7), 16)}`;
const rate = (r) => (r >= 7 ? "AAA" : r >= 4.5 ? "AA" : r >= 3 ? "AA Large" : "Below AA");
const ROLE_ORDER = { primary: 0, secondary: 1, accent: 2, neutral: 3 };

/** The client's own colours (primary, secondary, accent, neutral first), validated. */
function ownColours(colours) {
  const list = (colours || []).filter((c) => c && HEX.test(c.hex)).slice().sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
  const seen = new Set();
  return list.filter((c) => { const k = c.hex.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8).map((c) => ({ name: String(c.name || ""), role: c.role || "", hex: c.hex.toUpperCase(), note: String(c.note || "") }));
}
/** Eight colours for the card backgrounds: the client's own when there are at least three (cycled to eight), else Framework's. */
export function paletteOf(colours) {
  const own = ownColours(colours);
  const list = own.length >= 3 ? own.map((c) => c.hex) : DEFAULT_PALETTE.slice();
  return { own: own.length >= 3, hexes: Array.from({ length: 8 }, (_, i) => list[i % list.length]) };
}
/** The generated stylesheet: .bb-c0..7 custom properties from validated hex only. Empty when the client has fewer than three colours (the static defaults apply). */
export function paletteCss(colours) {
  const p = paletteOf(colours);
  return p.own ? p.hexes.map((h, i) => `.bb-c${i}{--bb-bg:${h};--bb-fg:${textOn(h)}}`).join("\n") + "\n" : "";
}
const toneHex = (tone, pal) => (tone === "ink" ? "#0A0A0A" : tone === "paper" ? "#FFFFFF" : tone === "sand" ? "#EFEAE0" : pal.hexes[Number(tone.slice(1))]);
const isDark = (hex) => luminance(hex) < 0.3;

/* ------------------------------------------------------------------ small pieces */

const cross = `<svg class="bb-no" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
const arrow = `<svg class="bb-arrow" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M2 8h11M9 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>`;
const dl = (vm, a, label = upper(a.format)) => `<a class="bb-dl" href="${e(href(vm, `/branding/files/${a.id}`))}" download>${e(label)}<span class="visually-hidden"> ${e(a.title)} (${e(upper(a.format))}, ${e(fileSize(a.size))})</span></a>`;
const swatch = (hex, label, cls = "") => `<svg class="bb-chip ${cls}" viewBox="0 0 100 60" preserveAspectRatio="none" role="img" aria-label="${e(label)}, ${e(hex)}" focusable="false"><rect width="100" height="60" fill="${e(hex)}"/></svg>`;
const copyBtn = (text, label) => `<button class="bb-copy" type="button" data-copy="${e(text)}" hidden>Copy<span class="visually-hidden"> ${e(label)}</span></button>`;

/** Everything the spreads need, derived once from the published brand. */
function context(vm, brand, o) {
  const live = Boolean(brand.published);
  const assets = live ? brand.assets || [] : [];
  const own = ownColours(live ? brand.colours : []);
  const example = own.length === 0;
  const colours = example ? [{ name: "Example one", role: "primary", hex: DEFAULT_PALETTE[1], note: "" }, { name: "Example two", role: "secondary", hex: DEFAULT_PALETTE[0], note: "" }, { name: "Example three", role: "accent", hex: DEFAULT_PALETTE[3], note: "" }, { name: "Example four", role: "neutral", hex: "#EFEAE0", note: "" }] : own;
  const byVar = new Map(LOGO_VARIATIONS.map((d) => [d.key, []]));
  for (const a of assets.filter((x) => x.kind === "logo")) { const k = variationOf(a); if (k) byVar.get(k).push(a); }
  const type = live ? brand.typography || [] : [];
  const fonts = assets.filter((a) => a.kind === "font");
  const spec = specimenSlots(type, fonts);
  const slot = {};
  for (const raw of type) { const t = typefaceOf(raw); if (t.slot && !slot[t.slot]) slot[t.slot] = t; }
  return {
    vm, live, assets, colours, example, byVar, type, fonts, spec, slot, pal: paletteOf(live ? brand.colours : []),
    name: o.brandName || o.orgName || "Your brand", tagline: live && brand.tagline && brand.tagline.primary ? brand.tagline.primary : "",
    canUpload: Boolean(o.canUpload), anyLogo: [...byVar.values()].some((l) => l.length),
  };
}

/** The best picture of a logo variation for a background: the file whose tone suits it first (dark logo files are made for dark backgrounds). */
function logoFile(c, key, onDark) {
  const want = onDark ? ["dark", "colour", "mono", "light"] : ["light", "colour", "mono", "dark"];
  const files = (c.byVar.get(key) || []).filter((a) => IMAGE_FORMATS.includes(a.format));
  const rank = (a) => { const i = want.indexOf(a.tone); return i < 0 ? 9 : i; };
  return files.slice().sort((a, b) => rank(a) - rank(b) || formatRank(a) - formatRank(b))[0] || null;
}
/** A logo picture (the client's file, or Framework's labelled example when none exists). `plate`: the file is meant for the opposite background, so it should sit on a plate. */
function logo(c, key, { onDark = false, cls = "" } = {}) {
  const f = logoFile(c, key, onDark);
  const def = LOGO_VARIATIONS.find((d) => d.key === key);
  if (f) return { html: `<img class="bb-logo ${cls}" src="${e(href(c.vm, `/branding/files/${f.id}?preview=1`))}" alt="${e(def.title)}: ${e(f.title)}" decoding="async">`, plate: onDark ? f.tone === "light" : f.tone === "dark", example: false };
  return { html: `<img class="bb-logo bb-logo--example ${cls}" src="${e(def.example)}" alt="${e(def.alt)}" decoding="async">`, plate: false, example: true };
}
/** The logo to show when any one will do: primary, then the others. */
function mainLogo(c, onDark, cls = "") {
  const key = ["primary", "secondary", "simplified", "submark"].find((k) => (c.byVar.get(k) || []).some((a) => IMAGE_FORMATS.includes(a.format))) || "primary";
  return logo(c, key, { onDark, cls });
}
const exampleNote = (c) => (c.anyLogo ? "" : `<p class="bb-note">Example: Framework’s own logo, until yours is added.</p>`);

/* ------------------------------------------------------------------ type helpers */

const fontCls = (c, slot) => (c.spec[slot] ? `sp-${slot}` : slot === "secondary" ? "eg-gs" : "eg-sw");
const famOf = (c, slot) => (c.slot[slot] ? c.slot[slot].family : slot === "secondary" ? "General Sans" : slot === "primary" ? "Switzer" : "Accent typeface");
const real = (c, slot) => Boolean(c.slot[slot]);
const fallbackNote = (c, slot) => (!real(c, slot) ? `<p class="bb-note">Example: Framework’s typefaces, until yours is added.</p>` : c.spec[slot] ? "" : `<p class="bb-note">Shown in a stand-in typeface: add the font file to see it as designed.</p>`);
const ALPHA = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 &!?@#"];
const alphabet = (cls) => `<div class="bb-alpha ${cls}">${ALPHA.map((l) => `<p>${e(l)}</p>`).join("")}</div>`;
const weightsOf = (c, slot) => { const w = c.slot[slot] && c.slot[slot].weights.length ? c.slot[slot].weights.slice().sort((a, b) => a - b) : [400, 600, 700]; return w.slice(0, 5); };

/* ------------------------------------------------------------------ the spreads */

const R = {
  cover: (c) => {
    const l = mainLogo(c, true, "bb-cover__logo");
    return `<div class="bb-cover"><div class="bb-cover__top">${l.example ? "" : l.plate ? `<span class="bb-plate">${l.html}</span>` : l.html}</div>
<p class="bb-eyebrow">Brand Book</p><h2 class="bb-giant bb-cover__name" id="bbh-cover">${e(c.name)}</h2>${c.tagline ? `<p class="bb-lede bb-cover__line">${e(c.tagline)}</p>` : ""}
<ol class="bb-cover__index">${CHAPTERS.map((h) => `<li><a href="#${e(h.id)}" data-bb-go="${CARDS.findIndex((x) => x.id === h.first)}"><span class="bb-cover__no">${h.no}</span><span class="bb-cover__ch">${e(h.title)}</span>${arrow}</a></li>`).join("")}</ol></div>`;
  },

  /* 01 Logo */
  logo: (c) => { const l = mainLogo(c, false, "bb-hero-logo"); return `<div class="bb-open"><p class="bb-numeral" aria-hidden="true">01</p><div class="bb-open__text"><h2 class="bb-title" id="bbh-logo">Logo</h2><p class="bb-lede">The mark of the brand, in four variations made for different jobs.</p></div><div class="bb-open__plate bb-paper">${l.html}${exampleNote(c)}</div></div>`; },

  "logo-variations": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">01 · Logo</p><h2 class="bb-title bb-title--m" id="bbh-logo-variations">Variations</h2></header>
<ul class="bb-tiles bb-tiles--4">${LOGO_VARIATIONS.map((d) => {
    const dark = d.key === "simplified" ? false : d.key === "secondary";
    const l = logo(c, d.key, { onDark: dark });
    const files = (c.byVar.get(d.key) || []).slice().sort((a, b) => formatRank(a) - formatRank(b));
    return `<li class="bb-tile"><div class="bb-tile__stage ${dark ? "bb-ink" : "bb-sand"}${l.plate ? " bb-tile__stage--plate" : ""}">${l.html}</div><p class="bb-tile__no">${e(d.no)}</p><h3 class="bb-tile__title">${e(d.title)}</h3>${files.length ? `<p class="bb-dls">${files.map((a) => dl(c.vm, a)).join("")}</p>` : `<p class="bb-tile__state">${l.example ? "Example: Framework · not added yet" : "Not added yet"}</p>`}</li>`;
  }).join("")}</ul></div>`,

  "logo-space": (c) => { const l = mainLogo(c, false, "bb-clear__logo"); return `<div class="bb-spread bb-split"><div class="bb-split__a"><p class="bb-eyebrow">01 · Logo</p><h2 class="bb-title bb-title--m" id="bbh-logo-space">Clear space &amp; size</h2><p class="bb-lede">Give the logo room. Keep clear space on every side equal to <em>x</em>, the height of its tallest letter or mark, and never set it smaller than the minimum.</p><p class="bb-note bb-note--rule">Framework default guideline, not yet approved for this brand.</p></div>
<div class="bb-split__b"><div class="bb-clear" aria-hidden="true"><span class="bb-clear__x bb-clear__x--t">x</span><span class="bb-clear__x bb-clear__x--l">x</span><span class="bb-clear__x bb-clear__x--r">x</span><span class="bb-clear__x bb-clear__x--b">x</span><div class="bb-clear__box">${l.html}</div></div><ul class="bb-sizes"><li><span class="bb-size bb-size--l">${mainLogo(c, false).html}</span><span class="bb-label">Preferred</span></li><li><span class="bb-size bb-size--m">${mainLogo(c, false).html}</span><span class="bb-label">Medium</span></li><li><span class="bb-size bb-size--s">${mainLogo(c, false).html}</span><span class="bb-label">Minimum · 120 px / 30 mm wide</span></li></ul></div></div>`; },

  "logo-placement": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">01 · Logo</p><h2 class="bb-title bb-title--m" id="bbh-logo-placement">Placement</h2><p class="bb-lede">Choose the version that reads best on the background: light logos on dark, dark logos on light.</p></header>
<ul class="bb-fields bb-fields--4">${[["ink", "On black"], ["paper", "On white"], ["c0", "On colour"], ["c1", "On colour"]].map(([t]) => { const dark = isDark(toneHex(t, c.pal)); const l = mainLogo(c, dark); return `<li class="bb-field bb-${t}">${l.plate ? `<span class="bb-plate">${l.html}</span>` : l.html}<span class="bb-label">${dark ? "On dark" : "On light"}</span></li>`; }).join("")}</ul></div>`,

  "logo-misuse": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">01 · Logo</p><h2 class="bb-title bb-title--m" id="bbh-logo-misuse">Misuse</h2><p class="bb-lede">Protect the mark. These treatments weaken it.</p></header>
<ul class="bb-tiles bb-tiles--6">${[["bb-x1", "Don’t stretch"], ["bb-x2", "Don’t rotate"], ["bb-x3", "Don’t recolour"], ["bb-x4", "Don’t add effects"], ["bb-x5", "Don’t crowd it"], ["bb-x6", "Don’t outline it"]].map(([x, t]) => `<li class="bb-misuse"><div class="bb-misuse__stage bb-sand">${mainLogo(c, false, `bb-logo--sm ${x}`).html}</div><p class="bb-misuse__t">${cross}<span>${e(t)}</span></p></li>`).join("")}</ul><p class="bb-note">Framework default guidelines, shown on your own logo.</p></div>`,

  "logo-application": (c) => { const s = logo(c, "submark", { onDark: false }); const onInk = mainLogo(c, true); return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">01 · Logo</p><h2 class="bb-title bb-title--m" id="bbh-logo-application">In application</h2><p class="bb-lede">The logo at work on a sign, a card and a profile picture. Illustrative.</p></header>
<div class="bb-apps"><div class="bb-app bb-app--sign bb-paper"><span class="bb-app__logo">${mainLogo(c, false).html}</span></div><div class="bb-app bb-app--card bb-ink"><span class="bb-app__logo">${onInk.plate ? `<span class="bb-plate">${onInk.html}</span>` : onInk.html}</span><span class="bb-app__line">${e(c.name)}</span></div><div class="bb-app bb-app--avatar bb-sand"><span class="bb-app__avatar">${s.html}</span></div></div></div>`; },

  /* 02 Typography */
  typography: (c) => `<div class="bb-open"><p class="bb-numeral" aria-hidden="true">02</p><div class="bb-open__text"><h2 class="bb-title" id="bbh-typography">Typography</h2><p class="bb-lede">${e(famOf(c, "primary"))} for voice, ${e(famOf(c, "secondary"))} for clarity.</p></div><p class="bb-aa ${fontCls(c, "primary")}" aria-hidden="true">Aa</p></div>`,

  "type-primary": (c) => { const t = c.slot.primary; const files = t ? filesOf(t, c.fonts).usable : []; return `<div class="bb-spread bb-split bb-split--type"><div class="bb-split__a"><p class="bb-eyebrow">02 · Typography</p><h2 class="bb-title bb-title--m" id="bbh-type-primary">Primary typeface</h2><p class="bb-lede">${e(TYPE_SLOT_DEFS[0].desc)}</p>${t && t.usage ? `<p class="bb-usage">${e(t.usage)}</p>` : ""}${files.length ? `<p class="bb-dls">${files.map((a) => dl(c.vm, a)).join("")}</p>` : ""}${t && isHttps(t.source_url) ? `<p><a class="bb-link" href="${e(t.source_url)}" rel="noopener noreferrer" target="_blank">Get this font</a></p>` : ""}${fallbackNote(c, "primary")}</div>
<div class="bb-split__b"><p class="bb-specimen ${fontCls(c, "primary")}">${e(famOf(c, "primary"))}</p>${alphabet(fontCls(c, "primary"))}</div></div>`; },

  "type-secondary": (c) => { const row = (slot, def) => { const t = c.slot[slot]; const files = t ? filesOf(t, c.fonts).usable : []; return `<div class="bb-face"><p class="bb-eyebrow">${e(def.title)}${def.optional ? " · optional" : ""}</p><p class="bb-specimen bb-specimen--m ${fontCls(c, slot)}">${e(slot === "accent" && !t ? "Illustrative accent" : famOf(c, slot))}</p><p class="bb-tile__desc">${e(def.desc)}</p>${alphabet(fontCls(c, slot))}${files.length ? `<p class="bb-dls">${files.map((a) => dl(c.vm, a)).join("")}</p>` : ""}${slot === "accent" && !t ? `<p class="bb-note">Not added yet. The accent typeface is optional.</p>` : fallbackNote(c, slot)}</div>`; };
    return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">02 · Typography</p><h2 class="bb-title bb-title--m" id="bbh-type-secondary">Secondary &amp; accent</h2></header><div class="bb-faces">${row("secondary", TYPE_SLOT_DEFS[1])}${row("accent", TYPE_SLOT_DEFS[2])}</div></div>`; },

  "type-weights": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">02 · Typography</p><h2 class="bb-title bb-title--m" id="bbh-type-weights">Weights</h2></header><ul class="bb-weights">${weightsOf(c, "primary").map((w) => `<li><span class="bb-weights__w">${e(WEIGHT_NAME[w] || "Weight")} ${w}</span><span class="bb-weights__s ${fontCls(c, "primary")} fw-w${w}">${e(c.name)}</span></li>`).join("")}</ul>${real(c, "primary") ? "" : `<p class="bb-note">Example: Framework’s typefaces, until yours is added.</p>`}</div>`,

  "type-hierarchy": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">02 · Typography</p><h2 class="bb-title bb-title--m" id="bbh-type-hierarchy">Hierarchy</h2><p class="bb-lede">How sizes, weights and the two typefaces work together. Relative, not a specification.</p></header>
<ol class="bb-levels">${[["Display", "primary", 700, "bb-lv1", "Make it unmistakable"], ["Heading", "primary", 600, "bb-lv2", "A clear way in"], ["Subheading", "secondary", 500, "bb-lv3", "Supporting detail that guides the eye"], ["Body", "secondary", 400, "bb-lv4", "Set for comfortable reading, in a size and weight that stay quiet so the message can lead."], ["Caption", "secondary", 400, "bb-lv5", "Small print, labels and credits"]].map(([n, s, w, k, sample]) => `<li class="bb-level"><span class="bb-level__n">${n}<span class="visually-hidden">: </span></span><span class="bb-level__s ${k} ${fontCls(c, s)} fw-w${w}">${e(sample)}</span></li>`).join("")}</ol>${real(c, "primary") && real(c, "secondary") ? "" : `<p class="bb-note">Typefaces your brand has not set are shown as Framework’s own.</p>`}</div>`,

  "type-use": (c) => `<div class="bb-spread bb-poster"><p class="bb-poster__brand ${fontCls(c, "secondary")}">${e(c.name)}</p><h2 class="bb-poster__line ${fontCls(c, "primary")} fw-w700" id="bbh-type-use">${e(c.tagline || "Say it once. Set it well.")}</h2><p class="bb-poster__sub ${fontCls(c, "secondary")}">Typography in use. A single idea, a confident size, and room to breathe.</p></div>`,

  /* 03 Colours */
  colours: (c) => `<div class="bb-bands" aria-hidden="true">${c.colours.slice(0, 6).map((x) => `<span class="bb-band"><svg viewBox="0 0 10 10" preserveAspectRatio="none" focusable="false"><rect width="10" height="10" fill="${e(x.hex)}"/></svg></span>`).join("")}</div><div class="bb-open bb-open--over"><p class="bb-numeral" aria-hidden="true">03</p><div class="bb-open__text bb-paper"><h2 class="bb-title" id="bbh-colours">Colours</h2><p class="bb-lede">${c.colours.length} colour${c.colours.length === 1 ? "" : "s"}, with the exact values for screen and print.</p></div></div>`,

  "colour-primary": (c) => { const main = c.colours.filter((x) => x.role === "primary" || x.role === "secondary"); const list = (main.length ? main : c.colours).slice(0, 3); return `<div class="bb-spread bb-spread--bleed"><header class="bb-head"><p class="bb-eyebrow">03 · Colours</p><h2 class="bb-title bb-title--m" id="bbh-colour-primary">Primary palette</h2></header><ul class="bb-fieldrow">${list.map((x) => `<li class="bb-cfield">${swatch(x.hex, x.name || x.hex, "bb-cfield__chip")}<div class="bb-cfield__meta ${textOn(x.hex) === "#FFFFFF" ? "bb-on-dark" : "bb-on-light"}"><p class="bb-cfield__name">${e(x.name || x.hex)}</p>${x.role ? `<p class="bb-label">${e(x.role)}</p>` : ""}<p class="bb-mono">${e(x.hex)} ${copyBtn(x.hex, `${x.name || ""} HEX`)}</p><p class="bb-mono bb-mono--sm">RGB ${e(rgbOf(x.hex))}</p>${x.note ? `<p class="bb-tile__desc">${e(x.note)}</p>` : ""}</div></li>`).join("")}</ul>${c.example ? `<p class="bb-note">Example palette, until your colours are added.</p>` : ""}</div>`; },

  "colour-support": (c) => { const main = new Set(c.colours.filter((x) => x.role === "primary" || x.role === "secondary").slice(0, 3).map((x) => x.hex)); const rest = c.colours.filter((x) => !main.has(x.hex) || c.colours.length <= 3); const list = (rest.length ? rest : c.colours).slice(0, 5); return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">03 · Colours</p><h2 class="bb-title bb-title--m" id="bbh-colour-support">Supporting colours</h2><p class="bb-lede">Used for accents, backgrounds and emphasis, never to compete with the primaries.</p></header><ul class="bb-mosaic bb-mosaic--${list.length}">${list.map((x) => `<li class="bb-mosaic__i">${swatch(x.hex, x.name || x.hex, "bb-mosaic__chip")}<p class="bb-mosaic__n">${e(x.name || x.hex)}</p><p class="bb-mono bb-mono--sm">${e(x.hex)} · RGB ${e(rgbOf(x.hex))}</p></li>`).join("")}</ul></div>`; },

  "colour-contrast": (c) => {
    const hexes = c.colours.map((x) => x.hex); const pairs = []; const seen = new Set();
    const add = (bg, fg) => { const k = bg + fg; if (bg === fg || seen.has(k)) return; seen.add(k); pairs.push({ bg, fg, r: contrast(bg, fg) }); };
    for (const h of hexes) { add(h, "#FFFFFF"); add(h, "#0A0A0A"); for (const g of hexes) add(h, g); }
    const top = pairs.filter((p) => p.r >= 3).sort((a, b) => b.r - a.r).slice(0, 8);
    return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">03 · Colours</p><h2 class="bb-title bb-title--m" id="bbh-colour-contrast">Combinations &amp; contrast</h2><p class="bb-lede">The strongest pairings from your palette, with their WCAG contrast.</p></header>
<ul class="bb-pairs">${top.map((p) => `<li class="bb-pair"><div class="bb-pair__stage" role="img" aria-label="Text ${e(p.fg)} on ${e(p.bg)}"><svg class="bb-pair__bg" viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="10" height="10" fill="${e(p.bg)}"/></svg><svg class="bb-pair__aa" viewBox="0 0 100 60" aria-hidden="true" focusable="false"><text x="50" y="42" text-anchor="middle" fill="${e(p.fg)}" font-size="34" font-weight="700">Aa</text></svg></div><p class="bb-pair__r">${p.r.toFixed(1)}:1</p><p class="bb-label">${e(rate(p.r))}</p></li>`).join("")}</ul>${c.example ? `<p class="bb-note">Example palette, until your colours are added.</p>` : ""}</div>`;
  },

  "colour-balance": (c) => { const n = Math.min(c.colours.length, 3); const w = n >= 3 ? ["bb-w60", "bb-w30", "bb-w10"] : n === 2 ? ["bb-w70", "bb-w30"] : ["bb-w100"]; const label = n >= 3 ? ["60", "30", "10"] : n === 2 ? ["70", "30"] : ["100"]; const main = c.colours[0].hex, pale = c.colours.find((x) => luminance(x.hex) > 0.6); return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">03 · Colours</p><h2 class="bb-title bb-title--m" id="bbh-colour-balance">Balance, light &amp; dark</h2></header>
<div class="bb-balance"><div class="bb-ratio" role="img" aria-label="A suggested balance of ${e(label.join(", "))} percent across the first ${n} colours">${c.colours.slice(0, n).map((x, i) => `<span class="bb-ratio__bar ${w[i]}"><svg viewBox="0 0 10 10" preserveAspectRatio="none" aria-hidden="true" focusable="false"><rect width="10" height="10" fill="${e(x.hex)}"/></svg><span class="bb-ratio__n" aria-hidden="true">${label[i]}%</span></span>`).join("")}</div><p class="bb-note">Suggested balance by role, a Framework default guideline.</p>
<div class="bb-modes"><div class="bb-mode bb-paper"><span class="bb-label">Light</span><svg viewBox="0 0 100 40" aria-hidden="true" focusable="false"><rect width="100" height="40" fill="#FFFFFF"/><rect x="8" y="10" width="46" height="8" fill="${e(main)}"/><rect x="8" y="24" width="30" height="5" fill="${e(textOn(main) === "#FFFFFF" ? "#0A0A0A" : main)}"/><rect x="66" y="10" width="26" height="20" fill="${e(c.colours[1] ? c.colours[1].hex : main)}"/></svg></div><div class="bb-mode bb-ink"><span class="bb-label">Dark</span><svg viewBox="0 0 100 40" aria-hidden="true" focusable="false"><rect width="100" height="40" fill="#0A0A0A"/><rect x="8" y="10" width="46" height="8" fill="${e(pale ? pale.hex : "#FFFFFF")}"/><rect x="8" y="24" width="30" height="5" fill="${e(c.colours[1] ? c.colours[1].hex : main)}"/><rect x="66" y="10" width="26" height="20" fill="${e(main)}"/></svg></div></div></div></div>`; },

  "colour-application": (c) => `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">03 · Colours</p><h2 class="bb-title bb-title--m" id="bbh-colour-application">In application</h2><p class="bb-lede">The palette working together. Illustrative.</p></header>
<div class="bb-apps"><div class="bb-app bb-app--poster bb-c0"><span class="bb-app__line ${fontCls(c, "primary")} fw-w700">${e(c.tagline || c.name)}</span></div><div class="bb-app bb-app--sq bb-c1"><span class="bb-app__line ${fontCls(c, "secondary")}">${e(c.name)}</span></div><div class="bb-app bb-app--card bb-c3"><span class="bb-app__line ${fontCls(c, "secondary")}">${e(c.name)}</span></div></div></div>`,

  /* Files */
  files: (c) => {
    const logos = c.assets.filter((a) => a.kind === "logo").sort((a, b) => String(a.title).localeCompare(String(b.title)) || formatRank(a) - formatRank(b));
    const fontFiles = c.assets.filter((a) => a.kind === "font" && a.canDownload);
    const docs = c.assets.filter((a) => ["guideline", "document", "package"].includes(a.kind) || (a.kind === "other" && !sectionOf(a)));
    const other = c.assets.filter((a) => a.kind === "other" && sectionOf(a));
    const col = (title, list) => `<section class="bb-files__col"><h3 class="bb-files__h">${e(title)}</h3>${list.length ? `<ul class="bb-files__list">${list.map((a) => `<li><a href="${e(href(c.vm, `/branding/files/${a.id}`))}" download><span class="bb-files__n">${e(a.title)}</span><span class="bb-files__m">${e(upper(a.format))} · ${e(fileSize(a.size))}</span></a></li>`).join("")}</ul>` : `<p class="bb-note">None added yet.</p>`}</section>`;
    return `<div class="bb-spread"><header class="bb-head"><p class="bb-eyebrow">Files</p><h2 class="bb-title bb-title--m" id="bbh-files">Everything, ready to download</h2></header><div class="bb-files">${col("Logos", logos)}${col("Fonts", fontFiles)}${col("Documents", docs)}${col("Imagery, layout & more", other)}</div><p class="bb-actions"><a class="bb-link" href="${e(href(c.vm, "/branding"))}">Request additions or changes</a>${c.canUpload ? ` <a class="bb-link" href="${e(href(c.vm, "/branding/uploads"))}">Share your own brand files</a>` : ""}</p></div>`;
  },
};

/* ------------------------------------------------------------------ the page */

export function brandBook(vm, brand, o = {}) {
  const c = context(vm, brand, o);
  const total = CARDS.length;
  const chapterNav = (own) => `<nav class="bb-meta__nav" aria-label="Chapters"><ol>${CHAPTERS.map((h, i) => `<li><a href="#${e(h.id)}" data-bb-go="${CARDS.findIndex((x) => x.id === h.first)}"${own === i ? ' aria-current="true"' : ""}><span class="bb-meta__no">${h.no}</span> ${e(h.title)}</a></li>`).join("")}</ol></nav>`;
  const cards = CARDS.map((card, i) => {
    const no = String(i + 1).padStart(2, "0");
    const body = R[card.id](c);
    const chapter = card.ch === null ? "" : CHAPTERS[card.ch].no;
    return `<section class="bb-card bb-${card.tone}" id="${e(card.id)}" aria-labelledby="bbh-${e(card.id)}" data-bb-card><div class="bb-card__tab" aria-hidden="true"><span class="bb-card__tabno">${chapter || no}</span><span class="bb-card__tabname">${e(card.title)}</span></div>
<div class="bb-card__inner" data-bb-sheet role="region" aria-label="${e(card.title)} page"><div class="bb-meta"><p class="bb-meta__brand" aria-hidden="true">${e(c.name)}</p>${chapterNav(card.ch)}</div><div class="bb-body">${body}</div><div class="bb-folio"><p class="bb-folio__n" aria-hidden="true">${no} / ${total}</p><p class="bb-folio__l"><a href="${e(href(vm, "/branding"))}">Branding page</a></p></div></div></section>`;
  }).join("");
  return `<h1 class="visually-hidden">Brand Book</h1><div class="bb" id="brand-book" data-bb-count="${total}"><div class="bb-runway" data-bb-runway><div class="bb-stage" data-bb-stage><div class="bb-deck" data-bb-deck>${cards}</div></div></div><p class="visually-hidden" role="status" aria-live="polite" data-bb-live></p></div>`;
}
