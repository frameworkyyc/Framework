/**
 * Optional abuse limiting for the unauthenticated portal endpoints (Stage 2C).
 *
 * Design: Cloudflare's Workers Rate Limiting binding (`env.PORTAL_RATE_LIMITER`, `.limit({key})`) is used IF it has been configured;
 * it is NOT configured by this change, so today nothing is limited here. No database counters are used (that would need a migration).
 * Keys are a keyed hash of the client address plus the bucket, never the address. If the limiter errors, requests are allowed:
 * limiting is abuse mitigation, not an authorization control, and an outage must not lock every client out.
 */
import { hashIp } from "./crypto.js";

export const BUCKETS = Object.freeze(["login", "callback", "logout"]);

export async function isRateLimited(env, request, cfg, bucket) {
  const binding = env && env.PORTAL_RATE_LIMITER;
  if (!binding || typeof binding.limit !== "function" || !BUCKETS.includes(bucket)) return false;
  try {
    const who = (await hashIp(cfg.pepper, request.headers.get("CF-Connecting-IP"))) || "unknown";
    const res = await binding.limit({ key: `${bucket}:${who}` });
    return Boolean(res) && res.success === false;
  } catch {
    return false;
  }
}
