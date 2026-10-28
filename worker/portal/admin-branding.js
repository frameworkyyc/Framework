/**
 * Framework Admin: Branding API. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route (the router authenticates first); writes also need
 * PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header (the existing Admin CSRF defence). Framework staff manage the official
 * deliverables and publication here, and review what clients submit. Clients never reach any of this.
 *
 *   GET  /clients/:org/branding                          everything for one organization (kit, assets, client uploads, requests, usage); never storage keys
 *   PUT  /clients/:org/branding/kit                      { colours?, typography? }  saves (never publishes)
 *   POST /clients/:org/branding/kit/publish | unpublish  publication of the whole kit
 *   POST /clients/:org/branding/assets                   multipart: file + meta (JSON)   a new deliverable (a draft until published)
 *   POST /clients/:org/branding/assets/:id/update        { ...metadata, published? }
 *   POST /clients/:org/branding/assets/:id/replace       multipart: file                swap the file, keep the metadata
 *   POST /clients/:org/branding/assets/:id/delete        remove (the stored file is deleted at once)
 *   GET  /clients/:org/branding/assets/:id/download      the file as an attachment (recorded)
 *   GET  /clients/:org/branding/uploads/:id/download     a client's file as an attachment (recorded)
 *   POST /clients/:org/branding/uploads/:id/hold | release | delete
 *   POST /clients/:org/branding/uploads/seen             marks the organization's uploads as seen by staff
 *   POST /clients/:org/branding/requests/:id/update      { status, admin_note? }
 *   POST /branding/storage-check                         writes, reads and deletes one tiny object in the private bucket (proves R2 is wired)
 *   GET  /branding/backup                                counts only: objects in the files bucket and the backup bucket, and what is missing where
 *   POST /branding/backup-run                            copies new/changed files to the backup bucket now (the same copy the schedule runs)
 *   POST /branding/backup-check                          END TO END proof on a tiny test object: write, copy to the backup, read back from it, simulate a loss, restore, compare
 *   POST /branding/backup-restore                        { confirm: "RESTORE" }  copies back ONLY the files missing from the files bucket that a LIVE database row still points to; never overwrites one, never brings back a deleted file
 *   POST /branding/backup-purge                          dry run by default (counts of what 90-day-old deleted files would be removed from the backup); { confirm: "PURGE" } really removes them, and only while PORTAL_BACKUP_PURGE is "1"
 *
 * A database without migration 0005 answers { available: false }: nothing else runs.
 */
import { getOrganizationById } from "./repo/orgs.js";
import { UUID } from "./repo/common.js";
import * as brand from "./repo/brand.js";
import { recordActivity } from "./repo/activity.js";
import * as files from "./brand-files.js";
import { BRANDING_SERVICES, brandingService } from "./brand-services.js";
import { limitsFor } from "./brand-files.js";
import { backupFiles, restoreFiles, backupStatus } from "./file-backup.js";
import { backupPurge, restorableKeys, purgeEnabled } from "./backup-purge.js";
import { ADMIN_MAX_FILE_BYTES, makeKey, putObject, getObject, deleteObject, StorageError } from "./files/index.js";

const MAX_JSON = 20 * 1024;
export const MAX_MULTIPART = ADMIN_MAX_FILE_BYTES + 1024 * 1024; // the file plus form overhead
const NIL_ORG = "00000000-0000-4000-8000-000000000000"; // owns nothing: the storage check's own corner of the bucket

export const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
export const err = (status, error, message) => json({ error, message }, status);

/** Data-layer and file-service failure codes, as HTTP statuses. Anything unlisted is a bare 500: no internals reach the browser. */
const STATUS = {
  not_found: 404, forbidden: 403,
  invalid_colours: 422, invalid_typography: 422, invalid_brand_name: 422, invalid_kind: 422, invalid_title: 422, invalid_variant: 422, invalid_logo_role: 422, invalid_orientation: 422, invalid_tone: 422, invalid_section: 422, invalid_usage_note: 422,
  invalid_license_note: 422, invalid_sort_order: 422, invalid_input: 422, invalid_status: 422, invalid_note: 422, invalid_kit: 422, invalid_sections: 422, sections_unavailable: 409, font_license_required: 422,
  invalid_name: 422, type_not_allowed: 415, content_mismatch: 422, active_content: 422, image_dimensions: 422, pdf_encrypted: 422, empty_file: 422, no_file: 400, file_too_large: 413,
  archive_unsafe_entry: 422, archive_encrypted: 422, archive_unsupported: 422, archive_entries: 422, archive_too_large: 422,
  conflict: 409, already_open: 409, duplicate_name: 409, incomplete_logo_details: 422, invalid_description: 422,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502, storage_delete_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

export function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return request.headers.get("X-Framework-Admin") === "1";
}

export async function readJson(request, allowed) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { response: err(415, "unsupported_media_type", "Send the request as application/json.") };
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_JSON) return { response: err(413, "payload_too_large", "The request is too large.") };
  const text = await request.text();
  if (text.length > MAX_JSON) return { response: err(413, "payload_too_large", "The request is too large.") };
  let body;
  try { body = text.trim() === "" ? {} : JSON.parse(text); } catch { return { response: err(400, "invalid_json", "The request body is not valid JSON.") }; }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { response: err(400, "invalid_json", "The request body must be a JSON object.") };
  if (Object.keys(body).some((k) => !allowed.includes(k))) return { response: err(400, "unknown_field", "The request contains a field that is not accepted.") };
  return { body };
}

/** multipart/form-data with exactly one `file` and an optional JSON `meta`. The declared size is checked BEFORE anything is read. */
export async function readUpload(request, { withMeta }) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "multipart/form-data") return { response: err(415, "unsupported_media_type", "Send the file as a form upload.") };
  const declared = Number(request.headers.get("Content-Length"));
  if (!Number.isFinite(declared) || declared <= 0) return { response: err(411, "length_required", "The upload's size was not stated.") };
  if (declared > MAX_MULTIPART) return { response: err(413, "file_too_large", "The file is too large.") };
  let form;
  try { form = await request.formData(); } catch { return { response: err(400, "invalid_upload", "The upload could not be read.") }; }
  const f = form.get("file");
  if (!f || typeof f === "string" || typeof f.arrayBuffer !== "function") return { response: err(400, "no_file", "Choose a file.") };
  const allowed = withMeta ? ["file", "meta"] : ["file"];
  for (const key of form.keys()) if (!allowed.includes(key)) return { response: err(400, "unknown_field", "The request contains a field that is not accepted.") };
  let meta = {};
  if (withMeta) {
    const raw = form.get("meta");
    if (typeof raw !== "string" || raw.length > MAX_JSON) return { response: err(400, "invalid_json", "The upload details are missing.") };
    try { meta = JSON.parse(raw); } catch { return { response: err(400, "invalid_json", "The upload details are not valid.") }; }
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { response: err(400, "invalid_json", "The upload details are not valid.") };
  }
  return { file: { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }, meta };
}

const META_FIELDS = ["kind", "title", "standard_name", "logo_role", "orientation", "tone", "transparent", "section", "usage_note", "downloadable", "license_note", "sort_order", "published"];
const pick = (obj, keys) => Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)));

const publicAsset = (a) => ({ id: a.id, kind: a.kind, title: a.title, variantKey: a.variantKey, logoRole: a.logoRole, orientation: a.orientation, tone: a.tone, transparent: a.transparent, usageNote: a.usageNote, downloadable: a.downloadable, licenseNote: a.licenseNote, format: a.format, size: a.size, sha256: a.sha256, originalName: a.originalName, published: a.published, sortOrder: a.sortOrder, createdAt: a.createdAt, createdBy: a.createdBy, updatedAt: a.updatedAt });
const publicUpload = (u) => ({ id: u.id, category: u.category, name: u.originalName, format: u.format, size: u.size, sha256: u.sha256, held: u.status === "held", seen: Boolean(u.adminSeenAt), createdAt: u.createdAt, fontRightsAck: u.fontRightsAck, uploader: { email: u.uploaderEmail, name: u.uploaderName } });
const publicRequest = (r) => ({ id: r.id, serviceKey: r.serviceKey, service: (brandingService(r.serviceKey) || { title: r.serviceKey }).title, status: r.status, note: r.note, createdAt: r.createdAt, handledBy: r.handledBy, handledAt: r.handledAt, adminNote: r.adminNote });

async function tablesPresent(db) {
  try { await db.prepare("SELECT 1 FROM brand_kits LIMIT 1").first(); return true; } catch { return false; }
}

async function view(env, org) {
  const db = env.PORTAL_DB;
  const [kit, assets, uploads, requests, usage] = await Promise.all([brand.getBrandKit(db, org.id), brand.listBrandAssetsAdmin(db, org.id), brand.listUploadsAdmin(db, org.id), brand.listServiceRequests(db, org.id), brand.uploadUsage(db, org.id)]);
  return {
    available: true,
    organization: { id: org.id, name: org.name, slug: org.slug },
    capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES), sections: await brand.sectionsColumnExists(db) },
    limits: { ...limitsFor({ env }), adminMaxFileBytes: ADMIN_MAX_FILE_BYTES },
    usage,
    kit: kit ? { status: kit.status, colours: kit.colours, typography: kit.typography, sections: kit.sections, brandName: kit.brandName, updatedAt: kit.updatedAt, publishedAt: kit.publishedAt, publishedBy: kit.publishedBy } : null,
    assets: assets.map(publicAsset),
    uploads: uploads.map(publicUpload),
    requests: requests.map(publicRequest),
    services: BRANDING_SERVICES.map((s) => ({ key: s.key, title: s.title })),
  };
}

/** The private bucket's own self-test: one tiny object is written, read back and deleted under a reserved name. It reports steps, never contents. */
async function storageCheck(env, actor, now) {
  const steps = [];
  const step = (name, okay) => steps.push({ name, ok: okay });
  if (!env.PORTAL_FILES) return { ok: false, steps: [{ name: "binding", ok: false }] };
  step("binding", true);
  const bytes = new TextEncoder().encode("framework storage check " + now.toISOString());
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = makeKey(NIL_ORG, "files");
  let written = false;
  try {
    await putObject(env.PORTAL_FILES, { key, organizationId: NIL_ORG, bytes, sha256: sha, contentType: "text/plain" }); written = true; step("write", true);
    const obj = await getObject(env.PORTAL_FILES, { key, organizationId: NIL_ORG });
    const back = obj ? new Uint8Array(await new Response(obj.body).arrayBuffer()) : null;
    step("read", Boolean(back) && back.length === bytes.length && [...back].every((b, i) => b === bytes[i]));
    const other = await getObject(env.PORTAL_FILES, { key, organizationId: "11111111-1111-4111-8111-111111111111" });
    step("isolation", other === null);
  } catch (e) {
    step(e instanceof StorageError ? e.code : "unexpected", false);
  } finally {
    if (written) { try { await deleteObject(env.PORTAL_FILES, { key, organizationId: NIL_ORG }); step("delete", true); } catch { step("delete", false); } }
  }
  const okay = steps.every((s) => s.ok);
  try { await recordActivity(env.PORTAL_DB, { organizationId: null, actorType: "admin", actorRef: actor, action: "brand.storage.selftest", entityType: "storage", detail: { ok: okay, steps: steps.map((s) => `${s.name}:${s.ok ? "ok" : "fail"}`) }, visibility: "internal" }, { now }); } catch { /* the check's answer matters more than its log line */ }
  return { ok: okay, steps };
}

const TEST_PREFIX = `org/${NIL_ORG}/files/`;
const logActivity = async (env, actor, action, detail, now) => { try { await recordActivity(env.PORTAL_DB, { organizationId: null, actorType: "admin", actorRef: actor, action, entityType: "storage", detail, visibility: "internal" }, { now }); } catch { /* the answer matters more than its log line */ } };
const same = (a, b) => Boolean(a && b) && a.length === b.length && a.every((x, i) => x === b[i]);
const bytesOf = async (obj) => (obj ? new Uint8Array(await new Response(obj.body).arrayBuffer()) : null);

/**
 * An end-to-end proof that the backup really works, on one tiny object in the reserved test corner: it is written, copied to the backup bucket by the same code the
 * schedule uses, read back FROM the backup and compared, the primary copy is then deleted (a simulated loss), restored from the backup, and compared again. Reports
 * steps, never contents. Each run leaves one ~60-byte test object in the backup bucket (its lock rule, if any, keeps it); real client files are never touched.
 */
async function backupCheck(env) {
  const steps = [];
  const step = (name, okay) => steps.push({ name, ok: okay });
  const [P, B] = [env.PORTAL_FILES, env.PORTAL_FILES_BACKUP];
  if (!P || !B || P === B) return { ok: false, steps: [{ name: "bindings", ok: false }] };
  step("bindings", true);
  const text = new TextEncoder().encode("framework backup check " + crypto.randomUUID());
  const sha = [...new Uint8Array(await crypto.subtle.digest("SHA-256", text))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const key = makeKey(NIL_ORG, "files");
  let written = false;
  try {
    const before = await B.list({ prefix: TEST_PREFIX, limit: 1000 });
    await putObject(P, { key, organizationId: NIL_ORG, bytes: text, sha256: sha, contentType: "text/plain" }); written = true; step("write", true);
    step("new_unique_name", !before.objects.some((o) => o.key === key) && /^org\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}$/.test(key));
    const copy = await backupFiles({ primary: P, backup: B, prefix: TEST_PREFIX });
    step("copy", copy.ok && copy.copied >= 1);
    const fromBackup = await B.get(key);
    step("backup_has_same_name", Boolean(fromBackup));
    step("backup_bytes_match", same(await bytesOf(fromBackup), text));
    await deleteObject(P, { key, organizationId: NIL_ORG }); written = false;
    step("loss_simulated", (await P.get(key)) === null);
    const back = await restoreFiles({ primary: P, backup: B, prefix: TEST_PREFIX });
    step("restore", back.ok && back.copied >= 1);
    const restored = await P.get(key);
    step("restored_bytes_match", same(await bytesOf(restored), text));
    written = Boolean(restored);
  } catch (e) {
    step(e instanceof StorageError ? e.code : "unexpected", false);
  } finally {
    if (written) { try { await deleteObject(P, { key, organizationId: NIL_ORG }); step("cleanup", true); } catch { step("cleanup", false); } }
  }
  return { ok: steps.every((s) => s.ok), steps };
}

/** The backup routes. Everything answers counts and step names only. */
async function backupApi(request, env, kind, actor, now) {
  const [P, B] = [env.PORTAL_FILES, env.PORTAL_FILES_BACKUP];
  const ready = Boolean(P && B && P !== B);
  if (kind === "backup") {
    if (!ready) return json({ ok: false, configured: false });
    const status = await backupStatus({ primary: P, backup: B });
    const retention = await backupPurge({ db: env.PORTAL_DB, primary: P, backup: B, now, dryRun: true });
    return json({ ...status, retention: { ok: retention.ok, enabled: purgeEnabled(env), waiting: retention.waiting, due: retention.eligible, protected: retention.protected, unreferenced: retention.unreferenced } });
  }
  if (!ready) return err(503, "backup_unavailable", "File backup is not set up on this deployment.");
  if (kind === "backup_check") { const r = await backupCheck(env); await logActivity(env, actor, "files.backup.check", { ok: r.ok, steps: r.steps.map((x) => `${x.name}:${x.ok ? "ok" : "fail"}`) }, now); return json(r); }
  const read = await readJson(request, kind === "backup_restore" || kind === "backup_purge" ? ["confirm"] : []);
  if (read.response) return read.response;
  if (kind === "backup_run") { const r = await backupFiles({ primary: P, backup: B, limit: 50 }); await logActivity(env, actor, "files.backup.run", { ok: r.ok, copied: r.copied, failed: r.failed, remaining: r.remaining }, now); return json(r); }
  if (kind === "backup_purge") {
    const real = read.body.confirm === "PURGE";
    if (real && !purgeEnabled(env)) return err(409, "purge_disabled", "Automatic removal of old backup copies is switched off. Nothing was deleted.");
    const r = await backupPurge({ db: env.PORTAL_DB, primary: P, backup: B, now, dryRun: !real });
    if (real) await logActivity(env, actor, "files.backup.purge", { ok: r.ok, deleted: r.deleted, failed: r.failed, remaining: r.remaining }, now);
    return json(r);
  }
  if (read.body.confirm !== "RESTORE") return err(422, "confirmation_required", "Type RESTORE to confirm. Nothing was copied.");
  const r = await restoreFiles({ primary: P, backup: B, limit: 50, only: (keys) => restorableKeys(env.PORTAL_DB, keys) });
  await logActivity(env, actor, "files.backup.restore", { ok: r.ok, copied: r.copied, failed: r.failed, remaining: r.remaining }, now);
  return json(r);
}

/** @param path pathname with "/api/admin" removed. @returns Response, or null when it is not a Branding route. */
export async function handleBrandingApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  let route = null;
  if (seg[0] === "branding" && seg.length === 2 && seg[1] === "storage-check") route = { kind: "storage_check", method: "POST" };
  else if (seg[0] === "branding" && seg.length === 2 && ["backup", "backup-check", "backup-run", "backup-restore", "backup-purge"].includes(seg[1])) route = { kind: seg[1].replace("-", "_"), method: seg[1] === "backup" ? "GET" : "POST" };
  else if (seg[0] === "clients" && seg[2] === "branding" && seg.length >= 3) {
    const rest = seg.slice(3), org = seg[1];
    const id = (i) => rest[i];
    if (rest.length === 0) route = { kind: "view", method: "GET" };
    else if (rest.length === 1 && rest[0] === "kit") route = { kind: "kit_save", method: "PUT" };
    else if (rest.length === 2 && rest[0] === "kit" && (rest[1] === "publish" || rest[1] === "unpublish")) route = { kind: "kit_" + rest[1], method: "POST" };
    else if (rest.length === 1 && rest[0] === "assets") route = { kind: "asset_create", method: "POST" };
    else if (rest.length === 3 && rest[0] === "assets" && ["update", "replace", "delete"].includes(rest[2])) route = { kind: "asset_" + rest[2], method: "POST", target: id(1) };
    else if (rest.length === 3 && rest[0] === "assets" && rest[2] === "download") route = { kind: "asset_download", method: "GET", target: id(1) };
    else if (rest.length === 3 && rest[0] === "uploads" && rest[2] === "download") route = { kind: "upload_download", method: "GET", target: id(1) };
    else if (rest.length === 3 && rest[0] === "uploads" && ["hold", "release", "delete"].includes(rest[2])) route = { kind: "upload_" + rest[2], method: "POST", target: id(1) };
    else if (rest.length === 2 && rest[0] === "uploads" && rest[1] === "seen") route = { kind: "uploads_seen", method: "POST" };
    else if (rest.length === 3 && rest[0] === "requests" && rest[2] === "update") route = { kind: "request_update", method: "POST", target: id(1) };
    if (route) route.org = org;
  }
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (route.org !== undefined && !UUID.test(route.org)) return err(404, "not_found", "No such organization.");
  if (route.target !== undefined && !UUID.test(route.target)) return err(404, "not_found", "Not found.");
  if (route.method !== "GET") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");

  const now = deps.now || new Date();
  const actor = principal && principal.email;
  try {
    const db = env.PORTAL_DB;
    if (route.kind === "storage_check") return json(await storageCheck(env, actor, now));
    if (route.kind.startsWith("backup")) return await backupApi(request, env, route.kind, actor, now);
    if (!(await tablesPresent(db))) return json({ available: false });
    const org = await getOrganizationById(db, route.org);
    if (!org) return err(404, "not_found", "No such organization.");
    const svc = { db, bucket: env.PORTAL_FILES, env, now };
    const needStorage = ["asset_create", "asset_replace", "asset_delete", "asset_download", "upload_download", "upload_delete"].includes(route.kind);
    if (needStorage && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");

    if (route.kind === "view") return json(await view(env, org));

    if (route.kind === "kit_save") {
      const read = await readJson(request, ["colours", "typography", "brand_name", "sections"]);
      if (read.response) return read.response;
      if (read.body.colours === undefined && read.body.typography === undefined && read.body.sections === undefined && !("brand_name" in read.body)) return err(422, "invalid_input", "Nothing to save.");
      if (Array.isArray(read.body.typography)) { // a typeface may only point at this organization's own live font files
        const own = await brand.liveFontAssetIds(db, org.id);
        if (read.body.typography.some((t) => t && Array.isArray(t.file_ids) && t.file_ids.some((id) => !own.has(String(id).toLowerCase())))) return err(422, "invalid_typography", "The change was not made.");
      }
      const r = await brand.saveBrandKit(db, org.id, { colours: read.body.colours, typography: read.body.typography, sections: read.body.sections, brandName: "brand_name" in read.body ? read.body.brand_name : undefined }, actor, { now });
      return r.ok ? json({ ok: true, kit: (({ status, colours, typography, sections, brandName, updatedAt, publishedAt }) => ({ status, colours, typography, sections, brandName, updatedAt, publishedAt }))(await brand.getBrandKit(db, org.id)) }) : fromFailure(r);
    }
    if (route.kind === "kit_publish" || route.kind === "kit_unpublish") {
      const r = await brand.setBrandKitStatus(db, org.id, route.kind === "kit_publish" ? "published" : "draft", actor, { now });
      return r.ok ? json({ ok: true, changed: r.changed }) : fromFailure(r);
    }

    if (route.kind === "asset_create") {
      const read = await readUpload(request, { withMeta: true });
      if (read.response) return read.response;
      const r = await files.adminUploadAsset(svc, { organizationId: org.id, actor, meta: pick(read.meta, META_FIELDS), file: read.file });
      return r.ok ? json({ ok: true, id: r.id, name: r.name }, 201) : fromFailure(r);
    }
    if (route.kind === "asset_update") {
      const read = await readJson(request, META_FIELDS);
      if (read.response) return read.response;
      const r = await files.adminUpdateAsset(svc, { organizationId: org.id, assetId: route.target, actor, patch: read.body });
      return r.ok ? json({ ok: true, name: r.name }) : fromFailure(r);
    }
    if (route.kind === "asset_replace") {
      const read = await readUpload(request, { withMeta: false });
      if (read.response) return read.response;
      const r = await files.adminReplaceAsset(svc, { organizationId: org.id, assetId: route.target, actor, file: read.file });
      return r.ok ? json({ ok: true, name: r.name }) : fromFailure(r);
    }
    if (route.kind === "asset_delete") {
      const r = await files.adminDeleteAsset(svc, { organizationId: org.id, assetId: route.target, actor });
      return r.ok ? json({ ok: true, storageCleanup: r.storageCleanup }) : fromFailure(r);
    }
    if (route.kind === "asset_download") {
      const r = await files.adminDownloadAsset(svc, { organizationId: org.id, assetId: route.target, actor, inline: new URL(request.url).searchParams.get("preview") === "1" });
      return r.ok ? r.response : fromFailure(r);
    }
    if (route.kind === "upload_download") {
      const r = await files.adminDownloadUpload(svc, { organizationId: org.id, uploadId: route.target, actor });
      return r.ok ? r.response : fromFailure(r);
    }
    if (route.kind === "upload_hold" || route.kind === "upload_release") {
      const r = await brand.setUploadHeld(db, org.id, route.target, route.kind === "upload_hold", actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "upload_delete") {
      const r = await files.adminDeleteUpload(svc, { organizationId: org.id, uploadId: route.target, actor });
      return r.ok ? json({ ok: true, storageCleanup: r.storageCleanup }) : fromFailure(r);
    }
    if (route.kind === "uploads_seen") {
      const r = await brand.markUploadsSeen(db, org.id, { now });
      return json({ ok: true, marked: r.marked });
    }
    if (route.kind === "request_update") {
      const read = await readJson(request, ["status", "admin_note"]);
      if (read.response) return read.response;
      const r = await brand.updateServiceRequest(db, org.id, route.target, { status: read.body.status, adminNote: read.body.admin_note }, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    return null;
  } catch (e) {
    console.error("admin branding api error:", e && e.name); // never the message: it can carry SQL text, values or storage details
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
