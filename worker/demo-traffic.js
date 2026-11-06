/**
 * Framework — private traffic reporting for the demo landing page (/demos/). Plain JavaScript, unit-testable like contact.js.
 *
 *   GET  /d/<token>        opaque tracking link → 302 to /demos/#j=<journey id> (the fragment never reaches a server or a log)
 *   POST /api/demo-events  anonymous interaction events from the demo page, keyed by the journey id from that fragment
 *   recordEnquiry()        called by worker/contact.js after an enquiry email was accepted
 *
 * What a link visit means: it shows WHICH LINK was used, not WHO visited (links get forwarded, previewed and scanned). Nothing here identifies
 * a person: no IP address, no user-agent string, no cookie, no email address is stored (see worker/DEMO-TRAFFIC.md). Everything is first-party and
 * read only in the authenticated Admin area (worker/admin/demo-traffic-api.js). Google Analytics is not involved.
 *
 * Needs migration 0021 (migrations/portal-proposed/, not applied until approved). Without its tables every public path degrades silently:
 * events are dropped with 204 and /d/<token> still redirects, just without a journey. Nothing here ever throws to a visitor.
 */
import { bytesToB64url, b64urlToBytes, hmacHex, timingSafeEqualStrings } from "./portal/crypto.js";
import { readTextLimited, oneLine } from "./assessment.js";

export const RETENTION_DAYS = 180; // events and journeys older than this are purged (about 1 in 50 ingestions)
export const MAX_EVENTS_PER_JOURNEY = 300;
export const MAX_EVENTS_PER_REQUEST = 12;
export const MAX_BODY_BYTES = 4096;
export const TOKEN_LENGTH = 22;
export const TOKEN_LABEL = "demo-link"; // distinct HMAC label: a value made for another purpose can never be accepted as a link token
const PURGE_ONE_IN = 50;

export const JOURNEY_ID = /^[A-Za-z0-9_-]{22}$/;
export const LINK_ID = /^[0-9a-f]{16}$/;

/* ---------- Signing key and tokens ---------- */

/** DEMO_LINK_SECRET if set, else the portal session pepper (both need 16+ characters). null when neither is usable. */
export function signingKey(env) {
  for (const v of [env && env.DEMO_LINK_SECRET, env && env.PORTAL_SESSION_PEPPER]) if (typeof v === "string" && v.length >= 16) return v;
  return null;
}

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((x) => parseInt(x, 16)));
const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A new link id: 16 hex characters = 8 random bytes. The public token is derived from it (never stored), so Admin can always re-copy a link. */
export const newLinkId = () => bytesToHex(crypto.getRandomValues(new Uint8Array(8)));

/** Token (22 chars) = base64url(8 id bytes) (11) + base64url(first 8 bytes of HMAC-SHA256(key, "demo-link:" + linkId)) (11). */
export async function tokenForLinkId(key, linkId) {
  if (typeof linkId !== "string" || !LINK_ID.test(linkId)) throw new Error("invalid_link_id");
  const mac = await hmacHex(key, TOKEN_LABEL, linkId);
  return bytesToB64url(hexToBytes(linkId)) + bytesToB64url(hexToBytes(mac.slice(0, 16)));
}

/** The link id for a genuine token, else null. Constant-time compare; never touches the database, so junk tokens cost nothing. */
export async function verifyToken(key, token) {
  if (typeof token !== "string" || token.length !== TOKEN_LENGTH || !/^[A-Za-z0-9_-]{22}$/.test(token) || !key) return null;
  try {
    const linkId = bytesToHex(b64urlToBytes(token.slice(0, 11)));
    if (!LINK_ID.test(linkId)) return null;
    const expected = await tokenForLinkId(key, linkId); // recomputed in canonical form, so a re-encoded variant of the id bytes is refused too
    return timingSafeEqualStrings(expected, token) ? linkId : null;
  } catch {
    return null;
  }
}

/* ---------- Bot and scanner classification (heuristic) ---------- */

// Crawlers, link-preview fetchers, email-security scanners and HTTP libraries. Maintained by hand; it will never be complete.
export const BOT_UA = /bot|crawl|spider|slurp|preview|scanner|headless|phantom|curl|wget|python|requests|axios|node-fetch|go-http|java\/|okhttp|libwww|httpclient|monitor|uptime|lighthouse|pingdom|facebookexternalhit|twitterbot|slackbot|discordbot|whatsapp|telegram|linkedinbot|skypeuripreview|microsoft office|outlook-ios link|safelinks|googleimageproxy|proofpoint|mimecast|barracuda|forcepoint|symantec|trendmicro|sophos|fireeye|mailscanner|urlscan|virustotal|zscaler|cisco|ironport|spamhaus|ahrefs|semrush|mj12|dotbot|petalbot|bingpreview|yandex|baidu|duckduck/i;
// Network owners (Cloudflare's asOrganization) of mail-security gateways and data centres. Real people on a corporate VPN can match too: that is why it is only an indication.
export const BOT_ORG = /proofpoint|mimecast|barracuda|forcepoint|amazon|\baws\b|google cloud|digitalocean|ovh|hetzner|linode|akamai connected cloud|oracle cloud|microsoft corporation|datacamp|cloudflare/i;

export const WEAK_REASON = "no_accept_language";
// Weak reasons are advisory: a later real interaction (an `active`, choice or `open` event) from a request that is not classified a bot clears them.
// A network match is weak because iCloud Private Relay, corporate VPNs and WARP exit through the same Cloudflare, Akamai and cloud networks that
// scanners use, so real people would otherwise be hidden as bots. Every other reason (HEAD, no user agent, a crawler user agent) is sticky.
export const WEAK_REASONS = [WEAK_REASON, "network"];
export const isWeakReason = (reason) => WEAK_REASONS.includes(reason);

const deviceOf = (ua) => {
  if (/ipad|tablet|kindle|silk|playbook/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return "tablet";
  if (/mobi|iphone|ipod|android|windows phone/i.test(ua)) return "mobile";
  if (/windows|macintosh|x11|linux|cros/i.test(ua)) return "desktop";
  return "other";
};

/**
 * Heuristic only: bots disguise themselves and some people use data-centre networks, so "bot" means "likely a bot". The stronger test is a human
 * interaction signal (an `active`, choice or `open` event from a request that is not classified a bot), which is what marks a journey "verified".
 * Returns { bot, reason, device, country }. The user-agent is read here and never stored or returned.
 */
export function classifyRequest(request, opts = {}) {
  const page = opts.page !== undefined ? opts.page : request.method === "GET" || request.method === "HEAD"; // page-like (a link click or navigation), as opposed to a fetch() beacon
  const ua = (request.headers.get("User-Agent") || "").trim();
  const cf = request.cf || {};
  let reason = null;
  if (request.method === "HEAD") reason = "head";
  else if (!ua) reason = "no_user_agent";
  else if (BOT_UA.test(ua)) reason = "user_agent";
  else if (page && typeof cf.asOrganization === "string" && BOT_ORG.test(cf.asOrganization)) reason = "network"; // link clicks only: a beacon from the page's own JavaScript is the human signal
  else if (page && !(request.headers.get("Accept-Language") || "").trim()) reason = WEAK_REASON;
  const country = typeof cf.country === "string" && /^[A-Za-z]{2}$/.test(cf.country) ? cf.country.toUpperCase() : null;
  return { bot: reason !== null, reason, device: deviceOf(ua), country };
}

/* ---------- Tables present? ---------- */

const readyCache = new WeakMap(); // db -> { ready, at }

/** One cheap query per isolate: a positive answer is kept for 5 minutes, a negative one for 30 seconds (so applying the migration needs no redeploy). */
export async function tablesReady(db, now = Date.now()) {
  if (!db || typeof db.prepare !== "function") return false;
  const hit = readyCache.get(db);
  if (hit && now - hit.at < (hit.ready ? 300000 : 30000)) return hit.ready;
  let ready = false;
  try {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('demo_links', 'demo_journeys', 'demo_events')").first();
    ready = !!row && Number(row.n) === 3;
  } catch {
    ready = false;
  }
  readyCache.set(db, { ready, at: now });
  return ready;
}
/** Forget the cached answer for a database (tests). */
export const forgetReady = (db) => { if (db && typeof db === "object") readyCache.delete(db); };

/* ---------- Retention ---------- */

/** Deletes journeys not seen for RETENTION_DAYS (their events with them) and any older stray events. Returns the number of journeys removed. */
export async function purgeOld(db, now = new Date()) {
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 86400000).toISOString();
  const old = "SELECT id FROM demo_journeys WHERE last_seen_at < ?";
  const results = await db.batch([
    db.prepare(`DELETE FROM demo_events WHERE journey_id IN (${old})`).bind(cutoff),
    db.prepare("DELETE FROM demo_events WHERE at < ?").bind(cutoff),
    db.prepare("DELETE FROM demo_journeys WHERE last_seen_at < ?").bind(cutoff),
  ]);
  return Number((results[2] && results[2].meta && results[2].meta.changes) || 0);
}

/* ---------- GET /d/<token> ---------- */

const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
/** Do Not Track (DNT: 1) or Global Privacy Control (Sec-GPC: 1) on the request: nothing is recorded, on the server as well as in the page. */
export const optedOut = (request) => request.headers.get("DNT") === "1" || request.headers.get("Sec-GPC") === "1";

const redirect = (url, fragment = "") => new Response(null, { status: 302, headers: { Location: new URL("/demos/", url).href + fragment, ...noStore } });

export async function handleDemoLink(request, env, deps = {}) {
  const url = new URL(request.url);
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD", ...noStore } });
  try {
    const match = url.pathname.match(/^\/d\/([^/]+)\/*$/);
    if (request.method === "GET" && match && !optedOut(request)) { // an opted-out visitor is still sent to /demos/, but no journey or event is created
      const linkId = await verifyToken(signingKey(env), match[1]); // before any database access
      if (linkId && (await tablesReady(env.PORTAL_DB))) {
        const link = await env.PORTAL_DB.prepare("SELECT id FROM demo_links WHERE id = ? AND revoked_at IS NULL").bind(linkId).first();
        if (link) {
          const cls = classifyRequest(request, { page: true });
          const journey = bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
          const at = (deps.now ? deps.now() : new Date()).toISOString();
          await env.PORTAL_DB.batch([
            env.PORTAL_DB.prepare("INSERT INTO demo_journeys (id, link_id, source, first_seen_at, last_seen_at, country, device, bot, bot_reason) VALUES (?, ?, 'link', ?, ?, ?, ?, ?, ?)")
              .bind(journey, linkId, at, at, cls.country, cls.device, cls.bot ? 1 : 0, cls.reason),
            env.PORTAL_DB.prepare("INSERT INTO demo_events (journey_id, at, type, value, bot) VALUES (?, ?, 'link_open', NULL, ?)").bind(journey, at, cls.bot ? 1 : 0),
          ]);
          return redirect(request.url, "#j=" + journey);
        }
      }
    }
  } catch (err) {
    console.error("demo link error:", err && err.message);
  }
  return redirect(request.url); // invalid, revoked, HEAD, tables missing, or a fault: identical, so nothing is revealed
}

/* ---------- POST /api/demo-events ---------- */

const DISCIPLINES = ["general-contractor", "fence-deck", "renovations", "landscaping"];
const VIBES = ["rugged", "modern", "minimal", "friendly"];
const OPEN_VALUES = ["preview", "card"];
const HUMAN_TYPES = ["active", "discipline", "vibe", "colour", "company", "open"]; // any of these from a non-bot request makes the journey human; `view` alone never does
const CLIENT_TYPES = ["view", ...HUMAN_TYPES]; // `link_open` and `enquiry` are written by the server only

// Control and zero-width/bidi-override characters out, whitespace collapsed.
const cleanText = (v) => String(v).replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim();

/** One client event → { type, value } or null (dropped). */
export function validateEvent(e) {
  if (!e || typeof e !== "object" || Array.isArray(e) || typeof e.t !== "string" || !CLIENT_TYPES.includes(e.t)) return null;
  const t = e.t, v = e.v;
  if (t === "view" || t === "active") return v === undefined || v === null || v === "" ? { type: t, value: null } : null;
  if (t === "discipline") return typeof v === "string" && DISCIPLINES.includes(v) ? { type: t, value: v } : null;
  if (t === "vibe") return typeof v === "string" && VIBES.includes(v) ? { type: t, value: v } : null;
  if (t === "colour") return typeof v === "string" && /^#[0-9A-Fa-f]{6}$/.test(v) ? { type: t, value: v.toUpperCase() } : null;
  if (t === "company") { const c = typeof v === "string" ? cleanText(v) : ""; return c.length >= 1 && c.length <= 60 ? { type: t, value: c } : null; }
  if (v === undefined || v === null || v === "") return { type: t, value: null }; // open
  return typeof v === "string" && OPEN_VALUES.includes(v) ? { type: t, value: v } : null;
}

const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
const err = (status, error, extra = {}) => new Response(JSON.stringify({ error }), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra } });

/** @param deps { now: () => Date, random: () => number, waitUntil } injectable for tests */
export async function handleDemoEvents(request, env, deps = {}) {
  if (request.method !== "POST") return err(405, "method_not_allowed", { Allow: "POST" });
  if (optedOut(request)) return noContent(); // the page already sends nothing; this covers any other client
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return err(403, "forbidden");
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return err(415, "unsupported_media_type");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return err(413, "too_large");
  const raw = await readTextLimited(request, MAX_BODY_BYTES);
  if (raw === null) return err(413, "too_large");
  let body;
  try { body = JSON.parse(raw); } catch { return err(400, "invalid_json"); }

  try {
    const ip = request.headers.get("CF-Connecting-IP") || "";
    if (env.PORTAL_RATE_LIMITER && ip) {
      try {
        const { success } = await env.PORTAL_RATE_LIMITER.limit({ key: "demo:" + oneLine(ip, 64) }); // the address is only the limiter's key, never stored by us
        if (!success) return err(429, "try_again_later", { "Retry-After": "60" });
      } catch { /* a limiter fault must not block recording */ }
    }
    if (!body || typeof body !== "object" || typeof body.j !== "string" || !JOURNEY_ID.test(body.j) || !Array.isArray(body.e)) return noContent();
    const events = body.e.slice(0, MAX_EVENTS_PER_REQUEST).map(validateEvent).filter(Boolean);
    if (!events.length || !(await tablesReady(env.PORTAL_DB))) return noContent();
    await ingest(env.PORTAL_DB, body.j, events, classifyRequest(request), (deps.now ? deps.now() : new Date()));
    const random = deps.random || Math.random;
    if (random() < 1 / PURGE_ONE_IN) {
      const purge = purgeOld(env.PORTAL_DB, deps.now ? deps.now() : new Date()).catch((e) => console.error("demo purge error:", e && e.message));
      if (deps.waitUntil) deps.waitUntil(purge); else await purge;
    }
  } catch (e) {
    console.error("demo events error:", e && e.message);
  }
  return noContent();
}

async function ingest(db, journeyId, events, cls, nowDate) {
  const at = nowDate.toISOString();
  let row = await db.prepare("SELECT bot, bot_reason, human FROM demo_journeys WHERE id = ?").bind(journeyId).first();
  const statements = [];
  if (!row) {
    // A client can never set link_id: only /d/<token> does. An unknown id is a direct visit.
    statements.push(db.prepare("INSERT OR IGNORE INTO demo_journeys (id, link_id, source, first_seen_at, last_seen_at, country, device, bot, bot_reason) VALUES (?, NULL, 'direct', ?, ?, ?, ?, ?, ?)")
      .bind(journeyId, at, at, cls.country, cls.device, cls.bot ? 1 : 0, cls.reason));
    row = { bot: cls.bot ? 1 : 0, bot_reason: cls.reason, human: 0 };
  }
  const have = await db.prepare("SELECT COUNT(*) AS n FROM demo_events WHERE journey_id = ?").bind(journeyId).first();
  const room = MAX_EVENTS_PER_JOURNEY - Number((have && have.n) || 0);
  if (room <= 0) return;
  const kept = events.slice(0, room);

  // Bot flag: a strong signal (HEAD, no user agent, crawler user agent) is sticky. The weak ones (a mail-security or data-centre network, or no Accept-Language,
  // both seen on the link visit) are cleared by a later human interaction from a request that is not a bot.
  const human = kept.some((e) => HUMAN_TYPES.includes(e.type));
  let bot = !!row.bot, reason = row.bot_reason || null;
  if (cls.bot && !bot) { bot = true; reason = cls.reason; }
  else if (!cls.bot && bot && isWeakReason(reason) && human) { bot = false; reason = null; }
  const isHuman = !!row.human || (human && !cls.bot && !bot);

  for (const e of kept) statements.push(db.prepare("INSERT INTO demo_events (journey_id, at, type, value, bot) VALUES (?, ?, ?, ?, ?)").bind(journeyId, at, e.type, e.value, cls.bot ? 1 : 0));
  const latest = (type) => { for (let i = kept.length - 1; i >= 0; i--) if (kept[i].type === type) return kept[i].value; return null; };
  statements.push(db.prepare(
    "UPDATE demo_journeys SET last_seen_at = ?, bot = ?, bot_reason = ?, human = ?, discipline = COALESCE(?, discipline), vibe = COALESCE(?, vibe), colour = COALESCE(?, colour), company = COALESCE(?, company), demo_opens = demo_opens + ? WHERE id = ?")
    .bind(at, bot ? 1 : 0, reason, isHuman ? 1 : 0, latest("discipline"), latest("vibe"), latest("colour"), latest("company"), kept.filter((e) => e.type === "open").length, journeyId));
  await db.batch(statements);
}

/* ---------- Enquiries (called by worker/contact.js) ---------- */

/**
 * Marks a journey as having sent an enquiry, after the email provider accepted it. Stores nothing from the form (no message, name, email or business).
 * An accepted enquiry is the strongest human signal there is, so the journey is human and no longer flagged a bot. Never throws.
 * @returns {Promise<boolean>} whether it was recorded
 */
export async function recordEnquiry(env, journeyId, now = new Date()) {
  try {
    if (typeof journeyId !== "string" || !JOURNEY_ID.test(journeyId) || !(await tablesReady(env.PORTAL_DB))) return false;
    const db = env.PORTAL_DB, at = (now instanceof Date ? now : new Date()).toISOString();
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO demo_journeys (id, link_id, source, first_seen_at, last_seen_at) VALUES (?, NULL, 'direct', ?, ?)").bind(journeyId, at, at),
      db.prepare("INSERT INTO demo_events (journey_id, at, type, value, bot) VALUES (?, ?, 'enquiry', NULL, 0)").bind(journeyId, at),
      db.prepare("UPDATE demo_journeys SET enquired = 1, human = 1, bot = 0, bot_reason = NULL, last_seen_at = ? WHERE id = ?").bind(at, journeyId),
    ]);
    return true;
  } catch (e) {
    console.error("demo enquiry record error:", e && e.message);
    return false;
  }
}
