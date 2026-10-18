// Client portal Phase 0 sign-in probe: behaviour, security and "stays inert / stays out of the way" tests.
// WorkOS is mocked (including a real RSA signing key), so nothing here touches the network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePortalProbe, probeConfig, PROBE_PATHS } from "../portal/probe.js";
import { verifyRs256, decodeJwt } from "../portal/jwt.js";
import worker from "../index.js";

const BASE = "https://staging.frameworkco.ca";
const CLIENT_ID = "client_TESTCLIENT123";
const API_KEY = "sk_test_THIS_IS_A_FAKE_KEY_FOR_TESTS";
const PEPPER = "pepper-for-tests-only-0123456789";
const env = (over = {}) => ({ PORTAL_PROBE: "1", PORTAL_BASE_URL: BASE, PORTAL_AUTH_CLIENT_ID: CLIENT_ID, PORTAL_AUTH_CLIENT_SECRET: API_KEY, PORTAL_SESSION_PEPPER: PEPPER, PORTAL_AUTH_ISSUER: "https://api.workos.com", ...over });
const NOW = new Date("2026-10-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);

const b64url = (buf) => Buffer.from(buf).toString("base64url");
async function makeKey(kid = "key1") {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: "RS256", use: "sig" } };
}
async function signJwt(key, payload, header = {}) {
  const h = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: key.kid, ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key.privateKey, new TextEncoder().encode(h + "." + p));
  return `${h}.${p}.${b64url(sig)}`;
}
const goodClaims = (over = {}) => ({ iss: "https://api.workos.com/user_management/" + CLIENT_ID, sub: "user_01HXYZABCDEF", sid: "session_01ABC", client_id: CLIENT_ID, iat: nowSec - 10, exp: nowSec + 290, jti: "j1", ...over });

/** A fake api.workos.com. `calls` records every request so tests can assert what was (not) sent. */
function fakeWorkOS({ key, accessToken, user, exchangeStatus = 200, exchangeBody, discovery = "ok", jwks = "ok", down = false }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (down) throw new Error("network down");
    const u = new URL(url);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.pathname === "/user_management/authenticate") {
      if (exchangeStatus !== 200) return json(exchangeStatus, exchangeBody || { code: "invalid_grant", message: "SECRET-UPSTREAM-TEXT" });
      return json(200, exchangeBody || { user: user || { id: "user_01HXYZABCDEF", email: "tester@example.com", email_verified: true }, access_token: accessToken, refresh_token: "REFRESH-TOKEN-VALUE", authentication_method: "MagicAuth" });
    }
    if (u.pathname.endsWith("/.well-known/openid-configuration")) return discovery === "ok" ? json(200, { issuer: "https://api.workos.com/user_management/" + CLIENT_ID, jwks_uri: "https://api.workos.com/sso/jwks/" + CLIENT_ID }) : json(404, {});
    if (u.pathname.startsWith("/sso/jwks/")) return jwks === "ok" ? json(200, { keys: [key.jwk] }) : json(500, {});
    return json(404, {});
  };
  fetch.calls = calls;
  return fetch;
}

const unescape = (h) => h.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const reportOf = async (res) => unescape(await res.text());

const req = (path, { method = "GET", headers = {}, base = BASE } = {}) => new Request(base + path, { method, headers });
const cookiesOf = (res) => res.headers.getSetCookie();
const cookieHeader = (res, name) => {
  const line = cookiesOf(res).find((c) => c.startsWith(name + "="));
  return line ? line.split(";")[0] : "";
};

/** Run /portal/login?start=1 and return the pieces the callback needs. */
async function startLogin(e = env(), query = "") {
  const res = await handlePortalProbe(req("/portal/login?start=1" + query), e, { now: NOW });
  const loc = new URL(res.headers.get("Location"));
  return { res, loc, state: loc.searchParams.get("state"), cookie: cookieHeader(res, "__Host-fw_probe") };
}
const callback = (e, fetchImpl, { state, cookie, code = "auth-code-123", extra = "" } = {}) =>
  handlePortalProbe(req(`/portal/auth/callback?code=${code}&state=${state}${extra}`, { headers: cookie ? { Cookie: cookie } : {} }), e, { fetch: fetchImpl, now: NOW });

/* ------------------------------------------------------------------ inert unless fully configured */

test("probe is OFF (returns null so the static site answers) unless PORTAL_PROBE is exactly 1", async () => {
  for (const over of [{ PORTAL_PROBE: undefined }, { PORTAL_PROBE: "0" }, { PORTAL_PROBE: "true" }, { PORTAL_PROBE: "" }]) {
    for (const p of PROBE_PATHS) assert.equal(await handlePortalProbe(req(p), env(over)), null, p + " " + JSON.stringify(over));
  }
});

test("probe is OFF when any required setting is missing or the base URL is not https", async () => {
  for (const over of [{ PORTAL_AUTH_CLIENT_ID: "" }, { PORTAL_AUTH_CLIENT_SECRET: "" }, { PORTAL_SESSION_PEPPER: "" }, { PORTAL_BASE_URL: "" }, { PORTAL_BASE_URL: "http://staging.frameworkco.ca" }, { PORTAL_BASE_URL: "not a url" }]) {
    assert.equal(probeConfig(env(over)), null, JSON.stringify(Object.keys(over)));
    assert.equal(await handlePortalProbe(req("/portal/login"), env(over)), null);
  }
});

test("probe only answers on the PORTAL_BASE_URL host (the public preview URL and Production host fall through)", async () => {
  for (const base of ["https://frameworkco.ca", "https://www.frameworkco.ca", "https://framework-preview.example.workers.dev", "https://staging.frameworkco.ca.evil.test"]) {
    for (const p of PROBE_PATHS) assert.equal(await handlePortalProbe(req(p, { base }), env()), null, base + p);
  }
});

test("Production-shaped environment (no portal settings at all): the Worker hands /portal/* straight to the static assets", async () => {
  const seen = [];
  const prod = { ASSETS: { fetch: async (r) => (seen.push(new URL(r.url).pathname), new Response("static-404", { status: 404 })) } };
  for (const p of PROBE_PATHS) {
    const res = await worker.fetch(new Request("https://frameworkco.ca" + p), prod);
    assert.equal(res.status, 404);
    assert.equal(await res.text(), "static-404");
  }
  assert.deepEqual(seen, PROBE_PATHS);
});

/* ------------------------------------------------------------------ login start */

test("login page: shows one Continue button and does not redirect (so logout returns do not silently sign back in)", async () => {
  const res = await handlePortalProbe(req("/portal/login"), env(), { now: NOW });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /href="\/portal\/login\?start=1"/);
  assert.equal(res.headers.get("Location"), null);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
  assert.match(res.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.ok(!/<script/i.test(html));
});

test("start: redirects to the WorkOS authorize endpoint with the exact redirect URI, state and S256 PKCE", async () => {
  const { res, loc, state, cookie } = await startLogin();
  assert.equal(res.status, 302);
  assert.equal(loc.origin + loc.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(loc.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(loc.searchParams.get("redirect_uri"), BASE + "/portal/auth/callback");
  assert.equal(loc.searchParams.get("response_type"), "code");
  assert.equal(loc.searchParams.get("provider"), "authkit");
  assert.equal(loc.searchParams.get("code_challenge_method"), "S256");
  assert.ok(state.length >= 43);
  const payload = JSON.parse(Buffer.from(cookie.split("=")[1].split(".")[0], "base64url").toString());
  const expected = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload.v))).toString("base64url");
  assert.equal(loc.searchParams.get("code_challenge"), expected);
  assert.equal(payload.s, state);
  assert.ok(!res.headers.get("Location").includes(API_KEY) && !res.headers.get("Location").includes(PEPPER));
});

test("state cookie: __Host- prefix, HttpOnly, Secure, SameSite=Lax, Path=/, 10 minutes, no Domain", async () => {
  const { res } = await startLogin();
  const line = cookiesOf(res).find((c) => c.startsWith("__Host-fw_probe="));
  assert.match(line, /; Path=\//);
  assert.match(line, /; HttpOnly/);
  assert.match(line, /; Secure/);
  assert.match(line, /; SameSite=Lax/);
  assert.match(line, /; Max-Age=600/);
  assert.ok(!/Domain=/i.test(line));
});

test("every start uses a fresh state and verifier", async () => {
  const a = await startLogin();
  const b = await startLogin();
  assert.notEqual(a.state, b.state);
  assert.notEqual(a.cookie, b.cookie);
});

test("only well-formed login_hint and invitation_token are forwarded; everything else is dropped", async () => {
  const good = await startLogin(env(), "&login_hint=sentbyjj%40gmail.com&invitation_token=invitation_abcdefgh123");
  assert.equal(good.loc.searchParams.get("login_hint"), "sentbyjj@gmail.com");
  assert.equal(good.loc.searchParams.get("invitation_token"), "invitation_abcdefgh123");
  const bad = await startLogin(env(), "&login_hint=%3Cscript%3E&invitation_token=a%20b%22%3E&redirect_uri=https%3A%2F%2Fevil.test&organization_id=org_1&return_to=%2F%2Fevil");
  for (const name of ["login_hint", "invitation_token", "organization_id", "return_to"]) assert.equal(bad.loc.searchParams.get(name), null, name);
  assert.equal(bad.loc.searchParams.get("redirect_uri"), BASE + "/portal/auth/callback", "the redirect URI can never be influenced by the request");
});

/* ------------------------------------------------------------------ callback: rejections happen BEFORE any WorkOS call */

test("callback rejects missing, tampered, wrong-state and expired attempts without contacting WorkOS", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const cases = {
    "no cookie": { state: started.state, cookie: "" },
    "wrong state": { state: "x".repeat(43), cookie: started.cookie },
    "tampered cookie": { state: started.state, cookie: started.cookie.slice(0, -3) + "AAA" },
    "garbage cookie": { state: started.state, cookie: "__Host-fw_probe=not-a-cookie" },
  };
  for (const [name, c] of Object.entries(cases)) {
    const f = fakeWorkOS({ key, accessToken: "unused" });
    const res = await callback(env(), f, c);
    assert.equal(res.status, 400, name);
    assert.equal(f.calls.length, 0, name + ": WorkOS must not be called");
    assert.ok(cookiesOf(res).some((x) => x.startsWith("__Host-fw_probe=;") && /Max-Age=0/.test(x)), name + ": state cookie cleared");
  }
  const later = new Date(NOW.getTime() + 11 * 60 * 1000);
  const f2 = fakeWorkOS({ key, accessToken: "unused" });
  const expired = await handlePortalProbe(req(`/portal/auth/callback?code=c1&state=${started.state}`, { headers: { Cookie: started.cookie } }), env(), { fetch: f2, now: later });
  assert.equal(expired.status, 400);
  assert.equal(f2.calls.length, 0);
});

test("an unsolicited callback (no cookie) reports which parameter NAMES arrived, never their values", async () => {
  const f = fakeWorkOS({ key: await makeKey(), accessToken: "unused" });
  const res = await handlePortalProbe(req("/portal/auth/callback?code=SECRET-CODE-VALUE&state=abc&invitation_token=SECRET-INVITE"), env(), { fetch: f, now: NOW });
  const html = await res.text();
  assert.equal(res.status, 400);
  assert.match(html, /Parameters received: code, state, invitation_token/);
  assert.ok(!html.includes("SECRET-CODE-VALUE") && !html.includes("SECRET-INVITE"));
  assert.equal(f.calls.length, 0);
});

test("a cookie signed with a different pepper is rejected (cross-environment cookies do not work)", async () => {
  const key = await makeKey();
  const other = await startLogin(env({ PORTAL_SESSION_PEPPER: "a-completely-different-pepper-value" }));
  const f = fakeWorkOS({ key, accessToken: "unused" });
  const res = await callback(env(), f, { state: other.state, cookie: other.cookie });
  assert.equal(res.status, 400);
  assert.equal(f.calls.length, 0);
});

test("callback: an error from WorkOS is shown only as a sanitised code, and the exchange is not attempted", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const f = fakeWorkOS({ key, accessToken: "unused" });
  const res = await callback(env(), f, { ...started, extra: "&error=access_denied&error_description=%3Cscript%3Ealert(1)%3C/script%3E" });
  const html = await res.text();
  assert.equal(res.status, 400);
  assert.match(html, /access_denied/);
  assert.ok(!html.includes("<script>alert"));
  assert.equal(f.calls.length, 0);
});

test("callback rejects malformed codes without contacting WorkOS", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const f = fakeWorkOS({ key, accessToken: "unused" });
  const res = await callback(env(), f, { ...started, code: "bad%20code%22%3E" });
  assert.equal(res.status, 400);
  assert.equal(f.calls.length, 0);
});

test("the callback is single use: a replay without the (cleared) cookie fails", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const token = await signJwt(key, goodClaims());
  const f = fakeWorkOS({ key, accessToken: token });
  const first = await callback(env(), f, started);
  assert.equal(first.status, 200);
  const cleared = cookiesOf(first).find((c) => c.startsWith("__Host-fw_probe=;"));
  assert.ok(cleared && /Max-Age=0/.test(cleared));
  const replay = await callback(env(), f, { state: started.state, cookie: "" });
  assert.equal(replay.status, 400);
});

/* ------------------------------------------------------------------ callback: success path and the report */

test("success: exchanges the code with the PKCE verifier, verifies the token, and renders a masked report", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const token = await signJwt(key, goodClaims());
  const f = fakeWorkOS({ key, accessToken: token });
  const res = await callback(env(), f, started);
  const html = await reportOf(res);
  assert.equal(res.status, 200);

  const exchange = f.calls.find((c) => c.url === "https://api.workos.com/user_management/authenticate");
  const sent = JSON.parse(exchange.init.body);
  assert.equal(exchange.init.method, "POST");
  assert.equal(sent.grant_type, "authorization_code");
  assert.equal(sent.client_id, CLIENT_ID);
  assert.equal(sent.client_secret, API_KEY, "the API key goes to WorkOS server-side only");
  assert.equal(sent.code, "auth-code-123");
  const verifier = JSON.parse(Buffer.from(started.cookie.split("=")[1].split(".")[0], "base64url").toString()).v;
  assert.equal(sent.code_verifier, verifier);

  assert.match(html, /token signature verified/);
  assert.match(html, /"signature_valid": true/);
  assert.match(html, /t\*\*\*@example\.com/);
  assert.ok(!html.includes("tester@example.com"));
  assert.match(html, /user_01H…/);
  assert.ok(!html.includes("user_01HXYZABCDEF"));
  assert.match(html, /"iss_equals_discovery_issuer": true/);
  assert.match(html, /"iss_equals_PORTAL_AUTH_ISSUER": false/, "the configured issuer is only compared, never trusted");
  assert.match(html, /"client_id_claim_matches": true/);
  assert.match(html, /"lifetime_seconds": 300/);
  assert.match(html, /"sid_present": true/);
  assert.match(html, /MagicAuth/);
  assert.match(html, /no portal session created/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.equal(res.headers.get("Referrer-Policy"), "no-referrer");
});

test("the report and every response never contain tokens, the refresh token, the code, the API key, the pepper or the session id", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const token = await signJwt(key, goodClaims());
  const f = fakeWorkOS({ key, accessToken: token });
  const res = await callback(env(), f, started);
  const everything = (await res.text()) + [...res.headers].map(([k, v]) => k + ": " + v).join("\n");
  for (const secret of [token, token.split(".")[2], "REFRESH-TOKEN-VALUE", "auth-code-123", API_KEY, PEPPER, "session_01ABC", started.state]) assert.ok(!everything.includes(secret), "leaked: " + secret.slice(0, 12));
  const sidCookie = cookiesOf(res).find((c) => c.startsWith("__Host-fw_probe_sid="));
  assert.ok(sidCookie && /HttpOnly/.test(sidCookie) && /Secure/.test(sidCookie) && /SameSite=Lax/.test(sidCookie) && /Max-Age=1800/.test(sidCookie));
});

test("discovery failing falls back to the documented JWKS URL and says so", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const f = fakeWorkOS({ key, accessToken: await signJwt(key, goodClaims()), discovery: "down" });
  const html = await reportOf(await callback(env(), f, started));
  assert.match(html, /"discovery_ok": false/);
  assert.match(html, /api\.workos\.com\/sso\/jwks/);
  assert.match(html, /"signature_valid": true/);
});

test("token problems are reported as NOT verified: bad signature, wrong alg, HMAC confusion, expired, unknown kid, no keys", async () => {
  const key = await makeKey();
  const other = await makeKey("key1"); // same kid, different key
  const cases = {
    "bad signature": { token: await signJwt(other, goodClaims()), reason: "bad_signature" },
    "alg none": { token: ["eyJhbGciOiJub25lIiwia2lkIjoia2V5MSJ9", Buffer.from(JSON.stringify(goodClaims())).toString("base64url"), "AAAA"].join("."), reason: "bad_alg" },
    "alg HS256": { token: await signJwt(key, goodClaims(), { alg: "HS256" }), reason: "bad_alg" },
    expired: { token: await signJwt(key, goodClaims({ exp: nowSec - 3600 })), reason: "expired" },
    "unknown kid": { token: await signJwt(key, goodClaims(), { kid: "nope" }), reason: "unknown_kid" },
  };
  for (const [name, c] of Object.entries(cases)) {
    const started = await startLogin();
    const f = fakeWorkOS({ key, accessToken: c.token });
    const res = await callback(env(), f, started);
    const html = await res.text();
    assert.match(html, new RegExp(`NOT verified \\(${c.reason}\\)`), name);
    assert.ok(!cookiesOf(res).some((x) => x.startsWith("__Host-fw_probe_sid=") && !/Max-Age=0/.test(x)), name + ": no sign-out cookie for an unverified token");
  }
  const started = await startLogin();
  const noKeys = await (await callback(env(), fakeWorkOS({ key, accessToken: await signJwt(key, goodClaims()), jwks: "down" }), started)).text();
  assert.match(noKeys, /NOT verified \(no_keys\)/);
});

test("wrong client_id claim or issuer is visible in the report, not silently accepted", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const token = await signJwt(key, goodClaims({ client_id: "client_SOMEONE_ELSE", iss: "https://evil.example" }));
  const html = await reportOf(await callback(env(), fakeWorkOS({ key, accessToken: token }), started));
  assert.match(html, /"client_id_claim_matches": false/);
  assert.match(html, /"iss_equals_discovery_issuer": false/);
});

test("WorkOS refusing the exchange, or being unreachable, gives a generic page that echoes no upstream text", async () => {
  const key = await makeKey();
  const logged = [];
  const orig = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    let started = await startLogin();
    let res = await callback(env(), fakeWorkOS({ key, exchangeStatus: 400 }), started);
    let html = await res.text();
    assert.equal(res.status, 400);
    assert.match(html, /invalid_grant/);
    assert.ok(!html.includes("SECRET-UPSTREAM-TEXT"));
    started = await startLogin();
    res = await callback(env(), fakeWorkOS({ key, down: true }), started);
    assert.equal(res.status, 502);
    assert.ok(!(await res.text()).includes("network down"));
  } finally {
    console.error = orig;
  }
  for (const line of logged) for (const secret of [API_KEY, PEPPER, "SECRET-UPSTREAM-TEXT", "auth-code-123", "tester@example.com"]) assert.ok(!line.includes(secret), "log leaked " + secret);
});

/* ------------------------------------------------------------------ logout */

test("logout is POST only, same-origin only, and goes to WorkOS logout for the signed-in session with the exact return URL", async () => {
  const key = await makeKey();
  const started = await startLogin();
  const signedIn = await callback(env(), fakeWorkOS({ key, accessToken: await signJwt(key, goodClaims()) }), started);
  const sid = cookieHeader(signedIn, "__Host-fw_probe_sid");
  assert.ok(sid);

  const get = await handlePortalProbe(req("/portal/logout", { headers: { Cookie: sid } }), env(), { now: NOW });
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("Location"), null);
  for (const origin of [null, "https://evil.test", "https://frameworkco.ca"]) {
    const headers = { Cookie: sid, ...(origin ? { Origin: origin } : {}) };
    const bad = await handlePortalProbe(req("/portal/logout", { method: "POST", headers }), env(), { now: NOW });
    assert.equal(bad.status, 403, String(origin));
    assert.equal(bad.headers.get("Location"), null);
  }
  const ok = await handlePortalProbe(req("/portal/logout", { method: "POST", headers: { Cookie: sid, Origin: BASE } }), env(), { now: NOW });
  assert.equal(ok.status, 303);
  const loc = new URL(ok.headers.get("Location"));
  assert.equal(loc.origin + loc.pathname, "https://api.workos.com/user_management/sessions/logout");
  assert.equal(loc.searchParams.get("session_id"), "session_01ABC");
  assert.equal(loc.searchParams.get("return_to"), BASE + "/portal/login");
  assert.ok(cookiesOf(ok).some((c) => c.startsWith("__Host-fw_probe_sid=;") && /Max-Age=0/.test(c)));
});

test("logout without a valid sign-out cookie never sends an attacker-chosen session id to WorkOS", async () => {
  for (const cookie of ["", "__Host-fw_probe_sid=forged.value", "__Host-fw_probe_sid=" + Buffer.from(JSON.stringify({ sid: "victim", exp: nowSec + 100 })).toString("base64url") + ".AAAA"]) {
    const res = await handlePortalProbe(req("/portal/logout", { method: "POST", headers: { Origin: BASE, ...(cookie ? { Cookie: cookie } : {}) } }), env(), { now: NOW });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("Location"), BASE + "/portal/login");
  }
});

/* ------------------------------------------------------------------ JWT verifier unit tests */

test("jwt: decode rejects malformed input and oversize tokens", () => {
  for (const t of ["", "a.b", "a.b.c.d", "not a jwt", "e30.e30.", null, undefined, 5, "x".repeat(9000)]) assert.equal(decodeJwt(t), null, String(t).slice(0, 20));
});

test("jwt: verifyRs256 accepts a good token and enforces alg, kid, signature and time", async () => {
  const key = await makeKey();
  const jwks = { keys: [key.jwk] };
  assert.equal((await verifyRs256(await signJwt(key, goodClaims()), jwks, NOW)).ok, true);
  assert.equal((await verifyRs256(await signJwt(key, goodClaims({ exp: nowSec - 120 })), jwks, NOW)).reason, "expired");
  assert.equal((await verifyRs256(await signJwt(key, goodClaims({ nbf: nowSec + 600 })), jwks, NOW)).reason, "not_yet_valid");
  assert.equal((await verifyRs256(await signJwt(key, { ...goodClaims(), exp: undefined }), jwks, NOW)).reason, "expired", "no exp is treated as invalid");
  assert.equal((await verifyRs256(await signJwt(key, goodClaims(), { kid: undefined }), jwks, NOW)).reason, "no_kid");
  assert.equal((await verifyRs256("garbage", jwks, NOW)).reason, "malformed");
  const wrongUse = { keys: [{ ...key.jwk, use: "enc" }] };
  assert.equal((await verifyRs256(await signJwt(key, goodClaims()), wrongUse, NOW)).reason, "unknown_kid");
});

/* ------------------------------------------------------------------ the rest of the Worker is untouched */

test("Framework Admin still wins its paths: /admin and /api/admin are authenticated by Access before the probe could see them", async () => {
  const e = { ...env(), ASSETS: { fetch: async () => new Response("static") } }; // no Access settings configured -> admin fails closed
  const api = await worker.fetch(new Request(BASE + "/api/admin/me"), e);
  assert.equal(api.status, 503);
  assert.notEqual(await api.text(), "static");
  const page = await worker.fetch(new Request(BASE + "/admin"), e);
  assert.ok([401, 403, 503].includes(page.status));
  assert.ok(page.headers.get("X-Admin-Auth"));
});

test("an existing public route still works with the probe enabled (static pages are untouched)", async () => {
  const e = { ...env(), ASSETS: { fetch: async (r) => new Response("static:" + new URL(r.url).pathname) } };
  assert.equal(await (await worker.fetch(new Request(BASE + "/about.html"), e)).text(), "static:/about.html");
  assert.equal((await worker.fetch(new Request(BASE + "/api/client-revenue"), { ...e, DB: undefined })).status, 200);
});

test("source hygiene: the probe never logs request data, tokens or secrets and never touches D1 or R2", () => {
  const src = readFileSync(new URL("../portal/probe.js", import.meta.url), "utf8") + readFileSync(new URL("../portal/jwt.js", import.meta.url), "utf8");
  assert.ok(!/PORTAL_DB|PORTAL_FILES|env\.DB|\.prepare\(|\.put\(/.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), "no database or bucket access");
  const logs = src.match(/console\.\w+\([^)]*\)/g) || [];
  assert.deepEqual(logs.sort(), ['console.error("portal probe: authenticate request failed")', 'console.error("portal probe: code exchange refused", exchange.status)']);
  assert.ok(!/sk_(test|live)_/.test(src));
});
