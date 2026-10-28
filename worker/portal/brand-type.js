/**
 * Typography on the client's Branding page: which typeface sits in which slot, which uploaded font files belong to it, and the small stylesheet that lets the page
 * show a specimen in the REAL font. Pure functions (no request, database or environment access).
 *
 * A typeface belongs to a slot (primary, secondary, accent) only when Admin chose one; an older typeface with no slot is listed as "Other", never guessed into a slot.
 * A typeface's font files are the ones Admin selected (`file_ids`); an older typeface with none selected keeps the earlier behaviour (files whose title contains the family name).
 * A font file is used for a specimen only when the client is allowed to download it (its licence permits sharing): the page never serves a font it could not also offer.
 */

export const typefaceOf = (t) => ({ family: t.family, role: t.role, slot: t.slot || null, weights: Array.isArray(t.weights) ? t.weights : [], styles: Array.isArray(t.styles) ? t.styles : [], usage: t.usage || null, source_url: t.source_url || null, file_ids: Array.isArray(t.file_ids) ? t.file_ids : [] });

/** The font files (published assets of kind font) a typeface owns. `all` marks which of them may be downloaded (and so shown as a specimen). */
export function filesOf(t, fonts) {
  const ids = new Set((t.file_ids || []).map((x) => String(x).toLowerCase()));
  const own = ids.size ? fonts.filter((f) => ids.has(String(f.id).toLowerCase())) : fonts.filter((f) => String(f.title).toLowerCase().includes(String(t.family).toLowerCase()));
  return { all: own, usable: own.filter((f) => f.canDownload) };
}

const WEIGHT_WORDS = [[/\b(extra|ultra)[\s-]?bold\b/i, 800], [/\b(extra|ultra)[\s-]?light\b/i, 200], [/\b(semi|demi)[\s-]?bold\b/i, 600], [/\bthin|hairline\b/i, 100], [/\blight\b/i, 300], [/\bmedium\b/i, 500], [/\bbold\b/i, 700], [/\bblack|heavy\b/i, 900]];
/** The weight and style a font file is, read from its title ("Switzer Semibold Italic"); a title that says neither is Regular. */
export function faceOf(file) {
  const title = String(file.title || "");
  const hit = WEIGHT_WORDS.find(([re]) => re.test(title));
  return { weight: hit ? hit[1] : 400, style: /\b(italic|oblique)\b/i.test(title) ? "italic" : "normal" };
}
const FORMAT = { woff2: "woff2", woff: "woff", ttf: "truetype", otf: "opentype" };
export const WEIGHT_NAME = { 100: "Thin", 200: "Extra Light", 300: "Light", 400: "Regular", 500: "Medium", 600: "Semibold", 700: "Bold", 800: "Extra Bold", 900: "Black" };

/** The slots that have a typeface with at least one font file that may be shown: { primary: { files, family, faces }, ... }. */
export function specimenSlots(typography, fonts) {
  const out = {};
  for (const raw of typography || []) {
    const t = typefaceOf(raw);
    if (!t.slot || out[t.slot]) continue;
    const { usable } = filesOf(t, fonts);
    if (usable.length) out[t.slot] = { t, files: usable, faces: usable.map((f) => ({ file: f, ...faceOf(f) })) };
  }
  return out;
}

/**
 * The stylesheet for /portal/o/:slug/branding/fonts.css: one @font-face per font file (served by the ordinary file route with ?font=1, which re-checks organization,
 * publication and the licence flag), and a class per slot. Nothing from the client is written into it except the file ids (UUIDs, checked) and enum values.
 */
export function fontCss(base, typography, fonts) {
  const slots = specimenSlots(typography, fonts);
  const UUID = /^[0-9a-f-]{36}$/i;
  const parts = [];
  for (const [slot, { faces }] of Object.entries(slots)) {
    for (const f of faces) {
      if (!UUID.test(f.file.id) || !FORMAT[f.file.format]) continue;
      parts.push(`@font-face{font-family:"fwb-${slot}";src:url("${base}/branding/files/${f.file.id}?font=1") format("${FORMAT[f.file.format]}");font-weight:${f.weight};font-style:${f.style};font-display:swap}`);
    }
    parts.push(`.sp-${slot}{font-family:"fwb-${slot}",sans-serif}`);
  }
  return parts.join("\n") + (parts.length ? "\n" : "");
}
