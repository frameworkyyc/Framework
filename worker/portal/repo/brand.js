/**
 * Branding data layer: the brand kit (colours, typography, publication), Framework-delivered assets, client uploads and service requests.
 * Metadata only: file CONTENT lives in private R2 (see ../files/storage.js and ../brand-files.js, which keep the two in step).
 *
 * Rules, on top of the shared repository rules (common.js):
 *  - Every function takes the organization id explicitly and every statement names organization_id. A row is addressed by (id, organization_id), so an id from
 *    another organization is simply "not found".
 *  - Clients only ever read through the client_* functions. They return rows only when the KIT is published AND the asset is published AND it is not deleted,
 *    and never return storage keys, hashes or draft/published state: a draft is indistinguishable from "nothing there".
 *  - Client-submitted files (brand_uploads) and Framework deliverables (brand_assets) are different tables with different functions: there is no code path
 *    that turns an upload into a deliverable or lets a client write a deliverable.
 *  - Callers outside this module decide WHO may call (policy.js for clients, Cloudflare Access for Admin). `actor` strings are audit labels, not credentials.
 */
import { newId, isoTime, requireOrgId, requireUserId, requireId, ok, fail, isUniqueViolation, isConstraintViolation, validActor } from "./common.js";
import { validateEnum, validateName, validateText, validateHttpsUrl } from "./validate.js";
import { recordActivity } from "./activity.js";
import { usableName } from "../../../admin/assets/brand-names.js";

export const ASSET_KINDS = ["logo", "guideline", "document", "font", "package", "other"];
export const LOGO_ROLES = ["primary", "simplified", "icon"];
export const ORIENTATIONS = ["horizontal", "vertical", "square"];
export const TONES = ["light", "dark", "colour", "mono"];
export const UPLOAD_CATEGORIES = ["logo", "fonts", "colours", "guidelines", "stationery", "signature", "other"];
export const COLOUR_ROLES = ["primary", "secondary", "accent", "neutral"];
export const TYPE_ROLES = ["logo", "heading", "subheading", "body", "other"];
export const REQUEST_STATUSES = ["new", "contacted", "closed", "declined"];
const MAX_COLOURS = 16, MAX_TYPEFACES = 12;

const parseList = (text) => { try { const v = JSON.parse(text); return Array.isArray(v) ? v : []; } catch { return []; } };
const bool = (v) => (v ? 1 : 0);

/* ------------------------------------------------------------------ validation of the kit's documents */

export function normaliseColours(list) {
  if (!Array.isArray(list) || list.length > MAX_COLOURS) return fail("invalid_colours");
  const out = [];
  for (const c of list) {
    if (!c || typeof c !== "object") return fail("invalid_colours");
    const name = validateName(c.name, 40), role = validateEnum(c.role, COLOUR_ROLES);
    const hex = typeof c.hex === "string" && /^#[0-9A-Fa-f]{6}$/.test(c.hex) ? c.hex.toUpperCase() : null;
    const note = validateText(c.note, 120);
    if (!name || !role || !hex || note === undefined) return fail("invalid_colours");
    out.push({ name, role, hex, note });
  }
  return ok({ value: out });
}

export function normaliseTypography(list) {
  if (!Array.isArray(list) || list.length > MAX_TYPEFACES) return fail("invalid_typography");
  const out = [];
  for (const t of list) {
    if (!t || typeof t !== "object") return fail("invalid_typography");
    const family = validateName(t.family, 80), role = validateEnum(t.role, TYPE_ROLES);
    const usage = validateText(t.usage, 300), source = validateHttpsUrl(t.source_url);
    const weights = t.weights === undefined || t.weights === null ? [] : t.weights;
    if (!family || !role || usage === undefined || source === undefined || !Array.isArray(weights) || weights.length > 9 || !weights.every((w) => Number.isInteger(w) && w >= 100 && w <= 900 && w % 100 === 0)) return fail("invalid_typography");
    out.push({ family, role, weights: [...new Set(weights)].sort((a, b) => a - b), usage, source_url: source });
  }
  return ok({ value: out });
}

/** The optional brand name used in generated file names: single-line text of up to 60 characters that leaves letters or digits for a file name. null = none (the organization's name is used). */
export function normaliseBrandName(raw) {
  if (raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "")) return ok({ value: null });
  const v = validateName(raw, 60);
  return v && usableName(v) ? ok({ value: v }) : fail("invalid_brand_name");
}

/* ------------------------------------------------------------------ audit (written in the same transaction as the change it describes) */

function auditAfterChange(db, { organizationId, actorType, actorRef, action, entityType, entityId, visibility = "internal", at }) {
  return db
    .prepare(
      "INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0",
    )
    .bind(newId(), organizationId, actorType, actorRef, action, entityType, entityId, visibility, at);
}

/** Recorded for every download. Holds the entity and who, never an address, a key or a token. */
export async function recordBrandDownload(db, { organizationId, actorType, actorRef, entityType, entityId, now = new Date() }) {
  requireOrgId(organizationId);
  return recordActivity(db, { organizationId, actorType, actorRef, action: entityType === "brand_upload" ? "brand.upload.download" : "brand.asset.download", entityType, entityId, visibility: "internal" }, { now });
}

/* ------------------------------------------------------------------ brand kit */

export async function getBrandKit(db, organizationId) {
  requireOrgId(organizationId);
  const row = await db.prepare("SELECT organization_id, status, colours_json, typography_json, brand_name, updated_at, updated_by, published_at, published_by FROM brand_kits WHERE organization_id = ?").bind(organizationId).first();
  return row ? { organizationId: row.organization_id, status: row.status, colours: parseList(row.colours_json), typography: parseList(row.typography_json), brandName: row.brand_name, updatedAt: row.updated_at, updatedBy: row.updated_by, publishedAt: row.published_at, publishedBy: row.published_by } : null;
}

/** Saves colours, typography and/or the brand name (whatever is passed; the rest is kept). A new kit starts as a draft; saving never publishes or unpublishes, and never renames an existing file. */
export async function saveBrandKit(db, organizationId, { colours, typography, brandName }, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  const current = await getBrandKit(db, organizationId);
  let c = current ? current.colours : [], t = current ? current.typography : [], bn = current ? current.brandName : null;
  if (colours !== undefined) { const r = normaliseColours(colours); if (!r.ok) return r; c = r.value; }
  if (typography !== undefined) { const r = normaliseTypography(typography); if (!r.ok) return r; t = r.value; }
  if (brandName !== undefined) { const r = normaliseBrandName(brandName); if (!r.ok) return r; bn = r.value; }
  const at = isoTime(now);
  try {
    await db.batch([
      db
        .prepare(
          "INSERT INTO brand_kits (organization_id, status, colours_json, typography_json, brand_name, created_at, updated_at, updated_by) VALUES (?, 'draft', ?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id) DO UPDATE SET colours_json = excluded.colours_json, typography_json = excluded.typography_json, brand_name = excluded.brand_name, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        )
        .bind(organizationId, JSON.stringify(c), JSON.stringify(t), bn, at, at, actor.trim()),
      auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: brandName !== undefined && colours === undefined && typography === undefined ? "brand.kit.brand_name_saved" : "brand.kit.saved", entityType: "brand_kit", entityId: organizationId, at }),
    ]);
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_kit");
    throw err;
  }
  return ok();
}

export async function setBrandKitStatus(db, organizationId, status, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (!validateEnum(status, ["draft", "published"])) return fail("invalid_status");
  const at = isoTime(now);
  const res = await db.batch([
    db
      .prepare("UPDATE brand_kits SET status = ?, published_at = ?, published_by = ?, updated_at = ?, updated_by = ? WHERE organization_id = ? AND status <> ?")
      .bind(status, status === "published" ? at : null, status === "published" ? actor.trim() : null, at, actor.trim(), organizationId, status),
    auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: status === "published" ? "brand.kit.published" : "brand.kit.unpublished", entityType: "brand_kit", entityId: organizationId, visibility: "internal", at }),
  ]);
  if (res[0].meta.changes === 1) return ok({ changed: true });
  return (await getBrandKit(db, organizationId)) ? ok({ changed: false }) : fail("not_found");
}

/* ------------------------------------------------------------------ Framework deliverables (brand_assets) */

const ASSET_COLUMNS = "id, organization_id, kind, title, variant_key, logo_role, orientation, tone, transparent, usage_note, downloadable, license_note, format, content_type, size_bytes, sha256, storage_key, original_name, published, sort_order, created_at, created_by, updated_at";

function assetMeta(meta, { forCreate }) {
  const out = {};
  if (forCreate || "kind" in meta) { out.kind = validateEnum(meta.kind, ASSET_KINDS); if (!out.kind) return fail("invalid_kind"); }
  if (forCreate || "title" in meta) { out.title = validateName(meta.title, 120); if (!out.title) return fail("invalid_title"); }
  if ("variant_key" in meta) { const v = meta.variant_key; out.variant_key = v === null || v === "" ? null : typeof v === "string" && /^[a-z0-9-]{1,60}$/.test(v) ? v : undefined; if (out.variant_key === undefined) return fail("invalid_variant"); }
  for (const [key, list] of [["logo_role", LOGO_ROLES], ["orientation", ORIENTATIONS], ["tone", TONES]]) if (key in meta) { out[key] = meta[key] === null || meta[key] === "" ? null : validateEnum(meta[key], list); if (out[key] === null && meta[key] !== null && meta[key] !== "") return fail("invalid_" + key); }
  if ("transparent" in meta) out.transparent = bool(meta.transparent);
  for (const [key, max] of [["usage_note", 300], ["license_note", 300]]) if (key in meta) { const t = validateText(meta[key], max); if (t === undefined) return fail("invalid_" + key); out[key] = t; }
  if ("downloadable" in meta) out.downloadable = bool(meta.downloadable);
  if ("sort_order" in meta) { if (!Number.isInteger(meta.sort_order) || meta.sort_order < 0 || meta.sort_order > 10000) return fail("invalid_sort_order"); out.sort_order = meta.sort_order; }
  if ("published" in meta) out.published = bool(meta.published);
  if ("original_name" in meta) { // the generated download name: only the file service sets it (the HTTP layer never forwards it), and it must be plain letters, digits and hyphens plus an extension
    if (typeof meta.original_name !== "string" || !/^[A-Za-z0-9-]{1,100}\.[a-z0-9]{1,8}$/.test(meta.original_name)) return fail("invalid_input");
    out.original_name = meta.original_name;
  }
  return ok({ value: out });
}

/** A font is downloadable only on purpose: Admin must say so AND record the licence. Everything else defaults to downloadable. */
const fontRule = (kind, downloadable, licenseNote) => (kind === "font" && downloadable === 1 && !licenseNote ? fail("font_license_required") : null);

export async function createBrandAsset(db, organizationId, meta, file, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (!meta || typeof meta !== "object") return fail("invalid_input");
  const m = assetMeta(meta, { forCreate: true });
  if (!m.ok) return m;
  const v = m.value;
  if (v.kind === "font" && !("downloadable" in meta)) v.downloadable = 0;
  const lic = fontRule(v.kind, v.downloadable ?? 1, v.license_note ?? null);
  if (lic) return lic;
  const id = newId(), at = isoTime(now);
  let res;
  try {
    res = await db.batch([
      db
        .prepare(
          `INSERT INTO brand_assets (id, organization_id, kind, title, variant_key, logo_role, orientation, tone, transparent, usage_note, downloadable, license_note, format, content_type, size_bytes, sha256, storage_key, original_name, published, sort_order, created_at, created_by, updated_at)
           SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (SELECT 1 FROM brand_assets d WHERE d.organization_id = ? AND d.deleted_at IS NULL AND lower(d.original_name) = lower(?))`,
        )
        .bind(id, organizationId, v.kind, v.title, v.variant_key ?? null, v.logo_role ?? null, v.orientation ?? null, v.tone ?? null, v.transparent ?? 0, v.usage_note ?? null, v.downloadable ?? 1, v.license_note ?? null,
          file.ext, file.contentType, file.size, file.sha256, file.storageKey, file.name, v.published ?? 0, v.sort_order ?? 0, at, actor.trim(), at, organizationId, file.name),
      auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "brand.asset.created", entityType: "brand_asset", entityId: id, at }),
    ]);
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_input");
    throw err;
  }
  return res[0].meta.changes === 1 ? ok({ id }) : fail("duplicate_name"); // the name is already used by a live file of this organization: never overwritten, never renamed
}

/** Is this download name already used by a live file of the organization (case-insensitive)? `exceptId` excludes the file being changed. */
export async function brandAssetNameTaken(db, organizationId, name, exceptId = null) {
  requireOrgId(organizationId);
  const r = await db.prepare("SELECT 1 AS taken FROM brand_assets WHERE organization_id = ? AND deleted_at IS NULL AND lower(original_name) = lower(?) AND id <> ?").bind(organizationId, name, exceptId || "-").first();
  return Boolean(r);
}

export async function updateBrandAsset(db, organizationId, assetId, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assetId, "asset_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || !Object.keys(patch).length) return fail("invalid_input");
  const m = assetMeta(patch, { forCreate: false });
  if (!m.ok) return m;
  if (!Object.keys(m.value).length) return fail("invalid_input"); // nothing the caller sent is a field that may be changed
  const cur = await getBrandAssetAdmin(db, organizationId, assetId);
  if (!cur) return fail("not_found");
  const merged = { downloadable: cur.downloadable ? 1 : 0, license_note: cur.licenseNote, ...m.value };
  const lic = fontRule(m.value.kind ?? cur.kind, merged.downloadable, merged.license_note);
  if (lic) return lic;
  const COLUMN = { kind: "kind", title: "title", variant_key: "variant_key", logo_role: "logo_role", orientation: "orientation", tone: "tone", transparent: "transparent", usage_note: "usage_note", downloadable: "downloadable", license_note: "license_note", sort_order: "sort_order", published: "published", original_name: "original_name" };
  const sets = [], values = [];
  for (const [k, val] of Object.entries(m.value)) { sets.push(`${COLUMN[k]} = ?`); values.push(val); }
  const at = isoTime(now);
  const renaming = "original_name" in m.value;
  const published = "published" in m.value && m.value.published !== (cur.published ? 1 : 0) ? (m.value.published ? "brand.asset.published" : "brand.asset.unpublished") : "brand.asset.updated";
  const audit = auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: renaming ? "brand.asset.renamed" : published, entityType: "brand_asset", entityId: assetId, at });
  try {
    // a rename is refused by the statement itself when another live file of the organization already has that name
    const update = renaming
      ? db.prepare(`UPDATE brand_assets SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM brand_assets d WHERE d.organization_id = ? AND d.id <> ? AND d.deleted_at IS NULL AND lower(d.original_name) = lower(?))`).bind(...values, at, assetId, organizationId, organizationId, assetId, m.value.original_name)
      : db.prepare(`UPDATE brand_assets SET ${sets.join(", ")}, updated_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`).bind(...values, at, assetId, organizationId);
    const res = await db.batch([update, audit]);
    if (res[0].meta.changes === 1) return ok();
    return renaming && (await getBrandAssetAdmin(db, organizationId, assetId)) ? fail("duplicate_name") : fail("not_found");
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_input");
    throw err;
  }
}

/** Swaps the stored file of one asset. Returns the previous storage key so the caller can delete that object after this succeeds. */
export async function replaceBrandAssetFile(db, organizationId, assetId, file, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assetId, "asset_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const cur = await getBrandAssetAdmin(db, organizationId, assetId);
  if (!cur) return fail("not_found");
  const at = isoTime(now);
  const res = await db.batch([
    db
      .prepare(
        `UPDATE brand_assets SET format = ?, content_type = ?, size_bytes = ?, sha256 = ?, storage_key = ?, original_name = ?, updated_at = ?
          WHERE id = ? AND organization_id = ? AND storage_key = ? AND deleted_at IS NULL
            AND NOT EXISTS (SELECT 1 FROM brand_assets d WHERE d.organization_id = ? AND d.id <> ? AND d.deleted_at IS NULL AND lower(d.original_name) = lower(?))`,
      )
      .bind(file.ext, file.contentType, file.size, file.sha256, file.storageKey, file.name, at, assetId, organizationId, cur.storageKey, organizationId, assetId, file.name),
    auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "brand.asset.replaced", entityType: "brand_asset", entityId: assetId, at }),
  ]);
  if (res[0].meta.changes === 1) return ok({ previousKey: cur.storageKey });
  return (await brandAssetNameTaken(db, organizationId, file.name, assetId)) ? fail("duplicate_name") : fail("conflict");
}

/** Soft delete: the row stays as a tombstone for the audit trail, is unpublished, and its storage key is returned so the object can be deleted at once. */
export async function deleteBrandAsset(db, organizationId, assetId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(assetId, "asset_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const cur = await getBrandAssetAdmin(db, organizationId, assetId);
  if (!cur) return fail("not_found");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE brand_assets SET deleted_at = ?, published = 0, updated_at = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL").bind(at, at, assetId, organizationId),
    auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "brand.asset.deleted", entityType: "brand_asset", entityId: assetId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok({ storageKey: cur.storageKey }) : fail("not_found");
}

const adminAsset = (r) => ({ id: r.id, organizationId: r.organization_id, kind: r.kind, title: r.title, variantKey: r.variant_key, logoRole: r.logo_role, orientation: r.orientation, tone: r.tone, transparent: !!r.transparent, usageNote: r.usage_note, downloadable: !!r.downloadable, licenseNote: r.license_note, format: r.format, contentType: r.content_type, size: r.size_bytes, sha256: r.sha256, storageKey: r.storage_key, originalName: r.original_name, published: !!r.published, sortOrder: r.sort_order, createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at });

export async function getBrandAssetAdmin(db, organizationId, assetId) {
  requireOrgId(organizationId); requireId(assetId, "asset_id");
  const r = await db.prepare(`SELECT ${ASSET_COLUMNS} FROM brand_assets WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`).bind(assetId, organizationId).first();
  return r ? adminAsset(r) : null;
}

export async function listBrandAssetsAdmin(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare(`SELECT ${ASSET_COLUMNS} FROM brand_assets WHERE organization_id = ? AND deleted_at IS NULL ORDER BY kind, sort_order, created_at, id`).bind(organizationId).all()).results.map(adminAsset);
}

/* ------------------------------------------------------------------ what a CLIENT may see */

const VISIBLE = "a.deleted_at IS NULL AND a.published = 1 AND EXISTS (SELECT 1 FROM brand_kits k WHERE k.organization_id = a.organization_id AND k.status = 'published')";

/** The published brand kit for one organization, or { published: false }. Never includes keys, hashes, drafts or anything unpublished. */
export async function getClientBrand(db, organizationId) {
  requireOrgId(organizationId);
  const kit = await getBrandKit(db, organizationId);
  if (!kit || kit.status !== "published") return { published: false };
  const rows = (await db
    .prepare(`SELECT a.id, a.kind, a.title, a.variant_key, a.logo_role, a.orientation, a.tone, a.transparent, a.usage_note, a.downloadable, a.license_note, a.format, a.size_bytes, a.sort_order FROM brand_assets a WHERE a.organization_id = ? AND ${VISIBLE} ORDER BY a.kind, a.sort_order, a.created_at, a.id`)
    .bind(organizationId).all()).results;
  return {
    published: true, publishedAt: kit.publishedAt, colours: kit.colours, typography: kit.typography,
    assets: rows.map((r) => ({ id: r.id, kind: r.kind, title: r.title, variantKey: r.variant_key, logoRole: r.logo_role, orientation: r.orientation, tone: r.tone, transparent: !!r.transparent, usageNote: r.usage_note, canDownload: r.kind !== "font" || !!r.downloadable, licenseNote: r.kind === "font" ? r.license_note : null, format: r.format, size: r.size_bytes })),
  };
}

/** One deliverable a client may download, or null (not published, kit not published, deleted, another organization's, or a font that is not licensed for download). */
export async function getClientBrandAsset(db, organizationId, assetId) {
  requireOrgId(organizationId); requireId(assetId, "asset_id");
  const r = await db.prepare(`SELECT a.id, a.kind, a.title, a.format, a.content_type, a.size_bytes, a.storage_key, a.original_name, a.downloadable FROM brand_assets a WHERE a.id = ? AND a.organization_id = ? AND ${VISIBLE}`).bind(assetId, organizationId).first();
  if (!r || (r.kind === "font" && !r.downloadable)) return null;
  return { id: r.id, kind: r.kind, title: r.title, format: r.format, contentType: r.content_type, size: r.size_bytes, storageKey: r.storage_key, originalName: r.original_name };
}

/* ------------------------------------------------------------------ client uploads (brand_uploads) */

const UPLOAD_COLUMNS = "id, organization_id, category, original_name, format, content_type, size_bytes, sha256, storage_key, uploaded_by, font_rights_ack, status, admin_seen_at, created_at";
const UPLOAD_COLUMNS_U = UPLOAD_COLUMNS.split(", ").map((c) => "u." + c).join(", ");
const upload = (r) => ({ id: r.id, organizationId: r.organization_id, category: r.category, originalName: r.original_name, format: r.format, contentType: r.content_type, size: r.size_bytes, sha256: r.sha256, storageKey: r.storage_key, uploadedBy: r.uploaded_by, fontRightsAck: !!r.font_rights_ack, status: r.status, adminSeenAt: r.admin_seen_at, createdAt: r.created_at });

/** How much room an organization has left (live files only). */
export async function uploadUsage(db, organizationId) {
  requireOrgId(organizationId);
  const r = await db.prepare("SELECT count(*) AS files, COALESCE(sum(size_bytes), 0) AS bytes FROM brand_uploads WHERE organization_id = ? AND deleted_at IS NULL").bind(organizationId).first();
  return { files: r.files, bytes: r.bytes };
}

/**
 * Records a client upload. The limits are enforced INSIDE the insert (one statement: the row is written only if the file count and the byte total stay within
 * the limits, and only if the uploader is an active member of this organization), so two uploads at once cannot both slip past the quota.
 */
export async function createClientUpload(db, organizationId, userId, { category, fontRightsAck }, file, limits, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireUserId(userId);
  const cat = validateEnum(category, UPLOAD_CATEGORIES);
  if (!cat) return fail("invalid_category");
  const fontFile = ["ttf", "otf", "woff", "woff2"].includes(file.ext);
  if ((cat === "fonts" || fontFile) && fontRightsAck !== true) return fail("font_rights_required");
  const id = newId(), at = isoTime(now);
  const ack = bool(fontRightsAck === true);
  if (cat === "fonts" && !ack) return fail("font_rights_required");
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO brand_uploads (id, organization_id, category, original_name, format, content_type, size_bytes, sha256, storage_key, uploaded_by, font_rights_ack, status, created_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?
          WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active')
            AND (SELECT count(*) FROM brand_uploads u WHERE u.organization_id = ? AND u.deleted_at IS NULL) < ?
            AND (SELECT COALESCE(sum(u.size_bytes), 0) FROM brand_uploads u WHERE u.organization_id = ? AND u.deleted_at IS NULL) + ? <= ?`,
      )
      .bind(id, organizationId, cat, file.name, file.ext, file.contentType, file.size, file.sha256, file.storageKey, userId, ack, at, organizationId, userId, organizationId, limits.maxFiles, organizationId, file.size, limits.quotaBytes),
    auditAfterChange(db, { organizationId, actorType: "client", actorRef: userId, action: "brand.upload.created", entityType: "brand_upload", entityId: id, visibility: "internal", at }),
  ]);
  if (res[0].meta.changes === 1) return ok({ id });
  const use = await uploadUsage(db, organizationId);
  if (use.files >= limits.maxFiles) return fail("file_limit");
  if (use.bytes + file.size > limits.quotaBytes) return fail("quota_exceeded");
  return fail("not_allowed");
}

/** What a client sees of their own organization's uploads: no keys, no hashes. */
export async function listClientUploads(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare("SELECT id, category, original_name, format, size_bytes, status, created_at FROM brand_uploads WHERE organization_id = ? AND deleted_at IS NULL ORDER BY created_at DESC, id").bind(organizationId).all()).results
    .map((r) => ({ id: r.id, category: r.category, name: r.original_name, format: r.format, size: r.size_bytes, held: r.status === "held", createdAt: r.created_at }));
}

/** A client-submitted file that may be downloaded: not deleted and not held. */
export async function getDownloadableUpload(db, organizationId, uploadId) {
  requireOrgId(organizationId); requireId(uploadId, "upload_id");
  const r = await db.prepare(`SELECT ${UPLOAD_COLUMNS} FROM brand_uploads WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND status = 'available'`).bind(uploadId, organizationId).first();
  return r ? upload(r) : null;
}

export async function getUploadAdmin(db, organizationId, uploadId) {
  requireOrgId(organizationId); requireId(uploadId, "upload_id");
  const r = await db.prepare(`SELECT ${UPLOAD_COLUMNS} FROM brand_uploads WHERE id = ? AND organization_id = ? AND deleted_at IS NULL`).bind(uploadId, organizationId).first();
  return r ? upload(r) : null;
}

export async function listUploadsAdmin(db, organizationId) {
  requireOrgId(organizationId);
  return (await db
    .prepare(`SELECT ${UPLOAD_COLUMNS_U}, p.email AS uploader_email, p.name AS uploader_name FROM brand_uploads u JOIN portal_users p ON p.id = u.uploaded_by WHERE u.organization_id = ? AND u.deleted_at IS NULL ORDER BY u.created_at DESC, u.id`)
    .bind(organizationId).all()).results.map((r) => ({ ...upload(r), uploaderEmail: r.uploader_email, uploaderName: r.uploader_name }));
}

/** Counts for the client page and the Admin dashboard: what exists and what needs a look. Admin only. */
export async function brandingSummary(db, organizationId) {
  requireOrgId(organizationId);
  const r = await db
    .prepare(
      `SELECT (SELECT status FROM brand_kits WHERE organization_id = ?) AS kit_status,
              (SELECT count(*) FROM brand_assets WHERE organization_id = ? AND deleted_at IS NULL) AS assets,
              (SELECT count(*) FROM brand_assets WHERE organization_id = ? AND deleted_at IS NULL AND published = 1) AS assets_published,
              (SELECT count(*) FROM brand_uploads WHERE organization_id = ? AND deleted_at IS NULL) AS uploads,
              (SELECT count(*) FROM brand_uploads WHERE organization_id = ? AND deleted_at IS NULL AND admin_seen_at IS NULL) AS uploads_new,
              (SELECT count(*) FROM service_requests WHERE organization_id = ? AND status IN ('new', 'contacted')) AS requests_open,
              (SELECT count(*) FROM service_requests WHERE organization_id = ? AND status = 'new') AS requests_new`,
    )
    .bind(organizationId, organizationId, organizationId, organizationId, organizationId, organizationId, organizationId).first();
  return { kitStatus: r.kit_status || null, assets: r.assets, assetsPublished: r.assets_published, uploads: r.uploads, uploadsNew: r.uploads_new, requestsOpen: r.requests_open, requestsNew: r.requests_new };
}

/** Soft-deletes one upload and returns its storage key. `by` is a client user id or an admin label; who may call this is decided by the caller. */
export async function deleteUpload(db, organizationId, uploadId, { by, actorType, now = new Date() }) {
  requireOrgId(organizationId); requireId(uploadId, "upload_id");
  if (!["client", "admin"].includes(actorType) || typeof by !== "string" || !by || by.length > 254) return fail("invalid_actor");
  const cur = await getUploadAdmin(db, organizationId, uploadId);
  if (!cur) return fail("not_found");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE brand_uploads SET deleted_at = ?, deleted_by = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL").bind(at, by, uploadId, organizationId),
    auditAfterChange(db, { organizationId, actorType, actorRef: by, action: "brand.upload.deleted", entityType: "brand_upload", entityId: uploadId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok({ storageKey: cur.storageKey }) : fail("not_found");
}

export async function setUploadHeld(db, organizationId, uploadId, held, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(uploadId, "upload_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE brand_uploads SET status = ? WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND status <> ?").bind(held ? "held" : "available", uploadId, organizationId, held ? "held" : "available"),
    auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: held ? "brand.upload.held" : "brand.upload.released", entityType: "brand_upload", entityId: uploadId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

export async function markUploadsSeen(db, organizationId, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const r = await db.prepare("UPDATE brand_uploads SET admin_seen_at = ? WHERE organization_id = ? AND deleted_at IS NULL AND admin_seen_at IS NULL").bind(isoTime(now), organizationId).run();
  return ok({ marked: r.meta.changes });
}

/* ------------------------------------------------------------------ service requests ("Request a quote") */

const request = (r) => ({ id: r.id, serviceKey: r.service_key, status: r.status, note: r.note, requestedBy: r.requested_by, createdAt: r.created_at, handledBy: r.handled_by, handledAt: r.handled_at, adminNote: r.admin_note });
const REQUEST_COLUMNS = "id, service_key, status, note, requested_by, created_at, handled_by, handled_at, admin_note";

/** One open request per organization and service (a database rule, so it holds under concurrency). `isKnownService` is the catalogue check supplied by the caller. */
export async function createServiceRequest(db, organizationId, userId, { serviceKey, note }, isKnownService, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireUserId(userId);
  if (typeof isKnownService !== "function" || typeof serviceKey !== "string" || !isKnownService(serviceKey)) return fail("unknown_service");
  const text = validateText(note, 1000);
  if (text === undefined) return fail("invalid_note");
  const id = newId(), at = isoTime(now);
  try {
    const res = await db.batch([
      db
        .prepare("INSERT INTO service_requests (id, organization_id, service_key, status, note, requested_by, created_at) SELECT ?, ?, ?, 'new', ?, ?, ? WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = ? AND m.user_id = ? AND m.status = 'active')")
        .bind(id, organizationId, serviceKey, text, userId, at, organizationId, userId),
      auditAfterChange(db, { organizationId, actorType: "client", actorRef: userId, action: "service.requested", entityType: "service_request", entityId: id, visibility: "client", at }),
    ]);
    return res[0].meta.changes === 1 ? ok({ id }) : fail("not_allowed");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("already_requested");
    throw err;
  }
}

export async function listServiceRequests(db, organizationId, { openOnly = false } = {}) {
  requireOrgId(organizationId);
  const rows = (await db.prepare(`SELECT ${REQUEST_COLUMNS} FROM service_requests WHERE organization_id = ? ORDER BY created_at DESC, id`).bind(organizationId).all()).results.map(request);
  return openOnly ? rows.filter((r) => r.status === "new" || r.status === "contacted") : rows;
}

export async function updateServiceRequest(db, organizationId, requestId, { status, adminNote }, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(requestId, "request_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const st = validateEnum(status, REQUEST_STATUSES);
  const note = validateText(adminNote, 1000);
  if (!st) return fail("invalid_status");
  if (note === undefined) return fail("invalid_note");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare("UPDATE service_requests SET status = ?, admin_note = ?, handled_by = ?, handled_at = ? WHERE id = ? AND organization_id = ?").bind(st, note, actor.trim(), at, requestId, organizationId),
      auditAfterChange(db, { organizationId, actorType: "admin", actorRef: actor.trim(), action: "service.request.updated", entityType: "service_request", entityId: requestId, at }),
    ]);
    return res[0].meta.changes === 1 ? ok() : fail("not_found");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("already_open"); // re-opening would duplicate another open request for the same service
    throw err;
  }
}

/* ------------------------------------------------------------------ every stored key of one organization (offboarding, orphan check) */

export async function listLiveStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  const a = (await db.prepare("SELECT storage_key FROM brand_assets WHERE organization_id = ? AND deleted_at IS NULL").bind(organizationId).all()).results;
  const u = (await db.prepare("SELECT storage_key FROM brand_uploads WHERE organization_id = ? AND deleted_at IS NULL").bind(organizationId).all()).results;
  return [...a, ...u].map((r) => r.storage_key);
}

/** Soft-deletes every file row of one organization at once (offboarding). Returns how many rows changed. */
export async function tombstoneAllFiles(db, organizationId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE brand_assets SET deleted_at = ?, published = 0, updated_at = ? WHERE organization_id = ? AND deleted_at IS NULL").bind(at, at, organizationId),
    db.prepare("UPDATE brand_uploads SET deleted_at = ?, deleted_by = ? WHERE organization_id = ? AND deleted_at IS NULL").bind(at, actor.trim(), organizationId),
  ]);
  return ok({ assets: res[0].meta.changes, uploads: res[1].meta.changes });
}
