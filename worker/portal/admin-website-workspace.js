/**
 * Framework Admin: the review workspace of a client's website (migration 0030, proposed): its Staging address, the updates published for the client to review, and the tasks the client has to do.
 * Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Clients never reach any of
 * this: they read only what is published (repo/website-workspace.js getWorkspaceForClient) and can only decide or answer through their own portal routes.
 *
 *   GET  /clients/:org/websites/:id/workspace                      everything, drafts included: { available, stagingUrl, updates, tasks }
 *   POST /clients/:org/websites/:id/workspace/staging              { staging_url }   (https; empty clears it)
 *   POST /clients/:org/websites/:id/workspace/updates              { title, detail?, environment?, kind?, published? }      (kind: approval | info)
 *   POST /clients/:org/websites/:id/workspace/updates/:u/update    { title?, detail?, environment?, kind?, published? }
 *   POST /clients/:org/websites/:id/workspace/updates/:u/review    ask the client to look again (after a rejection or an approval that needs another look)
 *   POST /clients/:org/websites/:id/workspace/updates/:u/archive
 *   POST /clients/:org/websites/:id/workspace/tasks                { title, detail?, cta?, due_date?, published? }            (cta: upload | respond | review | none)
 *   POST /clients/:org/websites/:id/workspace/tasks/:t/update      { title?, detail?, cta?, due_date?, status?, published? }  (status: open | done | cancelled)
 *   POST /clients/:org/websites/:id/workspace/tasks/:t/archive
 * A database without migration 0030 answers { available: false } (reads) or "unavailable" (writes).
 */
import { UUID } from "./repo/common.js";
import { getOrganizationById } from "./repo/orgs.js";
import * as ws from "./repo/website-workspace.js";
import { getWebsiteAdmin } from "./repo/websites.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = {
  not_found: 404, too_many: 409, unavailable: 409,
  invalid_input: 422, invalid_title: 422, invalid_detail: 422, invalid_environment: 422, invalid_kind: 422, invalid_published: 422, invalid_cta: 422, invalid_date: 422, invalid_status: 422, invalid_url: 422, invalid_actor: 422,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

const UPDATE_FIELDS = ["title", "detail", "environment", "kind", "published"];
const TASK_FIELDS = ["title", "detail", "cta", "due_date", "status", "published"];

export async function handleWebsiteWorkspaceApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "websites" && seg[4] === "workspace")) return null;
  const orgId = seg[1], websiteId = seg[3], rest = seg.slice(5);
  let route = null;
  if (rest.length === 0) route = { kind: "view", method: "GET" };
  else if (rest.length === 1 && rest[0] === "staging") route = { kind: "staging", method: "POST" };
  else if (rest.length === 1 && (rest[0] === "updates" || rest[0] === "tasks")) route = { kind: rest[0] === "updates" ? "update-create" : "task-create", method: "POST" };
  else if (rest.length === 3 && rest[0] === "updates" && ["update", "review", "archive"].includes(rest[2])) route = { kind: `update-${rest[2]}`, method: "POST", item: rest[1] };
  else if (rest.length === 3 && rest[0] === "tasks" && ["update", "archive"].includes(rest[2])) route = { kind: `task-${rest[2]}`, method: "POST", item: rest[1] };
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
    if (route.kind === "view") {
      const d = await ws.getWorkspaceAdmin(db, org.id, websiteId);
      return json({ ...d, website: { id: site.id, name: site.name, url: site.url, status: site.status, published: Boolean(site.published) }, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" }, labels: { update: ws.UPDATE_STATUS_LABEL, task: ws.TASK_STATUS_LABEL } });
    }
    if (route.kind === "staging") {
      const read = await readJson(request, ["staging_url"]);
      if (read.response) return read.response;
      const r = await ws.setStagingUrl(db, org.id, websiteId, read.body.staging_url, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "update-create" || route.kind === "task-create") {
      const read = await readJson(request, route.kind === "update-create" ? UPDATE_FIELDS.filter((f) => f !== "status") : TASK_FIELDS.filter((f) => f !== "status"));
      if (read.response) return read.response;
      const r = route.kind === "update-create" ? await ws.createUpdate(db, org.id, websiteId, read.body, actor, { now }) : await ws.createTask(db, org.id, websiteId, read.body, actor, { now });
      return r.ok ? json({ ok: true, id: r.id }, 201) : fromFailure(r);
    }
    if (route.kind === "update-update" || route.kind === "task-update") {
      const read = await readJson(request, route.kind === "update-update" ? UPDATE_FIELDS : TASK_FIELDS);
      if (read.response) return read.response;
      const r = route.kind === "update-update" ? await ws.updateUpdate(db, org.id, websiteId, route.item, read.body, actor, { now }) : await ws.updateTask(db, org.id, websiteId, route.item, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    const run = { "update-review": ws.requestReview, "update-archive": ws.archiveUpdate, "task-archive": ws.archiveTask }[route.kind];
    const r = await run(db, org.id, websiteId, route.item, actor, { now });
    return r.ok ? json({ ok: true }) : fromFailure(r);
  } catch (e) {
    console.error("admin website workspace api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
