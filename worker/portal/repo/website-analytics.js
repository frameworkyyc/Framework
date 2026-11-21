/**
 * Website analytics data layer (migration 0028). Two small tables: which Cloudflare Web Analytics site and which Search Console property a website reads, and the cached
 * last answer from each. Credentials are never stored here. Every statement names organization_id, so another organization's website, settings or cache are simply "not found",
 * and a missing table reads as "not available" (the feature stays dormant) while any other database failure is thrown.
 *
 * Migration 0029 (proposed) adds a website's own Cloudflare account: cf_account_id, cf_token_enc (the read-only API token, ENCRYPTED by the caller with secret-box.js before it
 * reaches this module; this module never sees a plain token) and cf_token_set_at. Until 0029 is applied those columns are missing: settings read as "Framework's account"
 * (accountsReady: false) and saving an own account is refused with accounts_unavailable, while everything else works exactly as before.
 */
import { requireOrgId, requireId, isoTime, ok, fail } from "./common.js";

const missing = (err) => /no such table|no such column/i.test(String(err && err.message));
const TAG = /^[0-9a-f]{32}$/;
const ACCOUNT = /^[0-9a-f]{32}$/;
const SEALED = /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{22,}$/;
const PROPERTY = /^(sc-domain:[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+|https:\/\/[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?\/([A-Za-z0-9\-._~%!$&'()*+,;=:@/]*)?)$/;
export const RANGE_VALUES = Object.freeze([7, 30, 90]);
export const SOURCES = Object.freeze(["cloudflare", "search_console"]);

export const validSiteTag = (v) => (typeof v === "string" && TAG.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
/** A Search Console property: a domain property (sc-domain:example.com) or a URL-prefix property (https://example.com/, ending in a slash). */
export function validProperty(v) {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t.length < 10 || t.length > 200 || !PROPERTY.test(t.startsWith("sc-domain:") ? t.toLowerCase() : t)) return null;
  if (t.startsWith("https://") && !t.endsWith("/")) return null;
  return t.startsWith("sc-domain:") ? t.toLowerCase() : t;
}

/** Whether migration 0028 is applied (cached for a short while per database). */
const cache = new WeakMap();
export async function analyticsReady(db, now = Date.now()) {
  if (!db || typeof db.prepare !== "function") return false;
  const hit = cache.get(db);
  if (hit && now - hit.at < (hit.ready ? 300000 : 30000)) return hit.ready;
  let ready = false;
  try { const r = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('website_analytics', 'website_analytics_cache')").first(); ready = !!r && Number(r.n) === 2; } catch { ready = false; }
  cache.set(db, { ready, at: now });
  return ready;
}
export const forgetAnalyticsReady = (db) => { if (db && typeof db === "object") cache.delete(db); };

/** The settings of one website, or { cfSiteTag: null, gscProperty: null, cfAccountId: null, ... } when none were saved. null when the table does not exist.
 * cfTokenEnc is the encrypted token (for the server only: never returned to a browser). accountsReady says whether migration 0029 is applied. */
export async function getConfig(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  const shape = (r, accountsReady) => ({ cfSiteTag: r ? r.cf_site_tag : null, gscProperty: r ? r.gsc_property : null, updatedAt: r ? r.updated_at : null,
    cfAccountId: (r && r.cf_account_id) || null, cfTokenEnc: (r && r.cf_token_enc) || null, cfTokenSetAt: (r && r.cf_token_set_at) || null, accountsReady });
  try {
    const r = await db.prepare("SELECT cf_site_tag, gsc_property, updated_at, cf_account_id, cf_token_enc, cf_token_set_at FROM website_analytics WHERE website_id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
    return shape(r, true);
  } catch (err) { if (!missing(err)) throw err; }
  try { // migration 0029 not applied: the 0028 columns only
    const r = await db.prepare("SELECT cf_site_tag, gsc_property, updated_at FROM website_analytics WHERE website_id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
    return shape(r, false);
  } catch (err) { if (missing(err)) return null; throw err; }
}

/**
 * Saves the settings (an empty or null value disconnects that source). Only for a website of this organization; the composite foreign key refuses any other.
 * Own Cloudflare account (migration 0029): cf_account_id (empty removes the own account AND its token: the website goes back to Framework's account) and cf_token_enc
 * (an already encrypted token; absent or empty keeps the saved one). An own account always needs a token, and a token needs an account.
 */
export async function saveConfig(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (typeof actor !== "string" || actor.length < 1 || actor.length > 254) return fail("invalid_actor");
  const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const cur = await getConfig(db, organizationId, websiteId);
  if (cur === null) return fail("unavailable");
  let tag = cur.cfSiteTag, prop = cur.gscProperty, account = cur.cfAccountId, sealed = cur.cfTokenEnc, setAt = cur.cfTokenSetAt;
  if ("cf_site_tag" in input) { if (blank(input.cf_site_tag)) tag = null; else { tag = validSiteTag(input.cf_site_tag); if (!tag) return fail("invalid_site_tag"); } }
  if ("gsc_property" in input) { if (blank(input.gsc_property)) prop = null; else { prop = validProperty(input.gsc_property); if (!prop) return fail("invalid_property"); } }
  const touchesAccount = ("cf_account_id" in input) || (("cf_token_enc" in input) && !blank(input.cf_token_enc));
  if (touchesAccount && !cur.accountsReady) return fail("accounts_unavailable");
  if ("cf_account_id" in input) {
    if (blank(input.cf_account_id)) { account = null; sealed = null; setAt = null; }
    else { account = typeof input.cf_account_id === "string" && ACCOUNT.test(input.cf_account_id.trim().toLowerCase()) ? input.cf_account_id.trim().toLowerCase() : null; if (!account) return fail("invalid_account_id"); }
  }
  if ("cf_token_enc" in input && !blank(input.cf_token_enc)) {
    if (typeof input.cf_token_enc !== "string" || input.cf_token_enc.length > 1000 || !SEALED.test(input.cf_token_enc)) return fail("invalid_token");
    if (!account) return fail("account_required");
    sealed = input.cf_token_enc; setAt = isoTime(now);
  }
  if (account && !sealed) return fail("token_required");
  const site = await db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
  if (!site) return fail("not_found");
  const at = isoTime(now);
  if (cur.accountsReady) {
    await db.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, gsc_property, cf_account_id, cf_token_enc, cf_token_set_at, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (website_id) DO UPDATE SET cf_site_tag = excluded.cf_site_tag, gsc_property = excluded.gsc_property, cf_account_id = excluded.cf_account_id, cf_token_enc = excluded.cf_token_enc, cf_token_set_at = excluded.cf_token_set_at, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE organization_id = excluded.organization_id")
      .bind(websiteId, organizationId, tag, prop, account, sealed, setAt, at, actor).run();
  } else {
    await db.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, gsc_property, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (website_id) DO UPDATE SET cf_site_tag = excluded.cf_site_tag, gsc_property = excluded.gsc_property, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE organization_id = excluded.organization_id")
      .bind(websiteId, organizationId, tag, prop, at, actor).run();
  }
  // changing what is read (the tag, the account or its token) makes the old answers meaningless: they are dropped (they would also be refused by `ref`)
  if (tag !== cur.cfSiteTag || account !== cur.cfAccountId || sealed !== cur.cfTokenEnc) await db.prepare("DELETE FROM website_analytics_cache WHERE website_id = ? AND organization_id = ? AND source = 'cloudflare'").bind(websiteId, organizationId).run();
  if (prop !== cur.gscProperty) await db.prepare("DELETE FROM website_analytics_cache WHERE website_id = ? AND organization_id = ? AND source = 'search_console'").bind(websiteId, organizationId).run();
  return ok();
}

/** The cached answer for one source and period, or null. A cached answer read for a different site tag or property is never returned. */
export async function getCached(db, organizationId, websiteId, source, rangeDays, ref) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!SOURCES.includes(source) || !RANGE_VALUES.includes(rangeDays)) return null;
  try {
    const r = await db.prepare("SELECT payload, fetched_at, ref FROM website_analytics_cache WHERE website_id = ? AND organization_id = ? AND source = ? AND range_days = ?").bind(websiteId, organizationId, source, rangeDays).first();
    if (!r || r.ref !== ref) return null;
    try { return { data: JSON.parse(r.payload), fetchedAt: r.fetched_at }; } catch { return null; }
  } catch (err) { if (missing(err)) return null; throw err; }
}

export async function putCached(db, organizationId, websiteId, source, rangeDays, ref, data, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!SOURCES.includes(source) || !RANGE_VALUES.includes(rangeDays)) return false;
  const payload = JSON.stringify(data);
  if (payload.length > 100000) return false;
  try {
    await db.prepare("INSERT INTO website_analytics_cache (website_id, organization_id, source, range_days, ref, payload, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (website_id, source, range_days) DO UPDATE SET ref = excluded.ref, payload = excluded.payload, fetched_at = excluded.fetched_at WHERE organization_id = excluded.organization_id")
      .bind(websiteId, organizationId, source, rangeDays, ref, payload, isoTime(now)).run();
    return true;
  } catch (err) { if (missing(err)) return false; throw err; }
}
