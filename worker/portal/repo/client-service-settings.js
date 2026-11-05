/**
 * What Admin chose for ONE client and ONE Additional Service, besides Show/Hide and "already has it" (those live in client_service_state, repo/service-catalogue-state.js): whether the service
 * carries a Recommended label for this client, and this client's own position in the list (migration 0017, table client_service_settings). A client with no rows sees the global order and
 * no Recommended labels. Every statement names organization_id. Only Framework Admin writes; the portal only reads its own organization's rows. A database without the table reads as
 * "no settings" and writes answer "unavailable".
 */
import { newId, isoTime, requireOrgId, ok, fail, validActor } from "./common.js";
import { SERVICE_KEYS } from "./portal-services.js";

const missing = (err) => /no such table|no such column/i.test(String(err && err.message));
const audit = (db, org, actor, action, key, at, detail) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, 'client_service_settings', ?, ?, 'internal', ?)").bind(newId(), org, actor.trim(), action, key, JSON.stringify(detail), at);

/** { available, items: { serviceKey -> { recommended, sortOrder } } } for one organization. */
export async function listClientServiceSettings(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const { results } = await db.prepare("SELECT service_key, recommended, sort_order FROM client_service_settings WHERE organization_id = ? ORDER BY service_key").bind(organizationId).all();
    return { available: true, items: Object.fromEntries(results.map((r) => [r.service_key, { recommended: r.recommended === 1, sortOrder: r.sort_order }])) };
  } catch (err) { if (missing(err)) return { available: false, items: {} }; throw err; }
}

/** Turn the Recommended label on or off for one client and service. The row is removed when it no longer carries anything. */
export async function setRecommended(db, organizationId, serviceKey, recommended, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof serviceKey !== "string" || !SERVICE_KEYS.includes(serviceKey)) return fail("invalid_service");
  if (typeof recommended !== "boolean") return fail("invalid_recommended");
  const at = isoTime(now), by = actor.trim();
  try {
    const cur = await db.prepare("SELECT recommended, sort_order FROM client_service_settings WHERE organization_id = ? AND service_key = ?").bind(organizationId, serviceKey).first();
    if ((cur ? cur.recommended === 1 : false) === recommended) return ok({ changed: false });
    const keep = recommended || (cur && cur.sort_order !== null);
    await db.batch([
      keep
        ? db.prepare("INSERT INTO client_service_settings (organization_id, service_key, recommended, sort_order, updated_by, updated_at) VALUES (?, ?, ?, NULL, ?, ?) ON CONFLICT (organization_id, service_key) DO UPDATE SET recommended = excluded.recommended, updated_by = excluded.updated_by, updated_at = excluded.updated_at")
          .bind(organizationId, serviceKey, recommended ? 1 : 0, by, at)
        : db.prepare("DELETE FROM client_service_settings WHERE organization_id = ? AND service_key = ?").bind(organizationId, serviceKey),
      audit(db, organizationId, actor, "service.recommended", serviceKey, at, { service: serviceKey, recommended }),
    ]);
    return ok({ changed: true });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/**
 * Give this client their own order: `order` is every service key in the order they should appear. Positions are written as 10, 20, 30... for all of them, so the order is explicit and
 * complete. Rows that carry nothing else are created; Recommended flags are kept.
 */
export async function setClientOrder(db, organizationId, order, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (!Array.isArray(order) || !order.length || new Set(order).size !== order.length || order.some((k) => !SERVICE_KEYS.includes(k))) return fail("invalid_order");
  const at = isoTime(now), by = actor.trim();
  try {
    await db.batch([
      ...order.map((k, i) => db.prepare("INSERT INTO client_service_settings (organization_id, service_key, recommended, sort_order, updated_by, updated_at) VALUES (?, ?, 0, ?, ?, ?) ON CONFLICT (organization_id, service_key) DO UPDATE SET sort_order = excluded.sort_order, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(organizationId, k, (i + 1) * 10, by, at)),
      audit(db, organizationId, actor, "service.order", "order", at, { order }),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}

/** Return this client to the global order: positions are cleared (a row that was only an order is removed; Recommended flags stay). */
export async function resetClientOrder(db, organizationId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  try {
    await db.batch([
      db.prepare("UPDATE client_service_settings SET sort_order = NULL, updated_by = ?, updated_at = ? WHERE organization_id = ? AND recommended = 1 AND sort_order IS NOT NULL").bind(actor.trim(), at, organizationId),
      db.prepare("DELETE FROM client_service_settings WHERE organization_id = ? AND recommended = 0").bind(organizationId),
      audit(db, organizationId, actor, "service.order.reset", "order", at, {}),
    ]);
    return ok();
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}
