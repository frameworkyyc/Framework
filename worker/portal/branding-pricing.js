/**
 * Pricing presentation for Framework's branding services (DESIGN ONLY for now: every entry is inactive, so the client page shows no price anywhere).
 *
 * The prices below are PROVISIONAL starting prices in Canadian dollars, kept in one place so they can be changed without touching the page code. An entry is shown to
 * clients only when its `active` is exactly true, and nothing here turns that on: publishing a price needs Framework's explicit approval. A later step can move this
 * table into Admin-managed storage (service, description, price, type, deliverables, availability) without changing how the page uses it (see BRANDING-FILES.md).
 *
 * Three presentations:
 *   starting_at   "Starting at $250 CAD"  a predictable baseline scope
 *   custom_quote  "Custom quote"          needs discovery or variable production
 *   included      "Included"              covered by an active client agreement; set per client by Admin, never assumed (so it is not used by default)
 * A price is a starting point, never an accepted quote. Requests go through the existing human-managed Branding request: submitting one is not accepting a quote or authorizing payment.
 */
import { e } from "./ui.js";

export const PRICING_TYPES = Object.freeze(["starting_at", "custom_quote", "included"]);

const svc = (key, section, name, priceCad, description, requestKey) => Object.freeze({ key, section, name, type: "starting_at", priceCad, description, requestKey, active: false });

export const BRANDING_PRICING = Object.freeze({
  "logo-primary": svc("logo-primary", "logo", "Primary Logo Design", 500, "Your main brand identity, designed for websites, marketing materials and official communications.", "brand-logos"),
  "logo-secondary": svc("logo-secondary", "logo", "Secondary Logo", 150, "An alternative logo arrangement for spaces where the primary layout doesn’t fit.", "brand-logos"),
  "logo-simplified": svc("logo-simplified", "logo", "Simplified Logo", 150, "A reduced wordmark-only variation for cleaner applications.", "brand-logos"),
  "logo-submark": svc("logo-submark", "logo", "Sub-mark", 150, "A compact brand symbol for favicons, social profiles and small applications.", "brand-logos"),
  typography: svc("typography", "typography", "Typography System", 250, "A professionally selected and structured typography system, including approved typeface roles, hierarchy and usage guidance.", "brand-typography"),
  colours: svc("colours", "colours", "Brand Colour Palette", 200, "A considered colour palette with exact values and usage guidance.", "brand-colours"),
  tagline: svc("tagline", "tagline", "Tagline Development", 250, "A tagline that sums up your brand, with guidance on how to use it.", "brand-colours"),
  imagery: svc("imagery", "imagery", "Brand Imagery Direction", 300, "Imagery direction and curated visual references. Original photography is not included.", "brand-additional"),
  layout: svc("layout", "layout", "Layout System", 350, "Grids, spacing and composition guidelines for consistent designs.", "brand-additional"),
  textures: svc("textures", "textures", "Textures & Patterns", 150, "Approved textures, patterns and backgrounds.", "brand-additional"),
  iconography: svc("iconography", "iconography", "Iconography", 250, "A consistent icon style with a starter set. Extensive icon libraries are not included.", "brand-additional"),
  style: svc("style", "style", "Design Style Guide", 350, "Your brand direction and visual principles, documented with examples.", "brand-additional"),
  "brand-kit": Object.freeze({
    key: "brand-kit", section: "all", name: "Framework Brand Kit", type: "starting_at", priceCad: 2500, requestKey: "brand-full-kit", active: false,
    description: "A cohesive brand identity developed and documented for consistent use across digital and print applications.",
    // The package scope is NOT final: deliverables follow the nine sections; the revision allowance is to be defined by Framework before this is offered.
    deliverables: ["Logo", "Typography", "Brand Colours", "Tagline", "Brand Imagery", "Layout System", "Textures", "Iconography", "Design Style"],
    revisions: null,
    exclusions: ["Original photography production", "Bespoke illustration", "Custom typefaces", "Extensive icon libraries"],
  }),
});

const CAD = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: 0 });

/** The wording for a price: "Starting at $250 CAD", "Custom quote" or "Included". Anything that is not a valid entry has no label (and so shows nothing). */
export function priceLabel(entry) {
  if (!entry || !PRICING_TYPES.includes(entry.type)) return "";
  if (entry.type === "included") return "Included";
  if (entry.type === "custom_quote") return "Custom quote";
  return Number.isInteger(entry.priceCad) && entry.priceCad > 0 ? `Starting at ${CAD.format(entry.priceCad).replace(/ /g, " ")} CAD` : "";
}

/** The entry for a service, only when it has been explicitly activated. */
export const activePricing = (key, catalogue = BRANDING_PRICING) => { const x = catalogue[key]; return x && x.active === true && priceLabel(x) ? x : null; };

/**
 * The quiet pricing note shown inside a section, next to the request action, for a service the client doesn't have yet. `action` is the already-built request control
 * (the existing Branding request). Returns "" for an inactive or unknown entry, so nothing is shown by default.
 */
export function pricingBlock(entry, action = "") {
  if (!entry || entry.active !== true || !priceLabel(entry)) return "";
  const scope = Array.isArray(entry.deliverables) && entry.deliverables.length
    ? `<p class="muted small">Covers ${e(entry.deliverables.join(", "))}.${Array.isArray(entry.exclusions) && entry.exclusions.length ? ` Not included: ${e(entry.exclusions.join(", ").toLowerCase())}.` : ""}</p>` : "";
  return `<div class="bk-price"><h3 class="bk-price__name">${e(entry.name)}</h3><p class="bk-price__label">${e(priceLabel(entry))}</p><p class="muted">${e(entry.description)}</p>${scope}<p class="muted small">A starting price, not a quote. Framework reviews every request and confirms the scope with you before any work begins.</p>${action}</div>`;
}
