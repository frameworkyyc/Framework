/**
 * Discovery visuals: the pictures on the option cards, drawn as inline SVG so they need no files, work offline and pass the portal's strict Content-Security-Policy
 * (no style attributes, no scripts: only SVG presentation attributes). They are sketches that show a form, not finished designs. Every function is pure, and the only
 * text it draws is fixed here ("Your Brand"), so nothing a client or Admin types can reach the markup from this file.
 * An Admin can attach a real picture to any option; the page then shows that picture instead (see pages.js).
 */
const W = 240, H = 150;
const svg = (inner, label) => `<svg class="dv" viewBox="0 0 ${W} ${H}" role="img" aria-label="${label}" focusable="false" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;
const idOf = (...parts) => "dv-" + parts.join("-").replace(/[^a-z0-9-]/gi, "-");
const bg = (fill = "#F3F3F1") => `<rect width="${W}" height="${H}" fill="${fill}"/>`;
const INK = "#0A0A0A", MID = "#8A8A8A", SOFT = "#D8D8D4", PAPER = "#FFFFFF";
const SANS = "Helvetica, Arial, sans-serif", SERIF = "Georgia, 'Times New Roman', serif", SCRIPT = "'Snell Roundhand','Segoe Script','Brush Script MT',cursive";
const text = (x, y, s, { size = 22, weight = 700, family = SANS, fill = INK, anchor = "middle", spacing = 0, italic = false } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}"${italic ? ' font-style="italic"' : ""}>${s}</text>`;

/* ------------------------------------------------------------------ logos */
const LOGOS = {
  wordmark: () => text(120, 84, "YOUR BRAND", { size: 25, weight: 700, spacing: 4 }),
  lettermark: () => `<rect x="86" y="36" width="68" height="68" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 85, "YB", { size: 34, weight: 700, family: SERIF })}`,
  emblem: () => `<circle cx="120" cy="75" r="52" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="120" cy="75" r="44" fill="none" stroke="${INK}" stroke-width="1"/>${text(120, 72, "YOUR", { size: 15, spacing: 3 })}${text(120, 92, "BRAND", { size: 15, spacing: 3 })}<path d="M120 42l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" fill="${INK}"/>`,
  crest: () => `<path d="M120 24l44 12v38c0 24-18 40-44 52-26-12-44-28-44-52V36z" fill="none" stroke="${INK}" stroke-width="3"/><path d="M120 34l34 9v31c0 18-14 31-34 41-20-10-34-23-34-41V43z" fill="none" stroke="${INK}" stroke-width="1"/>${text(120, 78, "YB", { size: 30, family: SERIF })}${text(120, 100, "EST. 1987", { size: 8, weight: 600, spacing: 2 })}`,
  pictorial: () => `<path d="M72 92l30-44 20 28 14-18 32 34z" fill="${INK}"/><circle cx="160" cy="46" r="10" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 116, "Your Brand", { size: 16, weight: 600, family: SERIF })}`,
  abstract: () => `<circle cx="104" cy="66" r="28" fill="${INK}"/><circle cx="136" cy="66" r="28" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 118, "YOUR BRAND", { size: 12, weight: 600, spacing: 4 })}`,
  combination: () => `<rect x="44" y="52" width="40" height="40" rx="20" fill="${INK}"/><path d="M54 80l10-18 10 18z" fill="${PAPER}"/>${text(94, 83, "Your Brand", { size: 22, anchor: "start", weight: 700 })}`,
  mascot: () => `<path d="M82 44l16 20h44l16-20 4 44c0 20-20 34-42 34s-42-14-42-34z" fill="${INK}"/><circle cx="104" cy="82" r="5" fill="${PAPER}"/><circle cx="136" cy="82" r="5" fill="${PAPER}"/><path d="M114 98h12l-6 8z" fill="${PAPER}"/>${text(120, 142, "Your Brand", { size: 11, weight: 700 })}`,
  script: () => text(120, 86, "Your Brand", { size: 38, weight: 400, family: SCRIPT, italic: true }),
};

/* ------------------------------------------------------------------ design styles: tiny page sketches */
const STYLES = {
  modern: () => `${bg()}<rect x="0" y="0" width="96" height="150" fill="${INK}"/><rect x="112" y="30" width="100" height="10" fill="${INK}"/><rect x="112" y="48" width="70" height="6" fill="${MID}"/><rect x="112" y="60" width="84" height="6" fill="${SOFT}"/><rect x="112" y="104" width="46" height="16" fill="${INK}"/>`,
  minimalist: () => `${bg(PAPER)}<rect x="40" y="62" width="60" height="3" fill="${INK}"/><rect x="40" y="74" width="36" height="2" fill="${MID}"/><rect x="40" y="130" width="14" height="2" fill="${INK}"/>`,
  luxury: () => `${bg("#111111")}<rect x="14" y="14" width="212" height="122" fill="none" stroke="#BDBDBD" stroke-width="1"/>${text(120, 76, "YOUR BRAND", { size: 17, family: SERIF, weight: 400, spacing: 5, fill: "#F2F2F2" })}<rect x="104" y="90" width="32" height="1" fill="#BDBDBD"/>`,
  traditional: () => `${bg("#FAFAF7")}<rect x="12" y="12" width="216" height="126" fill="none" stroke="${INK}" stroke-width="2"/><rect x="18" y="18" width="204" height="114" fill="none" stroke="${INK}" stroke-width="0.7"/>${text(120, 66, "Your Brand", { size: 20, family: SERIF })}<rect x="82" y="78" width="76" height="2" fill="${INK}"/><rect x="92" y="90" width="56" height="3" fill="${MID}"/>`,
  bold: () => `${bg()}${text(18, 78, "BIG", { size: 62, weight: 900, anchor: "start", spacing: -2 })}<rect x="0" y="100" width="240" height="50" fill="${INK}"/><rect x="18" y="116" width="90" height="10" fill="${PAPER}"/>`,
  playful: () => `${bg("#F6F6F4")}<circle cx="64" cy="58" r="34" fill="${INK}"/><circle cx="146" cy="84" r="26" fill="none" stroke="${INK}" stroke-width="4"/><rect x="170" y="26" width="46" height="46" rx="23" fill="${MID}"/><path d="M40 120q40-30 90 0t90 0" fill="none" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>`,
  industrial: () => `${bg("#E9E9E6")}${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<path d="M${i * 34 - 20} 0l30 0-30 30z" fill="${INK}"/>`).join("")}<rect x="0" y="34" width="240" height="2" fill="${INK}"/>${text(16, 84, "SITE 04 / FRAME", { size: 14, family: "'Courier New', monospace", anchor: "start", weight: 700 })}<rect x="16" y="102" width="100" height="6" fill="${MID}"/><rect x="16" y="116" width="150" height="6" fill="${SOFT}"/>`,
  organic: () => `${bg("#F4F4F0")}<path d="M0 110q50-50 100-14t140-40v94H0z" fill="${SOFT}"/><path d="M120 30q34 10 30 46-34-6-30-46z" fill="${INK}"/><path d="M120 30q-6 24 2 48" fill="none" stroke="${PAPER}" stroke-width="1.5"/>`,
  retro: () => `${bg("#F1EFE8")}${[...Array(11)].map((_, i) => `<path d="M120 150L${-20 + i * 28} 40" stroke="${i % 2 ? INK : MID}" stroke-width="7"/>`).join("")}<circle cx="120" cy="150" r="36" fill="${INK}"/><circle cx="120" cy="150" r="24" fill="#F1EFE8"/>`,
  editorial: () => `${bg(PAPER)}${text(16, 52, "Headline,", { size: 30, family: SERIF, anchor: "start", italic: true, weight: 400 })}${text(16, 80, "set large.", { size: 30, family: SERIF, anchor: "start", italic: true, weight: 400 })}<rect x="16" y="98" width="62" height="3" fill="${MID}"/><rect x="16" y="108" width="62" height="3" fill="${SOFT}"/><rect x="16" y="118" width="62" height="3" fill="${SOFT}"/><rect x="92" y="98" width="62" height="3" fill="${MID}"/><rect x="92" y="108" width="62" height="3" fill="${SOFT}"/><rect x="92" y="118" width="62" height="3" fill="${SOFT}"/><rect x="176" y="20" width="48" height="110" fill="${INK}"/>`,
};

/* ------------------------------------------------------------------ imagery: mood sketches */
const IMAGERY = {
  lifestyle: () => `${bg("#E9E4DC")}<circle cx="92" cy="58" r="16" fill="#8E8579"/><path d="M62 128q0-40 30-40t30 40z" fill="#8E8579"/><circle cx="148" cy="64" r="14" fill="#B2A99C"/><path d="M122 128q0-34 26-34t26 34z" fill="#B2A99C"/>`,
  studio: () => `${bg("#F6F6F6")}<ellipse cx="120" cy="112" rx="52" ry="8" fill="#DADADA"/><rect x="96" y="44" width="48" height="66" rx="8" fill="${INK}"/><rect x="104" y="56" width="32" height="6" fill="#F6F6F6"/>`,
  documentary: () => `<defs><filter id="g1"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.35 0"/></filter></defs>${bg("#BDBDBD")}<rect y="92" width="240" height="58" fill="#4A4A4A"/><path d="M0 92l50-26 40 18 50-34 100 42z" fill="#707070"/><rect width="240" height="150" filter="url(#g1)"/>`,
  aerial: () => `${bg("#DCE0D6")}${[[0, 0, 100, 70, "#C7CEBC"], [100, 0, 140, 50, "#B4BEA6"], [0, 70, 70, 80, "#A9B59A"], [70, 50, 110, 100, "#CFD5C5"], [180, 50, 60, 100, "#B9C3AB"]].map(([x, y, w, h, f]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}" stroke="#F4F4F0" stroke-width="3"/>`).join("")}<path d="M0 110q80-40 240-10" fill="none" stroke="#F4F4F0" stroke-width="5"/>`,
  detail: () => `${bg("#EDE9E2")}<circle cx="120" cy="75" r="56" fill="#CFC8BB"/><circle cx="120" cy="75" r="42" fill="none" stroke="#9C9486" stroke-width="2"/><circle cx="120" cy="75" r="28" fill="none" stroke="#9C9486" stroke-width="2"/><circle cx="120" cy="75" r="14" fill="#7A7366"/>`,
  flat: () => `${bg("#F1F1EE")}<circle cx="170" cy="52" r="22" fill="${INK}"/><rect x="40" y="86" width="60" height="44" fill="${MID}"/><path d="M100 130l36-52 40 52z" fill="${SOFT}"/><rect x="112" y="100" width="20" height="30" fill="${INK}"/>`,
  hand: () => `${bg(PAPER)}<path d="M30 110c20-50 40-60 62-30s40-10 58-34 42 16 60 40" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><path d="M40 124c30-10 60 8 90-2s50 6 72-4" fill="none" stroke="${MID}" stroke-width="2" stroke-linecap="round"/><circle cx="176" cy="38" r="14" fill="none" stroke="${INK}" stroke-width="2.5"/>`,
  abstract3d: () => `<defs><radialGradient id="r1" cx="35%" cy="30%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#6A6A6A"/></radialGradient><radialGradient id="r2" cx="35%" cy="30%"><stop offset="0" stop-color="#F2F2F2"/><stop offset="1" stop-color="#262626"/></radialGradient></defs>${bg("#EDEDED")}<circle cx="96" cy="84" r="44" fill="url(#r1)"/><circle cx="154" cy="70" r="30" fill="url(#r2)"/>`,
  architectural: () => `${bg("#E6E6E4")}<path d="M0 150L110 20l130 130z" fill="#CFCFCB"/><path d="M110 20L240 150H120z" fill="#9A9A96"/><path d="M0 150L110 20" stroke="${INK}" stroke-width="2"/><path d="M110 20V150M60 85h100M30 120h160" stroke="${INK}" stroke-width="1" fill="none"/>`,
};

/* ------------------------------------------------------------------ textures */
const TEXTURES = {
  paper: (id) => `<defs><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="3" seed="2"/><feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.42  0 0 0 0 0.36  0 0 0 0.5 0"/></filter></defs>${bg("#F2EEE6")}<rect width="${W}" height="${H}" filter="url(#${id})"/>`,
  concrete: (id) => `<defs><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.04 0.06" numOctaves="4" seed="7"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0.9 -0.2"/></filter></defs>${bg("#BEBEBA")}<rect width="${W}" height="${H}" filter="url(#${id})"/>`,
  linen: (id) => `<defs><pattern id="${id}" width="6" height="6" patternUnits="userSpaceOnUse"><path d="M0 0h6M0 3h6" stroke="#C9C1B2" stroke-width="0.8"/><path d="M0 0v6M3 0v6" stroke="#D8D1C3" stroke-width="0.8"/></pattern></defs>${bg("#EFEAE0")}<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  marble: (id) => `<defs><filter id="${id}"><feTurbulence type="fractalNoise" baseFrequency="0.012 0.03" numOctaves="5" seed="4"/><feColorMatrix values="0 0 0 0 0.2  0 0 0 0 0.2  0 0 0 0 0.2  0 0 0 2.4 -1.05"/></filter></defs>${bg("#F4F4F2")}<rect width="${W}" height="${H}" filter="url(#${id})"/>`,
  wood: (id) => `<defs><pattern id="${id}" width="240" height="14" patternUnits="userSpaceOnUse"><path d="M0 7q30-6 60 0t60 0 60 0 60 0" fill="none" stroke="#A98A66" stroke-width="1.2"/></pattern></defs>${bg("#D6BE9B")}<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  lines: (id) => `<defs><pattern id="${id}" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M0 5h10" stroke="${INK}" stroke-width="0.6"/></pattern></defs>${bg(PAPER)}<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  halftone: (id) => `<defs><pattern id="${id}" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="6" cy="6" r="3.2" fill="${INK}"/></pattern></defs>${bg(PAPER)}<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  topographic: () => `${bg("#EFEFEA")}${[70, 56, 42, 28, 14].map((r, i) => `<ellipse cx="${100 + i * 4}" cy="${74 - i * 2}" rx="${r * 1.7}" ry="${r}" fill="none" stroke="#8A8A82" stroke-width="1"/>`).join("")}${[96, 82].map((r) => `<ellipse cx="190" cy="40" rx="${r / 3}" ry="${r / 5}" fill="none" stroke="#8A8A82" stroke-width="1"/>`).join("")}`,
  terrazzo: () => `${bg("#EDEBE6")}${[[30, 30, 9], [74, 98, 7], [120, 40, 11], [172, 110, 8], [200, 50, 10], [60, 70, 5], [150, 78, 6], [100, 130, 6], [214, 126, 7], [18, 120, 8]].map(([x, y, r], i) => `<path d="M${x} ${y - r}l${r} ${r * 0.8}-${r * 0.5} ${r}-${r * 1.2}-${r * 0.4}z" fill="${["#8A8A82", "#B8B6AE", INK, "#6A6A64"][i % 4]}"/>`).join("")}`,
  clean: () => `${bg(PAPER)}<rect x="1" y="1" width="238" height="148" fill="none" stroke="${SOFT}" stroke-width="1" stroke-dasharray="4 4"/>${text(120, 82, "plain", { size: 14, weight: 400, fill: MID, family: SERIF, italic: true })}`,
};

/* ------------------------------------------------------------------ icons: the same four symbols in each style */
const GLYPHS = [
  "M3 11l9-8 9 8v10H3z M9 21v-6h6v6",                                         // home
  "M5 4h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z", // phone
  "M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z",   // star
  "M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z M12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", // pin
];
const ICON_STYLES = {
  line: { f: "none", s: INK, w: 1.5, cap: "butt", join: "miter" },
  solid: { f: INK, s: INK, w: 1, cap: "round", join: "round" },
  duotone: { f: SOFT, s: INK, w: 1.8, cap: "round", join: "round" },
  rounded: { f: "none", s: INK, w: 2.6, cap: "round", join: "round" },
  sharp: { f: "none", s: INK, w: 1.2, cap: "square", join: "miter" },
  hand: { f: "none", s: INK, w: 1.8, cap: "round", join: "round", wobble: true },
  badge: { f: "none", s: PAPER, w: 1.8, cap: "round", join: "round", badge: true },
};
const icons = (key) => {
  const st = ICON_STYLES[key] || ICON_STYLES.line;
  return bg(PAPER) + GLYPHS.map((d, i) => {
    const x = 18 + i * 54, y = 48, wob = st.wobble ? ` transform="rotate(${[-3, 2, -2, 3][i]} 12 12)"` : "";
    const base = st.badge ? `<circle cx="${x + 18}" cy="${y + 18}" r="22" fill="${INK}"/>` : "";
    const glyph = `<g transform="translate(${x + (st.badge ? 6 : 0)} ${y + (st.badge ? 6 : 0)}) scale(${st.badge ? 0.5 : 1.5})"${st.badge ? "" : ""}><g${wob}><path d="${d}" fill="${st.f}" stroke="${st.s}" stroke-width="${st.w}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}" fill-rule="evenodd"/></g></g>`;
    return base + glyph;
  }).join("");
};

/* ------------------------------------------------------------------ layouts: grey wireframes */
const blk = (x, y, w, h, f = SOFT) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;
const LAYOUTS = {
  airy: () => `${bg(PAPER)}${blk(30, 40, 90, 6, INK)}${blk(30, 54, 56, 4, MID)}${blk(30, 124, 24, 3, INK)}${blk(150, 40, 60, 70)}`,
  modular: () => `${bg()}${[0, 1, 2].map((c) => [0, 1].map((r) => blk(14 + c * 74, 16 + r * 66, 68, 60, r === 0 && c === 1 ? INK : SOFT)).join("")).join("")}`,
  editorial: () => `${bg(PAPER)}${blk(16, 16, 96, 8, INK)}${blk(16, 32, 70, 8, INK)}${blk(16, 62, 96, 3, MID)}${blk(16, 72, 96, 3)}${blk(16, 82, 96, 3)}${blk(128, 16, 96, 118)}`,
  centred: () => `${bg(PAPER)}${blk(70, 22, 100, 8, INK)}${blk(90, 38, 60, 4, MID)}${blk(40, 58, 160, 52)}${blk(100, 122, 40, 12, INK)}`,
  fullbleed: () => `${bg(SOFT)}${blk(0, 0, 240, 150, "#BFBFBA")}${blk(24, 92, 120, 10, PAPER)}${blk(24, 110, 80, 5, PAPER)}`,
  dense: () => `${bg(PAPER)}${[0, 1, 2, 3, 4].map((r) => blk(10, 14 + r * 26, 220, 20, r % 2 ? "#EFEFEC" : SOFT)).join("")}${[0, 1, 2, 3, 4].map((r) => blk(16, 20 + r * 26, 40, 8, INK)).join("")}`,
  cards: () => `${bg("#EDEDEA")}${[0, 1, 2].map((c) => `<rect x="${14 + c * 74}" y="22" width="68" height="106" rx="8" fill="${PAPER}"/>${blk(22 + c * 74, 30, 52, 40)}${blk(22 + c * 74, 80, 40, 5, INK)}${blk(22 + c * 74, 92, 52, 3, MID)}`).join("")}`,
  split: () => `${bg(PAPER)}${blk(0, 0, 120, 150, INK)}${blk(142, 40, 80, 8, INK)}${blk(142, 58, 60, 4, MID)}${blk(142, 100, 40, 14, INK)}`,
};

const MAPS = { logo: LOGOS, style: STYLES, imagery: IMAGERY, texture: TEXTURES, layout: LAYOUTS };

/** Colour palette strip: five swatches. `colours` must be #RRGGBB. */
export function paletteSvg(colours, label) {
  const ok = (Array.isArray(colours) ? colours : []).filter((c) => /^#[0-9A-Fa-f]{6}$/.test(c)).slice(0, 8);
  const w = ok.length ? W / ok.length : W;
  return svg(ok.map((c, i) => `<rect x="${i * w}" y="0" width="${w + 0.5}" height="${H}" fill="${c}"/>`).join(""), label);
}

/**
 * @param {string} visual  the question's visual type: logo | style | palette | imagery | texture | icons | layout (word, font and tagline cards are text and return "")
 * @param {object} option  { key, label, colours? }
 * @returns {string} an <svg> element, or "" when the card is text
 */
export function visualFor(visual, option, questionKey = "") {
  const label = `${option.label} sketch`.replace(/[^\w \-&’,./()]/g, "");
  if (visual === "palette") return paletteSvg(option.colours, `${option.label} palette`);
  if (visual === "icons") return svg(icons(option.key), label);
  const map = MAPS[visual];
  const draw = map && Object.prototype.hasOwnProperty.call(map, option.key) ? map[option.key] : null;
  if (!draw) return "";
  const inner = draw(idOf(questionKey, option.key));
  const bare = visual === "logo" || visual === "texture";
  // logos sit on a plain paper tile; the others draw their own tile
  return svg(bare && visual === "logo" ? bg(PAPER) + inner : inner, label);
}

export const VISUAL_TYPES = Object.freeze(["word", "style", "logo", "font", "tagline", "palette", "imagery", "texture", "icons", "layout"]);
