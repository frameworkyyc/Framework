/**
 * Framework Admin: the Analytics portfolio, in one read-only answer. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; every query goes through readOnlyDb (one SELECT).
 * It never calls Cloudflare or Google: it reports what is already saved. Per website: whether Web Analytics (Cloudflare) and Search Console are connected, whether the Cloudflare site
 * reads Framework's account or the client's own account (and whether the client's token is saved: a boolean, never the token or its encrypted form), and the last cached 30-day figures
 * with the time they were fetched. A website that has never been read has `null` figures; nothing is estimated. Each part is read on its own, so a database without migrations 0028/0029
 * answers what it can and never fails. Deleted clients and archived websites are left out. No migration.
 *
 *   GET /analytics/summary   { available, generatedAt, platform: { cloudflare, search_console }, ownAccounts: { available, key }, websites: [...] }
 */
import { readOnlyDb } from "./admin-clients.js";
import { platform } from "./analytics/service.js";
import { keyReady } from "./analytics/secret-box.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });
const part = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);

function figures(source, payload) {
  const t = payload && payload.totals;
  if (!t) return null;
  return source === "cloudflare" ? { pageViews: num(t.pageViews), visits: num(t.visits) } : { clicks: num(t.clicks), impressions: num(t.impressions) };
}

export async function handleAnalyticsSummaryApi(request, env, principal, path) {
  if (path !== "/analytics/summary") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.PORTAL_DB) return json({ available: false });
  const rdb = readOnlyDb(env.PORTAL_DB);
  let sites;
  try {
    sites = (await rdb.prepare("SELECT w.id, w.organization_id, w.name, w.url, w.status, o.name AS org_name FROM websites w JOIN organizations o ON o.id = w.organization_id WHERE o.status <> 'archived' AND w.archived_at IS NULL ORDER BY o.name COLLATE NOCASE, w.sort_order, w.created_at").all()).results || [];
  } catch { return json({ available: false }); }
  const cfgRows = await part(async () => (await rdb.prepare("SELECT website_id, cf_site_tag, gsc_property, updated_at FROM website_analytics").all()).results || [], null);
  const ready = cfgRows !== null;
  const cfg = new Map((cfgRows || []).map((r) => [r.website_id, r]));
  const own = await part(async () => new Map(((await rdb.prepare("SELECT website_id, cf_account_id, cf_token_enc IS NOT NULL AS token_set FROM website_analytics").all()).results || []).map((r) => [r.website_id, r])), null);
  const cache = await part(async () => (await rdb.prepare("SELECT website_id, source, payload, fetched_at FROM website_analytics_cache WHERE range_days = 30").all()).results || [], []);
  const cached = new Map();
  for (const r of cache) {
    let payload = null; try { payload = JSON.parse(r.payload); } catch { /* unreadable cache: no figures */ }
    cached.set(r.website_id + "|" + r.source, { figures: figures(r.source, payload), fetchedAt: r.fetched_at });
  }
  const websites = sites.map((s) => {
    const c = cfg.get(s.id) || {}, o = own && own.get(s.id);
    const cf = cached.get(s.id + "|cloudflare") || null, gsc = cached.get(s.id + "|search_console") || null;
    return {
      id: s.id, organizationId: s.organization_id, organizationName: s.org_name, name: s.name, url: s.url || null, status: s.status,
      cloudflare: { connected: Boolean(c.cf_site_tag), account: o && o.cf_account_id ? "own" : "framework", tokenSaved: Boolean(o && o.token_set), figures: cf && cf.figures, fetchedAt: cf ? cf.fetchedAt : null },
      searchConsole: { connected: Boolean(c.gsc_property), figures: gsc && gsc.figures, fetchedAt: gsc ? gsc.fetchedAt : null },
    };
  });
  return json({ available: ready, generatedAt: new Date().toISOString(), platform: platform(env), ownAccounts: { available: own !== null, key: keyReady(env) }, websites });
}
