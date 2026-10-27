/**
 * Branding file service: the ONE place that combines permission checks, file validation, private storage and the database. Routes (Phase 2 and 3) call these
 * functions and do nothing else with files. Nothing here reads an organization id from request data: callers pass the organization that came from the
 * signed-in membership (client) or from the Admin route (Framework staff).
 *
 * Write order, chosen so a failure can only leave a harmless orphan object, never a database row pointing at nothing:
 *   upload   validate -> put the object -> insert the row (quota enforced inside the insert) -> if the insert is refused, delete the object again
 *   delete   tombstone the row -> delete the object (a failed delete is recorded for the orphan check and reported, not hidden)
 *   replace  put the new object -> swap the key on the row -> delete the old object
 * Every download is recorded in the activity log (who, what, when: never an address or a key).
 */
import { can } from "./policy.js";
import { ok, fail } from "./repo/common.js";
import * as brand from "./repo/brand.js";
import { recordActivity } from "./repo/activity.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, listOrganizationKeys, fileResponse, StorageError, ADMIN_MAX_FILE_BYTES, limitsFromEnv, parseKey } from "./files/index.js";
import { isKnownBrandingService } from "./brand-services.js";
import { getOrganizationById } from "./repo/orgs.js";
import { listInvoiceStorageKeys } from "./repo/invoices.js";
import { listSupportStorageKeys } from "./repo/support.js";
import { buildBrandFileName } from "../../admin/assets/brand-names.js";

const denied = () => fail("forbidden");
const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());

function describe(inspected, key) {
  return { name: inspected.name, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256, storageKey: key };
}

async function cleanup(deps, organizationId, key) {
  try { await deleteObject(deps.bucket, { key, organizationId }); return true; } catch { return false; }
}

async function noteCleanupFailure(deps, organizationId, entityType, entityId) {
  // the row is gone or unchanged; the object is an unreferenced orphan that findOrphanObjects() will list. Record that it needs attention (ids only).
  await recordActivity(deps.db, { organizationId, actorType: "system", actorRef: "brand-files", action: "brand.storage.cleanup_failed", entityType, entityId, visibility: "internal" }, { now: deps.now });
}

/* ------------------------------------------------------------------ client side */

/** deps: { db, bucket, env?, now? } */
export const limitsFor = (deps) => limitsFromEnv(deps.env || {});

export async function clientUploadFile(deps, { role, organizationId, userId, category, fontRightsAck, file }) {
  if (!can(role, "branding.upload")) return denied();
  const limits = limitsFor(deps);
  const usage = await brand.uploadUsage(deps.db, organizationId);
  if (usage.files >= limits.maxFiles) return fail("file_limit");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "brand_client", maxBytes: limits.maxFileBytes });
  if (!inspected.ok) return fail(inspected.error);
  if (usage.bytes + inspected.size > limits.quotaBytes) return fail("quota_exceeded");
  const key = makeKey(organizationId, "brand-uploads");
  try {
    await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType });
  } catch (err) { return storageFail(err); }
  let rec;
  try {
    rec = await brand.createClientUpload(deps.db, organizationId, userId, { category, fontRightsAck }, describe(inspected, key), limits, { now: deps.now });
  } catch (err) {
    await cleanup(deps, organizationId, key);
    throw err;
  }
  if (!rec.ok) { await cleanup(deps, organizationId, key); return rec; }
  return ok({ id: rec.id, name: inspected.name, size: inspected.size });
}

export async function clientDeleteUpload(deps, { role, organizationId, userId, uploadId }) {
  if (!can(role, "branding.delete_upload")) return denied();
  const res = await brand.deleteUpload(deps.db, organizationId, uploadId, { by: userId, actorType: "client", now: deps.now });
  if (!res.ok) return res;
  const cleaned = await cleanup(deps, organizationId, res.storageKey);
  if (!cleaned) await noteCleanupFailure(deps, organizationId, "brand_upload", uploadId);
  return ok({ storageCleanup: cleaned ? "done" : "pending" });
}

async function stream(deps, { organizationId, row, actorType, actorRef, entityType, inline = false }) {
  let object;
  try { object = await getObject(deps.bucket, { key: row.storageKey, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  await brand.recordBrandDownload(deps.db, { organizationId, actorType, actorRef, entityType, entityId: row.id, now: deps.now });
  const name = row.originalName || row.title || "download";
  return ok({ response: fileResponse({ object, name, ext: row.format, inlineImage: inline, size: row.size }) });
}

/** Download of a client's own organization's upload. Held files are not downloadable by anyone until Admin releases them. */
export async function clientDownloadUpload(deps, { role, organizationId, userId, uploadId }) {
  if (!can(role, "branding.view")) return denied();
  const row = await brand.getDownloadableUpload(deps.db, organizationId, uploadId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, row, actorType: "client", actorRef: userId, entityType: "brand_upload" });
}

/** Download of a published deliverable. Not published (asset or kit), deleted, another organization's, or an unlicensed font: all the same "not_found". */
export async function clientDownloadAsset(deps, { role, organizationId, userId, assetId, inline = false }) {
  if (!can(role, "branding.view")) return denied();
  const row = await brand.getClientBrandAsset(deps.db, organizationId, assetId);
  if (!row) return fail("not_found");
  if (inline && row.kind !== "logo") return fail("not_found"); // only logo images are ever shown as pictures
  return stream(deps, { organizationId, row, actorType: "client", actorRef: userId, entityType: "brand_asset", inline });
}

export async function clientRequestService(deps, { role, organizationId, userId, serviceKey, note }) {
  if (!can(role, "branding.request")) return denied();
  return brand.createServiceRequest(deps.db, organizationId, userId, { serviceKey, note }, isKnownBrandingService, { now: deps.now });
}

/* ------------------------------------------------------------------ Framework Admin side (callers are behind Cloudflare Access and ADMIN_EMAILS) */

/** The naming inputs of a deliverable, from stored or submitted metadata. */
/** The name used for the company part of every generated file name: the kit's brand name when one is set, otherwise the organization's own name. */
const companyName = async (db, org) => { const kit = await brand.getBrandKit(db, org.id); return kit && kit.brandName ? kit.brandName : org.name; };
const nameInput = (org, m, ext) => ({ company: org.company || org.name, slug: org.slug, kind: m.kind, logo: { role: m.logo_role, orientation: m.orientation, tone: m.tone, transparent: m.transparent === true || m.transparent === 1 }, description: m.title, ext });

/**
 * A new deliverable. The file's NAME is generated here from the organization's name and the file's details (Framework-Primary-Square-Light-Transparent.png);
 * the browser never supplies it. The same logo in another format gets the same stem and a different extension. A name that is already used by a live file of
 * the organization is refused (never overwritten, never silently renamed).
 */
export async function adminUploadAsset(deps, { organizationId, actor, meta, file }) {
  const m = meta && typeof meta === "object" ? meta : {};
  if (!brand.ASSET_KINDS.includes(m.kind)) return fail("invalid_kind");
  if (enumError(m)) return fail(enumError(m));
  const base = await getOrganizationById(deps.db, organizationId);
  if (!base) return fail("not_found");
  const org = { ...base, company: await companyName(deps.db, base) };
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "brand_admin", maxBytes: ADMIN_MAX_FILE_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const built = buildBrandFileName(nameInput(org, m, inspected.ext));
  if (!built.ok) return fail(built.error);
  if (await brand.brandAssetNameTaken(deps.db, organizationId, built.name)) return fail("duplicate_name"); // checked before anything is stored; the insert checks again atomically
  const isLogo = m.kind === "logo";
  const finalMeta = { ...pickKeys(m, ["kind", "usage_note", "downloadable", "license_note", "sort_order", "published"]), title: built.title, variant_key: built.variantKey,
    logo_role: isLogo ? m.logo_role : null, orientation: isLogo ? m.orientation : null, tone: isLogo ? m.tone : null, transparent: isLogo && m.transparent === true };
  const key = makeKey(organizationId, "brand-assets");
  try { await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await brand.createBrandAsset(deps.db, organizationId, finalMeta, describe({ ...inspected, name: built.name }, key), actor, { now: deps.now }); } catch (err) { await cleanup(deps, organizationId, key); throw err; }
  if (!rec.ok) { await cleanup(deps, organizationId, key); return rec; }
  return ok({ id: rec.id, name: built.name });
}

/** A submitted logo detail that is not one of the allowed values gets its specific error (not "incomplete"). */
const enumError = (m) => {
  for (const [key, list, code] of [["logo_role", brand.LOGO_ROLES, "invalid_logo_role"], ["orientation", brand.ORIENTATIONS, "invalid_orientation"], ["tone", brand.TONES, "invalid_tone"]]) if (m[key] !== undefined && m[key] !== null && m[key] !== "" && !list.includes(m[key])) return code;
  return null;
};
const pickKeys = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));
const stemOf = (name) => String(name).replace(/\.[^.]+$/, "");

/** Replacing keeps the file's stem (its identity) and takes the new file's extension: Primary-…-Light.png replaced by an SVG becomes Primary-…-Light.svg. */
export async function adminReplaceAsset(deps, { organizationId, assetId, actor, file }) {
  const cur = await brand.getBrandAssetAdmin(deps.db, organizationId, assetId);
  if (!cur) return fail("not_found");
  const inspected = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "brand_admin", maxBytes: ADMIN_MAX_FILE_BYTES });
  if (!inspected.ok) return fail(inspected.error);
  const name = `${stemOf(cur.originalName)}.${inspected.ext}`;
  if (await brand.brandAssetNameTaken(deps.db, organizationId, name, assetId)) return fail("duplicate_name");
  const key = makeKey(organizationId, "brand-assets");
  try { await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: inspected.sha256, contentType: inspected.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await brand.replaceBrandAssetFile(deps.db, organizationId, assetId, describe({ ...inspected, name }, key), actor, { now: deps.now }); } catch (err) { await cleanup(deps, organizationId, key); throw err; }
  if (!rec.ok) { await cleanup(deps, organizationId, key); return rec; }
  if (!(await cleanup(deps, organizationId, rec.previousKey))) await noteCleanupFailure(deps, organizationId, "brand_asset", assetId);
  return ok({ id: assetId, name });
}

/**
 * Editing a deliverable. The file name is regenerated ONLY when a naming detail changed (logo type, shape, version, transparency, or a non-logo's name); other
 * edits (publication, usage note, order) never touch it, so older files keep their names until their naming details are edited on purpose. The file type
 * (logo, font ...) cannot be changed after upload.
 */
export async function adminUpdateAsset(deps, { organizationId, assetId, actor, patch }) {
  const cur = await brand.getBrandAssetAdmin(deps.db, organizationId, assetId);
  if (!cur) return fail("not_found");
  const p = patch && typeof patch === "object" ? patch : {};
  if ("kind" in p && p.kind !== cur.kind) return fail("invalid_input");
  if (enumError(p)) return fail(enumError(p));
  const base = await getOrganizationById(deps.db, organizationId);
  if (!base) return fail("not_found");
  const org = { ...base, company: await companyName(deps.db, base) };
  const isLogo = cur.kind === "logo";
  const has = (k) => k in p;
  const next = { kind: cur.kind, logo_role: has("logo_role") ? p.logo_role || null : cur.logoRole, orientation: has("orientation") ? p.orientation || null : cur.orientation, tone: has("tone") ? p.tone || null : cur.tone,
    transparent: has("transparent") ? p.transparent === true : cur.transparent, title: !isLogo && has("title") ? p.title : cur.title };
  const adopt = p.standard_name === true; // "rename to the standard name": an explicit, opt-in rename of an older file
  const changed = adopt || (isLogo ? next.logo_role !== cur.logoRole || next.orientation !== cur.orientation || next.tone !== cur.tone || next.transparent !== cur.transparent : next.title !== cur.title);
  const out = pickKeys(p, ["usage_note", "downloadable", "license_note", "sort_order", "published"]);
  if (changed) {
    const built = buildBrandFileName(nameInput(org, next, cur.format));
    if (!built.ok) return fail(built.error);
    if (await brand.brandAssetNameTaken(deps.db, organizationId, built.name, assetId)) return fail("duplicate_name");
    Object.assign(out, { title: built.title, variant_key: built.variantKey, original_name: built.name }, isLogo ? { logo_role: next.logo_role, orientation: next.orientation, tone: next.tone, transparent: next.transparent } : {});
  }
  if (!Object.keys(out).length) return ok({ name: cur.originalName }); // nothing that changes anything
  const r = await brand.updateBrandAsset(deps.db, organizationId, assetId, out, actor, { now: deps.now });
  return r.ok ? ok({ name: out.original_name || cur.originalName }) : r;
}

export async function adminDeleteAsset(deps, { organizationId, assetId, actor }) {
  const res = await brand.deleteBrandAsset(deps.db, organizationId, assetId, actor, { now: deps.now });
  if (!res.ok) return res;
  const cleaned = await cleanup(deps, organizationId, res.storageKey);
  if (!cleaned) await noteCleanupFailure(deps, organizationId, "brand_asset", assetId);
  return ok({ storageCleanup: cleaned ? "done" : "pending" });
}

export async function adminDeleteUpload(deps, { organizationId, uploadId, actor }) {
  const res = await brand.deleteUpload(deps.db, organizationId, uploadId, { by: actor, actorType: "admin", now: deps.now });
  if (!res.ok) return res;
  const cleaned = await cleanup(deps, organizationId, res.storageKey);
  if (!cleaned) await noteCleanupFailure(deps, organizationId, "brand_upload", uploadId);
  return ok({ storageCleanup: cleaned ? "done" : "pending" });
}

/** Admin download of a client's submission. Held files stay held (release first). Always an attachment, always recorded. */
export async function adminDownloadUpload(deps, { organizationId, uploadId, actor }) {
  const row = await brand.getDownloadableUpload(deps.db, organizationId, uploadId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, row, actorType: "admin", actorRef: actor, entityType: "brand_upload" });
}

/** Admin download of a deliverable, draft or published. */
export async function adminDownloadAsset(deps, { organizationId, assetId, actor }) {
  const row = await brand.getBrandAssetAdmin(deps.db, organizationId, assetId);
  if (!row) return fail("not_found");
  return stream(deps, { organizationId, row, actorType: "admin", actorRef: actor, entityType: "brand_asset" });
}

/* ------------------------------------------------------------------ offboarding and housekeeping */

/** Controlled deletion for the end of a client relationship: every stored object of the organization is removed and every file row is tombstoned. Idempotent. */
export async function deleteOrganizationFiles(deps, { organizationId, actor }) {
  const tomb = await brand.tombstoneAllFiles(deps.db, organizationId, actor, { now: deps.now });
  if (!tomb.ok) return tomb;
  let removed = 0, failed = 0;
  try {
    const keys = [];
    for await (const key of listOrganizationKeys(deps.bucket, organizationId)) keys.push(key); // everything under this organization's prefix, including orphans
    for (const key of keys) {
      const parsed = parseKey(key);
      if (!parsed || parsed.area === "invoices" || parsed.area === "support") continue; // invoices and support records are kept for their retention periods: never swept up here (CLIENT-SERVICES.md)
      try { await deleteObject(deps.bucket, { key, organizationId }); removed++; } catch { failed++; }
    }
  } catch (err) { return storageFail(err); }
  await recordActivity(deps.db, { organizationId, actorType: "admin", actorRef: actor, action: "brand.files.deleted_all", entityType: "organization", entityId: organizationId, detail: { assets: tomb.assets, uploads: tomb.uploads, objects: removed, failed }, visibility: "internal" }, { now: deps.now });
  return ok({ assets: tomb.assets, uploads: tomb.uploads, objectsRemoved: removed, objectsFailed: failed });
}

/** Read-only: stored objects of this organization that no live row refers to (left behind by an interrupted write). */
export async function findOrphanObjects(deps, { organizationId }) {
  const live = new Set([...(await brand.listLiveStorageKeys(deps.db, organizationId)), ...(await listInvoiceStorageKeys(deps.db, organizationId)), ...(await listSupportStorageKeys(deps.db, organizationId))]);
  const orphans = [];
  for await (const key of listOrganizationKeys(deps.bucket, organizationId)) if (!live.has(key)) orphans.push(key);
  return orphans;
}
