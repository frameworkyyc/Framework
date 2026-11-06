/**
 * Request service layer: permission checks, form validation, brand snapshot, file validation and private storage, over the repository (repo.js). Organization and user ids
 * come from the signed-in membership (client) or the Admin route (staff), never from request data. Combines the same pieces as support-files.js.
 *
 *   validate EVERYTHING first (details, dates, website, brand, every file), then write the request, then store each file and record it; a file that cannot be stored or
 *   recorded is removed again and counted as failed (the request itself is already saved and the page says so). Nothing here deletes a stored request file.
 *   A download is recorded (who, what, when; never an address or a key).
 */
import { can } from "../policy.js";
import { ok, fail, UUID } from "../repo/common.js";
import { recordActivity } from "../repo/activity.js";
import { getClientBrand } from "../repo/brand.js";
import { inspectUpload, makeKey, putObject, getObject, deleteObject, fileResponse, StorageError, ADMIN_MAX_FILE_BYTES } from "../files/index.js";
import { getType, validateDetails, effectiveSettings } from "./registry.js";
import * as repo from "./repo.js";
import { quoteAcceptanceOpen, QUOTE_TERMS } from "./quote-gate.js";

const storageFail = (err) => (err instanceof StorageError ? fail(err.code) : (() => { throw err; })());
const CLIENT_PROFILE = "request_reference";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ files in */

export async function inspectClientFiles(files) {
  if (!Array.isArray(files) || files.length > repo.MAX_FILES_PER_MESSAGE) return fail("too_many_attachments");
  const out = [];
  for (let i = 0; i < files.length; i++) {
    const r = await inspectUpload({ bytes: files[i].bytes, originalName: files[i].name, profile: CLIENT_PROFILE, maxBytes: repo.MAX_FILE_BYTES });
    if (!r.ok) return fail(r.error, { index: i, name: files[i].name });
    out.push({ inspected: r, bytes: files[i].bytes });
  }
  return ok({ files: out });
}

/** Stores already-inspected files on a timeline entry. Returns how many were attached and how many failed (the entry itself is already saved). */
async function attach(deps, { organizationId, requestId, eventId, role, uploaderType, files }) {
  let attached = 0, failed = 0, error = null;
  for (const { inspected, bytes } of files) {
    const key = makeKey(organizationId, "requests");
    try { await putObject(deps.bucket, { key, organizationId, bytes, sha256: inspected.sha256, contentType: inspected.contentType }); }
    catch (err) { failed++; error = error || (err instanceof StorageError ? err.code : "storage_write_failed"); continue; }
    let rec;
    try { rec = await repo.createFile(deps.db, organizationId, requestId, eventId, role, uploaderType, { name: inspected.name, ext: inspected.ext, contentType: inspected.contentType, size: inspected.size, sha256: inspected.sha256, storageKey: key }, { now: deps.now }); }
    catch (err) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* an unreferenced object: orphan housekeeping lists it */ } throw err; }
    if (rec.ok) attached++;
    else { failed++; error = error || rec.error; try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* as above */ } }
  }
  return { attached, failed, error };
}

/* ------------------------------------------------------------------ brand snapshot */

const hex = (v) => (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v.trim()) ? v.trim() : null);
const short = (v, n) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, n) : "");

/**
 * The organization's PUBLISHED brand, frozen into the request so later edits to the kit never change what was asked for. Built server-side from the database: the form only
 * says "use my brand" and which logo ids; names, colours and fonts are never taken from the request. null when no kit is published or nothing was chosen.
 */
export async function brandSnapshot(db, organizationId, { use, logoIds }) {
  if (!use) return null;
  const brand = await getClientBrand(db, organizationId);
  if (!brand || !brand.published) return null;
  const wanted = new Set((logoIds || []).filter((x) => typeof x === "string" && UUID.test(x)));
  const logos = (brand.assets || []).filter((a) => a.kind === "logo" && wanted.has(a.id)).slice(0, 8).map((a) => ({ id: a.id, title: short(a.title, 80), role: short(a.logoRole || "", 20), tone: short(a.tone || "", 20), format: short(a.format || "", 8) }));
  const colours = (brand.colours || []).slice(0, 12).map((c) => ({ name: short(c && c.name, 40), hex: hex(c && (c.hex || c.value)) })).filter((c) => c.hex);
  const fonts = (brand.typography || []).slice(0, 6).map((t) => ({ family: short(t && t.family, 60), slot: short((t && (t.slot || t.role)) || "", 20) })).filter((t) => t.family);
  const snap = { publishedAt: brand.publishedAt || null, logos, colours, fonts };
  return JSON.stringify(snap).length <= 7500 ? snap : { publishedAt: snap.publishedAt, logos: logos.slice(0, 3), colours: colours.slice(0, 6), fonts: fonts.slice(0, 3) };
}

/* ------------------------------------------------------------------ client: create, reply, move */

export async function settingsOf(db, typeKey) {
  const type = getType(typeKey);
  if (!type) return null;
  let row = null;
  try { row = (await repo.listTypeSettings(db)).get(typeKey) || null; } catch { row = null; }
  return { type, ...effectiveSettings(type, row) };
}

/**
 * A new request. `form` is { get(name), keys() } over the posted fields (one value per name: each checkbox is its own field). Returns ok({ id, attachmentsFailed }) or fail(error) /
 * fail("invalid_details", { errors }) / fail("invalid_files", ...). deps: { db, bucket, env?, now? }
 */
export async function clientCreate(deps, { role, organizationId, userId, asStaff = false, typeKey, form, files = [] }) {
  if (!can(role, "requests.submit")) return fail("forbidden");
  const cfg = await settingsOf(deps.db, typeKey);
  if (!cfg) return fail("invalid_type");
  if (!cfg.enabled) return fail("not_available");
  const errors = {};
  const title = (form.get("title") || "").trim();
  if (!title) errors.title = "Give the request a short name.";
  else if (title.length > 120) errors.title = "Please keep the name under 120 characters.";
  const checked = validateDetails(cfg.type, (n) => form.get(n));
  if (!checked.ok) Object.assign(errors, checked.errors);
  const neededRaw = (form.get("needed_by") || "").trim();
  if (neededRaw && !DATE.test(neededRaw)) errors.needed_by = "Use a date like 2026-12-15.";
  if (Object.keys(errors).length) return fail("invalid_details", { errors });
  const inspected = await inspectClientFiles(files);
  if (!inspected.ok) return inspected;
  if (inspected.files.length && !deps.bucket) return fail("storage_unavailable");
  let websiteId = null;
  const wid = (form.get("website_id") || "").trim();
  if (cfg.type.website && wid) { if (!UUID.test(wid)) return fail("website_not_found"); websiteId = wid; }
  const snap = cfg.type.brand ? await brandSnapshot(deps.db, organizationId, { use: form.get("use_brand") === "1", logoIds: [...form.keys()].filter((k) => k.startsWith("logo_") && form.get(k) === "1").map((k) => k.slice(5)) }) : null;
  const made = await repo.createRequest(deps.db, organizationId, userId, { typeKey, title, details: checked.details, websiteId, neededBy: neededRaw || null, brandSnapshot: snap, revisionsIncluded: cfg.type.proofs ? cfg.revisionsIncluded : 0 }, { now: deps.now, asStaff });
  if (!made.ok) return made;
  const att = await attach(deps, { organizationId, requestId: made.id, eventId: made.eventId, role: "reference", uploaderType: "client", files: inspected.files });
  return ok({ id: made.id, attached: att.attached, attachmentsFailed: att.failed });
}

export async function clientReply(deps, { role, organizationId, userId, asStaff = false, requestId, body, files = [] }) {
  if (!can(role, "requests.submit")) return fail("forbidden");
  const inspected = await inspectClientFiles(files);
  if (!inspected.ok) return inspected;
  if (inspected.files.length && !deps.bucket) return fail("storage_unavailable");
  const added = await repo.addClientMessage(deps.db, organizationId, userId, requestId, body, { now: deps.now, asStaff });
  if (!added.ok) return added;
  const att = await attach(deps, { organizationId, requestId, eventId: added.eventId, role: "attachment", uploaderType: "client", files: inspected.files });
  return ok({ attached: att.attached, attachmentsFailed: att.failed });
}

export async function clientApprove(deps, { role, organizationId, userId, asStaff = false, requestId, note }) {
  if (!can(role, "requests.approve_proof")) return fail("forbidden");
  return repo.clientApproveProof(deps.db, organizationId, userId, requestId, note, { now: deps.now, asStaff });
}
export async function clientRevise(deps, { role, organizationId, userId, asStaff = false, requestId, note }) {
  if (!can(role, "requests.approve_proof")) return fail("forbidden");
  return repo.clientRequestRevision(deps.db, organizationId, userId, requestId, note, { now: deps.now, asStaff });
}
export async function clientCancel(deps, { role, organizationId, userId, asStaff = false, requestId, note }) {
  if (!can(role, "requests.view")) return fail("forbidden");
  const cur = await repo.getRequest(deps.db, organizationId, requestId);
  if (!cur) return fail("not_found");
  // an owner may withdraw any request of the organization; a member only their own
  if (!can(role, "requests.accept_quote") && cur.submittedBy !== userId && !asStaff) return fail("forbidden");
  return repo.clientCancel(deps.db, organizationId, userId, requestId, note, { now: deps.now, asStaff });
}

/**
 * Accepting a quote in the portal. Closed (fail("acceptance_closed")) until Framework's terms exist AND PORTAL_REQUESTS_QUOTES is on; owners only; the typed name is required.
 * `terms` is injectable for tests; production uses QUOTE_TERMS.
 */
export async function clientAcceptQuote(deps, { role, organizationId, userId, asStaff = false, requestId, quoteId, typedName, terms = QUOTE_TERMS }) {
  if (!can(role, "requests.accept_quote")) return fail("forbidden");
  if (!quoteAcceptanceOpen(deps.env, terms)) return fail("acceptance_closed");
  return repo.approveRequest(deps.db, organizationId, requestId, { via: "portal", quoteId, userId, acceptedName: typedName, termsVersion: terms.version, asStaff }, { now: deps.now });
}
export async function clientDeclineQuote(deps, { role, organizationId, userId, asStaff = false, requestId, quoteId, note }) {
  if (!can(role, "requests.accept_quote")) return fail("forbidden");
  return repo.declineQuote(deps.db, organizationId, userId, requestId, quoteId, note, { now: deps.now, asStaff });
}

/* ------------------------------------------------------------------ downloads out */

async function stream(deps, { organizationId, requestId, row, preview, actorType, actorRef }) {
  const key = preview ? row.previewKey : row.storageKey;
  if (!key) return fail("not_found");
  let object;
  try { object = await getObject(deps.bucket, { key, organizationId }); } catch (err) { return storageFail(err); }
  if (!object) return fail("not_found");
  await recordActivity(deps.db, { organizationId, actorType, actorRef, action: preview ? "request.preview.view" : "request.file.download", entityType: "request", entityId: requestId, visibility: "internal" }, { now: deps.now });
  const ext = preview ? row.previewFormat : row.format;
  const size = preview ? undefined : row.size;
  // Only a proof's picture (the file itself when it is an image, or its preview image) is ever shown inline; everything else is a download.
  const inlineImage = row.role === "proof" && ["png", "jpg", "webp"].includes(ext);
  return ok({ response: fileResponse({ object, name: row.name, ext, inlineImage, size }) });
}

/** A proof is viewed through its picture: the preview image if it has one, else the file itself when it is an image. */
export async function clientOpenFile(deps, { role, organizationId, userId, requestId, fileId, view = false }) {
  if (!can(role, "requests.view")) return fail("forbidden");
  const row = await repo.getClientFile(deps.db, organizationId, requestId, fileId);
  if (!row) return fail("not_found");
  if (!view && row.role === "proof") return fail("not_found"); // a proof is looked at, never handed over: only the final files are downloads
  const preview = view && row.role === "proof" && !!row.previewKey;
  if (view && row.role === "proof" && !preview && !["png", "jpg", "webp"].includes(row.format)) return fail("not_found");
  if (view && row.role !== "proof") return fail("not_found");
  return stream(deps, { organizationId, requestId, row, preview, actorType: "client", actorRef: userId });
}

export async function adminOpenFile(deps, { organizationId, requestId, fileId, view = false, actor }) {
  const row = await repo.getAdminFile(deps.db, organizationId, requestId, fileId);
  if (!row) return fail("not_found");
  const preview = view && row.role === "proof" && !!row.previewKey;
  return stream(deps, { organizationId, requestId, row, preview, actorType: "admin", actorRef: actor });
}

/* ------------------------------------------------------------------ staff files in */

const ROLE_PROFILE = { proof: "request_proof", final: "request_final", attachment: "request_reference" };
const ROLE_MAX = { proof: 25 * 1024 * 1024, final: ADMIN_MAX_FILE_BYTES, attachment: repo.MAX_FILE_BYTES };

/**
 * Framework adds a file: a proof (kept as a draft until the request is sent for review), a final deliverable (released when the request is completed) or an attachment
 * the client can see now. One file per call.
 */
export async function adminUpload(deps, { organizationId, requestId, role, file, actor, note = "" }) {
  if (!ROLE_PROFILE[role]) return fail("invalid_role");
  const cur = await repo.getRequest(deps.db, organizationId, requestId);
  if (!cur) return fail("not_found");
  if (role === "proof" && cur.kind !== "deliverable") return fail("not_allowed");
  if (!deps.bucket) return fail("storage_unavailable");
  const r = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: ROLE_PROFILE[role], maxBytes: ROLE_MAX[role] });
  if (!r.ok) return fail(r.error);
  const ev = await repo.addFileEvent(deps.db, organizationId, requestId, role === "proof" ? "proof" : role === "final" ? "delivery" : "message", actor, { body: note, visibility: role === "attachment" ? "client" : "internal", now: deps.now });
  if (!ev.ok) return ev;
  const att = await attach(deps, { organizationId, requestId, eventId: ev.eventId, role, uploaderType: "staff", files: [{ inspected: r, bytes: file.bytes }] });
  return att.attached ? ok({ eventId: ev.eventId }) : fail(att.error || "storage_write_failed");
}

/** A picture to show for a PDF proof. */
export async function adminUploadPreview(deps, { organizationId, requestId, fileId, file }) {
  if (!deps.bucket) return fail("storage_unavailable");
  const row = await repo.getAdminFile(deps.db, organizationId, requestId, fileId);
  if (!row || row.role !== "proof") return fail("not_found");
  if (row.previewKey) return fail("conflict");
  const r = await inspectUpload({ bytes: file && file.bytes, originalName: file && file.name, profile: "request_preview", maxBytes: 8 * 1024 * 1024 });
  if (!r.ok) return fail(r.error);
  const key = makeKey(organizationId, "requests");
  try { await putObject(deps.bucket, { key, organizationId, bytes: file.bytes, sha256: r.sha256, contentType: r.contentType }); } catch (err) { return storageFail(err); }
  let rec;
  try { rec = await repo.setPreview(deps.db, organizationId, requestId, fileId, { storageKey: key, ext: r.ext, contentType: r.contentType, size: r.size, sha256: r.sha256 }); }
  catch (err) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* orphan */ } throw err; }
  if (!rec.ok) { try { await deleteObject(deps.bucket, { key, organizationId }); } catch { /* orphan */ } return rec; }
  return ok();
}
