/**
 * Which Branding sections are Required or Recommended for a client, and which are complete. Pure functions over data the page already has: nothing is stored, nothing is guessed.
 *
 * Requirement. Every section has a default: Logo, Typography and Brand Colours are Required (a brand cannot be applied without them); the other six are Recommended.
 * A Recommended section becomes Required for ONE client only while that client has an open request (new or in progress) for a service that depends on it, and only
 * where the dependency is written down in SERVICE_REQUIRES below. That table is the explicit dependency model: a service that is not listed adds no requirement, and nothing is inferred
 * from a service's name or description. A request that is closed or declined stops requiring anything. A request never makes a section complete.
 *
 * Completion. A section is complete only when the client has real, published content for it (the kit is published and the content is the client's, never one of
 * Framework's example placeholders): Logo counts its four variation slots; Typography, Brand Colours and the Tagline need at least one typeface/font file, colour, or primary
 * tagline; Brand Imagery, Layout System, Textures, Iconography and Design Style need at least one published file placed in the section.
 */

export const REQUIREMENT_LABEL = Object.freeze({ required: "Required", recommended: "Recommended" });

/** The default for each of the nine sections (keys as in admin/assets/brand-sections.js). */
export const DEFAULT_REQUIREMENT = Object.freeze({
  logo: "required", typography: "required", colours: "required",
  tagline: "recommended", imagery: "recommended", layout: "recommended", textures: "recommended", iconography: "recommended", style: "recommended",
});

/**
 * Explicit dependencies: service_requests key -> the sections that service cannot be delivered without. Only genuine necessities are listed; a service that is not listed adds no requirement
 * and nothing is inferred. A requirement is only a label: it never blocks, delays or hides a request (the request button is always there), and a section is never marked complete because of it.
 * A business card and an email signature cannot be designed without the client's logo and brand colours; typefaces are the designer's call, so Typography is not listed. Both of those
 * sections are Required by default, so no Recommended section changes yet; a new dependency is one line here, added only when a service truly cannot be done without that section.
 */
export const SERVICE_REQUIRES = Object.freeze({
  "business-card-design": Object.freeze(["logo", "colours"]),
  "email-signature-design": Object.freeze(["logo", "colours"]),
});

const OPEN = new Set(["new", "contacted"]);

/**
 * @param {Array<{serviceKey: string, status: string}>} requests the client's newest request per service (any status)
 * @param {object} [table] the dependency table (a parameter so tests can exercise the logic with their own)
 * @returns {{ [section: string]: { level: "required"|"recommended", becauseOf: string[] } }} `becauseOf` lists the service keys that made a Recommended section Required for this client
 */
export function requirementsFor(requests, table = SERVICE_REQUIRES) {
  const out = Object.fromEntries(Object.entries(DEFAULT_REQUIREMENT).map(([k, level]) => [k, { level, becauseOf: [] }]));
  for (const r of requests || []) {
    if (!r || !OPEN.has(r.status) || !Object.hasOwn(table, r.serviceKey)) continue;
    for (const section of table[r.serviceKey]) {
      if (out[section] && out[section].level === "recommended") out[section].level = "required";
      if (out[section] && DEFAULT_REQUIREMENT[section] === "recommended" && !out[section].becauseOf.includes(r.serviceKey)) out[section].becauseOf.push(r.serviceKey);
    }
  }
  return out;
}

/**
 * Completion of each section from the client's real content.
 * @param {{ logoFilled: number, typefaces: number, fontFiles: number, colours: number, tagline: string|null|undefined, files: {[section: string]: number} }} c
 * @returns {{ [section: string]: { done: boolean, count?: number, total?: number } }}
 */
export function completionOf(c) {
  const files = c.files || {};
  const has = (n) => Number.isInteger(n) && n > 0;
  const out = {
    logo: { done: c.logoFilled === 4, count: Math.max(0, Math.min(4, c.logoFilled || 0)), total: 4 },
    typography: { done: has(c.typefaces) || has(c.fontFiles) },
    colours: { done: has(c.colours) },
    tagline: { done: typeof c.tagline === "string" && c.tagline.trim().length > 0 },
  };
  for (const k of ["imagery", "layout", "textures", "iconography", "style"]) out[k] = { done: has(files[k]) };
  return out;
}
