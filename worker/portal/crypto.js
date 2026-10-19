/**
 * Cryptographic helpers for the client portal (Stage 2A). WebCrypto only; no custom primitives.
 *
 * Everything derived from PORTAL_SESSION_PEPPER uses HMAC-SHA256 with a distinct LABEL ("session", "ip", "csrf", "cookie:<name>"),
 * so a value produced for one purpose can never be accepted for another. Rotating the pepper invalidates every derived value
 * (all sessions, tokens and sealed cookies), which is the intended recovery action after a suspected leak.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const bytesToB64url = (bytes) => {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const b64urlToBytes = (str) => {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str) || str.length % 4 === 1) throw new Error("invalid_base64url");
  const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (str.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

/** A random URL-safe token with `bytes` bytes of entropy (default 32 = 256 bits, 43 characters). */
export const randomToken = (bytes = 32) => bytesToB64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const sha256b64url = async (value) => bytesToB64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(String(value)))));

const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Constant-time comparison for two strings (lengths are not secret). */
export function timingSafeEqualStrings(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

const keyCache = new Map(); // pepper -> CryptoKey (a handful of entries at most: one pepper per deployment)
async function hmacKey(pepper) {
  if (typeof pepper !== "string" || pepper.length < 16) throw new Error("invalid_pepper");
  let key = keyCache.get(pepper);
  if (!key) {
    key = await crypto.subtle.importKey("raw", encoder.encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    if (keyCache.size >= 4) keyCache.clear();
    keyCache.set(pepper, key);
  }
  return key;
}

const mac = async (pepper, label, value) => new Uint8Array(await crypto.subtle.sign("HMAC", await hmacKey(pepper), encoder.encode(`${label}:${value}`)));

/** Hex HMAC-SHA256 (64 characters) of `value` under `label`. */
export const hmacHex = async (pepper, label, value) => toHex(await mac(pepper, label, value));
export const hmacB64url = async (pepper, label, value) => bytesToB64url(await mac(pepper, label, value));

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export const isSessionToken = (value) => typeof value === "string" && TOKEN.test(value);

/** The database id of a session: an HMAC of the cookie token. The token itself is never stored. */
export const hashSessionToken = (pepper, token) => {
  if (!isSessionToken(token)) throw new Error("invalid_session_token");
  return hmacHex(pepper, "session", token);
};

/** A stable, non-reversible fingerprint of a client address for the session record (never the address). */
export const hashIp = async (pepper, ip) => (typeof ip === "string" && ip.length > 0 && ip.length <= 64 ? (await hmacHex(pepper, "ip", ip)).slice(0, 32) : null);

/** Session-bound CSRF token (for the sign-out form): useless without the matching session, and different for every session. */
export const csrfToken = (pepper, sessionId) => hmacB64url(pepper, "csrf", sessionId);
export async function verifyCsrfToken(pepper, sessionId, supplied) {
  if (typeof supplied !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(supplied) || typeof sessionId !== "string" || !sessionId) return false;
  return timingSafeEqualStrings(await csrfToken(pepper, sessionId), supplied);
}

/**
 * Tamper-proof, expiring, purpose-bound payloads for short-lived cookies (the sign-in state cookie in the next stage).
 * Signed, NOT encrypted: never put anything secret in it that the browser must not read.
 */
export async function sealPayload(pepper, purpose, payload, now, ttlSeconds) {
  const body = bytesToB64url(encoder.encode(JSON.stringify({ ...payload, exp: Math.floor(now.getTime() / 1000) + ttlSeconds })));
  return `${body}.${await hmacB64url(pepper, `seal:${purpose}`, body)}`;
}

export async function openPayload(pepper, purpose, sealed, now) {
  if (typeof sealed !== "string" || sealed.length > 4096) return null;
  const parts = sealed.split(".");
  if (parts.length !== 2 || !/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  let expected;
  try {
    expected = await hmacB64url(pepper, `seal:${purpose}`, parts[0]);
  } catch {
    return null;
  }
  if (!timingSafeEqualStrings(expected, parts[1])) return null;
  try {
    const payload = JSON.parse(decoder.decode(b64urlToBytes(parts[0])));
    if (!payload || typeof payload !== "object" || typeof payload.exp !== "number" || Math.floor(now.getTime() / 1000) > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}
