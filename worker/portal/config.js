/**
 * Client portal configuration (Stage 2A). Pure: reads the environment, validates it, returns a frozen object or null.
 * Nothing imports this yet: the live routes are connected in a later stage, and the portal stays OFF until PORTAL_ENABLED is "1".
 *
 * Required when enabled: PORTAL_ENABLED = "1", PORTAL_BASE_URL (https origin), PORTAL_AUTH_CLIENT_ID, PORTAL_AUTH_CLIENT_SECRET (the
 * WorkOS API key), PORTAL_AUTH_ISSUER (the exact token issuer), PORTAL_SESSION_PEPPER (at least 32 characters) and the PORTAL_DB binding.
 * Secret VALUES are never returned in problem lists or logged: problems are setting NAMES and short codes only.
 */

export const PRODUCTION_HOSTS = ["frameworkco.ca", "www.frameworkco.ca"];
// 32 random bytes = 43 base64/base64url characters (or 64 hex). Length and variety are checked; true randomness cannot be, so the setup
// instructions generate it with a CSPRNG (openssl rand -base64 48) and the value is never shown or logged.
export const MIN_PEPPER_LENGTH = 43;
const PEPPER_ALPHABET = /^[A-Za-z0-9+/_=-]+$/;
const MIN_DISTINCT_PEPPER_CHARS = 12;

const CLIENT_ID = /^client_[A-Za-z0-9]{10,64}$/;
const text = (v) => (typeof v === "string" ? v.trim() : "");

/** "off" (not enabled: respond as if the portal does not exist), "misconfigured" (enabled but unusable: fail closed), or "on". */
export function portalMode(env) {
  if (!env || text(env.PORTAL_ENABLED) !== "1") return "off";
  return portalConfigProblems(env).length ? "misconfigured" : "on";
}

/** Names/codes of everything wrong with an ENABLED configuration. Empty when usable. Safe to log. */
export function portalConfigProblems(env) {
  const problems = [];
  if (!env || text(env.PORTAL_ENABLED) !== "1") return ["PORTAL_ENABLED"];

  let origin = "";
  try {
    const u = new URL(text(env.PORTAL_BASE_URL));
    const clean = u.protocol === "https:" && !u.username && !u.password && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash;
    if (clean) origin = u.origin;
  } catch {
    origin = "";
  }
  if (!origin) problems.push("PORTAL_BASE_URL");
  // Defence in depth against switching the portal on for the live site by accident: the production host needs a SECOND, explicit flag.
  else if (PRODUCTION_HOSTS.includes(new URL(origin).hostname) && text(env.PORTAL_ALLOW_PRODUCTION) !== "1") problems.push("production_host_not_approved");

  if (!CLIENT_ID.test(text(env.PORTAL_AUTH_CLIENT_ID))) problems.push("PORTAL_AUTH_CLIENT_ID");
  if (!text(env.PORTAL_AUTH_CLIENT_SECRET)) problems.push("PORTAL_AUTH_CLIENT_SECRET");

  let issuerOk = false;
  try {
    const i = new URL(text(env.PORTAL_AUTH_ISSUER));
    issuerOk = i.protocol === "https:" && !i.username && !i.password && !i.search && !i.hash && !text(env.PORTAL_AUTH_ISSUER).endsWith("/");
  } catch {
    issuerOk = false;
  }
  if (!issuerOk) problems.push("PORTAL_AUTH_ISSUER");

  const pepper = text(env.PORTAL_SESSION_PEPPER);
  if (!pepper) problems.push("PORTAL_SESSION_PEPPER");
  else if (pepper.length < MIN_PEPPER_LENGTH) problems.push("PORTAL_SESSION_PEPPER_too_short");
  else if (!PEPPER_ALPHABET.test(pepper) || new Set(pepper).size < MIN_DISTINCT_PEPPER_CHARS) problems.push("PORTAL_SESSION_PEPPER_weak");

  if (!env.PORTAL_DB || typeof env.PORTAL_DB.prepare !== "function" || typeof env.PORTAL_DB.batch !== "function") problems.push("PORTAL_DB");
  return problems;
}

/**
 * The static demo (/portal/demo) is available only where PORTAL_DEMO is exactly "1" AND the portal host is not a production host. The second
 * condition is deliberate defence in depth: even if the variable were ever set on the live site by mistake, the demo stays off there.
 */
export function demoEnabled(env, cfg) {
  return !!env && !!cfg && text(env.PORTAL_DEMO) === "1" && !PRODUCTION_HOSTS.includes(cfg.host);
}

/** The validated configuration, or null unless the portal is enabled AND completely, correctly configured. */
export function readPortalConfig(env) {
  if (portalConfigProblems(env).length) return null;
  const origin = new URL(text(env.PORTAL_BASE_URL)).origin;
  return Object.freeze({
    origin,
    host: new URL(origin).hostname,
    clientId: text(env.PORTAL_AUTH_CLIENT_ID),
    apiKey: text(env.PORTAL_AUTH_CLIENT_SECRET),
    issuer: text(env.PORTAL_AUTH_ISSUER),
    pepper: text(env.PORTAL_SESSION_PEPPER),
  });
}
