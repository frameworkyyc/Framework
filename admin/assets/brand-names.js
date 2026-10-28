/* Framework Admin / Worker: the ONE place that turns a client's company name and a file's details into its file name.
   Pure functions, no DOM and no network, so the Admin form's live preview and the server use exactly the same rules (the server is the authority: it
   recomputes the name itself and never trusts a name sent by the browser).

     logo         Framework-Primary-Square-Light-Transparent.png       Company-Type-Shape[-Transparent].ext (older files may also carry a background word such as Light)
     other files  Framework-Brand-Guidelines.pdf                       Company-Description.ext

   The same logo in different formats shares one stem (…-Light-Transparent) and differs only by extension, so formats stay grouped and consistent.
   Names are ASCII letters, digits and hyphens only, so they are safe on every system and in a download header. */

export const LOGO_ROLE_WORD = { primary: "Primary", secondary: "Secondary", simplified: "Simplified", icon: "Submark" }; // icon is the Sub-mark variation; its files are named Submark from now on (existing files keep their names)
export const SHAPE_WORD = { horizontal: "Horizontal", vertical: "Vertical", square: "Square" };
export const TONE_WORD = { light: "Light", dark: "Dark", colour: "Colour", mono: "Mono" };
const COMPANY_MAX = 30, DESCRIPTION_MAX = 48;

const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "");
/** "Alpha Café & Co." -> ["Alpha", "Cafe", "Co"]. Lower-case words get a capital; words that already mix cases (iPhone, ACME) are left alone. */
function words(text) {
  return fold(text).split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => (w === w.toLowerCase() ? w[0].toUpperCase() + w.slice(1) : w));
}
/** Joins words with hyphens up to `max` characters, cutting at a word boundary (a single over-long word is cut). */
function limit(list, max) {
  let out = "";
  for (const w of list) { const next = out ? out + "-" + w : w; if (next.length > max) { if (!out) out = w.slice(0, max); break; } out = next; }
  return out;
}

/** Does this text leave anything usable for a file name (letters or digits after folding accents)? */
export const usableName = (text) => words(text).length > 0;

/** The company part: from the organization's name, falling back to its portal address, then "Client". */
/** `brandName` (when set) is used instead of the organization's full name; with none, the organization name is used. */
export function companyPart(name, slug = "") {
  return limit(words(name), COMPANY_MAX) || limit(words(slug), COMPANY_MAX) || "Client";
}
/** A free-text description (for files that are not logos), or "" when nothing usable is left. */
export function descriptionPart(text) {
  return limit(words(text), DESCRIPTION_MAX);
}

/** The extension the file will have: lower-case, "jpeg" written as "jpg". */
export const extensionOf = (fileName) => {
  const ext = String(fileName ?? "").split(".").pop().toLowerCase();
  return ext === "jpeg" ? "jpg" : /^[a-z0-9]{1,8}$/.test(ext) && String(fileName).includes(".") ? ext : "";
};

/**
 * @param {{ company: string, slug?: string, kind: string, logo?: { role?: string, orientation?: string, tone?: string, transparent?: boolean }, description?: string, ext?: string }} input
 * @returns {{ ok: true, stem: string, name: string, title: string, variantKey: string|null } | { ok: false, missing: string[], error: string }}
 *   `title` and `variantKey` are what is stored alongside: a readable title for lists, and a key that groups the formats of one logo variant.
 */
export function buildBrandFileName({ company, slug = "", kind, logo = {}, description = "", ext = "" }) {
  const co = companyPart(company, slug);
  const suffix = ext ? "." + ext : "";
  if (kind === "logo") {
    const missing = [];
    if (!LOGO_ROLE_WORD[logo.role]) missing.push("logo type");
    if (!SHAPE_WORD[logo.orientation]) missing.push("shape");
    if (missing.length) return { ok: false, missing, error: "incomplete_logo_details" };
    const parts = [LOGO_ROLE_WORD[logo.role], SHAPE_WORD[logo.orientation], ...(TONE_WORD[logo.tone] ? [TONE_WORD[logo.tone]] : []), ...(logo.transparent ? ["Transparent"] : [])];
    const stem = [co, ...parts].join("-");
    const title = `${parts[0]} logo, ${parts.slice(1).map((p) => p.toLowerCase()).join(", ")}`;
    return { ok: true, stem, name: stem + suffix, title, variantKey: parts.map((p) => p.toLowerCase()).join("-") };
  }
  const d = descriptionPart(description);
  if (!d) return { ok: false, missing: ["name"], error: "invalid_description" };
  const stem = `${co}-${d}`;
  return { ok: true, stem, name: stem + suffix, title: String(description).trim().slice(0, 120) || d.replace(/-/g, " "), variantKey: null };
}
