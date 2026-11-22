/**
 * Website analytics: what each source says for one website and period, with the setup state when it cannot say anything. Two independent sources, never mixed:
 *   cloudflare       Cloudflare Web Analytics (traffic)             cache 30 minutes
 *   search_console   Google Search Console (search performance)     cache 6 hours (its figures change once a day)
 * For each source the answer is one of
 *   ok            fresh figures (from the cache when still within its time, else just fetched)
 *   stale         the provider could not be reached just now; the last good figures, with the time they were read
 *   not_enabled   Framework has not set up the server credentials for this source yet (nothing can be read for anyone)
 *   not_connected the credentials exist but this website has no site tag / property recorded
 *   error         nothing could be read and there is nothing earlier to show (with a short code)
 * Nothing is ever made up: a source without figures shows a message, not numbers. Every database statement names the organization.
 *
 * Cloudflare account per website: a website with its own account (cf_account_id, migration 0029) is read with that account's own read-only token, decrypted here only when
 * the provider is actually called (never for a cache hit) and never returned, cached, logged or put in an error. A website without one is read from Framework's account
 * (its account id and token, the Worker settings in cloudflare.credentials), exactly as before. A website with its own account does not need Framework's credentials at all.
 */
import * as store from "../repo/website-analytics.js";
import * as cloudflare from "./cloudflare.js";
import * as searchConsole from "./search-console.js";
import { newestDay, periods, addDays } from "./ranges.js";
import { openToken } from "./secret-box.js";

export const TTL_MS = Object.freeze({ cloudflare: 30 * 60000, search_console: 6 * 3600000 });
/** Cloudflare credentials for one website: its own account's (decrypted now) or Framework's. Throws credentials_key_missing or credentials_unreadable. */
async function cloudflareCreds(env, config, ids) {
  if (!config.cfAccountId) return cloudflare.credentials(env);
  const token = await openToken(env, { organizationId: ids.organizationId, websiteId: ids.websiteId, value: config.cfTokenEnc });
  return { token, account: config.cfAccountId };
}
const PROVIDERS = {
  cloudflare: {
    // set up at all for this website: its own account, or Framework's credentials
    available: (env, c) => !!c.cfAccountId || !!cloudflare.credentials(env),
    // the cache is keyed by what is read: an own account's answers never serve Framework's account for the same tag, and the reverse
    ref: (c) => (c.cfSiteTag ? (c.cfAccountId ? `${c.cfAccountId}:${c.cfSiteTag}` : c.cfSiteTag) : null),
    tag: (c) => c.cfSiteTag,
    creds: cloudflareCreds,
    run: (o) => cloudflare.fetchWebAnalytics({ creds: o.creds, siteTag: o.config.cfSiteTag, period: o.period, fetch: o.fetch }),
  },
  search_console: {
    available: (env) => !!searchConsole.credentials(env),
    ref: (c) => c.gscProperty,
    tag: (c) => c.gscProperty,
    creds: async (env) => searchConsole.credentials(env),
    run: (o) => searchConsole.fetchSearchConsole({ creds: o.creds, property: o.config.gscProperty, period: o.period, fetch: o.fetch, now: o.now }),
  },
};
const shortCode = (err) => (err && typeof err.message === "string" && /^[a-z_]{4,30}$/.test(err.message) ? err.message : "query_failed");

/** Which sources the server can read at all (credentials present). Booleans only: never the values. */
export function platform(env) {
  return { cloudflare: !!cloudflare.credentials(env), search_console: !!searchConsole.credentials(env) };
}

async function one(source, { env, db, organizationId, websiteId, config, range, now, fetch }) {
  const p = PROVIDERS[source];
  if (!p.available(env, config)) return { state: "not_enabled" };
  const ref = p.ref(config);
  if (!ref) return { state: "not_connected" };
  const period = periods(newestDay(source, now), range);
  const cached = await store.getCached(db, organizationId, websiteId, source, range, ref);
  const fresh = cached && now.getTime() - Date.parse(cached.fetchedAt) < TTL_MS[source] && cached.data && cached.data.period && cached.data.period.to === period.current.to;
  if (fresh) return { state: "ok", data: cached.data, fetchedAt: cached.fetchedAt };
  try {
    const creds = await p.creds(env, config, { organizationId, websiteId });
    const data = await p.run({ creds, config, period, fetch, now });
    await store.putCached(db, organizationId, websiteId, source, range, ref, data, { now });
    return { state: "ok", data, fetchedAt: now.toISOString() };
  } catch (err) {
    const code = shortCode(err);
    return cached && cached.data ? { state: "stale", data: cached.data, fetchedAt: cached.fetchedAt, code } : { state: "error", code };
  }
}

/** Everything the client Analytics page needs for one website, or null when analytics is not available on this database (migration 0028 not applied). */
export async function loadAnalytics({ env, db, organizationId, websiteId, range, now = new Date(), fetch: doFetch }) {
  if (!(await store.analyticsReady(db, now.getTime()))) return null;
  const config = await store.getConfig(db, organizationId, websiteId);
  if (!config) return null;
  const args = { env, db, organizationId, websiteId, config, range, now, fetch: doFetch };
  const [cf, gsc] = await Promise.all([one("cloudflare", args), one("search_console", args)]);
  return { range, sources: { cloudflare: cf, search_console: gsc } };
}

/**
 * Admin's "Test connection": one live read for a source, never cached, reduced to ok or a short code. Never data or secrets.
 * Search Console answers { ok: true, through } or { ok: false, code }. Cloudflare answers what cloudflare.diagnose() found (receiving, no recent traffic, a tag with no data, an
 * account with no data, a refused token, an unreadable account) plus `account`: "own" or "framework", so Admin knows which credentials were tested.
 * `config` is the website's saved settings; a bare `ref` (a site tag or property) is accepted for Framework's own account.
 */
export async function testSource({ env, source, config, ref, organizationId, websiteId, fetch: doFetch = fetch, now = new Date() }) {
  const p = PROVIDERS[source];
  if (!p) return { ok: false, code: "invalid_source" };
  const cfg = config || (source === "cloudflare" ? { cfSiteTag: ref || null } : { gscProperty: ref || null });
  if (!p.available(env, cfg)) return { ok: false, code: "not_enabled" };
  if (!p.tag(cfg)) return { ok: false, code: "not_connected" };
  let creds;
  try { creds = await p.creds(env, cfg, { organizationId, websiteId }); } catch (err) { return { ok: false, code: shortCode(err) }; }
  if (source === "cloudflare") {
    const today = now.toISOString().slice(0, 10);
    const r = await cloudflare.diagnose({ creds, siteTag: cfg.cfSiteTag, period: periods(newestDay(source, now), 7), today, historyFrom: addDays(today, -89), fetch: doFetch });
    return { ...r, account: cfg.cfAccountId ? "own" : "framework" };
  }
  try {
    const data = await p.run({ creds, config: cfg, period: periods(newestDay(source, now), 7), fetch: doFetch, now });
    return { ok: true, through: data.period.to };
  } catch (err) {
    return { ok: false, code: shortCode(err) };
  }
}
