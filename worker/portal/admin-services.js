/**
 * Framework Admin: the Additional Services catalogue (Admin -> Settings -> Additional Services), the optional services listed on every client's Website page. Behind Cloudflare Access and
 * ADMIN_EMAILS; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Prices are NOT here: they are set in Service Pricing.
 *
 *   GET  /additional-services   { available, services: [{key, name, description, enabled, sortOrder, updatedBy, updatedAt}], capabilities: {writes} }
 *   POST /additional-services   { key, name?, description?, enabled?, sort_order? }   change one service
 */
import { listServicesAdmin, updateService } from "./repo/portal-services.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { invalid_service: 422, invalid_name: 422, invalid_description: 422, invalid_enabled: 422, invalid_sort_order: 422, invalid_input: 422, unavailable: 409 };

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
      const read = await readJson(request, ["key", "name", "description", "enabled", "sort_order"]);
      if (read.response) return read.response;
      const { key, ...patch } = read.body;
      const r = await updateService(env.PORTAL_DB, key, patch, principal && principal.email, { now: deps.now || new Date() });
      if (!r.ok) return STATUS[r.error] ? json({ error: r.error, message: "The change was not made." }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed.");
    }
    const list = await listServicesAdmin(env.PORTAL_DB);
    return json({ available: list.available, services: list.services, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" } });
  } catch (e) {
    console.error("admin additional services api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
