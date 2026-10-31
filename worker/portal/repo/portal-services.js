/**
 * The Additional Services catalogue (migration 0012, table portal_services): the optional services listed on the client's Website page. Global (it belongs to Framework, not to a client),
 * so these queries carry `cross-tenant:` comments. Admin edits the name, short description, whether it is shown, and the order; the four service KEYS are fixed (they are what a request and
 * a price are stored under). A database without the table shows the built-in defaults to clients (read-only for Admin), so the section works before the migration is applied.
 */
import { isoTime, ok, fail, validActor } from "./common.js";
import { validateName, validateText } from "./validate.js";

export const SERVICE_DEFAULTS = Object.freeze([
  { key: "client-admin-portal", name: "Client Admin Portal", description: "A secure, branded workspace where you manage your customers, projects and records in one place.", sortOrder: 10 },
  { key: "invoice-sender", name: "Invoice Sender", description: "Create and send professional invoices to your customers, and see which have been paid.", sortOrder: 20 },
  { key: "digital-business-cards", name: "Digital Business Cards", description: "A shareable digital card with your details and links, always up to date.", sortOrder: 30 },
  { key: "seo-visibility", name: "SEO & Visibility", description: "Help the right customers find your business in search, with a plan to improve how you show up online.", sortOrder: 40 },
].map(Object.freeze));
export const SERVICE_KEYS = Object.freeze(SERVICE_DEFAULTS.map((s) => s.key));
/** The service_requests key an Additional Service is requested under. */
export const requestKeyOfService = (key) => `svc-${key}`;
export const serviceKeyOfRequest = (requestKey) => (typeof requestKey === "string" && requestKey.startsWith("svc-") && SERVICE_KEYS.includes(requestKey.slice(4)) ? requestKey.slice(4) : null);

const row = (r) => ({ key: r.service_key, name: r.name, description: r.description, enabled: r.enabled === 1, sortOrder: r.sort_order, updatedBy: r.updated_by, updatedAt: r.updated_at, stored: true });
const defaults = () => SERVICE_DEFAULTS.map((d) => ({ ...d, enabled: true, updatedBy: null, updatedAt: null, stored: false }));

/** Every catalogue entry (hidden ones too) for Admin, in order. `available` is false (and the defaults are returned) without the migration. */
export async function listServicesAdmin(db) {
  try {
    const rows = (await db.prepare("SELECT service_key, name, description, enabled, sort_order, updated_by, updated_at FROM portal_services ORDER BY sort_order, service_key /* cross-tenant: the service catalogue is global */").all()).results;
    return { available: true, services: rows.filter((r) => SERVICE_KEYS.includes(r.service_key)).map(row) };
  } catch { return { available: false, services: defaults() }; }
}

/** What a client sees: only the shown services, in order. The built-in defaults when the table is missing; an empty list when Admin has hidden every service. */
export async function listClientServices(db) {
  const l = await listServicesAdmin(db);
  return l.services.filter((s) => s.enabled).map(({ key, name, description }) => ({ key, name, description }));
}

/**
 * Move one service up or down one place. Every service is renumbered 10, 20, 30... in its new order (so equal or gapped numbers never make a move do nothing), and only the rows whose
 * number actually changed are written, each with an audit entry. Moving the first service up or the last one down changes nothing.
 */
export async function moveService(db, key, direction, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof key !== "string" || !SERVICE_KEYS.includes(key)) return fail("invalid_service");
  if (direction !== "up" && direction !== "down") return fail("invalid_direction");
  const cur = await listServicesAdmin(db);
  if (!cur.available) return fail("unavailable");
  const order = cur.services.map((s) => s.key);
  const i = order.indexOf(key), j = direction === "up" ? i - 1 : i + 1;
  if (i < 0) return fail("invalid_service");
  if (j < 0 || j >= order.length) return ok({ unchanged: true });
  [order[i], order[j]] = [order[j], order[i]];
  const at = isoTime(now), by = actor.trim(), statements = [];
  order.forEach((k, idx) => {
    const old = cur.services.find((s) => s.key === k), next = (idx + 1) * 10;
    if (old.sortOrder === next) return;
    statements.push(
      db.prepare("UPDATE portal_services SET sort_order = ?, updated_by = ?, updated_at = ? WHERE service_key = ? /* cross-tenant: the service catalogue is global */").bind(next, by, at, k),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'portal_service.updated', 'portal_service', NULL, ?, 'internal', ? WHERE changes() > 0")
        .bind(crypto.randomUUID(), by, JSON.stringify({ service: k, moved: direction }), at),
    );
  });
  if (statements.length) await db.batch(statements);
  return ok();
}

/** Change one service's text, visibility or order. All fields are validated first; nothing is written when any is invalid or nothing changed. */
export async function updateService(db, key, patch, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof key !== "string" || !SERVICE_KEYS.includes(key)) return fail("invalid_service");
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return fail("invalid_input");
  const cur = (await listServicesAdmin(db));
  if (!cur.available) return fail("unavailable");
  const old = cur.services.find((s) => s.key === key);
  if (!old) return fail("invalid_service");
  const next = { name: old.name, description: old.description, enabled: old.enabled, sortOrder: old.sortOrder };
  if ("name" in patch) { const n = validateName(patch.name, 60); if (!n) return fail("invalid_name"); next.name = n; }
  if ("description" in patch) { const d = validateText(patch.description, 240); if (!d) return fail("invalid_description"); next.description = d; }
  if ("enabled" in patch) { if (typeof patch.enabled !== "boolean") return fail("invalid_enabled"); next.enabled = patch.enabled; }
  if ("sort_order" in patch) { const n = patch.sort_order; if (!Number.isInteger(n) || n < 0 || n > 9999) return fail("invalid_sort_order"); next.sortOrder = n; }
  if (next.name === old.name && next.description === old.description && next.enabled === old.enabled && next.sortOrder === old.sortOrder) return ok({ unchanged: true });
  const at = isoTime(now), by = actor.trim();
  await db.batch([
    db.prepare("UPDATE portal_services SET name = ?, description = ?, enabled = ?, sort_order = ?, updated_by = ?, updated_at = ? WHERE service_key = ? /* cross-tenant: the service catalogue is global */").bind(next.name, next.description, next.enabled ? 1 : 0, next.sortOrder, by, at, key),
    db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, NULL, 'admin', ?, 'portal_service.updated', 'portal_service', NULL, ?, 'internal', ? WHERE changes() > 0")
      .bind(crypto.randomUUID(), by, JSON.stringify({ service: key, enabled: next.enabled }), at),
  ]);
  return ok();
}
