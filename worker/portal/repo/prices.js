/**
 * Service prices: one global, Admin-managed price per Branding service (migration 0010), in Canadian dollars. The table is GLOBAL (it belongs to Framework, not to one
 * client), so these queries carry `cross-tenant:` comments. A change is written together with an internal activity_log entry naming the admin, and only for services whose
 * price really changed. A database without migration 0010 reads as "not available" with no rows, so the client page shows no prices and nothing else is affected.
 */
import { newId, isoTime, ok, fail, validActor } from "./common.js";
import { PRICING_TYPES, PRICING_KEYS, MAX_PRICE_CAD, pricingService, pricingFrom, typesFor } from "../branding-pricing.js";

/** @returns {Promise<{available: boolean, rows: {service_key: string, price_type: string, price_cad: number|null, updated_by: string, updated_at: string}[]}>} */
export async function listPrices(db) {
  try {
    const { results } = await db.prepare("SELECT service_key, price_type, price_cad, updated_by, updated_at FROM service_prices ORDER BY service_key /* cross-tenant: service prices are global */").all();
    return { available: true, rows: results };
  } catch {
    return { available: false, rows: [] };
  }
}

/** The entries the client page may show (see branding-pricing.js pricingFrom): {} when the table is missing, empty or unreadable. */
export async function loadPricing(db) {
  return pricingFrom((await listPrices(db)).rows);
}

/** Validate one submitted entry. Returns the clean entry or an error code. */
function clean(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "invalid_service" };
  if (typeof raw.key !== "string" || !PRICING_KEYS.includes(raw.key)) return { error: "invalid_service" };
  if (!PRICING_TYPES.includes(raw.type) || !typesFor(pricingService(raw.key)).includes(raw.type)) return { error: "invalid_type" };
  if (raw.type !== "starting_at") return { key: raw.key, type: raw.type, priceCad: null };
  const n = raw.priceCad;
  if (!Number.isInteger(n) || n < 1 || n > MAX_PRICE_CAD) return { error: "invalid_price" };
  return { key: raw.key, type: raw.type, priceCad: n };
}

/**
 * Save the submitted entries (any subset of the 13 services). All are validated first; nothing is written if any is invalid. Only entries that differ from what is stored
 * are written (and audited), so saving an unchanged form changes nothing.
 * @returns {Promise<{ok: true, changed: number} | {ok: false, error: string}>}
 */
export async function savePrices(db, entries, actor, { now = new Date() } = {}) {
  if (!validActor(actor)) return fail("invalid_actor");
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > PRICING_KEYS.length) return fail("invalid_service");
  const wanted = new Map();
  for (const raw of entries) {
    const c = clean(raw);
    if (c.error) return fail(c.error, { key: raw && typeof raw.key === "string" ? raw.key : null });
    if (wanted.has(c.key)) return fail("invalid_service");
    wanted.set(c.key, c);
  }
  const current = await listPrices(db);
  if (!current.available) return fail("unavailable");
  const stored = new Map(current.rows.map((r) => [r.service_key, r]));
  const t = isoTime(now), by = actor.trim();
  const statements = [];
  for (const c of wanted.values()) {
    const old = stored.get(c.key);
    if (old && old.price_type === c.type && (old.price_cad ?? null) === c.priceCad) continue;
    statements.push(
      db.prepare("INSERT INTO service_prices (service_key, price_type, price_cad, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (service_key) DO UPDATE SET price_type = excluded.price_type, price_cad = excluded.price_cad, updated_by = excluded.updated_by, updated_at = excluded.updated_at /* cross-tenant: service prices are global */").bind(c.key, c.type, c.priceCad, by, t),
      db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, NULL, 'admin', ?, 'service_price.updated', 'service_price', NULL, ?, 'internal', ?)").bind(
        newId(), by, JSON.stringify({ service: c.key, name: pricingService(c.key).name, from: old ? { type: old.price_type, priceCad: old.price_cad } : null, to: { type: c.type, priceCad: c.priceCad } }), t),
    );
  }
  if (statements.length) await db.batch(statements);
  return ok({ changed: statements.length / 2 });
}
