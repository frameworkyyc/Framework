/**
 * Evidence that a signed-in person has been here before. Read-only. It exists so the portal never says "Welcome back" to someone who has not been.
 *
 * Reliable evidence, any one of:
 *   - an EARLIER sign-in of the same person (another portal_sessions row; the current session never counts);
 *   - a Business Profile answer this person saved in this organization;
 *   - an activity entry of their own work in this organization (profile updates, feedback). Sign-in and invitation-accepted entries are NOT counted:
 *     the very first sign-in writes them, so they would make every new client look like a returning one.
 * Having a session at all, being a member, or being invited is NOT evidence: a brand-new client has all of those on their first visit.
 */
import { requireOrgId, requireUserId, PortalDataError } from "./common.js";

/** Session ids are the 64-character hex digests the sessions repository stores (not UUIDs). */
const SESSION_ID = /^[0-9a-f]{64}$/;

/** @returns {Promise<boolean>} */
export async function hasPriorVisit(db, { userId, organizationId, sessionId }) {
  requireUserId(userId);
  requireOrgId(organizationId);
  if (typeof sessionId !== "string" || !SESSION_ID.test(sessionId)) throw new PortalDataError("invalid_session_id");
  const row = await db
    .prepare(
      `SELECT
         EXISTS (SELECT 1 FROM portal_sessions WHERE user_id = ? AND id <> ?) AS earlier_session,
         EXISTS (SELECT 1 FROM business_profile_answers WHERE organization_id = ? AND updated_by = ?) AS own_answers,
         EXISTS (SELECT 1 FROM activity_log WHERE organization_id = ? AND actor_type = 'client' AND actor_ref = ? AND action IN ('profile.updated', 'feedback.submitted')) AS own_activity`,
    )
    .bind(userId, sessionId, organizationId, userId, organizationId, userId)
    .first();
  return Boolean(row && (row.earlier_session || row.own_answers || row.own_activity));
}
