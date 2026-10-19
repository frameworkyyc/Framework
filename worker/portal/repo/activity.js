/**
 * Activity log: append-only audit and client-visible feed. Never put secrets, tokens, codes, emails or request data in `detail`.
 * Events with no organization (for example a sign-in) pass organizationId: null explicitly and are always internal.
 */
import { newId, isoTime, requireOrgId, ok, fail, isConstraintViolation } from "./common.js";
import { validateAction, validateEnum, ACTOR_TYPES, VISIBILITIES } from "./validate.js";

const MAX_DETAIL = 2000;

export async function recordActivity(db, entry, { now = new Date() } = {}) {
  if (!entry || !("organizationId" in entry)) return fail("organization_required"); // pass null on purpose for user-level events
  if (entry.organizationId !== null) requireOrgId(entry.organizationId);
  if (!validateEnum(entry.actorType, ACTOR_TYPES)) return fail("invalid_actor_type");
  if (typeof entry.actorRef !== "string" || !entry.actorRef.trim() || entry.actorRef.length > 254) return fail("invalid_actor");
  if (!validateAction(entry.action)) return fail("invalid_action");
  const visibility = entry.organizationId === null ? "internal" : entry.visibility === undefined ? "internal" : validateEnum(entry.visibility, VISIBILITIES);
  if (!visibility) return fail("invalid_visibility");
  let detail = null;
  if (entry.detail !== undefined && entry.detail !== null) {
    try {
      detail = JSON.stringify(entry.detail);
    } catch {
      return fail("invalid_detail");
    }
    if (typeof detail !== "string" || detail.length > MAX_DETAIL) return fail("detail_too_large");
  }
  const id = newId();
  try {
    await db
      .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, entry.organizationId, entry.actorType, entry.actorRef.trim(), entry.action, entry.entityType ?? null, entry.entityId ?? null, detail, visibility, isoTime(now))
      .run();
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_entry");
    throw err;
  }
  return ok({ id });
}

/** Newest first. `clientVisibleOnly` is what a client sees; admins can read everything for their organization. */
export async function listActivity(db, organizationId, { limit = 20, clientVisibleOnly = true } = {}) {
  requireOrgId(organizationId);
  const n = Number.isInteger(limit) && limit >= 1 && limit <= 200 ? limit : 20;
  const sql = `SELECT id, organization_id, actor_type, action, entity_type, entity_id, detail, visibility, created_at FROM activity_log WHERE organization_id = ? ${clientVisibleOnly ? "AND visibility = 'client'" : ""} ORDER BY created_at DESC, id DESC LIMIT ?`;
  return (await db.prepare(sql).bind(organizationId, n).all()).results;
}
