/**
 * Abuse limiting for the unauthenticated portal endpoints (Stage 2C).
 *
 * Uses Cloudflare's Workers Rate Limiting binding (`env.PORTAL_RATE_LIMITER`, `.limit({key})`), configured for Staging only in
 * wrangler.jsonc (`previews.ratelimits`). If the binding is absent the limiter does nothing. It runs BEFORE any session, database or WorkOS work,
 * so a limited request costs neither. No database counters are used.
 *
 * Who is counted: one counter per (bucket, client network). IPv4 clients are counted per address; IPv6 clients per /64 prefix (a single
 * subscriber normally owns a whole /64, so counting full addresses would let one client rotate through billions of addresses).
 * Keys are a keyed hash of that network, never the address itself.
 *
 * A request whose client address is missing or not a valid IP is NOT limited: putting such requests into one shared bucket would let one
 * unattributable client throttle every other visitor. Cloudflare always sets CF-Connecting-IP (clients cannot forge it), so this only
 * happens outside Cloudflare (tests, local dev). Limiter errors also fail open: limiting is abuse mitigation, not authorization, and the
 * independent WAF rule remains in front.
 */
import { hashIp } from "./crypto.js";

export const BUCKETS = Object.freeze(["login", "callback", "logout"]);

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIPv4(text) {
  const m = IPV4.exec(text);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((n, i) => n > 255 || (m[i + 1].length > 1 && m[i + 1].startsWith("0")))) return null; // no leading zeros (ambiguous octal)
  return parts;
}

/** Eight 16-bit groups, or null. Accepts "::" compression and a trailing embedded IPv4; rejects anything else. */
function parseIPv6(input) {
  let text = input.toLowerCase();
  const zone = text.indexOf("%");
  if (zone !== -1) text = text.slice(0, zone);
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return null;
  if (text.includes(":::")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const toGroups = (s) => (s === "" ? [] : s.split(":"));
  let head = toGroups(halves[0]);
  let tail = halves.length === 2 ? toGroups(halves[1]) : [];
  const all = halves.length === 2 ? [...head, ...tail] : head;
  const last = all[all.length - 1];
  let v4groups = [];
  if (last !== undefined && last.includes(".")) {
    const v4 = parseIPv4(last);
    if (!v4) return null;
    v4groups = [((v4[0] << 8) | v4[1]).toString(16), ((v4[2] << 8) | v4[3]).toString(16)];
    if (halves.length === 2 && tail.length) tail = [...tail.slice(0, -1), ...v4groups];
    else head = [...head.slice(0, -1), ...v4groups];
  }
  if (halves.length === 2 && head.length + tail.length > 7) return null;
  const full = halves.length === 2 ? [...head, ...Array(8 - head.length - tail.length).fill("0"), ...tail] : head;
  if (full.length !== 8) return null;
  if (!full.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return null;
  return full.map((g) => parseInt(g, 16));
}

/**
 * The canonical network a client address belongs to: "v4:a.b.c.d", or "v6:xxxx:xxxx:xxxx:xxxx" (its /64). IPv4-mapped IPv6 addresses count as the IPv4
 * address. Returns null for anything that is not a valid IP address.
 */
export function clientNetwork(value) {
  if (typeof value !== "string") return null;
  const ip = value.trim();
  if (!ip || ip.length > 64) return null;
  const v4 = parseIPv4(ip);
  if (v4) return "v4:" + v4.join(".");
  const g = parseIPv6(ip);
  if (!g) return null;
  if (g.slice(0, 5).every((n) => n === 0) && g[5] === 0xffff) return "v4:" + [g[6] >> 8, g[6] & 255, g[7] >> 8, g[7] & 255].join(".");
  if (g.slice(0, 4).every((n) => n === 0)) return null; // "::" and "::1" style addresses are not real clients and would all share one counter
  return "v6:" + g.slice(0, 4).map((n) => n.toString(16).padStart(4, "0")).join(":");
}

/** The limiter key for a bucket and client address (`<bucket>:<32 hex>`), or null when the address cannot be attributed. */
export async function rateLimitKey(pepper, bucket, ip) {
  const network = clientNetwork(ip);
  if (!network || !BUCKETS.includes(bucket)) return null;
  const hashed = await hashIp(pepper, network);
  return hashed ? `${bucket}:${hashed}` : null;
}

export async function isRateLimited(env, request, cfg, bucket) {
  const binding = env && env.PORTAL_RATE_LIMITER;
  if (!binding || typeof binding.limit !== "function") return false;
  try {
    const key = await rateLimitKey(cfg.pepper, bucket, request.headers.get("CF-Connecting-IP"));
    if (!key) return false;
    const res = await binding.limit({ key });
    return Boolean(res) && res.success === false;
  } catch {
    return false;
  }
}
