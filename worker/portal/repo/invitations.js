/**
 * Invitations: the only way to gain access to an organization. Admin-issued.
 *
 * Invariants (enforced here AND by database constraints):
 *  - An invitation grants access only while it is `pending` and unexpired (expires_at strictly in the future).
 *  - Accepting is a claim: the first successful acceptance flips pending -> accepted. An accepted, revoked or expired
 *    invitation can never grant anything again, so a reused invitation cannot re-grant a membership an admin later revoked.
 *  - Acceptance is one atomic D1 batch (a single transaction): membership + invitation status + audit entry all happen or none do.
 *  - Acceptance is idempotent: running it again changes nothing.
 *  - The signed-in WorkOS email must be VERIFIED and must equal the invited address (compared lower-cased and exact).
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, isUniqueViolation, isConstraintViolation } from "./common.js";
import { normalizeEmail, validateEnum, ROLES } from "./validate.js";

const COLUMNS = "id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at, accepted_at, accepted_user_id, revoked_at, revoked_by";
export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 30;

const validActor = (actor) => typeof actor === "string" && actor.trim().length >= 1 && actor.length <= 254 && !/[\u0000-\u001F\u007F]/.test(actor);

/**
 * Create a pending invitation. Any earlier pending invitation for the same organization and email that has already expired
 * is closed first (in the same batch), so an expired invitation never blocks a fresh one. A still-valid pending
 * invitation is not replaced: the caller gets `already_pending` and can revoke or resend it.
 */
export async function createInvitation(db, organizationId, { email, role, createdBy, expiresInDays = DEFAULT_EXPIRY_DAYS, workosInvitationId = null } = {}, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const normalized = normalizeEmail(email);
  if (!normalized) return fail("invalid_email");
  if (!validateEnum(role, ROLES)) return fail("invalid_role");
  if (!validActor(createdBy)) return fail("invalid_actor");
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS) return fail("invalid_expiry");
  if (workosInvitationId !== null && !(typeof workosInvitationId === "string" && /^[A-Za-z0-9_.-]{5,128}$/.test(workosInvitationId))) return fail("invalid_workos_invitation_id");
  const created = isoTime(now);
  const expires = isoTime(new Date(now.getTime() + expiresInDays * 86400000));
  const id = newId();
  try {
    await db.batch([
      db.prepare("UPDATE invitations SET status = 'expired' WHERE organization_id = ? AND email = ? AND status = 'pending' AND expires_at <= ?").bind(organizationId, normalized, created),
      db.prepare("INSERT INTO invitations (id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)").bind(id, organizationId, normalized, role, workosInvitationId, created, createdBy.trim(), expires),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return fail(/workos_invitation_id/.test(String(err.message)) ? "workos_invitation_taken" : "already_pending");
    if (isConstraintViolation(err)) return fail("invalid_organization");
    throw err;
  }
  return ok({ invitation: await getInvitation(db, organizationId, id) });
}

/** Record the WorkOS invitation id after the WorkOS call succeeded (only while still pending). */
export async function attachWorkosInvitationId(db, organizationId, id, workosInvitationId) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!(typeof workosInvitationId === "string" && /^[A-Za-z0-9_.-]{5,128}$/.test(workosInvitationId))) return fail("invalid_workos_invitation_id");
  try {
    const res = await db.prepare("UPDATE invitations SET workos_invitation_id = ? WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(workosInvitationId, id, organizationId).run();
    return res.meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("workos_invitation_taken");
    throw err;
  }
}

export async function getInvitation(db, organizationId, id) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  return (await db.prepare(`SELECT ${COLUMNS} FROM invitations WHERE id = ? AND organization_id = ?`).bind(id, organizationId).first()) || null;
}

export async function listInvitations(db, organizationId, { status } = {}) {
  requireOrgId(organizationId);
  if (status !== undefined && !validateEnum(status, ["pending", "accepted", "revoked", "expired"])) return [];
  const stmt = db.prepare(`SELECT ${COLUMNS} FROM invitations WHERE organization_id = ? ${status ? "AND status = ?" : ""} ORDER BY created_at DESC, id`);
  return (await (status ? stmt.bind(organizationId, status) : stmt.bind(organizationId)).all()).results;
}

/** Revoke a still-pending invitation. Accepted, expired or already-revoked invitations are left alone. */
export async function revokeInvitation(db, organizationId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const res = await db.prepare("UPDATE invitations SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(isoTime(now), actor.trim(), id, organizationId).run();
  return res.meta.changes === 1 ? ok() : fail("not_found");
}

/** Housekeeping across all organizations: close pending invitations whose time has passed. Idempotent. */
export async function expireStaleInvitations(db, { now = new Date() } = {}) {
  const res = await db
    .prepare("UPDATE invitations SET status = 'expired' WHERE status = 'pending' AND expires_at <= ? /* cross-tenant: housekeeping that closes expired invitations for every organization */")
    .bind(isoTime(now))
    .run();
  return res.meta.changes;
}

/**
 * Called after a successful, verified WorkOS sign-in. Activates every still-valid pending invitation addressed to this user's
 * verified email, atomically, and reports which organizations were activated.
 *
 * Per invitation the batch does three things, each guarded by "this invitation is still pending, unexpired and for this email":
 *   1. insert (or reactivate) the membership,   2. write the audit entry,   3. mark the invitation accepted (the claim, last).
 * Because the guard is evaluated against the database inside one transaction, a second concurrent or repeated call finds
 * nothing pending and changes nothing. An already ACTIVE membership keeps its current role (a re-invite never silently
 * downgrades an owner); only a REVOKED membership is reactivated, with the newly invited role.
 *
 * @param user the portal_users row from upsertUserFromIdentity
 * @param emailVerified must be exactly true (WorkOS email_verified)
 */
export async function activatePendingInvitations(db, { user, emailVerified } = {}, { now = new Date() } = {}) {
  if (emailVerified !== true) return fail("email_not_verified");
  if (!user || typeof user !== "object") return fail("invalid_user");
  requireId(user.id, "user_id");
  if (user.status !== "active") return fail("user_disabled");
  const email = normalizeEmail(user.email);
  if (!email) return fail("invalid_email");
  const t = isoTime(now);

  const { results: pending } = await db
    .prepare("SELECT id, organization_id FROM invitations WHERE email = ? AND status = 'pending' AND expires_at > ? ORDER BY created_at, id /* cross-tenant: finds the invitations addressed to the signed-in user's own verified email */")
    .bind(email, t)
    .all();
  if (!pending.length) return ok({ activated: [] });

  const statements = [];
  for (const inv of pending) {
    // Every statement is guarded by "this invitation is STILL pending, unexpired and for this email", and the claim
    // (pending -> accepted) is deliberately LAST. Inside one transaction all three see the same pending row; in any later or
    // concurrent batch the row is already accepted, so none of them does anything. That is what makes this idempotent and
    // keeps the audit entry tied to the one batch that actually claimed the invitation.
    const guard = "i.id = ? AND i.status = 'pending' AND i.expires_at > ? AND i.email = ?";
    statements.push(
      db
        .prepare(
          `INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by)
           SELECT ?, i.organization_id, ?, i.role, 'active', ?, i.created_by FROM invitations i WHERE ${guard}
           ON CONFLICT (organization_id, user_id) DO UPDATE SET
             role = CASE WHEN memberships.status = 'revoked' THEN excluded.role ELSE memberships.role END,
             status = 'active', revoked_at = NULL, revoked_by = NULL`,
        )
        .bind(newId(), user.id, t, inv.id, t, email),
      db
        .prepare(
          `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
           SELECT ?, i.organization_id, 'client', ?, 'invitation.accepted', 'invitation', i.id, 'internal', ? FROM invitations i WHERE ${guard}`,
        )
        .bind(newId(), user.id, t, inv.id, t, email),
      db
        .prepare("UPDATE invitations SET status = 'accepted', accepted_at = ?, accepted_user_id = ? WHERE id = ? AND organization_id = ? AND status = 'pending' AND expires_at > ? AND email = ?")
        .bind(t, user.id, inv.id, inv.organization_id, t, email),
    );
  }
  const results = await db.batch(statements);
  const activated = [];
  pending.forEach((inv, i) => {
    // the third statement of each trio is the claim; it changes a row only if this batch won the invitation
    if (results[i * 3 + 2].meta.changes === 1) activated.push({ organizationId: inv.organization_id, invitationId: inv.id });
  });
  return ok({ activated });
}
