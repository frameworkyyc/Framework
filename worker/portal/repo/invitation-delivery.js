/**
 * Invitation delivery tracking (needs the PROPOSED migration migrations/portal-proposed/0004_invitation_delivery.sql, which is NOT applied anywhere;
 * nothing imports this module yet). Delivery state is separate from the invitation's own status and never claims more than is known:
 *   not_sent    nothing was handed to a provider
 *   submitted   a provider ACCEPTED our request. It is not proof of inbox delivery: there is no delivery confirmation
 *   failed      the provider request failed (a short machine code is kept; never provider text, never an address)
 * Each attempt is ONE atomic batch: the audit entry is written first with the same guard as the update, so an entry exists only if the state changed.
 * Only a PENDING invitation can be updated, and delivery never changes expires_at (a resend keeps the original expiry).
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor, isUniqueViolation } from "./common.js";

export const DELIVERY_STATES = Object.freeze(["not_sent", "submitted", "failed"]);
export const DELIVERY_CHANNELS = Object.freeze(["workos", "resend"]);
const ERROR_CODE = /^[a-z0-9_]{1,40}$/;
const WORKOS_ID = /^[A-Za-z0-9_.-]{5,128}$/;

export async function recordDeliveryAttempt(db, organizationId, id, { outcome, channel, errorCode, workosInvitationId } = {}, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  if (outcome !== "submitted" && outcome !== "failed") return fail("invalid_outcome", { message: "The outcome must be submitted or failed." });
  if (!DELIVERY_CHANNELS.includes(channel)) return fail("invalid_channel", { message: "The channel must be workos or resend." });
  if (outcome === "failed" && !(typeof errorCode === "string" && ERROR_CODE.test(errorCode))) return fail("invalid_error_code", { message: "A failed attempt needs a short error code." });
  if (workosInvitationId !== undefined && workosInvitationId !== null && !(outcome === "submitted" && channel === "workos" && typeof workosInvitationId === "string" && WORKOS_ID.test(workosInvitationId))) {
    return fail("invalid_workos_invitation_id");
  }
  const t = isoTime(now), by = actor.trim();
  const code = outcome === "failed" ? errorCode : null;
  const action = outcome === "submitted" ? "invitation.delivery_submitted" : "invitation.delivery_failed";
  let results;
  try {
    results = await db.batch([
      db
        .prepare(
          `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
           SELECT ?, organization_id, 'admin', ?, ?, 'invitation', id, json_object('channel', ?, 'error', ?), 'internal', ? FROM invitations WHERE id = ? AND organization_id = ? AND status = 'pending'`,
        )
        .bind(newId(), by, action, channel, code, t, id, organizationId),
      db
        .prepare(
          `UPDATE invitations SET delivery_status = ?, delivery_channel = ?, delivery_attempted_at = ?, delivery_error = ?, workos_invitation_id = COALESCE(?, workos_invitation_id)
            WHERE id = ? AND organization_id = ? AND status = 'pending'`,
        )
        .bind(outcome, channel, t, code, workosInvitationId ?? null, id, organizationId),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return fail("workos_invitation_taken", { message: "That WorkOS invitation is already linked to another invitation." });
    throw err;
  }
  return results[1].meta.changes === 1 ? ok({ state: outcome }) : fail("not_found", { message: "No pending invitation with that id in this organization." });
}

/** The delivery fields of one invitation in one organization, or null. */
export async function getDelivery(db, organizationId, id) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  return (await db.prepare("SELECT id, status, expires_at, workos_invitation_id, delivery_status, delivery_channel, delivery_attempted_at, delivery_error FROM invitations WHERE id = ? AND organization_id = ?").bind(id, organizationId).first()) || null;
}

/**
 * Claim the right to make ONE provider request for this invitation, so two simultaneous sends cannot both reach a provider. It is a compare-and-swap on
 * delivery_attempted_at: it succeeds only if the value is still what the caller read, and only for a pending invitation. It is not a lock that can
 * get stuck: if the Worker dies after claiming, the next attempt simply reads the new value and claims again. No audit entry (nothing visible changed).
 * @returns {{ok:true}|{ok:false, error:"send_in_progress"}}
 */
export async function claimDeliveryAttempt(db, organizationId, id, previousAttemptedAt, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  const res = await db
    .prepare("UPDATE invitations SET delivery_attempted_at = ? WHERE id = ? AND organization_id = ? AND status = 'pending' AND delivery_attempted_at IS ?")
    .bind(isoTime(now), id, organizationId, previousAttemptedAt ?? null)
    .run();
  return res.meta.changes === 1 ? ok() : fail("send_in_progress", { message: "Another request is already working on this invitation. Check its status, then try again." });
}

/**
 * Record what happened when the WORKOS side of a revoked invitation was cancelled. The invitation itself is already revoked in D1 (D1 decides access), so
 * this is an audit entry only. outcome "revoked" means WorkOS accepted the revoke request; "failed" keeps a short code. Only for a revoked invitation that
 * has a WorkOS invitation id, in its own organization.
 */
export async function recordWorkosRevocation(db, organizationId, id, { outcome, errorCode } = {}, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  if (outcome !== "revoked" && outcome !== "failed") return fail("invalid_outcome");
  if (outcome === "failed" && !(typeof errorCode === "string" && ERROR_CODE.test(errorCode))) return fail("invalid_error_code");
  const res = await db
    .prepare(
      `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at)
       SELECT ?, organization_id, 'admin', ?, ?, 'invitation', id, json_object('channel', 'workos', 'error', ?), 'internal', ? FROM invitations
        WHERE id = ? AND organization_id = ? AND status = 'revoked' AND workos_invitation_id IS NOT NULL`,
    )
    .bind(newId(), actor.trim(), outcome === "revoked" ? "invitation.workos_revoked" : "invitation.workos_revoke_failed", outcome === "failed" ? errorCode : null, isoTime(now), id, organizationId)
    .run();
  return res.meta.changes === 1 ? ok({ outcome }) : fail("not_found", { message: "No revoked invitation with a WorkOS invitation in this organization." });
}

/** Has the WorkOS side of this (revoked) invitation been cancelled successfully? Read from the audit trail. */
export async function workosRevocationDone(db, organizationId, id) {
  requireOrgId(organizationId);
  requireId(id, "invitation_id");
  const row = await db.prepare("SELECT 1 AS x FROM activity_log WHERE organization_id = ? AND entity_id = ? AND action = 'invitation.workos_revoked' LIMIT 1").bind(organizationId, id).first();
  return Boolean(row);
}
