/**
 * Website analytics data layer (migration 0028). Two small tables: which Cloudflare Web Analytics site and which Search Console property a website reads, and the cached
 * last answer from each. Credentials are never stored here. Every statement names organization_id, so another organization's website, settings or cache are simply "not found",
 * and a missing table reads as "not available" (the feature stays dormant) while any other database failure is thrown.
 */
import { requireOrgId, requireId, isoTime, ok, fail } from "./common.js";

const missing = (err) => /no such table|no such column/i.test(String(err && err.message));
const TAG = /^[0-9a-f]{32}$/;
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

/** The settings of one website, or { cfSiteTag: null, gscProperty: null } when none were saved. null when the table does not exist. */
export async function getConfig(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  try {
    const r = await db.prepare("SELECT cf_site_tag, gsc_property, updated_at FROM website_analytics WHERE website_id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
    return { cfSiteTag: r ? r.cf_site_tag : null, gscProperty: r ? r.gsc_property : null, updatedAt: r ? r.updated_at : null };
  } catch (err) { if (missing(err)) return null; throw err; }
}

/** Saves the settings (an empty or null value disconnects that source). Only for a website of this organization; the composite foreign key refuses any other. */
export async function saveConfig(db, organizationId, websiteId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (typeof actor !== "string" || actor.length < 1 || actor.length > 254) return fail("invalid_actor");
  const blank = (v) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
  const cur = await getConfig(db, organizationId, websiteId);
  if (cur === null) return fail("unavailable");
  let tag = cur.cfSiteTag, prop = cur.gscProperty;
  if ("cf_site_tag" in input) { if (blank(input.cf_site_tag)) tag = null; else { tag = validSiteTag(input.cf_site_tag); if (!tag) return fail("invalid_site_tag"); } }
  if ("gsc_property" in input) { if (blank(input.gsc_property)) prop = null; else { prop = validProperty(input.gsc_property); if (!prop) return fail("invalid_property"); } }
  const site = await db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
  if (!site) return fail("not_found");
  const at = isoTime(now);
  await db.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, gsc_property, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (website_id) DO UPDATE SET cf_site_tag = excluded.cf_site_tag, gsc_property = excluded.gsc_property, updated_at = excluded.updated_at, updated_by = excluded.updated_by WHERE organization_id = excluded.organization_id")
    .bind(websiteId, organizationId, tag, prop, at, actor).run();
  // changing what is read makes the old answers meaningless: they are dropped (they would also be refused by `ref`)
  if (tag !== cur.cfSiteTag) await db.prepare("DELETE FROM website_analytics_cache WHERE website_id = ? AND organization_id = ? AND source = 'cloudflare'").bind(websiteId, organizationId).run();
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
