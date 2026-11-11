/**
 * Framework Admin: Analytics settings of a client's website. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin
 * request with the X-Framework-Admin header. Clients never reach any of this.
 *
 *   GET  /clients/:org/websites/:id/analytics        { available, config: { cf_site_tag, gsc_property }, platform: { cloudflare, search_console }, service_account_email, website }
 *   POST /clients/:org/websites/:id/analytics        { cf_site_tag?, gsc_property? }   (empty or null disconnects that source)
 *   POST /clients/:org/websites/:id/analytics/test   { source: "cloudflare" | "search_console" }   one live read with the saved setting; answers ok or a short code, never data or secrets
 * `platform` says only whether the server has each source's credentials (booleans); the values are never returned. The service account's email is shown because Admin has to add it as a
 * user in the client's Search Console; it is not a secret. A database without migration 0028 answers { available: false }.
 */
import { UUID } from "./repo/common.js";
import { getOrganizationById } from "./repo/orgs.js";
import { getWebsiteAdmin } from "./repo/websites.js";
import * as store from "./repo/website-analytics.js";
import { platform, testSource } from "./analytics/service.js";
import { credentials as gscCredentials } from "./analytics/search-console.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { not_found: 404, unavailable: 409, invalid_site_tag: 422, invalid_property: 422, invalid_actor: 422, invalid_source: 422 };
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

export async function handleWebsiteAnalyticsApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "websites" && seg[4] === "analytics" && seg.length <= 6)) return null;
  const orgId = seg[1], websiteId = seg[3], rest = seg.slice(5);
  let route = null;
  if (rest.length === 0) route = request.method === "GET" ? { kind: "view", method: "GET" } : { kind: "save", method: "POST" };
  else if (rest.length === 1 && rest[0] === "test") route = { kind: "test", method: "POST" };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(orgId) || !UUID.test(websiteId)) return err(404, "not_found", "Not found.");
  if (route.method !== "GET") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const now = deps.now || new Date(), actor = principal && principal.email, db = env.PORTAL_DB;
  try {
    const org = await getOrganizationById(db, orgId);
    if (!org) return err(404, "not_found", "No such organization.");
    let site = null;
    try { site = await getWebsiteAdmin(db, org.id, websiteId); } catch { return json({ available: false }); }
    if (!site) return err(404, "not_found", "No such website.");
    const ready = await store.analyticsReady(db, now.getTime());
    if (route.kind === "view") {
      if (!ready) return json({ available: false, website: { id: site.id, name: site.name } });
      const cfg = await store.getConfig(db, org.id, websiteId);
      const creds = gscCredentials(env);
      return json({ available: true, website: { id: site.id, name: site.name }, config: { cf_site_tag: cfg.cfSiteTag, gsc_property: cfg.gscProperty }, platform: platform(env), service_account_email: creds ? creds.email : null, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" } });
    }
    if (!ready) return err(409, "unavailable", "Analytics isn’t available on this site yet (a database change is waiting), so nothing was changed.");
    if (route.kind === "save") {
      const read = await readJson(request, ["cf_site_tag", "gsc_property"]);
      if (read.response) return read.response;
      const r = await store.saveConfig(db, org.id, websiteId, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    const read = await readJson(request, ["source"]);
    if (read.response) return read.response;
    if (!store.SOURCES.includes(read.body.source)) return err(422, "invalid_source", "Choose a source to test.");
    const cfg = await store.getConfig(db, org.id, websiteId);
    const ref = read.body.source === "cloudflare" ? cfg.cfSiteTag : cfg.gscProperty;
    return json(await testSource({ env, source: read.body.source, ref, fetch: deps.fetch || fetch, now }));
  } catch (e) {
    console.error("admin website analytics api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
