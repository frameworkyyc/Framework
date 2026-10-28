/**
 * The catalogue of branding services a client can ask Framework to quote. Code, not a table: adding a service is one entry here (and an icon name the
 * page knows how to draw). A request stores only the service key, so renaming or retiring a service never touches saved requests. No prices, no checkout:
 * the action is always "Request a quote" and Framework follows up.
 */
export const BRANDING_SERVICES = Object.freeze([
  Object.freeze({ key: "business-card-design", title: "Business Card Design", blurb: "A professionally designed business card that matches your brand, ready for print.", icon: "card" }),
  Object.freeze({ key: "email-signature-design", title: "Professional Email Signature Design", blurb: "A clean, consistent email signature for you and your team, ready to install.", icon: "mail" }),
]);

/**
 * The requests a client can send from the Branding page: one per section, plus the full brand kit. They are stored in the same service_requests table as the
 * quotes above (so Admin already lists, filters and answers them) and only the key is stored. `section` is the page heading it belongs to; `title` is what Admin shows.
 */
export const BRAND_REQUESTS = Object.freeze([
  Object.freeze({ key: "brand-logos", section: "Logos", title: "Brand request: Logos" }),
  Object.freeze({ key: "brand-colours", section: "Colours", title: "Brand request: Colours" }),
  Object.freeze({ key: "brand-typography", section: "Typography & Fonts", title: "Brand request: Typography & Fonts" }),
  Object.freeze({ key: "brand-guidelines", section: "Brand Guidelines & Documents", title: "Brand request: Guidelines & Documents" }),
  Object.freeze({ key: "brand-additional", section: "Additional Brand Assets", title: "Brand request: Additional Brand Assets" }),
  Object.freeze({ key: "brand-full-kit", section: "Full Brand Kit", title: "Brand request: Full Brand Kit" }),
]);

const ALL = [...BRANDING_SERVICES, ...BRAND_REQUESTS];
export const isKnownBrandingService = (key) => typeof key === "string" && ALL.some((s) => s.key === key);
export const brandingService = (key) => ALL.find((s) => s.key === key) || null;
