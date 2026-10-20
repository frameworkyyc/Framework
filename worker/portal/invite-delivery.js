/**
 * Invitation delivery orchestration (design implementation, NOT WIRED to any route and requiring the proposed migration 0004: see
 * INVITATION-DELIVERY-PLAN.md). Providers are injected, so the tests use mocks and nothing here can send a real email or call WorkOS by itself.
 *
 * Rules:
 *  - D1 stays the authority. Delivery only informs the person; access still comes solely from the pending D1 invitation plus a VERIFIED sign-in with
 *    the same email (activatePendingInvitations). Nothing here grants, extends or changes access, and delivery never changes expires_at.
 *  - Two paths, chosen by a read-only WorkOS lookup (not by guessing at an error):
 *      * no WorkOS user for the address -> WorkOS invitation (WorkOS emails it; it opens sign-up for that address despite allowSignUp:false)
 *      * a WorkOS user already exists   -> Framework's own email through the existing Resend integration, with a plain sign-in link (no token, nothing
 *        secret: the person signs in with a one-time code to the same address and the pending invitation activates)
 *    Whether WorkOS can invite an EXISTING user is not confirmed by its documentation, so the second path is the default design until a live Staging test says otherwise.
 *  - A failed provider request is recorded as failed with a short code. It is never treated as sent, and the next attempt is explicit.
 *  - "submitted" means a provider accepted the request. It is never reported as delivered to an inbox.
 *  - send (first attempt, or a retry after a failure) is for delivery_status not_sent or failed; resend is for submitted and keeps the original expiry.
 *    An expired invitation is never sent or resent: it must be replaced (a new seven-day invitation).
 */
import { getInvitation } from "./repo/invitations.js";
import { getOrganizationById } from "./repo/orgs.js";
import { recordDeliveryAttempt, getDelivery, claimDeliveryAttempt, recordWorkosRevocation, workosRevocationDone } from "./repo/invitation-delivery.js";
import { revokeInvitation } from "./repo/invitations.js";

const DAY = 86400000;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const refuse = (error, message) => ({ ok: false, error, message });

/** The notice for someone who already has a sign-in. It contains no token and no secret. */
export function existingUserEmail({ orgName, role, email, expiresAt, loginUrl }) {
  const by = new Date(expiresAt).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const what = role === "owner" ? "as an owner" : "as a member";
  const subject = `You've been invited to ${orgName} on the Framework client portal`;
  const lines = [
    `Framework has invited you to join ${orgName} ${what} on the Framework client portal.`,
    `To accept, sign in at ${loginUrl} using this email address (${email}). We'll email you a one-time code; your access starts when you sign in.`,
    `This invitation expires on ${by}.`,
    "If you weren't expecting it, you can ignore this email: nothing happens unless you sign in.",
  ];
  const html = `<p>${esc(lines[0])}</p><p>To accept, <a href="${esc(loginUrl)}">sign in to the portal</a> using this email address (${esc(email)}). We'll email you a one-time code; your access starts when you sign in.</p><p>${esc(lines[2])}</p><p>${esc(lines[3])}</p>`;
  return { subject, text: lines.join("\n\n"), html };
}

/**
 * @param ctx { db, workos, sendEmail, baseUrl, now }  workos: the client from workos-admin.js (or a mock); sendEmail: ({to, subject, text, html}) => {ok, error?}
 * @param req { organizationId, invitationId, actor, mode: "send" | "resend" }
 * @returns {ok:true, delivery:{state:"submitted", channel}} | {ok:false, error, message, delivery?:{state:"failed", channel, error}}
 */
export async function deliverInvitation(ctx, { organizationId, invitationId, actor, mode = "send" }) {
  const { db, workos, sendEmail, baseUrl } = ctx;
  const now = ctx.now || new Date();
  const d = await getDelivery(db, organizationId, invitationId);
  if (!d) return refuse("not_found", "No such invitation in this organization.");
  if (d.status === "accepted") return refuse("already_accepted", "This invitation was already accepted.");
  if (d.status === "revoked") return refuse("invitation_revoked", "This invitation was revoked.");
  if (d.status === "expired" || new Date(d.expires_at) <= now) return refuse("expired_replace_required", "This invitation has expired. Replace it with a new invitation first.");
  if (mode === "send" && d.delivery_status === "submitted") return refuse("already_submitted", "This invitation was already submitted. Use resend.");
  if (mode === "resend" && d.delivery_status !== "submitted") return refuse("not_yet_submitted", "This invitation has not been submitted yet. Send it first.");
  const org = await getOrganizationById(db, organizationId);
  if (!org || org.status !== "active") return refuse("organization_inactive", "This organization is not active.");
  const inv = await getInvitation(db, organizationId, invitationId);
  // Only one request may talk to a provider for this invitation at a time (compare-and-swap on the last attempt time).
  const claim = await claimDeliveryAttempt(db, organizationId, invitationId, d.delivery_attempted_at, { now });
  if (!claim.ok) return refuse(claim.error, claim.message);

  const record = async (outcome, channel, errorCode, workosInvitationId) => {
    let r;
    try {
      r = await recordDeliveryAttempt(db, organizationId, invitationId, { outcome, channel, errorCode, workosInvitationId }, actor, { now });
    } catch {
      r = { ok: false };
    }
    if (!r.ok) return refuse("delivery_unrecorded", "The provider was asked, but the result could not be saved. Check before retrying.");
    return outcome === "submitted" ? { ok: true, delivery: { state: "submitted", channel } } : { ok: false, error: "delivery_failed", message: "The request to the email provider failed. Nothing was sent.", delivery: { state: "failed", channel, error: errorCode } };
  };
  const failedCode = (e) => (e && typeof e.code === "string" && /^[a-z0-9_]{1,40}$/.test(e.code) ? e.code : "provider_error");

  // 1. which path?
  let channel;
  if (mode === "resend") channel = d.delivery_channel;
  else {
    try {
      channel = (await workos.findUserByEmail(inv.email)).exists ? "resend" : "workos";
    } catch (e) {
      return record("failed", "workos", failedCode(e)); // cannot tell which path is right: do not guess
    }
  }

  // 2. ask the provider
  if (channel === "workos") {
    try {
      if (mode === "resend") {
        if (!d.workos_invitation_id) return record("failed", "workos", "missing_workos_invitation");
        await workos.resendInvitation(d.workos_invitation_id);
        return record("submitted", "workos", undefined, undefined);
      }
      const expiresInDays = Math.min(30, Math.max(1, Math.ceil((new Date(d.expires_at) - now) / DAY)));
      const created = await workos.createInvitation({ email: inv.email, expiresInDays });
      return record("submitted", "workos", undefined, created.id);
    } catch (e) {
      return record("failed", "workos", failedCode(e));
    }
  }
  const mail = existingUserEmail({ orgName: org.name, role: inv.role, email: inv.email, expiresAt: d.expires_at, loginUrl: new URL("/portal/login", baseUrl).toString() });
  let sent;
  try {
    sent = await sendEmail({ to: inv.email, subject: mail.subject, text: mail.text, html: mail.html });
  } catch {
    sent = { ok: false, error: "network" };
  }
  if (sent && sent.ok === true) return record("submitted", "resend");
  return record("failed", "resend", sent && typeof sent.error === "string" && sent.error.startsWith("config:") ? "email_not_configured" : "email_provider_failed");
}

/**
 * Revoke an invitation in D1 FIRST (that is what ends the person's ability to gain access), then cancel the WorkOS invitation if one exists.
 * Partial failure is explicit, never hidden and never a rollback of the revoke:
 *   - D1 revoked, WorkOS revoked           -> { ok:true,  workos:{state:"revoked"} }
 *   - D1 revoked, WorkOS request failed    -> { ok:true,  workos:{state:"revoke_failed", error} } plus an audit entry. Access is already closed;
 *                                            calling revoke again retries ONLY the WorkOS cancellation (D1 is not changed twice)
 *   - no WorkOS invitation to cancel       -> { ok:true,  workos:{state:"none"} }
 *   - D1 refused (accepted, unknown, ...)   -> the data layer's structured error; WorkOS is not contacted
 * A repeat on a revoked invitation whose WorkOS side is already cancelled is the usual already_revoked.
 * @param ctx { db, workos (or null when WorkOS is not configured or sending is off), workosUnavailableCode, now }
 */
export async function revokeInvitationEverywhere(ctx, { organizationId, invitationId, actor }) {
  const { db } = ctx;
  const now = ctx.now || new Date();
  const before = await getDelivery(db, organizationId, invitationId);
  if (!before) return refuse("not_found", "No such invitation in this organization.");
  let d1Changed = false;
  if (before.status === "pending") {
    const r = await revokeInvitation(db, organizationId, invitationId, actor, { now });
    if (!r.ok) return r;
    d1Changed = true;
  } else if (!(before.status === "revoked" && before.workos_invitation_id && !(await workosRevocationDone(db, organizationId, invitationId)))) {
    const r = await revokeInvitation(db, organizationId, invitationId, actor, { now }); // gives the precise refusal (already_revoked, already_accepted, already_expired)
    return r.ok ? { ok: true, changed: false, workos: { state: "none" } } : r;
  }
  if (!before.workos_invitation_id) return { ok: true, changed: d1Changed, workos: { state: "none" } };
  let code = null;
  if (!ctx.workos) code = ctx.workosUnavailableCode || "workos_not_configured";
  else {
    try {
      await ctx.workos.revokeInvitation(before.workos_invitation_id);
    } catch (e) {
      code = e && typeof e.code === "string" && /^[a-z0-9_]{1,40}$/.test(e.code) ? e.code : "provider_error";
    }
  }
  let audited;
  try {
    audited = await recordWorkosRevocation(db, organizationId, invitationId, code ? { outcome: "failed", errorCode: code } : { outcome: "revoked" }, actor, { now });
  } catch {
    audited = { ok: false };
  }
  if (!audited.ok && !code) return { ok: false, error: "delivery_unrecorded", message: "WorkOS was asked to cancel the invitation, but the result could not be saved." };
  return code ? { ok: true, changed: d1Changed, workos: { state: "revoke_failed", error: code } } : { ok: true, changed: d1Changed, workos: { state: "revoked" } };
}
