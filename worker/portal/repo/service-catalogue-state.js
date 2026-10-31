/**
 * What goes with the Additional Services catalogue besides its text (migration 0016):
 *  - client_service_state: what Admin knows about ONE client and ONE service ('owned': they already have it, so it is not promoted to them; 'hidden': do not show it to them). No row = normal.
 *    Per organization: every statement names organization_id. Only Admin writes it; the portal reads only its own organization's rows.
 *  - portal_service_media: screenshots and examples of a service (global, like the catalogue): metadata here, the image itself one private object under the reserved catalogue area
 *    (../service-media-files.js keeps row and object in step). A client may see the picture of an ENABLED service only.
 * A database without migration 0016 reads as empty and writes answer "unavailable"; nothing else runs.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, validActor } from "./common.js";
import { validateText } from "./validate.js";
import { SERVICE_KEYS } from "./portal-services.js";

export const SERVICE_STATES = ["owned", "hidden"];
export const MAX_MEDIA_PER_SERVICE = 6;
const missing = (err) => /no such table|no such column/i.test(String(err && err.message));
const audit = (db, org, actor, action, entity, id, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, ?, ?, ?, 'internal', ?)").bind(newId(), org, actor.trim(), action, entity, id, JSON.stringify(detail), at);

/* ------------------------------------------------------------------ per-client state */

/** { serviceKey -> { state, note } } for one organization. */
export async function listClientServiceStates(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const { results } = await db.prepare("SELECT service_key, state, note, updated_by, updated_at FROM client_service_state WHERE organization_id = ? ORDER BY service_key").bind(organizationId).all();
    return { available: true, items: Object.fromEntries(results.map((r) => [r.service_key, { state: r.state, note: r.note, updatedBy: r.updated_by, updatedAt: r.updated_at }])) };
  } catch (err) { if (missing(err)) return { available: false, items: {} }; throw err; }
}

/** Set one service's state for a client, or return it to normal (state null: the row is removed). */
export async function setClientServiceState(db, organizationId, serviceKey, state, noteRaw, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof serviceKey !== "string" || !SERVICE_KEYS.includes(serviceKey)) return fail("invalid_service");
  if (state !== null && !SERVICE_STATES.includes(state)) return fail("invalid_state");
  const note = noteRaw === undefined || noteRaw === null || noteRaw === "" ? null : validateText(noteRaw, 300);
  if (note === undefined || (note && /\n/.test(note))) return fail("invalid_note");
  const at = isoTime(now);
  try {
    const before = await db.prepare("SELECT state, note FROM client_service_state WHERE organization_id = ? AND service_key = ?").bind(organizationId, serviceKey).first();
    if (state === null ? !before : before && before.state === state && (before.note || null) === note) return ok({ changed: false });
    await db.batch([
      state === null
        ? db.prepare("DELETE FROM client_service_state WHERE organization_id = ? AND service_key = ?").bind(organizationId, serviceKey)
        : db.prepare("INSERT INTO client_service_state (organization_id, service_key, state, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id, service_key) DO UPDATE SET state = excluded.state, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
          .bind(organizationId, serviceKey, state, note, actor.trim(), at),
      audit(db, organizationId, actor, state === null ? "service.state.cleared" : "service.state.set", "client_service_state", serviceKey, at, { service: serviceKey, state: state || "normal" }),
    ]);
    return ok({ changed: true });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/* ------------------------------------------------------------------ media */

const toMedia = (r) => ({ id: r.id, serviceKey: r.service_key, caption: r.caption, alt: r.alt, format: r.format, size: r.size_bytes, sortOrder: r.sort_order, createdAt: r.created_at });

/** Media of every service, grouped: Map(serviceKey -> media[]). Global (the catalogue is). */
export async function listServiceMedia(db, { keys = SERVICE_KEYS } = {}) {
  const out = new Map(keys.map((k) => [k, []]));
  try {
    const { results } = await db.prepare("SELECT id, service_key, caption, alt, format, size_bytes, sort_order, created_at FROM portal_service_media ORDER BY service_key, sort_order, created_at, id /* cross-tenant: the service catalogue's pictures are global */").all();
    for (const r of results) if (out.has(r.service_key)) out.get(r.service_key).push(toMedia(r));
  } catch (err) { if (!missing(err)) throw err; }
  return out;
}

/** The private object behind one picture, for the Worker only. clientOnly: only when its service is shown to clients. */
export async function getServiceMediaRecord(db, id, { clientOnly = false } = {}) {
  requireId(id, "media_id");
  const admin = "SELECT m.id, m.service_key, m.storage_key, m.format, m.size_bytes, m.alt FROM portal_service_media m WHERE m.id = ? /* cross-tenant: the service catalogue's pictures are global */";
  const client = "SELECT m.id, m.service_key, m.storage_key, m.format, m.size_bytes, m.alt FROM portal_service_media m JOIN portal_services s ON s.service_key = m.service_key AND s.enabled = 1 WHERE m.id = ? /* cross-tenant: the service catalogue's pictures are global */";
  try {
    const r = await db.prepare(clientOnly ? client : admin).bind(id).first();
    return r ? { id: r.id, serviceKey: r.service_key, key: r.storage_key, format: r.format, size: r.size_bytes, alt: r.alt } : null;
  } catch (err) { if (missing(err)) return null; throw err; }
}

export async function addServiceMedia(db, serviceKey, file, meta, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof serviceKey !== "string" || !SERVICE_KEYS.includes(serviceKey)) return fail("invalid_service");
  const alt = validateText(meta && meta.alt, 160);
  if (!alt || /\n/.test(alt)) return fail("invalid_alt");
  const caption = meta && meta.caption ? validateText(meta.caption, 120) : null;
  if (caption === undefined || (caption && /\n/.test(caption))) return fail("invalid_caption");
  const id = newId(), at = isoTime(now);
  try {
    const n = await db.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(sort_order), 0) AS top FROM portal_service_media WHERE service_key = ? /* cross-tenant: the service catalogue's pictures are global */").bind(serviceKey).first();
    if (n.n >= MAX_MEDIA_PER_SERVICE) return fail("too_many");
    await db.batch([
      db.prepare("INSERT INTO portal_service_media (id, service_key, caption, alt, storage_key, format, content_type, size_bytes, sha256, sort_order, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, serviceKey, caption || null, alt, file.key, file.ext, file.contentType, file.size, file.sha256, Math.min(9999, n.top + 10), at, actor.trim()),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, NULL, 'admin', ?, 'portal_service.media.added', 'portal_service_media', ?, ?, 'internal', ?)").bind(newId(), actor.trim(), id, JSON.stringify({ service: serviceKey }), at),
    ]);
    return ok({ id });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

export async function updateServiceMedia(db, id, patch, actor, { now = new Date() } = {}) {
  requireId(id, "media_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!patch || typeof patch !== "object" || Array.isArray(patch) || Object.keys(patch).some((k) => !["alt", "caption"].includes(k))) return fail("invalid_input");
  if (!("alt" in patch) && !("caption" in patch)) return fail("invalid_input");
  const cur = await db.prepare("SELECT alt, caption FROM portal_service_media WHERE id = ? /* cross-tenant: the service catalogue's pictures are global */").bind(id).first();
  if (!cur) return fail("not_found");
  let alt = cur.alt, caption = cur.caption;
  if ("alt" in patch) { const a = validateText(patch.alt, 160); if (!a || /\n/.test(a)) return fail("invalid_alt"); alt = a; }
  if ("caption" in patch) { const c = patch.caption ? validateText(patch.caption, 120) : null; if (c === undefined || (c && /\n/.test(c))) return fail("invalid_caption"); caption = c || null; }
  const at = isoTime(now);
  await db.batch([
    db.prepare("UPDATE portal_service_media SET alt = ?, caption = ? WHERE id = ? /* cross-tenant: the service catalogue's pictures are global */").bind(alt, caption, id),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, NULL, 'admin', ?, 'portal_service.media.updated', 'portal_service_media', ?, ?, 'internal', ?)").bind(newId(), actor.trim(), id, JSON.stringify({ fields: Object.keys(patch) }), at),
  ]);
  return ok();
}

/** Remove the row; the caller deletes the stored object (it returns the key). */
export async function deleteServiceMedia(db, id, actor, { now = new Date() } = {}) {
  requireId(id, "media_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const rec = await getServiceMediaRecord(db, id);
  if (!rec) return fail("not_found");
  const at = isoTime(now);
  await db.batch([
    db.prepare("DELETE FROM portal_service_media WHERE id = ? /* cross-tenant: the service catalogue's pictures are global */").bind(id),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, NULL, 'admin', ?, 'portal_service.media.deleted', 'portal_service_media', ?, ?, 'internal', ?)").bind(newId(), actor.trim(), id, JSON.stringify({ service: rec.serviceKey }), at),
  ]);
  return ok({ key: rec.key });
}

/** Move one picture up or down one place within its service. */
export async function moveServiceMedia(db, id, direction, actor, { now = new Date() } = {}) {
  requireId(id, "media_id");
  if (direction !== "up" && direction !== "down") return fail("invalid_direction");
  if (!validActor(actor)) return fail("invalid_actor");
  const rec = await getServiceMediaRecord(db, id);
  if (!rec) return fail("not_found");
  const list = (await listServiceMedia(db)).get(rec.serviceKey) || [];
  const i = list.findIndex((m) => m.id === id), j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= list.length) return ok({ unchanged: true });
  const order = list.map((m) => m.id); [order[i], order[j]] = [order[j], order[i]];
  const at = isoTime(now);
  await db.batch([...order.map((mid, n) => db.prepare("UPDATE portal_service_media SET sort_order = ? WHERE id = ? AND sort_order <> ? /* cross-tenant: the service catalogue's pictures are global */").bind((n + 1) * 10, mid, (n + 1) * 10)),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, NULL, 'admin', ?, 'portal_service.media.moved', 'portal_service_media', ?, ?, 'internal', ?)").bind(newId(), actor.trim(), id, JSON.stringify({ direction }), at)]);
  return ok();
}
