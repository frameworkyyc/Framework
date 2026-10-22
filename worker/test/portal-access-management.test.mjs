// Phase 1 of client access management (data layer only): atomic last-owner protection, safe replacement of invitations, consistent audit entries,
// duplicate handling, organization scoping, structured errors, expiry, retries and idempotency. No routes, no WorkOS, no email.
import test from "node:test";
import assert from "node:assert/strict";
import { openPortalDb, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";

const ADMIN = "admin@frameworkco.ca";
const T = new Date("2026-10-20T12:00:00.000Z");
const at = (days) => new Date(T.getTime() + days * 86400000);
const rows = (db, sql, ...p) => db.raw.prepare(sql).all(...p).map((r) => ({ ...r }));
const audit = (db, where = "1=1") => rows(db, `SELECT organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility FROM activity_log WHERE ${where} ORDER BY created_at, rowid`);
const snapshot = (db) => JSON.stringify(["memberships", "invitations", "activity_log", "organizations", "portal_users"].map((t) => rows(db, `SELECT * FROM ${t} ORDER BY id`)));

async function org(db, slug, name = slug) {
  const r = await repo.createOrganization(db, { slug, name }, { now: T });
  assert.ok(r.ok);
  return r.organization;
}
async function person(db, n) {
  const r = await repo.upsertUserFromIdentity(db, { workosUserId: `user_01PERSON${n}`, email: `person${n}@example.com` }, { now: T });
  assert.ok(r.ok);
  return r.user;
}
/** A person with an ACTIVE membership, made the supported way: an invitation accepted at sign-in. */
async function member(db, o, n, role) {
  const u = await person(db, n);
  const inv = await repo.createInvitation(db, o.id, { email: u.email, role, createdBy: ADMIN }, { now: T });
  assert.ok(inv.ok, JSON.stringify(inv));
  const act = await repo.activatePendingInvitations(db, { user: u, emailVerified: true }, { now: at(0.1) });
  assert.equal(act.activated.length, 1);
  return u;
}
const role = (db, o, u) => repo.getMembership(db, o.id, u.id);

/* ------------------------------------------------------------------ last-owner protection */

test("the only active owner can be neither removed nor demoted: structured error, nothing changed, nothing audited", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const owner = await member(db, o, 1, "owner");
  await member(db, o, 2, "member");
  const before = snapshot(db);
  const removed = await repo.revokeMembership(db, o.id, owner.id, ADMIN, { now: at(1) });
  assert.deepEqual([removed.ok, removed.error], [false, "last_owner"]);
  assert.match(removed.message, /last active owner/);
  const demoted = await repo.setMemberRole(db, o.id, owner.id, "member", ADMIN, { now: at(1) });
  assert.deepEqual([demoted.ok, demoted.error], [false, "last_owner"]);
  assert.equal(snapshot(db), before, "no row changed anywhere, including the audit log");
  assert.equal((await role(db, o, owner)).role, "owner");
});

test("with two owners one may go (or be demoted), and then the other is protected", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "owner");
  assert.equal((await repo.revokeMembership(db, o.id, a.id, ADMIN, { now: at(1) })).ok, true);
  assert.equal((await repo.revokeMembership(db, o.id, b.id, ADMIN, { now: at(1) })).error, "last_owner");
  assert.equal((await repo.setMemberRole(db, o.id, b.id, "member", ADMIN)).error, "last_owner");
  assert.equal((await repo.setMemberRole(db, o.id, b.id, "owner", ADMIN)).changed, false, "setting the role they already have is a harmless no-op");
  // a new owner appears (promotion is always allowed), after which the first can be demoted
  const c = await member(db, o, 3, "member");
  assert.equal((await repo.setMemberRole(db, o.id, c.id, "owner", ADMIN)).ok, true);
  assert.equal((await repo.setMemberRole(db, o.id, b.id, "member", ADMIN)).ok, true);
  assert.equal((await role(db, o, b)).role, "member");
  assert.equal((await role(db, o, c)).role, "owner");
});

test("CONCURRENT removals of the two owners: exactly one succeeds, an owner always remains", async () => {
  for (const order of [0, 1]) {
    const db = openPortalDb();
    const o = await org(db, "acme");
    const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "owner");
    const calls = [() => repo.revokeMembership(db, o.id, a.id, "admin:one", { now: at(1) }), () => repo.revokeMembership(db, o.id, b.id, "admin:two", { now: at(1) })];
    const results = await Promise.all((order ? calls.reverse() : calls).map((f) => f()));
    assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
    assert.equal(results.filter((r) => r.error === "last_owner").length, 1);
    assert.equal(rows(db, "SELECT count(*) AS n FROM memberships WHERE organization_id = ? AND role = 'owner' AND status = 'active'", o.id)[0].n, 1);
    assert.equal(audit(db, "action = 'membership.revoked'").length, 1, "only the change that happened is audited");
  }
});

test("CONCURRENT demotions, and a demotion racing a removal: an owner always remains", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "owner");
  const both = await Promise.all([repo.setMemberRole(db, o.id, a.id, "member", ADMIN), repo.setMemberRole(db, o.id, b.id, "member", ADMIN)]);
  assert.equal(both.filter((r) => r.ok).length, 1);
  const owners = () => rows(db, "SELECT user_id FROM memberships WHERE organization_id = ? AND role = 'owner' AND status = 'active'", o.id).length;
  assert.equal(owners(), 1);
  const remaining = (await role(db, o, a)).role === "owner" ? a : b, demoted = remaining === a ? b : a;
  // the survivor is protected against both a demotion and a removal, however they are raced
  const raced = await Promise.all([repo.setMemberRole(db, o.id, remaining.id, "member", ADMIN), repo.revokeMembership(db, o.id, remaining.id, ADMIN)]);
  assert.deepEqual(raced.map((r) => r.error), ["last_owner", "last_owner"]);
  assert.equal(owners(), 1);
  // while the demoted person (a plain member now) can still be removed
  assert.equal((await repo.revokeMembership(db, o.id, demoted.id, ADMIN)).ok, true);
});

test("the rule lives in the SQL statement, not in a read beforehand: a competing change made just before the write is still caught", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "owner");
  // The caller 'decided' while two owners existed; b is removed in between, then a's removal reaches the database.
  const racing = { ...db, batch: async (s) => { await repo.revokeMembership(db, o.id, b.id, "admin:other"); return db.batch(s); }, prepare: (q) => db.prepare(q) };
  const res = await repo.revokeMembership(racing, o.id, a.id, ADMIN);
  assert.equal(res.error, "last_owner");
  assert.equal((await role(db, o, a)).status, "active");
});

test("an owner whose sign-in is disabled, or whose membership is revoked, does not count as 'another owner'", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "owner");
  db.raw.exec(`UPDATE portal_users SET status = 'disabled', disabled_at = '${T.toISOString()}' WHERE id = '${b.id}'`);
  assert.equal((await repo.revokeMembership(db, o.id, a.id, ADMIN)).error, "last_owner", "b cannot sign in, so a is effectively the only owner");
  assert.equal((await repo.setMemberRole(db, o.id, a.id, "member", ADMIN)).error, "last_owner");
  db.raw.exec(`UPDATE portal_users SET status = 'active', disabled_at = NULL WHERE id = '${b.id}'`);
  assert.equal((await repo.revokeMembership(db, o.id, a.id, ADMIN)).ok, true);
});

test("owners of one organization never count for another organization", async () => {
  const db = openPortalDb();
  const [alpha, bravo] = [await org(db, "alpha"), await org(db, "bravo")];
  const a = await member(db, alpha, 1, "owner");
  await member(db, bravo, 2, "owner");
  assert.equal((await repo.revokeMembership(db, alpha.id, a.id, ADMIN)).error, "last_owner", "bravo's owner is not alpha's second owner");
});

/* ------------------------------------------------------------------ audit trail */

test("every access change writes exactly one internal audit entry in the same transaction, and no entry for a refusal or a repeat", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await member(db, o, 1, "owner"), b = await member(db, o, 2, "member");
  db.raw.exec("DELETE FROM activity_log");
  assert.equal((await repo.setMemberRole(db, o.id, b.id, "owner", ADMIN, { now: at(1) })).ok, true);
  assert.equal((await repo.setMemberRole(db, o.id, b.id, "owner", ADMIN, { now: at(1) })).changed, false);
  assert.equal((await repo.revokeMembership(db, o.id, b.id, ADMIN, { now: at(2) })).ok, true);
  assert.equal((await repo.revokeMembership(db, o.id, b.id, ADMIN, { now: at(2) })).error, "already_revoked");
  assert.equal((await repo.restoreMembership(db, o.id, b.id, { role: "member", actor: ADMIN, now: at(3) })).ok, true);
  assert.equal((await repo.restoreMembership(db, o.id, b.id, { actor: ADMIN })).error, "not_revoked");
  const log = audit(db);
  assert.deepEqual(log.map((r) => r.action), ["membership.role_changed", "membership.revoked", "membership.restored"]);
  for (const r of log) assert.deepEqual([r.organization_id, r.actor_type, r.actor_ref, r.entity_type, r.visibility], [o.id, "admin", ADMIN, "membership", "internal"]);
  assert.deepEqual(JSON.parse(log[0].detail), { user_id: b.id, from: "member", to: "owner" });
  assert.deepEqual(JSON.parse(log[1].detail), { user_id: b.id, role: "owner" });
  assert.deepEqual(JSON.parse(log[2].detail), { user_id: b.id, role: "member" });
  assert.ok(log.every((r) => !/@/.test(r.detail)), "no email address is written to the audit detail");
  assert.equal(a.id === b.id, false);
});

test("the change and its audit entry are one transaction: if the change cannot be written, no audit entry is left", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  await member(db, o, 1, "owner");
  const b = await member(db, o, 2, "member");
  db.raw.exec("DELETE FROM activity_log");
  const broken = { ...db, prepare: (q) => db.prepare(/^UPDATE memberships SET status = 'revoked'/.test(q) ? "UPDATE no_such_table SET x = 1" : q), batch: (s) => db.batch(s) };
  await assert.rejects(() => repo.revokeMembership(broken, o.id, b.id, ADMIN));
  assert.equal(count(db, "activity_log"), 0, "the audit INSERT was rolled back with the failed change");
  assert.equal((await role(db, o, b)).status, "active");
});

test("actors are validated: a change must name who made it", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  await member(db, o, 1, "owner");
  const b = await member(db, o, 2, "member");
  for (const bad of ["", "   ", undefined, null, "a\nb", "x".repeat(255), 42]) {
    assert.equal((await repo.revokeMembership(db, o.id, b.id, bad)).error, "invalid_actor", JSON.stringify(bad));
    assert.equal((await repo.setMemberRole(db, o.id, b.id, "owner", bad)).error, "invalid_actor");
    assert.equal((await repo.restoreMembership(db, o.id, b.id, { actor: bad })).error, "invalid_actor");
    assert.equal((await repo.revokeInvitation(db, o.id, crypto.randomUUID(), bad)).error, "invalid_actor");
    assert.equal((await repo.createInvitation(db, o.id, { email: "x@example.com", role: "member", createdBy: bad })).error, "invalid_actor");
  }
  assert.equal((await role(db, o, b)).status, "active");
});

/* ------------------------------------------------------------------ invitations: duplicates, expiry, replacement */

test("createInvitation: audited; a live invitation blocks a duplicate (naming it); an active member, a suspended or unknown organization are refused with distinct codes", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const first = await repo.createInvitation(db, o.id, { email: "  New@Example.com ", role: "member", createdBy: ADMIN }, { now: T });
  assert.equal(first.ok, true);
  assert.deepEqual(audit(db, "action = 'invitation.created'").map((r) => [r.actor_type, r.actor_ref, r.entity_id, JSON.parse(r.detail)]), [["admin", ADMIN, first.invitation.id, { role: "member" }]]);
  const dup = await repo.createInvitation(db, o.id, { email: "new@example.com", role: "owner", createdBy: ADMIN }, { now: at(1) });
  assert.deepEqual([dup.ok, dup.error, dup.invitationId], [false, "already_pending", first.invitation.id]);
  assert.equal(count(db, "invitations"), 1);
  assert.equal(count(db, "activity_log", "action = 'invitation.created'"), 1, "a refused duplicate writes no audit entry");

  const m = await member(db, o, 7, "member");
  const existing = await repo.createInvitation(db, o.id, { email: m.email, role: "owner", createdBy: ADMIN }, { now: at(1) });
  assert.deepEqual([existing.error, existing.message], ["already_member", "This person already has access to the organization."]);
  assert.equal(count(db, "invitations", `email = '${m.email}' AND status = 'pending'`), 0);

  await repo.setOrganizationStatus(db, o.id, "suspended");
  assert.equal((await repo.createInvitation(db, o.id, { email: "late@example.com", role: "member", createdBy: ADMIN })).error, "organization_inactive");
  assert.equal((await repo.createInvitation(db, crypto.randomUUID(), { email: "late@example.com", role: "member", createdBy: ADMIN })).error, "invalid_organization");
  assert.equal(count(db, "invitations", "email = 'late@example.com'"), 0);
});

test("a removed member can be invited again (membership is reactivated, never duplicated), and the old invitation stays spent", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  await member(db, o, 1, "owner");
  const sam = await member(db, o, 2, "member");
  await repo.revokeMembership(db, o.id, sam.id, ADMIN, { now: at(1) });
  const again = await repo.createInvitation(db, o.id, { email: sam.email, role: "owner", createdBy: ADMIN }, { now: at(2) });
  assert.equal(again.ok, true, "a revoked member is not an 'active member'");
  await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(3) });
  const m = await role(db, o, sam);
  assert.deepEqual([m.status, m.role], ["active", "owner"]);
  assert.equal(count(db, "memberships", `user_id = '${sam.id}'`), 1);
});

test("createInvitation closes a lapsed pending invitation first (with an audit entry); the new one is valid", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const old = (await repo.createInvitation(db, o.id, { email: "late@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  const fresh = await repo.createInvitation(db, o.id, { email: "late@example.com", role: "member", createdBy: ADMIN }, { now: at(8) });
  assert.equal(fresh.ok, true);
  assert.equal((await repo.getInvitation(db, o.id, old.id)).status, "expired");
  assert.deepEqual(audit(db, "action = 'invitation.expired'").map((r) => [r.actor_type, r.entity_id]), [["system", old.id]]);
});

test("replaceInvitation: expired, lapsed and revoked invitations are replaced by a fresh pending one; the old row stays as history", async () => {
  for (const how of ["expired", "lapsed", "revoked"]) {
    const db = openPortalDb();
    const o = await org(db, "acme");
    const old = (await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN, workosInvitationId: "invitation_01OLDONE" }, { now: T })).invitation;
    if (how === "expired") db.raw.exec(`UPDATE invitations SET status = 'expired' WHERE id = '${old.id}'`);
    if (how === "revoked") await repo.revokeInvitation(db, o.id, old.id, ADMIN, { now: at(1) });
    const now = how === "revoked" ? at(2) : at(9);
    const res = await repo.replaceInvitation(db, o.id, old.id, { actor: "admin:two", role: "owner" }, { now });
    assert.equal(res.ok, true, how + " " + JSON.stringify(res));
    assert.equal(res.replaced, old.id);
    const n = res.invitation;
    assert.deepEqual([n.status, n.email, n.role, n.created_by, n.workos_invitation_id, n.expires_at], ["pending", "sam@example.com", "owner", "admin:two", null, new Date(now.getTime() + 7 * 86400000).toISOString()], "a fresh invitation: new role and expiry, and no WorkOS id carried over");
    assert.notEqual(n.id, old.id);
    assert.equal((await repo.getInvitation(db, o.id, old.id)).status, how === "revoked" ? "revoked" : "expired", "history is kept");
    const rep = audit(db, "action = 'invitation.replaced'");
    assert.deepEqual(rep.map((r) => [r.actor_ref, r.entity_id, JSON.parse(r.detail)]), [["admin:two", n.id, { role: "owner", replaces: old.id }]]);
    assert.equal(audit(db, "action = 'invitation.expired'").length, how === "lapsed" ? 1 : 0);
    assert.equal(count(db, "invitations", "status = 'pending'"), 1);
  }
});

test("replaceInvitation refusals: a valid, accepted, foreign, member-already or suspended-organization invitation is not replaced; each has its own code and changes nothing", async () => {
  const db = openPortalDb();
  const [o, other] = [await org(db, "acme"), await org(db, "other")];
  const live = (await repo.createInvitation(db, o.id, { email: "live@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  const sam = await person(db, 1);
  const acc = (await repo.createInvitation(db, o.id, { email: sam.email, role: "member", createdBy: ADMIN }, { now: T })).invitation;
  await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(1) });
  const stale = (await repo.createInvitation(db, o.id, { email: "gone@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  await repo.revokeInvitation(db, o.id, stale.id, ADMIN, { now: at(1) });
  const before = snapshot(db);
  const r = (id, org = o) => repo.replaceInvitation(db, org.id, id, { actor: ADMIN }, { now: at(2) });
  assert.equal((await r(live.id)).error, "still_pending");
  assert.equal((await r(acc.id)).error, "already_accepted");
  assert.equal((await r(live.id, other)).error, "not_found", "another organization's id cannot be used");
  assert.equal((await r(crypto.randomUUID())).error, "not_found");
  assert.equal(snapshot(db), before, "nothing changed");
  // an address that has since joined (revoked invitation, but active membership) is not re-invited
  const joined = (await repo.createInvitation(db, o.id, { email: "joined@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  await repo.revokeInvitation(db, o.id, joined.id, ADMIN, { now: at(1) });
  const jp = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01JOINED", email: "joined@example.com" }, { now: T })).user;
  db.raw.exec(`INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES ('${crypto.randomUUID()}', '${o.id}', '${jp.id}', 'member', 'active', '${T.toISOString()}', 'seed')`);
  assert.equal((await r(joined.id)).error, "already_member");
  await repo.setOrganizationStatus(db, o.id, "suspended");
  assert.equal((await r(stale.id)).error, "organization_inactive");
  assert.equal(count(db, "invitations", "status = 'pending' AND email = 'gone@example.com'"), 0);
});

test("replaceInvitation is retry-safe: repeating it creates no second invitation and no second audit entry, and the error names the live one", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const old = (await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  await repo.revokeInvitation(db, o.id, old.id, ADMIN, { now: at(1) });
  const first = await repo.replaceInvitation(db, o.id, old.id, { actor: ADMIN }, { now: at(2) });
  const retry = await repo.replaceInvitation(db, o.id, old.id, { actor: ADMIN }, { now: at(2) });
  assert.deepEqual([retry.ok, retry.error, retry.invitationId], [false, "already_pending", first.invitation.id]);
  assert.equal(count(db, "invitations", "status = 'pending'"), 1);
  assert.equal(audit(db, "action = 'invitation.replaced'").length, 1);
  // a plain create after the replacement is refused the same way
  const dup = await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: at(2) });
  assert.deepEqual([dup.error, dup.invitationId], ["already_pending", first.invitation.id]);
});

test("revokeInvitation: audited once; repeats and non-pending states give specific errors and change nothing; another organization's id is not_found", async () => {
  const db = openPortalDb();
  const [o, other] = [await org(db, "acme"), await org(db, "other")];
  const inv = (await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  assert.equal((await repo.revokeInvitation(db, other.id, inv.id, ADMIN)).error, "not_found");
  assert.equal((await repo.getInvitation(db, o.id, inv.id)).status, "pending", "the foreign revoke changed nothing");
  assert.deepEqual(await repo.revokeInvitation(db, o.id, inv.id, "admin:x", { now: at(1) }), { ok: true, changed: true });
  const again = await repo.revokeInvitation(db, o.id, inv.id, "admin:x", { now: at(2) });
  assert.deepEqual([again.ok, again.error], [false, "already_revoked"]);
  assert.deepEqual(audit(db, "action = 'invitation.revoked'").map((r) => [r.actor_ref, r.entity_id, JSON.parse(r.detail)]), [["admin:x", inv.id, { role: "member" }]]);
  const exp = (await repo.createInvitation(db, o.id, { email: "e@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  db.raw.exec(`UPDATE invitations SET status = 'expired' WHERE id = '${exp.id}'`);
  assert.equal((await repo.revokeInvitation(db, o.id, exp.id, ADMIN)).error, "already_expired");
  const sam = await person(db, 3);
  const acc = (await repo.createInvitation(db, o.id, { email: sam.email, role: "member", createdBy: ADMIN }, { now: T })).invitation;
  await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(1) });
  assert.equal((await repo.revokeInvitation(db, o.id, acc.id, ADMIN)).error, "already_accepted");
  assert.equal((await repo.revokeInvitation(db, o.id, crypto.randomUUID(), ADMIN)).error, "not_found");
});

test("an expired invitation grants nothing even if nobody has cleaned it up, and a replaced (old) invitation can never be accepted", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const sam = await person(db, 1);
  const old = (await repo.createInvitation(db, o.id, { email: sam.email, role: "owner", createdBy: ADMIN }, { now: T })).invitation;
  assert.equal((await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(8) })).activated.length, 0, "past its date: no access");
  const rep = await repo.replaceInvitation(db, o.id, old.id, { actor: ADMIN, role: "member" }, { now: at(9) });
  assert.equal(rep.ok, true);
  const act = await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(10) });
  assert.equal(act.activated.length, 1);
  assert.equal(act.activated[0].invitationId, rep.invitation.id, "only the replacement is accepted");
  assert.equal((await role(db, o, sam)).role, "member", "with the replacement's role, not the original's");
  assert.equal((await repo.getInvitation(db, o.id, old.id)).status, "expired");
});

/* ------------------------------------------------------------------ organization scoping and data preservation */

test("every membership and invitation operation is scoped to the organization given: another organization's records are never touched", async () => {
  const db = openPortalDb();
  const [alpha, bravo] = [await org(db, "alpha"), await org(db, "bravo")];
  await member(db, alpha, 1, "owner");
  const a2 = await member(db, alpha, 2, "member");
  const b1 = await member(db, bravo, 3, "owner");
  await member(db, bravo, 4, "owner");
  const bInv = (await repo.createInvitation(db, bravo.id, { email: "pending@example.com", role: "member", createdBy: ADMIN }, { now: T })).invitation;
  const before = snapshot(db);
  assert.equal((await repo.revokeMembership(db, alpha.id, b1.id, ADMIN)).error, "not_found");
  assert.equal((await repo.setMemberRole(db, alpha.id, b1.id, "member", ADMIN)).error, "not_found");
  assert.equal((await repo.restoreMembership(db, alpha.id, b1.id, { actor: ADMIN })).error, "not_found");
  assert.equal((await repo.revokeInvitation(db, alpha.id, bInv.id, ADMIN)).error, "not_found");
  assert.equal((await repo.replaceInvitation(db, alpha.id, bInv.id, { actor: ADMIN })).error, "not_found");
  assert.equal((await repo.revokeMembership(db, bravo.id, a2.id, ADMIN)).error, "not_found");
  assert.equal(snapshot(db), before, "byte-for-byte unchanged");
  for (const bad of ["not-a-uuid", "", null, undefined]) {
    await assert.rejects(() => repo.revokeMembership(db, bad, b1.id, ADMIN), (e) => e.code === "invalid_organization_id");
    await assert.rejects(() => repo.replaceInvitation(db, alpha.id, bad, { actor: ADMIN }), (e) => e.code === "invalid_invitation_id");
  }
});

test("removing a member keeps everything the organization owns: Business Profile, projects, feedback and the activity history", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const owner = await member(db, o, 1, "owner");
  const sam = await member(db, o, 2, "member");
  assert.ok((await repo.saveProfileStep(db, o.id, sam.id, "business", { legal: "Acme Co. Ltd.", operating: "Acme" }, { now: at(1) })).ok);
  await repo.createProject(db, o.id, { name: "Acme website" }, { now: at(1) });
  assert.ok((await repo.submitPortalFeedback(db, o.id, sam.id, { kind: "suggestion", message: "Please add X." }, { now: at(1) })).ok);
  const keep = () => JSON.stringify(["business_profile_answers", "projects", "portal_feedback"].map((t) => rows(db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  const before = keep();
  assert.equal((await repo.revokeMembership(db, o.id, sam.id, ADMIN, { now: at(2) })).ok, true);
  assert.equal(keep(), before, "the profile answers, projects and feedback are exactly as they were");
  assert.deepEqual(Object.keys(await repo.getProfileAnswers(db, o.id)).sort(), ["legal", "operating"]);
  assert.equal(owner.id === sam.id, false);
  assert.ok(count(db, "activity_log") > 0, "history stays");
});
