/**
 * Websites data layer (migration 0011): the websites of a client (several per client), kept by Framework staff in Admin. Metadata only: the optional screenshot is one private
 * object in the files bucket (see ../website-files.js, which keeps row and object in step).
 *
 * Rules, on top of the shared repository rules (common.js):
 *  - Every function takes the organization id explicitly and every statement names organization_id: a website of another organization is simply "not found".
 *  - "No website" is not stored: it is a client with no rows. status (existing | in_development | live) is separate from managed_by_framework (a yes/no), and from `origin`
 *    (who built it). Domain and hosting facts are plain information, never credentials.
 *  - Only a published, unarchived website may ever be shown to a client (the client functions arrive with the dashboard phase); Admin sees everything.
 *  - Callers outside this module decide WHO may call (Cloudflare Access for Admin). `actor` strings are audit labels, not credentials.
 * A database without migration 0011 reads as "not available": nothing else runs.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, isConstraintViolation, validActor } from "./common.js";
import { validateEnum, validateName, validateText } from "./validate.js";

export const ORIGINS = ["framework", "client"];
export const STATUSES = ["existing", "in_development", "live"];
export const PARTIES = ["framework", "client", "unknown"];
export const MAX_WEBSITES = 12; // per client: more than any real business needs, and a guard against runaway creation

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001F\u007F]/;

/** A plain calendar date (YYYY-MM-DD) or null for none; undefined when invalid. */
export function validateDate(raw) {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || !DATE.test(raw)) return undefined;
  const d = new Date(raw + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === raw ? raw : undefined;
}

/** A web address: "example.ca" becomes https://example.ca; http and https only, no credentials, a real host name. Null for none, undefined when invalid. */
export function validateWebAddress(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  let v = raw.trim();
  if (v === "") return null;
  if (v.length > 300 || /\s/.test(v) || CONTROL.test(v) || /[<>"'\\]/.test(v)) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) { if (/^[a-z][a-z0-9+.-]*:/i.test(v) && !/^[^/]*\./.test(v)) return undefined; v = "https://" + v; }
  try {
    const u = new URL(v);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !u.hostname.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.startsWith("[")) return undefined;
    const out = u.toString();
    return out.length <= 300 ? out : undefined;
  } catch { return undefined; }
}

const FIELDS = ["name", "url", "origin", "status", "managed_by_framework", "launch_date", "domain_registrar", "domain_owner", "domain_renewal", "hosting_provider", "hosting_owner", "hosting_renewal", "management_notes", "published", "sort_order"];
export const WEBSITE_FIELDS = Object.freeze([...FIELDS]);
// Module-level, fixed column lists (never built from input): every writable column, in a fixed order, and what an omitted one is.
const INSERT_COLUMNS = ["id", "organization_id", ...FIELDS, "created_at", "updated_at", "updated_by"].join(", ");
const INSERT_PLACEHOLDERS = ["id", "organization_id", ...FIELDS, "created_at", "updated_at", "updated_by"].map(() => "?").join(", ");
const OMITTED = { sort_order: 0 };

/** Validate the submitted fields (all of them for a new website; just the given ones for an update). Returns { values } or { error }. */
function check(input, { partial }) {
  const v = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  const text = (k, max, err) => { if (!has(k)) return true; const t = validateText(input[k], max); if (t === undefined || (t !== null && /\n/.test(t))) return err; v[k] = t; return true; };
  if (!partial || has("name")) { const n = validateName(input.name, 80); if (!n) return { error: "invalid_name" }; v.name = n; }
  if (!partial || has("url")) { const u = validateWebAddress(input.url); if (u === undefined) return { error: "invalid_url" }; v.url = u; }
  if (!partial || has("origin")) { const o = validateEnum(input.origin, ORIGINS); if (!o) return { error: "invalid_origin" }; v.origin = o; }
  if (!partial || has("status")) { const s = validateEnum(input.status, STATUSES); if (!s) return { error: "invalid_status" }; v.status = s; }
  for (const k of ["managed_by_framework", "published"]) {
    if (!partial && !has(k)) v[k] = 0;
    else if (has(k)) { if (typeof input[k] !== "boolean" && input[k] !== 0 && input[k] !== 1) return { error: "invalid_" + k }; v[k] = input[k] === true || input[k] === 1 ? 1 : 0; }
  }
  for (const k of ["launch_date", "domain_renewal", "hosting_renewal"]) if (has(k)) { const d = validateDate(input[k]); if (d === undefined) return { error: "invalid_date" }; v[k] = d; }
  for (const k of ["domain_owner", "hosting_owner"]) { if (!partial && !has(k)) v[k] = "unknown"; else if (has(k)) { const p = validateEnum(input[k], PARTIES); if (!p) return { error: "invalid_party" }; v[k] = p; } }
  for (const [k, max] of [["domain_registrar", 120], ["hosting_provider", 120]]) { const r = text(k, max, "invalid_text"); if (r !== true) return { error: r }; }
  if (has("management_notes")) { const t = validateText(input.management_notes, 1000); if (t === undefined) return { error: "invalid_text" }; v.management_notes = t; }
  if (has("sort_order")) { const n = input.sort_order; if (!Number.isInteger(n) || n < 0 || n > 9999) return { error: "invalid_sort_order" }; v.sort_order = n; }
  return { values: v };
}

const toWebsite = (r) => ({
  id: r.id, name: r.name, url: r.url, origin: r.origin, status: r.status, managedByFramework: r.managed_by_framework === 1, launchDate: r.launch_date,
  domain: { registrar: r.domain_registrar, owner: r.domain_owner, renewal: r.domain_renewal }, hosting: { provider: r.hosting_provider, owner: r.hosting_owner, renewal: r.hosting_renewal },
  managementNotes: r.management_notes, published: r.published === 1, sortOrder: r.sort_order,
  screenshot: r.screenshot_key ? { name: r.screenshot_name, format: r.screenshot_format, contentType: r.screenshot_type, size: r.screenshot_size, sha256: r.screenshot_sha256 } : null,
  createdAt: r.created_at, updatedAt: r.updated_at, updatedBy: r.updated_by, archivedAt: r.archived_at,
});

/** Does this database have the websites table (migration 0011)? */
export async function websitesAvailable(db) {
  try { await db.prepare("SELECT 1 FROM websites LIMIT 1").first(); return true; } catch { return false; }
}

export async function listWebsitesAdmin(db, organizationId, { includeArchived = true } = {}) {
  requireOrgId(organizationId);
  const rows = (await db.prepare(`SELECT * FROM websites WHERE organization_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY (archived_at IS NOT NULL), sort_order, created_at, id`).bind(organizationId).all()).results;
  return rows.map(toWebsite);
}

export async function getWebsiteAdmin(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  const r = await db.prepare("SELECT * FROM websites WHERE id = ? AND organization_id = ?").bind(websiteId, organizationId).first();
  return r ? toWebsite(r) : null;
}

/** The private object behind a website's screenshot (storage key and type), or null. Admin-side only. */
export async function getScreenshotRecord(db, organizationId, websiteId) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  const r = await db.prepare("SELECT screenshot_key, screenshot_name, screenshot_format, screenshot_type, screenshot_size FROM websites WHERE id = ? AND organization_id = ? AND screenshot_key IS NOT NULL").bind(websiteId, organizationId).first();
  return r ? { key: r.screenshot_key, name: r.screenshot_name, format: r.screenshot_format, contentType: r.screenshot_type, size: r.screenshot_size } : null;
}

const audit = (db, organizationId, actor, action, websiteId, at, detail) =>
  db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, ?, 'website', ?, ?, 'internal', ? WHERE changes() > 0")
    .bind(newId(), organizationId, actor.trim(), action, websiteId, detail ? JSON.stringify(detail) : null, at);

/** Add a website. Up to MAX_WEBSITES per organization (checked in the same statement). */
export async function createWebsite(db, organizationId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (!input || typeof input !== "object" || Array.isArray(input)) return fail("invalid_input");
  const c = check(input, { partial: false });
  if (c.error) return fail(c.error);
  const v = c.values, id = newId(), at = isoTime(now);
  const vals = [id, organizationId, ...FIELDS.map((k) => (v[k] === undefined ? (OMITTED[k] ?? null) : v[k])), at, at, actor.trim()];
  try {
    const res = await db.batch([
      db.prepare(`INSERT INTO websites (${INSERT_COLUMNS}) SELECT ${INSERT_PLACEHOLDERS} WHERE (SELECT count(*) FROM websites WHERE organization_id = ? AND archived_at IS NULL) < ?`).bind(...vals, organizationId, MAX_WEBSITES),
      audit(db, organizationId, actor, "website.created", id, at, { name: v.name, status: v.status }),
    ]);
    return res[0].meta.changes === 1 ? ok({ id }) : fail("too_many");
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_combination");
    throw err;
  }
}

/** Update only the given fields. A rule that links fields (an existing or live website needs an address; one in development is built by Framework) answers invalid_combination. */
export async function updateWebsite(db, organizationId, websiteId, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !FIELDS.includes(k))) return fail("invalid_input");
  const c = check(patch, { partial: true });
  if (c.error) return fail(c.error);
  const keys = Object.keys(c.values), sets = keys.map((k) => `${k} = ?`); // the keys are validated members of FIELDS; every value is bound
  if (!keys.length) return fail("invalid_input");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare(`UPDATE websites SET ${sets.join(", ")}, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL`).bind(...Object.values(c.values), at, actor.trim(), websiteId, organizationId),
      audit(db, organizationId, actor, "website.updated", websiteId, at, { fields: keys }),
    ]);
    return res[0].meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_combination");
    throw err;
  }
}

/** Archive (hide) or restore a website. Nothing is deleted: its screenshot, milestones and requests stay. */
export async function setWebsiteArchived(db, organizationId, websiteId, archived, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    archived
      ? db.prepare("UPDATE websites SET archived_at = ?, published = 0, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(at, at, actor.trim(), websiteId, organizationId)
      : db.prepare("UPDATE websites SET archived_at = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NOT NULL AND (SELECT count(*) FROM websites WHERE organization_id = ? AND archived_at IS NULL) < ?").bind(at, actor.trim(), websiteId, organizationId, organizationId, MAX_WEBSITES),
    audit(db, organizationId, actor, archived ? "website.archived" : "website.restored", websiteId, at),
  ]);
  if (res[0].meta.changes === 1) return ok();
  return (await getWebsiteAdmin(db, organizationId, websiteId)) ? ok({ unchanged: true }) : fail("not_found");
}

/** Point a website at a new screenshot object (the caller has stored it). Returns the previous key so the caller can delete that object. */
export async function setScreenshot(db, organizationId, websiteId, file, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const prev = await getScreenshotRecord(db, organizationId, websiteId);
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE websites SET screenshot_key = ?, screenshot_name = ?, screenshot_format = ?, screenshot_type = ?, screenshot_size = ?, screenshot_sha256 = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL")
      .bind(file.key, file.name, file.ext, file.contentType, file.size, file.sha256, at, actor.trim(), websiteId, organizationId),
    audit(db, organizationId, actor, "website.screenshot_set", websiteId, at),
  ]);
  return res[0].meta.changes === 1 ? ok({ previousKey: prev ? prev.key : null }) : fail("not_found");
}

/** Remove the screenshot reference. Returns the key so the caller can delete the object. */
export async function clearScreenshot(db, organizationId, websiteId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(websiteId, "website_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const prev = await getScreenshotRecord(db, organizationId, websiteId);
  if (!prev) return (await getWebsiteAdmin(db, organizationId, websiteId)) ? ok({ previousKey: null }) : fail("not_found");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE websites SET screenshot_key = NULL, screenshot_name = NULL, screenshot_format = NULL, screenshot_type = NULL, screenshot_size = NULL, screenshot_sha256 = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND screenshot_key = ?").bind(at, actor.trim(), websiteId, organizationId, prev.key),
    audit(db, organizationId, actor, "website.screenshot_removed", websiteId, at),
  ]);
  return res[0].meta.changes === 1 ? ok({ previousKey: prev.key }) : fail("conflict");
}

/** Every stored object a live website row points to (for the orphan check). */
export async function listWebsiteStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  try { return (await db.prepare("SELECT screenshot_key FROM websites WHERE organization_id = ? AND screenshot_key IS NOT NULL").bind(organizationId).all()).results.map((r) => r.screenshot_key); } catch { return []; }
}

/** Counts for the client's Admin dashboard tile, or null when the table is missing. */
export async function websiteSummary(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const r = await db.prepare("SELECT count(*) AS total, COALESCE(sum(status = 'live'), 0) AS live, COALESCE(sum(status = 'in_development'), 0) AS building, COALESCE(sum(status = 'existing'), 0) AS existing, COALESCE(sum(managed_by_framework = 1), 0) AS managed FROM websites WHERE organization_id = ? AND archived_at IS NULL").bind(organizationId).first();
    return { total: r.total, live: r.live, inDevelopment: r.building, existing: r.existing, managed: r.managed };
  } catch { return null; }
}
