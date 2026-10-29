// The Staging health check (scripts/ops/staging-health.mjs), against MOCKED APIs only: no network, no credentials. It pins what the check reports, that the
// critical security checks fail closed, that it is read-only (every request a GET except the one fixed SELECT), Staging-only, host-restricted, and that no token,
// secret value, address or commit text ever reaches the output. It also keeps the expected-config file in step with wrangler.jsonc.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runHealthCheck, formatMarkdown, main, loadExpected, validateExpected, scrub, makeHttp, ALLOWED_SQL } from "../../scripts/ops/staging-health.mjs";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const expected = loadExpected();
const NOW = new Date("2026-10-21T12:00:00.000Z");
const ACCOUNT = "0123456789abcdef0123456789abcdef";
const PREVIEW = "fedcba9876543210fedcba9876543210";
const DEPLOY = "11111111-2222-3333-4444-555555555555";
const SHA = "1a742a9fbbdfb9b998d41ce16d860be59d1abaa1";
const FAKE_TOKEN = "cf_test_TOKEN_0123456789abcdefghijklmnopqrstuvwxyz";
const SECRET_TEXT = "super-secret-value-that-must-never-appear-0123456789";
const PRODUCTION_PORTAL_DB = "b213b7db-ed29-4ab6-946c-0728dd6709e8";

const goodEnv = () => ({
  ASSESSMENT_FROM: { type: "plain_text", text: "Framework <noreply@example.test>" },
  TURNSTILE_SITE_KEY: { type: "plain_text", text: "0xSITEKEY" },
  PORTAL_AUTH_CLIENT_ID: { type: "plain_text", text: "client_X" },
  PORTAL_AUTH_ISSUER: { type: "plain_text", text: "https://issuer.example.test" },
  PORTAL_BASE_URL: { type: "plain_text", text: "https://staging.frameworkco.ca" },
  PORTAL_ENABLED: { type: "plain_text", text: "1" },
  PORTAL_DEMO: { type: "plain_text", text: "1" },
  PORTAL_BRANDING: { type: "plain_text", text: "1" },
  PORTAL_SERVICES: { type: "plain_text", text: "1" },
  PORTAL_WEBSITE: { type: "plain_text", text: "1" },
  PORTAL_ADMIN_WRITES: { type: "plain_text", text: "1" },
  PORTAL_INVITE_SENDING: { type: "plain_text", text: "1" },
  ...Object.fromEntries(expected.secrets.required.map((n) => [n, { type: "secret_text" }])),
  IP_HASH_SALT: { type: "secret_text" },
  ASSETS: { type: "assets" },
  DB: { type: "d1", id: expected.websiteDb.id, database_id: expected.websiteDb.id },
  PORTAL_DB: { type: "d1", id: expected.d1.id, database_id: expected.d1.id },
  PORTAL_FILES: { type: "r2_bucket", bucket_name: "framework-portal-files-staging" },
  PORTAL_FILES_BACKUP: { type: "r2_bucket", bucket_name: "framework-portal-files-staging-backup" },
  PORTAL_RATE_LIMITER: { type: "ratelimit", namespace_id: "4101", simple: { limit: 20, period: 60 } },
});

/** A mock of everything the check talks to. `over` replaces or removes routes; every request is recorded. */
function world(over = {}) {
  const calls = [];
  const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  const ok = (result, extra = {}) => json(200, { success: true, errors: [], messages: [], result, ...extra });
  const routes = {
    verify: () => ok({ id: "tokid", status: "active" }),
    accounts: () => ok([{ id: ACCOUNT, name: "Account" }]),
    previews: () => ok([{ id: PREVIEW, name: "Staging", created_on: "2026-09-29T00:00:00Z" }, { id: "a".repeat(32), name: "other-branch" }]),
    deployments: () => ok([
      { id: DEPLOY, number: 124, created_on: "2026-10-21T11:00:00Z", source: "dash", annotations: { "workers/message": "Add secret: X, contact someone@example.test", "workers/triggered_by": "api" } },
      { id: "22222222-2222-3333-4444-555555555555", number: 123, created_on: "2026-10-21T10:00:00Z", source: "wrangler", annotations: { "workers/tag": SHA.slice(0, 7), "workers/message": "A commit message with person@example.test and " + SECRET_TEXT } },
    ]),
    deployment: () => ok({ id: DEPLOY, env: goodEnv() }),
    d1: () => ok({ uuid: expected.d1.id, name: expected.d1.name, num_tables: 10, file_size: 208896, running_in_region: "WNAM" }),
    query: () => ok([{ success: true, results: expected.d1.tables.map((name) => ({ name })) }]),
    bookmark: () => ok({ bookmark: "00000001-00000002-00004e2a-" + "ab".repeat(16) }),
    ghbranch: () => json(200, { name: "Staging", commit: { sha: SHA } }),
    ghchecks: () => json(200, { check_runs: [{ name: "Workers Builds: framework", status: "completed", conclusion: "success" }, { name: "Node tests", status: "completed", conclusion: "success" }] }),
    login: () => new Response("<html>sign in</html>", { status: 200, headers: { "cache-control": "no-store", "content-security-policy": "default-src 'none'", "x-frame-options": "DENY", "referrer-policy": "no-referrer" } }),
    portal: () => new Response(null, { status: 302, headers: { location: "/portal/login" } }),
    org: () => new Response(null, { status: 302, headers: { location: "/portal/login" } }),
    admin: () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/login" } }),
    adminapi: () => new Response("Forbidden", { status: 403 }),
    privacy: () => new Response("<h2>The client portal</h2>", { status: 200 }),
    ...over,
  };
  const route = (u, method) => {
    const p = u.pathname;
    if (u.host === "api.github.com") return /check-runs/.test(p) ? "ghchecks" : "ghbranch";
    if (u.host === "staging.frameworkco.ca") return p === "/portal/login" ? "login" : p === "/portal" ? "portal" : p.startsWith("/portal/o/") ? "org" : p === "/admin" ? "admin" : p === "/api/admin/clients" ? "adminapi" : p === "/privacy" ? "privacy" : "other";
    if (p.endsWith("/user/tokens/verify")) return "verify";
    if (p.endsWith("/accounts")) return "accounts";
    if (/\/previews\/[0-9a-f]{32}\/deployments\/[0-9a-f-]{36}$/.test(p)) return "deployment";
    if (/\/previews\/[0-9a-f]{32}\/deployments$/.test(p)) return "deployments";
    if (/\/previews$/.test(p)) return "previews";
    if (/\/time_travel\/bookmark$/.test(p)) return "bookmark";
    if (/\/d1\/database\/[0-9a-f-]{36}\/query$/.test(p)) return "query";
    if (/\/d1\/database\/[0-9a-f-]{36}$/.test(p)) return "d1";
    return "other";
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || "GET", name = route(u, method);
    calls.push({ url: u.toString(), host: u.host, path: u.pathname, method, name, body: init.body, auth: init.headers && init.headers.Authorization });
    const r = routes[name];
    if (!r) return new Response("not found", { status: 404 });
    if (r instanceof Error) throw r;
    return r(u, init);
  };
  return { fetch, calls };
}
const run = (over, extra = {}) => { const w = world(over); return runHealthCheck({ fetch: w.fetch, env: {}, expected, now: () => NOW, ...extra }).then((report) => ({ report, w })); };
const by = (report) => Object.fromEntries(report.results.map((r) => [r.id, r]));
const j = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const ok = (v) => j(200, { success: true, errors: [], messages: [], result: v });

/* ------------------------------------------------------------------ the healthy report */

test("a healthy Staging reports PASS everywhere except the two unavoidable WARNs (optional secret absent is not here: it is present), with exit code 0", async () => {
  const { report } = await run();
  const r = by(report);
  assert.equal(report.counts.FAIL, 0);
  assert.deepEqual(report.results.filter((x) => x.status === "WARN").map((x) => x.id), ["d1.retention"], "only the retention/restore limitation is a standing warning");
  for (const id of ["cloudflare.auth", "preview.exists", "deployments.recent", "deploy.commit", "github.check.workers-builds-framework", "github.check.node-tests", "critical.admin_writes", "critical.invite_sending", "critical.allowlist_enforced", "critical.deprecated_allowlist_absent", "config.secrets", "config.variables", "config.bindings", "config.database_binding", "config.unexpected_names", "d1.available", "d1.tables", "d1.timetravel", "smoke.login", "smoke.headers", "smoke.portal_home", "smoke.org_page", "smoke.admin_page", "smoke.admin_api", "smoke.privacy"]) assert.equal(r[id].status, "PASS", id);
  assert.equal(report.overall, "WARN");
  const code = await main(["--json"], { out: () => {}, run: { fetch: world().fetch, env: {}, expected, now: () => NOW } });
  assert.equal(code, 0);
});

test("an optional secret that is absent (IP_HASH_SALT on the real Staging) is a WARN, not a FAIL", async () => {
  const env = goodEnv(); delete env.IP_HASH_SALT;
  const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
  assert.equal(by(report)["config.optional_secrets"].status, "WARN");
  assert.equal(report.counts.FAIL, 0);
});

/* ------------------------------------------------------------------ critical checks fail closed */

test("CRITICAL: the two invitation switches must match the DECLARED state (on for the controlled workflow): absent, a wrong value, or a non-plain type FAILS; the deprecated allowlist FAILS when present; values are never printed", async () => {
  for (const [name, id] of [["PORTAL_ADMIN_WRITES", "critical.admin_writes"], ["PORTAL_INVITE_SENDING", "critical.invite_sending"]]) {
    for (const [label, mutate] of [["absent", (e) => { delete e[name]; }], ["0", (e) => { e[name] = { type: "plain_text", text: "0" }; }], ["true", (e) => { e[name] = { type: "plain_text", text: "true" }; }], ["empty", (e) => { e[name] = { type: "plain_text", text: "" }; }], ["secret type", (e) => { e[name] = { type: "secret_text" }; }]]) {
      const env = goodEnv(); mutate(env);
      const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
      assert.equal(by(report)[id].status, "FAIL", `${name} ${label}`);
      assert.equal(report.overall, "FAIL");
      assert.ok(!formatMarkdown(report).includes("super-secret"), "no value is printed");
    }
  }
  // the deprecated public allowlist is never allowed, in any form
  for (const entry of [{ type: "plain_text", text: "1" }, { type: "plain_text", text: "" }, { type: "secret_text" }]) {
    const { report } = await run({ deployment: () => ok({ id: DEPLOY, env: { ...goodEnv(), PORTAL_INVITE_ALLOWED_EMAILS: entry } }) });
    assert.equal(by(report)["critical.deprecated_allowlist_absent"].status, "FAIL");
  }
  // a switch is on but the approved-recipient allowlist secret is missing or is not a secret: FAIL
  for (const mutate of [(e) => { delete e.PORTAL_INVITE_ALLOWLIST; }, (e) => { e.PORTAL_INVITE_ALLOWLIST = { type: "plain_text", text: "visible@example.test" }; }]) {
    const env = goodEnv(); mutate(env);
    const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
    assert.equal(by(report)["critical.allowlist_enforced"].status, "FAIL");
    assert.ok(!formatMarkdown(report).includes("visible@example.test"));
  }
  assert.equal(await main([], { out: () => {}, run: { fetch: world({ deployment: () => ok({ id: DEPLOY, env: { ...goodEnv(), PORTAL_ADMIN_WRITES: { type: "plain_text", text: "0" } } }) }).fetch, env: {}, expected, now: () => NOW } }), 1, "exit code 1 on any FAIL");
});

test("when the declared state is 'off' (switches null in the expected file) a switch that is present FAILS, and absent passes", async () => {
  const off = { ...expected, switches: { PORTAL_ADMIN_WRITES: null, PORTAL_INVITE_SENDING: null } };
  const envOff = goodEnv(); delete envOff.PORTAL_ADMIN_WRITES; delete envOff.PORTAL_INVITE_SENDING;
  let r = by((await run({ deployment: () => ok({ id: DEPLOY, env: envOff }) }, { expected: off })).report);
  assert.equal(r["critical.admin_writes"].status, "PASS"); assert.equal(r["critical.invite_sending"].status, "PASS"); assert.equal(r["critical.allowlist_enforced"].status, "PASS");
  r = by((await run({ deployment: () => ok({ id: DEPLOY, env: { ...envOff, PORTAL_ADMIN_WRITES: { type: "plain_text", text: "1" } } }) }, { expected: off })).report);
  assert.equal(r["critical.admin_writes"].status, "FAIL");
  assert.equal(r["config.unexpected_names"].status, "PASS", "a declared switch name is a known name");
});

test("CRITICAL: if the configuration cannot be read (auth, Preview missing, history unreadable, wrong shape, outage), the critical checks FAIL with 'cannot verify'", async () => {
  const broken = {
    "401 on verify": { verify: () => j(401, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }) },
    "no account": { accounts: () => (ok([])) },
    "Preview missing": { previews: () => (ok([{ id: "b".repeat(32), name: "other" }])) },
    "Preview list 403": { previews: () => j(403, { success: false, errors: [{ code: 10000, message: "Forbidden" }] }) },
    "deployments empty": { deployments: () => (ok([])) },
    "deployments HTTP 500": { deployments: () => j(500, { success: false, errors: [{ code: 9000, message: "boom" }] }) },
    "deployment detail 403": { deployment: () => j(403, { success: false, errors: [{ code: 10000, message: "Forbidden" }] }) },
    "env missing": { deployment: () => (ok({ id: DEPLOY })) },
    "env is an array": { deployment: () => (ok({ id: DEPLOY, env: [] })) },
    "not JSON": { deployment: () => new Response("<html>gateway</html>", { status: 200 }) },
    "network error": { deployment: () => new TypeError("fetch failed") },
  };
  for (const [label, over] of Object.entries(broken)) {
    const { report } = await run(over);
    const r = by(report);
    for (const id of ["critical.admin_writes", "critical.invite_sending", "critical.allowlist_enforced", "critical.deprecated_allowlist_absent"]) {
      assert.equal(r[id].status, "FAIL", `${label}: ${id}`);
      assert.match(r[id].message, /cannot verify/, `${label}: ${id}`);
    }
    assert.equal(report.overall, "FAIL", label);
  }
});

test("a missing required secret, a non-secret where a secret is required, drifted settings, a wrong binding or a Production database binding all FAIL", async () => {
  const cases = [
    ["config.secrets", (e) => { delete e.PORTAL_INVITE_ALLOWLIST; }],
    ["config.secrets", (e) => { e.PORTAL_SESSION_PEPPER = { type: "plain_text", text: "visible" }; }],
    ["config.variables", (e) => { e.PORTAL_ENABLED = { type: "plain_text", text: "0" }; }],
    ["config.variables", (e) => { delete e.PORTAL_BASE_URL; }],
    ["config.variables", (e) => { e.PORTAL_BASE_URL = { type: "plain_text", text: "https://frameworkco.ca" }; }],
    ["config.bindings", (e) => { delete e.PORTAL_FILES; }],
    ["config.bindings", (e) => { e.PORTAL_FILES = { type: "r2_bucket", bucket_name: "some-other-bucket" }; }],
    ["config.bindings", (e) => { e.PORTAL_RATE_LIMITER = { type: "ratelimit", namespace_id: "4201" }; }],
    ["config.database_binding", (e) => { e.PORTAL_DB = { type: "d1", id: PRODUCTION_PORTAL_DB, database_id: PRODUCTION_PORTAL_DB }; }],
    ["config.database_binding", (e) => { e.DB = { type: "d1", id: "47d90f94-3846-4711-9495-ab3479431a6f" }; }],
    ["config.database_binding", (e) => { e.PORTAL_DB = { type: "d1", id: "99999999-9999-9999-9999-999999999999" }; }],
  ];
  for (const [id, mutate] of cases) {
    const env = goodEnv(); mutate(env);
    const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
    assert.equal(by(report)[id].status, "FAIL", id + " " + mutate.toString().slice(0, 60));
  }
  const env = goodEnv(); env.PORTAL_DB = { type: "d1", id: PRODUCTION_PORTAL_DB };
  const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
  assert.match(by(report)["config.database_binding"].message, /PRODUCTION database/);
});

test("unexpected names are a WARN (names only), and a stray value never appears", async () => {
  const env = { ...goodEnv(), SOME_NEW_THING: { type: "plain_text", text: "someone@example.test " + SECRET_TEXT } };
  const { report } = await run({ deployment: () => ok({ id: DEPLOY, env }) });
  assert.equal(by(report)["config.unexpected_names"].status, "WARN");
  assert.match(by(report)["config.unexpected_names"].message, /SOME_NEW_THING/);
  assert.ok(!formatMarkdown(report).includes(SECRET_TEXT));
});

/* ------------------------------------------------------------------ deployment history, commit and builds */

test("the deployed commit is compared with the Staging head; a different commit is a WARN; a failed build or test check is a FAIL; unreadable GitHub is a WARN", async () => {
  let r = by((await run({ ghbranch: () => j(200, { commit: { sha: "f".repeat(40) } }) })).report);
  assert.equal(r["deploy.commit"].status, "WARN");
  assert.match(r["deploy.commit"].message, /differs/);
  r = by((await run({ ghchecks: () => j(200, { check_runs: [{ name: "Workers Builds: framework", status: "completed", conclusion: "failure" }, { name: "Node tests", status: "completed", conclusion: "success" }] }) })).report);
  assert.equal(r["github.check.workers-builds-framework"].status, "FAIL");
  r = by((await run({ ghchecks: () => j(200, { check_runs: [{ name: "Workers Builds: framework", status: "in_progress", conclusion: null }] }) })).report);
  assert.equal(r["github.check.workers-builds-framework"].status, "WARN");
  assert.equal(r["github.check.node-tests"].status, "WARN", "a check that is not reported is a WARN");
  r = by((await run({ ghbranch: () => j(403, { message: "rate limited" }) })).report);
  assert.equal(r["deploy.commit"].status, "WARN");
  const noTag = by((await run({ deployments: () => ok([{ id: DEPLOY, number: 9, created_on: "2026-10-21T11:00:00Z", source: "dash", annotations: {} }]) })).report);
  assert.equal(noTag["deploy.commit"].status, "WARN");
});

/* ------------------------------------------------------------------ D1 */

test("D1: unreachable, wrong database, missing tables FAIL; extra tables WARN; a query the token is not allowed to run is a WARN, not a pass; the Time Travel bookmark API failing is a WARN", async () => {
  assert.equal(by((await run({ d1: () => j(500, { success: false, errors: [{ code: 7000 }] }) })).report)["d1.available"].status, "FAIL");
  assert.equal(by((await run({ d1: () => ok({ uuid: PRODUCTION_PORTAL_DB, name: "framework-portal" }) })).report)["d1.available"].status, "FAIL");
  assert.equal(by((await run({ query: () => ok([{ results: expected.d1.tables.slice(1).map((name) => ({ name })) }]) })).report)["d1.tables"].status, "FAIL");
  assert.equal(by((await run({ query: () => ok([{ results: [...expected.d1.tables, "surprise"].map((name) => ({ name })) }]) })).report)["d1.tables"].status, "WARN");
  const denied = by((await run({ query: () => j(403, { success: false, errors: [{ code: 10000, message: "Authentication error" }] }) })).report);
  assert.equal(denied["d1.tables"].status, "WARN");
  assert.match(denied["d1.tables"].message, /HTTP 403/);
  assert.equal(by((await run({ bookmark: () => j(404, { success: false, errors: [{ code: 7003 }] }) })).report)["d1.timetravel"].status, "WARN");
  const ok1 = await run();
  assert.ok(!formatMarkdown(ok1.report).includes("00004e2a"), "the bookmark value is never printed");
  assert.equal(by(ok1.report)["d1.retention"].status, "WARN", "retention and restores are never reported as verified");
});

/* ------------------------------------------------------------------ smoke tests */

test("smoke tests: an unauthenticated 200 on /portal, an organization page, /admin or /api/admin is a FAIL; missing security headers FAIL; an unreachable host is one WARN", async () => {
  const page = (status, headers) => () => new Response("x", { status, headers });
  for (const [id, over] of [
    ["smoke.portal_home", { portal: page(200, {}) }], ["smoke.org_page", { org: page(200, {}) }], ["smoke.admin_page", { admin: page(200, {}) }], ["smoke.admin_api", { adminapi: page(200, {}) }],
    ["smoke.login", { login: page(500, {}) }], ["smoke.headers", { login: page(200, { "cache-control": "public" }) }],
  ]) assert.equal(by((await run(over)).report)[id].status, "FAIL", id);
  const unreachable = by((await run({ login: new TypeError("fetch failed") })).report);
  assert.equal(unreachable["smoke.reachable"].status, "WARN");
  assert.ok(!unreachable["smoke.login"], "no further smoke checks when the host is unreachable");
  const skipped = by((await run({}, { skipSmoke: true })).report);
  assert.equal(skipped["smoke.skipped"].status, "WARN");
});

/* ------------------------------------------------------------------ read-only, Staging-only, host-restricted, no leaks */

test("READ-ONLY: every request is a GET except exactly one POST, the fixed sqlite_master SELECT on the Staging portal database; the token goes only to api.cloudflare.com", async () => {
  const { w } = await run({}, { env: { CLOUDFLARE_API_TOKEN: FAKE_TOKEN } });
  const posts = w.calls.filter((c) => c.method !== "GET");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].method, "POST");
  assert.equal(posts[0].name, "query");
  assert.equal(posts[0].path, `/client/v4/accounts/${ACCOUNT}/d1/database/${expected.d1.id}/query`);
  assert.deepEqual(JSON.parse(posts[0].body), { sql: ALLOWED_SQL });
  assert.equal(ALLOWED_SQL, "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  assert.deepEqual([...new Set(w.calls.map((c) => c.host))].sort(), ["api.cloudflare.com", "api.github.com", "staging.frameworkco.ca"]);
  for (const c of w.calls) assert.equal(Boolean(c.auth), c.host === "api.cloudflare.com", `${c.host}: the credential goes to Cloudflare only`);
  assert.ok(w.calls.filter((c) => c.host === "api.cloudflare.com").every((c) => c.auth === `Bearer ${FAKE_TOKEN}`));
  // Staging only: no request ever names a Production database or the Production Worker script settings
  for (const c of w.calls) {
    assert.ok(!c.url.includes(PRODUCTION_PORTAL_DB) && !c.url.includes("47d90f94-3846-4711-9495-ab3479431a6f"), c.url);
    assert.ok(!/\/workers\/scripts\//.test(c.path), "the Production Worker script endpoints are never used");
    assert.ok(!/\/(d1\/database)\/[0-9a-f-]{36}\/(export|import|raw|time_travel\/restore)$/.test(c.path), c.path);
  }
  assert.ok(w.calls.some((c) => /\/previews\/[0-9a-f]{32}\/deployments\//.test(c.path)), "it reads the Staging Preview's deployment");
});

test("the HTTP layer refuses any other host, any other method, any other database, any other SQL and a Production database id (before a request is made)", async () => {
  const w = world();
  const http = makeHttp({ fetch: w.fetch, token: FAKE_TOKEN, baseUrl: expected.baseUrl });
  await assert.rejects(() => http.get("https://evil.example/steal"), /blocked/);
  await assert.rejects(() => http.get("http://api.cloudflare.com/client/v4/accounts"), /blocked/);
  await assert.rejects(() => http.get("https://api.cloudflare.com.evil.example/x"), /blocked/);
  await assert.rejects(() => http.queryStagingTables(ACCOUNT, PRODUCTION_PORTAL_DB, expected), /blocked/);
  await assert.rejects(() => http.queryStagingTables(ACCOUNT, "99999999-9999-9999-9999-999999999999", expected), /blocked/);
  await assert.rejects(() => http.queryStagingTables("not-an-account", expected.d1.id, expected), /blocked/);
  assert.equal(w.calls.length, 0, "nothing was sent for any refused request");
  assert.equal(http.queryStagingTables.length, 3);
  const src = readFileSync(new URL("../../scripts/ops/staging-health.mjs", import.meta.url), "utf8");
  assert.ok(!/method:\s*["'](PUT|PATCH|DELETE)["']/.test(src), "no write methods exist in the script");
  assert.equal([...src.matchAll(/method:\s*"POST"/g)].length, 1, "exactly one POST in the whole script");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/ALLOWED_SQL = "[^"]*"/, "")), "no other SQL in the script");
});

test("expected configuration is refused when it could point at Production or hold credentials or addresses", () => {
  const clone = () => JSON.parse(JSON.stringify(expected));
  for (const [label, mutate] of [
    ["Staging database id on the Production list", (x) => { x.forbiddenDatabaseIds[x.d1.id] = "x"; }],
    ["database name not Staging", (x) => { x.d1.name = "framework-portal"; }],
    ["the deprecated-allowlist name removed", (x) => { x.forbiddenNames = x.forbiddenNames.filter((n) => n !== "PORTAL_INVITE_ALLOWED_EMAILS"); }],
    ["switches missing", (x) => { delete x.switches; }],
    ["a switch declared with another value", (x) => { x.switches.PORTAL_ADMIN_WRITES = "true"; }],
    ["an email address", (x) => { x.note = "ask person@example.test"; }],
    ["a credential", (x) => { x.note = "Bearer abcdefghijklmnop"; }],
    ["a non-https base URL", (x) => { x.baseUrl = "http://staging.frameworkco.ca"; }],
    ["a bad database id", (x) => { x.d1.id = "nope"; }],
  ]) { const x = clone(); mutate(x); assert.throws(() => validateExpected(x), /invalid expected configuration/, label); }
  assert.doesNotThrow(() => validateExpected(clone()));
});

test("NO LEAKS: tokens, secret values, commit text, addresses and bookmarks never appear in the markdown or JSON report, even when the API echoes them", async () => {
  const leaky = {
    deployments: () => ok([{ id: DEPLOY, number: 124, created_on: "2026-10-21T11:00:00Z", source: "wrangler", annotations: { "workers/tag": SHA.slice(0, 7), "workers/message": `${SECRET_TEXT} owner@example.test ${FAKE_TOKEN}` } }]),
    deployment: () => ok({ id: DEPLOY, env: { ...goodEnv(), PORTAL_SESSION_PEPPER: { type: "secret_text", text: SECRET_TEXT, value: SECRET_TEXT }, LEAK: { type: "plain_text", text: FAKE_TOKEN } } }),
    verify: () => ok({ id: FAKE_TOKEN, status: "active" }),
    d1: () => ok({ uuid: expected.d1.id, name: expected.d1.name, num_tables: 10, file_size: 1024, running_in_region: "WNAM", note: SECRET_TEXT }),
    previews: () => ok([{ id: PREVIEW, name: "Staging", note: SECRET_TEXT }]),
  };
  const { report } = await run(leaky, { env: { CLOUDFLARE_API_TOKEN: FAKE_TOKEN } });
  const lines = [];
  await main(["--json"], { out: (s) => lines.push(s), run: { fetch: world(leaky).fetch, env: { CLOUDFLARE_API_TOKEN: FAKE_TOKEN }, expected, now: () => NOW } });
  await main([], { out: (s) => lines.push(s), run: { fetch: world(leaky).fetch, env: { CLOUDFLARE_API_TOKEN: FAKE_TOKEN }, expected, now: () => NOW } });
  const everything = formatMarkdown(report) + JSON.stringify(report) + lines.join("\n");
  for (const secret of [FAKE_TOKEN, SECRET_TEXT, "owner@example.test", "someone@example.test", "person@example.test", ACCOUNT, PREVIEW, "ab".repeat(16), "Bearer"]) assert.ok(!everything.includes(secret), "leaked: " + secret.slice(0, 12));
  assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/.test(everything), "no email address anywhere in the output");
  assert.ok(!/\b[A-Za-z0-9_-]{32,}\b/.test(everything), "nothing token-shaped in the output");
});

test("scrub() removes addresses, bearer tokens and long token-like strings", () => {
  assert.equal(scrub("mail a@b.co now"), "mail [email] now");
  assert.equal(scrub("Authorization: Bearer abc.def-ghi"), "Authorization: [redacted]");
  assert.equal(scrub("id " + "x".repeat(40)), "id [redacted]");
  assert.equal(scrub("short words only"), "short words only");
});

/* ------------------------------------------------------------------ the expected file stays in step with the repository */

test("the expected-config file matches wrangler.jsonc (Staging databases, non-secret settings, bindings, rate limiter, R2 bucket) and the forbidden names are absent from it", () => {
  const strip = (t) => t.replace(/^\s*\/\/.*$/gm, "");
  const cfg = JSON.parse(strip(read("wrangler.jsonc")));
  const p = cfg.previews;
  assert.deepEqual([...Object.keys(expected.plainVars), ...Object.entries(expected.switches).filter(([, v]) => v !== null).map(([k]) => k)].sort(), Object.keys(p.vars).sort(), "every Staging variable is expected (plain settings and the declared switches), and nothing else");
  for (const [n, want] of Object.entries(expected.plainVars)) if (want !== null) assert.equal(p.vars[n], want, n);
  const portal = p.d1_databases.find((d) => d.binding === "PORTAL_DB"), site = p.d1_databases.find((d) => d.binding === "DB");
  assert.deepEqual([portal.database_name, portal.database_id], [expected.d1.name, expected.d1.id]);
  assert.deepEqual([site.database_name, site.database_id], [expected.websiteDb.name, expected.websiteDb.id]);
  assert.equal(p.r2_buckets[0].bucket_name, expected.bindings.PORTAL_FILES.bucket_name);
  assert.equal(p.r2_buckets[1].bucket_name, expected.bindings.PORTAL_FILES_BACKUP.bucket_name);
  assert.equal(String(p.ratelimits[0].namespace_id), expected.bindings.PORTAL_RATE_LIMITER.namespace_id);
  const prod = cfg.d1_databases.map((d) => d.database_id);
  assert.deepEqual(Object.keys(expected.forbiddenDatabaseIds).sort(), prod.sort(), "the forbidden ids are exactly Production's databases");
  assert.deepEqual([...Object.keys(expected.bindings)].sort(), ["ASSETS", "DB", "PORTAL_DB", "PORTAL_FILES", "PORTAL_FILES_BACKUP", "PORTAL_RATE_LIMITER"]);
  for (const n of expected.forbiddenNames) assert.ok(!strip(read("wrangler.jsonc")).includes(n), n + " must not be in the configuration");
  for (const [n, want] of Object.entries(expected.switches)) { assert.equal(p.vars[n] === undefined ? null : p.vars[n], want, n + " matches the Staging block"); assert.ok(cfg.vars[n] === undefined || cfg.vars[n] === "1", n + " is at most the launch value \"1\" at the top level (Production)"); }
  assert.equal(expected.worker, cfg.name);
  assert.equal(expected.baseUrl, p.vars.PORTAL_BASE_URL);
  for (const n of expected.secrets.required) assert.ok(!(n in p.vars), n + " is a secret, not a variable");
});

test("the scripts are never published: .assetsignore lists scripts/, and the exposure test requires it", () => {
  assert.ok(read(".assetsignore").split("\n").map((l) => l.trim()).includes("scripts/"));
  assert.match(read("worker/test/assets-exposure.test.mjs"), /"scripts\/"/);
  assert.ok(readdirSync(new URL("../../scripts/ops/", import.meta.url)).includes("staging-health.mjs"));
});

test("the privacy smoke test requests the clean /privacy URL; a page without the client portal section is a WARN", async () => {
  const { w } = await run();
  assert.ok(w.calls.some((c) => c.host === "staging.frameworkco.ca" && c.path === "/privacy"));
  assert.ok(!w.calls.some((c) => c.path === "/privacy.html"));
  const r = by((await run({ privacy: () => new Response("<h2>Other</h2>", { status: 200 }) })).report);
  assert.equal(r["smoke.privacy"].status, "WARN");
});
