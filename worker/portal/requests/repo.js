/**
 * Request engine data layer (needs migration 0020). Metadata only: file CONTENT lives in private R2 (files.js).
 *
 * Rules, on top of the shared repository rules (../repo/common.js):
 *  - Every statement names organization_id and addresses a row by (id, organization_id): another organization's id is simply "not found".
 *  - The timeline (request_events) is append-only. A client never receives internal notes, draft proofs, or final files before the request is completed.
 *  - Every move goes through move(): one atomic batch that compare-and-swaps the status, writes the timeline entry, the audit entry and (when someone must be told) one
 *    queued notice. Which moves exist, and who may make them, is workflow.js; this file adds the guards that need data (a quote, a proof, a revision round left).
 *  - Money: amounts are cents, CAD, typed by staff, never calculated. Accepting a quote in the portal is a separate, closed gate (quote-gate.js): until terms are
 *    finalised, only Framework can RECORD an agreement.
 *  - Notices reuse the existing outbox (service_notifications). Its entity_type is the literal 'support_request'; for this engine entity_id is the request's id.
 */
import { staffUserIds } from "../repo/staff.js";
import { newId, isoTime, requireOrgId, requireUserId, requireId, ok, fail, isConstraintViolation, validActor } from "../repo/common.js";
import { validateName, validateText } from "../repo/validate.js";
import { getType, typeLabel, kindOf } from "./registry.js";
import { canMove, isClosed, CLOSED, STATUS_LABEL, revisionsLeft, clientActionReason, staffAttentionReason } from "./workflow.js";

export const MAX_OPEN_REQUESTS = 25;
export const MAX_BODY = 4000;
/** Reference files and attachments (client or staff) per request, and per single message. */
export const MAX_FILES_PER_REQUEST = 20;
export const MAX_FILES_PER_MESSAGE = 4;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

const MEMBER_MAY_WRITE = "EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active')";
const STAFF_MAY_WRITE = "EXISTS (SELECT 1 FROM portal_staff s WHERE ? IS NOT NULL AND s.user_id = ? AND s.revoked_at IS NULL)";
const OPEN = "('completed', 'declined', 'cancelled')";

/* ------------------------------------------------------------------ rows */

const REQ = "id, organization_id, kind, type_key, title, status, details_json, brand_snapshot_json, website_id, needed_by, revisions_included, revisions_paid, revisions_used, submitted_by, created_at, status_changed_at, last_message_at, last_message_by, client_read_at, admin_seen_at, completed_at";
const parse = (s, fallback) => { try { const v = JSON.parse(s); return v && typeof v === "object" ? v : fallback; } catch { return fallback; } };

export function toRequest(r) {
  const req = {
    id: r.id, organizationId: r.organization_id, kind: r.kind, typeKey: r.type_key, typeLabel: typeLabel(r.type_key), title: r.title, status: r.status,
    details: parse(r.details_json, {}), brand: r.brand_snapshot_json ? parse(r.brand_snapshot_json, null) : null, websiteId: r.website_id, neededBy: r.needed_by,
    revisionsIncluded: r.revisions_included, revisionsPaid: r.revisions_paid, revisionsUsed: r.revisions_used,
    submittedBy: r.submitted_by, createdAt: r.created_at, statusChangedAt: r.status_changed_at, lastMessageAt: r.last_message_at, lastMessageBy: r.last_message_by, completedAt: r.completed_at,
    closed: isClosed(r.status),
    unreadForClient: r.last_message_by === "staff" && (!r.client_read_at || r.client_read_at < r.last_message_at),
    newForAdmin: !r.admin_seen_at || r.admin_seen_at < r.last_message_at,
  };
  req.revisionsLeft = revisionsLeft(req);
  return req;
}

const toEvent = (e) => ({ id: e.id, kind: e.kind, authorType: e.author_type, authorName: e.author_type === "staff" ? "Framework" : e.author_name || "", visibility: e.visibility, body: e.body, statusTo: e.status_to, refId: e.ref_id, createdAt: e.created_at });
const toFile = (f) => ({ id: f.id, eventId: f.event_id, role: f.role, version: f.version, round: f.round, name: f.original_name, format: f.format, size: f.size_bytes, hasPreview: !!f.preview_key, previewFormat: f.preview_format || null, uploader: f.uploader_type, createdAt: f.created_at });
const toQuote = (q) => ({ id: q.id, version: q.version, title: q.title, scope: q.scope, amountCents: q.amount_cents, taxCents: q.tax_cents, taxLabel: q.tax_label, validUntil: q.valid_until, status: q.status, createdAt: q.created_at, decidedAt: q.decided_at, decidedVia: q.decided_via, acceptedName: q.accepted_name });

function audit(db, { organizationId, actorType, actorRef, action, entityId, at, visibility = "internal" }) {
  return db
    .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) SELECT ?, ?, ?, ?, ?, 'request', ?, ?, ? WHERE changes() > 0")
    .bind(newId(), organizationId, actorType, actorRef, action, entityId, visibility, at);
}
/** One pending notice per (organization, audience, event, request): a burst is one email. Always the LAST statement of a batch that needs one. */
function notify(db, { organizationId, audience, event, entityId, at }) {
  return db
    .prepare("INSERT INTO service_notifications (id, organization_id, audience, event, entity_type, entity_id, created_at) SELECT ?, ?, ?, ?, 'support_request', ?, ? WHERE changes() > 0 AND NOT EXISTS (SELECT 1 FROM service_notifications n WHERE n.organization_id = ? AND n.audience = ? AND n.event = ? AND n.entity_id = ? AND n.status = 'pending')")
    .bind(newId(), organizationId, audience, event, entityId, at, organizationId, audience, event, entityId);
}

const clientActor = (userId, asStaff) => ({ type: "client", userId, asStaff: !!asStaff });
const staffActor = (label) => ({ type: "staff", label: label.trim() });
const WHO = (actor) => (actor.asStaff ? STAFF_MAY_WRITE : MEMBER_MAY_WRITE);

/* ------------------------------------------------------------------ create */

/**
 * A new request: the request row and its first timeline entry are written together, only while the organization has fewer than MAX_OPEN_REQUESTS open requests.
 * `details` and `brandSnapshot` are already validated (registry.js) and built by the caller; revisionsIncluded comes from the service's setting.
 */
export async function createRequest(db, organizationId, userId, { typeKey, title, details, websiteId = null, neededBy = null, brandSnapshot = null, revisionsIncluded = 2 }, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId);
  const type = getType(typeKey);
  if (!type) return fail("invalid_type");
  const t = validateName(title, 120);
  if (!t) return fail("invalid_title");
  if (websiteId !== null) requireId(websiteId, "website_id");
  if (neededBy !== null && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) return fail("invalid_date");
  if (!Number.isInteger(revisionsIncluded) || revisionsIncluded < 0 || revisionsIncluded > 20) return fail("invalid_revisions");
  const id = newId(), eid = newId(), at = isoTime(now), who = asStaff ? STAFF_MAY_WRITE : MEMBER_MAY_WRITE;
  const detailsJson = JSON.stringify(details || {}), brandJson = brandSnapshot ? JSON.stringify(brandSnapshot) : null;
  const linked = websiteId !== null;
  const base = `INSERT INTO requests (id, organization_id, kind, type_key, title, status, details_json, brand_snapshot_json, website_id, needed_by, revisions_included, submitted_by, created_at, status_changed_at, last_message_at, last_message_by, client_read_at)
     SELECT ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'client', ?
      WHERE ${who}
        AND (SELECT count(*) FROM requests r WHERE r.organization_id = ? AND r.status NOT IN ${OPEN}) < ?
        ${linked ? "AND EXISTS (SELECT 1 FROM websites w WHERE w.id = ? AND w.organization_id = ? AND w.published = 1 AND w.archived_at IS NULL)" : ""}`;
  const binds = [id, organizationId, type.kind, typeKey, t, detailsJson, brandJson, websiteId, neededBy, revisionsIncluded, userId, at, at, at, at, organizationId, userId, organizationId, MAX_OPEN_REQUESTS, ...(linked ? [websiteId, organizationId] : [])];
  let res;
  try {
    res = await db.batch([
      db.prepare(base).bind(...binds),
      db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, status_to, created_at) SELECT ?, ?, ?, 'status', 'client', ?, 'client', '', 'new', ? WHERE changes() > 0").bind(eid, organizationId, id, userId, at),
      audit(db, { organizationId, actorType: "client", actorRef: userId, action: "request.created", entityId: id, at, visibility: "client" }),
      notify(db, { organizationId, audience: "staff", event: "request_submitted", entityId: id, at }),
    ]);
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_request");
    throw err;
  }
  if (res[0].meta.changes !== 1) {
    const open = await db.prepare(`SELECT count(*) AS n FROM requests WHERE organization_id = ? AND status NOT IN ${OPEN}`).bind(organizationId).first();
    return fail(open.n >= MAX_OPEN_REQUESTS ? "too_many_open" : linked ? "website_not_found" : "not_allowed");
  }
  return ok({ id, eventId: eid });
}

/* ------------------------------------------------------------------ reads */

export async function getRequest(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  return r ? toRequest(r) : null;
}

export async function listClientRequests(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${REQ} FROM requests WHERE organization_id = ? ORDER BY last_message_at DESC, id LIMIT 300`).bind(organizationId).all()).results.map(toRequest);
}

const AUTHOR = "COALESCE(NULLIF(u.name, ''), 'Team member')";
/** What a client may see of a file: references and attachments on client-visible entries, proofs only once sent for review, finals only once completed. */
const CLIENT_FILE_VISIBLE = `(
    (f.role IN ('reference', 'attachment') AND e.visibility = 'client')
    OR (f.role = 'proof' AND EXISTS (SELECT 1 FROM request_events s WHERE s.organization_id = f.organization_id AND s.request_id = f.request_id AND s.status_to = 'client_review' AND s.created_at >= f.created_at))
    OR (f.role = 'final' AND EXISTS (SELECT 1 FROM requests r WHERE r.id = f.request_id AND r.organization_id = f.organization_id AND r.status = 'completed'))
  )`;
const FILE_COLS = "f.id, f.event_id, f.role, f.version, f.round, f.original_name, f.format, f.size_bytes, f.preview_key, f.preview_format, f.uploader_type, f.created_at";

export async function getClientThread(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  if (!r) return null;
  const events = (await db.prepare(`SELECT e.id, e.kind, e.author_type, e.visibility, e.body, e.status_to, e.ref_id, e.created_at, ${AUTHOR} AS author_name FROM request_events e LEFT JOIN portal_users u ON u.id = e.author_user_id WHERE e.organization_id = ? AND e.request_id = ? AND e.visibility = 'client' ORDER BY e.created_at, e.rowid`).bind(organizationId, requestId).all()).results;
  const files = (await db.prepare(`SELECT ${FILE_COLS} FROM request_files f JOIN request_events e ON e.id = f.event_id AND e.organization_id = f.organization_id WHERE f.organization_id = ? AND f.request_id = ? AND ${CLIENT_FILE_VISIBLE} ORDER BY f.created_at, f.rowid`).bind(organizationId, requestId).all()).results;
  const quotes = (await db.prepare("SELECT id, version, title, scope, amount_cents, tax_cents, tax_label, valid_until, status, created_at, decided_at, decided_via, accepted_name FROM request_quotes WHERE organization_id = ? AND request_id = ? AND status <> 'withdrawn' ORDER BY version").bind(organizationId, requestId).all()).results;
  return { request: toRequest(r), events: events.map(toEvent), files: files.map(toFile), quotes: quotes.map(toQuote) };
}

/** One file the client may open (same visibility rules), with its storage keys. null when it is not theirs, not visible yet, or not there. */
export async function getClientFile(db, organizationId, requestId, fileId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(fileId, "file_id");
  const f = await db.prepare(`SELECT ${FILE_COLS}, f.content_type, f.storage_key, f.preview_type FROM request_files f JOIN request_events e ON e.id = f.event_id AND e.organization_id = f.organization_id WHERE f.id = ? AND f.organization_id = ? AND f.request_id = ? AND ${CLIENT_FILE_VISIBLE}`).bind(fileId, organizationId, requestId).first();
  return f ? { ...toFile(f), storageKey: f.storage_key, previewKey: f.preview_key || null, contentType: f.content_type, previewType: f.preview_type || null } : null;
}

export async function markClientRead(db, organizationId, requestId, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  await db.prepare("UPDATE requests SET client_read_at = ? WHERE id = ? AND organization_id = ?").bind(isoTime(now), requestId, organizationId).run();
  return ok();
}

export async function getAdminThread(db, organizationId, requestId) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  const r = await db.prepare(`SELECT ${REQ} FROM requests WHERE id = ? AND organization_id = ?`).bind(requestId, organizationId).first();
  if (!r) return null;
  const events = (await db.prepare(`SELECT e.id, e.kind, e.author_type, e.author_user_id, e.author_label, e.visibility, e.body, e.status_to, e.ref_id, e.created_at, COALESCE(NULLIF(u.name, ''), u.email) AS author_name FROM request_events e LEFT JOIN portal_users u ON u.id = e.author_user_id WHERE e.organization_id = ? AND e.request_id = ? ORDER BY e.created_at, e.rowid`).bind(organizationId, requestId).all()).results;
  const staff = events.some((e) => e.author_user_id) ? await staffUserIds(db) : new Set();
  const files = (await db.prepare(`SELECT ${FILE_COLS} FROM request_files f WHERE f.organization_id = ? AND f.request_id = ? ORDER BY f.created_at, f.rowid`).bind(organizationId, requestId).all()).results;
  const quotes = (await db.prepare("SELECT id, version, title, scope, amount_cents, tax_cents, tax_label, valid_until, status, created_at, decided_at, decided_via, accepted_name FROM request_quotes WHERE organization_id = ? AND request_id = ? ORDER BY version").bind(organizationId, requestId).all()).results;
  const named = (e) => ({ ...toEvent({ ...e, author_name: e.author_user_id && staff.has(e.author_user_id) ? `${e.author_name || "Framework"} (Framework master access)` : e.author_name }), authorName: e.author_type === "staff" ? e.author_label || "Framework" : (e.author_user_id && staff.has(e.author_user_id) ? `${e.author_name || "Framework"} (Framework master access)` : e.author_name || "") });
  return { request: toRequest(r), events: events.map(named), files: files.map(toFile), quotes: quotes.map(toQuote) };
}

export async function getAdminFile(db, organizationId, requestId, fileId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(fileId, "file_id");
  const f = await db.prepare(`SELECT ${FILE_COLS}, f.content_type, f.storage_key, f.preview_type FROM request_files f WHERE f.id = ? AND f.organization_id = ? AND f.request_id = ?`).bind(fileId, organizationId, requestId).first();
  return f ? { ...toFile(f), storageKey: f.storage_key, previewKey: f.preview_key || null, contentType: f.content_type, previewType: f.preview_type || null } : null;
}

/** Every storage key this organization's requests hold (files and previews): the live set for orphan detection. */
export async function listRequestStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  const rows = (await db.prepare("SELECT storage_key, preview_key FROM request_files WHERE organization_id = ?").bind(organizationId).all()).results;
  return rows.flatMap((r) => [r.storage_key, r.preview_key]).filter(Boolean);
}

/* ------------------------------------------------------------------ the one move */

/**
 * Moves a request from `from` to `to` atomically. Fails with: not_found, conflict (the status is no longer `from`), not_allowed, not_permitted_move, and any `guard` the caller
 * names through `guardError` when an extra `where` condition is what refused it.
 */
async function move(db, { organizationId, requestId, from, to, actor, force = false, kind = "status", body = "", refId = null, set = "", setBinds = [], where = "", whereBinds = [], extra = [], notifyAudience = null, notifyEvent = "request_status", guardError = "not_allowed", now = new Date(), action = "request.status" }) {
  if (!force && !canMove(from, to, actor.type)) return fail("not_permitted_move");
  const at = isoTime(now), eid = newId(), done = to === "completed";
  const client = actor.type === "client";
  const seen = client ? "client_read_at = ?" : "admin_seen_at = ?";
  const sql = `UPDATE requests SET status = ?, status_changed_at = ?, last_message_at = ?, last_message_by = ?, ${seen}${done ? ", completed_at = ?" : ""}${set ? `, ${set}` : ""}
                WHERE id = ? AND organization_id = ? AND status = ?${where ? ` AND ${where}` : ""}${client ? ` AND ${WHO(actor)}` : ""}`;
  const binds = [to, at, at, client ? "client" : "staff", at, ...(done ? [at] : []), ...setBinds, requestId, organizationId, from, ...whereBinds, ...(client ? [organizationId, actor.userId] : [])];
  const eventInsert = client
    ? db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, status_to, ref_id, created_at) SELECT ?, ?, ?, ?, 'client', ?, 'client', ?, ?, ?, ? WHERE changes() > 0").bind(eid, organizationId, requestId, kind, actor.userId, body, to, refId, at)
    : db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, status_to, ref_id, created_at) SELECT ?, ?, ?, ?, 'staff', ?, 'client', ?, ?, ?, ? WHERE changes() > 0").bind(eid, organizationId, requestId, kind, actor.label, body, to, refId, at);
  const stmts = [db.prepare(sql).bind(...binds), eventInsert, ...extra,
    audit(db, { organizationId, actorType: client ? "client" : "admin", actorRef: client ? actor.userId : actor.label, action, entityId: requestId, at, visibility: "client" })];
  if (notifyAudience) stmts.push(notify(db, { organizationId, audience: notifyAudience, event: notifyEvent, entityId: requestId, at }));
  let res;
  try { res = await db.batch(stmts); } catch (err) { if (isConstraintViolation(err)) return fail("invalid_request"); throw err; }
  if (res[0].meta.changes === 1) return ok({ eventId: eid });
  const cur = await db.prepare("SELECT status FROM requests WHERE id = ? AND organization_id = ?").bind(requestId, organizationId).first();
  if (!cur) return fail("not_found");
  if (cur.status !== from) return fail("conflict");
  return fail(guardError);
}

const noteOf = (raw) => { const b = validateText(raw, MAX_BODY); return b === undefined ? undefined : b || ""; };

/* ------------------------------------------------------------------ messages */

export async function addClientMessage(db, organizationId, userId, requestId, bodyRaw, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id");
  const body = validateText(bodyRaw, MAX_BODY);
  if (!body) return fail(body === undefined ? "invalid_message" : "message_required");
  const mid = newId(), at = isoTime(now), who = asStaff ? STAFF_MAY_WRITE : MEMBER_MAY_WRITE;
  const res = await db.batch([
    db.prepare(`UPDATE requests SET last_message_at = ?, last_message_by = 'client', client_read_at = ? WHERE id = ? AND organization_id = ? AND status NOT IN ${OPEN} AND ${who}`).bind(at, at, requestId, organizationId, organizationId, userId),
    db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'client', ?, 'client', ?, ? WHERE changes() > 0").bind(mid, organizationId, requestId, userId, body, at),
    audit(db, { organizationId, actorType: "client", actorRef: userId, action: "request.message.client", entityId: requestId, at, visibility: "client" }),
    notify(db, { organizationId, audience: "staff", event: "request_client_reply", entityId: requestId, at }),
  ]);
  if (res[0].meta.changes === 1) return ok({ eventId: mid });
  const cur = await db.prepare("SELECT status FROM requests WHERE id = ? AND organization_id = ?").bind(requestId, organizationId).first();
  return fail(!cur ? "not_found" : isClosed(cur.status) ? "closed" : "not_allowed");
}

export async function markAdminSeen(db, organizationId, requestId, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  await db.prepare("UPDATE requests SET admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(isoTime(now), requestId, organizationId).run();
  return ok();
}

/** A Framework reply (visible to the client, queued as an email) or a private note (never shown or emailed). Allowed on closed requests too. */
export async function addStaffMessage(db, organizationId, requestId, bodyRaw, actor, { internal = false, now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const body = validateText(bodyRaw, MAX_BODY);
  if (!body) return fail(body === undefined ? "invalid_message" : "message_required");
  const mid = newId(), at = isoTime(now), visibility = internal ? "internal" : "client";
  const stmts = [
    internal
      ? db.prepare("UPDATE requests SET admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(at, requestId, organizationId)
      : db.prepare("UPDATE requests SET last_message_at = ?, last_message_by = 'staff', admin_seen_at = ? WHERE id = ? AND organization_id = ?").bind(at, at, requestId, organizationId),
    db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'staff', ?, ?, ?, ? WHERE changes() > 0").bind(mid, organizationId, requestId, actor.trim(), visibility, body, at),
    audit(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: internal ? "request.note.staff" : "request.message.staff", entityId: requestId, at, visibility }),
  ];
  if (!internal) stmts.push(notify(db, { organizationId, audience: "client", event: "request_staff_reply", entityId: requestId, at }));
  const res = await db.batch(stmts);
  return res[0].meta.changes === 1 ? ok({ eventId: mid }) : fail("not_found");
}

/* ------------------------------------------------------------------ client moves */

/** The client withdraws a request before it is approved. */
export async function clientCancel(db, organizationId, userId, requestId, noteRaw, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id");
  const note = noteOf(noteRaw);
  if (note === undefined) return fail("invalid_message");
  const cur = await getRequest(db, organizationId, requestId);
  if (!cur) return fail("not_found");
  if (!["new", "in_review", "quoted"].includes(cur.status)) return fail(cur.closed ? "closed" : "not_permitted_move");
  return move(db, { organizationId, requestId, from: cur.status, to: "cancelled", actor: clientActor(userId, asStaff), body: note, notifyAudience: "staff", notifyEvent: "request_client_reply", now, action: "request.cancelled" });
}

/** The client approves the current design. Needs a proof that was sent for review in the current round. The request is then Completed and its final files are released. */
export async function clientApproveProof(db, organizationId, userId, requestId, noteRaw, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id");
  const note = noteOf(noteRaw);
  if (note === undefined) return fail("invalid_message");
  const cur = await getRequest(db, organizationId, requestId);
  if (!cur) return fail("not_found");
  if (cur.status !== "client_review") return fail(cur.closed ? "closed" : "not_permitted_move");
  const proof = await latestProof(db, organizationId, requestId, cur.revisionsUsed, { clientVisible: true });
  if (!proof) return fail("no_proof");
  return move(db, { organizationId, requestId, from: "client_review", to: "completed", actor: clientActor(userId, asStaff), kind: "approval", body: note, refId: proof.id, notifyAudience: "staff", notifyEvent: "request_client_reply", now, action: "request.approved" });
}

/** The client asks for changes to the current design. A comment is required. Refused (revision_limit) when every included and paid round has been used. */
export async function clientRequestRevision(db, organizationId, userId, requestId, noteRaw, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id");
  const note = validateText(noteRaw, MAX_BODY);
  if (!note) return fail(note === undefined ? "invalid_message" : "message_required");
  const cur = await getRequest(db, organizationId, requestId);
  if (!cur) return fail("not_found");
  if (cur.status !== "client_review") return fail(cur.closed ? "closed" : "not_permitted_move");
  return move(db, { organizationId, requestId, from: "client_review", to: "revision_requested", actor: clientActor(userId, asStaff), kind: "revision", body: note,
    set: "revisions_used = revisions_used + 1", where: "revisions_used < revisions_included + revisions_paid", guardError: "revision_limit", notifyAudience: "staff", notifyEvent: "request_client_reply", now, action: "request.revision" });
}

/** The newest proof of a round (the one the client is asked to review). */
async function latestProof(db, organizationId, requestId, round, { clientVisible = false } = {}) {
  const vis = clientVisible ? "AND EXISTS (SELECT 1 FROM request_events s WHERE s.organization_id = f.organization_id AND s.request_id = f.request_id AND s.status_to = 'client_review' AND s.created_at >= f.created_at)" : "";
  return db.prepare(`SELECT f.id, f.version FROM request_files f WHERE f.organization_id = ? AND f.request_id = ? AND f.role = 'proof' AND f.round = ? ${vis} ORDER BY f.version DESC LIMIT 1`).bind(organizationId, requestId, round).first();
}

/* ------------------------------------------------------------------ quotes */

export async function createQuote(db, organizationId, requestId, { title, scope, amountCents, validUntil = null }, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const t = validateName(title, 120), sc = validateText(scope, 2000);
  if (!t) return fail("invalid_title");
  if (!sc) return fail(sc === undefined ? "invalid_scope" : "scope_required");
  if (!Number.isInteger(amountCents) || amountCents < 0 || amountCents > 100_000_000_000) return fail("invalid_amount");
  if (validUntil !== null && !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return fail("invalid_date");
  const id = newId(), eid = newId(), at = isoTime(now), label = actor.trim();
  const live = "EXISTS (SELECT 1 FROM requests r WHERE r.id = ? AND r.organization_id = ? AND r.status IN ('new', 'in_review', 'quoted'))";
  let res;
  try {
    res = await db.batch([
      db.prepare(`UPDATE request_quotes SET status = 'superseded' WHERE organization_id = ? AND request_id = ? AND status = 'sent' AND ${live}`).bind(organizationId, requestId, requestId, organizationId),
      db.prepare(`INSERT INTO request_quotes (id, organization_id, request_id, version, title, scope, amount_cents, valid_until, status, created_by, created_at)
                  SELECT ?, ?, ?, COALESCE((SELECT MAX(version) FROM request_quotes WHERE request_id = ?), 0) + 1, ?, ?, ?, ?, 'sent', ?, ? WHERE ${live}`).bind(id, organizationId, requestId, requestId, t, sc, amountCents, validUntil, label, at, requestId, organizationId),
      db.prepare("UPDATE requests SET status = 'quoted', status_changed_at = ?, last_message_at = ?, last_message_by = 'staff', admin_seen_at = ? WHERE id = ? AND organization_id = ? AND status IN ('new', 'in_review', 'quoted') AND changes() > 0").bind(at, at, at, requestId, organizationId),
      db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, status_to, ref_id, created_at) SELECT ?, ?, ?, 'quote', 'staff', ?, 'client', ?, 'quoted', ?, ? WHERE changes() > 0").bind(eid, organizationId, requestId, label, t, id, at),
      audit(db, { organizationId, actorType: "admin", actorRef: label, action: "request.quote.sent", entityId: requestId, at, visibility: "client" }),
      notify(db, { organizationId, audience: "client", event: "request_status", entityId: requestId, at }),
    ]);
  } catch (err) { if (isConstraintViolation(err)) return fail("invalid_request"); throw err; }
  if (res[1].meta.changes !== 1) return fail((await getRequest(db, organizationId, requestId)) ? "conflict" : "not_found");
  return ok({ id, eventId: eid });
}

export async function withdrawQuote(db, organizationId, requestId, quoteId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(quoteId, "quote_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const res = await db.prepare("UPDATE request_quotes SET status = 'withdrawn' WHERE id = ? AND organization_id = ? AND request_id = ? AND status = 'sent'").bind(quoteId, organizationId, requestId).run();
  if (res.meta.changes !== 1) return fail("not_found");
  await db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) VALUES (?, ?, 'admin', ?, 'request.quote.withdrawn', 'request', ?, 'internal', ?)").bind(newId(), organizationId, actor.trim(), requestId, isoTime(now)).run();
  return ok();
}

/**
 * Records that the quote was agreed. `via` is "portal" (the client accepted it: only reachable through quote-gate.js, which stays closed until terms exist) or "staff_record"
 * (Framework recorded an agreement made outside the portal). Also usable with no quote at all (staff, from in_review) for work that needs none.
 */
export async function approveRequest(db, organizationId, requestId, { via, quoteId = null, userId = null, acceptedName = null, termsVersion = null, note = "", actorLabel = null, asStaff = false }, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!["portal", "staff_record"].includes(via)) return fail("invalid_via");
  const cur = await getRequest(db, organizationId, requestId);
  if (!cur) return fail("not_found");
  const from = cur.status;
  if (!(via === "portal" ? from === "quoted" : ["quoted", "in_review"].includes(from))) return fail(cur.closed ? "closed" : "not_permitted_move");
  const at = isoTime(now);
  const actor = via === "portal" ? clientActor(requireUserId(userId) || userId, asStaff) : staffActor(actorLabel || "");
  if (via === "staff_record" && !validActor(actorLabel)) return fail("invalid_actor");
  const nm = acceptedName == null ? null : validateName(acceptedName, 120);
  if (via === "portal" && !nm) return fail("name_required");
  const extra = [];
  if (quoteId) {
    requireId(quoteId, "quote_id");
    extra.push(db.prepare("UPDATE request_quotes SET status = 'accepted', decided_at = ?, decided_by = ?, decided_via = ?, accepted_name = ?, terms_version = ? WHERE id = ? AND organization_id = ? AND request_id = ? AND status = 'sent' AND changes() > 0").bind(at, via === "portal" ? userId : null, via, via === "portal" ? nm : null, via === "portal" ? termsVersion : null, quoteId, organizationId, requestId));
  } else if (from === "quoted") {
    return fail("quote_required");
  }
  const n = noteOf(note);
  if (n === undefined) return fail("invalid_message");
  // the quote update above runs AFTER the event insert in move()'s chain, so its own changes() guard sees the event insert (1) and the quote must still be 'sent'
  const r = await move(db, { organizationId, requestId, from, to: "approved", actor, force: true, kind: "approval", body: n, refId: quoteId, extra,
    where: quoteId ? "EXISTS (SELECT 1 FROM request_quotes q WHERE q.id = ? AND q.organization_id = ? AND q.request_id = ? AND q.status = 'sent')" : "", whereBinds: quoteId ? [quoteId, organizationId, requestId] : [],
    guardError: "quote_not_open", notifyAudience: via === "portal" ? "staff" : "client", notifyEvent: via === "portal" ? "request_client_reply" : "request_status", now, action: "request.approved" });
  return r;
}

/** The client declines the current quote; the request goes back to review for Framework to revise it. */
export async function declineQuote(db, organizationId, userId, requestId, quoteId, noteRaw, { now = new Date(), asStaff = false } = {}) {
  requireOrgId(organizationId); requireUserId(userId); requireId(requestId, "request_id"); requireId(quoteId, "quote_id");
  const note = noteOf(noteRaw);
  if (note === undefined) return fail("invalid_message");
  const at = isoTime(now);
  return move(db, { organizationId, requestId, from: "quoted", to: "in_review", actor: clientActor(userId, asStaff), force: true, kind: "revision", body: note || "Quote declined.", refId: quoteId,
    where: "EXISTS (SELECT 1 FROM request_quotes q WHERE q.id = ? AND q.organization_id = ? AND q.request_id = ? AND q.status = 'sent')", whereBinds: [quoteId, organizationId, requestId],
    extra: [db.prepare("UPDATE request_quotes SET status = 'declined', decided_at = ?, decided_by = ?, decided_via = 'portal' WHERE id = ? AND organization_id = ? AND request_id = ? AND status = 'sent' AND changes() > 0").bind(at, userId, quoteId, organizationId, requestId)],
    guardError: "quote_not_open", notifyAudience: "staff", notifyEvent: "request_client_reply", now, action: "request.quote.declined" });
}

/* ------------------------------------------------------------------ staff moves */

/** A staff status change. "quoted" only comes from createQuote; "approved" only from approveRequest; this covers the rest. */
export async function setStatus(db, organizationId, requestId, to, actor, { note = "", now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (["quoted", "approved"].includes(to)) return fail("use_quote_or_approval");
  const n = noteOf(note);
  if (n === undefined) return fail("invalid_message");
  const cur = await getRequest(db, organizationId, requestId);
  if (!cur) return fail("not_found");
  let where = "", whereBinds = [], guardError = "not_allowed";
  if (to === "client_review") {
    // a design can only be sent for review when a proof exists for the current round
    where = "EXISTS (SELECT 1 FROM request_files f WHERE f.organization_id = requests.organization_id AND f.request_id = requests.id AND f.role = 'proof' AND f.round = requests.revisions_used)";
    guardError = "no_proof";
  }
  const client = ["completed", "declined", "client_review"].includes(to) ? "client" : null;
  return move(db, { organizationId, requestId, from: cur.status, to, actor: staffActor(actor), body: n, where, whereBinds, guardError, notifyAudience: client, notifyEvent: "request_status", now, action: "request.status" });
}

/** Extra paid revision rounds Framework has agreed with the client (the architecture's hook for paid revisions; nothing is charged here). */
export async function grantRevisions(db, organizationId, requestId, count, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!Number.isInteger(count) || count < 1 || count > 10) return fail("invalid_count");
  const at = isoTime(now), eid = newId();
  const res = await db.batch([
    db.prepare("UPDATE requests SET revisions_paid = revisions_paid + ?, admin_seen_at = ? WHERE id = ? AND organization_id = ? AND revisions_paid + ? <= 20").bind(count, at, requestId, organizationId, count),
    db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, created_at) SELECT ?, ?, ?, 'message', 'staff', ?, 'internal', ?, ? WHERE changes() > 0").bind(eid, organizationId, requestId, actor.trim(), `Granted ${count} additional revision round${count === 1 ? "" : "s"}.`, at),
    audit(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "request.revisions.granted", entityId: requestId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/* ------------------------------------------------------------------ files (metadata; files.js stores the object first) */

/**
 * Records one stored file on a timeline entry. Client references and attachments are limited to MAX_FILES_PER_REQUEST per request inside the insert; proofs get the next version
 * of their round; only staff may add proofs and finals (the database enforces it too).
 */
export async function createFile(db, organizationId, requestId, eventId, role, uploaderType, file, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(eventId, "event_id");
  if (!["reference", "attachment", "proof", "final"].includes(role)) return fail("invalid_role");
  if (!["client", "staff"].includes(uploaderType)) return fail("invalid_uploader");
  if (role === "proof" || role === "final") { if (uploaderType !== "staff") return fail("forbidden"); }
  else if (!(file.size <= MAX_FILE_BYTES)) return fail("file_too_large");
  const id = newId(), at = isoTime(now);
  const limit = role === "reference" || role === "attachment" ? "AND (SELECT count(*) FROM request_files x WHERE x.organization_id = ? AND x.request_id = ? AND x.role IN ('reference', 'attachment')) < ?" : "";
  const limitBinds = limit ? [organizationId, requestId, MAX_FILES_PER_REQUEST] : [];
  let res;
  try {
    res = await db.prepare(
      `INSERT INTO request_files (id, organization_id, request_id, event_id, role, version, round, original_name, format, content_type, size_bytes, sha256, storage_key, uploader_type, created_at)
       SELECT ?, ?, ?, ?, ?,
              ${role === "proof" ? "COALESCE((SELECT MAX(x.version) FROM request_files x WHERE x.request_id = r.id AND x.organization_id = r.organization_id AND x.role = 'proof'), 0) + 1" : "1"},
              ${role === "proof" ? "r.revisions_used" : "0"}, ?, ?, ?, ?, ?, ?, ?, ?
         FROM requests r WHERE r.id = ? AND r.organization_id = ? ${limit}`,
    ).bind(id, organizationId, requestId, eventId, role, file.name, file.ext, file.contentType, file.size, file.sha256, file.storageKey, uploaderType, at, requestId, organizationId, ...limitBinds).run();
  } catch (err) { if (isConstraintViolation(err)) return fail("invalid_attachment"); throw err; }
  return res.meta.changes === 1 ? ok({ id }) : fail((await getRequest(db, organizationId, requestId)) ? "too_many_files" : "not_found");
}

/** A timeline entry that only carries files (a proof, a final delivery, a staff attachment). Staff only. visibility internal keeps drafts out of the client's timeline. */
export async function addFileEvent(db, organizationId, requestId, kind, actor, { body = "", visibility = "internal", now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!["proof", "delivery", "message"].includes(kind)) return fail("invalid_kind");
  const eid = newId(), at = isoTime(now);
  const res = await db.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, created_at) SELECT ?, ?, ?, ?, 'staff', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM requests r WHERE r.id = ? AND r.organization_id = ?)").bind(eid, organizationId, requestId, kind, actor.trim(), visibility, body, at, requestId, organizationId).run();
  return res.meta.changes === 1 ? ok({ eventId: eid }) : fail("not_found");
}

/** A client file event: the message the reference files belong to (created when a request is made or a reply carries files). */
export async function getEventKind(db, organizationId, requestId, eventId) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(eventId, "event_id");
  return db.prepare("SELECT id, kind, author_type, visibility FROM request_events WHERE id = ? AND organization_id = ? AND request_id = ?").bind(eventId, organizationId, requestId).first();
}

export async function setPreview(db, organizationId, requestId, fileId, preview) {
  requireOrgId(organizationId); requireId(requestId, "request_id"); requireId(fileId, "file_id");
  const res = await db.prepare("UPDATE request_files SET preview_key = ?, preview_format = ?, preview_type = ?, preview_size = ?, preview_sha256 = ? WHERE id = ? AND organization_id = ? AND request_id = ? AND role = 'proof' AND preview_key IS NULL")
    .bind(preview.storageKey, preview.ext, preview.contentType, preview.size, preview.sha256, fileId, organizationId, requestId).run();
  return res.meta.changes === 1 ? ok() : fail("not_found");
}

export async function countFiles(db, organizationId, requestId, role) {
  const r = await db.prepare("SELECT count(*) AS n FROM request_files WHERE organization_id = ? AND request_id = ? AND role = ?").bind(organizationId, requestId, role).first();
  return r.n;
}

/* ------------------------------------------------------------------ summaries and lists */

/** Counts for the client's navigation and Home: open requests and the ones that wait for THEM. owner: whether this person may act on quotes. */
export async function clientSummary(db, organizationId, { owner = false } = {}) {
  const all = await listClientRequests(db, organizationId);
  const open = all.filter((r) => !r.closed);
  const actions = open.map((r) => ({ r, reason: clientActionReason(r, { owner }) })).filter((x) => x.reason);
  return { total: all.length, open: open.length, actions: actions.map((x) => ({ id: x.r.id, title: x.r.title, kind: x.r.kind, typeKey: x.r.typeKey, typeLabel: x.r.typeLabel, status: x.r.status, reason: x.reason })), actionCount: actions.length };
}

export const attentionReason = staffAttentionReason;

/** Requests of EVERY organization (Framework Admin only), with the organization's name and why each needs attention. scope: attention | open | closed | all */
export async function listRequestsAllAdmin(db, { scope = "attention", limit = 200 } = {}) {
  const rows = (await db.prepare(`SELECT ${REQ.split(", ").map((c) => `r.${c}`).join(", ")}, o.name AS org_name FROM requests r JOIN organizations o ON o.id = r.organization_id ORDER BY r.last_message_at DESC, r.id LIMIT ?`).bind(Math.min(limit, 500)).all()).results;
  const items = rows.map((r) => { const q = toRequest(r); return { ...q, orgName: r.org_name, reason: staffAttentionReason(q) }; });
  if (scope === "attention") return items.filter((x) => x.reason);
  if (scope === "open") return items.filter((x) => !x.closed);
  if (scope === "closed") return items.filter((x) => x.closed);
  return items;
}

export async function listRequestsAdmin(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${REQ} FROM requests WHERE organization_id = ? ORDER BY last_message_at DESC, id`).bind(organizationId).all()).results.map((r) => { const q = toRequest(r); return { ...q, reason: staffAttentionReason(q) }; });
}

export async function adminTotals(db) {
  const rows = (await db.prepare(`SELECT ${REQ} FROM requests ORDER BY last_message_at DESC LIMIT 500`).all()).results.map(toRequest);
  return { open: rows.filter((r) => !r.closed).length, attention: rows.filter((r) => staffAttentionReason(r)).length };
}

/* ------------------------------------------------------------------ per-service settings */

export async function listTypeSettings(db) {
  return new Map((await db.prepare("SELECT type_key, enabled, revisions_included, pricing_mode, fixed_price_cents, turnaround_note FROM request_type_settings").all()).results.map((r) => [r.type_key, r]));
}

export async function saveTypeSettings(db, typeKey, { enabled = true, revisionsIncluded = null, pricingMode = "quote", fixedPriceCents = null, turnaroundNote = null }, actor, { now = new Date() } = {}) {
  if (!getType(typeKey)) return fail("invalid_type");
  if (!validActor(actor)) return fail("invalid_actor");
  if (revisionsIncluded !== null && !(Number.isInteger(revisionsIncluded) && revisionsIncluded >= 0 && revisionsIncluded <= 20)) return fail("invalid_revisions");
  if (!["quote", "fixed"].includes(pricingMode)) return fail("invalid_pricing");
  if (pricingMode === "fixed" && !(Number.isInteger(fixedPriceCents) && fixedPriceCents >= 0 && fixedPriceCents <= 100_000_000_000)) return fail("invalid_price");
  const note = turnaroundNote == null || turnaroundNote === "" ? null : validateName(turnaroundNote, 120);
  if (turnaroundNote && !note) return fail("invalid_turnaround");
  try {
    await db.prepare(`INSERT INTO request_type_settings (type_key, enabled, revisions_included, pricing_mode, fixed_price_cents, turnaround_note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                      ON CONFLICT (type_key) DO UPDATE SET enabled = excluded.enabled, revisions_included = excluded.revisions_included, pricing_mode = excluded.pricing_mode, fixed_price_cents = excluded.fixed_price_cents, turnaround_note = excluded.turnaround_note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(typeKey, enabled ? 1 : 0, revisionsIncluded, pricingMode, pricingMode === "fixed" ? fixedPriceCents : null, note, actor.trim(), isoTime(now)).run();
  } catch (err) { if (isConstraintViolation(err)) return fail("invalid_settings"); throw err; }
  return ok();
}

export { CLOSED, STATUS_LABEL, kindOf };
