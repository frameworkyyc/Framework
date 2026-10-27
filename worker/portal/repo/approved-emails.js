/**
 * Approved emails: the addresses that may be invited to the portal and may receive Client Services emails, managed in Admin -> Approved Emails.
 *
 * The list is GLOBAL (it belongs to Framework, not to one client), so these queries carry `cross-tenant:` comments. An address is approved when it is in this table OR in
 * the Cloudflare secret PORTAL_INVITE_ALLOWLIST (invite-recipients.js), so nothing approved before this table existed stops working. Every change is written to
 * activity_log in the same batch and only when the row really changed, so a repeated request leaves one entry. Removing an address stops FUTURE invitations and
 * emails; it never ends anyone's existing access. A database without migration 0008 reads as an empty list (the secret alone then decides).
 */
import { newId, isoTime, ok, fail, validActor } from "./common.js";
import { validApprovedEmail } from "../invite-recipients.js";

export const MAX_APPROVED = 500;

/** @returns {Promise<Set<string>>} the stored addresses; EMPTY when the table is missing or unreadable */
export async function loadApproved(db) {
  try {
    const { results } = await db.prepare("SELECT email FROM approved_emails /* cross-tenant: the approved-recipient list is global */").all();
    return new Set(results.map((r) => r.email));
  } catch {
    return new Set();
  }
}

/** @returns {Promise<{available: boolean, rows: object[]}>} */
export async function listApproved(db) {
  try {
    const { results } = await db.prepare("SELECT email, note, added_by, added_at FROM approved_emails ORDER BY added_at DESC, email /* cross-tenant: the approved-recipient list is global */").all();
    return { available: true, rows: results };
  } catch {
    return { available: false, rows: [] };
  }
}

const audit = (db, action, email, extra, actor, t) =>
  db
    .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, ?, 'approved_email', NULL, ?, 'internal', ? WHERE changes() > 0")
    .bind(newId(), actor.trim(), action, JSON.stringify({ email, ...extra }), t);

/** Approve an address. Idempotent: an address already stored changes nothing and writes no second audit entry. */
export async function addApproved(db, rawEmail, actor, { note = null, source = "admin", now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const email = validApprovedEmail(rawEmail);
  if (!email) return fail("invalid_email", { message: "Enter a plain, valid email address." });
  let noteText = null;
  if (note !== null && note !== undefined) {
    if (typeof note !== "string" || /[\u0000-\u001F\u007F]/.test(note) || note.trim().length > 120) return fail("invalid_note", { message: "The note must be 120 characters or fewer." });
    noteText = note.trim() || null;
  }
  const t = isoTime(now);
  const [ins] = await db.batch([
    db
      .prepare("INSERT INTO approved_emails (email, note, added_by, added_at) SELECT ?, ?, ?, ? WHERE (SELECT count(*) FROM approved_emails) < ? ON CONFLICT (email) DO NOTHING /* cross-tenant: the approved-recipient list is global */")
      .bind(email, noteText, actor.trim(), t, MAX_APPROVED),
    audit(db, "approved_email.added", email, { source }, actor, t),
  ]);
  if (ins.meta.changes === 1) return ok({ email, changed: true });
  const exists = await db.prepare("SELECT 1 AS x FROM approved_emails WHERE email = ? /* cross-tenant: the approved-recipient list is global */").bind(email).first();
  return exists ? ok({ email, changed: false }) : fail("list_full", { message: `The approved list is full (${MAX_APPROVED} addresses). Remove one first.` });
}

/** Remove an address. Idempotent. */
export async function removeApproved(db, rawEmail, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor", { message: "An administrator must be named for this change." });
  const email = validApprovedEmail(rawEmail);
  if (!email) return fail("invalid_email", { message: "Enter a plain, valid email address." });
  const t = isoTime(now);
  const [del] = await db.batch([
    db.prepare("DELETE FROM approved_emails WHERE email = ? /* cross-tenant: the approved-recipient list is global */").bind(email),
    audit(db, "approved_email.removed", email, {}, actor, t),
  ]);
  return ok({ email, changed: del.meta.changes === 1 });
}
