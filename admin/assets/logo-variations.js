/* The four logo variations of a client's Branding page, shared by the Client Portal (worker/portal/branding-live.js) and Framework Admin (admin/assets/branding.js)
   so both show the same numbers, titles and descriptions. Pure data: no DOM, no network.
   `role` is the stored logo type (icon is the Sub-mark); `example` is Framework's own logo for that variation, a static public image shown only while the
   client has no file for it. */
const EXAMPLE_DIR = "/assets/img/logo-examples";
export const LOGO_VARIATIONS = Object.freeze([
  Object.freeze({ key: "primary", role: "primary", no: "01", title: "Primary Logo", desc: "The main brand identity, typically used for websites, marketing materials, and official communications.", example: `${EXAMPLE_DIR}/framework-primary.png`, alt: "Example: the Framework primary logo, a square symbol above the word FRAMEWORK" }),
  Object.freeze({ key: "secondary", role: "secondary", no: "02", title: "Secondary Logo", desc: "An alternative logo arrangement, useful when the primary layout doesn’t fit the available space.", example: `${EXAMPLE_DIR}/framework-secondary.png`, alt: "Example: the Framework secondary logo, the square symbol beside the word FRAMEWORK on one line" }),
  Object.freeze({ key: "simplified", role: "simplified", no: "03", title: "Simplified Logo", desc: "A reduced wordmark-only variation for applications where a cleaner identity is appropriate.", example: `${EXAMPLE_DIR}/framework-simplified.png`, alt: "Example: the Framework simplified logo, the word FRAMEWORK alone" }),
  Object.freeze({ key: "submark", role: "icon", no: "04", title: "Sub-mark", desc: "A compact brand symbol for favicons, social media profiles, watermarks, and small-scale applications.", example: `${EXAMPLE_DIR}/framework-submark.png`, alt: "Example: the Framework sub-mark, the square F symbol alone" }),
]);
