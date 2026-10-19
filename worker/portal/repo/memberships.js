/** Memberships: which user may see which organization, and as what. The ONLY way a client reaches an organization. */
import { isoTime, requireOrgId, requireUserId, ok, fail } from "./common.js";
import { validateSlug, validateEnum, ROLES } from "./validate.js";

/**
 * Resolve an organization slug for a signed-in user THROUGH their own active membership. Returns null for an unknown slug, a
 * slug the user does not belong to, a revoked membership, or a suspended/archived organization. All of those look identical
 * to the caller, so a response can never reveal that an organization exists.
 */
export async function getActiveMembership(db, userId, slug) {
  requireUserId(userId);
  if (!validateSlug(slug)) return null;
  const row = await db
    .prepare(
      `SELECT o.id AS organization_id, o.slug, o.name, o.website_url, m.role
         FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND o.slug = ? AND m.status = 'active' AND o.status = 'active'
        /* cross-tenant: resolves one organization for the signed-in user through THEIR OWN membership */`,
    )
    .bind(userId, slug)
    .first();
  return row ? { organizationId: row.organization_id, slug: row.slug, name: row.name, websiteUrl: row.website_url, role: row.role } : null;
}

/** Every organization the user can currently open (active membership in an active organization). Drives the organization picker. */
export async function listActiveMembershipsForUser(db, userId) {
  requireUserId(userId);
  const { results } = await db
    .prepare(
      `SELECT o.id AS organization_id, o.slug, o.name, m.role
         FROM memberships m JOIN organizations o ON o.id = m.organization_id
        WHERE m.user_id = ? AND m.status = 'active' AND o.status = 'active'
        ORDER BY o.name COLLATE NOCASE, o.id
        /* cross-tenant: lists the signed-in user's OWN memberships for the organization picker */`,
    )
    .bind(userId)
    .all();
  return results.map((r) => ({ organizationId: r.organization_id, slug: r.slug, name: r.name, role: r.role }));
}

/** Admin view of one organization's members (any status). */
export async function listMembers(db, organizationId) {
  requireOrgId(organizationId);
  const { results } = await db
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, u.status AS user_status, m.role, m.status, m.created_at, m.created_by, m.revoked_at, m.revoked_by
         FROM memberships m JOIN portal_users u ON u.id = m.user_id
        WHERE m.organization_id = ? ORDER BY m.created_at, u.email`,
    )
    .bind(organizationId)
    .all();
  return results;
}

export async function getMembership(db, organizationId, userId) {
  requireOrgId(organizationId);
  requireUserId(userId);
  return (await db.prepare("SELECT id, organization_id, user_id, role, status, created_at, created_by, revoked_at, revoked_by FROM memberships WHERE organization_id = ? AND user_id = ?").bind(organizationId, userId).first()) || null;
}

export async function setMemberRole(db, organizationId, userId, role) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (!validateEnum(role, ROLES)) return fail("invalid_role");
  const res = await db.prepare("UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(role, organizationId, userId).run();
  return res.meta.changes === 1 ? ok() : fail("not_found");
}

export async function revokeMembership(db, organizationId, userId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (typeof actor !== "string" || !actor.trim() || actor.length > 254) return fail("invalid_actor");
  const res = await db.prepare("UPDATE memberships SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE organization_id = ? AND user_id = ? AND status = 'active'").bind(isoTime(now), actor.trim(), organizationId, userId).run();
  return res.meta.changes === 1 ? ok() : fail("not_found");
}

/** Re-enable a revoked membership (an admin decision; an old invitation can never do this). */
export async function restoreMembership(db, organizationId, userId, { role } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (role !== undefined && !validateEnum(role, ROLES)) return fail("invalid_role");
  const res = await db
    .prepare("UPDATE memberships SET status = 'active', revoked_at = NULL, revoked_by = NULL, role = COALESCE(?, role) WHERE organization_id = ? AND user_id = ? AND status = 'revoked'")
    .bind(role ?? null, organizationId, userId)
    .run();
  return res.meta.changes === 1 ? ok() : fail("not_found");
}

