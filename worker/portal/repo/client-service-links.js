/**
 * A link Admin sets for one client and one Additional Service (migration 0023): today the address of a client's own digital business card. Only services that take a link are accepted
 * (LINKABLE), only https addresses to a real host name pass, and every statement names organization_id, so a client is only ever shown their OWN link and another organization's is never
 * readable through these functions. Removing a link deletes the row; the change is kept in the activity log. A database without 0023 answers { available: false } and nothing breaks.
 */
import { newId, isoTime, requireOrgId, ok, fail, validActor } from "./common.js";

/** The services that take a link, and what the link is. */
export const LINKABLE = Object.freeze({ "digital-business-cards": "Digital business card address" });
const missing = (err) => /no such table/i.test(String(err && err.message));

/**
 * An https address for a client's own page: https only, a real host name (letters, digits and hyphens, a dot and an alphabetic ending, so no IP address, no "localhost" and no
 * internal name), no credentials, no explicit port, no spaces or markup. null for none; undefined when invalid. Returns the normalised address.
 */
export function validateServiceLink(raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "string") return undefined;
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > 300 || /[\s<>"'\\\u0000-\u001F\u007F]/.test(t)) return undefined;
  let u;
  try { u = new URL(t); } catch { return undefined; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return undefined;
  const host = u.hostname.toLowerCase();
  if (!/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*\.[a-z]{2,24}$/.test(host)) return undefined;
  const out = u.toString();
  return out.length >= 12 && out.length <= 300 ? out : undefined;
}

/** { available, links: { [serviceKey]: { url, updatedAt } } } for ONE organization. */
export async function listClientServiceLinks(db, organizationId) {
  requireOrgId(organizationId);
  try {
    const rows = (await db.prepare("SELECT service_key, url, updated_at FROM client_service_links WHERE organization_id = ?").bind(organizationId).all()).results;
    return { available: true, links: Object.fromEntries(rows.map((r) => [r.service_key, { url: r.url, updatedAt: r.updated_at }])) };
  } catch (err) { if (missing(err)) return { available: false, links: {} }; throw err; }
}

/** Set (a string), change or remove (null or empty) the link for one client and one service. */
export async function setClientServiceLink(db, organizationId, serviceKey, rawUrl, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  if (typeof serviceKey !== "string" || !Object.hasOwn(LINKABLE, serviceKey)) return fail("invalid_service");
  const url = validateServiceLink(rawUrl);
  if (url === undefined) return fail("invalid_link");
  const at = isoTime(now), who = actor.trim();
  const audit = (action) => db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) VALUES (?, ?, 'admin', ?, ?, 'service_link', ?, ?, 'internal', ?)").bind(newId(), organizationId, who, action, serviceKey, JSON.stringify({ service: serviceKey }), at);
  try {
    if (!(await db.prepare("SELECT 1 AS x FROM portal_services WHERE service_key = ?").bind(serviceKey).first())) return fail("invalid_service");
    if (url === null) {
      const res = await db.batch([db.prepare("DELETE FROM client_service_links WHERE organization_id = ? AND service_key = ?").bind(organizationId, serviceKey), db.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, created_at) SELECT ?, ?, 'admin', ?, 'service.link.removed', 'service_link', ?, ?, 'internal', ? WHERE changes() > 0").bind(newId(), organizationId, who, serviceKey, JSON.stringify({ service: serviceKey }), at)]);
      return ok({ removed: res[0].meta.changes > 0 });
    }
    await db.batch([
      db.prepare("INSERT INTO client_service_links (organization_id, service_key, url, updated_by, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (organization_id, service_key) DO UPDATE SET url = excluded.url, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(organizationId, serviceKey, url, who, at),
      audit("service.link.set"),
    ]);
    return ok({ url });
  } catch (err) { if (missing(err)) return fail("unavailable"); throw err; }
}
