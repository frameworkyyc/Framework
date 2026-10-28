/**
 * Example previews for Branding sections the client has no approved content for yet. They show what a section is and what a professionally developed version looks like,
 * using Framework's own branding. Application-level content: these are code, not client data, so they are never stored in a client's records, never listed as assets, never
 * downloadable and carry no copy buttons. Each is clearly labelled "Example: Framework" and styled in muted grey (a light panel), and approved client content always replaces it.
 * Pure HTML strings, no script and no inline style: all presentation is in /assets/css/portal.css, and drawings are inline SVG with presentation attributes (allowed by the CSP).
 * Images are Framework's own static files served from this site; fonts are the portal's own Switzer and General Sans (already loaded for every portal page).
 */
import { e } from "./ui.js";

export const EXAMPLE_LABEL = "Example: Framework";

/** The small status line every example section starts with: "Not added yet", the example label and one concise sentence. */
const intro = (sentence) => `<p class="bk-eg__label"><span class="tag">Not added yet</span> <span class="bk-eg__tag">${e(EXAMPLE_LABEL)}</span></p><p class="bk-eg__line muted">${e(sentence)}</p>`;
const panel = (cls, inner, sentence) => `<div class="bk-eg ${cls}">${intro(sentence)}${inner}</div>`;

/* ------------------------------------------------------------------ 02 Typography */

export const TYPE_EXAMPLES = Object.freeze({
  primary: Object.freeze({ family: "Switzer", cls: "eg-sw", role: "Headings and prominent brand messaging", weights: [["Semibold", 600], ["Bold", 700]], usage: "Used for headlines, titles and the messages you want noticed first." }),
  secondary: Object.freeze({ family: "General Sans", cls: "eg-gs", role: "Body copy and supporting communications", weights: [["Regular", 400], ["Medium", 500], ["Semibold", 600]], usage: "Used for paragraphs, descriptions and everyday communication, so longer text stays easy to read." }),
  accent: Object.freeze({ family: "Illustrative accent", cls: "eg-accent", role: "Optional: limited decorative or specialized use", weights: [], usage: "An accent typeface can add character to an editorial quote, packaging or a promotion. Not every brand needs one." }),
});

const ALPHABET = ["ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz", "0123456789 & ! ? @ #"];

/** A muted example typeface card in the same layout as an approved one: role, family, weights, specimen, characters and usage. The Accent card is generic and says so. */
export function exampleTypeCard(def) {
  const x = TYPE_EXAMPLES[def.key];
  const weights = x.weights.length ? `<ul class="bk-weights" aria-label="Example weights">${x.weights.map(([n, w]) => `<li>${e(n)} <span class="muted">${w}</span></li>`).join("")}</ul>` : "";
  const note = def.key === "accent"
    ? `Example: Framework. Illustrative only: a generic serif, not a Framework typeface. Not every brand needs an Accent Typeface.`
    : `${EXAMPLE_LABEL}. ${x.family} is the typeface Framework uses for ${def.key === "primary" ? "headings" : "text"}.`;
  return `<li class="tf-card tf-card--example"><div class="tf-card__stage tf-card__stage--example"><p class="tf-card__aa ${x.cls}">Aa Bb Cc 123</p></div><div class="tf-card__body"><p class="lv-card__no" aria-hidden="true">${e(def.no)}</p><h3 class="lv-card__title">${e(def.title)}</h3><p class="lv-card__status"><span class="tag">Not added yet</span>${def.optional ? ` <span class="tag">Optional</span>` : ""}</p><p class="tf-card__family ${x.cls}">${e(x.family)}</p><p class="muted small">${e(x.role)}</p>${weights}<div class="tf-card__chars ${x.cls}">${ALPHABET.map((l) => `<p>${e(l)}</p>`).join("")}</div><p class="small">${e(x.usage)}</p><p class="tf-card__note muted small">${e(note)}</p></div></li>`;
}

/* ------------------------------------------------------------------ 03 Brand Colours */

const EG_COLOURS = Object.freeze([["Ink", "Primary", "#0A0A0A"], ["Slate", "Secondary", "#5C5C5C"], ["Hairline", "Neutral", "#E0E0E0"], ["Mist", "Neutral", "#F5F5F5"], ["Signal", "Accent, used sparingly", "#B3261E"]]);
const rgbOf = (hex) => `${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)}`;

/** Framework's own palette as an example: swatches, names and values, with no copy button (it is not the client's palette). */
export function exampleColours() {
  const chips = EG_COLOURS.map(([name, role, hex]) => `<li class="swatch swatch--example"><svg class="swatch__chip swatch__chip--edge" viewBox="0 0 100 60" role="img" aria-label="${e(name)}, ${e(hex)}" focusable="false"><rect width="100" height="60" fill="${e(hex)}"/></svg><div class="swatch__body"><p class="swatch__name">${e(name)}</p><p class="muted small">${e(role)}</p><p class="swatch__code"><code>${e(hex)}</code></p><p class="muted small">RGB ${e(rgbOf(hex))}</p></div></li>`).join("");
  return panel("bk-eg--colours", `<ul class="swatches">${chips}</ul>`, "Primary, secondary and neutral colours work together to keep every touchpoint consistent.");
}

/* ------------------------------------------------------------------ 04 Tagline */

export function exampleTagline() {
  return panel("bk-eg--tagline", `<p class="bk-eg__tagline">Clear thinking, beautifully made.</p><p class="muted small">Example copy, not a real tagline.</p>`, "A tagline states your positioning in a few words and sits alongside your logo.");
}

/* ------------------------------------------------------------------ 05 Brand Imagery */

const IMG = "/assets/img";
export function exampleImagery() {
  const tiles = [["arch-concrete-corner.jpg", "The stepped concrete corner of a building against a flat sky"], ["arch-glass-corner.jpg", "The glazed corner of a new building seen from below"], ["arch-courtyard.jpg", "Four towers seen from the courtyard between them, looking straight up"]]
    .map(([f, alt]) => `<li class="bk-eg__img"><img src="${IMG}/${f}" alt="${e(alt)}" loading="lazy" decoding="async"></li>`).join("");
  return panel("bk-eg--imagery", `<ul class="bk-eg__imgs">${tiles}</ul>`, "A consistent subject, composition and mood make separate images feel like one brand.");
}

/* ------------------------------------------------------------------ 06 Layout System */

export function exampleLayout() {
  const cols = Array.from({ length: 12 }, () => `<span></span>`).join("");
  return panel("bk-eg--layout", `<div class="eg-layout" aria-hidden="true"><div class="eg-layout__cols">${cols}</div><div class="eg-layout__page"><div class="eg-layout__bar"></div><div class="eg-layout__media"></div><div class="eg-layout__text"><i></i><i></i><i></i></div></div></div>`, "A shared grid, margins and spacing keep every page and print piece aligned.");
}

/* ------------------------------------------------------------------ 07 Textures */

const PATTERNS = Object.freeze([
  ["Lines", `<pattern id="egp-lines" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 4H8" stroke="#A3A3A3" stroke-width="1"/></pattern>`, "egp-lines"],
  ["Dots", `<pattern id="egp-dots" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="5" cy="5" r="1.2" fill="#A3A3A3"/></pattern>`, "egp-dots"],
  ["Grid", `<pattern id="egp-grid" width="12" height="12" patternUnits="userSpaceOnUse"><path d="M12 0V12H0" fill="none" stroke="#A3A3A3" stroke-width="0.8"/></pattern>`, "egp-grid"],
  ["Hatch", `<pattern id="egp-hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M-1 9L9 -1" stroke="#A3A3A3" stroke-width="1"/></pattern>`, "egp-hatch"],
]);
export function exampleTextures() {
  const tiles = PATTERNS.map(([name, def, id]) => `<li class="bk-eg__tile"><svg viewBox="0 0 100 100" role="img" aria-label="${e(name)} pattern" focusable="false"><defs>${def}</defs><rect width="100" height="100" fill="#FFFFFF"/><rect width="100" height="100" fill="url(#${id})"/></svg><p class="small">${e(name)}</p></li>`).join("");
  return panel("bk-eg--textures", `<ul class="bk-eg__tiles">${tiles}</ul>`, "Subtle patterns add depth and recognisability without competing with your logo.");
}

/* ------------------------------------------------------------------ 08 Iconography */

const ICONS = Object.freeze([
  ["Home", `<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>`],
  ["Message", `<path d="M4 6h16v10H9l-5 4z"/>`],
  ["Phone", `<path d="M7 4h3l1.5 4-2 1.5a10 10 0 0 0 5 5L16 12.5l4 1.5v3a2 2 0 0 1-2 2A14 14 0 0 1 5 6a2 2 0 0 1 2-2z"/>`],
  ["Calendar", `<rect x="4" y="5" width="16" height="15"/><path d="M4 10h16M9 3v4M15 3v4"/>`],
  ["Check", `<circle cx="12" cy="12" r="8"/><path d="M8.5 12.5l2.5 2.5 4.5-5"/>`],
  ["Arrow", `<path d="M5 12h14"/><path d="M13 6l6 6-6 6"/>`],
]);
export function exampleIcons() {
  const tiles = ICONS.map(([name, d]) => `<li class="bk-eg__tile bk-eg__tile--icon"><svg viewBox="0 0 24 24" fill="none" stroke="#0A0A0A" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true" focusable="false">${d}</svg><p class="small">${e(name)}</p></li>`).join("");
  return panel("bk-eg--icons", `<ul class="bk-eg__tiles bk-eg__tiles--icons">${tiles}</ul>`, "One stroke weight, scale and style make a set of icons read as a single family.");
}

/* ------------------------------------------------------------------ 09 Design Style */

export function exampleStyle() {
  const chips = ["#0A0A0A", "#5C5C5C", "#E0E0E0", "#F5F5F5"].map((hex) => `<svg viewBox="0 0 40 40" role="img" aria-label="${e(hex)}" focusable="false"><rect width="40" height="40" fill="${hex}"/></svg>`).join("");
  return panel("bk-eg--style", `<div class="eg-style"><div class="eg-style__text"><img class="eg-style__logo" src="${IMG}/logo-examples/framework-secondary.png" alt="Example: the Framework secondary logo" width="1920" height="1080" loading="lazy" decoding="async"><p class="eg-style__head eg-sw">Considered. Simple. Consistent.</p><p class="eg-gs">Logo, typography, colour, imagery and layout, each doing one job, all speaking with one voice.</p><div class="eg-style__chips" aria-hidden="true">${chips}</div></div><div class="eg-style__media"><img src="${IMG}/arch-glass-corner.jpg" alt="The glazed corner of a new building seen from below" loading="lazy" decoding="async"></div></div>`, "Logo, typography, colours, imagery and layout combine into one recognisable identity.");
}
