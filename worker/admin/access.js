/**
 * Framework Admin — authentication.
 *
 * Cloudflare Access sits in front of /admin and /api/admin and signs every request it lets through with a JWT
 * (header `Cf-Access-Jwt-Assertion`, also the `CF_Authorization` cookie). Access is the front door; this file is
 * the second lock. The Worker never trusts that Access is configured correctly: it verifies the token itself
 * and refuses everything otherwise (fail closed), so reaching the Worker by any other route (workers.dev URL,
 * a Preview URL, a mis-scoped Access policy) still yields no admin access or data.
 *
 * A request is an admin request only if ALL of these hold:
 *   - ACCESS_TEAM_DOMAIN, ACCESS_AUD and ADMIN_EMAILS are configured
 *   - the token is RS256-signed by a key published by your Access team (…/cdn-cgi/access/certs)
 *   - iss is exactly https://<team domain>, aud contains one of ACCESS_AUD, and it is unexpired
 *   - it identifies a person (an `email` claim; service tokens do not qualify)
 *   - that email is listed in ADMIN_EMAILS
 *
 * Admin authorisation is deliberately its own concern. A future client portal gets its own check and its own
 * allow-list; a valid Access login alone never makes someone an admin.
 */

const LEEWAY_SECONDS = 30;
const MAX_TOKEN_CHARS = 8192;
const KEYS_TTL_MS = 10 * 60 * 1000;
const KEYS_REFETCH_MIN_MS = 60 * 1000; // never refetch more than once a minute (forged `kid` values can't hammer Cloudflare)

const textDecoder = new TextDecoder();

const b64urlToBytes = (str) => {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const parseJsonPart = (part) => JSON.parse(textDecoder.decode(b64urlToBytes(part)));

const splitList = (value) =>
  String(value || "")
    .split(/[,\s]+/)
    .map((v) => v.trim())
    .filter(Boolean);

/** Read and normalise the admin auth configuration. Returns null when anything required is missing. */
export function readAccessConfig(env) {
  const team = String(env.ACCESS_TEAM_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const audiences = splitList(env.ACCESS_AUD);
  const admins = splitList(env.ADMIN_EMAILS).map((e) => e.toLowerCase());
  if (!team || !audiences.length || !admins.length) return null;
  return { team, audiences, admins };
}

/* ---- Signing keys (JWKS) ---- */

let keyCache = { team: "", keys: [], at: 0, fetchedAt: 0 };

async function loadKeys(config, env, { forceRefresh = false, fetchImpl = fetch, now = Date.now() } = {}) {
  // ACCESS_JWKS_JSON pins the signing keys (used for local testing only). Normal deployments leave it unset.
  if (env.ACCESS_JWKS_JSON) {
    const parsed = JSON.parse(env.ACCESS_JWKS_JSON);
    return Array.isArray(parsed.keys) ? parsed.keys : [];
  }
  const fresh = keyCache.team === config.team && now - keyCache.at < KEYS_TTL_MS && keyCache.keys.length > 0;
  if (fresh && !forceRefresh) return keyCache.keys;
  if (forceRefresh && keyCache.team === config.team && now - keyCache.fetchedAt < KEYS_REFETCH_MIN_MS) return keyCache.keys;

  const res = await fetchImpl(`https://${config.team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error("jwks_fetch_failed");
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  keyCache = { team: config.team, keys, at: now, fetchedAt: now };
  return keys;
}

export function resetKeyCacheForTests() {
  keyCache = { team: "", keys: [], at: 0, fetchedAt: 0 };
}

/* ---- Token verification ---- */

/**
 * Verify an Access JWT. Resolves to the claims, or throws Error(code) with a short reason code.
 * `deps` lets tests inject fetch and the clock.
 */
export async function verifyAccessJwt(token, config, env, deps = {}) {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_TOKEN_CHARS) throw new Error("bad_token");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("bad_token");

  let header;
  let claims;
  try {
    header = parseJsonPart(parts[0]);
    claims = parseJsonPart(parts[1]);
  } catch {
    throw new Error("bad_token");
  }
  if (!header || header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("bad_alg");

  const now = Math.floor((deps.now ?? Date.now()) / 1000);

  // Signature first, then claims: never act on an unverified payload.
  const findKey = (keys) => keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  let jwk = findKey(await loadKeys(config, env, deps));
  if (!jwk) jwk = findKey(await loadKeys(config, env, { ...deps, forceRefresh: true })); // key rotation
  if (!jwk) throw new Error("unknown_key");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]),
    new TextEncoder().encode(parts[0] + "." + parts[1]),
  );
  if (!valid) throw new Error("bad_signature");

  if (claims.iss !== `https://${config.team}`) throw new Error("bad_issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.some((a) => typeof a === "string" && config.audiences.includes(a))) throw new Error("bad_audience");
  if (typeof claims.exp !== "number" || claims.exp + LEEWAY_SECONDS < now) throw new Error("expired");
  if (typeof claims.nbf === "number" && claims.nbf - LEEWAY_SECONDS > now) throw new Error("not_yet_valid");
  return claims;
}

/* ---- Request authentication ---- */

const readCookie = (request, name) => {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return "";
};

/**
 * Authenticate a request as a Framework admin.
 * Resolves to { ok: true, email } or { ok: false, status, code } where code is only ever
 * "not_configured", "unauthenticated" or "forbidden" (callers never see finer detail; it is logged instead).
 */
export async function authenticateAdmin(request, env, deps = {}) {
  const config = readAccessConfig(env);
  if (!config) {
    console.warn("admin auth: ACCESS_TEAM_DOMAIN, ACCESS_AUD and ADMIN_EMAILS must all be set");
    return { ok: false, status: 503, code: "not_configured" };
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion") || readCookie(request, "CF_Authorization");
  if (!token) return { ok: false, status: 401, code: "unauthenticated" };

  let claims;
  try {
    claims = await verifyAccessJwt(token, config, env, deps);
  } catch (err) {
    console.warn("admin auth: token rejected:", err && err.message);
    return { ok: false, status: 401, code: "unauthenticated" };
  }

  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) {
    console.warn("admin auth: token has no email (service token?)");
    return { ok: false, status: 403, code: "forbidden" };
  }
  if (!config.admins.includes(email)) {
    console.warn("admin auth: email not in ADMIN_EMAILS");
    return { ok: false, status: 403, code: "forbidden" };
  }
  return { ok: true, email };
}
