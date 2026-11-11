// Website analytics in the client portal: Cloudflare Web Analytics (traffic) and Google Search Console (search performance), per website, read through their APIs, cached,
// private to the client's own organization, never invented. Migration 0028 is applied to Staging only: everything is dormant until it is.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import * as store from "../portal/repo/website-analytics.js";
import * as cf from "../portal/analytics/cloudflare.js";
import * as gsc from "../portal/analytics/search-console.js";
import { periods, newestDay, parseRange, addDays, eachDay } from "../portal/analytics/ranges.js";
import { loadAnalytics, testSource, platform, TTL_MS } from "../portal/analytics/service.js";
import { analyticsPage, analyticsTeaser, trendChart } from "../portal/analytics/view.js";
import { handleWebsiteAnalyticsApi } from "../portal/admin-website-analytics.js";

const MIG = "0028_website_analytics.sql";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_A = "a1111111-1111-4111-8111-111111111111", SITE_B = "b2222222-2222-4222-8222-222222222222";
const TAG = "0123456789abcdef0123456789abcdef", PROP = "sc-domain:example.com";
const NOW = new Date("2026-11-11T18:00:00.000Z");
const ACCOUNT = "fedcba9876543210fedcba9876543210";
const UUID0 = "00000000-0000-4000-8000-000000000000";

function world({ migrated = true } = {}) {
  const db = openPortalDb({ skip: migrated ? [] : [MIG] });
  const run = (sql, ...p) => db.raw.prepare(sql).run(...p);
  for (const [org, slug] of [[ORG_A, "alpha"], [ORG_B, "bravo"]]) run("INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)", org, slug, slug.toUpperCase(), NOW.toISOString(), NOW.toISOString());
  for (const [id, org, name] of [[SITE_A, ORG_A, "Alpha Fencing"], [SITE_B, ORG_B, "Bravo Decks"]]) run("INSERT INTO websites (id, organization_id, name, url, origin, status, managed_by_framework, published, sort_order, created_at, updated_at, updated_by) VALUES (?, ?, ?, 'https://example.com', 'framework', 'live', 1, 1, 0, ?, ?, 'test')", id, org, name, NOW.toISOString(), NOW.toISOString());
  return { db, raw: db.raw };
}
const ENV = { CF_ANALYTICS_API_TOKEN: "cf-token-SECRET", CF_ANALYTICS_ACCOUNT_ID: ACCOUNT };

/* ---------- fixtures shaped like the providers' real answers (test-only; the app never ships sample data) ---------- */
const CF_ANSWER = (over = {}) => ({ data: { viewer: { accounts: [{
  totals: [{ count: 300, sum: { visits: 120 } }], previous: [{ count: 200, sum: { visits: 100 } }],
  series: [{ count: 10, sum: { visits: 4 }, dimensions: { date: "2026-11-05" } }, { count: 20, sum: { visits: 8 }, dimensions: { date: "2026-11-07" } }],
  sources: [{ count: 50, sum: { visits: 40 }, dimensions: { refererHost: "www.google.com" } }, { count: 30, sum: { visits: 30 }, dimensions: { refererHost: "" } }],
  pages: [{ count: 90, sum: { visits: 60 }, dimensions: { requestPath: "/services?utm=1" } }, { count: 40, sum: { visits: 30 }, dimensions: { requestPath: "/" } }],
  devices: [{ count: 180, sum: { visits: 70 }, dimensions: { deviceType: "mobile" } }, { count: 110, sum: { visits: 45 }, dimensions: { deviceType: "desktop" } }, { count: 10, sum: { visits: 5 }, dimensions: { deviceType: "tablet" } }],
  ...over }] } }, errors: null });
const respond = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

const GSC_ENV = { GSC_OAUTH_CLIENT_ID: "1234567890-abc.apps.googleusercontent.com", GSC_OAUTH_CLIENT_SECRET: "GOCSPX-test-client-secret", GSC_OAUTH_REFRESH_TOKEN: "1//0gTestRefreshTokenValue-1234567890" };
async function gscEnv() { return { env: { ...GSC_ENV } }; }
function gscFetch(calls, { status = 200, rows, tokenStatus = 200 } = {}) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).startsWith("https://oauth2.googleapis.com/token")) return tokenStatus === 200 ? respond({ access_token: "ya29.token", expires_in: 3600 }) : respond({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, tokenStatus);
    const body = JSON.parse(init.body);
    if (status !== 200) return respond({}, status);
    if (body.dimensions) return respond({ rows: rows || [{ keys: ["2026-11-08"], clicks: 3, impressions: 90, ctr: 0.0333, position: 12.4 }, { keys: ["2026-11-09"], clicks: 5, impressions: 110, ctr: 0.0454, position: 10.2 }] });
    return respond({ rows: [body.endDate < "2026-11-09" ? { clicks: 40, impressions: 1000, ctr: 0.04, position: 14.2 } : { clicks: 60, impressions: 1200, ctr: 0.05, position: 11.3 }] });
  };
}

/* ---------- migration ---------- */
test("migration 0028 is applied to Staging (not Production), additive, stores no credentials, and ties every row to a website of its organization", () => {
  assert.ok(existsSync(new URL("../../migrations/portal/" + MIG, import.meta.url)));
  assert.ok(!existsSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url)));
  const sql = readFileSync(new URL("../../migrations/portal/" + MIG, import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.equal([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).join(), "website_analytics,website_analytics_cache");
  assert.ok(!/\b(DROP|DELETE FROM|UPDATE|ALTER)\b/i.test(sql.replace(/ON DELETE RESTRICT/g, "")), "additive only");
  assert.ok(!/token|secret|password|private_key|api_key/i.test(sql), "no credential column");
  assert.equal([...sql.matchAll(/FOREIGN KEY \(website_id, organization_id\) REFERENCES websites \(id, organization_id\)/g)].length, 2);
  const w = world();
  assert.throws(() => w.raw.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, updated_at, updated_by) VALUES (?, ?, 'not-hex', 'x', 'y')").run(SITE_A, ORG_A), /constraint/i);
  assert.throws(() => w.raw.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, updated_at, updated_by) VALUES (?, ?, ?, 'x', 'y')").run(SITE_A, ORG_B, TAG), /FOREIGN KEY/i, "a website cannot be given to another organization");
});

/* ---------- dates ---------- */
test("ranges: 7, 30 and 90 days, the previous period of the same length, and each source's newest complete day", () => {
  assert.equal(parseRange("7"), 7); assert.equal(parseRange("90"), 90); assert.equal(parseRange("45"), 30); assert.equal(parseRange(undefined), 30);
  const p = periods("2026-11-10", 7);
  assert.deepEqual(p, { current: { from: "2026-11-04", to: "2026-11-10" }, previous: { from: "2026-10-28", to: "2026-11-03" } });
  assert.equal(eachDay(p.current.from, p.current.to).length, 7);
  assert.equal(newestDay("cloudflare", NOW), "2026-11-10", "yesterday: today is still being counted");
  assert.equal(newestDay("search_console", NOW), "2026-11-09", "Search Console arrives about two days late");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});

/* ---------- Cloudflare Web Analytics ---------- */
test("Cloudflare: one GraphQL request with the bearer token, the site tag and both periods; parsed, zero-filled, cleaned; never says 'visitors'", async () => {
  const calls = [];
  const period = periods("2026-11-10", 7);
  const out = await cf.fetchWebAnalytics({ creds: cf.credentials(ENV), siteTag: TAG, period, fetch: async (url, init) => { calls.push({ url, init }); return respond(CF_ANSWER()); } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.cloudflare.com/client/v4/graphql");
  assert.equal(calls[0].init.headers.Authorization, "Bearer cf-token-SECRET");
  const body = JSON.parse(calls[0].init.body);
  assert.deepEqual(body.variables, { account: ACCOUNT, tag: TAG, from: "2026-11-04", to: "2026-11-10", prevFrom: "2026-10-28", prevTo: "2026-11-03" });
  assert.match(body.query, /rumPageloadEventsAdaptiveGroups/); assert.match(body.query, /siteTag: \$tag, bot: 0/); assert.match(body.query, /sum \{ visits \}/);
  assert.deepEqual(out.totals, { visits: 120, pageViews: 300 }); assert.deepEqual(out.previous, { visits: 100, pageViews: 200 });
  assert.equal(out.series.length, 7); assert.deepEqual(out.series.find((d) => d.date === "2026-11-06"), { date: "2026-11-06", visits: 0, pageViews: 0 }, "a day with no recorded loads is a real zero");
  assert.deepEqual(out.series.find((d) => d.date === "2026-11-07"), { date: "2026-11-07", visits: 8, pageViews: 20 });
  assert.equal(out.pages[0].path, "/services", "query strings are dropped from page paths");
  assert.deepEqual(out.devices.map((d) => d.device), ["Mobile", "Desktop", "Tablet"]);
  assert.equal(out.sources[1].host, "", "no referrer is kept as empty and shown as direct");
  assert.ok(!JSON.stringify(out).includes("cf-token"));
});

test("Cloudflare: errors become short codes and never carry the token, site tag or response text", async () => {
  const creds = cf.credentials(ENV), period = periods("2026-11-10", 7);
  const code = async (fetch) => { try { await cf.fetchWebAnalytics({ creds, siteTag: TAG, period, fetch }); return "ok"; } catch (e) { assert.ok(!/cf-token|0123456789abcdef/.test(e.message)); return e.message; } };
  assert.equal(await code(async () => respond({}, 403)), "unauthorized");
  assert.equal(await code(async () => respond({}, 500)), "query_failed");
  assert.equal(await code(async () => { throw new Error("boom cf-token-SECRET"); }), "unreachable");
  assert.equal(await code(async () => respond({ data: null, errors: [{ message: "something odd", extensions: { code: "internal" } }] })), "query_failed");
  assert.equal(await code(async () => respond({ data: null, errors: [{ message: "not authorized to access this account", extensions: { code: "authz" } }] })), "unauthorized");
  assert.equal(await code(async () => respond({ data: { viewer: { accounts: [] } } })), "unauthorized");
  assert.equal(cf.credentials({ CF_ANALYTICS_API_TOKEN: "t" }), null); assert.equal(cf.credentials({ CF_ANALYTICS_ACCOUNT_ID: ACCOUNT }), null); assert.equal(cf.credentials({ CF_ANALYTICS_API_TOKEN: "t", CF_ANALYTICS_ACCOUNT_ID: "short" }), null);
});

/* ---------- Google Search Console ---------- */
test("Search Console: the refresh token is exchanged for a read-only access token, then Google's own totals for both periods and the daily series", async () => {
  gsc.forgetTokens();
  const { env } = await gscEnv(), calls = [];
  const creds = gsc.credentials(env);
  const period = periods("2026-11-09", 30);
  const out = await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch(calls), now: NOW });
  const tokenCalls = calls.filter((x) => x.url.startsWith("https://oauth2"));
  assert.equal(tokenCalls.length, 1);
  const form = new URLSearchParams(tokenCalls[0].init.body);
  assert.deepEqual([...form.keys()].sort(), ["client_id", "client_secret", "grant_type", "refresh_token"]);
  assert.equal(form.get("grant_type"), "refresh_token"); assert.equal(form.get("client_id"), GSC_ENV.GSC_OAUTH_CLIENT_ID); assert.equal(form.get("refresh_token"), GSC_ENV.GSC_OAUTH_REFRESH_TOKEN);
  assert.equal(tokenCalls[0].init.method, "POST"); assert.equal(tokenCalls[0].url, "https://oauth2.googleapis.com/token", "no secret in the address");
  const q = calls.filter((x) => x.url.includes("searchAnalytics"));
  assert.equal(q.length, 3);
  assert.ok(q.every((x) => x.url.startsWith(`https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(PROP)}/searchAnalytics/query`) && x.init.headers.Authorization === "Bearer ya29.token"));
  assert.deepEqual(out.totals, { clicks: 60, impressions: 1200, ctr: 0.05, position: 11.3 }); assert.deepEqual(out.previous, { clicks: 40, impressions: 1000, ctr: 0.04, position: 14.2 });
  assert.equal(out.series.length, 30); assert.deepEqual(out.series.find((d) => d.date === "2026-11-09"), { date: "2026-11-09", clicks: 5, impressions: 110, ctr: 0.0455, position: 10.2 });
  assert.deepEqual(out.series.find((d) => d.date === "2026-11-01"), { date: "2026-11-01", clicks: 0, impressions: 0, ctr: null, position: null }, "no impressions: no position is invented");
  await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch(calls), now: NOW });
  assert.equal(calls.filter((x) => x.url.startsWith("https://oauth2")).length, 1, "the access token is reused");
  await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch(calls), now: new Date(NOW.getTime() + 51 * 60000) });
  assert.equal(calls.filter((x) => x.url.startsWith("https://oauth2")).length, 2, "after 50 minutes the refresh token is exchanged again");
});

test("Search Console: credentials need all three settings; a service account key file is no longer read", () => {
  assert.deepEqual(gsc.credentials(GSC_ENV), { clientId: GSC_ENV.GSC_OAUTH_CLIENT_ID, clientSecret: GSC_ENV.GSC_OAUTH_CLIENT_SECRET, refreshToken: GSC_ENV.GSC_OAUTH_REFRESH_TOKEN });
  for (const k of Object.keys(GSC_ENV)) assert.equal(gsc.credentials({ ...GSC_ENV, [k]: "" }), null, k + " missing means not set up");
  assert.equal(gsc.credentials({ ...GSC_ENV, GSC_OAUTH_REFRESH_TOKEN: "has a space in it 12345678901" }), null);
  assert.equal(gsc.credentials({}), null); assert.equal(gsc.credentials(undefined), null);
  assert.equal(gsc.credentials({ GSC_SERVICE_ACCOUNT_JSON: JSON.stringify({ type: "service_account", client_email: "a@b.iam.gserviceaccount.com" }) }), null, "the old key-file setting does nothing");
});

test("Search Console: expiry and revocation become reconnect_needed (and are not cached); other errors become short codes without secrets; no data is zeros, not a made-up average", async () => {
  gsc.forgetTokens();
  const creds = gsc.credentials(GSC_ENV), period = periods("2026-11-09", 7);
  const code = async (opts) => { gsc.forgetTokens(); try { await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch([], opts), now: NOW }); return "ok"; } catch (e) { assert.ok(!/GOCSPX|ya29|1\/\/0g|refresh|invalid_grant|expired/i.test(e.message), "no secret or Google text in an error"); return e.message; } };
  assert.equal(await code({ tokenStatus: 400 }), "reconnect_needed", "invalid_grant: the refresh token was revoked or has expired");
  assert.equal(await code({ tokenStatus: 401 }), "reconnect_needed", "invalid_client: wrong client settings");
  assert.equal(await code({ tokenStatus: 503 }), "unreachable");
  assert.equal(await code({ status: 403 }), "no_access", "the Google account is not a user on this property");
  assert.equal(await code({ status: 404 }), "property_not_found"); assert.equal(await code({ status: 429 }), "rate_limited"); assert.equal(await code({ status: 500 }), "query_failed");
  assert.equal(await code({ status: 401 }), "reconnect_needed", "an access token Google refuses");
  assert.equal(await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: async () => { throw new Error("offline GOCSPX-test-client-secret"); }, now: NOW }).catch((e) => e.message), "unreachable");
  // a refused token is dropped, so the next read exchanges the refresh token again (and works once the secret has been replaced)
  gsc.forgetTokens();
  const calls = [];
  await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch(calls, { status: 401 }), now: NOW }).catch(() => {});
  await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: gscFetch(calls), now: NOW });
  assert.equal(calls.filter((x) => x.url.startsWith("https://oauth2")).length, 2, "a 401 clears the cached access token");
  gsc.forgetTokens();
  const none = await gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: async (u) => (String(u).startsWith("https://oauth2") ? respond({ access_token: "t" }) : respond({})), now: NOW });
  assert.deepEqual(none.totals, { clicks: 0, impressions: 0, ctr: null, position: null });
  gsc.forgetTokens();
  await assert.rejects(gsc.fetchSearchConsole({ creds, property: PROP, period, fetch: async () => respond({}), now: NOW }), /reconnect_needed/, "an answer without an access token");
});

test("service: a revoked Google sign-in shows reconnect_needed (or the last good figures, marked stale) and Admin's test says so; Cloudflare is unaffected", async () => {
  gsc.forgetTokens();
  const w = world();
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG, gsc_property: PROP }, "o", { now: NOW });
  const env = { ...ENV, ...GSC_ENV };
  const call = (fetch, now = NOW) => loadAnalytics({ env, db: w.db, organizationId: ORG_A, websiteId: SITE_A, range: 7, now, fetch });
  const both = (opts) => async (url, init) => (String(url).includes("cloudflare.com") ? respond(CF_ANSWER()) : gscFetch([], opts)(url, init));
  let m = await call(both({ tokenStatus: 400 }));
  assert.equal(m.sources.search_console.state, "error"); assert.equal(m.sources.search_console.code, "reconnect_needed"); assert.equal(m.sources.cloudflare.state, "ok", "Cloudflare keeps working");
  gsc.forgetTokens();
  m = await call(both({}));
  assert.equal(m.sources.search_console.state, "ok");
  gsc.forgetTokens();
  m = await call(both({ tokenStatus: 400 }), new Date(NOW.getTime() + TTL_MS.search_console + 60000));
  assert.equal(m.sources.search_console.state, "stale"); assert.equal(m.sources.search_console.code, "reconnect_needed"); assert.equal(m.sources.search_console.data.totals.clicks, 60, "the last good figures, with their time");
  gsc.forgetTokens();
  assert.deepEqual(await testSource({ env, source: "search_console", ref: PROP, fetch: gscFetch([], { tokenStatus: 400 }), now: NOW }), { ok: false, code: "reconnect_needed" });
  gsc.forgetTokens();
  assert.deepEqual(await testSource({ env, source: "search_console", ref: PROP, fetch: gscFetch([], { status: 403 }), now: NOW }), { ok: false, code: "no_access" });
  gsc.forgetTokens();
  assert.deepEqual(await testSource({ env, source: "search_console", ref: PROP, fetch: gscFetch([]), now: NOW }), { ok: true, through: "2026-11-09" });
});

/* ---------- settings and cache (data layer) ---------- */
test("settings: validated, per website, scoped to the organization; disconnecting and changing clear the cache", async () => {
  const w = world();
  assert.equal(store.validSiteTag(TAG.toUpperCase()), TAG); assert.equal(store.validSiteTag("xyz"), null);
  assert.equal(store.validProperty("sc-domain:Example.com"), "sc-domain:example.com"); assert.equal(store.validProperty("https://example.com/"), "https://example.com/"); assert.equal(store.validProperty("https://example.com"), null); assert.equal(store.validProperty("http://example.com/"), null); assert.equal(store.validProperty("example.com"), null);
  assert.deepEqual(await store.getConfig(w.db, ORG_A, SITE_A), { cfSiteTag: null, gscProperty: null, updatedAt: null });
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG, gsc_property: PROP }, "owner@frameworkco.ca", { now: NOW })).ok, true);
  assert.equal((await store.getConfig(w.db, ORG_A, SITE_A)).cfSiteTag, TAG);
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: "nope" }, "o", { now: NOW })).error, "invalid_site_tag");
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { gsc_property: "nope" }, "o", { now: NOW })).error, "invalid_property");
  assert.equal((await store.saveConfig(w.db, ORG_B, SITE_A, { cf_site_tag: TAG }, "o", { now: NOW })).error, "not_found", "another organization cannot configure this website");
  assert.equal(await store.getConfig(w.db, ORG_B, SITE_A).then((c) => c.cfSiteTag), null, "and cannot read its settings");
  await store.putCached(w.db, ORG_A, SITE_A, "cloudflare", 7, TAG, { x: 1 }, { now: NOW });
  await store.putCached(w.db, ORG_A, SITE_A, "search_console", 7, PROP, { y: 2 }, { now: NOW });
  assert.deepEqual((await store.getCached(w.db, ORG_A, SITE_A, "cloudflare", 7, TAG)).data, { x: 1 });
  assert.equal(await store.getCached(w.db, ORG_B, SITE_A, "cloudflare", 7, TAG), null, "the cache is private to the organization");
  assert.equal(await store.getCached(w.db, ORG_A, SITE_A, "cloudflare", 7, "ffffffffffffffffffffffffffffffff"), null, "an answer read for another site tag is never used");
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: "" }, "o", { now: NOW });
  assert.equal(await store.getCached(w.db, ORG_A, SITE_A, "cloudflare", 7, TAG), null, "disconnecting drops its cache");
  assert.ok(await store.getCached(w.db, ORG_A, SITE_A, "search_console", 7, PROP), "the other source's cache stays");
  assert.equal(await store.getConfig(openPortalDb().db || world({ migrated: false }).db, ORG_A, SITE_A), null, "no migration: reads as not available");
});

/* ---------- the service: states, caching, independence ---------- */
test("service: not enabled, not connected, ok, cached within its time, refreshed after it, stale on failure, error without a cache", async () => {
  gsc.forgetTokens();
  const w = world(), { env: gEnv } = await gscEnv();
  const call = (env, fetch, now = NOW, range = 7) => loadAnalytics({ env, db: w.db, organizationId: ORG_A, websiteId: SITE_A, range, now, fetch });
  assert.equal(await loadAnalytics({ env: ENV, db: world({ migrated: false }).db, organizationId: ORG_A, websiteId: SITE_A, range: 7, now: NOW }), null, "dormant without the migration");
  let m = await call({}, async () => assert.fail("nothing is fetched without credentials"));
  assert.deepEqual([m.sources.cloudflare.state, m.sources.search_console.state], ["not_enabled", "not_enabled"]);
  m = await call({ ...ENV, ...gEnv }, async () => assert.fail("nothing is fetched without a site tag or property"));
  assert.deepEqual([m.sources.cloudflare.state, m.sources.search_console.state], ["not_connected", "not_connected"]);
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG, gsc_property: PROP }, "o", { now: NOW });
  let n = 0;
  const cfFetch = async () => { n++; return respond(CF_ANSWER()); };
  m = await call(ENV, cfFetch);
  assert.equal(m.sources.cloudflare.state, "ok"); assert.equal(m.sources.cloudflare.data.totals.visits, 120); assert.equal(m.sources.search_console.state, "not_enabled", "sources are independent");
  assert.equal(n, 1);
  await call(ENV, cfFetch, new Date(NOW.getTime() + 10 * 60000));
  assert.equal(n, 1, "within 30 minutes the cache answers: no provider request");
  await call(ENV, cfFetch, new Date(NOW.getTime() + TTL_MS.cloudflare + 60000));
  assert.equal(n, 2, "after its time it is read again");
  m = await call(ENV, async () => respond({}, 500), new Date(NOW.getTime() + TTL_MS.cloudflare * 3));
  assert.equal(m.sources.cloudflare.state, "stale"); assert.equal(m.sources.cloudflare.code, "query_failed"); assert.equal(m.sources.cloudflare.data.totals.visits, 120, "the last good figures, with their time");
  m = await call(ENV, async () => respond({}, 500), NOW, 30);
  assert.equal(m.sources.cloudflare.state, "error", "no earlier figures for this period: a message, not numbers"); assert.equal(m.sources.cloudflare.data, undefined);
  const g = await call({ ...ENV, ...gEnv }, gscFetch([]));
  assert.equal(g.sources.search_console.state, "ok"); assert.equal(g.sources.search_console.data.totals.clicks, 60);
  assert.deepEqual(platform({ ...ENV, ...gEnv }), { cloudflare: true, search_console: true }); assert.deepEqual(platform({}), { cloudflare: false, search_console: false });
});

test("service: one organization's website never reads another's settings or cache (multiple websites each keep their own)", async () => {
  const w = world();
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG }, "o", { now: NOW });
  const forged = await loadAnalytics({ env: ENV, db: w.db, organizationId: ORG_B, websiteId: SITE_A, range: 7, now: NOW, fetch: async () => assert.fail("must not fetch for another organization's website") });
  assert.equal(forged.sources.cloudflare.state, "not_connected", "organization B sees no tag for A's website");
  const tags = []; await store.saveConfig(w.db, ORG_B, SITE_B, { cf_site_tag: "ffffffffffffffffffffffffffffffff" }, "o", { now: NOW });
  for (const [org, site] of [[ORG_A, SITE_A], [ORG_B, SITE_B]]) await loadAnalytics({ env: ENV, db: w.db, organizationId: org, websiteId: site, range: 7, now: NOW, fetch: async (u, i) => { tags.push(JSON.parse(i.body).variables.tag); return respond(CF_ANSWER()); } });
  assert.deepEqual(tags, [TAG, "ffffffffffffffffffffffffffffffff"]);
});

/* ---------- the page ---------- */
const vm = { base: "/portal/o/alpha", user: { email: "a@b.ca" } };
const SITE = { id: SITE_A, name: "Alpha Fencing" };
async function fullModel() {
  gsc.forgetTokens();
  const w = world(), { env } = await gscEnv();
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG, gsc_property: PROP }, "o", { now: NOW });
  const fetch = async (u, i) => (String(u).includes("cloudflare") ? respond(CF_ANSWER()) : gscFetch([])(u, i));
  return loadAnalytics({ env: { ...ENV, ...env }, db: w.db, organizationId: ORG_A, websiteId: SITE_A, range: 7, now: NOW, fetch });
}
test("page: traffic and search are separate, labelled sections with period-over-period changes, sources, pages and devices; no inline style or script", async () => {
  const html = analyticsPage(vm, SITE, await fullModel());
  for (const s of ["Website traffic", "Cloudflare Web Analytics", "Search performance", "Google Search Console", "Visits", "Page views", "Up 20%", "Up 50%", "Traffic sources", "www.google.com", "Direct, or no referrer", "Mobile and desktop", "Mobile", "Desktop", "Most visited pages", "/services", "Clicks", "Impressions", "Click-through rate", "5%", "Average position", "11.3", "Improved by 2.9 positions", "Last 7 days", "Last 30 days", "Last 90 days", 'aria-current="page"', "never added together", "not individual people", "not your rank for one search"]) assert.ok(html.includes(s), s);
  assert.ok(!/\bvisitors\b/i.test(html.replace(/how visitors come|visitors?’s browser|reported by the visitor/gi, "")), "Web Analytics counts visits, not people: nothing is called 'visitors'");
  assert.ok(!/\sstyle=|<script|javascript:|\son[a-z]+=/i.test(html), "no inline style, script or handler");
  assert.equal([...html.matchAll(/class="an-hit"/g)].length, 7 * 3, "a read-out band per day for each of the three charts");
  assert.match(html, /<details class="an-table">/);
});

test("page: every setup and failure state is a plain message, never a number", async () => {
  const none = (state, extra = {}) => ({ range: 30, sources: { cloudflare: { state, ...extra }, search_console: { state, ...extra } } });
  for (const [state, text] of [["not_enabled", "aren’t connected yet"], ["not_connected", "set up for this website yet"], ["error", "couldn’t be loaded"]]) {
    const html = analyticsPage(vm, SITE, none(state, { code: "query_failed" }));
    assert.ok(html.includes(text), state);
    assert.ok(!/sd-kpi__v|an-chart|an-bars/.test(html), `${state}: no figures`);
  }
  assert.match(analyticsPage(vm, SITE, none("not_connected")), /mailto:[^"]+Traffic%20reporting%20for%20Alpha%20Fencing/);
  assert.match(analyticsPage(vm, SITE, none("error", { code: "unauthorized" })), /needs attention/);
  const stale = await fullModel(); stale.sources.cloudflare.state = "stale"; stale.sources.cloudflare.code = "unreachable"; stale.sources.cloudflare.fetchedAt = NOW.toISOString();
  assert.match(analyticsPage(vm, SITE, stale), /Showing the figures read on/);
  const quiet = await fullModel(); quiet.sources.cloudflare.data.totals = { visits: 0, pageViews: 0 };
  assert.match(analyticsPage(vm, SITE, quiet), /No visits were recorded in this period/);
});

test("page: text from the providers is escaped; the chart needs two days and says how to read it", () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = trendChart({ id: "c", title: evil, dates: ["2026-11-01", "2026-11-02"], series: [{ label: evil, values: [1, 2], unit: () => evil }] });
  assert.ok(!html.includes("<img"), "escaped");
  assert.equal(trendChart({ id: "c", title: "t", dates: ["2026-11-01"], series: [{ label: "a", values: [1], unit: () => "x" }] }), "");
  assert.match(html, /left and right arrow keys/); assert.match(html, /role="status" aria-live="polite"/);
  assert.match(analyticsTeaser(vm, SITE), /href="\/portal\/o\/alpha\/website\/a1111111-1111-4111-8111-111111111111\/analytics"/);
});

/* ---------- the Admin API ---------- */
const ORIGIN = "https://staging.frameworkco.ca";
function adminCall(w, method, path, body, { env = {}, fetch } = {}) {
  const headers = { ...(method !== "GET" ? { Origin: ORIGIN, "X-Framework-Admin": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  return handleWebsiteAnalyticsApi(new Request(ORIGIN + "/api/admin" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { PORTAL_DB: w.db, PORTAL_ADMIN_WRITES: "1", ...env }, { email: "owner@frameworkco.ca" }, path, { now: NOW, fetch });
}
test("Admin API: read, save, validate, test; credentials never returned; writes need the flag and the same origin", async () => {
  gsc.forgetTokens();
  const w = world(), { env: gEnv } = await gscEnv();
  const path = `/clients/${ORG_A}/websites/${SITE_A}/analytics`;
  let r = await adminCall(w, "GET", path, undefined, { env: { ...ENV, ...gEnv, GSC_ACCOUNT_EMAIL: "analytics@frameworkco.ca" } }); const j = await r.json();
  assert.equal(r.status, 200); assert.equal(j.available, true); assert.deepEqual(j.platform, { cloudflare: true, search_console: true }); assert.equal(j.google_account, "analytics@frameworkco.ca"); assert.equal("service_account_email" in j, false);
  assert.ok(!JSON.stringify(j).match(/cf-token|GOCSPX|1\/\/0g|refresh|client_secret/i), "no credential in the answer");
  assert.equal((await (await adminCall(w, "GET", path, undefined, { env: { ...ENV, ...gEnv, GSC_ACCOUNT_EMAIL: "<script>x" } })).json()).google_account, null, "only a plain email address is ever shown");
  r = await adminCall(w, "POST", path, { cf_site_tag: TAG, gsc_property: PROP }); assert.equal(r.status, 200);
  assert.equal((await adminCall(w, "POST", path, { cf_site_tag: "bad" })).status, 422);
  assert.equal((await adminCall(w, "POST", path, { gsc_property: "bad" })).status, 422);
  assert.equal((await adminCall(w, "POST", path, { surprise: 1 })).status, 400);
  assert.equal((await adminCall(w, "POST", path, { cf_site_tag: TAG }, { env: { PORTAL_ADMIN_WRITES: "0" } })).status, 403);
  const noOrigin = await handleWebsiteAnalyticsApi(new Request(ORIGIN + "/api/admin" + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }), { PORTAL_DB: w.db, PORTAL_ADMIN_WRITES: "1" }, { email: "o@x.ca" }, path, { now: NOW });
  assert.equal(noOrigin.status, 403);
  assert.equal((await adminCall(w, "GET", `/clients/${ORG_B}/websites/${SITE_A}/analytics`)).status, 404, "a website under the wrong organization is not found");
  assert.equal(await adminCall(w, "GET", "/clients/x/websites/y/analytics").then((x) => x.status), 404);
  r = await adminCall(w, "POST", path + "/test", { source: "cloudflare" }, { env: ENV, fetch: async () => respond(CF_ANSWER()) });
  assert.deepEqual(await r.json(), { ok: true, through: "2026-11-10" });
  r = await adminCall(w, "POST", path + "/test", { source: "cloudflare" }, { env: ENV, fetch: async () => respond({}, 403) });
  assert.deepEqual(await r.json(), { ok: false, code: "unauthorized" });
  r = await adminCall(w, "POST", path + "/test", { source: "search_console" }, { env: {} });
  assert.deepEqual(await r.json(), { ok: false, code: "not_enabled" });
  assert.equal((await adminCall(w, "POST", path + "/test", { source: "nope" })).status, 422);
  assert.deepEqual(await testSource({ env: ENV, source: "cloudflare", ref: null }), { ok: false, code: "not_connected" });
  const off = world({ migrated: false });
  assert.equal((await (await adminCall(off, "GET", path)).json()).available, false);
  assert.equal((await adminCall(off, "POST", path, { cf_site_tag: TAG })).status, 409);
});

/* ---------- wiring ---------- */
const src = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
test("config: the Cloudflare account id lives in wrangler.jsonc (Staging only) so a deploy cannot delete it; every analytics credential name is known to the health check", () => {
  const cfg = JSON.parse(src("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "").replace(/,(\s*[}\]])/g, "$1"));
  assert.match(cfg.previews.vars.CF_ANALYTICS_ACCOUNT_ID, /^[0-9a-f]{32}$/, "Staging carries it in the file, or the next deploy deletes it (the client page would say traffic is not connected)");
  assert.equal(cfg.vars.CF_ANALYTICS_ACCOUNT_ID, undefined, "Production is untouched");
  assert.ok(!/CF_ANALYTICS_API_TOKEN|GSC_OAUTH/.test(src("wrangler.jsonc").replace(/^\s*\/\/.*$/gm, "")), "secrets are never in the file");
  assert.deepEqual(cf.credentials({ CF_ANALYTICS_API_TOKEN: "t", CF_ANALYTICS_ACCOUNT_ID: cfg.previews.vars.CF_ANALYTICS_ACCOUNT_ID }), { token: "t", account: cfg.previews.vars.CF_ANALYTICS_ACCOUNT_ID });
  assert.equal(cf.credentials({ CF_ANALYTICS_API_TOKEN: "t" }), null, "a token without the account id is the 'not connected' state");
  const expected = JSON.parse(src("scripts/ops/staging-expected.json"));
  assert.equal(expected.plainVars.CF_ANALYTICS_ACCOUNT_ID, cfg.previews.vars.CF_ANALYTICS_ACCOUNT_ID);
  for (const n of ["CF_ANALYTICS_API_TOKEN", "GSC_OAUTH_CLIENT_ID", "GSC_OAUTH_CLIENT_SECRET", "GSC_OAUTH_REFRESH_TOKEN"]) assert.ok(expected.secrets.optional.includes(n), n);
});

test("wiring: the client route sits under the website page behind website.view and the website flag; the Admin panel and API are registered; no secret is ever read into a page", () => {
  const router = src("worker/portal/router.js");
  assert.match(router, /website\\\/\(\[\^\/\]\+\)\\\/analytics\$\/, action: "website\.view"/);
  assert.match(router, /when: websiteOn, re: \/\^\\\/portal\\\/o\\\/\(\[\^\/\]\+\)\\\/website\\\/\(\[\^\/\]\+\)\\\/analytics\$\//);
  assert.ok(router.indexOf("/analytics$/") < router.indexOf("website\\/([^/]+)$/, action: \"website.view\""), "matched before the generic website page");
  assert.match(src("worker/admin/router.js"), /handleWebsiteAnalyticsApi/);
  assert.match(src("admin/assets/websites.js"), /analyticsPanel\(\{ base, site, canWrite, say \}\)/);
  assert.match(src("worker/portal/website-live.js"), /extra\.analytics \? analyticsTeaser\(vm, s\) : ""/);
  for (const f of ["worker/portal/analytics/view.js", "worker/portal/analytics/service.js", "admin/assets/website-analytics.js"]) assert.ok(!/CF_ANALYTICS_API_TOKEN|GSC_OAUTH_|GSC_SERVICE_ACCOUNT/.test(src(f)), f + " never touches the secrets");
  for (const f of ["worker/portal/analytics/search-console.js", "worker/portal/analytics/service.js", "worker/portal/admin-website-analytics.js"]) assert.ok(!/GSC_SERVICE_ACCOUNT|private_key|RSASSA|importKey|signAssertion/.test(src(f)), f + " has no service account key code");
  const js = src("assets/js/portal-analytics.js"), css = src("assets/css/portal-analytics.css");
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|document\.cookie|innerHTML|eval\(/.test(js), "the read-out script fetches and stores nothing");
  assert.ok(!/@import|url\(/.test(css));
  for (const f of ["admin/assets/website-analytics.js", "worker/portal/analytics/view.js"]) assert.ok(!/innerHTML|insertAdjacentHTML/.test(src(f)) || f.endsWith("view.js"), f);
});

/* ---------- through the real router (sign-in, organization guard, flags) ---------- */
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sitesRepo from "../portal/repo/websites.js";
import { PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";

async function routed({ migrated = true, creds = false } = {}) {
  const w = await makeWorld({ skip: migrated ? [] : [MIG] });
  w.env.PORTAL_WEBSITE = "1";
  if (creds) Object.assign(w.env, ENV);
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser(), anon = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const mk = async (org, name, published = true) => (await sitesRepo.createWebsite(w.db, org.id, { name, url: "https://example.ca", origin: "framework", status: "live", published }, "admin@framework.test", { now: w.clock.now() })).id;
  return { w, alpha, beta, ann, mia, bob, anon, mk };
}
test("route: owners and members of the organization see the page; setup messages when nothing is connected; the Website page links to it", async () => {
  const s = await routed();
  const id = await s.mk(s.alpha, "Alpha Fencing");
  for (const who of [s.ann, s.mia]) {
    const res = await who.get(`/portal/o/alpha/website/${id}/analytics`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /<h1[^>]*>Analytics<\/h1>/); assert.match(html, /Traffic figures aren’t connected yet/); assert.match(html, /Search figures aren’t connected yet/);
    assert.ok(!/sd-kpi__v|an-chart/.test(html), "no numbers without a connection");
    assert.equal(res.headers.get("Content-Security-Policy"), PORTAL_CSP_WITH_SCRIPT, "the strict portal policy, scripts from this site only");
    assert.match(html, /\/assets\/js\/portal-analytics\.js/); assert.match(html, /\/assets\/css\/portal-analytics\.css/);
  }
  const page = await (await s.ann.get(`/portal/o/alpha/website/${id}`)).text();
  assert.match(page, new RegExp(`href="/portal/o/alpha/website/${id}/analytics"`)); assert.match(page, /View analytics/);
  assert.equal((await s.anon.get(`/portal/o/alpha/website/${id}/analytics`)).status, 303, "signed-out visitors are sent to sign in");
});
test("route: another organization's, unpublished and unknown websites are all 'not found'; dormant without the migration; range is allow-listed", async () => {
  const s = await routed();
  const mine = await s.mk(s.alpha, "Alpha"), theirs = await s.mk(s.beta, "Beta"), hidden = await s.mk(s.alpha, "Hidden", false);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${theirs}/analytics`)).status, 404, "another organization's website");
  assert.equal((await s.bob.get(`/portal/o/alpha/website/${mine}/analytics`)).status, 404, "not a member of that organization: it simply does not exist for them");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${hidden}/analytics`)).status, 404, "unpublished");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${UUID0}/analytics`)).status, 404);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/not-a-uuid/analytics`)).status, 404);
  for (const [q, label] of [["", 30], ["?range=7", 7], ["?range=90", 90], ["?range=1000", 30], ["?range=abc", 30], ["?range=7&range=90", 7]]) {
    const html = await (await s.ann.get(`/portal/o/alpha/website/${mine}/analytics${q}`)).text();
    assert.match(html, new RegExp(`href="[^"]*range=${label}" aria-current="page"`), q || "default");
  }
  const dormant = await routed({ migrated: false });
  const id = await dormant.mk(dormant.alpha, "Alpha");
  assert.equal((await dormant.ann.get(`/portal/o/alpha/website/${id}/analytics`)).status, 404, "no migration: the page does not exist");
  assert.ok(!/View analytics/.test(await (await dormant.ann.get(`/portal/o/alpha/website/${id}`)).text()), "and the Website page does not offer it");
});
test("route: with credentials and settings the page shows real provider figures; a failing source shows a message while the other still works; nothing is fetched for other tenants", async () => {
  const s = await routed({ creds: true });
  const id = await s.mk(s.alpha, "Alpha Fencing"), other = await s.mk(s.beta, "Beta Decks");
  await store.saveConfig(s.w.db, s.alpha.id, id, { cf_site_tag: TAG, gsc_property: PROP }, "o", { now: s.w.clock.now() });
  const asked = [];
  const orig = s.w.workos.fetch;
  s.w.workos.fetch = async (u, i) => { if (String(u).includes("cloudflare.com")) { asked.push(JSON.parse(i.body).variables.tag); return respond(CF_ANSWER()); } return orig(u, i); };
  const html = await (await s.ann.get(`/portal/o/alpha/website/${id}/analytics?range=7`)).text();
  assert.match(html, /<span class="sd-kpi__v">120<\/span>/); assert.match(html, /<span class="sd-kpi__v">300<\/span>/); assert.match(html, /Up 20%/);
  assert.match(html, /Search figures aren’t connected yet/, "Search Console has no server credentials here: a message, not numbers");
  assert.deepEqual(asked, [TAG]);
  const again = await (await s.mia.get(`/portal/o/alpha/website/${id}/analytics?range=7`)).text();
  assert.match(again, /<span class="sd-kpi__v">120<\/span>/); assert.deepEqual(asked, [TAG], "the second view is served from the cache");
  s.w.workos.fetch = async () => respond({}, 500);
  const down = await (await s.ann.get(`/portal/o/alpha/website/${id}/analytics?range=30`)).text();
  assert.match(down, /couldn’t be loaded just now/); assert.ok(!/<span class="sd-kpi__v">/.test(down), "nothing earlier for this period: no numbers");
  assert.equal((await s.bob.get(`/portal/o/beta/website/${other}/analytics`)).status, 200);
  assert.deepEqual(asked, [TAG], "Beta has no tag recorded: nothing was read for it");
});
