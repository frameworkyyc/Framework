/**
 * Pricing for Framework's branding services: the catalogue (which services exist, in the order of the nine Branding sections), the three ways a price is presented,
 * and the quiet note the client's Branding page shows beside the request button for a service the client doesn't have yet.
 *
 * The prices themselves are Admin-managed data (Admin -> Settings -> Service Pricing, table service_prices, migration 0010), global to every client and in Canadian
 * dollars. The page shows a price only for a service that has a stored row, so a database without that table shows no prices anywhere. `DEFAULT_CAD` below is only what
 * the Admin editor offers as "default" beside each field; nothing is shown to a client from it.
 *
 * Three presentations:
 *   starting_at   "Starting at $250 CAD"  a predictable baseline scope
 *   custom_quote  "Custom quote"          needs discovery or variable production
 *   included      "Included"              covered by an active client agreement
 * A price is a starting point, never an accepted quote. Requests go through the existing human-managed Branding request: submitting one is not accepting a quote or
 * authorizing payment, and there is no checkout, payment or invoicing here.
 */
import { e } from "./ui.js";

export const PRICING_TYPES = Object.freeze(["starting_at", "custom_quote", "included"]);
export const PRICING_TYPE_LABEL = Object.freeze({ starting_at: "Starting at", custom_quote: "Custom quote", included: "Included" });
export const MAX_PRICE_CAD = 1000000;

/** `offerTitle` is the service's name in the client's offer; `upload` is the two halves of the free-upload line ("Already have your fonts?" + "Upload them for free"). */
const svc = (key, section, name, defaultCad, description, offerTitle, upload) => Object.freeze({ key, section, name, defaultCad, defaultType: defaultCad === null ? "custom_quote" : "starting_at", description, offerTitle, upload: Object.freeze(upload) });
const LOGOS = ["Already have your logos?", "Upload them for free"];

/** In display order. `section` is the Branding section key (admin/assets/brand-sections.js), or "all" for the complete kit. */
export const PRICING_SERVICES = Object.freeze([
  svc("logo-primary", "logo", "Primary Logo", 500, "Your main brand identity, designed for websites, marketing materials and official communications.", "Primary Logo Design", LOGOS),
  svc("logo-secondary", "logo", "Secondary Logo", 150, "An alternative logo arrangement for spaces where the primary layout doesn’t fit.", "Secondary Logo Design", LOGOS),
  svc("logo-simplified", "logo", "Simplified Logo", 150, "A reduced wordmark-only variation for cleaner applications.", "Simplified Logo Design", LOGOS),
  svc("logo-submark", "logo", "Sub-mark", 150, "A compact brand symbol for favicons, social profiles and small applications.", "Sub-mark Design", LOGOS),
  svc("typography", "typography", "Typography", 250, "A selected and structured typography system, with typeface roles, hierarchy and usage guidance.", "Professional Typography Design", ["Already have your fonts?", "Upload them for free"]),
  svc("colours", "colours", "Brand Colours", 200, "A considered colour palette with exact values and usage guidance.", "Professional Colour Palette Design", ["Already have your brand colours?", "Upload them for free"]),
  svc("tagline", "tagline", "Tagline", 250, "A tagline that sums up your brand, with guidance on how to use it.", "Professional Tagline Development", ["Already have a tagline?", "Upload it for free"]),
  svc("imagery", "imagery", "Brand Imagery", 300, "Imagery direction and curated visual references. Original photography is not included.", "Professional Imagery Direction", ["Already have brand imagery?", "Upload it for free"]),
  svc("layout", "layout", "Layout System", 350, "Grids, spacing and composition guidelines for consistent designs.", "Professional Layout System Design", ["Already have a layout system?", "Upload it for free"]),
  svc("textures", "textures", "Textures", 150, "Approved textures, patterns and backgrounds.", "Professional Texture & Pattern Design", ["Already have textures?", "Upload them for free"]),
  svc("iconography", "iconography", "Iconography", 250, "A consistent icon style with a starter set. Extensive icon libraries are not included.", "Professional Icon Design", ["Already have icons?", "Upload them for free"]),
  svc("style", "style", "Design Style", 350, "Your brand direction and visual principles, documented with examples.", "Professional Design Style Guide", ["Already have a design style guide?", "Upload it for free"]),
  svc("brand-kit", "all", "Complete Brand Kit", 2500, "A cohesive brand identity developed and documented across all nine sections.", "Complete Brand Kit", ["Already have a brand kit?", "Upload it for free"]),
  // Website services (section "website"): priced by quote until Framework sets a starting price. They are not Branding requests; their client offer arrives with the Website section.
  svc("website-design", "website", "Website Design", null, "A new website designed and built by Framework.", "Website Design", ["Already have a website?", "Add its details"]),
  svc("website-redesign", "website", "Website Redesign", null, "A fresh design and rebuild of your existing website.", "Website Redesign", ["Already have a website?", "Add its details"]),
  svc("website-seo", "website", "SEO", null, "Search engine optimization to help customers find your website.", "SEO", ["Already have a website?", "Add its details"]),
  svc("website-maintenance", "website", "Website Maintenance", null, "Ongoing updates, security and support for your website.", "Website Maintenance", ["Already have a website?", "Add its details"]),
  // Additional Services (section "addon", the Website page's optional services): no default price, shown to a client only once Admin has set one. Their name and short description live in
  // the editable catalogue (portal_services, repo/portal-services.js); these entries only give Service Pricing a row for each. "Included" is not offered for them (see ADDON_TYPES).
  svc("client-admin-portal", "addon", "Client Admin Portal", null, "A secure, branded workspace for managing customers, projects and records.", "Client Admin Portal", ["", ""]),
  svc("invoice-sender", "addon", "Invoice Sender", null, "Create and send professional invoices.", "Invoice Sender", ["", ""]),
  svc("digital-business-cards", "addon", "Digital Business Cards", null, "A shareable digital card that is always up to date.", "Digital Business Cards", ["", ""]),
  svc("seo-visibility", "addon", "SEO & Visibility", null, "Help the right customers find your business in search.", "SEO & Visibility", ["", ""]),
  svc("nexus-fleet-tracker", "addon", "Nexus Fleet Tracker", null, "Manage vehicles, monitor maintenance and organize fleet operations from one dashboard.", "Nexus Fleet Tracker", ["", ""]),
]);

/** An optional service is never described as "Included": that wording would suggest it is already part of what the client has. */
export const ADDON_TYPES = Object.freeze(["starting_at", "custom_quote"]);
export const typesFor = (service) => (service && service.section === "addon" ? ADDON_TYPES : PRICING_TYPES);

export const PRICING_KEYS = Object.freeze(PRICING_SERVICES.map((s) => s.key));
export const pricingService = (key) => PRICING_SERVICES.find((s) => s.key === key) || null;

/** The service_requests key a pricing service is requested under: the complete kit keeps its existing key; every other service has its own, so Admin sees which one was asked for. */
export const requestKeyOf = (key) => (key === "brand-kit" ? "brand-full-kit" : `brand-svc-${key}`); // Branding services only; the website services get their own request keys with the Website section
export const pricingKeyOfRequest = (requestKey) => PRICING_SERVICES.find((s) => s.section !== "addon" && requestKeyOf(s.key) === requestKey)?.key || null;

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/** The wording for a price: "Starting at $250 CAD", "Custom quote" or "Included". Anything that is not a valid entry has no label (and so shows nothing). */
export function priceLabel(entry) {
  if (!entry || !PRICING_TYPES.includes(entry.type)) return "";
  if (entry.type === "included") return "Included";
  if (entry.type === "custom_quote") return "Custom quote";
  return Number.isInteger(entry.priceCad) && entry.priceCad > 0 && entry.priceCad <= MAX_PRICE_CAD ? `Starting at ${CAD.format(entry.priceCad).replace(/ /g, " ")} CAD` : "";
}

/**
 * Stored rows -> the entries the page may show, keyed by service: only services that have a valid stored row (so an unmigrated database yields {}).
 * @param {Array<{service_key: string, price_type: string, price_cad: number|null}>} rows
 */
export function pricingFrom(rows) {
  const out = {};
  for (const r of rows || []) {
    const s = pricingService(r.service_key);
    const entry = s && { ...s, type: r.price_type, priceCad: r.price_cad };
    if (entry && priceLabel(entry)) out[s.key] = Object.freeze({ ...entry, label: priceLabel(entry) });
  }
  return out;
}

/** What is stored with a service request so Admin can see what the client was shown. */
export const priceSnapshot = (entry) => (entry ? { service: entry.key, name: entry.name, type: entry.type, priceCad: entry.type === "starting_at" ? entry.priceCad : null, label: priceLabel(entry) } : null);

export const ESTIMATE_NOTE = "Starting prices are estimates, not final quotes.";

const freeUpload = (href, [lead, link]) => (href ? `<div class="bk-offer__free"><p>${e(lead)} <a class="text-link" href="${e(href)}">${e(link)}</a>.</p></div>` : "");
const row = (title, entry, action) => `<div class="bk-offer__row"><div class="bk-offer__text"><h3 class="bk-offer__title">${e(title)}</h3>${entry && priceLabel(entry) ? `<p class="bk-offer__price">${e(priceLabel(entry))}</p>` : ""}</div><div class="bk-offer__action">${action || ""}</div></div>`;

/**
 * The compact service offer under a section's status line: the service title, its price (when it has one) and the black Request Design button on one row, and,
 * visually separated, the free way to share what the client already has. Shown only for an incomplete section. `action` is the already-built request control (the button, or the
 * status of a request that is already open). With no stored price the price is left out; the title, button and free upload remain. The one general note about starting prices is shown once, on the page (branding-live.js).
 * @param {{ service: object, entry?: object|null, action: string, uploadHref?: string }} o
 */
export function offerBox({ service, entry = null, action = "", uploadHref = "" }) {
  return `<div class="bk-offer">${row(service.offerTitle, entry, action)}${freeUpload(uploadHref, service.upload)}</div>`;
}

/** The same offer for several services at once (the logo variations the client doesn't have yet): one row per variation, one free-upload line. */
export function offerList({ rows, extra = "", uploadHref = "", upload }) {
  const items = (rows || []).map((r) => `<li class="bk-offer__item">${row(r.title, r.entry, r.action)}</li>`).join("");
  return `<div class="bk-offer"><ul class="bk-offer__list">${items}</ul>${extra}${freeUpload(uploadHref, upload)}</div>`;
}
