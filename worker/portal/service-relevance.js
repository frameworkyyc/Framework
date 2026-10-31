/**
 * Which Additional Services to highlight for ONE client, which to leave out, and in what order. Pure functions over facts the portal already has: nothing is guessed from a name or a description,
 * and a service is only ever "suggested" because of an explicit rule below, with the reason shown to the client in plain words.
 *
 *  - RELEVANCE: service key -> rules { when(context), reason }. A rule that matches marks the service "Suggested for you" and gives the reason.
 *  - OWNED_BY: service key -> a test on the same context that says Framework is ALREADY doing this for the client (for example a published SEO plan on their website); such a service is not promoted.
 *  - Admin can also mark a service Already has it ('owned') or Don't show ('hidden') for one client (client_service_state): both leave it out.
 * Order: Admin's featured services first, then the suggested ones, then Admin's own order. Nothing here creates a request, changes a price or hides a service from a request that already exists.
 */

export const RELEVANCE = Object.freeze({
  "seo-visibility": Object.freeze([Object.freeze({ when: (c) => c.hasLiveWebsite, reason: "Your website is live" })]),
  "digital-business-cards": Object.freeze([Object.freeze({ when: (c) => c.brandPublished, reason: "Your brand is ready to put on a card" })]),
});

export const OWNED_BY = Object.freeze({
  "seo-visibility": (c) => c.seoActive,
});

/** @returns {string|null} the reason this service is suggested for this client, or null */
export function suggestionFor(key, context) {
  const rules = Object.hasOwn(RELEVANCE, key) ? RELEVANCE[key] : [];
  const hit = rules.find((r) => { try { return Boolean(r.when(context)); } catch { return false; } });
  return hit ? hit.reason : null;
}

export function alreadyHas(key, context, states = {}) {
  if (states[key] && (states[key].state === "owned" || states[key].state === "hidden")) return true;
  const test = Object.hasOwn(OWNED_BY, key) ? OWNED_BY[key] : null;
  try { return Boolean(test && test(context)); } catch { return false; }
}

/**
 * @param {Array} services the shown services (portal-services.js listClientServices), in Admin's order
 * @param {{hasLiveWebsite?: boolean, brandPublished?: boolean, seoActive?: boolean}} context
 * @param {{[key: string]: {state: string}}} states this client's client_service_state rows
 * @returns {Array} the services to show, each with `suggested` (a reason or null), highlighted ones first
 */
export function organiseServices(services, context, states = {}) {
  const shown = services.filter((s) => !alreadyHas(s.key, context, states)).map((s, i) => ({ ...s, suggested: suggestionFor(s.key, context), _i: i }));
  const rank = (s) => (s.featured ? 0 : s.suggested ? 1 : 2);
  return shown.sort((a, b) => rank(a) - rank(b) || a._i - b._i).map(({ _i, ...s }) => s);
}
