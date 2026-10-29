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

const svc = (key, section, name, defaultCad, description) => Object.freeze({ key, section, name, defaultCad, description });

/** In display order. `section` is the Branding section key (admin/assets/brand-sections.js), or "all" for the complete kit. */
export const PRICING_SERVICES = Object.freeze([
  svc("logo-primary", "logo", "Primary Logo", 500, "Your main brand identity, designed for websites, marketing materials and official communications."),
  svc("logo-secondary", "logo", "Secondary Logo", 150, "An alternative logo arrangement for spaces where the primary layout doesn’t fit."),
  svc("logo-simplified", "logo", "Simplified Logo", 150, "A reduced wordmark-only variation for cleaner applications."),
  svc("logo-submark", "logo", "Sub-mark", 150, "A compact brand symbol for favicons, social profiles and small applications."),
  svc("typography", "typography", "Typography", 250, "A selected and structured typography system, with typeface roles, hierarchy and usage guidance."),
  svc("colours", "colours", "Brand Colours", 200, "A considered colour palette with exact values and usage guidance."),
  svc("tagline", "tagline", "Tagline", 250, "A tagline that sums up your brand, with guidance on how to use it."),
  svc("imagery", "imagery", "Brand Imagery", 300, "Imagery direction and curated visual references. Original photography is not included."),
  svc("layout", "layout", "Layout System", 350, "Grids, spacing and composition guidelines for consistent designs."),
  svc("textures", "textures", "Textures", 150, "Approved textures, patterns and backgrounds."),
  svc("iconography", "iconography", "Iconography", 250, "A consistent icon style with a starter set. Extensive icon libraries are not included."),
  svc("style", "style", "Design Style", 350, "Your brand direction and visual principles, documented with examples."),
  svc("brand-kit", "all", "Complete Brand Kit", 2500, "A cohesive brand identity developed and documented across all nine sections."),
]);

export const PRICING_KEYS = Object.freeze(PRICING_SERVICES.map((s) => s.key));
export const pricingService = (key) => PRICING_SERVICES.find((s) => s.key === key) || null;

/** The service_requests key a pricing service is requested under: the complete kit keeps its existing key; every other service has its own, so Admin sees which one was asked for. */
export const requestKeyOf = (key) => (key === "brand-kit" ? "brand-full-kit" : `brand-svc-${key}`);
export const pricingKeyOfRequest = (requestKey) => PRICING_SERVICES.find((s) => requestKeyOf(s.key) === requestKey)?.key || null;

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

export const ESTIMATE_NOTE = "Starting prices are estimates, not final quotes. Framework confirms the scope and price with you before any work begins.";

/** Messaging by requirement: stronger for a Required section, softer for a Recommended one. */
export const OFFER_COPY = Object.freeze({
  required: Object.freeze({ note: "Needed to use your brand consistently.", lead: (name) => `Framework can create your ${name} for you.` }),
  recommended: Object.freeze({ note: "Optional, but it makes your brand stronger.", lead: (name) => `Want help with your ${name}?` }),
});

const freeUpload = (href, what) => (href ? `<div class="bk-offer__free"><p>Already have ${e(what)}? <a class="text-link" href="${e(href)}">Upload your existing branding for free</a>.</p></div>` : "");

/**
 * The service offer under a section's status line: what Framework can provide, the price (when the service has one), the request button, the estimate note, and, visually
 * separated, the free way to share what the client already has. Shown only for an incomplete section. `action` is the already-built request control (a black "Request Design" button, or
 * the status of a request that is already open). With no stored price the price line and the estimate note are simply left out; the offer and the free upload remain.
 * @param {{ name: string, description: string, entry?: object|null, level: "required"|"recommended", action: string, uploadHref?: string, what?: string }} o
 */
export function offerBox({ name, description, entry = null, level, action = "", uploadHref = "", what = "" }) {
  const copy = OFFER_COPY[level] || OFFER_COPY.recommended;
  const label = entry ? priceLabel(entry) : "";
  return `<div class="bk-offer bk-offer--${e(level)}"><h3 class="bk-offer__lead">${e(copy.lead(name.toLowerCase()))}</h3><p class="bk-offer__desc">${e(description)}</p>${label ? `<p class="bk-offer__price">${e(label)}</p>` : ""}<div class="bk-offer__action">${action}</div>${label ? `<p class="bk-offer__estimate">${e(ESTIMATE_NOTE)}</p>` : ""}${freeUpload(uploadHref, what || `your ${name.toLowerCase()}`)}</div>`;
}

/** The same offer for several services at once (the logo variations the client doesn't have yet): one row per variation with its own price and request button. */
export function offerList({ lead, description = "", level, rows, extra = "", uploadHref = "", what = "" }) {
  const priced = (rows || []).some((r) => r.entry && priceLabel(r.entry));
  const items = (rows || []).map((r) => `<li class="bk-offer__item"><div class="bk-offer__item-head"><span class="bk-offer__name">${e(r.name)}</span>${r.entry && priceLabel(r.entry) ? ` <span class="bk-offer__price bk-offer__price--inline">${e(priceLabel(r.entry))}</span>` : ""}</div><div class="bk-offer__action">${r.action || ""}</div></li>`).join("");
  return `<div class="bk-offer bk-offer--${e(level)}"><h3 class="bk-offer__lead">${e(lead)}</h3>${description ? `<p class="bk-offer__desc">${e(description)}</p>` : ""}<ul class="bk-offer__list">${items}</ul>${extra}${priced ? `<p class="bk-offer__estimate">${e(ESTIMATE_NOTE)}</p>` : ""}${freeUpload(uploadHref, what)}</div>`;
}
