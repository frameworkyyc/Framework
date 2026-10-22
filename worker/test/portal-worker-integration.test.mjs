// The real Worker entry point (worker/index.js) with the portal wired in but NOT enabled. Production must answer a safe 404 on every
// /portal path; every other route keeps behaving as before. Uses a fake ASSETS binding; nothing touches a network or database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../index.js";

const PROD = "https://frameworkco.ca";
const STAGING = "https://staging.frameworkco.ca";
const T0 = new Date("2026-10-20T12:00:00Z");

function makeEnv(extra = {}) {
  const assetCalls = [];
  return { env: { ASSETS: { fetch: async (req) => { assetCalls.push(new URL(req.url).pathname); return new Response("ASSET", { status: 200 }); } }, ...extra }, assetCalls };
}
const call = (env, url, init) => worker.fetch(new Request(url, init), env);
const PEPPER = "Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0";
const stagingEnv = (over = {}) => ({
  PORTAL_BASE_URL: STAGING, PORTAL_AUTH_CLIENT_ID: "client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE",
  PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_SESSION_PEPPER: PEPPER,
  PORTAL_DB: { prepare() { throw new Error("db must not be touched"); }, batch() { throw new Error("db must not be touched"); } }, ...over,
});

const PORTAL_PATHS = [
  "/portal", "/portal/", "/portal/login", "/portal/login?start=1", "/portal/auth/callback?code=abc&state=def", "/portal/logout", "/portal/no-access",
  "/portal/o/acme", "/portal/o/acme/projects", "/portal/o/acme/projects/00000000-0000-4000-8000-000000000000", "/portal/o/acme/members", "/portal/anything/else", "/portal/x/../y", "/portal//double",
];
function assertSafe404(res, label) {
  assert.equal(res.status, 404, label);
  assert.equal(res.headers.get("Cache-Control"), "no-store", label);
  assert.match(res.headers.get("X-Robots-Tag"), /noindex/);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(res.headers.get("Strict-Transport-Security"), null, "a disabled portal must not set HSTS on the live site");
  assert.equal(res.headers.get("Set-Cookie"), null, "no cookies");
  assert.equal(res.headers.get("Location"), null, "no redirects");
  assert.match(res.headers.get("Content-Type"), /^text\/plain/);
}

test("PRODUCTION (no portal settings at all): every /portal path is a safe 404 that never reaches the static site", async () => {
  for (const host of [PROD, "https://www.frameworkco.ca"]) for (const method of ["GET", "HEAD", "POST", "PUT", "DELETE"]) for (const p of PORTAL_PATHS) {
    const { env, assetCalls } = makeEnv({ ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", TURNSTILE_SITE_KEY: "0x4AAAAAAFZzTbJqfnTzJNss" });
    const res = await call(env, host + p, { method, body: method === "POST" || method === "PUT" ? "x" : undefined });
    assertSafe404(res, `${method} ${host}${p}`);
    assert.equal(assetCalls.length, 0, "the static site was not consulted");
    if (method !== "HEAD") assert.equal(await res.text(), "Not found");
  }
});
test("PRODUCTION: a callback with real-looking parameters and a session cookie is just a 404 (nothing is read, set or echoed)", async () => {
  const { env } = makeEnv();
  const res = await call(env, PROD + "/portal/auth/callback?code=SECRETCODE123&state=SECRETSTATE456", { headers: { Cookie: "__Host-fw_portal=" + "A".repeat(43), Referer: "https://auth.example/?client_redirect_key=SECRETKEY" } });
  assertSafe404(res, "callback");
  const body = await res.text();
  assert.ok(!/SECRET/.test(body + [...res.headers].join()));
});
test("every way of leaving the portal switched off gives the same 404, even on the Staging host with all settings present", async () => {
  for (const enabled of [undefined, "", "0", "true", "yes", " 1 x", "11", 1, true, null]) {
    const { env, assetCalls } = makeEnv(stagingEnv({ PORTAL_ENABLED: enabled }));
    for (const p of ["/portal", "/portal/login", "/portal/auth/callback?code=a&state=b", "/portal/o/acme"]) {
      assertSafe404(await call(env, STAGING + p), `${String(enabled)} ${p}`);
    }
    assert.equal(assetCalls.length, 0);
  }
});
test("a Staging-shaped environment WITHOUT PORTAL_ENABLED is inaccessible and never touches the database", async () => {
  const { env } = makeEnv(stagingEnv());
  for (const p of PORTAL_PATHS) assertSafe404(await call(env, STAGING + p), p);
});
test("when later enabled, other hosts (preview URLs, www, a look-alike) still get the 404, and only the portal host is served", async () => {
  const { env } = makeEnv(stagingEnv({ PORTAL_ENABLED: "1" }));
  for (const host of ["https://framework.example.workers.dev", "https://www.frameworkco.ca", PROD, "https://staging.frameworkco.ca.evil.test", "http://staging.frameworkco.ca:8080"]) {
    assertSafe404(await call(env, host + "/portal/login"), host);
  }
  const ok = await call(env, STAGING + "/portal/login");
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Sign in/);
});
test("enabled but misconfigured: a generic 503 for /portal only, naming no setting; the rest of the site is unaffected", async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const { env, assetCalls } = makeEnv(stagingEnv({ PORTAL_ENABLED: "1", PORTAL_SESSION_PEPPER: "short-but-secret-looking-value" }));
    const res = await call(env, STAGING + "/portal/login");
    assert.equal(res.status, 503);
    const body = await res.text();
    assert.ok(!/PEPPER|pepper|short-but-secret|PORTAL_/.test(body));
    assert.equal((await call(env, STAGING + "/about.html")).status, 200);
    assert.deepEqual(assetCalls, ["/about.html"]);
    const log = lines.join("\n");
    assert.match(log, /"reason":"portal_session_pepper_too_short"/, "the failing setting is identifiable from the log by name");
    assert.ok(!log.includes("short-but-secret-looking-value"), "its value never is");
  } finally { console.log = orig; }
});
test("look-alike paths never reach the portal (they are ordinary static requests, as before)", async () => {
  for (const p of ["/portal.html", "/portalx", "/Portal/login", "/portal%2Flogin", "/portals"]) {
    const { env, assetCalls } = makeEnv(stagingEnv({ PORTAL_ENABLED: "1" }));
    const res = await call(env, STAGING + p);
    assert.equal(await res.text(), "ASSET", p);
    assert.equal(assetCalls.length, 1, p);
  }
  for (const p of ["/api/portal", "/admin/portal"]) {
    const { env } = makeEnv(stagingEnv({ PORTAL_ENABLED: "1" }));
    const res = await call(env, STAGING + p);
    assert.notEqual(await res.text(), "Not found", p + " is handled by its own router, not the portal 404");
  }
});

/* ------------------------------------------------------------------ nothing else changed */
test("static pages still come from the assets binding", async () => {
  for (const p of ["/", "/about.html", "/assets/css/styles.css", "/privacy.html"]) {
    const { env, assetCalls } = makeEnv();
    const res = await call(env, PROD + p);
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "ASSET");
    assert.deepEqual(assetCalls, [p]);
  }
});
test("public APIs still answer as before (assessment config, feedback method guard, client revenue fail-closed)", async () => {
  const { env } = makeEnv();
  const cfg = await call(env, PROD + "/api/assessment/config");
  assert.equal(cfg.status, 200);
  assert.equal((await call(env, PROD + "/api/assessment", { method: "GET" })).status, 405);
  const rev = await call(env, PROD + "/api/client-revenue");
  assert.equal(rev.status, 200);
  assert.deepEqual(await rev.json(), { total: null, value: null });
});
test("the admin area still denies everything without a valid Cloudflare Access token", async () => {
  const { env, assetCalls } = makeEnv();
  for (const p of ["/admin", "/admin/", "/admin/app.js", "/api/admin/me"]) {
    const res = await call(env, PROD + p);
    assert.ok([401, 403, 404, 503].includes(res.status), `${p} -> ${res.status}`);
    assert.notEqual(res.status, 200);
  }
  assert.equal(assetCalls.length, 0, "no admin file is served without authentication");
});
test("the digital business card route is still handled by its own module", async () => {
  const { env } = makeEnv();
  env.ASSETS.fetch = async () => new Response('<html><head><link rel="canonical" href="https://frameworkco.ca/card"></head></html>', { status: 200, headers: { "Content-Type": "text/html" } });
  const res = await call(env, STAGING + "/card");
  assert.equal(res.status, 200);
  assert.match(await res.text(), /staging\.frameworkco\.ca\/card/, "link-preview URLs follow the host, as before");
  const prod = await call(env, PROD + "/card");
  assert.equal(prod.status, 200);
  assert.ok(!/noindex/.test(prod.headers.get("X-Robots-Tag") || ""), "production card unchanged");
});

/* ------------------------------------------------------------------ the real wrangler.jsonc, as each environment would receive it */
const wrangler = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
// Production's settings WITHOUT the launch switches: the fail-closed tests below start from "the portal is off" and add flags one at a time.
const { PORTAL_ENABLED: _pe, PORTAL_ALLOW_PRODUCTION: _pa, PORTAL_ADMIN_WRITES: _pw, PORTAL_INVITE_SENDING: _ps, ...OFF_VARS } = wrangler.vars;
const FAKE_SECRETS = { PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE", PORTAL_SESSION_PEPPER: PEPPER };
const NO_DB = { prepare() { throw new Error("db must not be touched"); }, batch() { throw new Error("db must not be touched"); } };

test("PRODUCTION without the launch switches (the configuration before launch, even with the secrets present): every /portal path is a safe 404", async () => {
  const { env, assetCalls } = makeEnv({ ...OFF_VARS, ...FAKE_SECRETS, PORTAL_DB: NO_DB });
  assert.equal(env.PORTAL_ENABLED, undefined);
  for (const host of [PROD, "https://www.frameworkco.ca"]) for (const p of PORTAL_PATHS) assertSafe404(await call(env, host + p), host + p);
  assert.equal(assetCalls.length, 0);
});
test("STAGING as the config really defines it (previews.vars + secrets + PORTAL_DB): the portal is on, only for the Staging host", async () => {
  const { env } = makeEnv({ ...wrangler.previews.vars, ...FAKE_SECRETS, PORTAL_DB: NO_DB });
  assert.equal(env.PORTAL_ENABLED, "1");
  const login = await call(env, STAGING + "/portal/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Sign in/);
  assert.equal(login.headers.get("Cache-Control"), "no-store");
  const start = await call(env, STAGING + "/portal/login?start=1");
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("Location"));
  assert.equal(to.origin + to.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(to.searchParams.get("client_id"), wrangler.previews.vars.PORTAL_AUTH_CLIENT_ID);
  assert.equal(to.searchParams.get("redirect_uri"), STAGING + "/portal/auth/callback");
  assert.ok(!start.headers.get("Location").includes("FAKE"), "the API key never appears in the redirect");
  for (const host of [PROD, "https://www.frameworkco.ca", "https://framework.example.workers.dev"]) assertSafe404(await call(env, host + "/portal/login"), host);
  assert.equal((await call(env, STAGING + "/portal/o/anything")).status, 303, "unauthenticated organization routes go to sign-in");
});
test("without the secrets the Staging configuration fails closed (503), never half-works", async () => {
  const { env } = makeEnv({ ...wrangler.previews.vars, PORTAL_DB: NO_DB });
  assert.equal((await call(env, STAGING + "/portal/login")).status, 503);
});

test("STAGING rate limiter via the real wrangler config: the binding the config declares is the one the code uses, and a limited request does no database or WorkOS work", async () => {
  const name = wrangler.previews.ratelimits[0].name;
  assert.equal(name, "PORTAL_RATE_LIMITER");
  const seen = [];
  const db = { prepare() { seen.push("db"); throw new Error("db touched"); }, batch() { seen.push("db"); throw new Error("db touched"); } };
  const { env } = makeEnv({ ...wrangler.previews.vars, ...FAKE_SECRETS, PORTAL_DB: db, [name]: { limit: async ({ key }) => { seen.push(key); return { success: false }; } } });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { seen.push("workos"); throw new Error("network touched"); };
  try {
    for (const [path, init] of [["/portal/login?start=1", {}], ["/portal/auth/callback?code=abc&state=def", {}], ["/portal/logout", { method: "POST", body: "csrf=x", headers: { "Content-Type": "application/x-www-form-urlencoded" } }]]) {
      const res = await call(env, STAGING + path, { ...init, headers: { "CF-Connecting-IP": "2001:db8:1:2::1", ...(init.headers || {}) } });
      assert.equal(res.status, 429, path);
      assert.equal(res.headers.get("Retry-After"), "60");
      assert.equal(res.headers.get("Cache-Control"), "no-store");
    }
  } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.length, 3, "only the three limiter calls happened");
  assert.ok(seen.every((k) => /^(login|callback|logout):[0-9a-f]{32}$/.test(k)));
});
test("PRODUCTION (top-level config) declares its own limiter binding but, with the portal off, never reaches it: every /portal path stays the safe 404", async () => {
  assert.deepEqual(wrangler.ratelimits, [{ name: "PORTAL_RATE_LIMITER", namespace_id: "4201", simple: { limit: 20, period: 60 } }]);
  let called = false;
  const { env } = makeEnv({ ...OFF_VARS, ...FAKE_SECRETS, PORTAL_DB: NO_DB, PORTAL_RATE_LIMITER: { limit: async () => { called = true; return { success: false }; } } });
  for (const p of ["/portal/login?start=1", "/portal/auth/callback?code=a&state=b"]) assertSafe404(await call(env, PROD + p, { headers: { "CF-Connecting-IP": "203.0.113.7" } }), p);
  assert.equal(called, false);
});

/* ---------------------------------------------------------------- Production launch readiness: the config as it really is + each flag combination */
const PROD_CLIENT = "client_01M58C4236FYNJDQ3MM0E8V691";
const prodEnv = (extra = {}, { secrets = true } = {}) => makeEnv({ ...OFF_VARS, ...(secrets ? FAKE_SECRETS : {}), PORTAL_DB: NO_DB, ...extra });
const seenCalls = () => { const calls = []; return { calls, db: { prepare() { calls.push("db"); throw new Error("db touched"); }, batch() { calls.push("db"); throw new Error("db touched"); } } }; };

test("PRODUCTION fails closed in every flag combination that is not the complete launch configuration", async () => {
  // only the launch flag (the production override is missing): enabled but unusable -> generic 503, no database or WorkOS work, no redirect
  const { calls, db } = seenCalls();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { calls.push("network"); throw new Error("network touched"); };
  try {
    const a = prodEnv({ PORTAL_ENABLED: "1", PORTAL_DB: db }).env;
    for (const host of [PROD, "https://www.frameworkco.ca"]) for (const p of ["/portal", "/portal/login", "/portal/login?start=1", "/portal/o/acme"]) {
      const res = await call(a, host + p);
      assert.equal(res.status, 503, host + p); // enabled-but-unusable answers a generic 503 on any host (the check runs before the host check)
      assert.equal(res.headers.get("Location"), null);
      assert.equal(res.headers.get("Set-Cookie"), null);
      assert.doesNotMatch(await res.text(), /production_host_not_approved|client_01|b213b7db|sk_/);
    }
    // only the production override (the launch flag is missing): the portal does not exist
    assertSafe404(await call(prodEnv({ PORTAL_ALLOW_PRODUCTION: "1", PORTAL_DB: db }).env, PROD + "/portal/login"), "override without launch flag");
    // any value other than exactly "1" is off, for both flags
    for (const v of ["0", "true", "yes", "", " 2 ", "ON"]) assertSafe404(await call(prodEnv({ PORTAL_ENABLED: v, PORTAL_ALLOW_PRODUCTION: "1", PORTAL_DB: db }).env, PROD + "/portal/login"), "ENABLED=" + JSON.stringify(v));
    for (const v of ["0", "true", "yes", "", "ON"]) assert.equal((await call(prodEnv({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: v, PORTAL_DB: db }).env, PROD + "/portal/login")).status, 503, "ALLOW=" + JSON.stringify(v));
    // both flags but a secret is missing, or the pepper is weak: 503, never half-working
    for (const missing of ["PORTAL_AUTH_CLIENT_SECRET", "PORTAL_SESSION_PEPPER"]) {
      const { env } = prodEnv({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1", PORTAL_DB: db, [missing]: undefined });
      assert.equal((await call(env, PROD + "/portal/login")).status, 503, missing);
    }
    assert.equal((await call(prodEnv({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1", PORTAL_SESSION_PEPPER: "short", PORTAL_DB: db }).env, PROD + "/portal/login")).status, 503);
    // both flags but the database binding is missing
    assert.equal((await call(makeEnv({ ...OFF_VARS, ...FAKE_SECRETS, PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1" }).env, PROD + "/portal/login")).status, 503);
  } finally { globalThis.fetch = realFetch; }
  assert.deepEqual(calls, [], "none of the failed-closed requests touched the database or the network");
});
test("PRODUCTION with the complete launch configuration (both flags + secrets + PORTAL_DB) works on the canonical host only, with the Production WorkOS client and exact URLs", async () => {
  const { env } = prodEnv({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1" });
  const login = await call(env, PROD + "/portal/login");
  assert.equal(login.status, 200);
  assert.equal(login.headers.get("Cache-Control"), "no-store");
  assert.equal(login.headers.get("Strict-Transport-Security"), "max-age=31536000");
  const start = await call(env, PROD + "/portal/login?start=1");
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get("Location"));
  assert.equal(to.origin + to.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(to.searchParams.get("client_id"), PROD_CLIENT);
  assert.notEqual(to.searchParams.get("client_id"), wrangler.previews.vars.PORTAL_AUTH_CLIENT_ID, "never the Staging client");
  assert.equal(to.searchParams.get("redirect_uri"), "https://frameworkco.ca/portal/auth/callback", "must equal the redirect URI registered in WorkOS Production");
  assert.ok(!start.headers.get("Location").includes("FAKE"));
  const setCookie = start.headers.get("Set-Cookie");
  assert.match(setCookie, /^__Host-fw_auth=/);
  assert.match(setCookie, /; Path=\/; /); assert.match(setCookie, /; HttpOnly/); assert.match(setCookie, /; Secure/); assert.match(setCookie, /; SameSite=Lax/);
  assert.ok(!/Domain=/i.test(setCookie), "host-only cookie");
  for (const host of ["https://www.frameworkco.ca", STAGING, "https://framework.example.workers.dev", "http://frameworkco.ca"]) assertSafe404(await call(env, host + "/portal/login"), host);
  assert.equal((await call(env, PROD + "/portal/o/anything")).status, 303, "unauthenticated organization routes go to sign-in");
  assert.equal(new URL((await call(env, PROD + "/portal/o/anything")).headers.get("Location"), PROD).pathname, "/portal/login");
});
test("PRODUCTION config matches what is registered in WorkOS Production (client id, issuer pattern, base URL, callback / login / logout URLs)", () => {
  const v = wrangler.vars;
  assert.equal(v.PORTAL_AUTH_CLIENT_ID, PROD_CLIENT);
  assert.equal(v.PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + PROD_CLIENT);
  assert.equal(v.PORTAL_BASE_URL, "https://frameworkco.ca");
  const REGISTERED = { redirect: "https://frameworkco.ca/portal/auth/callback", login: "https://frameworkco.ca/portal/login", logout: "https://frameworkco.ca/portal/login" };
  assert.equal(v.PORTAL_BASE_URL + "/portal/auth/callback", REGISTERED.redirect);
  assert.equal(v.PORTAL_BASE_URL + "/portal/login", REGISTERED.login);
  assert.equal(v.PORTAL_BASE_URL + "/portal/login", REGISTERED.logout);
  assert.notEqual(v.PORTAL_AUTH_CLIENT_ID, wrangler.previews.vars.PORTAL_AUTH_CLIENT_ID);
  assert.notEqual(v.PORTAL_AUTH_ISSUER, wrangler.previews.vars.PORTAL_AUTH_ISSUER);
});

test("PRODUCTION as the config really defines it NOW (the launch configuration): exactly the four launch switches, the portal answers on the canonical host only, and Staging-only settings are absent", async () => {
  assert.equal(wrangler.vars.PORTAL_ENABLED, "1");
  assert.equal(wrangler.vars.PORTAL_ALLOW_PRODUCTION, "1");
  assert.equal(wrangler.vars.PORTAL_ADMIN_WRITES, "1");
  assert.equal(wrangler.vars.PORTAL_INVITE_SENDING, "1");
  for (const never of ["PORTAL_DEMO", "PORTAL_INVITE_ALLOWLIST", "PORTAL_INVITE_ALLOWED_EMAILS", "ACCESS_JWKS_JSON", "PORTAL_AUTH_CLIENT_SECRET", "PORTAL_SESSION_PEPPER"]) assert.equal(wrangler.vars[never], undefined, never + " is never a Production variable");
  const { env } = makeEnv({ ...wrangler.vars, ...FAKE_SECRETS, PORTAL_DB: NO_DB });
  const login = await call(env, PROD + "/portal/login");
  assert.equal(login.status, 200);
  for (const host of ["https://www.frameworkco.ca", "https://framework.example.workers.dev"]) assertSafe404(await call(env, host + "/portal/login"), host);
});
