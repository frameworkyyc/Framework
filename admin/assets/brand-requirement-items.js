/* The items an Admin can set a Branding requirement for, and the levels they can set, shared by the Client Portal (worker/portal/branding-live.js, repo/brand-requirement-settings.js)
   and Framework Admin (admin/assets/branding.js). Pure data: no DOM, no network. "Automatic" is not a level: it means no override is stored. */

export const REQUIREMENT_LEVELS = Object.freeze(["required", "recommended", "optional", "not_applicable"]);
export const LEVEL_LABEL = Object.freeze({ required: "Required", recommended: "Recommended", optional: "Optional", not_applicable: "Not applicable" });

/** The nine sections (keys as in brand-sections.js) and the four logo variations (keys as in logo-variations.js), in page order. A variation's key is "logo.<variation>". */
export const REQUIREMENT_ITEMS = Object.freeze([
  Object.freeze({ key: "logo", label: "01 Logo", group: "section" }),
  Object.freeze({ key: "logo.primary", label: "Primary Logo", group: "logo" }),
  Object.freeze({ key: "logo.secondary", label: "Secondary Logo", group: "logo" }),
  Object.freeze({ key: "logo.simplified", label: "Simplified Logo", group: "logo" }),
  Object.freeze({ key: "logo.submark", label: "Sub-mark", group: "logo" }),
  Object.freeze({ key: "typography", label: "02 Typography", group: "section" }),
  Object.freeze({ key: "colours", label: "03 Brand Colours", group: "section" }),
  Object.freeze({ key: "tagline", label: "04 Tagline", group: "section" }),
  Object.freeze({ key: "imagery", label: "05 Brand Imagery", group: "section" }),
  Object.freeze({ key: "layout", label: "06 Layout System", group: "section" }),
  Object.freeze({ key: "textures", label: "07 Textures", group: "section" }),
  Object.freeze({ key: "iconography", label: "08 Iconography", group: "section" }),
  Object.freeze({ key: "style", label: "09 Design Style", group: "section" }),
]);

export const ITEM_KEYS = Object.freeze(REQUIREMENT_ITEMS.map((i) => i.key));
export const MAX_NOTE = 300;
