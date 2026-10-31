/**
 * Pictures for the Additional Services catalogue (screenshots, product previews, real examples): Admin uploads them, any signed-in client sees those of an ENABLED service, through an
 * authorised route only. One private image object each in the files bucket under the RESERVED catalogue area (a fixed organization id that no client has: the catalogue is global), kept in
 * step with the row in portal_service_media (repo/service-catalogue-state.js): the type is checked against the file's CONTENT, the object is written before the row points at it,
 * a failed row write removes the object again, and nothing here returns a storage key. png, jpg and webp only, at most 5 MB.
 */
import { ok, fail } from "./repo/common.js";
import * as media from "./repo/service-catalogue-state.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, StorageError, fileResponse } from "./files/index.js";

export const CATALOGUE_ORG = "00000000-0000-4000-8000-0000000000ca";
export const MEDIA_MAX_BYTES = 5 * 1024 * 1024;
const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());

export async function adminAddMedia(deps, { serviceKey, actor, file, meta }) {
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "website_image", maxBytes: MEDIA_MAX_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const key = makeKey(CATALOGUE_ORG, "catalogue");
  try { await putObject(deps.bucket, { key, organizationId: CATALOGUE_ORG, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await media.addServiceMedia(deps.db, serviceKey, { key, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256 }, meta, actor, { now: deps.now }); } catch (err) { rec = null; await dropObject(deps, key); throw err; }
  if (!rec.ok) { await dropObject(deps, key); return rec; }
  return ok({ id: rec.id });
}

export async function adminDeleteMedia(deps, { id, actor }) {
  const rec = await media.deleteServiceMedia(deps.db, id, actor, { now: deps.now });
  if (!rec.ok) return rec;
  await dropObject(deps, rec.key); // the picture is deleted from storage at once
  return ok();
}

async function dropObject(deps, key) {
  try { await deleteObject(deps.bucket, { key, organizationId: CATALOGUE_ORG }); } catch { /* an unreferenced object: the storage orphan check lists it */ }
}

/** The picture as an inline image: for Admin always, for a client only when its service is shown. Never a download, sandboxed headers like every file. */
export async function mediaResponse(deps, { id, clientOnly }) {
  const rec = await media.getServiceMediaRecord(deps.db, id, { clientOnly });
  if (!rec) return fail("not_found");
  let object;
  try { object = await getObject(deps.bucket, { key: rec.key, organizationId: CATALOGUE_ORG }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  return ok({ response: fileResponse({ object, name: `service-${rec.serviceKey}`, ext: rec.format, inlineImage: true, size: rec.size }) });
}
