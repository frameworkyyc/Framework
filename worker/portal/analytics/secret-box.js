/**
 * Encryption of a client's Cloudflare API token at rest (migration 0029, website_analytics.cf_token_enc). AES-256-GCM through the Workers Web Crypto API.
 *
 *   key      the Worker secret ANALYTICS_CREDENTIALS_KEY: 32 random bytes, base64 (standard or url-safe) or 64 hex characters. Never stored in the database or the repository.
 *   value    "v1.<12-byte iv>.<ciphertext with its 16-byte tag>", base64url. A fresh random iv for every encryption.
 *   binding  the organization id and website id are the additional authenticated data, so a value copied to another website or organization does not decrypt.
 * Decryption failures are one short code and never carry the key, the token or the value. Nothing here logs.
 */
const VERSION = "v1";
const AAD_PREFIX = "framework/website-analytics/cf-token/v1";
const enc = new TextEncoder(), dec = new TextDecoder();

const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function fromB64(s) {
  const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(t + "=".repeat((4 - (t.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** The 32 key bytes from the secret, or null when it is absent or not exactly 32 bytes. */
export function keyBytes(env) {
  const raw = env && typeof env.ANALYTICS_CREDENTIALS_KEY === "string" ? env.ANALYTICS_CREDENTIALS_KEY.trim() : "";
  if (!raw) return null;
  try {
    if (/^[0-9a-f]{64}$/i.test(raw)) return Uint8Array.from(raw.match(/../g), (x) => parseInt(x, 16));
    if (!/^[A-Za-z0-9+/_-]+=*$/.test(raw)) return null;
    const b = fromB64(raw);
    return b.length === 32 ? b : null;
  } catch { return null; }
}
/** Whether the server can encrypt and decrypt client tokens (a boolean only: never the key). */
export const keyReady = (env) => !!keyBytes(env);

const aad = (organizationId, websiteId) => enc.encode(`${AAD_PREFIX}|${organizationId}|${websiteId}`);
async function importKey(env, usage) {
  const raw = keyBytes(env);
  if (!raw) throw new Error("credentials_key_missing");
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [usage]);
}

/** Encrypts a token for one website of one organization. Throws credentials_key_missing when the key is not set up. */
export async function sealToken(env, { organizationId, websiteId, token }) {
  const key = await importKey(env, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(organizationId, websiteId) }, key, enc.encode(token)));
  return `${VERSION}.${b64u(iv)}.${b64u(ct)}`;
}

/** The token, or a thrown Error whose message is credentials_key_missing or credentials_unreadable (wrong key, another row's value, or tampered). */
export async function openToken(env, { organizationId, websiteId, value }) {
  const key = await importKey(env, "decrypt");
  const parts = typeof value === "string" ? value.split(".") : [];
  if (parts.length !== 3 || parts[0] !== VERSION) throw new Error("credentials_unreadable");
  try {
    const iv = fromB64(parts[1]), ct = fromB64(parts[2]);
    if (iv.length !== 12 || ct.length < 17) throw new Error("x");
    return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad(organizationId, websiteId) }, key, ct));
  } catch { throw new Error("credentials_unreadable"); }
}
