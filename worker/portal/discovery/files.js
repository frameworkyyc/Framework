/**
 * Files for Discovery: the recipient's inspiration uploads (private R2, org/<id>/discovery/<uuid>) and the Admin's reference pictures for options (the reserved catalogue
 * area, exactly like Additional Services pictures). Same discipline as every other upload here: the type is decided from the file's CONTENT, the object is written before
 * a row points at it, a failed row write removes the object again, objects are stored as application/octet-stream, and no storage key ever leaves the server.
 */
import { ok, fail } from "../repo/common.js";
import * as repo from "../repo/discovery.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, StorageError, fileResponse } from "../files/index.js";
// Same reserved reference-image namespace used on Staging.
export const CATALOGUE_ORG = "00000000-0000-4000-8000-0000000000ca";

export const REFERENCE_MAX_BYTES = 5 * 1024 * 1024;
const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());
const need = (deps) => (deps.bucket && typeof deps.bucket.put === "function" ? null : fail("storage_unavailable"));

/** A recipient adds one inspiration file. `by` = { type, ref } for the audit entry. */
export async function addInspiration(deps, { assessment, file, by }) {
  const unavailable = need(deps);
  if (unavailable) return unavailable;
  if (assessment.status !== "not_started" && assessment.status !== "in_progress") return fail("closed");
  const usage = await repo.uploadUsage(deps.db, assessment.organizationId, assessment.id);
  if (usage.files >= repo.MAX_UPLOADS) return fail("file_limit");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "discovery_inspiration", maxBytes: repo.MAX_UPLOAD_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  if (usage.bytes + inspected.size > repo.MAX_UPLOAD_TOTAL) return fail("quota_exceeded");
  const key = makeKey(assessment.organizationId, "discovery");
  try { await putObject(deps.bucket, { key, organizationId: assessment.organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await repo.addUpload(deps.db, assessment, { name: inspected.name, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256, key }, by, { now: deps.now }); } catch (err) { await drop(deps, assessment.organizationId, key); throw err; }
  if (!rec.ok) { await drop(deps, assessment.organizationId, key); return rec; }
  return ok({ id: rec.id });
}

export async function removeInspiration(deps, { assessment, uploadId, by }) {
  const rec = await repo.getUpload(deps.db, assessment.organizationId, assessment.id, uploadId);
  if (!rec) return fail("not_found");
  const done = await repo.removeUpload(deps.db, assessment, uploadId, by, { now: deps.now });
  if (!done.ok) return done;
  await drop(deps, assessment.organizationId, rec.storageKey);
  return ok();
}

/** Admin only: the file as a download (never inline; the browser must not interpret a client's file). */
export async function adminDownloadInspiration(deps, { organizationId, assessmentId, uploadId }) {
  const rec = await repo.getUpload(deps.db, organizationId, assessmentId, uploadId);
  if (!rec) return fail("not_found");
  let object;
  try { object = await getObject(deps.bucket, { key: rec.storageKey, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  return ok({ response: fileResponse({ object, name: rec.name, ext: rec.format, inlineImage: false, size: rec.size }) });
}

async function drop(deps, organizationId, key) {
  try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* an unreferenced object: the storage orphan check lists it */ }
}

/* ------------------------------------------------------------------ Admin reference pictures */

export async function adminSetReference(deps, { contentId, file, alt, actor }) {
  const unavailable = need(deps);
  if (unavailable) return unavailable;
  const row = await repo.getContentRow(deps.db, contentId);
  if (!row) return fail("not_found");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "website_image", maxBytes: REFERENCE_MAX_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const key = makeKey(CATALOGUE_ORG, "catalogue");
  try { await putObject(deps.bucket, { key, organizationId: CATALOGUE_ORG, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await repo.setContentImage(deps.db, contentId, { key, type: inspected.ext, sha256: inspected.sha256, size: inspected.size, alt }, actor, { now: deps.now }); } catch (err) { await drop(deps, CATALOGUE_ORG, key); throw err; }
  if (!rec.ok) { await drop(deps, CATALOGUE_ORG, key); return rec; }
  if (row.image_key) await drop(deps, CATALOGUE_ORG, row.image_key); // the replaced picture is removed
  return ok();
}

export async function adminClearReference(deps, { contentId, actor }) {
  const row = await repo.getContentRow(deps.db, contentId);
  if (!row) return fail("not_found");
  if (!row.image_key) return ok();
  const rec = await repo.setContentImage(deps.db, contentId, null, actor, { now: deps.now });
  if (!rec.ok) return rec;
  await drop(deps, CATALOGUE_ORG, row.image_key);
  return ok();
}

/** A reference picture, inline. The caller has already proved who is asking (a valid guest link, a signed-in member, or Admin). */
export async function referenceResponse(deps, { contentId }) {
  const row = await repo.getContentRow(deps.db, contentId);
  if (!row || !row.image_key) return fail("not_found");
  let object;
  try { object = await getObject(deps.bucket, { key: row.image_key, organizationId: CATALOGUE_ORG }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  return ok({ response: fileResponse({ object, name: `reference-${row.item_key}`, ext: row.image_type, inlineImage: true, size: row.image_size }) });
}
