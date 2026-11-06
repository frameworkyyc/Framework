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
import { listClientServiceSettings } from "./repo/client-service-settings.js";
import { listClientServiceLinks } from "./repo/client-service-links.js";

const FLASH = { requested: "Thanks. Your request was sent. Framework will get in touch before any work starts.", dup: "You have already asked for this service. Framework will be in touch." };

/** The facts the relevance rules look at, for one organization. A fact that cannot be read counts as false: nothing is suggested or hidden on a guess. */
export async function contextFor(db, org) {
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
  const [prices, requests, states, settings, media, context, linkRows] = await Promise.all([listPrices(db), listServiceRequests(db, org, { openOnly: true }), listClientServiceStates(db, org), listClientServiceSettings(db, org), listServiceMedia(db), contextFor(db, org), listClientServiceLinks(db, org)]);
  const priced = pricingFrom(prices.rows);
  const open = new Set(requests.map((r) => r.serviceKey));
  const items = organiseServices(all, context, states.items, settings.items).map((s) => {
    const p = priced[s.key], shown = p && p.type !== "included" ? p : null;
    return { ...s, price: shown ? shown.label : "", priceType: shown ? shown.type : "", requested: open.has(requestKeyOfService(s.key)), media: media.get(s.key) || [], link: linkRows.links[s.key] ? linkRows.links[s.key].url : "" };
  });
  return { items, canRequest: o.canRequest, csrf: o.csrf, flash: o.flash || "", mediaBase: o.mediaBase, formAction: o.formAction };
}

const isHttps = (u) => typeof u === "string" && /^https:\/\/[^\s"'<>]+$/.test(u);

/**
 * Pictures for services Admin has not uploaded any for: concept illustrations drawn by Framework (assets/img/portal), always labelled as concepts, and for digital business
 * cards Framework's own live card as a real example. Never client work. A service with uploaded pictures shows those instead.
 */
const PREVIEWS = Object.freeze({
  "client-admin-portal": { art: "portal", alt: "Concept illustration of a client admin portal" },
  "invoice-sender": { art: "invoice", alt: "Concept illustration of an invoice" },
  "digital-business-cards": { phone: { src: "/assets/img/portal/framework-card.png", w: 780, h: 1878, alt: "Framework's own digital business card on a phone: logo, name, Save Contact, Call, Text, Email and links", href: "https://frameworkco.ca/card" } },
  "seo-visibility": { art: "seo", alt: "Concept illustration of a search results page" },
});
const previewOf = (s) => (!s.media.length && Object.hasOwn(PREVIEWS, s.key) ? PREVIEWS[s.key] : null);

/** Services whose client already has the real thing (Admin entered its address): what the button says and what the card is called. */
const OWNED = Object.freeze({ "digital-business-cards": { open: "View Your Digital Business Card", ask: "Ask for a change", title: "Your digital business card", live: "Active · Your card is live" } });
const ownedOf = (s) => (Object.hasOwn(OWNED, s.key) && isHttps(s.link) ? OWNED[s.key] : null);

const thumbOf = (cat, s) => {
  if (ownedOf(s)) return null; // the client's own card has no picture here: Framework's example must never stand in for it
  if (s.media.length) return { src: `${cat.mediaBase}/${s.media[0].id}`, w: 640, h: 400, top: false };
  const pv = previewOf(s);
  if (pv && pv.phone) return null; // the phone screenshot is shown once, in the open card: no second copy beside the name
  return pv ? { src: `/assets/img/portal/${pv.art}.svg`, w: 640, h: 400, top: false } : null;
};

/** The client's OWN card: a prominent button to their address, and plain words that it is theirs and not Framework's example. */
function ownPanel(s, o) {
  let host = "";
  try { host = new URL(s.link).hostname; } catch { host = ""; }
  return `<div class="svc-gallery svc-gallery--one"><div class="svc-own"><p class="svc-own__k">Your own card</p><h4 class="svc-own__t">${e(o.title)}</h4>${host ? `<p class="svc-own__h">${e(host)}</p>` : ""}<p class="svc-own__n">This is the card Framework made for you. It is your card, not Framework's example.</p><a class="btn svc-own__btn" href="${e(s.link)}" target="_blank" rel="noopener noreferrer">${e(o.open)}<span class="visually-hidden"> (opens in a new tab)</span></a></div></div>`;
}

/** Framework's own live card as ONE example: the whole screenshot in a phone-shaped frame at its true proportions (never cropped or stretched), with a link to the live card. */
function phoneFigure(pv) {
  return `<div class="svc-gallery svc-gallery--one"><figure class="svc-phone"><div class="svc-phone__frame"><img class="svc-phone__img" src="${e(pv.src)}" width="${pv.w}" height="${pv.h}" alt="${e(pv.alt)}" loading="lazy" decoding="async"></div><figcaption class="svc-phone__cap"><span class="svc-concept svc-concept--real">Real example</span> Framework's own digital business card.</figcaption><a class="btn svc-phone__btn" href="${e(pv.href)}" target="_blank" rel="noopener noreferrer">View live example<span class="visually-hidden"> (opens in a new tab)</span></a></figure></div>`;
}

function gallery(cat, s) {
  const own = ownedOf(s);
  if (own) return ownPanel(s, own);
  const pv = previewOf(s);
  if (pv && pv.phone) return phoneFigure(pv.phone);
  if (pv) {
    return `<div class="svc-gallery svc-gallery--one"><figure class="svc-fig"><img class="svc-fig__img" src="/assets/img/portal/${e(pv.art)}.svg" width="640" height="400" alt="${e(pv.alt)}" loading="lazy" decoding="async"><figcaption class="svc-fig__cap muted small"><span class="svc-concept">Concept</span> An illustration of the idea, not a client project.</figcaption></figure></div>`;
  }
  if (!s.media.length) return "";
  return `<div class="svc-gallery${s.media.length === 1 ? " svc-gallery--one" : ""}">${s.media.map((m) => `<figure class="svc-fig"><img class="svc-fig__img" src="${e(`${cat.mediaBase}/${m.id}`)}" alt="${e(m.alt)}" loading="lazy" decoding="async">${m.caption ? `<figcaption class="svc-fig__cap muted small">${e(m.caption)}</figcaption>` : ""}</figure>`).join("")}</div>`;
}

function card(cat, s, open) {
  const owned = ownedOf(s), cta = owned ? owned.ask : (s.ctaLabel || "Request Service");
  const control = s.requested
    ? `<span class="status status--active">Requested</span>`
    : cat.canRequest
      ? `<form method="post" action="${e(cat.formAction)}"><input type="hidden" name="csrf" value="${e(cat.csrf)}"><input type="hidden" name="service" value="${e(s.key)}"><button class="btn ${owned ? "" : "btn--primary"}" type="submit">${e(cta)}<span class="visually-hidden"> (${e(s.name)})</span></button></form>`
      : `<span class="btn" aria-disabled="true">${e(cta)}</span>`;
  const tags = [owned ? `<span class="svc-tag svc-tag--live">${e(owned.live)}</span>` : "", s.recommended ? `<span class="svc-tag svc-tag--recommended">Recommended</span>` : "", s.featured ? `<span class="svc-tag">Featured</span>` : "", s.suggested && !s.recommended ? `<span class="svc-tag">Suggested for you</span><span class="svc-reason muted small">${e(s.suggested)}</span>` : "", s.category ? `<span class="svc-cat muted small">${e(s.category)}</span>` : ""].join("");
  const benefits = s.benefits && s.benefits.length ? `<h4 class="svc-h">What you get</h4><ul class="svc-benefits">${s.benefits.map((b) => `<li>${e(b)}</li>`).join("")}</ul>` : "";
  const demo = isHttps(s.demoUrl) ? `<p class="svc-demo"><a class="text-link" href="${e(s.demoUrl)}" target="_blank" rel="noopener noreferrer">${e(s.demoLabel || "See an example")}<span class="visually-hidden"> (opens in a new tab)</span></a></p>` : "";
  const priceLine = s.price ? `<p class="svc-price">${e(s.price)}</p>` : "";
  return `<li><details class="svc-card${owned || s.recommended || s.featured || s.suggested ? " svc-card--lead" : ""}"${open || owned ? " open" : ""}><summary class="svc-card__sum${thumbOf(cat, s) ? " svc-card__sum--thumb" : ""}">${thumbOf(cat, s) ? `<img class="svc-card__thumb" src="${e(thumbOf(cat, s).src)}" width="${thumbOf(cat, s).w}" height="${thumbOf(cat, s).h}" alt="" loading="lazy" decoding="async">` : ""}<span class="svc-card__tags">${tags}</span><span class="svc-card__title">${e(s.name)}</span>${(s.tagline || s.description) ? `<span class="svc-card__tagline">${e(s.tagline || s.description)}</span>` : ""}<span class="svc-card__more" aria-hidden="true"></span></summary><div class="svc-card__body">${gallery(cat, s)}<div class="svc-card__text">${owned ? `<p class="svc-card__lead">Framework manages this card for you. To change your details or links, ask for a change below.</p>` : ""}${!owned && s.tagline && s.description ? `<p class="svc-card__lead">${e(s.description)}</p>` : ""}${!owned && s.problem ? `<h4 class="svc-h">The problem</h4><p>${e(s.problem)}</p>` : ""}${owned ? "" : benefits}${!owned && s.why ? `<h4 class="svc-h">Why you might need it</h4><p>${e(s.why)}</p>` : ""}${owned ? "" : demo}</div><div class="svc-card__cta">${owned ? "" : priceLine}${control}</div></div></details></li>`;
}

/** The section: a short lead, then one expandable card per service. The first highlighted (featured or suggested) card starts open; the rest are one tidy line each. */
export function serviceCatalogue(vm, cat) {
  if (!cat || !cat.items || !cat.items.length) return "";
  const banner = cat.flash && FLASH[cat.flash] ? `<p class="form-banner" role="status">${e(FLASH[cat.flash])}</p>` : "";
  const leadIdx = cat.items.findIndex((s) => s.recommended || s.featured || s.suggested);
  const est = cat.items.some((s) => s.priceType === "starting_at") ? `<p class="muted small">${e(ESTIMATE_NOTE)}</p>` : "";
  return `<section class="ws-sec svc" id="additional-services" aria-labelledby="ws-svc-h"><h2 class="h2" id="ws-svc-h">Additional services</h2><p class="ws-sec__lead">Optional extras from Framework. Open one to see what it is for. Asking about a service doesn’t start any work or cost anything: we’ll get in touch first.</p>${banner}<ul class="svc-list">${cat.items.map((s, i) => card(cat, s, i === leadIdx)).join("")}</ul>${est}${cat.canRequest ? "" : `<p class="muted small">Only account owners can request a service.</p>`}</section>`;
}
