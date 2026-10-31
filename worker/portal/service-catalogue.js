/**
 * The Additional Services catalogue as a reusable component: ONE loader that gathers everything for one organization (the shown services with their sales content, prices, pictures, what the client
 * has already asked for, and what to highlight or leave out) and ONE renderer that turns it into the expandable cards. The Website page uses it today; any other page can call the same two
 * functions to show the same catalogue (pass a different `formAction` and anchor). Requests reuse the existing service-request workflow (a form POST with the CSRF token); prices come from the
 * central Service Pricing and appear only when Admin has set one; nothing here says a service is included in the client's plan or creates a request by itself.
 * Cards are native <details> elements: expandable with no script, keyboard accessible, and printed open.
 */
import { e } from "./ui.js";
import { listClientServices, requestKeyOfService } from "./repo/portal-services.js";
import { listServiceMedia, listClientServiceStates } from "./repo/service-catalogue-state.js";
import { listPrices } from "./repo/prices.js";
import { listServiceRequests, getClientBrand } from "./repo/brand.js";
import { listClientWebsites } from "./repo/client-websites.js";
import { seoStatusesForClient } from "./repo/website-seo.js";
import { pricingFrom, ESTIMATE_NOTE } from "./branding-pricing.js";
import { organiseServices } from "./service-relevance.js";

const FLASH = { requested: "Thanks. Your request was sent. Framework will get in touch before any work starts.", dup: "You have already asked for this service. Framework will be in touch." };

/** The facts the relevance rules look at, for one organization. A fact that cannot be read counts as false: nothing is suggested or hidden on a guess. */
async function contextFor(db, org) {
  const ctx = { hasLiveWebsite: false, brandPublished: false, seoActive: false };
  try {
    const sites = await listClientWebsites(db, org);
    ctx.hasLiveWebsite = sites.some((s) => s.status === "live");
    const seo = await seoStatusesForClient(db, org, sites.map((s) => s.id));
    ctx.seoActive = [...seo.values()].some((st) => st === "in_progress" || st === "optimised" || st === "monitoring");
  } catch { /* unknown: false */ }
  try { ctx.brandPublished = Boolean((await getClientBrand(db, org)).published); } catch { /* unknown: false */ }
  return ctx;
}

/**
 * @param {{db: object}} ctx  the request context (only db is used)
 * @param {{organizationId: string, canRequest: boolean, csrf: string, flash?: string, mediaBase: string, formAction: string}} o
 * @returns {Promise<object|null>} null when no service is shown (the section then does not appear)
 */
export async function loadServiceCatalogue(ctx, o) {
  const db = ctx.db, org = o.organizationId;
  const all = await listClientServices(db);
  if (!all.length) return null;
  const [prices, requests, states, media, context] = await Promise.all([listPrices(db), listServiceRequests(db, org, { openOnly: true }), listClientServiceStates(db, org), listServiceMedia(db), contextFor(db, org)]);
  const priced = pricingFrom(prices.rows);
  const open = new Set(requests.map((r) => r.serviceKey));
  const items = organiseServices(all, context, states.items).map((s) => {
    const p = priced[s.key], shown = p && p.type !== "included" ? p : null;
    return { ...s, price: shown ? shown.label : "", priceType: shown ? shown.type : "", requested: open.has(requestKeyOfService(s.key)), media: media.get(s.key) || [] };
  });
  return { items, canRequest: o.canRequest, csrf: o.csrf, flash: o.flash || "", mediaBase: o.mediaBase, formAction: o.formAction };
}

const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);

function gallery(cat, s) {
  if (!s.media.length) return "";
  return `<div class="svc-gallery${s.media.length === 1 ? " svc-gallery--one" : ""}">${s.media.map((m) => `<figure class="svc-fig"><img class="svc-fig__img" src="${e(`${cat.mediaBase}/${m.id}`)}" alt="${e(m.alt)}" loading="lazy" decoding="async">${m.caption ? `<figcaption class="svc-fig__cap muted small">${e(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`;
}

function card(cat, s, open) {
  const control = s.requested
    ? `<span class="status status--active">Requested</span>`
    : cat.canRequest
      ? `<form method="post" action="${e(cat.formAction)}"><input type="hidden" name="csrf" value="${e(cat.csrf)}"><input type="hidden" name="service" value="${e(s.key)}"><button class="btn btn--primary" type="submit">${e(s.ctaLabel || "Request Service")}<span class="visually-hidden"> (${e(s.name)})</span></button></form>`
      : `<span class="btn" aria-disabled="true">${e(s.ctaLabel || "Request Service")}</span>`;
  const tags = [s.featured ? `<span class="svc-tag">Featured</span>` : "", s.suggested ? `<span class="svc-tag">Suggested for you</span><span class="svc-reason muted small">${e(s.suggested)}</span>` : ""].join("");
  const benefits = s.benefits && s.benefits.length ? `<h4 class="svc-h">What you get</h4><ul class="svc-benefits">${s.benefits.map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : "";
  const demo = isHttps(s.demoUrl) ? `<p class="svc-demo"><a class="text-link" href="${e(s.demoUrl)}" target="_blank" rel="noopener noreferrer">${e(s.demoLabel || "See an example")}<span class="visually-hidden"> (opens in a new tab)</span></a></p>` : "";
  const priceLine = s.price ? `<p class="svc-price">${e(s.price)}</p>` : "";
  return `<li><details class="svc-card${s.featured || s.suggested ? " svc-card--lead" : ""}"${open ? " open" : ""}><summary class="svc-card__sum"><span class="svc-card__tags">${tags}</span><span class="svc-card__title">${e(s.name)}</span>${(s.tagline || s.description) ? `<span class="svc-card__tagline">${e(s.tagline || s.description)}</span>` : ""}<span class="svc-card__more" aria-hidden="true"></span></summary><div class="svc-card__body">${gallery(cat, s)}<div class="svc-card__text">${s.problem ? `<h4 class="svc-h">The problem</h4><p>${e(s.problem)}</p>` : ""}${benefits}${s.why ? `<h4 class="svc-h">Why you might need it</h4><p>${e(s.why)}</p>` : ""}${demo}</div><div class="svc-card__cta">${priceLine}${control}</div></div></details></li>`;
}

/** The section: a short lead, then one expandable card per service. The first highlighted (featured or suggested) card starts open; the rest are one tidy line each. */
export function serviceCatalogue(vm, cat) {
  if (!cat || !cat.items || !cat.items.length) return "";
  const banner = cat.flash && FLASH[cat.flash] ? `<p class="form-banner" role="status">${e(FLASH[cat.flash])}</p>` : "";
  const leadIdx = cat.items.findIndex((s) => s.featured || s.suggested);
  const est = cat.items.some((s) => s.priceType === "starting_at") ? `<p class="muted small">${e(ESTIMATE_NOTE)}</p>` : "";
  return `<section class="ws-sec svc" id="additional-services" aria-labelledby="ws-svc-h"><h2 class="h2" id="ws-svc-h">Additional services</h2><p class="ws-sec__lead">Optional extras from Framework. Open one to see what it is for. Asking about a service doesn’t start any work or cost anything: we’ll get in touch first.</p>${banner}<ul class="svc-list">${cat.items.map((s, i) => card(cat, s, i === leadIdx)).join("")}</ul>${est}${cat.canRequest ? "" : `<p class="muted small">Only account owners can request a service.</p>`}</section>`;
}
