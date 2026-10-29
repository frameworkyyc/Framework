/**
 * Framework Admin: Service Pricing API (Admin -> Settings -> Service Pricing). One global, editable price per Branding service, in Canadian dollars, applied to every
 * client. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin
 * header. Every change is audited (activity_log, internal, naming the admin). There is no checkout, payment or invoicing: a price is a starting estimate shown to clients
 * beside the request button, and recorded with the request for Framework's review.
 *
 *   GET  /service-pricing   { available, services: [{key, section, name, description, defaultCad, type, priceCad, updatedBy, updatedAt}], types, capabilities: {writes} }
 *   POST /service-pricing   { prices: [{key, type, priceCad}] }   any subset of the 13 services; all-or-nothing; unchanged entries write nothing
 */
import { listPrices, savePrices } from "./repo/prices.js";
import { PRICING_SERVICES, PRICING_TYPES, PRICING_TYPE_LABEL, MAX_PRICE_CAD } from "./branding-pricing.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { invalid_service: 422, invalid_type: 422, invalid_price: 422, unavailable: 409 };
const MESSAGE = {
  invalid_service: "That service isn’t one Framework prices.",
  invalid_type: "Choose Starting at, Custom Quote or Included.",
  invalid_price: `Enter a whole number of Canadian dollars from 1 to ${MAX_PRICE_CAD.toLocaleString("en-CA")}.`,
  unavailable: "Service pricing storage isn’t available on this deployment yet. Nothing was changed.",
};

export async function handleServicePricingApi(request, env, principal, path, deps = {}) {
  if (!/^\/service-pricing$/.test(path)) return null;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: "GET, POST" });
  if (method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const db = env.PORTAL_DB;
  try {
    if (method === "POST") {
      const read = await readJson(request, ["prices"]);
      if (read.response) return read.response;
      const r = await savePrices(db, read.body.prices, principal && principal.email, { now: deps.now || new Date() });
      if (!r.ok) return STATUS[r.error] ? json({ error: r.error, key: r.key || null, message: MESSAGE[r.error] }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed.");
    }
    const list = await listPrices(db);
    const stored = new Map(list.rows.map((r) => [r.service_key, r]));
    return json({
      available: list.available,
      services: PRICING_SERVICES.map((s) => {
        const row = stored.get(s.key);
        return { key: s.key, section: s.section, name: s.name, description: s.description, defaultCad: s.defaultCad, type: row ? row.price_type : "starting_at", priceCad: row ? row.price_cad : s.defaultCad, stored: Boolean(row), updatedBy: row ? row.updated_by : null, updatedAt: row ? row.updated_at : null };
      }),
      types: PRICING_TYPES.map((t) => ({ key: t, label: PRICING_TYPE_LABEL[t] })),
      capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" },
    });
  } catch (e) {
    console.error("admin service pricing api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
