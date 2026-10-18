/**
 * Minimal RS256 JWT verification for the client portal (WebCrypto only, no dependencies).
 * Separate from worker/admin/access.js on purpose: the admin's Cloudflare Access check is not touched by portal work.
 *
 * verifyRs256 checks the structure, that alg is exactly RS256 (never "none", never an HMAC algorithm), that the `kid` names a
 * key in the supplied JWKS, the signature, and exp / nbf. Claim policy (issuer, client_id) is left to the caller.
 */

const MAX_TOKEN_CHARS = 8192;
const LEEWAY_SECONDS = 30;
const decoder = new TextDecoder();

const b64urlToBytes = (str) => {
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

const parseJsonPart = (part) => JSON.parse(decoder.decode(b64urlToBytes(part)));

/** @returns {{header, payload, signingInput, signature}|null} null when the token is not three base64url parts of JSON */
export function decodeJwt(token) {
  if (typeof token !== "string" || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) return null;
  try {
    const header = parseJsonPart(parts[0]);
    const payload = parseJsonPart(parts[1]);
    if (!header || typeof header !== "object" || !payload || typeof payload !== "object") return null;
    return { header, payload, signingInput: parts[0] + "." + parts[1], signature: b64urlToBytes(parts[2]) };
  } catch {
    return null;
  }
}

/**
 * @param {string} token
 * @param {{keys: object[]}} jwks
 * @param {Date} [now]
 * @returns {Promise<{ok: boolean, reason?: string, header?: object, payload?: object}>}
 */
export async function verifyRs256(token, jwks, now = new Date()) {
  const jwt = decodeJwt(token);
  if (!jwt) return { ok: false, reason: "malformed" };
  const { header, payload } = jwt;
  if (header.alg !== "RS256") return { ok: false, reason: "bad_alg", header, payload };
  if (typeof header.kid !== "string" || !header.kid) return { ok: false, reason: "no_kid", header, payload };
  const key = ((jwks && jwks.keys) || []).find((k) => k && k.kid === header.kid && k.kty === "RSA" && (!k.alg || k.alg === "RS256") && (!k.use || k.use === "sig"));
  if (!key) return { ok: false, reason: "unknown_kid", header, payload };
  let valid = false;
  try {
    const cryptoKey = await crypto.subtle.importKey("jwk", { kty: "RSA", n: key.n, e: key.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", cryptoKey, jwt.signature, new TextEncoder().encode(jwt.signingInput));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad_signature", header, payload };
  const nowSec = Math.floor(now.getTime() / 1000);
  if (typeof payload.exp !== "number" || nowSec > payload.exp + LEEWAY_SECONDS) return { ok: false, reason: "expired", header, payload };
  if (typeof payload.nbf === "number" && nowSec + LEEWAY_SECONDS < payload.nbf) return { ok: false, reason: "not_yet_valid", header, payload };
  return { ok: true, header, payload };
}
