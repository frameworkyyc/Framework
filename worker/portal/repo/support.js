/**
 * Support & Change Requests data layer (Client Services). Metadata only: attachment CONTENT lives in private R2 (the file service, Phase 3).
 *
 * Rules, on top of the shared repository rules (common.js):
 *  - A request is either technical SUPPORT (technical issues, general questions) or a CHANGE (website change, design revision) that may be billable. The scope follows
 *    the category and the database enforces it. Only changes can be "quoted" or "approved", and a request never becomes approved by being submitted: Framework sets
 *    it after a quote has been agreed. Wording that says so lives in the pages (SUBMISSION_NOTICE below), not in this layer.
 *  - The conversation is APPEND-ONLY and complete: client messages, Framework replies, status changes and private staff notes are rows in support_messages. Nothing is
 *    edited or deleted. A client never receives internal notes.
 *  - Every statement names organization_id; a row is addressed by (id, organization_id), so another organization's id is simply "not found".
 *  - Each change that someone must be told about queues a row in service_notifications in the same transaction (staff email for client activity; client email for a
 *    Framework reply or status change). Sending is separate (Phase 4); queuing never fails the request.
 */
import { newId, isoTime, requireOrgId, requireUserId, requireId, ok, fail, isConstraintViolation, validActor } from "./common.js";
import { validateName, validateText, validateEnum } from "./validate.js";

export const CATEGORIES = ["website_change", "design_revision", "technical_issue", "general"];
export const STATUSES = ["new", "in_review", "quoted", "approved", "in_progress", "completed", "declined"];
export const CLOSED = ["completed", "declined"];
export const MAX_OPEN_REQUESTS = 10;
export const MAX_ATTACHMENTS = 3;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_BODY = 4000;
export const scopeOf = (category) => (category === "website_change" || category === "design_revision" ? "change" : "support");

/** Said on the new-request form and on every change request, in these words. */
export const SUBMISSION_NOTICE = "Sending a request does not authorize any paid work. Framework will review it and, if it involves extra work, send you a quote to approve before anything starts.";
export const CATEGORY_LABEL = Object.freeze({ website_change: "Website change", design_revision: "Logo or design revision", technical_issue: "Technical issue", general: "General support" });
export const STATUS_LABEL = Object.freeze({ new: "New", in_review: "In review", quoted: "Quote sent", approved: "Approved", in_progress: "In progress", completed: "Completed", declined: "Declined" });

/* ------------------------------------------------------------------ rows */

const REQ = "id, organization_id, category, scope, title, status, submitted_by, created_at, status_changed_at, last_message_at, last_message_by, client_read_at, admin_seen_at";
const request = (r) => ({
  id: r.id, organizationId: r.organization_id, category: r.category, scope: r.scope, title: r.title, status: r.status, submittedBy: r.submitted_by, createdAt: r.created_at,
  statusChangedAt: r.status_changed_at, lastMessageAt: r.last_message_at, lastMessageBy: r.last_message_by, closed: CLOSED.includes(r.status),
  // a Framework reply the client has not opened yet
  unreadForClient: r.last_message_by === "staff" && (!r.client_read_at || r.client_read_at < r.last_message_at),
  newForAdmin: !r.admin_seen_at || r.admin_seen_at < r.last_message_at,
});
const message = (m) => ({ id: m.id, kind: m.kind, authorType: m.author_type, authorName: m.author_type === "staff" ? "Framework" : m.author_name || "", visibility: m.visibility, body: m.body, statusTo: m.status_to, createdAt: m.created_at });
const attachment = (a) => ({ id: a.id, messageId: a.message_id, name: a.original_name, format: a.format, size: a.size_bytes, createdAt: a.created_at });

function audit(db, { organizationId, actorType, actorRef, action, entityId, at, visibility = "internal" }) {
  return db
    .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) SELECT ?, ?, ?, ?, ?, 'support_request', ?, ?, ? WHERE changes() > 0")
    .bind(newId(), organizationId, actorType, actorRef, action, entityId, visibility, at);
}
function notify(db, { organizationId, audience, event, entityId, at }) {
  // One pending notice per (organization, audience, event, request): a burst of replies before the first email goes out is one email, not many.
  return db
    .prepare("INSERT INTO service_notifications (id, organization_id, audience, event, entity_type, entity_id, created_at) SELECT ?, ?, ?, ?, 'support_request', ?, ? WHERE changes() > 0 AND NOT EXISTS (SELECT 1 FROM service_notifications n WHERE n.organization_id = ? AND n.audience = ? AND n.event = ? AND n.entity_id = ? AND n.status = 'pending')")
    .bind(newId(), organizationId, audience, event, entityId, at, organizationId, audience, event, entityId);
}

/* ------------------------------------------------------------------ client */

/** A new request: the request row and its first message are written together, only while the organization has fewer than MAX_OPEN_REQUESTS open requests. */
export async function createRequest(db, organizationId, userId, { category, title, description }, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireUserId(userId);
  const cat = validateEnum(category, CATEGORIES), t = validateName(title, 120), body = validateText(description, MAX_BODY);
  if (!cat) return fail("invalid_category");
  if (!t) return fail("invalid_title");
  if (!body) return fail(body === undefined ? "invalid_description" : "description_required");
  const id = newId(), mid = newId(), at = isoTime(now);
  let res;
  try {
    res = await db.batch([
      db
        .prepare(
          `INSERT INTO support_requests (id, organization_id, category, scope, title, status, submitted_by, created_at, status_changed_at, last_message_at, last_message_by, client_read_at)
           SELECT ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, 'client', ?
            WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active')
              AND (SELECT count(*) FROM support_requests r WHERE r.organization_id = ? AND r.status NOT IN ('completed', 'declined')) < ?`,
        )
        .bind(id, organizationId, cat, scopeOf(cat), t, userId, at, at, at, at, organizationId, userId, organizationId, MAX_OPEN_REQUESTS),
      db
        .prepare("INSERT INTO support_messages (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'client', ?, 'client', ?, ? WHERE changes() > 0")
        .bind(mid, organizationId, id, userId, body, at),
      audit(db, { organizationId, actorType: "client", actorRef: userId, action: "support.request.created", entityId: id, at, visibility: "client" }),
      notify(db, { organizationId, audience: "staff", event: "request_submitted", entityId: id, at }),
    ]);
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_request");
    throw err;
  }
  if (res[0].meta.changes !== 1) {
    const open = await db.prepare("SELECT count(*) AS n FROM support_requests WHERE organization_id = ? AND status NOT IN ('completed', 'declined')").bind(organizationId).first();
    return fail(open.n >= MAX_OPEN_REQUESTS ? "too_many_open" : "not_allowed");
  }
  return ok({ id, messageId: mid });
}

/** The organization's own requests, most recently active first. */
export async function listClientRequests(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${REQ} FROM support_requests WHERE organization_id = ? ORDER BY last_message_at DESC, id`).bind(organizationId).all()).results.map(request);
}

/** One request with its CLIENT-VISIBLE conversation (never internal notes) and attachments, or null. */
export async function getClientThread(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM support_requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  if (!r) return null;
  const msgs = (await db.prepare("SELECT m.id, m.kind, m.author_type, m.visibility, m.body, m.status_to, m.created_at, u.name AS author_name FROM support_messages m LEFT JOIN portal_users u ON u.id = m.author_user_id WHERE m.organization_id = ? AND m.request_id = ? AND m.visibility = 'client' ORDER BY m.created_at, m.rowid").bind(organizationId, requestId).all()).results;
  const files = (await db.prepare("SELECT a.id, a.message_id, a.original_name, a.format, a.size_bytes, a.created_at FROM support_attachments a JOIN support_messages m ON m.id = a.message_id AND m.organization_id = a.organization_id WHERE a.organization_id = ? AND a.request_id = ? AND m.visibility = 'client' ORDER BY a.created_at, a.rowid").bind(organizationId, requestId).all()).results;
  return { request: request(r), messages: msgs.map(message), attachments: files.map(attachment) };
}

/** Marks Framework's replies as seen. Only the unread flag changes. */
export async function markClientRead(db, organizationId, requestId, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  await db.prepare("UPDATE support_requests SET client_read_at = MAX(?, last_message_at) WHERE id = ? AND organization_id = ? AND (client_read_at IS NULL OR client_read_at < last_message_at)").bind(isoTime(now), requestId, organizationId).run();
  return ok();
}

/** A client follow-up on an open request. Closed (completed or declined) requests take no more messages: a new request is opened instead. */
export async function addClientMessage(db, organizationId, userId, requestId, bodyRaw, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id");
  const body = validateText(bodyRaw, MAX_BODY);
  if (!body) return fail(body === undefined ? "invalid_message" : "message_required");
  const mid = newId(), at = isoTime(now);
  const res = await db.batch([
    db
      .prepare("UPDATE support_requests SET last_message_at = ?, last_message_by = 'client', client_read_at = ? WHERE id = ? AND organization_id = ? AND status NOT IN ('completed', 'declined') AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active')")
      .bind(at, at, requestId, organizationId, organizationId, userId),
    db.prepare("INSERT INTO support_messages (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'client', ?, 'client', ?, ? WHERE changes() > 0").bind(mid, organizationId, requestId, userId, body, at),
    audit(db, { organizationId, actorType: "client", actorRef: userId, action: "support.message.client", entityId: requestId, at, visibility: "client" }),
    notify(db, { organizationId, audience: "staff", event: "request_client_reply", entityId: requestId, at }),
  ]);
  if (res[0].meta.changes === 1) return ok({ messageId: mid });
  const cur = await db.prepare("SELECT status FROM support_requests WHERE id = ? AND organization_id = ?").bind(requestId, organizationId).first();
  return fail(!cur ? "not_found" : CLOSED.includes(cur.status) ? "closed" : "not_allowed");
}

/* ------------------------------------------------------------------ attachments (metadata; the file service stores the object first) */

/** At most MAX_ATTACHMENTS per request, enforced inside the insert. `file` is { ext, name, contentType, size, sha256, storageKey }. */
export async function createAttachment(db, organizationId, requestId, messageId, uploaderType, file, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(messageId, "message_id");
  if (!["client", "staff"].includes(uploaderType)) return fail("invalid_uploader");
  if (!(file.size <= MAX_ATTACHMENT_BYTES)) return fail("file_too_large");
  const id = newId(), at = isoTime(now);
  let res;
  try {
    res = await db
      .prepare(
        `INSERT INTO support_attachments (id, organization_id, request_id, message_id, original_name, format, content_type, size_bytes, sha256, storage_key, uploaded_by_type, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
          WHERE (SELECT count(*) FROM support_attachments a WHERE a.organization_id = ? AND a.request_id = ?) < ?`,
      )
      .bind(id, organizationId, requestId, messageId, file.name, file.ext, file.contentType, file.size, file.sha256, file.storageKey, uploaderType, at, organizationId, requestId, MAX_ATTACHMENTS)
      .run();
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_attachment");
    throw err;
  }
  return res.meta.changes === 1 ? ok({ id }) : fail("too_many_attachments");
}

/** One attachment the client may download (its message must be client-visible), or null. */
export async function getClientAttachment(db, organizationId, requestId, attachmentId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(attachmentId, "attachment_id");
  const r = await db.prepare("SELECT a.id, a.original_name, a.format, a.content_type, a.size_bytes, a.storage_key FROM support_attachments a JOIN support_messages m ON m.id = a.message_id AND m.organization_id = a.organization_id WHERE a.id = ? AND a.request_id = ? AND a.organization_id = ? AND m.visibility = 'client'").bind(attachmentId, requestId, organizationId).first();
  return r ? { id: r.id, name: r.original_name, format: r.format, contentType: r.content_type, size: r.size_bytes, storageKey: r.storage_key } : null;
}

export async function getAdminAttachment(db, organizationId, requestId, attachmentId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(attachmentId, "attachment_id");
  const r = await db.prepare("SELECT id, original_name, format, content_type, size_bytes, storage_key FROM support_attachments WHERE id = ? AND request_id = ? AND organization_id = ?").bind(attachmentId, requestId, organizationId).first();
  return r ? { id: r.id, name: r.original_name, format: r.format, contentType: r.content_type, size: r.size_bytes, storageKey: r.storage_key } : null;
}

/* ------------------------------------------------------------------ Framework Admin */

export async function listRequestsAdmin(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${REQ} FROM support_requests WHERE organization_id = ? ORDER BY last_message_at DESC, id`).bind(organizationId).all()).results.map(request);
}

/** The whole conversation INCLUDING internal notes, status changes and who wrote what. */
export async function getAdminThread(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM support_requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  if (!r) return null;
  const msgs = (await db.prepare("SELECT m.id, m.kind, m.author_type, m.visibility, m.body, m.status_to, m.created_at, COALESCE(u.name, u.email, m.author_label) AS author_name FROM support_messages m LEFT JOIN portal_users u ON u.id = m.author_user_id WHERE m.organization_id = ? AND m.request_id = ? ORDER BY m.created_at, m.rowid").bind(organizationId, requestId).all()).results;
  const files = (await db.prepare("SELECT id, message_id, original_name, format, size_bytes, created_at FROM support_attachments WHERE organization_id = ? AND request_id = ? ORDER BY created_at, rowid").bind(organizationId, requestId).all()).results;
  return { request: request(r), messages: msgs.map((m) => ({ ...message(m), authorName: m.author_name || "" })), attachments: files.map(attachment) };
}

export async function markAdminSeen(db, organizationId, requestId, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  await db.prepare("UPDATE support_requests SET admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(isoTime(now), requestId, organizationId).run();
  return ok();
}

/** A Framework reply (visible to the client and queued as an email) or a private note (internal: never shown to, or emailed to, the client). Allowed on closed requests too. */
export async function addStaffMessage(db, organizationId, requestId, bodyRaw, actor, { internal = false, now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const body = validateText(bodyRaw, MAX_BODY);
  if (!body) return fail(body === undefined ? "invalid_message" : "message_required");
  const mid = newId(), at = isoTime(now), visibility = internal ? "internal" : "client";
  const stmts = [
    internal
      ? db.prepare("UPDATE support_requests SET admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(at, requestId, organizationId)
      : db.prepare("UPDATE support_requests SET last_message_at = ?, last_message_by = 'staff', admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(at, at, requestId, organizationId),
    db.prepare("INSERT INTO support_messages (id, organization_id, request_id, kind, author_type, author_label, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'staff', ?, ?, ?, ? WHERE changes() > 0").bind(mid, organizationId, requestId, actor.trim(), visibility, body, at),
    audit(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: internal ? "support.note.staff" : "support.message.staff", entityId: requestId, at, visibility: internal ? "internal" : "client" }),
  ];
  if (!internal) stmts.push(notify(db, { organizationId, audience: "client", event: "request_staff_reply", entityId: requestId, at }));
  const res = await db.batch(stmts);
  return res[0].meta.changes === 1 ? ok({ messageId: mid }) : fail("not_found");
}

/**
 * Changes the status and records it in the conversation (visible to the client, with an optional note). "quoted" and "approved" are only for CHANGE requests
 * (the database refuses them for support requests too). Approval is Framework's record that a quote was agreed: it is never set by the client or by submitting.
 */
export async function setRequestStatus(db, organizationId, requestId, status, actor, { note = null, now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!validateEnum(status, STATUSES)) return fail("invalid_status");
  const n = validateText(note, MAX_BODY);
  if (n === undefined) return fail("invalid_message");
  const cur = await db.prepare("SELECT scope, status FROM support_requests WHERE id = ? AND organization_id = ?").bind(requestId, organizationId).first();
  if (!cur) return fail("not_found");
  if (cur.scope !== "change" && (status === "quoted" || status === "approved")) return fail("not_billable");
  if (cur.status === status) return ok({ changed: false });
  const mid = newId(), at = isoTime(now);
  let res;
  try {
    res = await db.batch([
      db.prepare("UPDATE support_requests SET status = ?, status_changed_at = ?, last_message_at = ?, last_message_by = 'staff', admin_seen_at = ? WHERE id = ? AND organization_id = ? AND status = ?").bind(status, at, at, at, requestId, organizationId, cur.status),
      db.prepare("INSERT INTO support_messages (id, organization_id, request_id, kind, author_type, author_label, visibility, body, status_to, created_at) SELECT ?, ?, ?, 'status', 'staff', ?, 'client', ?, ?, ? WHERE changes() > 0").bind(mid, organizationId, requestId, actor.trim(), n || "", status, at),
      audit(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "support.status." + status, entityId: requestId, at, visibility: "client" }),
      // Only a QUOTE is worth an email. Routine status changes (in review, in progress, completed...) are visible in the portal and are not emailed.
      ...(status === "quoted" ? [notify(db, { organizationId, audience: "client", event: "request_status", entityId: requestId, at })] : []),
    ]);
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_status");
    throw err;
  }
  return res[0].meta.changes === 1 ? ok({ changed: true, messageId: mid }) : fail("conflict");
}

/* ------------------------------------------------------------------ summaries */

/** For the hub and Home: open requests, Framework replies not yet opened, and whether any request is awaiting a quote decision. */
export async function clientSupportSummary(db, organizationId) {
  requireOrgId(organizationId);
  const r = await db.prepare("SELECT count(*) AS total, COALESCE(sum(status NOT IN ('completed', 'declined')), 0) AS open, COALESCE(sum(last_message_by = 'staff' AND (client_read_at IS NULL OR client_read_at < last_message_at)), 0) AS unread, COALESCE(sum(status = 'quoted'), 0) AS quoted FROM support_requests WHERE organization_id = ?").bind(organizationId).first();
  return { total: r.total, open: r.open, unread: r.unread, quoted: r.quoted };
}

/** For Admin's attention card: requests with client activity staff have not seen, and open requests. */
export async function adminSupportSummary(db, organizationId) {
  requireOrgId(organizationId);
  const r = await db.prepare("SELECT count(*) AS total, COALESCE(sum(status NOT IN ('completed', 'declined')), 0) AS open, COALESCE(sum(admin_seen_at IS NULL OR admin_seen_at < last_message_at), 0) AS unseen FROM support_requests WHERE organization_id = ?").bind(organizationId).first();
  return { total: r.total, open: r.open, unseen: r.unseen };
}

/** A message of this request (any visibility), or null. Used to make sure a staff attachment goes on a staff message of the right request. */
export async function getMessage(db, organizationId, requestId, messageId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(messageId, "message_id");
  const r = await db.prepare("SELECT id, author_type, visibility FROM support_messages WHERE id = ? AND request_id = ? AND organization_id = ?").bind(messageId, requestId, organizationId).first();
  return r ? { id: r.id, authorType: r.author_type, visibility: r.visibility } : null;
}

/** Every storage key of an organization's support attachments, so housekeeping never mistakes one for an orphan. */
export async function listSupportStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare("SELECT storage_key FROM support_attachments WHERE organization_id = ?").bind(organizationId).all()).results.map((r) => r.storage_key);
}

/** One request of the organization (no conversation), or null. */
export async function getRequest(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM support_requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  return r ? request(r) : null;
}

/* ------------------------------------------------------------------ Framework Admin, across every client */

/**
 * Why a request needs staff attention, or null: "new" (nobody on staff has opened it) or "reply" (the client wrote after staff last looked). Closed requests never do.
 * A pure function of the row, so the list and the counts agree.
 */
export function attentionReason(r) {
  if (CLOSED.includes(r.status)) return null;
  if (r.admin_seen_at && r.admin_seen_at >= r.last_message_at) return null;
  return r.admin_seen_at ? "reply" : "new";
}

const REQ_R = REQ.split(", ").map((c) => "r." + c).join(", ");
const SCOPE_WHERE = Object.freeze({ attention: "r.status NOT IN ('completed', 'declined')", open: "r.status NOT IN ('completed', 'declined')", closed: "r.status IN ('completed', 'declined')", all: "1 = 1" }); // fixed fragments: the scope is looked up, never interpolated

/**
 * Requests of EVERY organization for the global Admin list. This is deliberately cross-tenant: only Framework Admin (behind Cloudflare Access) reaches it, and it
 * returns what the per-client page returns, plus the organization's name. scope: attention | open | closed | all.
 */
export async function listRequestsAllAdmin(db, { scope = "attention", limit = 200 } = {}) {
  const where = SCOPE_WHERE[scope] || SCOPE_WHERE.open;
  const rows = (await db
    .prepare(`SELECT ${REQ_R}, o.name AS org_name FROM support_requests r JOIN organizations o ON o.id = r.organization_id WHERE o.status <> 'archived' AND ${where} ORDER BY r.last_message_at DESC, r.id LIMIT ?`)
    .bind(Math.min(Math.max(1, limit), 500)).all()).results;
  const list = rows.map((r) => ({ ...request(r), orgName: r.org_name, reason: attentionReason(r) }));
  return scope === "attention" ? list.filter((r) => r.reason) : list;
}

/** Counts across every organization for the Admin dashboard and navigation badge. */
export async function adminSupportTotals(db) {
  const r = await db.prepare("SELECT count(*) AS total, COALESCE(sum(status NOT IN ('completed', 'declined')), 0) AS open, COALESCE(sum(status NOT IN ('completed', 'declined') AND (admin_seen_at IS NULL OR admin_seen_at < last_message_at)), 0) AS attention FROM support_requests WHERE organization_id IN (SELECT id FROM organizations WHERE status <> 'archived') /* cross-tenant: Admin totals; deleted clients are left out */").first();
  return { total: r.total, open: r.open, attention: r.attention };
}
