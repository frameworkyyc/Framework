/**
 * The catalogue of branding services a client can ask Framework to quote. Code, not a table: adding a service is one entry here (and an icon name the
 * page knows how to draw). A request stores only the service key, so renaming or retiring a service never touches saved requests. No prices, no checkout:
 * the action is always "Request a quote" and Framework follows up.
 */
export const BRANDING_SERVICES = Object.freeze([
  Object.freeze({ key: "business-card-design", title: "Business Card Design", blurb: "A professionally designed business card that matches your brand, ready for print.", icon: "card" }),
  Object.freeze({ key: "email-signature-design", title: "Professional Email Signature Design", blurb: "A clean, consistent email signature for you and your team, ready to install.", icon: "mail" }),
]);

export const isKnownBrandingService = (key) => typeof key === "string" && BRANDING_SERVICES.some((s) => s.key === key);
export const brandingService = (key) => BRANDING_SERVICES.find((s) => s.key === key) || null;
