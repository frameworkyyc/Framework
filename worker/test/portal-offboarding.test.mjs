// Emergency offboarding and no-revival of sessions: the atomic library operations (repo/offboarding.js, repo/users.js setUserStatus) and the
// hand-run SQL runbooks in migrations/portal-ops/. The SQL is only ever executed here, against throw-away in-memory databases built from the real migration.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as repo from "../portal/repo/index.js";
import * as store from "../portal/repo/sessions.js";

const OPS = new URL("../../migrations/portal-ops/", import.meta.url);
const OFFBOARD_SQL = readFileSync(new URL("emergency-offboard.sql", OPS), "utf8");
const REENABLE_SQL = readFileSync(new URL("emergency-reenable.sql", OPS), "utf8");
const README = readFileSync(new URL("README.md", OPS), "utf8");
const ACTOR = "admin:test";

const ID = {
  A: "aaaaaaaa-0000-4000-8000-00000000000a", B: "bbbbbbbb-0000-4000-8000-00000000000b", C: "cccccccc-0000-4000-8000-00000000000c",
  T: "11111111-1111-4111-8111-111111111111", O: "22222222-2222-4222-8222-222222222222", N: "99999999-9999-4999-8999-999999999999",
};
const SID = { t1: "1".repeat(64), t2: "2".repeat(64), t3: "3".repeat(64), o1: "4".repeat(64) };
const T0 = "2026-10-01T00:00:00.000Z";
const FAR = "2099-01-01T00:00:00.000Z";

/** A fixed world: a target user T in organizations A (owner) and B (member), already removed from C by someone else; another user O who must never be touched. */
function fixture(db) {
  const x = (sql) => db.raw.exec(sql);
  for (const [id, slug] of [[ID.A, "alpha"], [ID.B, "bravo"], [ID.C, "charlie"]]) x(`INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES ('${id}', '${slug}', '${slug}', 'active', '${T0}', '${T0}')`);
  x(`INSERT INTO portal_users (id, workos_user_id, email, name, status, created_at) VALUES ('${ID.T}', 'user_01TARGET0', 'target@example.com', 'Target', 'active', '${T0}')`);
  x(`INSERT INTO portal_users (id, workos_user_id, email, name, status, created_at) VALUES ('${ID.O}', 'user_01OTHER00', 'other@example.com', 'Other', 'active', '${T0}')`);
  const m = (n, org, user, role, status = "active", extra = "") => x(`INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by${extra ? ", revoked_at, revoked_by" : ""}) VALUES ('00000000-0000-4000-8000-0000000000${n}', '${org}', '${user}', '${role}', '${status}', '${T0}', 'seed'${extra})`);
  m("m1", ID.A, ID.T, "owner"); m("m2", ID.B, ID.T, "member"); m("m3", ID.C, ID.T, "member", "revoked", `, '${T0}', 'someone-else'`);
  m("m4", ID.A, ID.O, "member"); m("m5", ID.B, ID.O, "owner");
  const inv = (n, org, email, status, extra = "") => x(`INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at${extra ? ", accepted_at, accepted_user_id" : ""}) VALUES ('10000000-0000-4000-8000-0000000000${n}', '${org}', '${email}', 'member', '${status}', '${T0}', 'seed', '${FAR}'${extra})`);
  inv("i1", ID.C, "target@example.com", "pending");           // would re-grant access later: must be revoked
  inv("i2", ID.C, "other@example.com", "pending");            // someone else's: must survive
  inv("i3", ID.A, "unrelated@example.com", "pending");        // unrelated: must survive
  inv("i4", ID.A, "target@example.com", "accepted", `, '${T0}', '${ID.T}'`); // history: must stay accepted
  const ses = (id, user, extra = "") => x(`INSERT INTO portal_sessions (id, user_id, workos_session_id, created_at, last_seen_at, idle_expires_at, expires_at${extra ? ", revoked_at, revoked_reason" : ""}) VALUES ('${id}', '${user}', 'session_01WORKOS', '${T0}', '${T0}', '${FAR}', '${FAR}'${extra})`);
  ses(SID.t1, ID.T); ses(SID.t2, ID.T); ses(SID.t3, ID.T, `, '${T0}', 'logout'`); ses(SID.o1, ID.O);
  x(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, visibility, created_at) VALUES ('20000000-0000-4000-8000-000000000001', '${ID.A}', 'admin', 'seed', 'project.created', 'client', '${T0}')`);
}
const TABLES = ["organizations", "portal_users", "memberships", "invitations", "portal_sessions", "activity_log", "projects"];
const dump = (db) => Object.fromEntries(TABLES.map((t) => [t, rows(db, `SELECT * FROM ${t} ORDER BY id`)]));
const keyed = (d) => new Map(TABLES.flatMap((t) => d[t].map((r) => [t + ":" + r.id, JSON.stringify(r)])));
/** Which rows were added, changed or removed between two dumps. */
function changes(before, after) {
  const b = keyed(before), a = keyed(after);
  return { added: [...a.keys()].filter((k) => !b.has(k)), changed: [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k)), removed: [...b.keys()].filter((k) => !a.has(k)) };
}
/** Comparable form: ids of generated audit rows and all timestamps are ignored. */
function normalized(d) {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
  return JSON.stringify(Object.fromEntries(TABLES.map((t) => [t, d[t].map((r) => {
    const o = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? "<time>" : v]));
    if (t === "activity_log" && ["user.offboarded", "member.offboarded", "user.reenabled"].includes(r.action)) delete o.id;
    return o;
  }).map((o) => JSON.stringify(o)).sort()])));
}
const fill = (sql, id = ID.T, actor = ACTOR) => sql.replaceAll("__USER_ID__", id).replaceAll("__ACTOR__", actor);
const statementsOf = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const freshWorld = () => { const db = openPortalDb(); fixture(db); return db; };
const active = (db, id) => store.findActiveSession(db, id, { now: new Date("2026-10-20T00:00:00Z") });

/* ------------------------------------------------------------------ the library operation */
test("offboardUser: disables the user and revokes sessions, memberships and pending invitations, writes audit entries, and touches nothing else", async () => {
  const db = freshWorld();
  const before = dump(db);
  const r = await repo.offboardUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-20T12:00:00Z") });
  assert.deepEqual(r, { ok: true, sessionsRevoked: 2, membershipsRevoked: 2, invitationsRevoked: 1, auditEntries: 3 });
  const after = dump(db);
  const c = changes(before, after);
  assert.deepEqual(c.removed, [], "nothing is ever deleted");
  assert.deepEqual(c.changed.sort(), [`invitations:10000000-0000-4000-8000-0000000000i1`, `memberships:00000000-0000-4000-8000-0000000000m1`, `memberships:00000000-0000-4000-8000-0000000000m2`, `portal_sessions:${SID.t1}`, `portal_sessions:${SID.t2}`, `portal_users:${ID.T}`].sort(), "only the target's own rows changed");
  assert.equal(c.added.length, 3);
  assert.ok(c.added.every((k) => k.startsWith("activity_log:")));
  const u = rows(db, "SELECT status, disabled_at FROM portal_users WHERE id = ?", ID.T)[0];
  assert.equal(u.status, "disabled");
  assert.equal(u.disabled_at, "2026-10-20T12:00:00.000Z");
  assert.deepEqual(rows(db, "SELECT id, revoked_reason FROM portal_sessions WHERE user_id = ? ORDER BY id", ID.T).map((s) => s.revoked_reason), ["user_offboarded", "user_offboarded", "logout"]);
  assert.equal(rows(db, "SELECT revoked_at FROM portal_sessions WHERE id = ?", SID.t3)[0].revoked_at, T0, "an already-revoked session keeps its original time and reason");
  assert.deepEqual(rows(db, "SELECT organization_id, status, revoked_by FROM memberships WHERE user_id = ? ORDER BY organization_id", ID.T).map((m) => [m.organization_id, m.status, m.revoked_by]), [[ID.A, "revoked", "offboard:" + ACTOR], [ID.B, "revoked", "offboard:" + ACTOR], [ID.C, "revoked", "someone-else"]]);
  const inviteStatus = Object.fromEntries(rows(db, "SELECT id, status FROM invitations").map((i) => [i.id.slice(-2), i.status]));
  assert.deepEqual(inviteStatus, { i1: "revoked", i2: "pending", i3: "pending", i4: "accepted" }, "only the user's own pending invitation was revoked");
  assert.equal(rows(db, "SELECT revoked_by FROM invitations WHERE id LIKE '%i1'")[0].revoked_by, "offboard:" + ACTOR);
  const audit = rows(db, "SELECT organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility FROM activity_log WHERE action LIKE '%offboarded' ORDER BY action, organization_id");
  assert.deepEqual(audit.map((a) => [a.action, a.organization_id, a.visibility, a.entity_id, a.actor_ref, a.actor_type]), [
    ["member.offboarded", ID.A, "internal", ID.T, ACTOR, "admin"], ["member.offboarded", ID.B, "internal", ID.T, ACTOR, "admin"], ["user.offboarded", null, "internal", ID.T, ACTOR, "admin"],
  ], "one entry per organization actually removed (not C: that membership was already revoked by someone else), plus one for the user; never client-visible");
});
test("offboardUser is idempotent: a second run (even much later) changes nothing and adds no audit entries", async () => {
  const db = freshWorld();
  await repo.offboardUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-20T12:00:00Z") });
  const once = dump(db);
  const r = await repo.offboardUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-25T12:00:00Z") });
  assert.deepEqual(r, { ok: true, sessionsRevoked: 0, membershipsRevoked: 0, invitationsRevoked: 0, auditEntries: 0 });
  assert.deepEqual(dump(db), once);
});
test("offboardUser: unknown users, bad ids and bad actor labels change nothing", async () => {
  const db = freshWorld();
  const before = dump(db);
  assert.deepEqual(await repo.offboardUser(db, ID.N, { actor: ACTOR }), { ok: false, error: "not_found" });
  for (const actor of [undefined, "", "has space", "x".repeat(101), "a;b", "a'b", 5]) assert.deepEqual(await repo.offboardUser(db, ID.T, { actor }), { ok: false, error: "invalid_actor" }, String(actor));
  for (const bad of ["", "nope", "' OR '1'='1", undefined, null]) await assert.rejects(() => repo.offboardUser(db, bad, { actor: ACTOR }), /invalid_user_id/);
  assert.deepEqual(dump(db), before);
});
test("offboardUser is atomic: if any statement fails, nothing at all is applied", async () => {
  const db = freshWorld();
  const before = dump(db);
  const broken = { prepare: (sql) => db.prepare(sql.includes("member.offboarded") ? "INSERT INTO table_that_does_not_exist (x) VALUES (1)" : sql), batch: (s) => db.batch(s) };
  await assert.rejects(() => repo.offboardUser(broken, ID.T, { actor: ACTOR }));
  assert.deepEqual(dump(db), before, "the user is still active, sessions and memberships untouched");
  assert.equal(rows(db, "SELECT status FROM portal_users WHERE id = ?", ID.T)[0].status, "active");
});

/* ------------------------------------------------------------------ no revival of sessions */
test("setUserStatus: disabling revokes sessions in the same atomic step; re-enabling never revives them, and never restores memberships", async () => {
  const db = freshWorld();
  assert.ok(await active(db, SID.t1));
  await repo.setUserStatus(db, ID.T, "disabled", { now: new Date("2026-10-20T01:00:00Z") });
  assert.equal(await active(db, SID.t1), null);
  assert.deepEqual(rows(db, "SELECT revoked_reason FROM portal_sessions WHERE id IN (?, ?) ORDER BY id", SID.t1, SID.t2).map((r) => r.revoked_reason), ["user_disabled", "user_disabled"]);
  assert.equal(rows(db, "SELECT revoked_reason FROM portal_sessions WHERE id = ?", SID.t3)[0].revoked_reason, "logout", "history keeps its reason");
  const memberships = rows(db, "SELECT id, status FROM memberships ORDER BY id");
  await repo.setUserStatus(db, ID.T, "active", { now: new Date("2026-10-20T02:00:00Z") });
  assert.equal(await active(db, SID.t1), null, "re-enabling does not revive the old sessions");
  assert.equal(await active(db, SID.t2), null);
  assert.deepEqual(rows(db, "SELECT id, status FROM memberships ORDER BY id"), memberships, "re-enabling restores no membership");
  assert.equal(rows(db, "SELECT status FROM invitations WHERE id LIKE '%i1'")[0].status, "pending", "setUserStatus alone does not touch invitations");
});
test("a disable that bypassed revocation (raw SQL) cannot be undone into live sessions: re-enabling kills the survivors", async () => {
  const db = freshWorld();
  db.raw.exec(`UPDATE portal_users SET status = 'disabled', disabled_at = '${T0}' WHERE id = '${ID.T}'`);
  assert.equal(rows(db, "SELECT count(*) AS n FROM portal_sessions WHERE user_id = ? AND revoked_at IS NULL", ID.T)[0].n, 2, "the raw disable left both sessions unrevoked");
  assert.equal(await active(db, SID.t1), null, "but the status check already refuses them");
  await repo.setUserStatus(db, ID.T, "active", { now: new Date("2026-10-20T02:00:00Z") });
  assert.equal(await active(db, SID.t1), null);
  assert.equal(await active(db, SID.t2), null);
  assert.deepEqual(rows(db, "SELECT revoked_reason FROM portal_sessions WHERE id IN (?, ?) ORDER BY id", SID.t1, SID.t2).map((r) => r.revoked_reason), ["user_reenabled", "user_reenabled"]);
});
test("re-enabling an ALREADY ACTIVE user (or anyone else) signs nobody out", async () => {
  const db = freshWorld();
  const before = dump(db);
  await repo.setUserStatus(db, ID.T, "active", { now: new Date("2026-10-20T02:00:00Z") });
  assert.equal(rows(db, "SELECT count(*) AS n FROM portal_sessions WHERE revoked_at IS NULL").n ?? rows(db, "SELECT count(*) AS n FROM portal_sessions WHERE revoked_at IS NULL")[0].n, 3);
  assert.deepEqual(changes(before, dump(db)).changed, [], "no row changed");
  await repo.setUserStatus(db, ID.T, "disabled");
  await repo.setUserStatus(db, ID.T, "active");
  assert.ok(await active(db, SID.o1), "another user's session is untouched throughout");
});
test("setUserStatus keeps its contract: unknown user, bad status", async () => {
  const db = freshWorld();
  assert.deepEqual(await repo.setUserStatus(db, ID.N, "disabled"), { ok: false, error: "not_found" });
  assert.deepEqual(await repo.setUserStatus(db, ID.N, "active"), { ok: false, error: "not_found" });
  assert.equal((await repo.setUserStatus(db, ID.T, "banned")).error, "invalid_status");
  const first = (await repo.setUserStatus(db, ID.T, "disabled", { now: new Date("2026-10-20T01:00:00Z") })).user.disabled_at;
  assert.equal((await repo.setUserStatus(db, ID.T, "disabled", { now: new Date("2026-10-21T01:00:00Z") })).user.disabled_at, first, "the original disable time is kept");
});

/* ------------------------------------------------------------------ reenableUser */
test("reenableUser: re-activates, keeps sessions/memberships/invitations revoked, records one audit entry, and is idempotent", async () => {
  const db = freshWorld();
  await repo.offboardUser(db, ID.T, { actor: ACTOR });
  const afterOffboard = dump(db);
  const r = await repo.reenableUser(db, ID.T, { actor: "admin:two" });
  assert.deepEqual(r, { ok: true, sessionsRevoked: 0, auditEntries: 1 });
  assert.equal(rows(db, "SELECT status, disabled_at FROM portal_users WHERE id = ?", ID.T)[0].status, "active");
  const c = changes(afterOffboard, dump(db));
  assert.deepEqual(c.changed, [`portal_users:${ID.T}`]);
  assert.equal(c.added.length, 1);
  assert.deepEqual(rows(db, "SELECT action, organization_id, actor_ref, visibility FROM activity_log WHERE action = 'user.reenabled'").map((r) => ({ ...r })), [{ action: "user.reenabled", organization_id: null, actor_ref: "admin:two", visibility: "internal" }]);
  assert.equal(count(db, "memberships", "user_id = ? AND status = 'active'", ID.T), 0, "no membership came back");
  assert.equal(count(db, "portal_sessions", "user_id = ? AND revoked_at IS NULL", ID.T), 0);
  assert.equal(rows(db, "SELECT status FROM invitations WHERE id LIKE '%i1'")[0].status, "revoked");
  const once = dump(db);
  assert.deepEqual(await repo.reenableUser(db, ID.T, { actor: "admin:two" }), { ok: true, sessionsRevoked: 0, auditEntries: 0 });
  assert.deepEqual(dump(db), once, "repeating changes nothing and adds no audit entry");
});
test("reenableUser: a user who was never offboarded gets no misleading audit entry; unknown users and bad input change nothing", async () => {
  const db = freshWorld();
  const before = dump(db);
  assert.deepEqual(await repo.reenableUser(db, ID.O, { actor: ACTOR }), { ok: true, sessionsRevoked: 0, auditEntries: 0 });
  assert.deepEqual(changes(before, dump(db)).changed, []);
  assert.deepEqual(await repo.reenableUser(db, ID.N, { actor: ACTOR }), { ok: false, error: "not_found" });
  assert.deepEqual(await repo.reenableUser(db, ID.T, { actor: "bad actor" }), { ok: false, error: "invalid_actor" });
  await assert.rejects(() => repo.reenableUser(db, "nope", { actor: ACTOR }), /invalid_user_id/);
});
test("offboard, re-enable and offboard again are each recorded once", async () => {
  const db = freshWorld();
  await repo.offboardUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-20T01:00:00Z") });
  await repo.reenableUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-20T02:00:00Z") });
  await repo.restoreMembership(db, ID.A, ID.T, { actor: "admin:test" });
  await repo.offboardUser(db, ID.T, { actor: ACTOR, now: new Date("2026-10-20T03:00:00Z") });
  assert.equal(count(db, "activity_log", "action = 'user.offboarded'"), 2);
  assert.equal(count(db, "activity_log", "action = 'user.reenabled'"), 1);
  assert.equal(count(db, "activity_log", "action = 'member.offboarded' AND organization_id = ?", ID.A), 2, "the second removal from A is a new event");
  assert.equal(count(db, "activity_log", "action = 'member.offboarded' AND organization_id = ?", ID.B), 1);
});

/* ------------------------------------------------------------------ the whole thing through the real router */
test("end to end: two devices are cut off, sign-in is refused while disabled, re-enabling brings back NO access, and access returns only when granted again", async () => {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), bravo = await w.org("bravo", "Bravo Co"), gamma = await w.org("gamma", "Gamma Co");
  await w.invite(alpha, "alice@example.com", "owner");
  await w.invite(bravo, "alice@example.com", "member");
  const alice = w.user(1, "alice@example.com");
  const phone = w.browser(), laptop = w.browser();
  assert.equal((await phone.signIn(alice)).status, 303);
  assert.equal((await laptop.signIn(alice)).status, 303);
  await w.invite(gamma, "alice@example.com", "member"); // pending: would grant access at her next sign-in
  assert.equal((await phone.get("/portal/o/alpha")).status, 200);
  const aliceId = (await repo.getUserByWorkosId(w.db, alice.id)).id;
  const bobSession = w.browser();
  await bobSession.signIn(w.user(2, "bob@example.com")); // another person, no access; must be unaffected
  const r = await repo.offboardUser(w.db, aliceId, { actor: ACTOR, now: w.clock.now() });
  assert.deepEqual([r.sessionsRevoked, r.membershipsRevoked, r.invitationsRevoked], [2, 2, 1]);
  for (const b of [phone, laptop]) for (const p of ["/portal", "/portal/o/alpha", "/portal/o/bravo/projects"]) {
    const res = await b.get(p);
    assert.equal(res.status, 303, p);
    assert.match(res.headers.get("Location"), /^\/portal\/login/, p);
  }
  assert.equal((await bobSession.get("/portal/no-access")).status, 403, "bob is still signed in");
  const blocked = await w.browser().signIn(alice);
  assert.equal(blocked.status, 403, "a disabled user cannot sign in");
  assert.equal(count(w.db, "portal_sessions", "user_id = ? AND revoked_at IS NULL", aliceId), 0);
  await repo.reenableUser(w.db, aliceId, { actor: ACTOR, now: w.clock.now() });
  assert.equal((await phone.get("/portal/o/alpha")).status, 303, "the old phone cookie stays dead after re-enabling");
  const fresh = w.browser();
  assert.equal((await fresh.signIn(alice)).status, 303, "a fresh sign-in works");
  assert.equal((await fresh.get("/portal")).headers.get("Location"), "/portal/no-access", "but she has no organizations");
  for (const slug of ["alpha", "bravo", "gamma"]) assert.equal((await fresh.get("/portal/o/" + slug)).status, 404, slug);
  assert.equal(count(w.db, "memberships", "user_id = ? AND status = 'active'", aliceId), 0, "signing in did not resurrect anything, and the revoked invitation granted nothing");
  await repo.restoreMembership(w.db, alpha.id, aliceId, { actor: "admin:test" });
  assert.equal((await fresh.get("/portal/o/alpha")).status, 200, "access returns only when granted again on purpose");
  assert.equal((await fresh.get("/portal/o/bravo")).status, 404);
  await w.invite(gamma, "alice@example.com", "member"); // a NEW invitation works as usual
  assert.equal((await w.browser().signIn(alice)).status, 303);
  assert.equal(count(w.db, "memberships", "user_id = ? AND organization_id = ? AND status = 'active'", aliceId, gamma.id), 1);
});

/* ------------------------------------------------------------------ the SQL runbooks */
test("runbook SQL = library: emergency-offboard.sql gives exactly the same result as offboardUser (ignoring generated ids and timestamps)", async () => {
  const bySql = freshWorld(), byCode = freshWorld();
  bySql.raw.exec(fill(OFFBOARD_SQL));
  await repo.offboardUser(byCode, ID.T, { actor: ACTOR });
  assert.equal(normalized(dump(bySql)), normalized(dump(byCode)));
  const s = rows(bySql, "SELECT status FROM portal_users WHERE id = ?", ID.T)[0].status;
  assert.equal(s, "disabled");
  assert.equal(count(bySql, "activity_log", "action = 'member.offboarded'"), 2);
});
test("runbook SQL = library: emergency-reenable.sql gives exactly the same result as reenableUser", async () => {
  const bySql = freshWorld(), byCode = freshWorld();
  await repo.offboardUser(bySql, ID.T, { actor: ACTOR });
  await repo.offboardUser(byCode, ID.T, { actor: ACTOR });
  bySql.raw.exec(fill(REENABLE_SQL, ID.T, "admin:two"));
  await repo.reenableUser(byCode, ID.T, { actor: "admin:two" });
  assert.equal(normalized(dump(bySql)), normalized(dump(byCode)));
});
test("runbook SQL is repeatable: running the file again changes nothing and adds no duplicate audit entries", () => {
  for (const [file, sql] of [["offboard", OFFBOARD_SQL], ["reenable", REENABLE_SQL]]) {
    const db = freshWorld();
    if (file === "reenable") db.raw.exec(fill(OFFBOARD_SQL));
    db.raw.exec(fill(sql));
    const once = dump(db);
    db.raw.exec(fill(sql));
    db.raw.exec(fill(sql));
    assert.equal(normalized(dump(db)), normalized(once), file);
    assert.equal(JSON.stringify(dump(db)), JSON.stringify(once), file + ": byte-for-byte identical, timestamps included");
  }
});
test("partial failure: stopping the offboarding file after ANY statement and then rerunning the whole file ends in exactly the full result, with no duplicate audit entries", () => {
  const statements = statementsOf(fill(OFFBOARD_SQL));
  assert.equal(statements.length, 6);
  const full = freshWorld();
  full.raw.exec(fill(OFFBOARD_SQL));
  const expected = normalized(dump(full));
  for (let k = 0; k <= statements.length; k++) {
    const db = freshWorld();
    for (const st of statements.slice(0, k)) db.raw.exec(st);
    if (k > 0 && k < 3) assert.ok(count(db, "portal_users", "id = ? AND status = 'disabled'", ID.T) === 1, `after ${k} statement(s) the urgent effect (disable) is already in place`);
    db.raw.exec(fill(OFFBOARD_SQL));
    assert.equal(normalized(dump(db)), expected, `stopped after statement ${k}`);
    assert.equal(count(db, "activity_log", "action = 'user.offboarded'"), 1, `no duplicate user entry (k=${k})`);
    assert.equal(count(db, "activity_log", "action = 'member.offboarded'"), 2, `no duplicate organization entries (k=${k})`);
  }
});
test("partial failure: the same holds for the re-enable file", () => {
  const statements = statementsOf(fill(REENABLE_SQL));
  assert.equal(statements.length, 3);
  const full = freshWorld();
  full.raw.exec(fill(OFFBOARD_SQL));
  full.raw.exec(fill(REENABLE_SQL));
  const expected = normalized(dump(full));
  for (let k = 0; k <= statements.length; k++) {
    const db = freshWorld();
    db.raw.exec(fill(OFFBOARD_SQL));
    for (const st of statements.slice(0, k)) db.raw.exec(st);
    db.raw.exec(fill(REENABLE_SQL));
    assert.equal(normalized(dump(db)), expected, `stopped after statement ${k}`);
    assert.equal(count(db, "activity_log", "action = 'user.reenabled'"), 1, `k=${k}`);
  }
});
test("the SQL cannot affect other users or organizations: wrong, empty or unreplaced ids change nothing, and only the named user's rows ever change", () => {
  for (const sql of [OFFBOARD_SQL, REENABLE_SQL]) {
    for (const id of [ID.N, "", "__USER_ID__", "not-a-uuid"]) {
      const db = freshWorld();
      const before = dump(db);
      db.raw.exec(sql.replaceAll("__USER_ID__", id).replaceAll("__ACTOR__", ACTOR));
      assert.deepEqual(changes(before, dump(db)), { added: [], changed: [], removed: [] }, `id=${JSON.stringify(id)}`);
    }
  }
  const db = freshWorld();
  const before = dump(db);
  db.raw.exec(fill(OFFBOARD_SQL, ID.O));
  const c = changes(before, dump(db));
  assert.ok(!c.changed.some((k) => k.includes(SID.t1) || k.includes(SID.t2) || k.includes(ID.T)), "target T was not touched when O was offboarded");
  assert.deepEqual(c.changed.filter((k) => k.startsWith("invitations:")), [`invitations:10000000-0000-4000-8000-0000000000i2`], "only O's own pending invitation");
  assert.equal(count(db, "memberships", "user_id = ? AND status = 'active'", ID.T), 2);
});
test("the SQL files are reviewed, narrow and non-destructive", () => {
  for (const [name, sql] of [["emergency-offboard.sql", OFFBOARD_SQL], ["emergency-reenable.sql", REENABLE_SQL]]) {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(!/\b(DELETE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|ATTACH|TRIGGER|REPLACE|TRUNCATE|CREATE)\b/i.test(code), name);
    assert.deepEqual([...new Set(code.match(/__[A-Z_]+__/g))].sort(), ["__ACTOR__", "__USER_ID__"], name);
    const stmts = statementsOf(sql);
    for (const st of stmts) {
      assert.ok(/^(UPDATE|INSERT INTO)\b/.test(st), `${name}: only UPDATE / INSERT: ${st.slice(0, 40)}`);
      assert.ok(st.includes("__USER_ID__"), `${name}: every statement is scoped to the one user id: ${st.slice(0, 60)}`);
      assert.ok(/\bWHERE\b/i.test(st), `${name}: every statement has a WHERE: ${st.slice(0, 60)}`);
    }
    for (const t of code.match(/\b(?:UPDATE|INTO|FROM)\s+(\w+)/gi).map((x) => x.split(/\s+/)[1])) assert.ok(["portal_users", "portal_sessions", "memberships", "invitations", "activity_log"].includes(t), `${name}: ${t}`);
    assert.match(sql, /^-- Framework client portal/, name);
    assert.match(sql, /Do NOT assume the D1 Console runs|run the WHOLE file/i);
  }
  assert.ok(!/memberships|invitations/.test(REENABLE_SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")), "re-enabling never touches memberships or invitations");
  assert.ok(!readdirSync(new URL("../../migrations/portal/", import.meta.url)).some((f) => /offboard|reenable/i.test(f)), "not in the migrations folder wrangler applies");
  assert.deepEqual(readdirSync(OPS).filter((f) => f.startsWith("emergency-") || f === "README.md").sort(), ["README.md", "emergency-offboard.sql", "emergency-reenable.sql"], "the emergency files are exactly these two; onboarding runbooks are pinned in portal-onboarding.test.mjs");
});
test("the runbook README documents the procedure, partial-failure recovery and verification, and does not claim the console is atomic", () => {
  for (const needle of ["Do not assume the D1 Console is atomic", "partial-failure recovery", "Run the **entire** file", "Verify (read-only)", "unrevoked_sessions", "active_memberships", "pending_invitations", "emergency-reenable.sql", "restores **no** access", "PORTAL_SESSION_PEPPER", "WorkOS", "NOT", "outside the repository"]) assert.ok(README.includes(needle) || README.toLowerCase().includes(needle.toLowerCase()), needle);
  assert.ok(!/atomically|single transaction/i.test(README.replace(/Do not assume[^\n]*\n/g, "").replace(/atomic D1 batch/g, "")) || /may run the statements one at a time/.test(README));
});
