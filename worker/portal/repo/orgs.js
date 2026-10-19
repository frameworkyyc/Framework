/** Organizations: the tenants. These are admin-facing; a client reaches an organization only through memberships.js. */
import { newId, isoTime, requireOrgId, ok, fail, isUniqueViolation, uniqueColumns, isConstraintViolation } from "./common.js";
import { validateSlug, validateName, validateHttpsUrl, validateEnum, ORG_STATUSES } from "./validate.js";

const COLUMNS = "id, slug, name, status, website_url, revenue_client_id, created_at, updated_at, archived_at";

const validRevenueId = (raw) => (raw === undefined || raw === null || raw === "" ? null : typeof raw === "string" && raw.length <= 120 && !/[\u0000-\u001F\u007F]/.test(raw) ? raw.trim() || null : undefined);

export async function createOrganization(db, input, { now = new Date() } = {}) {
  const slug = validateSlug(input && input.slug);
  if (!slug) return fail("invalid_slug");
  const name = validateName(input.name);
  if (!name) return fail("invalid_name");
  const websiteUrl = validateHttpsUrl(input.websiteUrl);
  if (websiteUrl === undefined) return fail("invalid_website_url");
  const revenueClientId = validRevenueId(input.revenueClientId);
  if (revenueClientId === undefined) return fail("invalid_revenue_client_id");
  const id = newId();
  const t = isoTime(now);
  try {
    await db.prepare("INSERT INTO organizations (id, slug, name, status, website_url, revenue_client_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)").bind(id, slug, name, websiteUrl, revenueClientId, t, t).run();
  } catch (err) {
    if (isUniqueViolation(err)) return fail(/revenue_client_id/.test(uniqueColumns(err)) ? "revenue_client_taken" : "slug_taken");
    if (isConstraintViolation(err)) return fail("invalid_organization");
    throw err;
  }
  return ok({ organization: await getOrganizationById(db, id) });
}

export async function getOrganizationById(db, id) {
  requireOrgId(id);
  return (await db.prepare(`SELECT ${COLUMNS} FROM organizations WHERE id = ?`).bind(id).first()) || null;
}

/** Admin use only: slug -> organization. Clients resolve a slug through getActiveMembership, which also requires THEIR membership. */
export async function getOrganizationBySlug(db, slug) {
  if (!validateSlug(slug)) return null;
  return (await db.prepare(`SELECT ${COLUMNS} FROM organizations WHERE slug = ?`).bind(slug).first()) || null;
}

export async function listOrganizations(db, { status } = {}) {
  if (status !== undefined && !validateEnum(status, ORG_STATUSES)) return [];
  const sql = `SELECT ${COLUMNS} FROM organizations ${status ? "WHERE status = ?" : ""} ORDER BY name COLLATE NOCASE, id`;
  const stmt = db.prepare(sql);
  return (await (status ? stmt.bind(status) : stmt).all()).results;
}

/** Partial update of name, websiteUrl and revenueClientId (pass only what changes). */
export async function updateOrganization(db, id, patch, { now = new Date() } = {}) {
  requireOrgId(id);
  const sets = [];
  const values = [];
  if (patch && "name" in patch) {
    const name = validateName(patch.name);
    if (!name) return fail("invalid_name");
    sets.push("name = ?");
    values.push(name);
  }
  if (patch && "websiteUrl" in patch) {
    const url = validateHttpsUrl(patch.websiteUrl);
    if (url === undefined) return fail("invalid_website_url");
    sets.push("website_url = ?");
    values.push(url);
  }
  if (patch && "revenueClientId" in patch) {
    const rid = validRevenueId(patch.revenueClientId);
    if (rid === undefined) return fail("invalid_revenue_client_id");
    sets.push("revenue_client_id = ?");
    values.push(rid);
  }
  if (!sets.length) return fail("nothing_to_update");
  sets.push("updated_at = ?");
  values.push(isoTime(now), id);
  try {
    const res = await db.prepare(`UPDATE organizations SET ${sets.join(", ")} WHERE id = ?`).bind(...values).run();
    return res.meta.changes === 1 ? ok({ organization: await getOrganizationById(db, id) }) : fail("not_found");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("revenue_client_taken");
    throw err;
  }
}

/** active / suspended / archived. Archiving stamps archived_at (and clears it again when restored). */
export async function setOrganizationStatus(db, id, status, { now = new Date() } = {}) {
  requireOrgId(id);
  if (!validateEnum(status, ORG_STATUSES)) return fail("invalid_status");
  const t = isoTime(now);
  const res = await db.prepare("UPDATE organizations SET status = ?, archived_at = CASE WHEN ? = 'archived' THEN ? ELSE NULL END, updated_at = ? WHERE id = ?").bind(status, status, t, t, id).run();
  return res.meta.changes === 1 ? ok({ organization: await getOrganizationById(db, id) }) : fail("not_found");
}
