/** Memberships: which user may see which organization, and as what. The ONLY way a client reaches an organization. */
import { newId, isoTime, requireOrgId, requireUserId, ok, fail, validActor } from "./common.js";
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

/**
 * Access changes below are each ONE atomic D1 batch (a single transaction): the audit entry is written FIRST, guarded by exactly the same
 * conditions as the change itself, and the change follows. So an entry exists if and only if the change happened, a repeated call changes
 * nothing and writes nothing, and no entry can be left behind by a refused change.
 *
 * LAST-OWNER RULE (enforced in the SQL, not in the caller): an active owner can only be demoted or removed while ANOTHER active owner remains,
 * meaning another owner whose membership is active and whose portal user is active. The check and the change are one statement, so two
 * simultaneous removals can never both succeed: whichever runs second sees the first one's result and is refused.
 * (Emergency offboarding of a whole user, offboardUser, is deliberately outside this rule: it must always be able to cut access.)
 *
 * Errors are structured: { ok:false, error: <code>, message: <plain sentence> }. Codes: invalid_actor, invalid_role, not_found,
 * already_revoked, not_revoked, last_owner.
 */
const OTHER_ACTIVE_OWNER =
  "EXISTS (SELECT 1 FROM memberships o JOIN portal_users ou ON ou.id = o.user_id WHERE o.organization_id = ? AND o.user_id <> ? AND o.role = 'owner' AND o.status = 'active' AND ou.status = 'active')";
const LAST_OWNER_MESSAGE = "This is the organization's last active owner. Make someone else an owner first.";

async function whyRefused(db, organizationId, userId, wanted) {
  const m = await getMembership(db, organizationId, userId);
  if (!m) return fail("not_found", { message: "No such member in this organization." });
  if (wanted === "revoke" && m.status === "revoked") return fail("already_revoked", { message: "This member's access was already removed." });
  if (wanted === "restore" && m.status === "active") return fail("not_revoked", { message: "This member already has access." });
  if (wanted === "role" && m.status === "revoked") return fail("not_found", { message: "This member no longer has access." });
  if (m.role === "owner" && m.status === "active") return fail("last_owner", { message: LAST_OWNER_MESSAGE });
  return fail("not_found", { message: "No such member in this organization." });
}

/**
 * Change an active member's role. Promotion is always allowed; demoting an owner needs another active owner (see the rule above).
 * Setting the role a member already has is a no-op ({ ok:true, changed:false }).
 */
export async function setMemberRole(db, organizationId, userId, role, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (!validateEnum(role, ROLES)) return fail("invalid_role", { message: "The role must be owner or member." });
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const t = isoTime(now), by = actor.trim();
  const cond = `status = 'active' AND role <> ? AND (? = 'owner' OR role <> 'owner' OR ${OTHER_ACTIVE_OWNER})`;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
         SELECT ?, organization_id, 'admin', ?, 'membership.role_changed', 'membership', id, json_object('user_id', user_id, 'from', role, 'to', ?), 'internal', ?
           FROM memberships WHERE organization_id = ? AND user_id = ? AND ${cond}`,
      )
      .bind(newId(), by, role, t, organizationId, userId, role, role, organizationId, userId),
    db.prepare(`UPDATE memberships SET role = ? WHERE organization_id = ? AND user_id = ? AND ${cond}`).bind(role, organizationId, userId, role, role, organizationId, userId),
  ]);
  if (results[1].meta.changes === 1) return ok({ changed: true });
  const m = await getMembership(db, organizationId, userId);
  if (m && m.status === "active" && m.role === role) return ok({ changed: false });
  return whyRefused(db, organizationId, userId, "role");
}

/** Remove a member's access (the membership is kept, marked revoked; nothing the organization owns is touched). Refuses to remove the last active owner. */
export async function revokeMembership(db, organizationId, userId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const t = isoTime(now), by = actor.trim();
  const cond = `status = 'active' AND (role <> 'owner' OR ${OTHER_ACTIVE_OWNER})`;
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
         SELECT ?, organization_id, 'admin', ?, 'membership.revoked', 'membership', id, json_object('user_id', user_id, 'role', role), 'internal', ?
           FROM memberships WHERE organization_id = ? AND user_id = ? AND ${cond}`,
      )
      .bind(newId(), by, t, organizationId, userId, organizationId, userId),
    db.prepare(`UPDATE memberships SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE organization_id = ? AND user_id = ? AND ${cond}`).bind(t, by, organizationId, userId, organizationId, userId),
  ]);
  if (results[1].meta.changes === 1) return ok({ changed: true });
  return whyRefused(db, organizationId, userId, "revoke");
}

/** Re-enable a revoked membership (an admin decision; an old invitation can never do this). */
export async function restoreMembership(db, organizationId, userId, { role, actor, now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireUserId(userId);
  if (role !== undefined && !validateEnum(role, ROLES)) return fail("invalid_role", { message: "The role must be owner or member." });
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const t = isoTime(now), by = actor.trim();
  const cond = "status = 'revoked'";
  const results = await db.batch([
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
         SELECT ?, organization_id, 'admin', ?, 'membership.restored', 'membership', id, json_object('user_id', user_id, 'role', COALESCE(?, role)), 'internal', ?
           FROM memberships WHERE organization_id = ? AND user_id = ? AND ${cond}`,
      )
      .bind(newId(), by, role ?? null, t, organizationId, userId),
    db
      .prepare(`UPDATE memberships SET status = 'active', revoked_at = NULL, revoked_by = NULL, role = COALESCE(?, role) WHERE organization_id = ? AND user_id = ? AND ${cond}`)
      .bind(role ?? null, organizationId, userId),
  ]);
  if (results[1].meta.changes === 1) return ok({ changed: true });
  return whyRefused(db, organizationId, userId, "restore");
}
