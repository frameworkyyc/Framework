/**
 * Tracked keywords and their rank checks (migration 0022, proposed). A client names the searches they care about (a keyword and, optionally, a place); Framework looks each one up and
 * records the result. A rank is only ever a stored check: nothing here estimates, derives or imports a ranking, so a keyword with no check has none. Removing a keyword archives it
 * (its checks stay). Every statement names organization_id and the website id, so another organization's website or keyword is simply "not found". A database without 0022 answers
 * { available: false } / "unavailable".
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor } from "./common.js";
import { validateDate } from "./websites.js";

export const MAX_KEYWORDS = 20, MAX_CHECKS = 400, MAX_POSITION = 200;
const missing = (err) => /no such table/i.test(String(err && err.message));
const CTRL = /[\u0000-\u001F\u007F<>]/;

/** A keyword or place: trimmed, spaces collapsed, no control characters or angle brackets; undefined when invalid. */
function phrase(raw, { min, max }) {
  if (typeof raw !== "string") return undefined;
  const t = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  return t.length >= min && t.length <= max && !CTRL.test(t) ? t : undefined;
}
export const validateKeyword = (raw) => phrase(raw, { min: 2, max: 80 });
export const validateLocation = (raw) => (raw === undefined || raw === null || String(raw).trim() === "" ? "" : phrase(raw, { min: 2, max: 80 }));
const url = (raw) => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 300 || /[\s<>"'\\]/.test(raw)) return undefined;
  try { const u = new URL(raw); return u.protocol === "https:" && !u.username && !u.password && u.hostname.includes(".") ? u.toString() : undefined; } catch { return undefined; }
};
const toKeyword = (r) => ({ id: r.id, websiteId: r.website_id, keyword: r.keyword, location: r.location, createdAt: r.created_at, archived: r.archived_at != null });
const toCheck = (r) => ({ id: r.id, keywordId: r.keyword_id, checkedOn: r.checked_on, position: r.position, url: r.result_url, source: r.source, note: r.note, createdAt: r.created_at });
const audit = (db, org, actorType, actor, action, id, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, ?, ?, ?, 'seo_keyword', ?, ?, 'internal', ?)").bind(newId(), org, actorType, actor, action, id, JSON.stringify(detail || {}), at);
const siteOk = (db, org, website, { published = false } = {}) => (published
  ? db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND archived_at IS NULL AND published = 1")
  : db.prepare("SELECT 1 AS x FROM websites WHERE id = ? AND organization_id = ? AND archived_at IS NULL")).bind(website, org).first();

/** Live keywords of an organization with their checks (newest check first), for the client (published websites only) or for Admin (one website, any). */
export async function listKeywords(db, organizationId, { websiteId = null, client = true } = {}) {
  requireOrgId(organizationId); if (websiteId !== null) requireId(websiteId, "website_id");
  // four fixed statements (client or Admin, all websites or one): no SQL is built from values
  const K = "SELECT k.id, k.website_id, k.keyword, k.location, k.created_at, k.archived_at FROM seo_keywords k WHERE k.organization_id = ? AND k.archived_at IS NULL";
  const C = "SELECT c.id, c.keyword_id, c.checked_on, c.position, c.result_url, c.source, c.note, c.created_at FROM seo_rank_checks c JOIN seo_keywords k ON k.id = c.keyword_id AND k.organization_id = c.organization_id WHERE k.organization_id = ? AND k.archived_at IS NULL";
  const LIVE = " AND EXISTS (SELECT 1 FROM websites w WHERE w.id = k.website_id AND w.organization_id = k.organization_id AND w.published = 1 AND w.archived_at IS NULL)";
  const KO = " ORDER BY k.created_at, k.id", CO = " ORDER BY c.checked_on DESC, c.created_at DESC, c.id";
  const [kq, cq, binds] = client
    ? (websiteId ? [K + " AND k.website_id = ?" + LIVE + KO, C + " AND k.website_id = ?" + LIVE + CO, [organizationId, websiteId]] : [K + LIVE + KO, C + LIVE + CO, [organizationId]])
    : (websiteId ? [K + " AND k.website_id = ?" + KO, C + " AND k.website_id = ?" + CO, [organizationId, websiteId]] : [K + KO, C + CO, [organizationId]]);
  try {
    const kws = (await db.prepare(kq).bind(...binds).all()).results.map(toKeyword);
    if (!kws.length) return { available: true, keywords: [] };
    const checks = (await db.prepare(cq).bind(...binds).all()).results.map(toCheck);
    return { available: true, keywords: kws.map((k) => ({ ...k, checks: checks.filter((c) => c.keywordId === k.id) })) };
  } catch (err) { if (missing(err)) return { available: false, keywords: [] }; throw err; }
}

/** Add a keyword (a client, or staff for a client). Checked in the same statements that write it: the website is this organization's (and published, for a client), the cap holds, no live duplicate. */
export async function addKeyword(db, organizationId, websiteId, { keyword, location = "" }, actor, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const k = validateKeyword(keyword), l = validateLocation(location);
  if (k === undefined) return fail("invalid_keyword");
  if (l === undefined) return fail("invalid_location");
  const id = newId(), at = isoTime(now);
  try {
    if (!(await siteOk(db, organizationId, websiteId, { published: !asStaff }))) return fail("not_found");
    if ((await db.prepare("SELECT COUNT(*) AS n FROM seo_keywords WHERE organization_id = ? AND archived_at IS NULL").bind(organizationId).first()).n >= MAX_KEYWORDS) return fail("too_many");
    if (await db.prepare("SELECT 1 AS x FROM seo_keywords WHERE website_id = ? AND organization_id = ? AND archived_at IS NULL AND lower(keyword) = lower(?) AND lower(location) = lower(?)").bind(websiteId, organizationId, k, l).first()) return fail("duplicate");
    await db.batch([
      db.prepare("INSERT INTO seo_keywords (id, organization_id, website_id, keyword, location, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, organizationId, websiteId, k, l, actor.trim(), at),
      audit(db, organizationId, asStaff ? "admin" : "client", actor.trim(), "seo.keyword.added", id, at, { website: websiteId }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); if (/UNIQUE constraint failed/i.test(String(err && err.message))) return fail("duplicate"); throw err; }
}

/** Stop tracking a keyword: archived, its checks kept. */
export async function archiveKeyword(db, organizationId, keywordId, actor, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireId(keywordId, "keyword_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare("UPDATE seo_keywords SET archived_at = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(at, keywordId, organizationId),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, ?, ?, 'seo.keyword.archived', 'seo_keyword', ?, '{}', 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, asStaff ? "admin" : "client", actor.trim(), keywordId, at),
    ]);
    return res[0].meta.changes > 0 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/** Record one verified result for a keyword (staff). position: 1 to 200, or null for "not found in the results checked". One result per keyword, day and source; recording again the same day replaces it. */
export async function recordCheck(db, organizationId, keywordId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(keywordId, "keyword_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !["checked_on", "position", "url", "note"].includes(k))) return fail("invalid_input");
  const day = validateDate(input.checked_on);
  if (!day) return fail("invalid_date");
  if (day > isoTime(now).slice(0, 10)) return fail("invalid_date"); // a check cannot be from the future
  let pos = null;
  if (input.position !== undefined && input.position !== null && input.position !== "") {
    const n = typeof input.position === "number" ? input.position : /^\d{1,3}$/.test(String(input.position)) ? Number(input.position) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > MAX_POSITION) return fail("invalid_position");
    pos = n;
  }
  const u = url(input.url); if (u === undefined) return fail("invalid_url");
  let note = null; if (input.note !== undefined && input.note !== null && String(input.note).trim() !== "") { note = String(input.note).replace(/\s+/g, " ").trim(); if (note.length > 300 || CTRL.test(note)) return fail("invalid_note"); }
  const id = newId(), at = isoTime(now);
  try {
    const kw = await db.prepare("SELECT 1 AS x FROM seo_keywords WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(keywordId, organizationId).first();
    if (!kw) return fail("not_found");
    if ((await db.prepare("SELECT COUNT(*) AS n FROM seo_rank_checks WHERE organization_id = ? AND keyword_id = ?").bind(organizationId, keywordId).first()).n >= MAX_CHECKS) return fail("too_many");
    await db.batch([
      db.prepare("DELETE FROM seo_rank_checks WHERE keyword_id = ? AND organization_id = ? AND checked_on = ? AND source = 'manual'").bind(keywordId, organizationId, day),
      db.prepare("INSERT INTO seo_rank_checks (id, organization_id, keyword_id, checked_on, position, result_url, source, note, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'manual', ?, ?, ?)").bind(id, organizationId, keywordId, day, pos, u, note, actor.trim(), at),
      audit(db, organizationId, "admin", actor.trim(), "seo.rank.recorded", keywordId, at, { day }),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/** Remove a mistaken check (staff). */
export async function deleteCheck(db, organizationId, keywordId, checkId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(keywordId, "keyword_id"); requireId(checkId, "check_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare("DELETE FROM seo_rank_checks WHERE id = ? AND keyword_id = ? AND organization_id = ?").bind(checkId, keywordId, organizationId),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'seo.rank.deleted', 'seo_keyword', ?, '{}', 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, actor.trim(), keywordId, at),
    ]);
    return res[0].meta.changes > 0 ? ok() : fail("not_found");
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}
