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
