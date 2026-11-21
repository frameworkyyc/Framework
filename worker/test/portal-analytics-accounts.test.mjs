// Website Analytics, a website's OWN Cloudflare account (proposed migration 0029): the client's account id and read-only API token per website, the token encrypted with
// AES-256-GCM (key: the Worker secret ANALYTICS_CREDENTIALS_KEY), write-only in Admin, never returned, cached, logged or shown to a client. Websites without one keep reading
// from Framework's account exactly as before. Also Admin's Cloudflare test, which tells a refused token, an unreadable account, a site tag with no data and real zero traffic apart.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import * as store from "../portal/repo/website-analytics.js";
import * as cf from "../portal/analytics/cloudflare.js";
import { sealToken, openToken, keyBytes, keyReady } from "../portal/analytics/secret-box.js";
import { loadAnalytics, testSource } from "../portal/analytics/service.js";
import { analyticsPage } from "../portal/analytics/view.js";
import { handleWebsiteAnalyticsApi } from "../portal/admin-website-analytics.js";

const MIG = "0029_website_analytics_accounts.sql";
const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SITE_A = "a1111111-1111-4111-8111-111111111111", SITE_B = "b2222222-2222-4222-8222-222222222222";
const TAG = "0123456789abcdef0123456789abcdef";
const FRAMEWORK_ACCOUNT = "fedcba9876543210fedcba9876543210", CLIENT_ACCOUNT = "c0ffee00c0ffee00c0ffee00c0ffee00";
const CLIENT_TOKEN = "ClientReadOnlyToken_abcdefghijklmnopqrstu";
const NOW = new Date("2026-11-11T18:00:00.000Z");
const KEY = Buffer.alloc(32, 7).toString("base64");
const KEY_ENV = { ANALYTICS_CREDENTIALS_KEY: KEY };
const FRAMEWORK_ENV = { CF_ANALYTICS_API_TOKEN: "framework-token-SECRET", CF_ANALYTICS_ACCOUNT_ID: FRAMEWORK_ACCOUNT };

function world({ proposed = true } = {}) {
  const db = openPortalDb({ proposed: proposed ? [MIG] : [] });
  const run = (sql, ...p) => db.raw.prepare(sql).run(...p);
  for (const [org, slug] of [[ORG_A, "alpha"], [ORG_B, "bravo"]]) run("INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, ?)", org, slug, slug.toUpperCase(), NOW.toISOString(), NOW.toISOString());
  for (const [id, org, name] of [[SITE_A, ORG_A, "Eagle Lodge"], [SITE_B, ORG_B, "Bravo Decks"]]) run("INSERT INTO websites (id, organization_id, name, url, origin, status, managed_by_framework, published, sort_order, created_at, updated_at, updated_by) VALUES (?, ?, ?, 'https://example.com', 'framework', 'live', 1, 1, 0, ?, ?, 'test')", id, org, name, NOW.toISOString(), NOW.toISOString());
  store.forgetAnalyticsReady(db);
  return { db, raw: db.raw };
}
const respond = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const CF_ANSWER = { data: { viewer: { accounts: [{ totals: [{ count: 300, sum: { visits: 120 } }], previous: [{ count: 200, sum: { visits: 100 } }], series: [], sources: [], pages: [], devices: [] }] } } };
const sealedFor = (org, site, token = CLIENT_TOKEN) => sealToken(KEY_ENV, { organizationId: org, websiteId: site, token });
const rawRow = (w, site) => w.raw.prepare("SELECT * FROM website_analytics WHERE website_id = ?").get(site);

/* ---------- migration 0029 ---------- */
test("migration 0029 waits in migrations/portal-proposed (applied nowhere), only adds three nullable columns, and refuses an unencrypted token", () => {
  assert.ok(existsSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url)));
  assert.ok(!existsSync(new URL("../../migrations/portal/" + MIG, import.meta.url)), "not in the applied folder until it is approved and applied");
  const sql = readFileSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url), "utf8").replace(/--.*$/gm, "");
  const statements = sql.split(";").map((x) => x.trim()).filter(Boolean);
  assert.equal(statements.length, 3);
  for (const st of statements) { assert.match(st, /^ALTER TABLE website_analytics ADD COLUMN \w+ TEXT/); assert.ok(!/NOT NULL|DEFAULT/i.test(st), "nullable, no default: existing rows stay NULL"); }
  assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT|RENAME)\b/i.test(sql), "additive only");
  assert.deepEqual(statements.map((st) => st.match(/ADD COLUMN (\w+)/)[1]), ["cf_account_id", "cf_token_enc", "cf_token_set_at"]);
  assert.ok(!/\bcf_(api_)?token\b(?!_)/.test(sql), "there is no plain token column");

  const w = world();
  w.raw.prepare("INSERT INTO website_analytics (website_id, organization_id, cf_site_tag, updated_at, updated_by) VALUES (?, ?, ?, 'x', 'y')").run(SITE_A, ORG_A, TAG);
  assert.deepEqual([rawRow(w, SITE_A).cf_account_id, rawRow(w, SITE_A).cf_token_enc, rawRow(w, SITE_A).cf_token_set_at], [null, null, null], "an existing website keeps Framework's account");
  assert.throws(() => w.raw.prepare("UPDATE website_analytics SET cf_token_enc = ? WHERE website_id = ?").run(CLIENT_TOKEN + CLIENT_TOKEN, SITE_A), /constraint/i, "a plain token is not an encrypted value");
  assert.throws(() => w.raw.prepare("UPDATE website_analytics SET cf_account_id = 'not-an-account' WHERE website_id = ?").run(SITE_A), /constraint/i);
});

/* ---------- encryption ---------- */
test("secret box: AES-256-GCM round trip, a fresh iv each time, the token never visible in the stored value", async () => {
  const a = await sealedFor(ORG_A, SITE_A), b = await sealedFor(ORG_A, SITE_A);
  assert.match(a, /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]+$/);
  assert.notEqual(a, b, "a random iv per encryption");
  assert.ok(!a.includes(CLIENT_TOKEN) && !a.includes(Buffer.from(CLIENT_TOKEN).toString("base64").slice(0, 12)), "not the token, not merely encoded");
  assert.equal(await openToken(KEY_ENV, { organizationId: ORG_A, websiteId: SITE_A, value: a }), CLIENT_TOKEN);
  assert.equal(keyBytes({ ANALYTICS_CREDENTIALS_KEY: "07".repeat(32) }).length, 32, "64 hex characters also work");
  assert.deepEqual(keyBytes({ ANALYTICS_CREDENTIALS_KEY: Buffer.alloc(32, 7).toString("base64url") }), keyBytes(KEY_ENV), "url-safe base64 also works");
  for (const bad of ["", "short", Buffer.alloc(16).toString("base64"), Buffer.alloc(33).toString("base64"), "has spaces in it"]) assert.equal(keyReady({ ANALYTICS_CREDENTIALS_KEY: bad }), false, JSON.stringify(bad));
  assert.equal(keyReady({}), false);
});

test("secret box: a value only opens for its own website and organization, with the right key, untampered; failures are short codes", async () => {
  const v = await sealedFor(ORG_A, SITE_A);
  const code = async (env, ids, value = v) => { try { await openToken(env, { ...ids, value }); return "opened"; } catch (e) { assert.ok(!e.message.includes(CLIENT_TOKEN) && !e.message.includes(KEY)); return e.message; } };
  assert.equal(await code(KEY_ENV, { organizationId: ORG_A, websiteId: SITE_B }), "credentials_unreadable", "copied to another website");
  assert.equal(await code(KEY_ENV, { organizationId: ORG_B, websiteId: SITE_A }), "credentials_unreadable", "copied to another organization");
  assert.equal(await code({ ANALYTICS_CREDENTIALS_KEY: Buffer.alloc(32, 9).toString("base64") }, { organizationId: ORG_A, websiteId: SITE_A }), "credentials_unreadable", "another key");
  const flipped = v.slice(0, -2) + (v.at(-2) === "A" ? "B" : "A") + v.at(-1);
  assert.equal(await code(KEY_ENV, { organizationId: ORG_A, websiteId: SITE_A }, flipped), "credentials_unreadable", "tampered");
  assert.equal(await code(KEY_ENV, { organizationId: ORG_A, websiteId: SITE_A }, "v2.x.y"), "credentials_unreadable");
  assert.equal(await code({}, { organizationId: ORG_A, websiteId: SITE_A }), "credentials_key_missing");
  await assert.rejects(sealToken({}, { organizationId: ORG_A, websiteId: SITE_A, token: CLIENT_TOKEN }), /credentials_key_missing/);
  assert.ok(!/console\./.test(readFileSync(new URL("../portal/analytics/secret-box.js", import.meta.url), "utf8")), "the encryption module never logs");
});

/* ---------- settings ---------- */
test("settings: an own account needs its id and an encrypted token together; removing it removes the token; changes drop the cached traffic; other organizations cannot touch it", async () => {
  const w = world(), sealed = await sealedFor(ORG_A, SITE_A), save = (input, org = ORG_A) => store.saveConfig(w.db, org, SITE_A, input, "owner@frameworkco.ca", { now: NOW });
  assert.equal((await store.getConfig(w.db, ORG_A, SITE_A)).accountsReady, true);
  assert.equal((await save({ cf_site_tag: TAG })).ok, true, "Framework's account, as before");
  assert.equal((await save({ cf_account_id: CLIENT_ACCOUNT })).error, "token_required");
  assert.equal((await save({ cf_account_id: "nope", cf_token_enc: sealed })).error, "invalid_account_id");
  assert.equal((await save({ cf_token_enc: sealed })).error, "account_required");
  assert.equal((await save({ cf_account_id: CLIENT_ACCOUNT, cf_token_enc: CLIENT_TOKEN })).error, "invalid_token", "only an encrypted value is stored");
  assert.equal((await save({ cf_account_id: CLIENT_ACCOUNT.toUpperCase(), cf_token_enc: sealed })).ok, true);
  let c = await store.getConfig(w.db, ORG_A, SITE_A);
  assert.deepEqual([c.cfAccountId, c.cfTokenEnc, c.cfTokenSetAt], [CLIENT_ACCOUNT, sealed, NOW.toISOString()]);
  assert.equal((await save({ cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT })).ok, true, "the saved token is kept when none is sent");
  assert.equal((await store.getConfig(w.db, ORG_A, SITE_A)).cfTokenEnc, sealed);
  assert.equal((await save({ cf_account_id: "" }, ORG_B)).error, "not_found", "another organization cannot change it");
  assert.equal((await store.getConfig(w.db, ORG_A, SITE_A)).cfAccountId, CLIENT_ACCOUNT);

  await store.putCached(w.db, ORG_A, SITE_A, "cloudflare", 7, `${CLIENT_ACCOUNT}:${TAG}`, { period: { to: "2026-11-10" } }, { now: NOW });
  assert.equal((await save({ cf_account_id: "" })).ok, true);
  c = await store.getConfig(w.db, ORG_A, SITE_A);
  assert.deepEqual([c.cfAccountId, c.cfTokenEnc, c.cfTokenSetAt, c.cfSiteTag], [null, null, null, TAG], "back to Framework's account: account and token removed, the tag kept");
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM website_analytics_cache WHERE source = 'cloudflare'").get().n, 0, "the other account's answers are dropped");
});

test("settings without migration 0029: everything reads as Framework's account and works as before; an own account is refused, nothing written", async () => {
  const w = world({ proposed: false });
  const c = await store.getConfig(w.db, ORG_A, SITE_A);
  assert.equal(c.accountsReady, false); assert.equal(c.cfAccountId, null);
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG }, "o", { now: NOW })).ok, true);
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { cf_account_id: CLIENT_ACCOUNT, cf_token_enc: await sealedFor(ORG_A, SITE_A) }, "o", { now: NOW })).error, "accounts_unavailable");
  assert.equal((await store.saveConfig(w.db, ORG_A, SITE_A, { cf_account_id: "" }, "o", { now: NOW })).error, "accounts_unavailable");
  const m = await loadAnalytics({ env: FRAMEWORK_ENV, db: w.db, organizationId: ORG_A, websiteId: SITE_A, range: 7, now: NOW, fetch: async () => respond(CF_ANSWER) });
  assert.equal(m.sources.cloudflare.state, "ok"); assert.equal(m.sources.cloudflare.data.totals.visits, 120);
});

/* ---------- reading ---------- */
async function ownWorld() {
  const w = world();
  await store.saveConfig(w.db, ORG_A, SITE_A, { cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT, cf_token_enc: await sealedFor(ORG_A, SITE_A) }, "o", { now: NOW });
  await store.saveConfig(w.db, ORG_B, SITE_B, { cf_site_tag: "ffffffffffffffffffffffffffffffff" }, "o", { now: NOW });
  return w;
}
const recorder = (calls, body = CF_ANSWER) => async (url, init) => { calls.push({ auth: init.headers.Authorization, vars: JSON.parse(init.body).variables }); return respond(body); };

test("reading: an own-account website is read with its own account and token; a Framework website is read exactly as before; each needs only its own credentials", async () => {
  const w = await ownWorld(), calls = [];
  const load = (org, site, env) => loadAnalytics({ env, db: w.db, organizationId: org, websiteId: site, range: 7, now: NOW, fetch: recorder(calls) });
  let m = await load(ORG_A, SITE_A, { ...FRAMEWORK_ENV, ...KEY_ENV });
  assert.equal(m.sources.cloudflare.state, "ok");
  assert.deepEqual(calls[0], { auth: `Bearer ${CLIENT_TOKEN}`, vars: { ...calls[0].vars, account: CLIENT_ACCOUNT, tag: TAG } });
  m = await load(ORG_B, SITE_B, { ...FRAMEWORK_ENV, ...KEY_ENV });
  assert.deepEqual([calls[1].auth, calls[1].vars.account], ["Bearer framework-token-SECRET", FRAMEWORK_ACCOUNT], "unchanged for websites on Framework's account");
  assert.ok(!JSON.stringify(m).includes("SECRET") && !JSON.stringify(await load(ORG_A, SITE_A, KEY_ENV)).includes(CLIENT_TOKEN), "no token in what the page receives");

  // an own-account website does not need Framework's credentials; a Framework website still does
  w.raw.prepare("DELETE FROM website_analytics_cache").run();
  assert.equal((await load(ORG_A, SITE_A, KEY_ENV)).sources.cloudflare.state, "ok");
  assert.equal((await load(ORG_B, SITE_B, KEY_ENV)).sources.cloudflare.state, "not_enabled");
});

test("reading: the cache is per account; a cached answer needs no decryption; a missing or changed key is 'needs attention' for the client, never a number or a secret", async () => {
  const w = await ownWorld(), calls = [];
  const load = (env, now = NOW) => loadAnalytics({ env, db: w.db, organizationId: ORG_A, websiteId: SITE_A, range: 7, now, fetch: recorder(calls) });
  await load(KEY_ENV);
  assert.equal(w.raw.prepare("SELECT ref FROM website_analytics_cache WHERE website_id = ?").get(SITE_A).ref, `${CLIENT_ACCOUNT}:${TAG}`);
  assert.equal(w.raw.prepare("SELECT COUNT(*) AS n FROM website_analytics_cache WHERE payload LIKE ?").get(`%${CLIENT_TOKEN}%`).n, 0);
  assert.equal((await load({})).sources.cloudflare.state, "ok", "within 30 minutes the cache answers without the key");
  assert.equal(calls.length, 1);

  const later = new Date(NOW.getTime() + 3 * 3600000);
  let m = await load({}, later);
  assert.deepEqual([m.sources.cloudflare.state, m.sources.cloudflare.code], ["stale", "credentials_key_missing"], "the last good figures, marked with their time");
  w.raw.prepare("DELETE FROM website_analytics_cache").run();
  m = await load({ ANALYTICS_CREDENTIALS_KEY: Buffer.alloc(32, 1).toString("base64") }, later);
  assert.deepEqual([m.sources.cloudflare.state, m.sources.cloudflare.code], ["error", "credentials_unreadable"]);
  const html = analyticsPage({ base: "/portal/o/alpha", user: { email: "a@b.ca" } }, { id: SITE_A, name: "Eagle Lodge" }, m);
  assert.match(html, /needs attention/);
  assert.ok(!html.includes("credentials_") && !html.includes(CLIENT_ACCOUNT) && !html.includes("ANALYTICS_CREDENTIALS_KEY"));
});

/* ---------- Admin's Cloudflare test ---------- */
const PERIOD = { current: { from: "2026-11-04", to: "2026-11-10" }, previous: { from: "2026-10-28", to: "2026-11-03" } };
const creds = { token: CLIENT_TOKEN, account: CLIENT_ACCOUNT };
function diagFetch(steps) {
  const seen = [];
  const f = async (url, init) => { const body = JSON.parse(init.body); seen.push(body); const s = steps[seen.length - 1]; if (s instanceof Error) throw s; return typeof s === "number" ? respond({}, s) : respond(s); };
  f.seen = seen; return f;
}
const acct = (o) => ({ data: { viewer: { accounts: [o] } } });
const diagnose = (f) => cf.diagnose({ creds, siteTag: TAG, period: PERIOD, today: "2026-11-11", historyFrom: "2026-08-14", fetch: f });

test("Cloudflare test: receiving data, real zero traffic, a tag with no data, an account with no data, and the uncertain case are told apart", async () => {
  let f = diagFetch([acct({ recent: [{ count: 42 }], history: [{ count: 900 }] })]);
  assert.deepEqual(await diagnose(f), { ok: true, status: "receiving", through: "2026-11-10", pageViews: 42 });
  assert.equal(f.seen.length, 1, "one request when the site is receiving data");
  assert.deepEqual(f.seen[0].variables, { account: CLIENT_ACCOUNT, tag: TAG, from: "2026-11-04", to: "2026-11-10", historyFrom: "2026-08-14", today: "2026-11-11" });
  assert.match(f.seen[0].query, /recent: rumPageloadEventsAdaptiveGroups\(filter: \{ siteTag: \$tag, bot: 0/);

  assert.deepEqual(await diagnose(diagFetch([acct({ recent: [], history: [{ count: 3 }] })])), { ok: true, status: "no_recent_traffic", through: "2026-11-10" }, "the tag has reported before: zero is genuine");

  f = diagFetch([acct({ recent: [], history: [] }), acct({ account: [{ count: 5000 }] })]);
  assert.deepEqual(await diagnose(f), { ok: false, code: "site_tag_no_data" }, "other sites in the account report, this tag never has: a wrong tag (or a missing snippet)");
  assert.equal(f.seen.length, 2); assert.ok(!/siteTag/.test(f.seen[1].query), "the second request looks at the whole account"); assert.equal("tag" in f.seen[1].variables, false);

  assert.deepEqual(await diagnose(diagFetch([acct({ recent: [], history: [] }), acct({ account: [] })])), { ok: false, code: "account_no_data" }, "nothing reaches the account at all: the snippet is missing or this is the wrong account");
  assert.deepEqual(await diagnose(diagFetch([acct({ recent: [], history: [] }), 500])), { ok: false, code: "no_data" }, "the account-wide check failed: no claim beyond 'no data for this tag'");
});

test("Cloudflare test: a refused token, an account the token cannot read, and failures are short codes without secrets", async () => {
  for (const [steps, code] of [
    [[401], "unauthorized"], [[403], "unauthorized"],
    [[{ data: null, errors: [{ message: "Authentication error", extensions: { code: "authn" } }] }], "unauthorized"],
    [[{ data: null, errors: [{ message: "not authorized for that account", extensions: { code: "authz" } }] }], "unauthorized"],
    [[{ data: { viewer: { accounts: [] } } }], "account_not_accessible"],
    [[{ data: null, errors: [{ message: "unknown field" }] }], "query_failed"], [[500], "query_failed"], [[new TypeError("fetch failed")], "unreachable"],
  ]) {
    const r = await diagnose(diagFetch(steps));
    assert.deepEqual(r, { ok: false, code }, code);
    assert.ok(!JSON.stringify(r).includes(CLIENT_TOKEN) && !JSON.stringify(r).includes(TAG));
  }
  assert.equal(cf.validAccountId(" " + CLIENT_ACCOUNT.toUpperCase() + " "), CLIENT_ACCOUNT); assert.equal(cf.validAccountId("xyz"), null);
  assert.equal(cf.validApiToken(` ${CLIENT_TOKEN} `), CLIENT_TOKEN); assert.equal(cf.validApiToken("short"), null); assert.equal(cf.validApiToken("has a space in the middle of it"), null);
});

test("Cloudflare test through the service: an own account is tested with its own decrypted token and says so; key problems are reported, nothing is fetched", async () => {
  const w = await ownWorld(), config = await store.getConfig(w.db, ORG_A, SITE_A), calls = [];
  const r = await testSource({ env: KEY_ENV, source: "cloudflare", config, organizationId: ORG_A, websiteId: SITE_A, now: NOW, fetch: recorder(calls, acct({ recent: [{ count: 7 }], history: [{ count: 7 }] })) });
  assert.deepEqual(r, { ok: true, status: "receiving", through: "2026-11-10", pageViews: 7, account: "own" });
  assert.equal(calls[0].auth, `Bearer ${CLIENT_TOKEN}`); assert.equal(calls[0].vars.account, CLIENT_ACCOUNT);
  assert.equal(calls[0].vars.historyFrom, "2026-08-14"); assert.equal(calls[0].vars.today, "2026-11-11");
  const none = async () => assert.fail("nothing is fetched");
  assert.deepEqual(await testSource({ env: {}, source: "cloudflare", config, organizationId: ORG_A, websiteId: SITE_A, now: NOW, fetch: none }), { ok: false, code: "credentials_key_missing" });
  assert.deepEqual(await testSource({ env: KEY_ENV, source: "cloudflare", config, organizationId: ORG_B, websiteId: SITE_A, now: NOW, fetch: none }), { ok: false, code: "credentials_unreadable" }, "a value is bound to its own organization");
  assert.deepEqual(await testSource({ env: FRAMEWORK_ENV, source: "cloudflare", ref: TAG, now: NOW, fetch: recorder([], acct({ recent: [], history: [{ count: 1 }] })) }), { ok: true, status: "no_recent_traffic", through: "2026-11-10", account: "framework" });
});

/* ---------- Admin API ---------- */
const ORIGIN = "https://staging.frameworkco.ca";
const PATH = `/clients/${ORG_A}/websites/${SITE_A}/analytics`;
function adminCall(w, method, path, body, { env = {}, fetch } = {}) {
  const headers = { ...(method !== "GET" ? { Origin: ORIGIN, "X-Framework-Admin": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
  return handleWebsiteAnalyticsApi(new Request(ORIGIN + "/api/admin" + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), { PORTAL_DB: w.db, PORTAL_ADMIN_WRITES: "1", ...env }, { email: "owner@frameworkco.ca" }, path, { now: NOW, fetch });
}

test("Admin API: the token is encrypted on save and write-only: no answer contains it or its encrypted form; replacing, keeping and removing it", async () => {
  const w = world(), env = { ...FRAMEWORK_ENV, ...KEY_ENV };
  let j = await (await adminCall(w, "GET", PATH, undefined, { env })).json();
  assert.deepEqual(j.own_accounts, { available: true, key: true });
  assert.deepEqual([j.config.cf_account_id, j.config.cf_token_set, j.config.cf_token_set_at], [null, false, null]);

  let r = await adminCall(w, "POST", PATH, { cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT, cf_api_token: ` ${CLIENT_TOKEN} ` }, { env });
  assert.equal(r.status, 200);
  const stored = rawRow(w, SITE_A).cf_token_enc;
  assert.match(stored, /^v1\./); assert.ok(!stored.includes(CLIENT_TOKEN));
  assert.equal(await openToken(KEY_ENV, { organizationId: ORG_A, websiteId: SITE_A, value: stored }), CLIENT_TOKEN, "encrypted for this website of this organization");

  const answer = await (await adminCall(w, "GET", PATH, undefined, { env })).text();
  j = JSON.parse(answer);
  assert.deepEqual([j.config.cf_account_id, j.config.cf_token_set, j.config.cf_token_set_at], [CLIENT_ACCOUNT, true, NOW.toISOString()]);
  assert.ok(!answer.includes(CLIENT_TOKEN) && !answer.includes(stored) && !answer.includes("v1.") && !/cf_token_enc|framework-token|ANALYTICS_CREDENTIALS_KEY/.test(answer), "never the token, its encrypted form or the key");

  assert.equal((await adminCall(w, "POST", PATH, { cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT, cf_api_token: "" }, { env })).status, 200);
  assert.equal(rawRow(w, SITE_A).cf_token_enc, stored, "an empty token field keeps the saved token");
  assert.equal((await adminCall(w, "POST", PATH, { cf_account_id: CLIENT_ACCOUNT, cf_api_token: "Another_ReadOnly_Token_0123456789" }, { env })).status, 200);
  assert.notEqual(rawRow(w, SITE_A).cf_token_enc, stored, "replaced");
  assert.equal((await adminCall(w, "POST", PATH, { cf_account_id: "" }, { env })).status, 200);
  assert.deepEqual([rawRow(w, SITE_A).cf_account_id, rawRow(w, SITE_A).cf_token_enc, rawRow(w, SITE_A).cf_site_tag], [null, null, TAG], "removed: back to Framework's account");
});

test("Admin API: refusals change nothing (no key, bad token, a raw encrypted value, no migration, writes off, another organization)", async () => {
  const w = world(), env = { ...FRAMEWORK_ENV, ...KEY_ENV };
  const status = async (body, opts = { env }, path = PATH) => { const r = await adminCall(w, "POST", path, body, opts); return [r.status, (await r.json()).error]; };
  assert.deepEqual(await status({ cf_account_id: CLIENT_ACCOUNT, cf_api_token: CLIENT_TOKEN }, { env: FRAMEWORK_ENV }), [409, "credentials_key_missing"]);
  assert.deepEqual(await status({ cf_account_id: CLIENT_ACCOUNT, cf_api_token: "bad token" }), [422, "invalid_token"]);
  assert.deepEqual(await status({ cf_account_id: CLIENT_ACCOUNT }), [422, "token_required"]);
  assert.deepEqual(await status({ cf_account_id: "x", cf_api_token: CLIENT_TOKEN }), [422, "invalid_account_id"]);
  assert.deepEqual(await status({ cf_account_id: CLIENT_ACCOUNT, cf_token_enc: "v1.aaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbb" }), [400, "unknown_field"], "an encrypted value cannot be planted from outside");
  assert.deepEqual(await status({ cf_account_id: CLIENT_ACCOUNT, cf_api_token: CLIENT_TOKEN }, { env: { ...env, PORTAL_ADMIN_WRITES: "0" } }), [403, "writes_disabled"]);
  assert.equal((await adminCall(w, "POST", `/clients/${ORG_B}/websites/${SITE_A}/analytics`, { cf_account_id: CLIENT_ACCOUNT, cf_api_token: CLIENT_TOKEN }, { env })).status, 404);
  assert.equal(rawRow(w, SITE_A), undefined, "nothing was written");

  const old = world({ proposed: false });
  const j = await (await adminCall(old, "GET", PATH, undefined, { env })).json();
  assert.deepEqual(j.own_accounts, { available: false, key: true });
  const r = await adminCall(old, "POST", PATH, { cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT, cf_api_token: CLIENT_TOKEN }, { env });
  assert.deepEqual([r.status, (await r.json()).error], [409, "accounts_unavailable"]);
  assert.equal((await adminCall(old, "POST", PATH, { cf_site_tag: TAG }, { env })).status, 200, "Framework-account settings still save before 0029");
});

test("Admin API: Test uses the website's own account and decrypted token, and answers only a status", async () => {
  const w = world(), env = { ...FRAMEWORK_ENV, ...KEY_ENV }, calls = [];
  await adminCall(w, "POST", PATH, { cf_site_tag: TAG, cf_account_id: CLIENT_ACCOUNT, cf_api_token: CLIENT_TOKEN }, { env });
  const r = await adminCall(w, "POST", PATH + "/test", { source: "cloudflare" }, { env, fetch: recorder(calls, acct({ recent: [], history: [] })) });
  const text = await r.text();
  assert.equal(calls[0].auth, `Bearer ${CLIENT_TOKEN}`); assert.equal(calls[0].vars.account, CLIENT_ACCOUNT);
  assert.deepEqual(JSON.parse(text), { ok: false, code: "account_no_data", account: "own" }, "Eagle's Nest's case: nothing has reached the client's account");
  assert.ok(!text.includes(CLIENT_TOKEN));
});

/* ---------- Admin panel, configuration, documentation ---------- */
const src = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
test("Admin panel: the token field is a write-only password field, never filled in; no HTML insertion; the encrypted form is never handled in the browser", () => {
  const js = src("admin/assets/website-analytics.js");
  assert.match(js, /type: "password", autocomplete: "new-password", spellcheck: "false", value: ""/);
  assert.match(js, /body\.cf_api_token = token\.value\.trim\(\)/);
  assert.ok(!/cf_token_enc|innerHTML|insertAdjacentHTML|style=|\.style\./.test(js));
  assert.match(js, /import \{ badge \} from "\.\/kit\.js"/, "status chips come from the shared kit");
  assert.match(js, /confirmDialog\(/, "removing a saved token is confirmed");
  assert.match(src("admin/assets/admin.css"), /\.adm-an \[hidden\] \{ display: none; \}/);
});

test("config and docs: the encryption key is a secret known to the health check and never in wrangler.jsonc; the documents describe the own-account setup", () => {
  const expected = JSON.parse(src("scripts/ops/staging-expected.json"));
  assert.ok(expected.secrets.optional.includes("ANALYTICS_CREDENTIALS_KEY"));
  assert.ok(!/ANALYTICS_CREDENTIALS_KEY/.test(src("wrangler.jsonc")), "a secret, never a plain variable in the file");
  const doc = src("worker/portal/WEBSITE-ANALYTICS.md");
  for (const s of ["ANALYTICS_CREDENTIALS_KEY", "0029", "AES-256-GCM", "write-only", "site_tag_no_data", "account_no_data", "no_recent_traffic"]) assert.ok(doc.includes(s), s);
  assert.match(src("migrations/portal/README.md"), /0029_website_analytics_accounts\.sql/);
  assert.match(src("worker/admin/DESIGN-SYSTEM.md"), /[Ww]rite-only/);
});
