// The real Worker entry point (worker/index.js) with the portal wired in but NOT enabled. Production must answer a safe 404 on every
// /portal path; every other route keeps behaving as before. Uses a fake ASSETS binding; nothing touches a network or database.
import test from "node:test";
import assert from "node:assert/strict";
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
test("STAGING as configured today (settings present, PORTAL_ENABLED absent): inaccessible, database untouched", async () => {
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
