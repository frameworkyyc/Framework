/**
 * Support request file service: attachments on a request (client or Framework). Combines permission checks, file validation, private storage and the database,
 * like brand-files.js. Organization ids come from the signed-in membership (client) or the Admin route (staff), never from request data.
 *
 *   validate ALL files first (so a bad third file does not leave the message half-attached), then for each: put the object, record it (the 3-per-request limit is
 *   enforced inside the insert), and remove the object again if the record is refused. Attachments are never deleted here: they stay with their request for its
 *   retention period (CLIENT-SERVICES.md). A download is recorded (who, what, when; never an address or a key).
 */
import { can } from "./policy.js";
import { ok, fail } from "./repo/common.js";
import * as sup from "./repo/support.js";
import { recordActivity } from "./repo/activity.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, fileResponse, StorageError } from "./files/index.js";

const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());

/** Inspects every file; returns the inspected list or the first problem (with the file's position so the page can say which one). */
export async function inspectAll(files) {
  if (!Array.isArray(files) || files.length > sup.MAX_ATTACHMENTS) return fail("too_many_attachments");
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const r = await inspectUpload({ bytes: files[i].bytes, originalName: files[i].name, profile: "support", maxBytes: sup.MAX_ATTACHMENT_BYTES });
    if (!r.ok) return fail(r.error, { index: i, name: files[i].name });
    out.push({ inspected: r, bytes: files[i].bytes });
  }
  return ok({ files: out });
}

/** Stores already-inspected files on a message. Returns how many were attached and how many failed (the message itself is already saved). */
export async function attachInspected(deps, { organizationId, requestId, messageId, uploaderType, files }) {
  let attached = 0, failed = 0, error = null;
  for (const { inspected, bytes } of files) {
    const key = makeKey(organizationId, "support");
    try { await putObject(deps.bucket, { key, organizationId, bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { failed++; error = error || (err instanceof StorageError ? err.code : "storage_write_failed"); continue; }
    let rec;
    try { rec = await sup.createAttachment(deps.db, organizationId, requestId, messageId, uploaderType, { name: inspected.name, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256, storageKey: key }, { now: deps.now }); }
    catch (err) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* unreferenced object: findOrphanObjects lists it */ } throw err; }
    if (rec.ok) attached++;
    else { failed++; error = error || rec.error; try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* as above */ } }
  }
  return { attached, failed, error };
}

/** A new request with optional attachments. deps: { db, bucket, env?, now? } */
export async function clientCreateRequest(deps, { role, organizationId, userId, category, title, description, websiteId = null, files = [] }) {
  if (!can(role, "support.submit")) return fail("forbidden");
  const checked = await inspectAll(files);
  if (!checked.ok) return checked;
  if (checked.files.length && !deps.bucket) return fail("storage_unavailable");
  const made = await sup.createRequest(deps.db, organizationId, userId, { category, title, description, websiteId }, { now: deps.now });
  if (!made.ok) return made;
  const att = await attachInspected(deps, { organizationId, requestId: made.id, messageId: made.messageId, uploaderType: "client", files: checked.files });
  return ok({ id: made.id, attached: att.attached, attachmentsFailed: att.failed });
}

export async function clientReply(deps, { role, organizationId, userId, requestId, body, files = [] }) {
  if (!can(role, "support.submit")) return fail("forbidden");
  const checked = await inspectAll(files);
  if (!checked.ok) return checked;
  if (checked.files.length && !deps.bucket) return fail("storage_unavailable");
  const cur = await sup.getRequest(deps.db, organizationId, requestId);
  if (cur && checked.files.length) {
    const existing = (await sup.getClientThread(deps.db, organizationId, requestId)).attachments.length;
    if (existing + checked.files.length > sup.MAX_ATTACHMENTS) return fail("too_many_attachments");
  }
  const added = await sup.addClientMessage(deps.db, organizationId, userId, requestId, body, { now: deps.now });
  if (!added.ok) return added;
  const att = await attachInspected(deps, { organizationId, requestId, messageId: added.messageId, uploaderType: "client", files: checked.files });
  return ok({ attached: att.attached, attachmentsFailed: att.failed });
}

async function stream(deps, { organizationId, requestId, row, actorType, actorRef }) {
  let object;
  try { object = await getObject(deps.bucket, { key: row.storageKey, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  await recordActivity(deps.db, { organizationId, actorType, actorRef, action: "support.attachment.download", entityType: "support_request", entityId: requestId, visibility: "internal" }, { now: deps.now });
  return ok({ response: fileResponse({ object, name: row.name, ext: row.format, inlineImage: false, size: row.size }) });
}

/** Client download. A file on a private staff note, another organization's file or another request's file is the same "not_found". */
export async function clientDownloadAttachment(deps, { role, organizationId, userId, requestId, attachmentId }) {
  if (!can(role, "support.view")) return fail("forbidden");
  const row = await sup.getClientAttachment(deps.db, organizationId, requestId, attachmentId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, requestId, row, actorType: "client", actorRef: userId });
}

/** Framework Admin: attach one file to a staff message of the request. */
export async function adminAttach(deps, { organizationId, requestId, messageId, file }) {
  const msg = await sup.getMessage(deps.db, organizationId, requestId, messageId);
  if (!msg || msg.authorType !== "staff") return fail("not_found");
  const checked = await inspectAll([file]);
  if (!checked.ok) return checked;
  const att = await attachInspected(deps, { organizationId, requestId, messageId, uploaderType: "staff", files: checked.files });
  return att.attached ? ok({}) : fail(att.error || "storage_write_failed");
}

export async function adminDownloadAttachment(deps, { organizationId, requestId, attachmentId, actor }) {
  const row = await sup.getAdminAttachment(deps.db, organizationId, requestId, attachmentId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, requestId, row, actorType: "admin", actorRef: actor });
}
