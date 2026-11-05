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
/** A four-pointed sparkle centred on (x, y). */
const star = (x, y, r, fill = INK) => `<path d="M${x} ${y - r}L${+(x + r * 0.3).toFixed(2)} ${+(y - r * 0.3).toFixed(2)}L${x + r} ${y}L${+(x + r * 0.3).toFixed(2)} ${+(y + r * 0.3).toFixed(2)}L${x} ${y + r}L${+(x - r * 0.3).toFixed(2)} ${+(y + r * 0.3).toFixed(2)}L${x - r} ${y}L${+(x - r * 0.3).toFixed(2)} ${+(y - r * 0.3).toFixed(2)}Z" fill="${fill}"/>`;
const lcg = (seed) => { let v = seed; return () => { v = (v * 1664525 + 1013904223) % 4294967296; return v / 4294967296; }; };
const text = (x, y, s, { size = 22, weight = 700, family = SANS, fill = INK, anchor = "middle", spacing = 0, italic = false } = {}) =>
  `<text x="${x}" y="${y}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}" letter-spacing="${spacing}"${italic ? ' font-style="italic"' : ""}>${s}</text>`;

/* ------------------------------------------------------------------ logos */
const LOGOS = {
  wordmark: () => text(120, 84, "YOUR BRAND", { size: 25, weight: 700, spacing: 4 }),
  lettermark: () => `<rect x="86" y="36" width="68" height="68" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 85, "YB", { size: 34, weight: 700, family: SERIF })}`,
  emblem: () => `<circle cx="120" cy="75" r="52" fill="none" stroke="${INK}" stroke-width="3"/><circle cx="120" cy="75" r="44" fill="none" stroke="${INK}" stroke-width="1"/>${text(120, 72, "YOUR", { size: 15, spacing: 3 })}${text(120, 92, "BRAND", { size: 15, spacing: 3 })}<path d="M120 42l3 6h6l-5 4 2 6-6-4-6 4 2-6-5-4h6z" fill="${INK}"/>`,
  crest: () => `<path d="M120 14l42 11v34c0 22-16 36-42 46-26-10-42-24-42-46V25z" fill="none" stroke="${INK}" stroke-width="3"/><path d="M120 22l34 9v28c0 17-12 29-34 38-22-9-34-21-34-38V31z" fill="none" stroke="${INK}" stroke-width="1"/>${star(120, 40, 6)}${text(120, 70, "YB", { size: 26, family: SERIF })}<rect x="82" y="100" width="76" height="22" fill="${INK}"/>${text(120, 115, "EST. 1987", { size: 9, weight: 700, spacing: 2, fill: PAPER })}`,
  pictorial: () => `<path d="M72 92l30-44 20 28 14-18 32 34z" fill="${INK}"/><circle cx="160" cy="46" r="10" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 116, "Your Brand", { size: 16, weight: 600, family: SERIF })}`,
  abstract: () => `<circle cx="104" cy="66" r="28" fill="${INK}"/><circle cx="136" cy="66" r="28" fill="none" stroke="${INK}" stroke-width="3"/>${text(120, 118, "YOUR BRAND", { size: 12, weight: 600, spacing: 4 })}`,
  combination: () => `<rect x="44" y="52" width="40" height="40" rx="20" fill="${INK}"/><path d="M54 80l10-18 10 18z" fill="${PAPER}"/>${text(94, 83, "Your Brand", { size: 22, anchor: "start", weight: 700 })}`,
  mascot: () => `<path d="M82 44l16 20h44l16-20 4 44c0 20-20 34-42 34s-42-14-42-34z" fill="${INK}"/><circle cx="104" cy="82" r="5" fill="${PAPER}"/><circle cx="136" cy="82" r="5" fill="${PAPER}"/><path d="M114 98h12l-6 8z" fill="${PAPER}"/>${text(120, 142, "Your Brand", { size: 11, weight: 700 })}`,
  script: () => text(120, 84, "Your Brand", { size: 30, weight: 400, family: SCRIPT, italic: true }),
  celestial: () => `<circle cx="112" cy="62" r="30" fill="${INK}"/><circle cx="125" cy="55" r="26" fill="${PAPER}"/>${star(152, 38, 7)}${star(168, 72, 5)}${star(92, 34, 4)}${star(84, 86, 3.5)}${text(120, 124, "YOUR BRAND", { size: 12, weight: 600, family: SERIF, spacing: 5 })}`,
  botanical: () => `<path d="M120 112C119 90 121 66 120 34" fill="none" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/><ellipse cx="120" cy="32" rx="4" ry="9" fill="${INK}"/>${[44, 58, 72, 86].map((y, k) => `<ellipse cx="${k % 2 ? 131 : 109}" cy="${y}" rx="12" ry="4.6" transform="rotate(${k % 2 ? 38 : -38} ${k % 2 ? 131 : 109} ${y})" fill="${INK}"/><ellipse cx="${k % 2 ? 109 : 131}" cy="${y + 8}" rx="11" ry="4.2" transform="rotate(${k % 2 ? -38 : 38} ${k % 2 ? 109 : 131} ${y + 8})" fill="${INK}"/>`).join("")}${text(120, 134, "Your Brand", { size: 15, weight: 400, family: SERIF, italic: true })}`,
  ornamental: () => `<rect x="62" y="22" width="116" height="84" fill="none" stroke="${INK}" stroke-width="2"/><rect x="68" y="28" width="104" height="72" fill="none" stroke="${INK}" stroke-width="0.8"/>${[[62, 22], [178, 22], [62, 106], [178, 106]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="5.5" fill="${PAPER}" stroke="${INK}" stroke-width="1.5"/><circle cx="${x}" cy="${y}" r="1.6" fill="${INK}"/>`).join("")}${text(120, 72, "YB", { size: 36, weight: 400, family: SERIF, italic: true })}<path d="M92 86h22M126 86h22" stroke="${INK}" stroke-width="0.9"/><path d="M120 82l4 4-4 4-4-4z" fill="${INK}"/>${text(120, 130, "YOUR BRAND", { size: 10, weight: 600, family: SERIF, spacing: 4 })}`,
  spiritual: () => { const petal = (len, w) => `M120 ${90 - len}C${120 + w} ${+(90 - len * 0.7).toFixed(1)} ${120 + w} ${+(90 - len * 0.25).toFixed(1)} 120 90C${120 - w} ${+(90 - len * 0.25).toFixed(1)} ${120 - w} ${+(90 - len * 0.7).toFixed(1)} 120 ${90 - len}z`; return `<circle cx="120" cy="66" r="46" fill="none" stroke="${INK}" stroke-width="0.8"/>${[[-58, 34], [58, 34], [-30, 42], [30, 42], [0, 52]].map(([a, len]) => `<path d="${petal(len, 12)}" transform="rotate(${a} 120 90)" fill="${a === 0 ? INK : "none"}" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>`).join("")}<path d="M92 98h56" stroke="${INK}" stroke-width="1.6" stroke-linecap="round"/><circle cx="120" cy="24" r="2.2" fill="${INK}"/>${text(120, 130, "YOUR BRAND", { size: 11, weight: 600, family: SERIF, spacing: 5 })}`; },
  expressive: () => `<circle cx="120" cy="62" r="50" fill="none" stroke="${INK}" stroke-width="2.5"/><circle cx="120" cy="62" r="44" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="1.5 3.5"/><circle cx="120" cy="42" r="8" fill="${INK}"/>${[...Array(12)].map((_, k) => { const a = (k * 30 * Math.PI) / 180, c = Math.cos(a), si = Math.sin(a); return `<path d="M${+(120 + 12 * c).toFixed(1)} ${+(42 + 12 * si).toFixed(1)}L${+(120 + 17 * c).toFixed(1)} ${+(42 + 17 * si).toFixed(1)}" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>`; }).join("")}<circle cx="120" cy="84" r="14" fill="${INK}"/><circle cx="127" cy="79" r="12" fill="${PAPER}"/>${star(94, 40, 5)}${star(146, 40, 5)}${star(94, 86, 4)}${star(146, 86, 4)}${text(120, 132, "YOUR BRAND", { size: 11, weight: 600, family: SERIF, spacing: 4 })}`,
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
  holistic: () => `${bg("#F3F1EA")}${[52, 40, 28].map((r) => `<circle cx="120" cy="75" r="${r}" fill="none" stroke="${MID}" stroke-width="1"/>`).join("")}<path d="M120 102c-18-10-20-38 0-54 20 16 18 44 0 54z" fill="${INK}"/><path d="M120 100V58" stroke="${PAPER}" stroke-width="1.4"/>`,
  mystical: () => `${bg("#131313")}<rect x="12" y="12" width="216" height="126" fill="none" stroke="#7A7A7A" stroke-width="1"/><circle cx="120" cy="64" r="20" fill="#EDEDED"/><circle cx="129" cy="58" r="17" fill="#131313"/>${star(86, 50, 5, "#EDEDED")}${star(160, 40, 4, "#EDEDED")}${star(152, 92, 3.5, "#EDEDED")}${star(80, 96, 3, "#EDEDED")}${text(120, 120, "YOUR BRAND", { size: 11, weight: 400, family: SERIF, spacing: 5, fill: "#EDEDED" })}`,
  ethereal: (id) => `<defs><radialGradient id="${id}a" cx="50%" cy="45%" r="62%"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#D6D6DC"/></radialGradient><radialGradient id="${id}b"><stop offset="0" stop-color="#FFFFFF" stop-opacity="0.95"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#${id}a)"/><circle cx="88" cy="60" r="44" fill="url(#${id}b)"/><circle cx="152" cy="90" r="52" fill="url(#${id}b)"/><circle cx="172" cy="38" r="22" fill="url(#${id}b)"/>${text(120, 82, "Your Brand", { size: 22, weight: 300, family: SERIF, fill: "#66666C", italic: true, spacing: 1 })}`,
  romantic: () => `${bg("#F5F1F0")}${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="120" cy="44" rx="14" ry="25" transform="rotate(${a} 120 64)" fill="#D9D3D3" fill-opacity="0.8" stroke="#8A8A8A" stroke-width="0.8"/>`).join("")}<circle cx="120" cy="64" r="5" fill="${INK}"/>${text(120, 136, "Your Brand", { size: 14, weight: 400, family: SERIF, italic: true })}`,
  feminine: () => `${bg(PAPER)}<path d="M82 134V72a38 38 0 0 1 76 0v62z" fill="#EFEDED"/><path d="M92 134V74a28 28 0 0 1 56 0v60" fill="none" stroke="#9A9A9A" stroke-width="1"/>${text(120, 82, "Your", { size: 18, weight: 400, family: SERIF, italic: true })}${text(120, 104, "Brand", { size: 18, weight: 400, family: SERIF, italic: true })}<path d="M106 116q14 7 28 0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-linecap="round"/><circle cx="120" cy="22" r="2.2" fill="${INK}"/>`,
  bohemian: () => `${bg("#F1EEE8")}${[52, 40, 28, 16].map((r, k) => `<path d="M${120 - r} 118V80a${r} ${r} 0 0 1 ${2 * r} 0v38" fill="none" stroke="${k % 2 ? MID : INK}" stroke-width="3"/>`).join("")}${[...Array(15)].map((_, k) => `<path d="M${22 + k * 14.7} 122v12" stroke="${SOFT}" stroke-width="2.4" stroke-linecap="round"/>`).join("")}${[...Array(7)].map((_, k) => `<circle cx="${60 + k * 20}" cy="20" r="2.6" fill="${k % 2 ? MID : INK}"/>`).join("")}`,
  ornamental: () => `${bg("#FAF9F5")}<rect x="40" y="38" width="160" height="80" fill="none" stroke="${INK}" stroke-width="1.5"/><rect x="46" y="44" width="148" height="68" fill="none" stroke="${INK}" stroke-width="0.6"/>${[[40, 38], [200, 38], [40, 118], [200, 118]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="${PAPER}" stroke="${INK}" stroke-width="0.8"/><circle cx="${x}" cy="${y}" r="2.2" fill="${INK}"/>`).join("")}${text(120, 76, "Your Brand", { size: 21, weight: 400, family: SERIF, italic: true })}<path d="M78 92h34M128 92h34" stroke="${INK}" stroke-width="0.8"/><path d="M120 87l5 5-5 5-5-5z" fill="${INK}"/>`,
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
  softfocus: (id) => `<defs><filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="9"/></filter></defs>${bg("#EFEAE8")}<circle cx="88" cy="70" r="34" fill="#CFC6C6" filter="url(#${id}f)"/><circle cx="152" cy="86" r="40" fill="#E2DADA" filter="url(#${id}f)"/><circle cx="174" cy="44" r="20" fill="#FFFFFF" filter="url(#${id}f)"/>`,
  flatlay: () => `${bg("#EFEDE9")}<circle cx="78" cy="62" r="28" fill="${SOFT}" stroke="${MID}" stroke-width="1.5"/><circle cx="78" cy="62" r="18" fill="none" stroke="${MID}" stroke-width="1"/><rect x="128" y="40" width="64" height="46" transform="rotate(-8 160 63)" fill="${INK}"/><rect x="134" y="48" width="52" height="3" transform="rotate(-8 160 63)" fill="${PAPER}" fill-opacity="0.6"/><ellipse cx="104" cy="112" rx="26" ry="8" transform="rotate(-18 104 112)" fill="#9AA392"/><circle cx="176" cy="116" r="9" fill="${MID}"/><rect x="30" y="102" width="40" height="5" rx="2.5" fill="${SOFT}"/>`,
  botanical: () => `${bg("#E9EBE4")}${[[62, 140, 110], [120, 144, 124], [182, 140, 100]].map(([x, y, h], k) => `<path d="M${x} ${y}q${k === 1 ? 0 : 8} ${-h / 2} ${k === 0 ? -6 : k === 2 ? 6 : 0} ${-h}" fill="none" stroke="#6F7C66" stroke-width="2" stroke-linecap="round"/>${[0.25, 0.45, 0.65, 0.85].map((t, n) => `<ellipse cx="${x + (n % 2 ? 11 : -11)}" cy="${+(y - h * t).toFixed(1)}" rx="12" ry="4.6" transform="rotate(${n % 2 ? 35 : -35} ${x + (n % 2 ? 11 : -11)} ${+(y - h * t).toFixed(1)})" fill="${k === 1 ? "#8A9A80" : "#A7B39C"}"/>`).join("")}`).join("")}`,
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
  watercolour: (id) => `<defs><filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter></defs>${bg("#F6F4F1")}<ellipse cx="80" cy="60" rx="62" ry="38" fill="#C6BDD0" fill-opacity="0.75" filter="url(#${id})"/><ellipse cx="156" cy="88" rx="70" ry="40" fill="#D9C6BE" fill-opacity="0.75" filter="url(#${id})"/><ellipse cx="124" cy="34" rx="52" ry="24" fill="#BCCBC3" fill-opacity="0.65" filter="url(#${id})"/>`,
  floral: (id) => `<defs><pattern id="${id}" width="44" height="44" patternUnits="userSpaceOnUse"><g transform="translate(22 22)">${[0, 72, 144, 216, 288].map((a) => `<circle cx="0" cy="-6" r="3.6" transform="rotate(${a})" fill="#D3C9C9" stroke="#9A8F8F" stroke-width="0.6"/>`).join("")}<circle r="2" fill="#8A7F7F"/></g><ellipse cx="2" cy="2" rx="4" ry="1.6" transform="rotate(-35 2 2)" fill="#B7C0AF"/><ellipse cx="42" cy="42" rx="4" ry="1.6" transform="rotate(-35 42 42)" fill="#B7C0AF"/></pattern></defs>${bg("#F7F4F2")}<rect width="${W}" height="${H}" fill="url(#${id})"/>`,
  gilded: (id) => { const r = lcg(7); return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#B8975A"/><stop offset="0.45" stop-color="#EBD9A4"/><stop offset="1" stop-color="#A5834A"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${id})"/>${[...Array(46)].map(() => `<rect x="${+(r() * 232).toFixed(1)}" y="${+(r() * 144).toFixed(1)}" width="${+(1.5 + r() * 4).toFixed(1)}" height="${+(0.8 + r() * 1.6).toFixed(1)}" transform="rotate(${Math.round(r() * 160)} 120 75)" fill="#FFF6D6" fill-opacity="${+(0.35 + r() * 0.5).toFixed(2)}"/>`).join("")}`; },
  starfield: () => { const r = lcg(11); return `${bg("#161616")}${[...Array(46)].map(() => `<circle cx="${+(r() * 240).toFixed(1)}" cy="${+(r() * 150).toFixed(1)}" r="${+(0.5 + r() * 1.1).toFixed(2)}" fill="#EDEDED" fill-opacity="${+(0.45 + r() * 0.55).toFixed(2)}"/>`).join("")}${star(60, 44, 6, "#EDEDED")}${star(168, 96, 7, "#EDEDED")}${star(204, 34, 4, "#EDEDED")}${star(104, 112, 4.5, "#EDEDED")}`; },
};

/* ------------------------------------------------------------------ icons: the same four symbols in each style */
/* Each glyph is drawn on a 24-unit grid. `cx, cy` is the centre of its real bounding box (measured in a browser), so every symbol is placed by its true centre, not by the grid's. */
const GLYPHS = [
  { d: "M3 11l9-8 9 8v10H3z M9 21v-6h6v6", cx: 12, cy: 12 },                                                                 // home
  { d: "M5 4h4l2 5-3 2a11 11 0 006 6l2-3 5 2v4a2 2 0 01-2 2A17 17 0 013 6a2 2 0 012-2z", cx: 12, cy: 13 },                      // phone
  { d: "M12 3l2.8 5.8 6.2.9-4.5 4.4 1.1 6.2L12 17.4 6.4 20.3l1.1-6.2L3 9.7l6.2-.9z", cx: 12, cy: 11.65 },                      // star
  { d: "M12 21s-7-6.5-7-12a7 7 0 0114 0c0 5.5-7 12-7 12z M12 11.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z", cx: 12, cy: 11.5 },       // pin
];
const ICON_STYLES = {
  line: { f: "none", s: INK, w: 1.5, cap: "butt", join: "miter" },
  solid: { f: INK, s: INK, w: 1, cap: "round", join: "round" },
  duotone: { f: SOFT, s: INK, w: 1.8, cap: "round", join: "round" },
  rounded: { f: "none", s: INK, w: 2.6, cap: "round", join: "round" },
  sharp: { f: "none", s: INK, w: 1.2, cap: "square", join: "miter" },
  hand: { f: "none", s: INK, w: 1.8, cap: "round", join: "round", wobble: true },
  badge: { f: "none", s: PAPER, w: 1.5, cap: "round", join: "round", badge: true },
};
const ICON_CENTRES = [36, 92, 148, 204]; // four symbols, evenly spaced, centred on the tile (120, 75)
const icons = (key) => {
  const st = ICON_STYLES[key] || ICON_STYLES.line;
  const scale = st.badge ? 1.35 : 1.6; // inside a badge the symbol is about half the circle's width
  return bg(PAPER) + GLYPHS.map((g, i) => {
    const cx = ICON_CENTRES[i], cy = 75;
    const wob = st.wobble ? ` transform="rotate(${[-3, 2, -2, 3][i]} ${g.cx} ${g.cy})"` : "";
    const base = st.badge ? `<circle cx="${cx}" cy="${cy}" r="23" fill="${INK}"/>` : "";
    return base + `<g transform="translate(${+(cx - g.cx * scale).toFixed(2)} ${+(cy - g.cy * scale).toFixed(2)}) scale(${scale})"><g${wob}><path d="${g.d}" fill="${st.f}" stroke="${st.s}" stroke-width="${st.w}" stroke-linecap="${st.cap}" stroke-linejoin="${st.join}" fill-rule="evenodd"/></g></g>`;
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
