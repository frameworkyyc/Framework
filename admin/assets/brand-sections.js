/* The nine standard sections of a client's Branding page, in order. Shared by the Client Portal (worker/portal/branding-live.js) and Framework Admin
   (admin/assets/branding.js) so both show the same numbers, titles and descriptions. Pure data: no DOM, no network.

   Sections 1 to 3 present data that already exists (logo files, typography, colours). Sections 5 to 9 other than the tagline hold files: an uploaded file is
   shown in a section when its variant key is "section-<key>" (kind "other"; no migration, the same approach as the Secondary logo). A file with no section
   stays under "Documents and other files": it is never moved by guesswork. */

export const BRAND_SECTIONS = Object.freeze([
  Object.freeze({ no: "01", key: "logo", id: "logo", title: "Logo", desc: "Your logo in its four variations, each made for a different use. Download the format you need.", empty: "" }),
  Object.freeze({ no: "02", key: "typography", id: "typography", title: "Typography", desc: "The typefaces that give your brand its voice on the page, with the weights and sizes to use.", empty: "No typefaces have been added yet." }),
  Object.freeze({ no: "03", key: "colours", id: "colours", title: "Brand Colours", desc: "Your colour palette, with the exact values to use on screen and in print.", empty: "No brand colours have been added yet." }),
  Object.freeze({ no: "04", key: "tagline", id: "tagline", title: "Tagline", desc: "The line that sums up your brand, and how to use it.", empty: "Your official tagline hasn’t been added yet." }),
  Object.freeze({ no: "05", key: "imagery", id: "imagery", title: "Brand Imagery", desc: "Approved photography and visual references that show how your brand looks and feels.", empty: "No approved imagery has been added yet." }),
  Object.freeze({ no: "06", key: "layout", id: "layout", title: "Layout System", desc: "The grids, spacing and composition that keep your designs consistent.", empty: "No layout guidelines have been added yet." }),
  Object.freeze({ no: "07", key: "textures", id: "textures", title: "Textures", desc: "Approved textures, patterns and backgrounds that add depth to your brand.", empty: "No textures have been added yet." }),
  Object.freeze({ no: "08", key: "iconography", id: "iconography", title: "Iconography", desc: "Approved icons and icon sets, drawn in one consistent style.", empty: "No icons have been added yet." }),
  Object.freeze({ no: "09", key: "style", id: "style", title: "Design Style", desc: "Your brand direction and visual principles, with examples of the style in use.", empty: "No design style examples have been added yet." }),
]);

/** The sections that hold uploaded files (the tagline is text only). */
export const SECTION_FILE_KEYS = Object.freeze(["imagery", "layout", "textures", "iconography", "style"]);

export const sectionVariantKey = (key) => `section-${key}`;

/** Which section an uploaded file is shown in, from its stored variant key, or null (not placed in a section). Only "other" files can be placed. */
export const sectionOf = (a) => {
  if (!a || a.kind !== "other" || typeof a.variantKey !== "string") return null;
  const m = /^section-([a-z]+)$/.exec(a.variantKey);
  return m && SECTION_FILE_KEYS.includes(m[1]) ? m[1] : null;
};

/* The three typeface slots of 02 Typography, shared by the client page and Admin. A brand may use one family for several slots; only the Primary is expected. */
export const TYPE_SLOT_DEFS = Object.freeze([
  Object.freeze({ key: "primary", no: "01", title: "Primary Typeface", optional: false, desc: "For headings, titles and prominent brand messaging." }),
  Object.freeze({ key: "secondary", no: "02", title: "Secondary Typeface", optional: false, desc: "For body text, paragraphs, descriptions and everyday communications." }),
  Object.freeze({ key: "accent", no: "03", title: "Accent Typeface", optional: true, desc: "Used sparingly for decorative or specialized applications, such as editorial quotes, packaging, promotional materials or distinctive brand elements." }),
]);
