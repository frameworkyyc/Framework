/**
 * A website's optional screenshot (Admin only in this phase): one private image in the files bucket, kept in step with the row in `websites` (repo/websites.js). Same rules as every
 * other file: the type is checked against the file's CONTENT, the object is written before the row points at it, a failed row update removes the object again, and nothing here
 * returns a storage key. Only png, jpg and webp are accepted, at most 5 MB. The client-facing display arrives with the dashboard phase.
 */
import { ok, fail } from "./repo/common.js";
import * as websites from "./repo/websites.js";
import { recordActivity } from "./repo/activity.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, StorageError, fileResponse } from "./files/index.js";

export const SCREENSHOT_MAX_BYTES = 5 * 1024 * 1024;
const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());

async function removeObject(deps, organizationId, key, websiteId) {
  if (!key) return;
  try { await deleteObject(deps.bucket, { key, organizationId }); } catch {
    // the row no longer points at it: an unreferenced object the orphan check will list. Record that it needs attention (ids only).
    await recordActivity(deps.db, { organizationId, actorType: "system", actorRef: "website-files", action: "website.storage.cleanup_failed", entityType: "website", entityId: websiteId, visibility: "internal" }, { now: deps.now });
  }
}

/** Set or replace the screenshot of a (not archived) website. */
export async function adminSetScreenshot(deps, { organizationId, websiteId, actor, file }) {
  const site = await websites.getWebsiteAdmin(deps.db, organizationId, websiteId);
  if (!site || site.archivedAt) return fail("not_found");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "website_image", maxBytes: SCREENSHOT_MAX_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const key = makeKey(organizationId, "websites");
  try { await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await websites.setScreenshot(deps.db, organizationId, websiteId, { key, name: inspected.name, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256 }, actor, { now: deps.now }); } catch (err) { await removeObject(deps, organizationId, key, websiteId); throw err; }
  if (!rec.ok) { await removeObject(deps, organizationId, key, websiteId); return rec; }
  await removeObject(deps, organizationId, rec.previousKey, websiteId); // the replaced picture is deleted at once
  return ok({ name: inspected.name });
}

export async function adminRemoveScreenshot(deps, { organizationId, websiteId, actor }) {
  const rec = await websites.clearScreenshot(deps.db, organizationId, websiteId, actor, { now: deps.now });
  if (!rec.ok) return rec;
  await removeObject(deps, organizationId, rec.previousKey, websiteId);
  return ok();
}

/** The screenshot as an inline picture for the Admin page (never recorded as a download; sandboxed headers like every file). */
export async function adminScreenshotResponse(deps, { organizationId, websiteId }) {
  const rec = await websites.getScreenshotRecord(deps.db, organizationId, websiteId);
  if (!rec) return fail("not_found");
  let object;
  try { object = await getObject(deps.bucket, { key: rec.key, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  return ok({ response: fileResponse({ object, name: rec.name, ext: rec.format, inlineImage: true, size: rec.size }) });
}
