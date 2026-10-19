/**
 * Emergency offboarding and re-enabling of a portal user (data layer). Each operation is ONE atomic D1 batch (a single transaction), and every
 * statement is idempotent, so running it twice changes nothing more and writes no duplicate audit entries.
 *
 * Offboarding (in this order, most urgent first): disable the user; revoke every unrevoked session; revoke every active membership; revoke the
 * pending invitations addressed to the user's email (so access cannot silently come back); then write internal audit entries (one for the user
 * and one per organization they were removed from). Audit entries are inserted AFTER the state change and only when none exists yet for that
 * change, which is what makes an interrupted run safe to repeat.
 *
 * Re-enabling revokes any session that survived the disable, re-activates the user and records an audit entry. It NEVER restores a membership
 * or an invitation: access to an organization must be granted again on purpose.
 *
 * The same statements exist as plain SQL in migrations/portal-ops/ (what an administrator runs by hand); a test keeps the two equivalent.
 * Every statement is scoped to ONE user id.
 */
import { newId, isoTime, requireUserId, ok, fail } from "./common.js";

const ACTOR = /^[A-Za-z0-9._@:-]{1,100}$/;

export async function offboardUser(db, userId, { actor, now = new Date() } = {}) {
  requireUserId(userId);
  if (typeof actor !== "string" || !ACTOR.test(actor)) return fail("invalid_actor");
  const t = isoTime(now);
  const by = "offboard:" + actor;
  const results = await db.batch([
    db.prepare("UPDATE portal_users SET status = 'disabled', disabled_at = COALESCE(disabled_at, ?) WHERE id = ?").bind(t, userId),
    db.prepare("UPDATE portal_sessions SET revoked_at = ?, revoked_reason = 'user_offboarded' WHERE user_id = ? AND revoked_at IS NULL").bind(t, userId),
    db
      .prepare("UPDATE memberships SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE user_id = ? AND status = 'active' /* cross-tenant: revokes every active membership of one offboarded user */")
      .bind(t, by, userId),
    db
      .prepare(
        "UPDATE invitations SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE status = 'pending' AND email = (SELECT email FROM portal_users WHERE id = ?) /* cross-tenant: revokes the pending invitations addressed to one offboarded user's email */",
      )
      .bind(t, by, userId),
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
         SELECT ?, NULL, 'admin', ?, 'user.offboarded', 'user', u.id, 'internal', ? FROM portal_users u
          WHERE u.id = ? AND u.status = 'disabled'
            AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id IS NULL AND a.action = 'user.offboarded' AND a.entity_id = u.id AND a.created_at >= u.disabled_at)`,
      )
      .bind(newId(), actor, t, userId),
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
         SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
                m.organization_id, 'admin', ?, 'member.offboarded', 'user', m.user_id, 'internal', ?
           FROM memberships m
          WHERE m.user_id = ? AND m.status = 'revoked' AND m.revoked_by = ?
            AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = m.organization_id AND a.action = 'member.offboarded' AND a.entity_id = m.user_id AND a.created_at >= m.revoked_at)`,
      )
      .bind(actor, t, userId, by),
  ]);
  if (results[0].meta.changes !== 1) return fail("not_found");
  return ok({ sessionsRevoked: results[1].meta.changes, membershipsRevoked: results[2].meta.changes, invitationsRevoked: results[3].meta.changes, auditEntries: results[4].meta.changes + results[5].meta.changes });
}

export async function reenableUser(db, userId, { actor, now = new Date() } = {}) {
  requireUserId(userId);
  if (typeof actor !== "string" || !ACTOR.test(actor)) return fail("invalid_actor");
  const t = isoTime(now);
  const results = await db.batch([
    db
      .prepare("UPDATE portal_sessions SET revoked_at = ?, revoked_reason = 'user_reenabled' WHERE user_id = ? AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM portal_users WHERE id = ? AND status = 'disabled')")
      .bind(t, userId, userId),
    db.prepare("UPDATE portal_users SET status = 'active', disabled_at = NULL WHERE id = ?").bind(userId),
    db
      .prepare(
        `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
         SELECT ?, NULL, 'admin', ?, 'user.reenabled', 'user', u.id, 'internal', ? FROM portal_users u
          WHERE u.id = ? AND u.status = 'active'
            AND EXISTS (SELECT 1 FROM activity_log b WHERE b.organization_id IS NULL AND b.action = 'user.offboarded' AND b.entity_id = u.id)
            AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id IS NULL AND a.action = 'user.reenabled' AND a.entity_id = u.id
                              AND a.created_at >= (SELECT max(b.created_at) FROM activity_log b WHERE b.organization_id IS NULL AND b.action = 'user.offboarded' AND b.entity_id = u.id))`,
      )
      .bind(newId(), actor, t, userId),
  ]);
  if (results[1].meta.changes !== 1) return fail("not_found");
  return ok({ sessionsRevoked: results[0].meta.changes, auditEntries: results[2].meta.changes });
}
