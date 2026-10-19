// Client portal Stage 2A: configuration, cryptography, policy, HTTP helpers, logging and claim validation.
import test from "node:test";
import assert from "node:assert/strict";
import { portalMode, portalConfigProblems, readPortalConfig } from "../portal/config.js";
import * as C from "../portal/crypto.js";
import { can, requirePermission, permissionsFor, PortalForbidden, ACTIONS } from "../portal/policy.js";
import * as H from "../portal/http.js";
import { buildLogEntry, logEvent, routeName } from "../portal/log.js";
import { validateAccessTokenClaims, identityFromWorkosUser } from "../portal/claims.js";

const PEPPER = "Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0";
const db = { prepare() {}, batch() {} };
const goodEnv = () => ({
  PORTAL_ENABLED: "1",
  PORTAL_BASE_URL: "https://staging.frameworkco.ca",
  PORTAL_AUTH_CLIENT_ID: "client_01M58C412YHC548S5JXP1TJ2ED",
  PORTAL_AUTH_CLIENT_SECRET: "sk_test_placeholder",
  PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C412YHC548S5JXP1TJ2ED",
  PORTAL_SESSION_PEPPER: PEPPER,
  PORTAL_DB: db,
});

/* ------------------------------------------------------------------ config */
test("config: off unless PORTAL_ENABLED is exactly 1", () => {
  for (const v of [undefined, "", "0", "true", "yes", "11", " 0 ", 1, true]) assert.equal(portalMode({ ...goodEnv(), PORTAL_ENABLED: v }), "off", String(v));
  assert.equal(portalMode(undefined), "off");
  assert.equal(portalMode({}), "off");
  assert.equal(readPortalConfig({ ...goodEnv(), PORTAL_ENABLED: "0" }), null);
});
test("config: complete configuration is on and frozen", () => {
  assert.equal(portalMode(goodEnv()), "on");
  const cfg = readPortalConfig(goodEnv());
  assert.equal(cfg.origin, "https://staging.frameworkco.ca");
  assert.equal(cfg.host, "staging.frameworkco.ca");
  assert.ok(Object.isFrozen(cfg));
});
test("config: each missing or malformed setting fails closed and is reported by NAME only", () => {
  const cases = {
    PORTAL_BASE_URL: [undefined, "", "http://staging.frameworkco.ca", "https://staging.frameworkco.ca/x", "https://u:p@staging.frameworkco.ca", "https://staging.frameworkco.ca/?a=1", "not a url"],
    PORTAL_AUTH_CLIENT_ID: [undefined, "", "abc", "client_", "client_short", "x client_01M58C412YHC548S5JXP1TJ2ED"],
    PORTAL_AUTH_CLIENT_SECRET: [undefined, "", "   "],
    PORTAL_AUTH_ISSUER: [undefined, "", "http://api.workos.com/x", "https://api.workos.com/x/", "https://api.workos.com/x?y=1", "junk"],
    PORTAL_SESSION_PEPPER: [undefined, "", "short"],
    PORTAL_DB: [undefined, null, {}, { prepare() {} }, "db"],
  };
  for (const [name, values] of Object.entries(cases)) {
    for (const v of values) {
      const env = { ...goodEnv(), [name]: v };
      assert.equal(portalMode(env), "misconfigured", `${name}=${String(v)}`);
      assert.equal(readPortalConfig(env), null);
      const problems = portalConfigProblems(env);
      assert.ok(problems.some((p) => p.startsWith(name)), `${name} named in ${problems}`);
    }
  }
});
test("config: problems never contain secret values", () => {
  const env = { ...goodEnv(), PORTAL_AUTH_CLIENT_SECRET: "sk_test_SUPERSECRET", PORTAL_SESSION_PEPPER: "tooShortPepperValue" };
  const out = JSON.stringify(portalConfigProblems(env));
  assert.ok(!out.includes("SUPERSECRET") && !out.includes("tooShortPepperValue"));
  assert.ok(portalConfigProblems(env).includes("PORTAL_SESSION_PEPPER_too_short"));
});
test("config: the pepper must be at least 32 bytes of encoded randomness (43+ characters) with real variety", () => {
  const mode = (p) => portalMode({ ...goodEnv(), PORTAL_SESSION_PEPPER: p });
  assert.equal(mode(PEPPER), "on");
  assert.deepEqual(portalConfigProblems({ ...goodEnv(), PORTAL_SESSION_PEPPER: PEPPER.slice(0, 42) }), ["PORTAL_SESSION_PEPPER_too_short"]);
  assert.deepEqual(portalConfigProblems({ ...goodEnv(), PORTAL_SESSION_PEPPER: "A1b2".repeat(11) }), ["PORTAL_SESSION_PEPPER_weak"], "repetitive");
  assert.deepEqual(portalConfigProblems({ ...goodEnv(), PORTAL_SESSION_PEPPER: "p".repeat(64) }), ["PORTAL_SESSION_PEPPER_weak"]);
  assert.deepEqual(portalConfigProblems({ ...goodEnv(), PORTAL_SESSION_PEPPER: PEPPER.slice(0, 40) + " ab" }), ["PORTAL_SESSION_PEPPER_weak"], "characters outside base64/hex");
  assert.equal(mode("0123456789abcdef".repeat(4)), "on", "64 hex characters are fine");
  assert.equal(mode(Buffer.from(crypto.getRandomValues(new Uint8Array(48))).toString("base64")), "on", "openssl rand -base64 48 style");
});
test("config: the production hosts need a second explicit approval flag", () => {
  for (const host of ["https://frameworkco.ca", "https://www.frameworkco.ca"]) {
    const env = { ...goodEnv(), PORTAL_BASE_URL: host };
    assert.equal(portalMode(env), "misconfigured");
    assert.deepEqual(portalConfigProblems(env), ["production_host_not_approved"]);
    assert.equal(portalMode({ ...env, PORTAL_ALLOW_PRODUCTION: "1" }), "on");
    assert.equal(portalMode({ ...env, PORTAL_ALLOW_PRODUCTION: "true" }), "misconfigured");
  }
});

/* ------------------------------------------------------------------ crypto */
test("crypto: random tokens are 43-char base64url and do not repeat", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const t = C.randomToken();
    assert.match(t, /^[A-Za-z0-9_-]{43}$/);
    assert.ok(C.isSessionToken(t));
    seen.add(t);
  }
  assert.equal(seen.size, 200);
});
test("crypto: base64url round-trips and rejects malformed input", () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  assert.deepEqual([...C.b64urlToBytes(C.bytesToB64url(bytes))], [...bytes]);
  for (const bad of ["a+b", "a/b", "a=b", "a b", "a", "é"]) assert.throws(() => C.b64urlToBytes(bad), undefined, bad);
});
test("crypto: timingSafeEqualStrings", () => {
  assert.ok(C.timingSafeEqualStrings("abc", "abc"));
  assert.ok(!C.timingSafeEqualStrings("abc", "abd"));
  assert.ok(!C.timingSafeEqualStrings("abc", "abcd"));
  assert.ok(!C.timingSafeEqualStrings("abc", 5));
  assert.ok(!C.timingSafeEqualStrings(undefined, undefined));
});
test("crypto: session hashes are deterministic, pepper-dependent, label-separated and never contain the token", async () => {
  const t = C.randomToken();
  const h = await C.hashSessionToken(PEPPER, t);
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, await C.hashSessionToken(PEPPER, t));
  assert.notEqual(h, await C.hashSessionToken("q".repeat(40), t));
  assert.notEqual(h, await C.hmacHex(PEPPER, "ip", t));
  assert.ok(!h.includes(t));
  assert.throws(() => C.hashSessionToken(PEPPER, "short"), /invalid_session_token/);
  assert.throws(() => C.hashSessionToken(PEPPER, undefined));
  await assert.rejects(() => C.hmacHex("tiny", "x", "y"), /invalid_pepper/);
});
test("crypto: ip hashes are 32 hex chars, stable, and null for nothing", async () => {
  const h = await C.hashIp(PEPPER, "203.0.113.9");
  assert.match(h, /^[0-9a-f]{32}$/);
  assert.equal(h, await C.hashIp(PEPPER, "203.0.113.9"));
  assert.notEqual(h, await C.hashIp(PEPPER, "203.0.113.10"));
  assert.ok(!h.includes("203"));
  for (const v of [null, undefined, "", "x".repeat(65), 5]) assert.equal(await C.hashIp(PEPPER, v), null);
});
test("crypto: CSRF tokens are bound to the session and the pepper", async () => {
  const a = await C.csrfToken(PEPPER, "s".repeat(64));
  assert.ok(await C.verifyCsrfToken(PEPPER, "s".repeat(64), a));
  assert.ok(!(await C.verifyCsrfToken(PEPPER, "t".repeat(64), a)));
  assert.ok(!(await C.verifyCsrfToken("q".repeat(40), "s".repeat(64), a)));
  for (const bad of [undefined, null, "", "abc", a + "x", a.slice(1), 5]) assert.ok(!(await C.verifyCsrfToken(PEPPER, "s".repeat(64), bad)));
  assert.ok(!(await C.verifyCsrfToken(PEPPER, "", a)));
});
test("crypto: sealed payloads are tamper-proof, expiring and purpose-bound", async () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const sealed = await C.sealPayload(PEPPER, "auth", { state: "abc", n: 1 }, now, 600);
  const opened = await C.openPayload(PEPPER, "auth", sealed, now);
  assert.equal(opened.state, "abc");
  assert.ok(await C.openPayload(PEPPER, "auth", sealed, new Date(now.getTime() + 600_000)), "valid up to the deadline");
  assert.equal(await C.openPayload(PEPPER, "auth", sealed, new Date(now.getTime() + 602_000)), null, "expired");
  assert.equal(await C.openPayload(PEPPER, "other", sealed, now), null, "other purpose");
  assert.equal(await C.openPayload("q".repeat(40), "auth", sealed, now), null, "other pepper");
  const [body, sig] = sealed.split(".");
  const forged = C.bytesToB64url(new TextEncoder().encode(JSON.stringify({ state: "evil", exp: 9999999999 })));
  for (const bad of [`${forged}.${sig}`, `${body}.${sig.slice(1)}A`, body, `${body}.${sig}.x`, "", ".", null, undefined, 5, "x".repeat(5000), `${body}.${sig}!`]) assert.equal(await C.openPayload(PEPPER, "auth", bad, now), null);
});

/* ------------------------------------------------------------------ policy */
test("policy: roles map to exactly the reviewed grants", () => {
  assert.deepEqual(permissionsFor("owner").sort(), [...ACTIONS].sort());
  assert.deepEqual(permissionsFor("member").sort(), ["activity.view", "org.view", "projects.view"]);
  assert.ok(can("owner", "members.view"));
  assert.ok(!can("member", "members.view"));
});
test("policy: unknown or malformed roles and actions deny", () => {
  for (const role of [undefined, null, "", "admin", "OWNER", "Owner", "viewer", 1, {}, [], ["owner"], "__proto__", "constructor"]) for (const a of ACTIONS) assert.ok(!can(role, a), `${String(role)} ${a}`);
  for (const action of [undefined, null, "", "org.edit", "__proto__", "constructor", "toString", "hasOwnProperty", "org.view ", ["org.view"], 5]) {
    assert.ok(!can("owner", action), String(action));
    assert.throws(() => requirePermission("owner", action), PortalForbidden);
  }
  assert.ok(requirePermission("owner", "org.view"));
  try { requirePermission("member", "members.view"); assert.fail(); } catch (e) { assert.equal(e.code, "forbidden"); assert.ok(!/members/.test(e.message)); }
});
test("policy: the grant table cannot be modified at runtime", () => {
  const before = permissionsFor("member");
  try { ACTIONS.push("x"); } catch {}
  assert.deepEqual(permissionsFor("member"), before);
  assert.ok(Object.isFrozen(ACTIONS));
});

/* ------------------------------------------------------------------ http */
test("http: every portal response carries the security headers, and extras cannot weaken them", () => {
  const h = H.securityHeaders({ "Cache-Control": "public, max-age=999", "Referrer-Policy": "unsafe-url", "Content-Security-Policy": "default-src *", "X-Custom": "1" });
  assert.equal(h.get("Cache-Control"), "no-store");
  assert.equal(h.get("Referrer-Policy"), "no-referrer");
  assert.equal(h.get("Content-Security-Policy"), H.PORTAL_CSP);
  assert.equal(h.get("X-Content-Type-Options"), "nosniff");
  assert.equal(h.get("X-Frame-Options"), "DENY");
  assert.match(h.get("X-Robots-Tag"), /noindex/);
  assert.match(h.get("Strict-Transport-Security"), /max-age=\d{7,}/);
  assert.equal(h.get("X-Custom"), "1");
  assert.match(H.PORTAL_CSP, /default-src 'none'/);
  assert.ok(!/script-src|unsafe-inline|unsafe-eval|\*/.test(H.PORTAL_CSP), "no scripts, no wildcards");
  assert.match(H.PORTAL_CSP, /frame-ancestors 'none'/);
  assert.match(H.PORTAL_CSP, /base-uri 'none'/);
});
test("http: pages and errors are script-free, escaped, and carry the headers", async () => {
  const p = H.htmlPage({ title: "<script>alert(1)</script>", bodyHtml: "<p>ok</p>", ref: "AB12CD34" });
  const html = await p.text();
  assert.ok(!html.includes("<script>alert"));
  assert.ok(!/<script/i.test(html));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Reference: <strong>AB12CD34<\/strong>/);
  assert.equal(p.headers.get("Cache-Control"), "no-store");
  assert.match(p.headers.get("Content-Type"), /text\/html/);
  for (const s of [400, 403, 404, 405, 429, 500, 502, 503, 418]) {
    const r = H.errorPage(s, { ref: "REF12345" });
    assert.equal(r.status, s === 418 ? 500 : s);
    const body = await r.text();
    assert.match(body, /REF12345/);
    assert.ok(!/stack|Error:|at \S+\.js/.test(body));
    assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  }
  assert.match(H.newRef(), /^[A-HJKMNP-TV-Z2-9]{8}$/);
  assert.notEqual(H.newRef(), H.newRef());
});
test("http: cookies are __Host- prefixed, HttpOnly, Secure, Lax, host-only", () => {
  const c = H.serializeCookie(H.SESSION_COOKIE, "abc_-123", { maxAge: 60 });
  assert.equal(c, "__Host-fw_portal=abc_-123; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Lax");
  assert.ok(!/Domain/i.test(c));
  assert.match(H.clearCookie(H.STATE_COOKIE), /^__Host-fw_auth=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
  assert.throws(() => H.serializeCookie("session", "x", { maxAge: 1 }), /host_prefixed/);
  assert.throws(() => H.serializeCookie("__Host-a;b", "x", { maxAge: 1 }), /invalid_cookie_name/);
  for (const v of ["a;b", "a b", "a\r\nSet-Cookie: x=y", 'a"b', "a,b", "é", 5, null]) assert.throws(() => H.serializeCookie(H.SESSION_COOKIE, v, { maxAge: 1 }), undefined, String(v));
  for (const m of [-1, 1.5, NaN, "60", undefined, 400 * 86400 + 1]) assert.throws(() => H.serializeCookie(H.SESSION_COOKIE, "x", { maxAge: m }), /max_age/);
  assert.throws(() => H.serializeCookie(H.SESSION_COOKIE, "x", { maxAge: 1, sameSite: "None" }), /same_site/);
});
test("http: reading cookies; duplicates are ambiguous and treated as absent", () => {
  const req = (cookie) => new Request("https://x.test/", cookie === undefined ? {} : { headers: { Cookie: cookie } });
  assert.equal(H.getCookie(req("__Host-fw_portal=abc; other=1"), "__Host-fw_portal"), "abc");
  assert.equal(H.getCookie(req("a=1; a=2"), "a"), undefined);
  assert.equal(H.getCookie(req("a=1; a=2; a=1"), "a"), undefined);
  assert.equal(H.getCookie(req("a=1; b=2; a=3"), "b"), "2");
  assert.equal(H.getCookie(req(undefined), "a"), undefined);
  assert.equal(H.getCookie(req("garbage; =x; a"), "a"), undefined);
  assert.equal(H.getCookie(req("a=x=y"), "a"), "x=y");
});
test("http: redirects only to local paths or explicitly allowed origins", () => {
  const ok = H.redirect("/portal/login", { cookies: ["a=1; Path=/"] });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), "/portal/login");
  assert.equal(ok.headers.get("Cache-Control"), "no-store");
  const idp = H.redirect("https://api.workos.com/user_management/authorize?x=1", { allowedOrigins: [H.WORKOS_ORIGIN] });
  assert.match(idp.headers.get("Location"), /^https:\/\/api\.workos\.com\//);
  for (const bad of ["//evil.test", "https://evil.test/", "http://api.workos.com/x", "javascript:alert(1)", "/\\evil.test", "/a\r\nSet-Cookie: x=1", "evil", "", "https://api.workos.com.evil.test/", "https://user:pw@api.workos.com/", "data:text/html,x", undefined]) {
    assert.throws(() => H.redirect(bad, { allowedOrigins: [H.WORKOS_ORIGIN] }), /unsafe_redirect|Invalid/, String(bad));
  }
  assert.throws(() => H.redirect("https://api.workos.com/x"), /unsafe_redirect/, "no allow-list means no external redirects");
  assert.throws(() => H.redirect("/portal", { status: 200 }), /invalid_redirect_status/);
});
test("http: safeReturnPath accepts portal paths only", () => {
  assert.equal(H.safeReturnPath("/portal/o/acme"), "/portal/o/acme");
  assert.equal(H.safeReturnPath("/portal"), "/portal");
  for (const bad of ["//evil.test", "/portal/../admin", "/portal/./x", "/admin", "https://evil.test", "/portal?next=x", "/portal/%2e%2e/x", "/portal/a b", "/portal\\x", "/portalx", undefined, 5, "/portal/" + "a".repeat(300), "/portal//x"]) assert.equal(H.safeReturnPath(bad), "/portal", String(bad));
  assert.equal(H.safeReturnPath("//x", "/portal/login"), "/portal/login");
});
test("http: same-site mutation screening", () => {
  const r = (headers) => new Request("https://staging.frameworkco.ca/portal/logout", { method: "POST", headers });
  const base = "https://staging.frameworkco.ca";
  assert.ok(H.checkSameSiteMutation(r({ "Sec-Fetch-Site": "same-origin", Origin: base }), base).ok);
  assert.ok(H.checkSameSiteMutation(r({ Origin: "null" }), base).ok, "no-referrer pages send Origin: null; the CSRF token is the real check");
  assert.ok(H.checkSameSiteMutation(r({}), base).ok);
  assert.equal(H.checkSameSiteMutation(r({ "Sec-Fetch-Site": "cross-site" }), base).reason, "cross_site");
  assert.equal(H.checkSameSiteMutation(r({ "Sec-Fetch-Site": "same-site" }), base).reason, "cross_site");
  assert.equal(H.checkSameSiteMutation(r({ "Sec-Fetch-Site": "none" }), base).reason, "cross_site");
  assert.equal(H.checkSameSiteMutation(r({ Origin: "https://evil.test" }), base).reason, "foreign_origin");
  assert.equal(H.checkSameSiteMutation(r({ Origin: "https://staging.frameworkco.ca.evil.test" }), base).reason, "foreign_origin");
});

/* ------------------------------------------------------------------ logging */
test("log: only allow-listed, valid fields are kept; everything else is redacted or dropped", () => {
  const secret = "eyJhbGciOiJSUzI1NiJ9.payload.sig";
  const e = buildLogEntry({
    evt: "auth.callback", route: "/portal/auth/callback", method: "GET", status: 302, ms: 12.6, ref: "AB2CD345", outcome: "ok",
    org: "0b7f2a54-1c1d-4b1e-9a36-5d0f3c9a1e11", user: "not-a-uuid", reason: secret,
    email: "person@example.com", code: "abc", token: secret, cookie: "x", url: "https://x/?code=1", stack: "Error: boom", headers: {},
  });
  assert.deepEqual(e, { evt: "auth.callback", route: "/portal/auth/callback", method: "GET", status: 302, ms: 13, ref: "AB2CD345", outcome: "ok", org: "0b7f2a54-1c1d-4b1e-9a36-5d0f3c9a1e11", user: "[redacted]", reason: "[redacted]" });
  assert.ok(!JSON.stringify(e).includes("person@") && !JSON.stringify(e).includes(secret));
});
test("log: values that look like emails, urls, tokens or free text are redacted in every free-form field", () => {
  for (const bad of ["person@example.com", "https://x.test/?code=abc", "Bearer abc", "has space", "UPPER", "a-b", "x".repeat(60), "../etc", "<script>", 5, {}, []]) {
    for (const f of ["evt", "outcome", "reason"]) assert.equal(buildLogEntry({ [f]: bad })[f], "[redacted]", `${f}:${JSON.stringify(bad)}`);
  }
  assert.equal(buildLogEntry({ route: "/portal/o/acme?x=1" }).route, "[redacted]");
  assert.equal(buildLogEntry({ method: "get" }).method, "[redacted]");
  assert.equal(buildLogEntry({ status: 99 }).status, "[redacted]");
  assert.deepEqual(buildLogEntry(null), {});
  assert.deepEqual(buildLogEntry({ __proto__: { evt: "x" } }), {});
});
test("log: logEvent writes one JSON line and never throws", () => {
  const lines = [];
  logEvent({ evt: "session.start", count: 3 }, (l) => lines.push(l));
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { portal: true, evt: "session.start", count: 3 });
  assert.doesNotThrow(() => logEvent({ evt: "x" }, () => { throw new Error("sink down"); }));
});
test("log: route names never reveal organization slugs or ids", () => {
  assert.equal(routeName("/portal/o/acme-dental/projects"), "/portal/o/:slug/projects");
  assert.equal(routeName("/portal/o/secret-client"), "/portal/o/:slug");
  assert.equal(routeName("/portal/auth/callback"), "/portal/auth/callback");
  assert.equal(routeName("/portal/whatever/123"), "/portal/:p/:p");
  assert.equal(routeName("nope"), "/other");
  assert.equal(routeName(undefined), "/other");
  assert.ok(!routeName("/portal/o/acme.client@x").includes("acme"));
});

/* ------------------------------------------------------------------ claims */
const CFG = { issuer: "https://api.workos.com/user_management/client_01M58C412YHC548S5JXP1TJ2ED", clientId: "client_01M58C412YHC548S5JXP1TJ2ED" };
const NOW = new Date("2026-10-20T12:00:00Z");
const nowSec = Math.floor(NOW.getTime() / 1000);
const goodClaims = (o = {}) => ({ iss: CFG.issuer, client_id: CFG.clientId, sub: "user_01ABCDEF", sid: "session_01ABCDEF", iat: nowSec - 10, exp: nowSec + 290, aud: null, ...o });

test("claims: a well-formed token is accepted and reduced to the four claims we use", () => {
  const r = validateAccessTokenClaims(goodClaims({ org_id: "org_x", extra: "ignored" }), CFG, NOW);
  assert.deepEqual(r, { ok: true, claims: { sub: "user_01ABCDEF", sid: "session_01ABCDEF", exp: nowSec + 290, iat: nowSec - 10 } });
});
test("claims: missing WorkOS session identifier is refused (sign-in would not be revocable)", () => {
  for (const sid of [undefined, null, ""]) {
    const p = goodClaims(); if (sid === undefined) delete p.sid; else p.sid = sid;
    assert.deepEqual(validateAccessTokenClaims(p, CFG, NOW), { ok: false, reason: "session_id_missing" });
  }
  for (const sid of [5, {}, "bad id", "x", "a".repeat(129), ["s"]]) assert.equal(validateAccessTokenClaims(goodClaims({ sid }), CFG, NOW).reason, "session_id_invalid");
});
test("claims: issuer, client, subject, audience and timing are all enforced", () => {
  const reason = (o, now = NOW) => validateAccessTokenClaims(goodClaims(o), CFG, now).reason;
  assert.equal(reason({ iss: CFG.issuer + "/" }), "issuer_mismatch");
  assert.equal(reason({ iss: "https://evil.test" }), "issuer_mismatch");
  assert.equal(reason({ iss: undefined }), "issuer_mismatch");
  assert.equal(reason({ client_id: "client_OTHER000000" }), "client_mismatch");
  assert.equal(reason({ client_id: undefined }), "client_mismatch");
  for (const sub of [undefined, "", 5, "bad sub", "x"]) assert.equal(reason({ sub }), "subject_invalid");
  assert.equal(reason({ aud: "someone_else" }), "audience_mismatch");
  assert.equal(reason({ aud: ["a", "b"] }), "audience_mismatch");
  assert.equal(validateAccessTokenClaims(goodClaims({ aud: CFG.clientId }), CFG, NOW).ok, true);
  assert.equal(validateAccessTokenClaims(goodClaims({ aud: [CFG.clientId] }), CFG, NOW).ok, true);
  assert.equal(reason({ exp: nowSec - 31, iat: nowSec - 331 }), "expired");
  assert.equal(reason({ exp: nowSec - 10, iat: nowSec - 310 }), undefined, "within leeway");
  assert.equal(reason({ iat: nowSec + 31, exp: nowSec + 331 }), "issued_in_future");
  for (const exp of ["x", 1.5, null, undefined]) assert.equal(reason({ exp }), "expiry_invalid");
  assert.equal(reason({ iat: undefined }), "expiry_invalid");
  assert.equal(reason({ exp: nowSec + 100000, iat: nowSec }), "lifetime_invalid");
  assert.equal(reason({ exp: nowSec - 5, iat: nowSec }), "lifetime_invalid");
  for (const p of [null, undefined, "x", 5, [], true]) assert.equal(validateAccessTokenClaims(p, CFG, NOW).reason, "claims_missing");
});
test("claims: identity needs a verified email and must match the token subject", () => {
  const claims = { sub: "user_01ABCDEF" };
  const user = (o = {}) => ({ id: "user_01ABCDEF", email: "Person@Example.com", email_verified: true, first_name: "Pat", last_name: "Lee", ...o });
  assert.deepEqual(identityFromWorkosUser(user(), claims), { ok: true, identity: { workosUserId: "user_01ABCDEF", email: "person@example.com", name: "Pat Lee" } });
  for (const v of [false, undefined, null, "true", 1, "yes", {}]) assert.equal(identityFromWorkosUser(user({ email_verified: v }), claims).reason, "email_not_verified");
  assert.equal(identityFromWorkosUser(user({ id: "user_01OTHER00" }), claims).reason, "subject_mismatch");
  assert.equal(identityFromWorkosUser(user(), { sub: "user_01OTHER00" }).reason, "subject_mismatch");
  assert.equal(identityFromWorkosUser(user(), null).reason, "subject_mismatch");
  for (const email of [undefined, "", "no-at", "a b@c.d", 5]) assert.equal(identityFromWorkosUser(user({ email }), claims).reason, "email_invalid");
  for (const u of [null, undefined, "x", [], {}, { id: 5 }]) assert.equal(identityFromWorkosUser(u, claims).reason, "user_invalid");
  assert.equal(identityFromWorkosUser(user({ first_name: "x".repeat(121), last_name: "" }), claims).identity.name, null, "an unusable name is dropped, not fatal");
  assert.equal(identityFromWorkosUser(user({ first_name: "Pat\u0000", last_name: null }), claims).identity.name, null);
  assert.equal(identityFromWorkosUser(user({ first_name: null, last_name: null }), claims).identity.name, null);
});
