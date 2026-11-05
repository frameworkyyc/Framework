/**
 * Per-client Branding requirement overrides (migration 0014, table brand_requirements). "Automatic" is no row. Admin writes (one item at a time, audited internally); the Client Portal
 * only reads, scoped to the member's own organization. A database without the table answers "not available" and the Branding page keeps its automatic behaviour.
 */
import { newId, isoTime, requireOrgId, ok, fail, validActor } from "./common.js";
import { REQUIREMENT_LEVELS, ITEM_KEYS, MAX_NOTE } from "../../../admin/assets/brand-requirement-items.js";

const missingTable = (err) => /no such table/i.test(String(err && err.message));

/** @returns {Promise<{available: boolean, items: {[key: string]: {level: string, note: string|null, updatedBy: string, updatedAt: string}}}>} */
export async function listRequirementSettings(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const { results } = await db.prepare("SELECT item_key, level, note, updated_by, updated_at FROM brand_requirements WHERE organization_id = ? ORDER BY item_key").bind(organizationId).all();
    return { available: true, items: Object.fromEntries(results.map((r) => [r.item_key, { level: r.level, note: r.note, updatedBy: r.updated_by, updatedAt: r.updated_at }])) };
  } catch (err) {
    if (missingTable(err)) return { available: false, items: {} };
    throw err;
  }
}

/** A plain-text note: trimmed, no control characters, at most MAX_NOTE characters; empty means none. null = invalid. */
export function cleanNote(raw) {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") return null;
  const t = raw.replace(/\r\n?/g, "\n").trim();
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(t) || [...t].length > MAX_NOTE) return null;
  return t;
}

/**
 * Set one item's requirement, or return it to Automatic (level null: the row is removed; any note goes with it). One batch: the change and its internal audit entry succeed or fail together.
 * @returns {Promise<{ok: true, changed: boolean}|{ok: false, error: string}>}
 */
export async function setRequirementSetting(db, organizationId, itemKey, level, noteRaw, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof itemKey !== "string" || !ITEM_KEYS.includes(itemKey)) return fail("invalid_item");
  if (level !== null && !REQUIREMENT_LEVELS.includes(level)) return fail("invalid_level");
  const note = cleanNote(noteRaw);
  if (note === null) return fail("invalid_note");
  const at = isoTime(now), by = actor.trim();
  try {
    const before = await db.prepare("SELECT level, note FROM brand_requirements WHERE organization_id = ? AND item_key = ?").bind(organizationId, itemKey).first();
    if (level === null ? !before : before && before.level === level && (before.note || "") === note) return ok({ changed: false });
    const audit = (action) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, 'brand_requirement', ?, 'internal', ?)")
      .bind(newId(), organizationId, by, action, JSON.stringify({ item: itemKey, level: level || "automatic", note: Boolean(note) }), at);
    await db.batch([
      level === null
        ? db.prepare("DELETE FROM brand_requirements WHERE organization_id = ? AND item_key = ?").bind(organizationId, itemKey)
        : db.prepare("INSERT INTO brand_requirements (organization_id, item_key, level, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (organization_id, item_key) DO UPDATE SET level = excluded.level, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
          .bind(organizationId, itemKey, level, note || null, by, at),
      audit(level === null ? "brand.requirement.cleared" : "brand.requirement.set"),
    ]);
    return ok({ changed: true });
  } catch (err) {
    if (missingTable(err)) return fail("requirements_unavailable");
    throw err;
  }
}
