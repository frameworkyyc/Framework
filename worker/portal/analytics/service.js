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
 */
import * as store from "../repo/website-analytics.js";
import * as cloudflare from "./cloudflare.js";
import * as searchConsole from "./search-console.js";
import { newestDay, periods } from "./ranges.js";

export const TTL_MS = Object.freeze({ cloudflare: 30 * 60000, search_console: 6 * 3600000 });
const PROVIDERS = {
  cloudflare: { creds: cloudflare.credentials, ref: (c) => c.cfSiteTag, run: (o) => cloudflare.fetchWebAnalytics({ creds: o.creds, siteTag: o.ref, period: o.period, fetch: o.fetch }) },
  search_console: { creds: searchConsole.credentials, ref: (c) => c.gscProperty, run: (o) => searchConsole.fetchSearchConsole({ creds: o.creds, property: o.ref, period: o.period, fetch: o.fetch, now: o.now }) },
};

/** Which sources the server can read at all (credentials present). Booleans only: never the values. */
export function platform(env) {
  return { cloudflare: !!cloudflare.credentials(env), search_console: !!searchConsole.credentials(env) };
}

async function one(source, { env, db, organizationId, websiteId, config, range, now, fetch }) {
  const p = PROVIDERS[source];
  const creds = p.creds(env);
  if (!creds) return { state: "not_enabled" };
  const ref = p.ref(config);
  if (!ref) return { state: "not_connected" };
  const period = periods(newestDay(source, now), range);
  const cached = await store.getCached(db, organizationId, websiteId, source, range, ref);
  const fresh = cached && now.getTime() - Date.parse(cached.fetchedAt) < TTL_MS[source] && cached.data && cached.data.period && cached.data.period.to === period.current.to;
  if (fresh) return { state: "ok", data: cached.data, fetchedAt: cached.fetchedAt };
  try {
    const data = await p.run({ creds, ref, period, fetch, now });
    await store.putCached(db, organizationId, websiteId, source, range, ref, data, { now });
    return { state: "ok", data, fetchedAt: now.toISOString() };
  } catch (err) {
    const code = err && typeof err.message === "string" && /^[a-z_]{4,30}$/.test(err.message) ? err.message : "query_failed";
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

/** Admin's "Test connection": one live read for a source, never cached, reduced to ok or a short code (and the newest day it could read). */
export async function testSource({ env, source, ref, fetch: doFetch, now = new Date() }) {
  const p = PROVIDERS[source];
  if (!p) return { ok: false, code: "invalid_source" };
  const creds = p.creds(env);
  if (!creds) return { ok: false, code: "not_enabled" };
  if (!ref) return { ok: false, code: "not_connected" };
  try {
    const data = await p.run({ creds, ref, period: periods(newestDay(source, now), 7), fetch: doFetch, now });
    return { ok: true, through: data.period.to };
  } catch (err) {
    return { ok: false, code: err && typeof err.message === "string" && /^[a-z_]{4,30}$/.test(err.message) ? err.message : "query_failed" };
  }
}
