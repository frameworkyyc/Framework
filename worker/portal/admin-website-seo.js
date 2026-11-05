/**
 * Framework Admin: SEO & Search Visibility of a client's website. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin
 * request with the X-Framework-Admin header. Clients never reach any of this; they read only what is published (repo/website-seo.js getSeoForClient).
 *
 *   GET  /clients/:org/websites/:id/seo                          everything, drafts included: { status, summary, published, checklist, recommendations, reports, metrics }
 *   POST /clients/:org/websites/:id/seo                          { status?, summary?, published? }
 *   POST /clients/:org/websites/:id/seo/items                    { kind: "checklist"|"recommendation", title, detail?, status?, priority? }
 *   POST /clients/:org/websites/:id/seo/items/:item/update | delete
 *   POST /clients/:org/websites/:id/seo/reports                  { title, period?, summary?, link? (https), published? }       (+ /:report/update | delete)
 *   POST /clients/:org/websites/:id/seo/metrics                  { period_start, period_end, impressions?, clicks?, position?, indexed_pages?, note?, published? }   (+ /:metric/update | delete)
 * Figures are typed here. A future Google Search Console import is NOT part of this: the table has a `source` column so one can be added without a schema change.
 * A database without migration 0015 answers { available: false }.
 */
import { UUID } from "./repo/common.js";
import { getOrganizationById } from "./repo/orgs.js";
import * as seo from "./repo/website-seo.js";
import { getWebsiteAdmin } from "./repo/websites.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = {
  not_found: 404, too_many: 409, duplicate_period: 409, unavailable: 409,
  invalid_input: 422, invalid_status: 422, invalid_summary: 422, invalid_published: 422, invalid_kind: 422, invalid_title: 422, invalid_detail: 422, invalid_priority: 422,
  invalid_period: 422, invalid_link: 422, invalid_date: 422, invalid_number: 422, invalid_note: 422, invalid_actor: 422,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

const COLLECTIONS = {
  items: { create: seo.createItem, update: seo.updateItem, remove: seo.deleteItem, fields: ["kind", "title", "detail", "status", "priority"] },
  reports: { create: seo.createReport, update: seo.updateReport, remove: seo.deleteReport, fields: ["title", "period", "summary", "link", "published"] },
  metrics: { create: seo.createMetric, update: seo.updateMetric, remove: seo.deleteMetric, fields: ["period_start", "period_end", "impressions", "clicks", "position", "indexed_pages", "note", "published"] },
};

export async function handleWebsiteSeoApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "websites" && seg[4] === "seo")) return null;
  const orgId = seg[1], websiteId = seg[3], rest = seg.slice(5);
  let route = null;
  if (rest.length === 0) route = request.method === "GET" ? { kind: "view", method: "GET" } : { kind: "head", method: "POST" };
  else if (rest.length === 1 && Object.hasOwn(COLLECTIONS, rest[0])) route = { kind: "create", method: "POST", col: rest[0] };
  else if (rest.length === 3 && Object.hasOwn(COLLECTIONS, rest[0]) && (rest[2] === "update" || rest[2] === "delete")) route = { kind: rest[2] === "delete" ? "remove" : "update", method: "POST", col: rest[0], item: rest[1] };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(orgId) || !UUID.test(websiteId) || (route.item !== undefined && !UUID.test(route.item))) return err(404, "not_found", "Not found.");
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
    if (route.kind === "view") { const d = await seo.getSeoAdmin(db, org.id, websiteId); return json({ ...d, website: { id: site.id, name: site.name }, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" }, statuses: seo.SEO_STATUSES }); }
    if (route.kind === "head") {
      const read = await readJson(request, ["status", "summary", "published"]);
      if (read.response) return read.response;
      const r = await seo.saveSeoHead(db, org.id, websiteId, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    const col = COLLECTIONS[route.col];
    if (route.kind === "create") {
      const read = await readJson(request, col.fields);
      if (read.response) return read.response;
      const r = await col.create(db, org.id, websiteId, read.body, actor, { now });
      return r.ok ? json({ ok: true, id: r.id }, 201) : fromFailure(r);
    }
    if (route.kind === "update") {
      const read = await readJson(request, col.fields.filter((f) => f !== "kind"));
      if (read.response) return read.response;
      const r = await col.update(db, org.id, websiteId, route.item, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    const r = await col.remove(db, org.id, websiteId, route.item, actor, { now });
    return r.ok ? json({ ok: true }) : fromFailure(r);
  } catch (e) {
    console.error("admin website seo api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
