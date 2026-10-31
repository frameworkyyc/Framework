/**
 * Master Client Access (migration 0013, table portal_staff): which Framework staff may open ANY client's Client Portal without being a member of it.
 *
 * Rules:
 *  - The ONLY grant is a row in portal_staff. Not an email in a request, a URL parameter, a cookie, a client-side flag, or Admin Portal membership.
 *  - A grant starts as a lower-case EMAIL. The person who signs in through WorkOS with that exact, VERIFIED address is bound to it at their first sign-in (user_id = their portal user id,
 *    once). From then on access is decided by user_id, an immutable id: changing an email can neither take nor lose access, and an unbound grant gives nobody anything.
 *  - Every request re-reads the table (guard.js), so a revoked person loses access on the next request. A missing table (a database without migration 0013) means "nobody is staff".
 *  - Master access NEVER creates a membership: staff are never in any client's team list, and nothing here sends an invitation.
 * These queries are intentionally cross-tenant (staff see every client); each carries a `cross-tenant:` reason.
 */
import { newId, isoTime, requireUserId, ok, fail, validActor } from "./common.js";
import { normalizeEmail, validateSlug } from "./validate.js";

const missingTable = (err) => /no such table|no such column/i.test(String(err && err.message));
export const STAFF_ROLES = Object.freeze(["master"]);
const toStaff = (r) => ({ id: r.id, email: r.email, userId: r.user_id, role: r.role, grantedBy: r.granted_by, grantedAt: r.granted_at, boundAt: r.bound_at, revokedAt: r.revoked_at, revokedBy: r.revoked_by });

/** The signed-in user's master-access grant, or null. Bound to THEIR portal user id, not to any email; revoked or unbound grants never match. */
export async function getStaffAccess(db, userId) {
  requireUserId(userId);
  try {
    const r = await db.prepare("SELECT id, email, user_id, role, granted_by, granted_at, bound_at, revoked_at, revoked_by FROM portal_staff WHERE user_id = ? AND revoked_at IS NULL /* cross-tenant: looks up the signed-in user's OWN master-access grant by their portal user id */").bind(userId).first();
    return r ? toStaff(r) : null;
  } catch (err) { if (missingTable(err)) return null; throw err; }
}

/**
 * Called at sign-in with the VERIFIED identity (claims.js refuses unverified emails before this is reached). Binds a pending grant for exactly this email to this user, once: the
 * UPDATE only matches a grant that is unbound and not revoked, so it can never move a grant from one person to another. Returns { bound: true } only when it just did.
 */
export async function bindStaffUser(db, user, { now = new Date() } = {}) {
  if (!user || typeof user.id !== "string") return ok({ bound: false });
  const email = normalizeEmail(user.email);
  if (!email || user.status !== "active") return ok({ bound: false });
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare("UPDATE portal_staff SET user_id = ?, bound_at = ? WHERE email = ? AND user_id IS NULL AND revoked_at IS NULL AND NOT EXISTS (SELECT 1 FROM portal_staff s WHERE s.user_id = ?) /* cross-tenant: binds a pending master-access grant to the user who just signed in with its exact verified email */").bind(user.id, at, email, user.id),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) SELECT ?, NULL, 'system', ?, 'staff.access.bound', 'portal_staff', ?, 'internal', ? WHERE changes() > 0")
        .bind(newId(), user.id, JSON.stringify({ role: "master" }), at),
    ]);
    return ok({ bound: res[0].meta.changes === 1 });
  } catch (err) { if (missingTable(err)) return ok({ bound: false }); throw err; }
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Every ACTIVE client organization, for the master directory. `q` filters by name or address (a plain text search; wildcards in it are literal). */
export async function listOrganizationsForStaff(db, { q = "", limit = 200 } = {}) {
  const term = typeof q === "string" ? q.trim().slice(0, 80) : "";
  const like = `%${escapeLike(term)}%`;
  const { results } = await db.prepare(
    `SELECT id, slug, name, website_url FROM organizations WHERE status = 'active' AND (? = '' OR name LIKE ? ESCAPE '\\' OR slug LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE, id LIMIT ?
     /* cross-tenant: the master directory lists every active client organization for Framework staff with master access */`,
  ).bind(term, like, like, Math.min(Math.max(1, limit), 500)).all();
  return results.map((r) => ({ organizationId: r.id, slug: r.slug, name: r.name, websiteUrl: r.website_url }));
}

/** One ACTIVE organization by slug for a verified staff member, shaped like a membership (without a real one). null when there is none (the caller answers the same plain 404). */
export async function getOrganizationForStaff(db, slug) {
  if (!validateSlug(slug)) return null;
  const r = await db.prepare("SELECT id, slug, name, website_url FROM organizations WHERE slug = ? AND status = 'active' /* cross-tenant: resolves one active client organization by slug for a verified staff member */").bind(slug).first();
  return r ? { organizationId: r.id, slug: r.slug, name: r.name, websiteUrl: r.website_url } : null;
}

/** The portal user ids of everyone who currently holds (or held) master access, so a conversation can label what staff wrote as Framework's. Empty without the table. */
export async function staffUserIds(db) {
  try {
    const { results } = await db.prepare("SELECT user_id FROM portal_staff WHERE user_id IS NOT NULL /* cross-tenant: which portal users are Framework staff, to label their messages as Framework's */").all();
    return new Set(results.map((r) => r.user_id));
  } catch (err) { if (missingTable(err)) return new Set(); throw err; }
}

/* ------------------------------------------------------------------ Admin: grant, revoke, list (behind Cloudflare Access and ADMIN_EMAILS; see admin-staff.js) */

export async function listStaff(db) {
  try {
    const { results } = await db.prepare("SELECT id, email, user_id, role, granted_by, granted_at, bound_at, revoked_at, revoked_by FROM portal_staff ORDER BY granted_at, email /* cross-tenant: Framework Admin lists who holds master access */").all();
    return { available: true, staff: results.map(toStaff) };
  } catch (err) { if (missingTable(err)) return { available: false, staff: [] }; throw err; }
}

/** Grant master access to an email (it binds at that person's first verified sign-in), or reinstate a revoked grant (its binding is kept: the same person, the same user id). */
export async function grantStaff(db, emailRaw, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  const email = normalizeEmail(emailRaw);
  if (!email) return fail("invalid_email");
  const at = isoTime(now), by = actor.trim();
  const cur = await db.prepare("SELECT id, revoked_at FROM portal_staff WHERE email = ? /* cross-tenant: Framework Admin looks up a master-access grant by email */").bind(email).first();
  if (cur && !cur.revoked_at) return ok({ unchanged: true });
  const id = cur ? cur.id : newId();
  await db.batch([
    cur
      ? db.prepare("UPDATE portal_staff SET revoked_at = NULL, revoked_by = NULL, granted_by = ?, granted_at = ? WHERE id = ? AND revoked_at IS NOT NULL /* cross-tenant: reinstates a revoked master-access grant */").bind(by, at, id)
      : db.prepare("INSERT INTO portal_staff (id, email, user_id, role, granted_by, granted_at) VALUES (?, ?, NULL, 'master', ?, ?)").bind(id, email, by, at),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'staff.access.granted', 'portal_staff', ?, ?, 'internal', ? WHERE changes() > 0")
      .bind(newId(), by, id, JSON.stringify({ role: "master", reinstated: Boolean(cur) }), at),
  ]);
  return ok({ id });
}

/** Revoke a grant. The very next portal request of that person finds no grant. Nothing is deleted; the row keeps who revoked it and when. */
export async function revokeStaff(db, emailRaw, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  const email = normalizeEmail(emailRaw);
  if (!email) return fail("invalid_email");
  const at = isoTime(now), by = actor.trim();
  const res = await db.batch([
    db.prepare("UPDATE portal_staff SET revoked_at = ?, revoked_by = ? WHERE email = ? AND revoked_at IS NULL /* cross-tenant: Framework Admin revokes a master-access grant */").bind(at, by, email),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'staff.access.revoked', 'portal_staff', ?, 'internal', ? WHERE changes() > 0")
      .bind(newId(), by, JSON.stringify({ role: "master" }), at),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/** An internal audit entry for something a staff member did inside a client's portal. Never client-visible; names the staff user id and the client, never content. */
export async function recordStaffActivity(db, { organizationId, userId, action, detail = null }, { now = new Date() } = {}) {
  await db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, 'staff_access', ?, 'internal', ?)")
    .bind(newId(), organizationId, `staff:${userId}`, action, detail ? JSON.stringify(detail) : null, isoTime(now)).run();
}

/** The minutes within which further page views of the same client by the same staff member are one visit (one "opened" entry), however they arrived (home, a deep link, a bookmark). */
export const VISIT_WINDOW_MINUTES = 30;

/** Records a visit ("staff.portal.opened") unless this staff member already has one for this client inside the visit window. One conditional INSERT, so concurrent page loads add at most one. */
export async function recordStaffVisit(db, { organizationId, userId, detail = null }, { now = new Date() } = {}) {
  const at = isoTime(now), since = isoTime(new Date(now.getTime() - VISIT_WINDOW_MINUTES * 60000)), ref = `staff:${userId}`;
  const res = await db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'staff.portal.opened', 'staff_access', ?, 'internal', ? WHERE NOT EXISTS (SELECT 1 FROM activity_log WHERE organization_id = ? AND actor_ref = ? AND action = 'staff.portal.opened' AND created_at > ?)")
    .bind(newId(), organizationId, ref, detail ? JSON.stringify(detail) : null, at, organizationId, ref, since).run();
  return res.meta.changes === 1;
}
