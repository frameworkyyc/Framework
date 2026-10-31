/**
 * Framework Admin: the Additional Services catalogue (Admin -> Settings -> Additional Services), the optional services listed on every client's Website page. Behind Cloudflare Access and
 * ADMIN_EMAILS; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Prices are NOT here: they are set in Service Pricing.
 *
 *   GET  /additional-services   { available, services: [{key, name, description, enabled, sortOrder, updatedBy, updatedAt}], capabilities: {writes} }
 *   POST /additional-services   { key, name?, description?, enabled?, sort_order? }   change one service
 *   POST /additional-services   { key, move: "up" | "down" }                           move one service one place (everything is renumbered 10, 20, 30 ...)
 * Each service also carries `price` (read-only here: { label, type, priceCad } or null when no price is set) so the editor can show what clients see and link to Service Pricing.
 */
import { listServicesAdmin, updateService, moveService } from "./repo/portal-services.js";
import { listPrices } from "./repo/prices.js";
import { priceLabel } from "./branding-pricing.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { invalid_service: 422, invalid_name: 422, invalid_description: 422, invalid_enabled: 422, invalid_sort_order: 422, invalid_direction: 422, invalid_input: 422, unavailable: 409 };

export async function handleServicesApi(request, env, principal, path, deps = {}) {
  if (!/^\/additional-services$/.test(path)) return null;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: "GET, POST" });
  if (method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  try {
    if (method === "POST") {
      const read = await readJson(request, ["key", "name", "description", "enabled", "sort_order", "move"]);
      if (read.response) return read.response;
      const { key, move, ...patch } = read.body;
      const r = move !== undefined
        ? await moveService(env.PORTAL_DB, key, move, principal && principal.email, { now: deps.now || new Date() })
        : await updateService(env.PORTAL_DB, key, patch, principal && principal.email, { now: deps.now || new Date() });
      if (!r.ok) return STATUS[r.error] ? json({ error: r.error, message: "The change was not made." }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed.");
    }
    const list = await listServicesAdmin(env.PORTAL_DB);
    const stored = new Map((await listPrices(env.PORTAL_DB)).rows.map((r) => [r.service_key, r]));
    const priced = (key) => { const r = stored.get(key); if (!r || r.price_type === "included") return null; const label = priceLabel({ type: r.price_type, priceCad: r.price_cad }); return label ? { label, type: r.price_type, priceCad: r.price_cad } : null; };
    return json({ available: list.available, services: list.services.map((s) => ({ ...s, price: priced(s.key) })), capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" } });
  } catch (e) {
    console.error("admin additional services api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
