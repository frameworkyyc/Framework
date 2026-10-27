/** Organizations: the tenants. These are admin-facing; a client reaches an organization only through memberships.js. */
import { newId, isoTime, requireOrgId, ok, fail, validActor, isUniqueViolation, uniqueColumns, isConstraintViolation } from "./common.js";
import { validateSlug, validateName, validateHttpsUrl, validateEnum, ORG_STATUSES } from "./validate.js";

const COLUMNS = "id, slug, name, status, website_url, revenue_client_id, created_at, updated_at, archived_at";

const validRevenueId = (raw) => (raw === undefined || raw === null || raw === "" ? null : typeof raw === "string" && raw.length <= 120 && !/[\u0000-\u001F\u007F]/.test(raw) ? raw.trim() || null : undefined);

function parseOrganizationInput(input) {
  const slug = validateSlug(input && input.slug);
  if (!slug) return fail("invalid_slug", { message: "The URL name must be 2 to 48 lower-case letters, digits and single hyphens." });
  const name = validateName(input.name);
  if (!name) return fail("invalid_name", { message: "Enter the organization's name (up to 120 characters)." });
  const websiteUrl = validateHttpsUrl(input.websiteUrl);
  if (websiteUrl === undefined) return fail("invalid_website_url", { message: "The website must be an https:// address." });
  const revenueClientId = validRevenueId(input.revenueClientId);
  if (revenueClientId === undefined) return fail("invalid_revenue_client_id");
  return ok({ slug, name, websiteUrl, revenueClientId });
}
const orgInsertError = (err) => {
  if (isUniqueViolation(err)) return fail(/revenue_client_id/.test(uniqueColumns(err)) ? "revenue_client_taken" : "slug_taken", { message: /revenue_client_id/.test(uniqueColumns(err)) ? "That client id is already used." : "That URL name is already taken. Choose another." });
  if (isConstraintViolation(err)) return fail("invalid_organization");
  throw err;
};

const bare = (r) => (r.ok ? r : { ok: false, error: r.error }); // the original, message-less error shape of createOrganization

export async function createOrganization(db, input, { now = new Date() } = {}) {
  const parsed = parseOrganizationInput(input);
  if (!parsed.ok) return bare(parsed);
  const { slug, name, websiteUrl, revenueClientId } = parsed;
  const id = newId();
  const t = isoTime(now);
  try {
    await db.prepare("INSERT INTO organizations (id, slug, name, status, website_url, revenue_client_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)").bind(id, slug, name, websiteUrl, revenueClientId, t, t).run();
  } catch (err) {
    return bare(orgInsertError(err));
  }
  return ok({ organization: await getOrganizationById(db, id) });
}

/**
 * The administrative way to create a client organization: the organization and its internal audit entry are ONE atomic batch, so there is never
 * an organization without its record of who created it, nor a record without an organization.
 */
export async function createOrganizationAudited(db, input, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const parsed = parseOrganizationInput(input);
  if (!parsed.ok) return parsed;
  const { slug, name, websiteUrl, revenueClientId } = parsed;
  const id = newId();
  const t = isoTime(now);
  try {
    await db.batch([
      db.prepare("INSERT INTO organizations (id, slug, name, status, website_url, revenue_client_id, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?, ?, ?)").bind(id, slug, name, websiteUrl, revenueClientId, t, t),
      db
        .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, id, 'admin', ?, 'org.created', 'organization', id, json_object('slug', slug), 'internal', ? FROM organizations WHERE id = ?")
        .bind(newId(), actor.trim(), t, id),
    ]);
  } catch (err) {
    return orgInsertError(err);
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

/**
 * "Delete" a client = archive it, reversibly. Nothing is removed: invoices, support requests, brand files and profile answers stay (retention), and
 * memberships are kept so a restore brings people straight back. Portal access stops because every membership lookup requires the organization to be
 * active. The audit entry is written in the same batch and only if the status really changed, so a repeated request leaves one entry.
 */
export async function archiveOrganizationAudited(db, id, actor, { now = new Date() } = {}) {
  return changeLifecycle(db, id, actor, now, { from: "active", to: "archived", action: "org.deleted" });
}

/** Bring a deleted client back (status active again). Same audit rules as deleting. */
export async function restoreOrganizationAudited(db, id, actor, { now = new Date() } = {}) {
  return changeLifecycle(db, id, actor, now, { from: "archived", to: "active", action: "org.restored" });
}

async function changeLifecycle(db, id, actor, now, { from, to, action }) {
  requireOrgId(id);
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const t = isoTime(now);
  // Deleting acts on any live client (active or suspended); restoring only on a deleted one.
  const guard = from === "active" ? "status <> 'archived'" : "status = 'archived'";
  await db.batch([
    db.prepare(`UPDATE organizations SET status = ?, archived_at = CASE WHEN ? = 'archived' THEN ? ELSE NULL END, updated_at = ? WHERE id = ? AND ${guard}`).bind(to, to, t, t, id),
    db
      .prepare(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) SELECT ?, ?, 'admin', ?, ?, 'organization', ?, 'internal', ? WHERE changes() > 0`)
      .bind(newId(), id, actor.trim(), action, id, t),
  ]);
  const organization = await getOrganizationById(db, id);
  if (!organization) return fail("not_found");
  return ok({ organization, changed: organization.status === to && organization.updated_at === t });
}
