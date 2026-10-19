// Client portal Stage 2B: server-side sessions, lifecycle and fail-closed behaviour (fake clock, real migration, D1-shaped database).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import * as store from "../portal/repo/sessions.js";
import * as S from "../portal/sessions.js";
import { SESSION_COOKIE } from "../portal/http.js";

const PEPPER = "Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0";
const CFG = Object.freeze({ pepper: PEPPER, origin: "https://staging.frameworkco.ca" });
const T0 = new Date("2026-10-20T12:00:00.000Z");
const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
const H = 3600;

async function setup() {
  const db = openPortalDb();
  const user = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01AAAAAA", email: "a@example.com" }, { now: T0 })).user;
  const other = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01BBBBBB", email: "b@example.com" }, { now: T0 })).user;
  return { db, user, other };
}
const login = (db, user, now = T0, extra = {}) => S.startSession(CFG, db, { userId: user.id, workosSessionId: "session_01WORKOS0", authMethod: "magic_auth", ip: "203.0.113.5", ...extra }, { now });
const cookieValue = (setCookie) => /^__Host-fw_portal=([^;]+);/.exec(setCookie)[1];
const reqWith = (setCookie) => new Request("https://staging.frameworkco.ca/portal", { headers: { Cookie: `${SESSION_COOKIE}=${cookieValue(setCookie)}` } });
const reqToken = (token) => new Request("https://staging.frameworkco.ca/portal", { headers: { Cookie: `${SESSION_COOKIE}=${token}` } });

test("login creates a fresh session; the database holds a hash, never the token, the address or the email", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  assert.ok(r.ok);
  const token = cookieValue(r.cookie);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  const [row] = rows(db, "SELECT * FROM portal_sessions");
  assert.match(row.id, /^[0-9a-f]{64}$/);
  assert.equal(row.user_id, user.id);
  assert.equal(row.workos_session_id, "session_01WORKOS0");
  assert.equal(row.auth_method, "magic_auth");
  assert.equal(row.created_at, T0.toISOString());
  assert.equal(row.idle_expires_at, at(12 * H).toISOString());
  assert.equal(row.expires_at, at(14 * 86400).toISOString());
  assert.equal(row.revoked_at, null);
  const dump = JSON.stringify(rows(db, "SELECT * FROM portal_sessions"));
  for (const secret of [token, "203.0.113.5", "a@example.com"]) assert.ok(!dump.includes(secret), "not stored: " + secret.slice(0, 6));
  assert.match(row.ip_hash, /^[0-9a-f]{32}$/);
});
test("the session cookie carries the right flags and lives until the absolute deadline", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  assert.match(r.cookie, /^__Host-fw_portal=[A-Za-z0-9_-]{43}; Path=\/; Max-Age=1209600; HttpOnly; Secure; SameSite=Lax$/);
  assert.ok(!/Domain/i.test(r.cookie));
});
test("every login gets a different token, and logging in does NOT revoke other sessions", async () => {
  const { db, user } = await setup();
  const a = await login(db, user);
  const b = await login(db, user, at(60));
  assert.notEqual(cookieValue(a.cookie), cookieValue(b.cookie));
  assert.equal(count(db, "portal_sessions", "revoked_at IS NULL"), 2);
  assert.ok((await S.authenticate(reqWith(a.cookie), CFG, db, { now: at(120) })).ok, "the first browser stays signed in");
  assert.ok((await S.authenticate(reqWith(b.cookie), CFG, db, { now: at(120) })).ok);
});
test("authenticate: returns the user, never an organization; unknown, malformed and missing cookies are refused", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const a = await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(5) });
  assert.ok(a.ok);
  assert.equal(a.session.userId, user.id);
  assert.equal(a.session.email, "a@example.com");
  assert.equal(a.session.workosSessionId, "session_01WORKOS0");
  assert.ok(!("organizationId" in a.session) && !("memberships" in a.session));
  assert.equal((await S.authenticate(new Request("https://x.test/"), CFG, db, { now: at(5) })).reason, "no_session");
  assert.equal((await S.authenticate(reqToken(""), CFG, db, { now: at(5) })).reason, "no_session");
  for (const bad of ["short", "x".repeat(44), "a b", "../../etc", "x".repeat(43) + "=", "é".repeat(43)]) assert.equal((await S.authenticate(reqToken(bad), CFG, db, { now: at(5) })).reason, "invalid", bad);
  assert.equal((await S.authenticate(reqToken("A".repeat(43)), CFG, db, { now: at(5) })).reason, "invalid", "well-formed but unknown");
  const dup = new Request("https://x.test/", { headers: { Cookie: `${SESSION_COOKIE}=${cookieValue(r.cookie)}; ${SESSION_COOKIE}=${"A".repeat(43)}` } });
  assert.equal((await S.authenticate(dup, CFG, db, { now: at(5) })).reason, "no_session", "duplicate cookies are ambiguous");
});
test("a token valid under one pepper is not valid under another", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  assert.equal((await S.authenticate(reqWith(r.cookie), { ...CFG, pepper: "q".repeat(40) }, db, { now: at(5) })).ok, false);
});
test("idle expiry: 12 hours of silence ends the session; activity slides the deadline", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(11 * H) })).ok);
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(22 * H) })).ok, "11h after the last use is still inside the idle window");
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(33 * H) })).ok);
  const quiet = await login(db, user, at(100 * H));
  assert.equal((await S.authenticate(reqWith(quiet.cookie), CFG, db, { now: at(112 * H) })).ok, false, "exactly at the idle deadline: expired");
  assert.equal((await S.authenticate(reqWith(quiet.cookie), CFG, db, { now: at(112 * H + 1) })).ok, false, "and asking again does not revive it");
});
test("idle boundary is exact: one second before is valid, the deadline itself is not", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const req = reqWith(r.cookie);
  assert.equal((await store.findActiveSession(db, (await rowId(db)), { now: at(12 * H - 1) })) !== null, true);
  assert.equal(await store.findActiveSession(db, await rowId(db), { now: at(12 * H) }), null);
  void req;
});
const rowId = async (db, n = 0) => rows(db, "SELECT id FROM portal_sessions ORDER BY created_at, id")[n].id;
test("absolute expiry: 14 days ends the session however active it is, and the idle window never extends past it", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  for (let step = 1; step <= 13 * 4; step++) assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(step * 6 * H) })).ok, "6-hour step " + step);
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(13 * 86400 + 11 * H) })).ok);
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(13 * 86400 + 22 * H) })).ok);
  const [mid] = rows(db, "SELECT idle_expires_at, expires_at FROM portal_sessions");
  assert.ok(mid.idle_expires_at <= mid.expires_at);
  assert.ok((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(14 * 86400 - 60) })).ok);
  const [late] = rows(db, "SELECT idle_expires_at, expires_at FROM portal_sessions");
  assert.equal(late.idle_expires_at, late.expires_at, "clamped to the absolute deadline");
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(14 * 86400) })).ok, false);
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(14 * 86400 + 3600) })).ok, false);
});
test("touching is throttled: a burst of requests writes once", async () => {
  const { db, user } = await setup();
  await login(db, user);
  const id = await rowId(db);
  assert.equal(await store.touchSession(db, id, { now: at(10) }), false);
  assert.equal(await store.touchSession(db, id, { now: at(59) }), false);
  assert.equal(await store.touchSession(db, id, { now: at(60) }), true);
  assert.equal(await store.touchSession(db, id, { now: at(61) }), false);
  assert.equal(rows(db, "SELECT last_seen_at FROM portal_sessions")[0].last_seen_at, at(60).toISOString());
  assert.equal(await store.touchSession(db, id, { now: at(13 * H) }), false, "an expired session cannot be touched back to life");
});
test("logout: revokes server-side, clears the cookie, returns the WorkOS session id, and is idempotent", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const out = await S.endSession(reqWith(r.cookie), CFG, db, { now: at(30) });
  assert.equal(out.revoked, true);
  assert.equal(out.workosSessionId, "session_01WORKOS0");
  assert.match(out.cookie, /^__Host-fw_portal=; Path=\/; Max-Age=0; HttpOnly; Secure; SameSite=Lax$/);
  const [row] = rows(db, "SELECT revoked_at, revoked_reason FROM portal_sessions");
  assert.equal(row.revoked_at, at(30).toISOString());
  assert.equal(row.revoked_reason, "logout");
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(31) })).ok, false, "the old cookie is dead even if the browser replays it");
  const again = await S.endSession(reqWith(r.cookie), CFG, db, { now: at(40) });
  assert.equal(again.revoked, false);
  assert.equal(again.workosSessionId, null);
  assert.equal(rows(db, "SELECT revoked_at FROM portal_sessions")[0].revoked_at, at(30).toISOString(), "original revocation time kept");
});
test("logout without a usable cookie still clears it and touches nothing", async () => {
  const { db, user } = await setup();
  await login(db, user);
  for (const req of [new Request("https://x.test/"), reqToken("junk"), reqToken("A".repeat(43))]) {
    const out = await S.endSession(req, CFG, db, { now: at(5) });
    assert.match(out.cookie, /Max-Age=0/);
    assert.equal(out.revoked, false);
  }
  assert.equal(count(db, "portal_sessions", "revoked_at IS NULL"), 1);
});
test("logout only ends the session that signed out; other browsers stay signed in", async () => {
  const { db, user } = await setup();
  const a = await login(db, user);
  const b = await login(db, user, at(10));
  await S.endSession(reqWith(a.cookie), CFG, db, { now: at(20) });
  assert.equal((await S.authenticate(reqWith(a.cookie), CFG, db, { now: at(30) })).ok, false);
  assert.equal((await S.authenticate(reqWith(b.cookie), CFG, db, { now: at(30) })).ok, true);
});
test("WorkOS logout URL: built only from a valid session id and the supplied return URL", () => {
  const u = new URL(S.workosLogoutUrl(CFG, "session_01WORKOS0", "https://staging.frameworkco.ca/portal/login"));
  assert.equal(u.origin + u.pathname, "https://api.workos.com/user_management/sessions/logout");
  assert.equal(u.searchParams.get("session_id"), "session_01WORKOS0");
  assert.equal(u.searchParams.get("return_to"), "https://staging.frameworkco.ca/portal/login");
  for (const bad of [null, undefined, "", "x", "a b&c=d", "s".repeat(129), 5]) assert.equal(S.workosLogoutUrl(CFG, bad, "https://x.test"), null);
});
test("a WorkOS session id is REQUIRED to create a session (sign-in must be revocable at the identity provider)", async () => {
  const { db, user } = await setup();
  for (const workosSessionId of [undefined, null, "", "x", "bad id", "s".repeat(129), 5, {}]) {
    const r = await login(db, user, T0, { workosSessionId });
    assert.deepEqual(r, { ok: false, error: "workos_session_missing" }, String(workosSessionId));
  }
  assert.equal(count(db, "portal_sessions"), 0);
  assert.equal((await store.createSession(db, { id: "a".repeat(64), userId: user.id, workosSessionId: null })).error, "invalid_workos_session_id");
});
test("session limit: the 11th login revokes only the least-recently-used session; everything else survives", async () => {
  const { db, user, other } = await setup();
  const otherSession = await login(db, other, at(1));
  const cookies = [];
  for (let i = 0; i < 10; i++) cookies.push((await login(db, user, at(10 + i))).cookie);
  assert.equal(await store.countActiveSessions(db, user.id, { now: at(100) }), 10);
  const eleventh = await login(db, user, at(100));
  assert.ok(eleventh.ok);
  assert.equal(await store.countActiveSessions(db, user.id, { now: at(101) }), 10, "never more than 10");
  assert.equal((await S.authenticate(reqWith(cookies[0]), CFG, db, { now: at(101) })).ok, false, "the oldest was retired");
  for (const c of cookies.slice(1)) assert.ok((await S.authenticate(reqWith(c), CFG, db, { now: at(101) })).ok);
  assert.ok((await S.authenticate(reqWith(eleventh.cookie), CFG, db, { now: at(101) })).ok);
  assert.ok((await S.authenticate(reqWith(otherSession.cookie), CFG, db, { now: at(101) })).ok, "another user's session is never touched");
  const retired = rows(db, "SELECT revoked_reason FROM portal_sessions WHERE revoked_at IS NOT NULL");
  assert.deepEqual(retired.map((r) => r.revoked_reason), ["session_limit"]);
});
test("session limit counts only ACTIVE sessions: expired and revoked ones do not block a login or get re-revoked", async () => {
  const { db, user } = await setup();
  for (let i = 0; i < 10; i++) await login(db, user, at(i));
  const later = at(13 * H); // all ten are idle-expired
  const r = await login(db, user, later);
  assert.ok(r.ok);
  assert.equal(count(db, "portal_sessions", "revoked_at IS NOT NULL"), 0, "expired sessions are left as they are, nothing active was retired");
  assert.equal(await store.countActiveSessions(db, user.id, { now: later }), 1);
});
test("session limit recently-used ordering: a session in active use is kept over an idle one", async () => {
  const { db, user } = await setup();
  const cookies = [];
  for (let i = 0; i < 10; i++) cookies.push((await login(db, user, at(i))).cookie);
  await S.authenticate(reqWith(cookies[0]), CFG, db, { now: at(500) }); // oldest login, newest use
  await login(db, user, at(600));
  assert.ok((await S.authenticate(reqWith(cookies[0]), CFG, db, { now: at(601) })).ok, "the one in use survives");
  assert.equal((await S.authenticate(reqWith(cookies[1]), CFG, db, { now: at(601) })).ok, false, "the longest-idle one was retired");
});
test("session limit is atomic: a failed insert rolls back the retirement", async () => {
  const { db, user } = await setup();
  for (let i = 0; i < 10; i++) await login(db, user, at(i));
  const id = await rowId(db, 3);
  await assert.rejects(() => store.createSession(db, { id, userId: user.id, workosSessionId: "session_01WORKOS0" }, { now: at(100) }), /UNIQUE|constraint/i);
  assert.equal(count(db, "portal_sessions", "revoked_at IS NULL"), 10, "nothing was retired by the failed attempt");
});
test("createSession refuses bad input and unknown or disabled users", async () => {
  const { db, user } = await setup();
  const good = { id: "a".repeat(64), userId: user.id, workosSessionId: "session_01WORKOS0" };
  await assert.rejects(() => store.createSession(db, { ...good, id: "short" }), /invalid_session_id/);
  await assert.rejects(() => store.createSession(db, { ...good, id: "G".repeat(64) }), /invalid_session_id/);
  await assert.rejects(() => store.createSession(db, { ...good, userId: "nope" }), /invalid_user_id/);
  assert.equal((await store.createSession(db, { ...good, authMethod: "Bad Method" })).error, "invalid_auth_method");
  assert.equal((await store.createSession(db, { ...good, ipHash: "zz" })).error, "invalid_ip_hash");
  assert.equal((await store.createSession(db, good, { maxActive: 0 })).error, "invalid_limit");
  assert.equal((await store.createSession(db, good, { maxActive: 1000 })).error, "invalid_limit");
  assert.equal((await store.createSession(db, good, { idleSeconds: 10 })).error, "invalid_lifetime");
  assert.equal((await store.createSession(db, good, { idleSeconds: 3600, absoluteSeconds: 60 })).error, "invalid_lifetime");
  assert.equal((await store.createSession(db, { ...good, userId: "11111111-1111-4111-8111-111111111111" })).error, "user_not_active");
  await repo.setUserStatus(db, user.id, "disabled", { now: T0 });
  assert.equal((await login(db, user)).error, "user_not_active");
  assert.equal(count(db, "portal_sessions"), 0);
});
test("a disabled user's existing sessions stop working immediately, even without revocation", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  await repo.setUserStatus(db, user.id, "disabled", { now: at(5) });
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(6) })).ok, false);
  await repo.setUserStatus(db, user.id, "active", { now: at(7) });
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, db, { now: at(8) })).ok, true, "re-enabling does not need a new login only because nothing was revoked");
});
test("disableUser: disables and revokes all sessions atomically, leaves other users alone", async () => {
  const { db, user, other } = await setup();
  const a = await login(db, user);
  await login(db, user, at(1));
  const b = await login(db, other, at(2));
  const res = await S.disableUser(db, user.id, { now: at(50) });
  assert.deepEqual(res, { ok: true, revoked: 2 });
  assert.equal(rows(db, "SELECT status FROM portal_users WHERE id = ?", user.id)[0].status, "disabled");
  assert.equal(count(db, "portal_sessions", "user_id = ? AND revoked_reason = 'user_disabled'", user.id), 2);
  assert.equal((await S.authenticate(reqWith(a.cookie), CFG, db, { now: at(51) })).ok, false);
  assert.equal((await S.authenticate(reqWith(b.cookie), CFG, db, { now: at(51) })).ok, true);
  assert.equal((await S.disableUser(db, "11111111-1111-4111-8111-111111111111")).error, "not_found");
});
test("revokeAllSessions: all of a user's sessions, optionally keeping one; already-revoked rows keep their reason", async () => {
  const { db, user, other } = await setup();
  const a = await login(db, user);
  const b = await login(db, user, at(1));
  await login(db, other, at(2));
  await S.endSession(reqWith(a.cookie), CFG, db, { now: at(3) });
  const keep = await rowId(db, 1);
  const res = await S.revokeAllSessions(db, user.id, "password_changed", { exceptId: keep, now: at(4) });
  assert.equal(res.revoked, 0, "the only other active one is the one kept");
  assert.equal((await S.revokeAllSessions(db, user.id, "admin_action", { now: at(5) })).revoked, 1);
  assert.equal((await S.authenticate(reqWith(b.cookie), CFG, db, { now: at(6) })).ok, false);
  assert.equal(rows(db, "SELECT revoked_reason FROM portal_sessions WHERE revoked_reason = 'logout'").length, 1);
  assert.equal(count(db, "portal_sessions", "user_id != ? AND revoked_at IS NOT NULL", user.id), 0);
  assert.equal((await S.revokeAllSessions(db, user.id, "Bad Reason!")).error, "invalid_reason");
  assert.equal((await store.revokeSession(db, await rowId(db), "x y")).error, "invalid_reason");
});
test("purge removes only sessions that ended more than the retention period ago", async () => {
  const { db, user } = await setup();
  await login(db, user, T0);
  const live = await login(db, user, at(40 * 86400));
  const revoked = await login(db, user, at(41 * 86400));
  await S.endSession(reqWith(revoked.cookie), CFG, db, { now: at(41 * 86400 + 5) });
  const now = at(60 * 86400);
  const res = await store.purgeEndedSessions(db, { now, retainDays: 30 });
  assert.equal(res.deleted, 1, "only the one that expired 46 days ago; the one revoked 19 days ago stays");
  assert.ok((await S.authenticate(reqWith(live.cookie), CFG, db, { now: at(40 * 86400 + H) })).ok);
  assert.equal((await store.purgeEndedSessions(db, { retainDays: 0 })).error, "invalid_retention");
});
test("CSRF: the sign-out token belongs to one session", async () => {
  const { db, user } = await setup();
  const a = await S.authenticate(reqWith((await login(db, user)).cookie), CFG, db, { now: at(1) });
  const b = await S.authenticate(reqWith((await login(db, user, at(2))).cookie), CFG, db, { now: at(3) });
  const token = await S.csrfFor(CFG, a.session);
  assert.ok(await S.checkCsrf(CFG, a.session, token));
  assert.ok(!(await S.checkCsrf(CFG, b.session, token)), "another session's token");
  assert.ok(!(await S.checkCsrf(CFG, a.session, "")));
  assert.ok(!(await S.checkCsrf(CFG, a.session, undefined)));
});

/* ------------------------------------------------------------------ fail closed */
const brokenDb = (real, failing) => ({
  prepare(sql) {
    if (failing.test(sql)) throw new Error("D1_ERROR: database unavailable");
    return real.prepare(sql);
  },
  batch: (s) => real.batch(s),
});
test("fail closed: if the store errors while validating, nobody is signed in and nothing throws", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const res = await S.authenticate(reqWith(r.cookie), CFG, brokenDb(db, /SELECT/), { now: at(5) });
  assert.deepEqual(res, { ok: false, reason: "store_error" });
});
test("fail closed: a store that returns nothing, or garbage, never authenticates", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const nothing = { prepare: () => ({ bind: () => ({ first: async () => null, run: async () => ({ meta: { changes: 0 } }) }) }) };
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, nothing, { now: at(5) })).ok, false);
  const rejects = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("boom")) }) }) };
  assert.equal((await S.authenticate(reqWith(r.cookie), CFG, rejects, { now: at(5) })).reason, "store_error");
});
test("a failed idle-extension write does not sign the person out (the session was valid when read)", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const res = await S.authenticate(reqWith(r.cookie), CFG, brokenDb(db, /^UPDATE/), { now: at(120) });
  assert.equal(res.ok, true);
});
test("fail closed: login reports a store failure and issues no cookie", async () => {
  const { db, user } = await setup();
  const failing = { prepare: (s) => db.prepare(s), batch: async () => { throw new Error("D1_ERROR"); } };
  const r = await S.startSession(CFG, failing, { userId: user.id, workosSessionId: "session_01WORKOS0" }, { now: T0 });
  assert.deepEqual(r, { ok: false, error: "store_error" });
  assert.equal(count(db, "portal_sessions"), 0);
});
test("logout with a failing store still clears the cookie and reports the error", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const out = await S.endSession(reqWith(r.cookie), CFG, brokenDb(db, /./), { now: at(5) });
  assert.match(out.cookie, /Max-Age=0/);
  assert.equal(out.error, "store_error");
  assert.equal(out.revoked, false);
});

/* ------------------------------------------------------------------ database rules */
test("the database itself rejects inconsistent session rows", async () => {
  const { db, user } = await setup();
  const ins = (o) => db.raw.prepare("INSERT INTO portal_sessions (id,user_id,created_at,last_seen_at,idle_expires_at,expires_at,revoked_at,revoked_reason) VALUES (?,?,?,?,?,?,?,?)")
    .run(o.id ?? "b".repeat(64), user.id, o.c ?? "2026-10-20T00:00:00.000Z", "2026-10-20T00:00:00.000Z", o.i ?? "2026-10-20T01:00:00.000Z", o.e ?? "2026-10-21T00:00:00.000Z", o.ra ?? null, o.rr ?? null);
  assert.throws(() => ins({ i: "2026-10-22T00:00:00.000Z" }), /constraint/i, "idle after absolute");
  assert.throws(() => ins({ e: "2026-10-19T00:00:00.000Z", i: "2026-10-19T00:00:00.000Z" }), /constraint/i, "expires before created");
  assert.throws(() => ins({ ra: "2026-10-20T00:00:00.000Z" }), /constraint/i, "revoked without reason");
  assert.throws(() => ins({ rr: "x" }), /constraint/i, "reason without time");
  assert.throws(() => ins({ id: "short" }), /constraint/i);
});

/* ------------------------------------------------------------------ mechanical checks */
test("SQL scan: every portal_sessions statement is bound by user or by session id (or is the reviewed housekeeping purge)", () => {
  const src = readFileSync(new URL("../portal/repo/sessions.js", import.meta.url), "utf8");
  const sql = [...src.matchAll(/`\s*((?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?)`|"((?:SELECT|INSERT|UPDATE|DELETE)\b[^"]*)"/g)].map((m) => m[1] || m[2]);
  assert.ok(sql.length >= 9, "the scan found the statements: " + sql.length);
  let purge = 0;
  for (const s of sql) {
    if (/DELETE FROM portal_sessions/.test(s)) { purge++; assert.match(s, /expires_at < \?/); continue; }
    assert.match(s, /\b(user_id|s\.id|id) = \?/, "statement not bound to a user or session:\n" + s);
  }
  assert.equal(purge, 1);
  for (const s of sql) for (const m of s.matchAll(/\$\{([^}]*)\}/g)) assert.equal(m[1].trim(), "ACTIVE", "unreviewed interpolation in SQL");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/\bdb\.(raw|exec)\b/.test(code));
});
test("no session secret ever reaches a log or an error message", async () => {
  const { db, user } = await setup();
  const r = await login(db, user);
  const token = cookieValue(r.cookie);
  const out = await S.authenticate(reqWith(r.cookie), CFG, brokenDb(db, /SELECT/), { now: at(5) });
  assert.ok(!JSON.stringify(out).includes(token));
  for (const f of ["../portal/sessions.js", "../portal/repo/sessions.js"]) assert.ok(!/console\.|logEvent/.test(readFileSync(new URL(f, import.meta.url), "utf8")), f + " does not log");
});
