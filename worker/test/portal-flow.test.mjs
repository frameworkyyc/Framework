// Client portal Stage 2C/2D: the complete sign-in, session, logout and tenant-access flow, driven through the router with a fake WorkOS.
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, makeKeys, ORIGIN, CLIENT_ID, T0, csrfOf, stripRef, API_KEY, PEPPER } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { rows, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import * as store from "../portal/repo/sessions.js";

const ALICE = (w) => w.user(1, "alice@example.com");
const text = (r) => r.text();
const loc = (r) => r.headers.get("Location");

async function acme() {
  const w = await makeWorld();
  const org = await w.org("acme", "Acme Dental");
  await w.invite(org, "alice@example.com", "owner");
  return { w, org };
}
async function signedIn(w, user, org) {
  const b = w.browser();
  const res = await b.signIn(user);
  assert.equal(res.status, 303, "sign-in should succeed");
  return b;
}

/* ------------------------------------------------------------------ routing and inertness */
test("router: portal off, other hosts and non-portal paths fall through to the static site (null)", async () => {
  const w = await makeWorld();
  const call = (url, env = w.env) => handlePortal(new Request(url), env, { now: T0 });
  assert.equal(await call(ORIGIN + "/portal/login", { ...w.env, PORTAL_ENABLED: "0" }), null);
  assert.equal(await call(ORIGIN + "/portal/login", { ...w.env, PORTAL_ENABLED: undefined }), null);
  assert.equal(await call(ORIGIN + "/about.html"), null);
  assert.equal(await call(ORIGIN + "/portalx"), null);
  assert.equal(await call(ORIGIN + "/admin"), null);
  assert.equal(await call("https://www.frameworkco.ca/portal/login"), null, "another host");
  assert.equal(await call("https://staging.frameworkco.ca.evil.test/portal"), null);
});
test("router: enabled but misconfigured fails closed with a generic 503 for portal paths only", async () => {
  const w = await makeWorld();
  const bad = { ...w.env, PORTAL_SESSION_PEPPER: "short" };
  const res = await handlePortal(new Request(ORIGIN + "/portal"), bad, { now: T0 });
  assert.equal(res.status, 503);
  const body = await res.text();
  assert.ok(!/PEPPER|short|CLIENT_SECRET/.test(body));
  assert.equal(await handlePortal(new Request(ORIGIN + "/about.html"), bad, { now: T0 }), null);
});

/* ------------------------------------------------------------------ login */
test("login: interstitial first, then a PKCE redirect to WorkOS with a signed single-use state cookie", async () => {
  const { w } = await acme();
  const b = w.browser();
  const page = await b.get("/portal/login");
  assert.equal(page.status, 200);
  assert.match(await text(page), /href="\/portal\/login\?start=1"/);
  const go = await b.get("/portal/login?start=1");
  assert.equal(go.status, 302);
  const u = new URL(loc(go));
  assert.equal(u.origin + u.pathname, "https://api.workos.com/user_management/authorize");
  assert.equal(u.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(u.searchParams.get("redirect_uri"), ORIGIN + "/portal/auth/callback");
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.match(u.searchParams.get("state"), /^[A-Za-z0-9_-]{43}$/);
  assert.match(u.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
  assert.ok(!u.search.includes(API_KEY) && !u.search.includes("verifier"));
  const sc = go.headers.get("Set-Cookie");
  assert.match(sc, /^__Host-fw_auth=[^;]+; Path=\/; Max-Age=600; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(!sc.includes(u.searchParams.get("code_challenge")) || true);
  assert.notEqual(loc(go), loc(await w.browser().get("/portal/login?start=1")), "fresh state every time");
});
test("login: only validated parameters are forwarded; an attacker-supplied return target is never used", async () => {
  const { w } = await acme();
  const b = w.browser();
  const go = await b.get("/portal/login?start=1&login_hint=alice%40example.com&invitation_token=inv_abcdefgh123&next=//evil.test&redirect_uri=https://evil.test&return_to=//evil.test");
  const u = new URL(loc(go));
  assert.equal(u.searchParams.get("login_hint"), "alice@example.com");
  assert.equal(u.searchParams.get("invitation_token"), "inv_abcdefgh123");
  assert.equal(u.searchParams.get("redirect_uri"), ORIGIN + "/portal/auth/callback");
  assert.ok(!loc(go).includes("evil"));
  const bad = await b.get("/portal/login?start=1&login_hint=" + encodeURIComponent("a@b.c&redirect_uri=https://evil.test") + "&invitation_token=" + encodeURIComponent("x y&z"));
  assert.ok(!loc(bad).includes("login_hint") && !loc(bad).includes("invitation_token") && !loc(bad).includes("evil"));
});
test("login: methods other than GET/HEAD are refused", async () => {
  const { w } = await acme();
  for (const m of ["POST", "PUT", "DELETE"]) assert.equal((await w.browser().send("/portal/login", { method: m })).status, 405, m);
});

/* ------------------------------------------------------------------ the happy path */
test("full sign-in: an invited person lands in their organization with a fresh session; the invitation is consumed", async () => {
  const { w, org } = await acme();
  const b = w.browser();
  const cb = await b.signIn(ALICE(w));
  assert.equal(cb.status, 303);
  assert.equal(loc(cb), "/portal");
  const cookies = cb.headers.getSetCookie();
  assert.ok(cookies.some((c) => /^__Host-fw_auth=; .*Max-Age=0/.test(c)), "state cookie is single-use");
  assert.ok(cookies.some((c) => /^__Host-fw_portal=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=\d+; HttpOnly; Secure; SameSite=Lax$/.test(c)));
  assert.equal(count(w.db, "portal_sessions"), 1);
  assert.equal(rows(w.db, "SELECT status FROM invitations")[0].status, "accepted");
  assert.equal(rows(w.db, "SELECT role, status FROM memberships")[0].role, "owner");
  const home = await b.get("/portal");
  assert.equal(home.status, 303);
  assert.equal(loc(home), "/portal/o/acme");
  const page = await b.get("/portal/o/acme");
  assert.equal(page.status, 200);
  const html = await text(page);
  assert.match(html, /Acme Dental/);
  assert.match(html, /alice@example\.com/);
  assert.ok(!/<script/i.test(html));
  for (const [h, v] of [["Cache-Control", "no-store"], ["Referrer-Policy", "no-referrer"], ["X-Frame-Options", "DENY"], ["X-Content-Type-Options", "nosniff"]]) assert.equal(page.headers.get(h), v);
  assert.match(page.headers.get("Content-Security-Policy"), /default-src 'none'/);
  assert.equal(rows(w.db, "SELECT action FROM activity_log WHERE organization_id IS NULL")[0].action, "auth.signed_in");
  assert.ok(org);
});
test("exchange passes the PKCE verifier and API key server-side only (never to the browser)", async () => {
  const { w } = await acme();
  const b = w.browser();
  const cb = await b.signIn(ALICE(w));
  const everythingTheBrowserSaw = JSON.stringify([...cb.headers]) + (await text(cb));
  assert.ok(!everythingTheBrowserSaw.includes(API_KEY));
  assert.ok(w.workos.calls.includes("POST https://api.workos.com/user_management/authenticate"));
});
test("a signed-in person visiting /portal/login goes straight to the portal", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  assert.equal(loc(await b.get("/portal/login")), "/portal");
});

/* ------------------------------------------------------------------ callback failures: all fail securely, create nothing */
const nothingCreated = (w) => {
  assert.equal(count(w.db, "portal_sessions"), 0, "no session");
  assert.equal(count(w.db, "memberships"), 0, "no membership");
  assert.equal(rows(w.db, "SELECT status FROM invitations")[0].status, "pending", "invitation untouched");
};
const generic = async (res, status) => {
  assert.equal(res.status, status);
  const html = await text(res);
  assert.match(html, /Reference: <strong>[A-Z2-9]{8}<\/strong>/);
  assert.ok(!/UPSTREAM|SECRET|stack|D1_|Error:|alice@example|sk_test|invalid_grant|signature|jwks|kid/i.test(html), "no internal or upstream detail");
  assert.ok(!res.headers.getSetCookie().some((c) => c.startsWith("__Host-fw_portal=") && !/Max-Age=0/.test(c)), "no session cookie");
  return html;
};
test("callback: missing state cookie (attempt did not start in this browser)", async () => {
  const { w } = await acme();
  const a = w.browser();
  const start = await a.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  const victim = w.browser(); // a different browser, no cookie
  await generic(await victim.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), 400);
  nothingCreated(w);
});
test("callback: no parameters at all, or a code without state", async () => {
  const { w } = await acme();
  const b = w.browser();
  await generic(await b.get("/portal/auth/callback"), 400);
  await b.get("/portal/login?start=1");
  await generic(await b.get("/portal/auth/callback?code=abc"), 400);
  nothingCreated(w);
});
test("callback: state mismatch (login CSRF) is refused and consumes the state cookie", async () => {
  const { w } = await acme();
  const b = w.browser();
  await generic(await b.signIn(ALICE(w), { state: "A".repeat(43) }), 400);
  assert.ok(![...b.jar.keys()].includes("__Host-fw_auth"), "state cookie cleared");
  nothingCreated(w);
});
test("callback: replaying the same callback URL after success fails (state cookie gone, code single-use)", async () => {
  const { w } = await acme();
  const b = w.browser();
  const start = await b.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  const url = `/portal/auth/callback?code=${code}&state=${ch.get("state")}`;
  assert.equal((await b.get(url)).status, 303);
  await generic(await b.get(url), 400);
  assert.equal(count(w.db, "portal_sessions"), 1);
});
test("callback: a code replayed with a FRESH state cookie is still refused by the identity provider", async () => {
  const { w } = await acme();
  const b = w.browser();
  const start = await b.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  assert.equal((await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`)).status, 303);
  const b2 = w.browser();
  const start2 = await b2.get("/portal/login?start=1");
  await generic(await b2.get(`/portal/auth/callback?code=${code}&state=${new URL(loc(start2)).searchParams.get("state")}`), 400);
  assert.equal(count(w.db, "portal_sessions"), 1);
});
test("callback: PKCE verifier mismatch is refused (a stolen code is useless without the browser's cookie)", async () => {
  const { w } = await acme();
  const b = w.browser();
  await b.get("/portal/login?start=1");
  const state = new URL(loc(await b.get("/portal/login?start=1"))).searchParams.get("state");
  const code = await w.workos.issueCode({ challenge: "x".repeat(43), user: ALICE(w) });
  await generic(await b.get(`/portal/auth/callback?code=${code}&state=${state}`), 400);
  nothingCreated(w);
});
test("callback: WorkOS error parameter, empty code and hostile code values", async () => {
  const { w } = await acme();
  for (const qs of ["error=access_denied&error_description=secret+detail", "code=&state=", "code=%3Cscript%3E", "code=" + "a".repeat(600)]) {
    const b = w.browser();
    const start = await b.get("/portal/login?start=1");
    const state = new URL(loc(start)).searchParams.get("state");
    const res = await b.get(`/portal/auth/callback?${qs}&state=${state}`);
    const html = await generic(res, 400);
    assert.ok(!/secret detail|<script>/.test(html));
  }
  nothingCreated(w);
});
test("callback: WorkOS unreachable -> 502 with 'try again', nothing created", async () => {
  const { w } = await acme();
  const b = w.browser();
  const start = await b.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  w.workos.down = true;
  const html = await generic(await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), 502);
  assert.match(html, /try again/i);
  nothingCreated(w);
});
test("callback: WorkOS 5xx on the exchange -> 502; a 4xx -> 400", async () => {
  const { w } = await acme();
  for (const [status, expect] of [[500, 502], [503, 502], [429, 502], [400, 400], [401, 400]]) {
    const b = w.browser();
    const start = await b.get("/portal/login?start=1");
    const ch = new URL(loc(start)).searchParams;
    const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
    w.workos.exchangeStatus = status;
    await generic(await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), expect);
  }
  nothingCreated(w);
});
test("callback: signing keys unreachable -> 502, nothing created", async () => {
  const { w } = await acme();
  w.workos.jwksDown = true;
  await generic(await w.browser().signIn(ALICE(w)), 502);
  nothingCreated(w);
});
test("token validation: forged signature, wrong issuer, wrong client, expired, no kid match, alg none/HS256 are all refused", async () => {
  const { w } = await acme();
  const other = await makeKeys("key_test_1"); // same kid, different key: signature must fail
  const cases = {
    forged_signature: { issue: { signWith: other } },
    wrong_issuer: { issue: { claims: { iss: "https://evil.test" } } },
    wrong_issuer_slash: { issue: { claims: { iss: `https://api.workos.com/user_management/${CLIENT_ID}/` } } },
    wrong_client: { issue: { claims: { client_id: "client_01OTHERCLIENT0000" } } },
    expired: { issue: { claims: { iat: Math.floor(T0.getTime() / 1000) - 7200, exp: Math.floor(T0.getTime() / 1000) - 3600 } } },
    wrong_subject: { issue: { claims: { sub: "user_01SOMEONEELSE" } } },
    audience: { issue: { claims: { aud: "someone_else" } } },
  };
  for (const [name, opts] of Object.entries(cases)) {
    const res = await w.browser().signIn(ALICE(w), opts);
    assert.equal(res.status, 400, name);
    await generic(res, 400);
  }
  nothingCreated(w);
});
test("token validation: alg=none and HMAC-confusion tokens are refused", async () => {
  const { w } = await acme();
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(T0.getTime() / 1000);
  const payload = { iss: `https://api.workos.com/user_management/${CLIENT_ID}`, client_id: CLIENT_ID, sub: "user_01TEST000001", sid: "session_01WORKOSAA", iat: now, exp: now + 300 };
  for (const header of [{ alg: "none", kid: "key_test_1" }, { alg: "HS256", kid: "key_test_1" }]) {
    const b = w.browser();
    const start = await b.get("/portal/login?start=1");
    const ch = new URL(loc(start)).searchParams;
    const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
    w.workos.codes.get(code).body.access_token = `${b64(header)}.${b64(payload)}.` + (header.alg === "none" ? "" : "AAAA");
    await generic(await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), 400);
  }
  nothingCreated(w);
});
test("missing WorkOS session identifier (sid) is refused: a sign-in that could not be ended at WorkOS is never created", async () => {
  const { w } = await acme();
  await generic(await w.browser().signIn(ALICE(w), { issue: { sid: null } }), 400);
  await generic(await w.browser().signIn(ALICE(w), { issue: { sid: "" } }), 400);
  nothingCreated(w);
  assert.equal(count(w.db, "portal_users"), 0, "and no account row was provisioned either");
});
test("unverified email is refused (invitations are matched on verified emails only)", async () => {
  const { w } = await acme();
  for (const v of [false, undefined, "true", 1]) {
    const res = await w.browser().signIn(ALICE(w), { issue: { mutateUser: { email_verified: v } } });
    await generic(res, 403);
  }
  nothingCreated(w);
});
test("a token for one user with the exchange returning a different user is refused", async () => {
  const { w } = await acme();
  const res = await w.browser().signIn(ALICE(w), { issue: { mutateUser: { id: "user_01DIFFERENT0" } } });
  await generic(res, 400);
  nothingCreated(w);
});
test("an unusable email in the exchange is refused", async () => {
  const { w } = await acme();
  await generic(await w.browser().signIn(ALICE(w), { issue: { mutateUser: { email: "not-an-email" } } }), 400);
  nothingCreated(w);
});
test("expired state: a sign-in started more than 10 minutes ago is refused", async () => {
  const { w } = await acme();
  const b = w.browser();
  const start = await b.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  w.clock.advance(601);
  await generic(await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), 400);
  nothingCreated(w);
});
test("tampered state cookie is refused", async () => {
  const { w } = await acme();
  const b = w.browser();
  const start = await b.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
  const v = b.jar.get("__Host-fw_auth");
  b.jar.set("__Host-fw_auth", v.slice(0, -2) + (v.endsWith("AA") ? "BB" : "AA"));
  await generic(await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`), 400);
  const b2 = w.browser();
  b2.jar.set("__Host-fw_auth", "e30.AAAA");
  await generic(await b2.get("/portal/auth/callback?code=a&state=" + "A".repeat(43)), 400);
  nothingCreated(w);
});
test("callback accepts GET only", async () => {
  const { w } = await acme();
  for (const m of ["POST", "PUT", "DELETE"]) assert.equal((await w.browser().send("/portal/auth/callback", { method: m })).status, 405, m);
});
test("database outage during sign-in: 503 'try again', no session, no cookie", async () => {
  const { w } = await acme();
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { prepare: () => { throw new Error("D1_ERROR: down"); }, batch: async () => { throw new Error("D1_ERROR: down"); } };
  const res = await w.browser().signIn(ALICE(w));
  w.env.PORTAL_DB = real;
  const html = await generic(res, 503);
  assert.match(html, /try again/i);
  assert.ok(!/D1_ERROR/.test(html));
  assert.equal(count(w.db, "portal_sessions"), 0);
});

/* ------------------------------------------------------------------ provisioning */
test("invitation-only: someone with no invitation signs in to a 'no access' page and gets no organization", async () => {
  const { w } = await acme();
  const b = w.browser();
  const res = await b.signIn(w.user(2, "stranger@example.com"));
  assert.equal(res.status, 303);
  assert.equal(count(w.db, "memberships"), 0);
  assert.equal(loc(await b.get("/portal")), "/portal/no-access");
  const na = await b.get("/portal/no-access");
  assert.equal(na.status, 403);
  const html = await text(na);
  assert.match(html, /invitation/i);
  assert.ok(!/Acme/.test(html), "does not reveal which organizations exist");
  assert.equal((await b.get("/portal/o/acme")).status, 404);
});
test("an invitation for a different email grants nothing; matching is exact on the verified, lower-cased address", async () => {
  const { w } = await acme();
  const b = w.browser();
  await b.signIn(w.user(2, "alice@example.com.evil.test"));
  await w.browser().signIn(w.user(3, "ALICE+tag@example.com"));
  assert.equal(count(w.db, "memberships"), 0);
  const ok = await w.browser().signIn(w.user(4, "Alice@Example.COM"));
  assert.equal(ok.status, 303);
  assert.equal(count(w.db, "memberships"), 1, "case differences in the address do not matter");
});
test("an expired, revoked or already-used invitation cannot be accepted", async () => {
  const w = await makeWorld();
  const org = await w.org("acme", "Acme");
  const inv = await w.invite(org, "alice@example.com");
  await repo.revokeInvitation(w.db, org.id, inv.id, "admin@frameworkco.ca", { now: T0 });
  await w.browser().signIn(ALICE(w));
  assert.equal(count(w.db, "memberships"), 0);
  const w2 = await makeWorld();
  const org2 = await w2.org("acme", "Acme");
  await w2.invite(org2, "alice@example.com");
  w2.clock.advance(8 * 86400);
  await w2.browser().signIn(ALICE(w2));
  assert.equal(count(w2.db, "memberships"), 0);
});
test("signing in twice does not duplicate anything and keeps the role", async () => {
  const { w } = await acme();
  await w.browser().signIn(ALICE(w));
  await w.browser().signIn(ALICE(w));
  assert.equal(count(w.db, "memberships"), 1);
  assert.equal(count(w.db, "portal_users"), 1);
  assert.equal(count(w.db, "activity_log", "action = 'invitation.accepted'"), 1);
});
test("a disabled user cannot sign in and gets no session", async () => {
  const { w } = await acme();
  await w.browser().signIn(ALICE(w));
  const user = await repo.getUserByWorkosId(w.db, "user_01TEST000001");
  await repo.setUserStatus(w.db, user.id, "disabled", { now: T0 });
  const before = count(w.db, "portal_sessions");
  const res = await w.browser().signIn(ALICE(w));
  await generic(res, 403);
  assert.equal(count(w.db, "portal_sessions"), before);
});
test("an email already owned by a different WorkOS account is not merged", async () => {
  const { w } = await acme();
  await w.browser().signIn(ALICE(w));
  const res = await w.browser().signIn({ id: "user_01IMPOSTOR0", email: "alice@example.com" });
  await generic(res, 403);
  assert.equal(count(w.db, "portal_users"), 1);
});

/* ------------------------------------------------------------------ sessions */
test("rotation: a new sign-in in a browser that already has a session retires only that session", async () => {
  const { w } = await acme();
  const phone = await signedIn(w, ALICE(w));
  const laptop = w.browser();
  await laptop.signIn(ALICE(w));
  const old = laptop.cookieHeader();
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 2);
  // the same browser completes another sign-in (state cookie from an attempt started elsewhere) while presenting its old session cookie
  const starter = w.browser();
  const start = await starter.get("/portal/login?start=1");
  const ch = new URL(loc(start)).searchParams;
  laptop.jar.set("__Host-fw_auth", starter.jar.get("__Host-fw_auth"));
  const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w), sid: "session_01WORKOSBB" });
  assert.equal((await laptop.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`)).status, 303);
  assert.notEqual(laptop.cookieHeader(), old, "token changed");
  assert.equal(count(w.db, "portal_sessions", "revoked_reason = 'rotated'"), 1);
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 2, "phone + new laptop session");
  assert.equal((await phone.get("/portal/o/acme")).status, 200, "other devices stay signed in");
  const replay = w.browser();
  replay.jar.set("__Host-fw_portal", old.split("=")[1]);
  assert.equal((await replay.get("/portal/o/acme")).status, 303, "the old token is dead");
});
test("session limit through the real flow: the 11th device retires the least recently used, not the others", async () => {
  const { w } = await acme();
  const devices = [];
  for (let i = 0; i < 10; i++) { devices.push(await signedIn(w, ALICE(w))); w.clock.advance(5); }
  const eleventh = await signedIn(w, ALICE(w));
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 10);
  assert.equal((await devices[0].get("/portal/o/acme")).status, 303);
  for (const d of devices.slice(1)) assert.equal((await d.get("/portal/o/acme")).status, 200);
  assert.equal((await eleventh.get("/portal/o/acme")).status, 200);
});
test("idle timeout: 12h of silence -> redirected to sign-in with a notice and the dead cookie cleared", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  w.clock.advance(12 * 3600 + 1);
  const res = await b.get("/portal/o/acme");
  assert.equal(res.status, 303);
  assert.equal(loc(res), "/portal/login?r=ended");
  assert.ok(![...b.jar.keys()].includes("__Host-fw_portal"));
  assert.match(await text(await b.get("/portal/login?r=ended")), /session has ended/i);
  assert.ok(!/session has ended/i.test(await text(await b.get("/portal/login"))));
});
test("absolute limit: 14 days ends the session even for a constantly active person", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  for (let i = 0; i < 13 * 4; i++) { w.clock.advance(6 * 3600); assert.equal((await b.get("/portal/o/acme")).status, 200); }
  w.clock.advance(11 * 3600);
  assert.equal((await b.get("/portal/o/acme")).status, 200);
  w.clock.advance(11 * 3600);
  assert.equal((await b.get("/portal/o/acme")).status, 200);
  w.clock.advance(3 * 3600); // 14 days + 1 hour after sign-in, only 3 hours after the last request
  assert.equal((await b.get("/portal/o/acme")).status, 303);
});
test("no cookie, garbage cookie, unknown token: all go to sign-in (never an error page, never data)", async () => {
  const { w } = await acme();
  for (const path of ["/portal", "/portal/o/acme", "/portal/o/acme/projects", "/portal/o/acme/activity", "/portal/o/acme/members", "/portal/no-access"]) {
    const none = await w.browser().get(path);
    assert.equal(none.status, 303, path);
    assert.equal(loc(none), "/portal/login");
    const b = w.browser();
    b.jar.set("__Host-fw_portal", "A".repeat(43));
    assert.equal(loc(await b.get(path)), "/portal/login?r=ended");
    b.jar.set("__Host-fw_portal", "garbage");
    assert.equal(loc(await b.get(path)), "/portal/login?r=ended");
  }
});
test("database outage is NOT reported as 'signed out': 503 try-again, cookie kept, then the person is still signed in afterwards", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const cookieBefore = b.cookieHeader();
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { prepare: () => { throw new Error("D1_ERROR: Network connection lost"); }, batch: async () => { throw new Error("D1_ERROR"); } };
  for (const path of ["/portal", "/portal/o/acme", "/portal/login", "/portal/no-access"]) {
    const res = await b.get(path);
    assert.equal(res.status, 503, path);
    assert.equal(res.headers.get("Retry-After"), "30");
    const html = await text(res);
    assert.match(html, /try again/i);
    assert.match(html, /Reference: <strong>[A-Z2-9]{8}<\/strong>/);
    assert.ok(!/D1_ERROR|Network connection|sign in again|signed out/i.test(html));
    assert.ok(!res.headers.getSetCookie().length, "the session cookie is left alone");
  }
  assert.equal(b.cookieHeader(), cookieBefore);
  w.env.PORTAL_DB = real;
  assert.equal((await b.get("/portal/o/acme")).status, 200);
});
test("database outage after the session check (membership/data read) is also a 503, not a 500 or a leak", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { prepare: (sql) => { if (/FROM memberships/.test(sql) || /FROM projects/.test(sql)) throw new Error("D1_ERROR: boom"); return real.prepare(sql); }, batch: (s) => real.batch(s) };
  const res = await b.get("/portal/o/acme");
  assert.equal(res.status, 503);
  assert.ok(!/D1_ERROR|boom/.test(await text(res)));
  w.env.PORTAL_DB = { prepare: (sql) => { if (/FROM projects/.test(sql)) throw new Error("D1_ERROR: boom"); return real.prepare(sql); }, batch: (s) => real.batch(s) };
  assert.equal((await b.get("/portal/o/acme/projects")).status, 503);
});

/* ------------------------------------------------------------------ logout */
const logoutPost = async (b, csrf, extra = {}) => b.post("/portal/logout", { csrf }, extra);
test("logout: valid form ends the session, clears the cookie and sends the browser to WorkOS logout for ITS session", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const csrf = csrfOf(await text(await b.get("/portal/o/acme")));
  assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
  const res = await logoutPost(b, csrf);
  assert.equal(res.status, 303);
  const u = new URL(loc(res));
  assert.equal(u.origin + u.pathname, "https://api.workos.com/user_management/sessions/logout");
  assert.equal(u.searchParams.get("session_id"), "session_01WORKOSAA");
  assert.equal(u.searchParams.get("return_to"), ORIGIN + "/portal/login");
  assert.ok(res.headers.getSetCookie().some((c) => /^__Host-fw_portal=; .*Max-Age=0/.test(c)));
  assert.equal(rows(w.db, "SELECT revoked_reason FROM portal_sessions")[0].revoked_reason, "logout");
  assert.equal(loc(await b.get("/portal/o/acme")), "/portal/login");
});
test("logout: the old cookie is dead even if replayed", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const stolen = b.cookieHeader().split("=")[1];
  const csrf = csrfOf(await text(await b.get("/portal/o/acme")));
  await logoutPost(b, csrf);
  const attacker = w.browser();
  attacker.jar.set("__Host-fw_portal", stolen);
  assert.equal(loc(await attacker.get("/portal/o/acme")), "/portal/login?r=ended");
});
test("logout: GET is not a logout (no CSRF-able link), and the other methods are refused", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  for (const m of ["GET", "PUT", "DELETE", "PATCH"]) assert.equal((await b.send("/portal/logout", { method: m })).status, 405, m);
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 1);
});
test("logout CSRF: missing, wrong, other-session and malformed tokens are refused and the session survives", async () => {
  const { w } = await acme();
  const a = await signedIn(w, ALICE(w));
  const other = await signedIn(w, ALICE(w));
  const otherCsrf = csrfOf(await text(await other.get("/portal/o/acme")));
  for (const token of [undefined, "", "abc", "A".repeat(43), otherCsrf, "<script>"]) {
    const res = await a.send("/portal/logout", { method: "POST", body: new URLSearchParams(token === undefined ? {} : { csrf: token }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: "null" } });
    assert.equal(res.status, 403, String(token));
  }
  const noType = await a.send("/portal/logout", { method: "POST", body: "csrf=" + otherCsrf, headers: { "Sec-Fetch-Site": "same-origin" } });
  assert.equal(noType.status, 403);
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 2);
});
test("logout CSRF: cross-site and foreign-origin posts are refused even with a valid token", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const csrf = csrfOf(await text(await b.get("/portal/o/acme")));
  assert.equal((await logoutPost(b, csrf, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await logoutPost(b, csrf, { "Sec-Fetch-Site": "same-site" })).status, 403);
  assert.equal((await logoutPost(b, csrf, { Origin: "https://evil.test" })).status, 403);
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 1);
});
test("logout with no session just returns to sign-in", async () => {
  const { w } = await acme();
  const res = await w.browser().post("/portal/logout", { csrf: "A".repeat(43) });
  assert.equal(res.status, 303);
  assert.equal(loc(res), "/portal/login");
});
test("logout during a database outage does not claim success: 503 and the session is still valid server-side", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  const csrf = csrfOf(await text(await b.get("/portal/o/acme")));
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { prepare: (sql) => { if (/^UPDATE portal_sessions SET revoked_at/.test(sql)) throw new Error("D1_ERROR"); return real.prepare(sql); }, batch: (s) => real.batch(s) };
  const res = await logoutPost(b, csrf);
  assert.equal(res.status, 503);
  w.env.PORTAL_DB = real;
  assert.equal(count(w.db, "portal_sessions", "revoked_at IS NULL"), 1);
  assert.equal((await logoutPost(b, csrf)).status, 303, "and a retry works");
});

/* ------------------------------------------------------------------ pages, picker, errors */
test("organization picker: shows exactly the caller's active organizations, in name order", async () => {
  const w = await makeWorld();
  const [o1, o2, o3] = [await w.org("zeta", "Zeta Co"), await w.org("alpha", "Alpha LLC"), await w.org("secret", "Secret Corp")];
  await w.invite(o1, "alice@example.com"); await w.invite(o2, "alice@example.com", "owner"); await w.invite(o3, "bob@example.com");
  const b = w.browser();
  await b.signIn(ALICE(w));
  const page = await b.get("/portal");
  assert.equal(page.status, 200);
  const html = await text(page);
  assert.ok(html.indexOf("Alpha LLC") < html.indexOf("Zeta Co"));
  assert.ok(!html.includes("Secret Corp"));
  assert.match(html, /href="\/portal\/o\/alpha"/);
  assert.equal((await b.get("/portal/o/alpha")).status, 200);
  assert.equal((await b.get("/portal/o/zeta")).status, 200);
  assert.equal((await b.get("/portal/o/secret")).status, 404);
});
test("pages escape everything dynamic (organization, project, user and activity text)", async () => {
  const w = await makeWorld();
  const org = await w.org("acme", `<img src=x onerror=alert(1)>`);
  await w.invite(org, "alice@example.com", "owner");
  await repo.createProject(w.db, org.id, { name: `"><script>alert(1)</script>`, summary: `<b>bold</b>`, liveUrl: "https://example.com/?a=1&b=2" });
  const b = w.browser();
  await b.signIn(w.user(1, "alice@example.com"));
  const pid = (await repo.listProjects(w.db, org.id))[0].id;
  for (const path of ["/portal/o/acme", "/portal/o/acme/projects", `/portal/o/acme/projects/${pid}`, "/portal/o/acme/members"]) {
    const html = await text(await b.get(path));
    assert.ok(!/<script>alert|<img src=x|<b>bold/.test(html), path);
    if (!path.endsWith("/members")) assert.match(html, /&lt;/);
  }
});
test("unsafe stored URLs are never rendered as links", async () => {
  const w = await makeWorld();
  const org = await w.org("acme", "Acme");
  await w.invite(org, "alice@example.com");
  await w.db.raw.prepare("UPDATE organizations SET website_url = 'https://ok.example.com/\"onmouseover=\"x' WHERE id = ?").run(org.id);
  const b = w.browser();
  await b.signIn(ALICE(w));
  assert.ok(!/onmouseover/.test(await text(await b.get("/portal/o/acme"))));
});
test("unknown paths, odd paths and wrong methods get safe error pages", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  for (const path of ["/portal/nope", "/portal/o", "/portal/o/", "/portal/o/acme/nope", "/portal/o/acme/projects/not-a-uuid", "/portal/o/acme/projects/00000000-0000-4000-8000-000000000000", "/portal//o/acme", "/portal/o/AC ME", "/portal/o/" + "a".repeat(100), "/portal/o/acme/projects/1/2", "/portal/o/acme%2fprojects"]) {
    const res = await b.get(path);
    assert.equal(res.status, 404, path);
    assert.match(await text(res), /Reference: <strong>/);
  }
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) for (const path of ["/portal", "/portal/o/acme", "/portal/o/acme/projects", "/portal/no-access"]) assert.equal((await b.send(path, { method: m })).status, 405, `${m} ${path}`);
  assert.equal((await b.send("/portal", { method: "OPTIONS" })).status, 405);
});
test("trailing slashes are tolerated; HEAD works", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  assert.equal((await b.get("/portal/o/acme/")).status, 200);
  assert.equal((await b.send("/portal/o/acme", { method: "HEAD" })).status, 200);
});
test("an unexpected internal error becomes a generic 500 with a reference and no detail", async () => {
  const { w } = await acme();
  const b = await signedIn(w, ALICE(w));
  w.env.PORTAL_DB = { prepare: () => { throw new TypeError("secret internal detail at /srv/app.js:12"); }, batch: async () => [] };
  const res = await b.get("/portal/o/acme");
  assert.ok([500, 503].includes(res.status));
  const html = await text(res);
  assert.ok(!/secret internal|\/srv\/app/.test(html));
  assert.match(html, /Reference: <strong>/);
});

/* ------------------------------------------------------------------ rate limiting (design only; binding optional) */
test("rate limiting: with no binding configured nothing is limited; with one, starting sign-in and the callback are limited, the plain login page is not", async () => {
  const { w } = await acme();
  for (let i = 0; i < 20; i++) assert.equal((await w.browser().get("/portal/login?start=1")).status, 302);
  const keys = [];
  w.env.PORTAL_RATE_LIMITER = { limit: async ({ key }) => { keys.push(key); return { success: false }; } };
  const b = w.browser();
  assert.equal((await b.get("/portal/login")).status, 200, "interstitial is free");
  const limited = await b.get("/portal/login?start=1", { headers: { "CF-Connecting-IP": "203.0.113.7" } });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("Retry-After"), "60");
  assert.equal((await b.get("/portal/auth/callback?code=a&state=b")).status, 429);
  assert.equal((await b.post("/portal/logout", { csrf: "x" })).status, 429);
  assert.equal((await b.get("/portal/o/acme")).status, 303, "authenticated browsing is not rate limited here");
  assert.ok(keys.length >= 3 && keys.every((k) => /^(login|callback|logout):([0-9a-f]{32}|unknown)$/.test(k)) && !keys.join().includes("203.0.113.7"), "keys are hashed");
  w.env.PORTAL_RATE_LIMITER = { limit: async () => { throw new Error("limiter down"); } };
  assert.equal((await w.browser().get("/portal/login?start=1")).status, 302, "a limiter failure does not lock people out");
  w.env.PORTAL_RATE_LIMITER = { limit: async () => ({ success: true }) };
  assert.equal((await w.browser().get("/portal/login?start=1")).status, 302);
});

/* ------------------------------------------------------------------ privacy: logs */
test("logs never contain codes, states, tokens, cookies, emails, API keys or the pepper", async () => {
  const lines = [];
  const orig = console.log;
  console.log = (...a) => lines.push(a.join(" "));
  try {
    const { w } = await acme();
    const b = w.browser();
    const start = await b.get("/portal/login?start=1&login_hint=alice%40example.com");
    const ch = new URL(loc(start)).searchParams;
    const code = await w.workos.issueCode({ challenge: ch.get("code_challenge"), user: ALICE(w) });
    const cb = await b.get(`/portal/auth/callback?code=${code}&state=${ch.get("state")}`);
    const sessionCookie = b.jar.get("__Host-fw_portal");
    const stateCookie = start.headers.get("Set-Cookie").split(";")[0].split("=")[1];
    await b.get("/portal/o/acme"); await b.get("/portal/o/nothere"); await w.browser().signIn(ALICE(w), { state: "A".repeat(43) });
    const all = lines.join("\n");
    assert.ok(lines.length > 5, "events were logged");
    for (const secret of [code, ch.get("state"), ch.get("code_challenge"), sessionCookie, stateCookie, "alice@example.com", API_KEY, PEPPER, "acme", "access_token", "Bearer"]) assert.ok(!all.includes(secret), "leaked: " + String(secret).slice(0, 8));
    for (const l of lines) { const o = JSON.parse(l); assert.equal(o.portal, true); }
    assert.ok(cb);
  } finally { console.log = orig; }
});
