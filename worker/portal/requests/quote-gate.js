/**
 * The gate in front of BINDING quote acceptance. Accepting a quote in the portal authorizes paid work, so it stays closed until BOTH are true:
 *   1. Framework has published its terms and approval wording below (version and text), and
 *   2. PORTAL_REQUESTS_QUOTES is exactly "1" on that deployment.
 * Until then a client sees a quote and can ask questions about it, and only Framework can RECORD an agreement made outside the portal (decided_via = 'staff_record').
 *
 * Nothing here is invented: the wording is Framework's to supply (terms of service, taxes, approval language). Leaving `version` or `text` empty keeps the gate shut.
 */
export const QUOTE_TERMS = Object.freeze({
  version: "", // e.g. "2026-12-01"; stored with every accepted quote
  text: "",    // the approval wording the client agrees to when they accept
});

export function quoteAcceptanceOpen(env, terms = QUOTE_TERMS) {
  return !!env && String(env.PORTAL_REQUESTS_QUOTES || "").trim() === "1" && typeof terms.version === "string" && terms.version.trim() !== "" && typeof terms.text === "string" && terms.text.trim() !== "";
}
