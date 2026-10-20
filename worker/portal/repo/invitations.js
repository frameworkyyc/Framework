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
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor, isUniqueViolation, isConstraintViolation } from "./common.js";
import { normalizeEmail, validateEnum, ROLES } from "./validate.js";

const COLUMNS = "id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at, accepted_at, accepted_user_id, revoked_at, revoked_by";
export const DEFAULT_EXPIRY_DAYS = 7;
export const MAX_EXPIRY_DAYS = 30;

const ACTIVE_MEMBER = "EXISTS (SELECT 1 FROM memberships m JOIN portal_users mu ON mu.id = m.user_id WHERE m.organization_id = ? AND mu.email = ? AND m.status = 'active')";
/** The same test for the replace statement, where the organization and email come from the old invitation row `i`. */
const ACTIVE_MEMBER_OF_OLD = "EXISTS (SELECT 1 FROM memberships m JOIN portal_users mu ON mu.id = m.user_id WHERE m.organization_id = i.organization_id AND mu.email = i.email AND m.status = 'active')";

/**
 * Administrative invitation operations. Each one is ONE atomic D1 batch. Audit entries are written in the same batch, guarded by the same
 * conditions as the change, so an entry exists if and only if the change happened and a repeated call writes nothing. Audit `detail` never
 * contains email addresses (the invitation row holds those); it carries ids, roles and statuses only.
 *
 * Errors are structured: { ok:false, error: <code>, message: <plain sentence>, ...context }. Codes: invalid_email, invalid_role, invalid_actor,
 * invalid_expiry, invalid_workos_invitation_id, workos_invitation_taken, not_found, organization_inactive, already_member, already_pending
 * (with invitationId of the live one), still_pending, already_revoked, already_expired, already_accepted.
 */
const MSG = {
  organization_inactive: "This organization is not active, so it cannot receive invitations.",
  already_member: "This person already has access to the organization.",
  already_pending: "There is already a pending invitation for this email address.",
  not_found: "No such invitation in this organization.",
  still_pending: "This invitation is still valid. Revoke it first, or resend it.",
  already_revoked: "This invitation was already revoked.",
  already_expired: "This invitation has already expired. Replace it to invite the person again.",
  already_accepted: "This invitation was already accepted.",
};
const refusal = (code, extra = {}) => fail(code, { message: MSG[code], ...extra });

/** Why an invitation insert changed nothing: the reason, read after the fact (the batch itself already refused it atomically). */
async function whyNotInserted(db, organizationId, email) {
  const org = await db.prepare("SELECT status FROM organizations WHERE id = ?").bind(organizationId).first();
  if (!org) return fail("invalid_organization", { message: "No such organization." });
  if (org.status !== "active") return refusal("organization_inactive");
  const member = await db
    .prepare("SELECT 1 AS x FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = ? AND u.email = ? AND m.status = 'active'")
    .bind(organizationId, email)
    .first();
  if (member) return refusal("already_member");
  return refusal("already_pending");
}
async function pendingIdFor(db, organizationId, email) {
  const row = await db.prepare("SELECT id FROM invitations WHERE organization_id = ? AND email = ? AND status = 'pending'").bind(organizationId, email).first();
  return row ? row.id : null;
}

const AUDIT = "INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)";

/**
 * Create a pending invitation. Any earlier pending invitation for the same organization and email that has already expired is closed first
 * (same batch, with an audit entry), so an expired invitation never blocks a fresh one. Refused, atomically, when the organization is not active,
 * when the address already has an active membership here, or when a still-valid invitation exists (`already_pending`, carrying its id).
 */
export async function createInvitation(db, organizationId, { email, role, createdBy, expiresInDays = DEFAULT_EXPIRY_DAYS, workosInvitationId = null } = {}, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const normalized = normalizeEmail(email);
  if (!normalized) return fail("invalid_email", { message: "Enter a valid email address." });
  if (!validateEnum(role, ROLES)) return fail("invalid_role", { message: "The role must be owner or member." });
  if (!validActor(createdBy)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS) return fail("invalid_expiry", { message: "The expiry must be 1 to 30 days." });
  if (workosInvitationId !== null && !(typeof workosInvitationId === "string" && /^[A-Za-z0-9_.-]{5,128}$/.test(workosInvitationId))) return fail("invalid_workos_invitation_id");
  const created = isoTime(now);
  const expires = isoTime(new Date(now.getTime() + expiresInDays * 86400000));
  const by = createdBy.trim();
  const id = newId();
  let results;
  try {
    results = await db.batch([
      db
        .prepare(`${AUDIT} SELECT ?, organization_id, 'system', 'system', 'invitation.expired', 'invitation', id, json_object('role', role), 'internal', ? FROM invitations WHERE organization_id = ? AND email = ? AND status = 'pending' AND expires_at <= ?`)
        .bind(newId(), created, organizationId, normalized, created),
      db.prepare("UPDATE invitations SET status = 'expired' WHERE organization_id = ? AND email = ? AND status = 'pending' AND expires_at <= ?").bind(organizationId, normalized, created),
      db
        .prepare(
          `INSERT INTO invitations (id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at)
           SELECT ?, o.id, ?, ?, ?, 'pending', ?, ?, ? FROM organizations o WHERE o.id = ? AND o.status = 'active' AND NOT ${ACTIVE_MEMBER}`,
        )
        .bind(id, normalized, role, workosInvitationId, created, by, expires, organizationId, organizationId, normalized),
      db
        .prepare(`${AUDIT} SELECT ?, organization_id, 'admin', ?, 'invitation.created', 'invitation', id, json_object('role', role), 'internal', ? FROM invitations WHERE id = ? AND organization_id = ?`)
        .bind(newId(), by, created, id, organizationId),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) {
      if (/workos_invitation_id/.test(String(err.message))) return fail("workos_invitation_taken", { message: "That WorkOS invitation is already linked to another invitation." });
      return refusal("already_pending", { invitationId: await pendingIdFor(db, organizationId, normalized) });
    }
    if (isConstraintViolation(err)) return refusal("organization_inactive");
    throw err;
  }
  if (results[2].meta.changes !== 1) {
    const why = await whyNotInserted(db, organizationId, normalized);
    return why.error === "already_pending" ? { ...why, invitationId: await pendingIdFor(db, organizationId, normalized) } : why;
  }
  return ok({ invitation: await getInvitation(db, organizationId, id) });
}

/**
 * Replace an invitation that can no longer be used (expired, or pending but past its date, or revoked) with a fresh pending one for the same
 * address (optionally with a different role). The old row stays as history. Refused when the old invitation is still valid (`still_pending`),
 * was accepted, belongs to another organization (`not_found`), the address already has access, or a pending invitation for it exists
 * (`already_pending`, carrying its id: so a retry of a replace that already succeeded never creates a second one).
 */
export async function replaceInvitation(db, organizationId, id, { actor, role, expiresInDays = DEFAULT_EXPIRY_DAYS } = {}, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  if (role !== undefined && !validateEnum(role, ROLES)) return fail("invalid_role", { message: "The role must be owner or member." });
  if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > MAX_EXPIRY_DAYS) return fail("invalid_expiry", { message: "The expiry must be 1 to 30 days." });
  const old = await getInvitation(db, organizationId, id);
  if (!old) return refusal("not_found");
  const created = isoTime(now);
  const expires = isoTime(new Date(now.getTime() + expiresInDays * 86400000));
  const by = actor.trim();
  const fresh = newId();
  let results;
  try {
    results = await db.batch([
      db
        .prepare(`${AUDIT} SELECT ?, organization_id, 'system', 'system', 'invitation.expired', 'invitation', id, json_object('role', role), 'internal', ? FROM invitations WHERE id = ? AND organization_id = ? AND status = 'pending' AND expires_at <= ?`)
        .bind(newId(), created, id, organizationId, created),
      db.prepare("UPDATE invitations SET status = 'expired' WHERE id = ? AND organization_id = ? AND status = 'pending' AND expires_at <= ?").bind(id, organizationId, created),
      db
        .prepare(
          `INSERT INTO invitations (id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at)
           SELECT ?, i.organization_id, i.email, COALESCE(?, i.role), NULL, 'pending', ?, ?, ?
             FROM invitations i JOIN organizations o ON o.id = i.organization_id
            WHERE i.id = ? AND i.organization_id = ? AND i.status IN ('expired', 'revoked') AND o.status = 'active' AND NOT ${ACTIVE_MEMBER_OF_OLD}`,
        )
        .bind(fresh, role ?? null, created, by, expires, id, organizationId),
      db
        .prepare(`${AUDIT} SELECT ?, organization_id, 'admin', ?, 'invitation.replaced', 'invitation', id, json_object('role', role, 'replaces', ?), 'internal', ? FROM invitations WHERE id = ? AND organization_id = ?`)
        .bind(newId(), by, id, created, fresh, organizationId),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return refusal("already_pending", { invitationId: await pendingIdFor(db, organizationId, old.email) });
    throw err;
  }
  if (results[2].meta.changes === 1) return ok({ invitation: await getInvitation(db, organizationId, fresh), replaced: id });
  const now2 = await getInvitation(db, organizationId, id);
  if (now2.status === "pending") return refusal("still_pending");
  if (now2.status === "accepted") return refusal("already_accepted");
  const why = await whyNotInserted(db, organizationId, old.email);
  return why.error === "already_pending" ? { ...why, invitationId: await pendingIdFor(db, organizationId, old.email) } : why;
}

/** Record the WorkOS invitation id after the WorkOS call succeeded (only while still pending). */
export async function attachWorkosInvitationId(db, organizationId, id, workosInvitationId) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!(typeof workosInvitationId === "string" && /^[A-Za-z0-9_.-]{5,128}$/.test(workosInvitationId))) return fail("invalid_workos_invitation_id");
  try {
    const res = await db.prepare("UPDATE invitations SET workos_invitation_id = ? WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(workosInvitationId, id, organizationId).run();
    return res.meta.changes === 1 ? ok() : refusal("not_found");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("workos_invitation_taken", { message: "That WorkOS invitation is already linked to another invitation." });
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

/**
 * Revoke a still-pending invitation (one atomic batch with its audit entry). Anything else is refused with the reason, and a repeat changes
 * nothing: `already_revoked`, `already_expired`, `already_accepted`, or `not_found` for an id that is not in this organization.
 */
export async function revokeInvitation(db, organizationId, id, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const t = isoTime(now), by = actor.trim();
  const results = await db.batch([
    db
      .prepare(`${AUDIT} SELECT ?, organization_id, 'admin', ?, 'invitation.revoked', 'invitation', id, json_object('role', role), 'internal', ? FROM invitations WHERE id = ? AND organization_id = ? AND status = 'pending'`)
      .bind(newId(), by, t, id, organizationId),
    db.prepare("UPDATE invitations SET status = 'revoked', revoked_at = ?, revoked_by = ? WHERE id = ? AND organization_id = ? AND status = 'pending'").bind(t, by, id, organizationId),
  ]);
  if (results[1].meta.changes === 1) return ok({ changed: true });
  const row = await getInvitation(db, organizationId, id);
  if (!row) return refusal("not_found");
  return refusal({ revoked: "already_revoked", expired: "already_expired", accepted: "already_accepted" }[row.status] || "not_found");
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
