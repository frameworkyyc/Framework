/**
 * Framework Admin: every website of every client, in one read-only answer (the Websites section). Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; every query goes through
 * readOnlyDb (one SELECT, nothing else). It joins what already exists, with no migration: the website's two addresses (Production is `websites.url`, Staging is `websites.staging_url`), its status,
 * domain and hosting renewals, SEO status, whether Web Analytics and Search Console are connected (booleans only, never a token), and how much is waiting for the client. Each part is read on its
 * own: a database without that migration gives `null` or zero for that part and never fails the answer. Deleted clients and archived websites are left out (`?archived=1` includes archived ones).
 * It never returns storage keys, notes or credentials.
 *
 *   GET /websites        { available, generatedAt, websites: [...] }
 *   GET /websites/:id    { available, website }      404 when there is no such website
 */
import { readOnlyDb } from "./admin-clients.js";
import { UUID } from "./repo/common.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const part = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

async function counts(rdb, sql) {
  const rows = (await rdb.prepare(sql).all()).results || [];
  return new Map(rows.map((r) => [r.website_id, r.n]));
}

const shape = (r, x) => ({
  id: r.id, organizationId: r.organization_id, organizationName: r.org_name, organizationSlug: r.org_slug,
  name: r.name, productionUrl: r.url || null, stagingUrl: r.staging_url || null,
  status: r.status, origin: r.origin, managedByFramework: r.managed_by_framework === 1, launchDate: r.launch_date || null,
  domain: { registrar: r.domain_registrar || null, owner: r.domain_owner, renewal: r.domain_renewal || null },
  hosting: { provider: r.hosting_provider || null, owner: r.hosting_owner, renewal: r.hosting_renewal || null },
  published: r.published === 1, archived: Boolean(r.archived_at), hasScreenshot: Boolean(r.screenshot_key), updatedAt: r.updated_at,
  seoStatus: x.seo.get(r.id) || null,
  analytics: { cloudflare: x.cf.has(r.id), searchConsole: x.gsc.has(r.id) },
  awaitingReview: x.awaiting.get(r.id) || 0, openTasks: x.tasks.get(r.id) || 0,
});

async function extras(rdb) {
  const [seo, cf, gsc, awaiting, tasks] = await Promise.all([
    part(async () => new Map(((await rdb.prepare("SELECT website_id, status FROM website_seo").all()).results || []).map((r) => [r.website_id, r.status])), new Map()),
    part(async () => new Set(((await rdb.prepare("SELECT website_id FROM website_analytics WHERE cf_site_tag IS NOT NULL").all()).results || []).map((r) => r.website_id)), new Set()),
    part(async () => new Set(((await rdb.prepare("SELECT website_id FROM website_analytics WHERE gsc_property IS NOT NULL").all()).results || []).map((r) => r.website_id)), new Set()),
    part(() => counts(rdb, "SELECT website_id, COUNT(*) AS n FROM website_updates WHERE published = 1 AND archived_at IS NULL AND kind = 'approval' AND status = 'awaiting_review' GROUP BY website_id"), new Map()),
    part(() => counts(rdb, "SELECT website_id, COUNT(*) AS n FROM website_tasks WHERE published = 1 AND archived_at IS NULL AND status = 'open' GROUP BY website_id"), new Map()),
  ]);
  return { seo, cf, gsc, awaiting, tasks };
}

/** @param path pathname with "/api/admin" removed. @returns Response or null when the path is not a websites route. */
export async function handleWebsitesIndexApi(request, env, principal, path) {
  const m = path.match(/^\/websites(?:\/([^/]+))?$/);
  if (!m) return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.PORTAL_DB) return json({ available: false });
  const id = m[1];
  if (id !== undefined && !UUID.test(id)) return json({ error: "not_found" }, 404);
  const rdb = readOnlyDb(env.PORTAL_DB);
  const withArchived = new URL(request.url).searchParams.get("archived") === "1";
  let rows;
  try {
    rows = (await rdb.prepare("SELECT w.*, o.name AS org_name, o.slug AS org_slug FROM websites w JOIN organizations o ON o.id = w.organization_id WHERE o.status <> 'archived' ORDER BY o.name COLLATE NOCASE, w.sort_order, w.created_at LIMIT 500").all()).results || [];
  } catch { return json({ available: false }); }
  const x = await extras(rdb);
  if (id !== undefined) {
    const r = rows.find((row) => row.id === id);
    return r ? json({ available: true, website: shape(r, x) }) : json({ error: "not_found" }, 404);
  }
  return json({ available: true, generatedAt: new Date().toISOString(), websites: rows.filter((r) => withArchived || !r.archived_at).map((r) => shape(r, x)) });
}
