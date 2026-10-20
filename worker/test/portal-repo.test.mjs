// Client portal Stage 1: repository behaviour, including idempotent and atomic invitation acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (days, from = NOW) => new Date(from.getTime() + days * 86400000);
const ADMIN = "admin@frameworkco.ca";

async function org(db, slug, extra = {}) {
  const r = await repo.createOrganization(db, { slug, name: slug.toUpperCase(), ...extra }, { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  return r.organization;
}
async function user(db, wid, email, name) {
  const r = await repo.upsertUserFromIdentity(db, { workosUserId: wid, email, name }, { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  return r.user;
}
async function invite(db, o, email, role = "member", extra = {}) {
  const r = await repo.createInvitation(db, o.id, { email, role, createdBy: ADMIN, ...extra }, { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  // The data layer audits invitation creation itself (covered in portal-access-management.test.mjs). The acceptance tests below count the audit entries
  // that ACCEPTANCE writes, so the creation entry is removed here to keep those assertions about one thing.
  db.raw.exec("DELETE FROM activity_log WHERE action IN ('invitation.created', 'invitation.expired')");
  return r.invitation;
}
/** A second active owner, so the last-owner rule does not stand in the way of tests that are about something else. */
async function otherOwner(db, o, n = 1) {
  const u = await user(db, "user_01OWNER" + n, `owner${n}@example.com`);
  await invite(db, o, u.email, "owner");
  await activate(db, u);
  return u;
}
const activate = (db, u, over = {}, now = at(1)) => repo.activatePendingInvitations(db, { user: u, emailVerified: true, ...over }, { now });

/* ------------------------------------------------------------------ organizations */

test("organizations: create, read, update, suspend/archive/restore; clean errors for bad input and duplicates", async () => {
  const db = openPortalDb();
  const a = await org(db, "acme-surveys", { websiteUrl: "https://example.com", revenueClientId: "client-77" });
  assert.equal(a.status, "active");
  assert.equal(a.website_url, "https://example.com/");
  assert.equal(a.revenue_client_id, "client-77");
  assert.equal((await repo.getOrganizationBySlug(db, "acme-surveys")).id, a.id);
  assert.equal(await repo.getOrganizationBySlug(db, "Acme-Surveys"), null, "slugs are lower-case only");
  assert.deepEqual(await repo.createOrganization(db, { slug: "acme-surveys", name: "Again" }), { ok: false, error: "slug_taken" });
  assert.deepEqual(await repo.createOrganization(db, { slug: "other", name: "Other", revenueClientId: "client-77" }), { ok: false, error: "revenue_client_taken" });
  for (const [input, error] of [[{ slug: "Bad Slug", name: "x" }, "invalid_slug"], [{ slug: "ok-slug", name: "" }, "invalid_name"], [{ slug: "ok-slug", name: "x", websiteUrl: "http://nope" }, "invalid_website_url"], [{ slug: "ok-slug", name: "x", revenueClientId: 5 }, "invalid_revenue_client_id"], [undefined, "invalid_slug"]]) assert.deepEqual(await repo.createOrganization(db, input), { ok: false, error }, error);

  const up = await repo.updateOrganization(db, a.id, { name: "Acme Surveys Ltd.", websiteUrl: null }, { now: at(2) });
  assert.equal(up.organization.name, "Acme Surveys Ltd.");
  assert.equal(up.organization.website_url, null);
  assert.equal(up.organization.updated_at, at(2).toISOString());
  assert.equal((await repo.updateOrganization(db, a.id, {})).error, "nothing_to_update");
  assert.equal((await repo.updateOrganization(db, crypto.randomUUID(), { name: "x" })).error, "not_found");

  assert.equal((await repo.setOrganizationStatus(db, a.id, "archived", { now: at(3) })).organization.archived_at, at(3).toISOString());
  assert.equal((await repo.setOrganizationStatus(db, a.id, "active")).organization.archived_at, null);
  assert.equal((await repo.setOrganizationStatus(db, a.id, "deleted")).error, "invalid_status");
  assert.deepEqual((await repo.listOrganizations(db)).map((o) => o.slug), ["acme-surveys"]);
  assert.deepEqual(await repo.listOrganizations(db, { status: "archived" }), []);
  assert.deepEqual(await repo.listOrganizations(db, { status: "bogus" }), []);
});

/* ------------------------------------------------------------------ users: one record per WorkOS user */

test("users: signing in is idempotent, one row per WorkOS user, email follows WorkOS, name is kept", async () => {
  const db = openPortalDb();
  const first = await user(db, "user_01AAAAA", "  Sam@Example.com ", "Sam Lee");
  assert.equal(first.email, "sam@example.com");
  const again = await repo.upsertUserFromIdentity(db, { workosUserId: "user_01AAAAA", email: "sam@example.com" }, { now: at(5) });
  assert.equal(again.user.id, first.id, "same WorkOS user, same portal user");
  assert.equal(again.user.name, "Sam Lee", "a missing name does not erase the stored one");
  assert.equal(again.user.last_login_at, at(5).toISOString());
  assert.equal(count(db, "portal_users"), 1);
  const moved = await repo.upsertUserFromIdentity(db, { workosUserId: "user_01AAAAA", email: "sam@new.example.com" });
  assert.equal(moved.user.id, first.id);
  assert.equal(moved.user.email, "sam@new.example.com");
  assert.equal(count(db, "portal_users"), 1);
});

test("users: an email that belongs to a different WorkOS user is a conflict, never a merge", async () => {
  const db = openPortalDb();
  const a = await user(db, "user_01AAAAA", "a@example.com");
  assert.deepEqual(await repo.upsertUserFromIdentity(db, { workosUserId: "user_01BBBBB", email: "A@example.com" }), { ok: false, error: "email_conflict" });
  assert.equal(count(db, "portal_users"), 1);
  assert.equal((await repo.getUserById(db, a.id)).workos_user_id, "user_01AAAAA");
  const b = await user(db, "user_01BBBBB", "b@example.com");
  assert.deepEqual(await repo.upsertUserFromIdentity(db, { workosUserId: "user_01BBBBB", email: "a@example.com" }), { ok: false, error: "email_conflict" });
  assert.equal((await repo.getUserById(db, b.id)).email, "b@example.com");
});

test("users: validation, lookups, and a disabled user stays disabled across sign-ins", async () => {
  const db = openPortalDb();
  for (const [input, error] of [[{ workosUserId: "x", email: "a@example.com" }, "invalid_workos_user_id"], [{ workosUserId: "user_01AAAAA", email: "nope" }, "invalid_email"], [{ workosUserId: "user_01AAAAA", email: "a@example.com", name: "a\nb" }, "invalid_name"], [undefined, "invalid_workos_user_id"]]) assert.equal((await repo.upsertUserFromIdentity(db, input)).error, error, error);
  const u = await user(db, "user_01AAAAA", "a@example.com");
  assert.equal((await repo.getUserByWorkosId(db, "user_01AAAAA")).id, u.id);
  assert.equal((await repo.getUserByEmail(db, " A@EXAMPLE.com")).id, u.id);
  assert.equal(await repo.getUserByWorkosId(db, "nope"), null);
  assert.equal(await repo.getUserByEmail(db, "bad"), null);
  const off = await repo.setUserStatus(db, u.id, "disabled", { now: at(1) });
  assert.equal(off.user.status, "disabled");
  assert.ok(off.user.disabled_at);
  const login = await repo.upsertUserFromIdentity(db, { workosUserId: "user_01AAAAA", email: "a@example.com" }, { now: at(2) });
  assert.equal(login.user.status, "disabled", "signing in does not re-enable a disabled user");
  assert.equal((await repo.setUserStatus(db, u.id, "active")).user.disabled_at, null);
  assert.equal((await repo.setUserStatus(db, u.id, "banned")).error, "invalid_status");
});

/* ------------------------------------------------------------------ invitations */

test("invitations: create, list, revoke; email normalised; clean errors; a valid pending invitation blocks a duplicate", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const inv = await invite(db, o, "  New.Person@Example.com ", "owner");
  assert.equal(inv.email, "new.person@example.com");
  assert.equal(inv.status, "pending");
  assert.equal(inv.role, "owner");
  assert.equal(inv.expires_at, at(7).toISOString());
  assert.equal(inv.created_by, ADMIN);
  const dup = await repo.createInvitation(db, o.id, { email: "NEW.person@example.com", role: "member", createdBy: ADMIN }, { now: NOW });
  assert.deepEqual([dup.ok, dup.error, dup.invitationId], [false, "already_pending", inv.id], "the structured error names the live invitation");
  assert.ok(dup.message);
  for (const [input, error] of [[{ email: "bad", role: "member", createdBy: ADMIN }, "invalid_email"], [{ email: "a@example.com", role: "admin", createdBy: ADMIN }, "invalid_role"], [{ email: "a@example.com", role: "member", createdBy: "" }, "invalid_actor"], [{ email: "a@example.com", role: "member", createdBy: ADMIN, expiresInDays: 0 }, "invalid_expiry"], [{ email: "a@example.com", role: "member", createdBy: ADMIN, expiresInDays: 31 }, "invalid_expiry"], [{ email: "a@example.com", role: "member", createdBy: ADMIN, workosInvitationId: "x" }, "invalid_workos_invitation_id"]]) assert.equal((await repo.createInvitation(db, o.id, input, { now: NOW })).error, error, error);
  assert.equal((await repo.createInvitation(db, crypto.randomUUID(), { email: "a@example.com", role: "member", createdBy: ADMIN })).error, "invalid_organization", "unknown organization");
  assert.deepEqual((await repo.listInvitations(db, o.id)).map((i) => i.id), [inv.id]);
  assert.equal((await repo.revokeInvitation(db, o.id, inv.id, ADMIN, { now: at(1) })).ok, true);
  assert.equal((await repo.getInvitation(db, o.id, inv.id)).status, "revoked");
  assert.equal((await repo.revokeInvitation(db, o.id, inv.id, ADMIN)).error, "already_revoked", "already revoked");
  const again = await invite(db, o, "new.person@example.com"); // a revoked invitation does not block a new one
  assert.equal(again.status, "pending");
  assert.deepEqual((await repo.listInvitations(db, o.id, { status: "pending" })).map((i) => i.id), [again.id]);
});

test("invitations: an EXPIRED pending invitation never blocks a new one, and the old one is closed", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const old = await invite(db, o, "a@example.com", "member", { expiresInDays: 1 });
  const fresh = await repo.createInvitation(db, o.id, { email: "a@example.com", role: "owner", createdBy: ADMIN }, { now: at(2) });
  assert.ok(fresh.ok);
  assert.equal((await repo.getInvitation(db, o.id, old.id)).status, "expired");
  assert.equal(fresh.invitation.status, "pending");
});

test("invitations: workos id can be attached once while pending and is unique", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const a = await invite(db, o, "a@example.com");
  const b = await invite(db, o, "b@example.com");
  assert.ok((await repo.attachWorkosInvitationId(db, o.id, a.id, "invitation_01AAAA")).ok);
  assert.equal((await repo.attachWorkosInvitationId(db, o.id, b.id, "invitation_01AAAA")).error, "workos_invitation_taken");
  assert.equal((await repo.attachWorkosInvitationId(db, o.id, b.id, "x")).error, "invalid_workos_invitation_id");
  await repo.revokeInvitation(db, o.id, b.id, ADMIN);
  assert.equal((await repo.attachWorkosInvitationId(db, o.id, b.id, "invitation_01BBBB")).error, "not_found", "not once revoked");
});

test("acceptance: a valid invitation + verified matching email creates the membership, closes the invitation, writes the audit entry", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const inv = await invite(db, o, "sam@example.com", "owner");
  const u = await user(db, "user_01AAAAA", "sam@example.com");
  const res = await activate(db, u);
  assert.deepEqual(res, { ok: true, activated: [{ organizationId: o.id, invitationId: inv.id }] });
  const m = await repo.getMembership(db, o.id, u.id);
  assert.equal(m.role, "owner");
  assert.equal(m.status, "active");
  assert.equal(m.created_by, ADMIN, "the membership records the admin who invited");
  const accepted = await repo.getInvitation(db, o.id, inv.id);
  assert.equal(accepted.status, "accepted");
  assert.equal(accepted.accepted_user_id, u.id);
  assert.equal(accepted.accepted_at, at(1).toISOString());
  const log = rows(db, "SELECT organization_id, actor_type, actor_ref, action, entity_id, visibility FROM activity_log").map((r) => ({ ...r }));
  assert.deepEqual(log, [{ organization_id: o.id, actor_type: "client", actor_ref: u.id, action: "invitation.accepted", entity_id: inv.id, visibility: "internal" }]);
  assert.equal((await repo.getActiveMembership(db, u.id, "acme")).role, "owner");
});

test("acceptance is IDEMPOTENT: repeating it changes nothing and creates no duplicates", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  await invite(db, o, "sam@example.com");
  const u = await user(db, "user_01AAAAA", "sam@example.com");
  assert.equal((await activate(db, u)).activated.length, 1);
  const before = JSON.stringify([rows(db, "SELECT * FROM memberships"), rows(db, "SELECT * FROM invitations"), rows(db, "SELECT * FROM activity_log")]);
  for (let i = 0; i < 3; i++) assert.deepEqual(await activate(db, u, {}, at(2 + i)), { ok: true, activated: [] });
  assert.equal(JSON.stringify([rows(db, "SELECT * FROM memberships"), rows(db, "SELECT * FROM invitations"), rows(db, "SELECT * FROM activity_log")]), before);
  assert.equal(count(db, "memberships"), 1);
  assert.equal(count(db, "activity_log", "action = 'invitation.accepted'"), 1);
});

test("expired, revoked, unverified, wrong-email, disabled-user and not-yet-valid cases NEVER grant access", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const sam = await user(db, "user_01AAAAA", "sam@example.com");

  const expired = await invite(db, o, "sam@example.com", "member", { expiresInDays: 1 });
  assert.deepEqual(await activate(db, sam, {}, at(2)), { ok: true, activated: [] }, "after expiry");
  assert.equal(await repo.getMembership(db, o.id, sam.id), null);
  assert.equal(await repo.getActiveMembership(db, sam.id, "acme"), null);
  assert.equal((await repo.expireStaleInvitations(db, { now: at(2) })), 1);
  assert.equal((await repo.getInvitation(db, o.id, expired.id)).status, "expired");
  assert.equal(await repo.expireStaleInvitations(db, { now: at(2) }), 0, "housekeeping is idempotent");

  const edge = await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN, expiresInDays: 1 }, { now: NOW });
  assert.ok(edge.ok);
  assert.deepEqual(await activate(db, sam, {}, new Date(edge.invitation.expires_at)), { ok: true, activated: [] }, "exactly at the expiry instant is already too late");
  assert.equal(count(db, "memberships"), 0);

  const revoked = await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: at(3) });
  await repo.revokeInvitation(db, o.id, revoked.invitation.id, ADMIN, { now: at(3) });
  assert.deepEqual(await activate(db, sam, {}, at(4)), { ok: true, activated: [] }, "revoked");

  const live = await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: at(5) });
  assert.ok(live.ok);
  assert.deepEqual(await activate(db, sam, { emailVerified: false }, at(6)), { ok: false, error: "email_not_verified" });
  for (const v of [undefined, null, "true", 1, "yes"]) assert.equal((await activate(db, sam, { emailVerified: v }, at(6))).error, "email_not_verified", String(v));
  const other = await user(db, "user_01BBBBB", "someone.else@example.com");
  assert.deepEqual(await activate(db, other, {}, at(6)), { ok: true, activated: [] }, "an invitation for a different address is not theirs");
  const lookalike = await user(db, "user_01CCCCC", "sam@example.com.evil.test");
  assert.deepEqual(await activate(db, lookalike, {}, at(6)), { ok: true, activated: [] });
  await repo.setUserStatus(db, sam.id, "disabled");
  const disabledNow = await repo.getUserById(db, sam.id);
  assert.deepEqual(await activate(db, disabledNow, {}, at(6)), { ok: false, error: "user_disabled" });
  assert.deepEqual(await activate(db, undefined, {}, at(6)), { ok: false, error: "invalid_user" });
  assert.equal(count(db, "memberships"), 0, "nothing above granted access");
  assert.equal((await repo.getInvitation(db, o.id, live.invitation.id)).status, "pending", "and the valid invitation is untouched");
  assert.equal(count(db, "activity_log", "action = 'invitation.accepted'"), 0);
});

test("a REUSED invitation can never re-grant access an admin has since revoked", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const inv = await invite(db, o, "sam@example.com", "owner");
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  await activate(db, sam);
  await otherOwner(db, o);
  assert.ok((await repo.revokeMembership(db, o.id, sam.id, ADMIN, { now: at(2) })).ok);
  assert.equal(await repo.getActiveMembership(db, sam.id, "acme"), null);
  for (let i = 0; i < 3; i++) assert.deepEqual(await activate(db, sam, {}, at(3 + i)), { ok: true, activated: [] });
  assert.equal(await repo.getActiveMembership(db, sam.id, "acme"), null, "still revoked after the old invitation is replayed");
  assert.equal((await repo.getInvitation(db, o.id, inv.id)).status, "accepted");
  // Only a NEW admin-issued invitation, or an explicit admin restore, brings access back.
  assert.ok((await repo.createInvitation(db, o.id, { email: "sam@example.com", role: "member", createdBy: ADMIN }, { now: at(8) })).ok);
  const back = await activate(db, sam, {}, at(10));
  assert.equal(back.activated.length, 1);
  const m = await repo.getMembership(db, o.id, sam.id);
  assert.equal(m.status, "active");
  assert.equal(m.role, "member", "a revoked membership comes back with the newly invited role");
  assert.equal(m.revoked_at, null);
  assert.equal(count(db, "memberships", `user_id = '${sam.id}'`), 1, "still one row for this user and organization");
});

test("re-inviting someone who is already ACTIVE never changes their role (no silent downgrade)", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  await invite(db, o, "sam@example.com", "owner");
  await activate(db, sam);
  // createInvitation now refuses an address that is already an active member (already_member), so this stale second invitation is seeded directly:
  // acceptance must still behave when one exists (for example one issued before the person joined).
  db.raw.exec(`INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at) VALUES ('${crypto.randomUUID()}', '${o.id}', 'sam@example.com', 'member', 'pending', '${at(1).toISOString()}', '${ADMIN}', '${at(9).toISOString()}')`);
  const res = await activate(db, sam, {}, at(2));
  assert.equal(res.activated.length, 1, "the second invitation is consumed");
  assert.equal((await repo.getMembership(db, o.id, sam.id)).role, "owner");
  assert.equal(count(db, "memberships"), 1);
});

test("MULTIPLE organizations: one portal user, one membership per organization, all activated together", async () => {
  const db = openPortalDb();
  const [a, b, c] = [await org(db, "alpha"), await org(db, "bravo"), await org(db, "charlie")];
  await invite(db, a, "sam@example.com", "owner");
  await invite(db, b, "sam@example.com", "member");
  await invite(db, c, "other@example.com", "owner"); // someone else's
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  const res = await activate(db, sam);
  assert.deepEqual(res.activated.map((x) => x.organizationId).sort(), [a.id, b.id].sort());
  assert.equal(count(db, "portal_users"), 1, "no duplicate user record");
  assert.equal(count(db, "memberships"), 2);
  assert.deepEqual((await repo.listActiveMembershipsForUser(db, sam.id)).map((m) => [m.slug, m.role]), [["ALPHA".toLowerCase(), "owner"], ["bravo", "member"]]);
  // A later invitation to the same, already known, user adds a third organization to the same row.
  await invite(db, c, "sam@example.com", "member");
  const later = await user(db, "user_01AAAAA", "sam@example.com"); // signing in again resolves to the same user
  assert.equal(later.id, sam.id);
  assert.equal((await activate(db, later, {}, at(5))).activated.length, 1);
  assert.equal(count(db, "portal_users"), 1);
  assert.equal((await repo.listActiveMembershipsForUser(db, sam.id)).length, 3);
  assert.deepEqual((await repo.listInvitations(db, c.id, { status: "pending" })).map((i) => i.email), ["other@example.com"], "only someone else's invitation is still pending in charlie");
});

test("acceptance is ATOMIC: if any part of the batch fails, no membership, invitation change or audit entry is left behind", async () => {
  const db = openPortalDb();
  const [a, b] = [await org(db, "alpha"), await org(db, "bravo")];
  const ia = await invite(db, a, "sam@example.com");
  const ib = await invite(db, b, "sam@example.com");
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  // Simulate a failure on the second organization's membership insert (test-only trigger).
  db.raw.exec(`CREATE TRIGGER fail_bravo BEFORE INSERT ON memberships WHEN NEW.organization_id = '${b.id}' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`);
  await assert.rejects(() => activate(db, sam), /simulated failure/);
  assert.equal(count(db, "memberships"), 0, "the first organization's membership was rolled back too");
  assert.equal(count(db, "activity_log", "action = 'invitation.accepted'"), 0);
  assert.equal((await repo.getInvitation(db, a.id, ia.id)).status, "pending");
  assert.equal((await repo.getInvitation(db, b.id, ib.id)).status, "pending");
  // Once the fault is gone the very same call succeeds (nothing was half-consumed).
  db.raw.exec("DROP TRIGGER fail_bravo");
  assert.equal((await activate(db, sam)).activated.length, 2);
});

test("acceptance is a CLAIM: a second batch for the same invitation cannot also win (simulated race)", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const inv = await invite(db, o, "sam@example.com");
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  // Both callers read the invitation as pending before either writes (the race), then both run their batch.
  const realAll = db.prepare;
  let reads = 0;
  const snapshot = (await repo.listInvitations(db, o.id, { status: "pending" })).map((i) => ({ id: i.id, organization_id: i.organization_id }));
  db.prepare = (sql) => {
    const s = realAll.call(db, sql);
    if (/FROM invitations WHERE email = \?/.test(sql)) {
      reads++;
      s.all = async () => ({ results: snapshot });
    }
    return s;
  };
  const [first, second] = [await activate(db, sam), await activate(db, sam)];
  db.prepare = realAll;
  assert.equal(reads, 2);
  assert.equal(first.activated.length + second.activated.length, 1, "exactly one caller claimed the invitation");
  assert.equal(count(db, "memberships"), 1);
  assert.equal(count(db, "activity_log", "action = 'invitation.accepted'"), 1, "one audit entry, not two");
  assert.equal((await repo.getInvitation(db, o.id, inv.id)).status, "accepted");
});

test("STALE READ: an invitation that expired or was revoked after it was read still grants nothing (each statement carries its own guard)", async () => {
  for (const how of ["expired", "revoked"]) {
    const db = openPortalDb();
    const o = await org(db, "acme");
    const inv = await invite(db, o, "sam@example.com");
    const sam = await user(db, "user_01AAAAA", "sam@example.com");
    const staleRead = [{ id: inv.id, organization_id: o.id }]; // what the first query returned while it was still valid
    if (how === "revoked") await repo.revokeInvitation(db, o.id, inv.id, ADMIN, { now: at(1) });
    const real = db.prepare;
    db.prepare = (sql) => {
      const stmt = real.call(db, sql);
      if (/FROM invitations WHERE email = \?/.test(sql)) stmt.all = async () => ({ results: staleRead });
      return stmt;
    };
    const when = how === "expired" ? at(30) : at(2);
    const res = await activate(db, sam, {}, when);
    db.prepare = real;
    assert.deepEqual(res, { ok: true, activated: [] }, how);
    assert.equal(count(db, "memberships"), 0, how + ": no membership");
    assert.equal(count(db, "activity_log", "action = 'invitation.accepted'"), 0, how + ": no audit entry");
    assert.equal((await repo.getInvitation(db, o.id, inv.id)).status, how === "expired" ? "pending" : "revoked", how + ": status not changed by a failed claim");
  }
});

/* ------------------------------------------------------------------ memberships */

test("memberships: the organization resolves ONLY through the user's own active membership in an active organization", async () => {
  const db = openPortalDb();
  const [a, b] = [await org(db, "alpha"), await org(db, "bravo")];
  const sam = await user(db, "user_01AAAAA", "sam@example.com");
  const kim = await user(db, "user_01BBBBB", "kim@example.com");
  await invite(db, a, "sam@example.com", "owner");
  await invite(db, b, "kim@example.com", "member");
  await activate(db, sam);
  await activate(db, kim);
  assert.deepEqual(await repo.getActiveMembership(db, sam.id, "alpha"), { organizationId: a.id, slug: "alpha", name: "ALPHA", websiteUrl: null, role: "owner" });
  assert.equal(await repo.getActiveMembership(db, sam.id, "bravo"), null, "sam is not a member of bravo");
  assert.equal(await repo.getActiveMembership(db, kim.id, "alpha"), null);
  for (const slug of ["Alpha", "alpha ", "alpha\n", "ALPHA", "alph", "alpha%", "alpha'--", "", undefined, null, "../alpha"]) assert.equal(await repo.getActiveMembership(db, sam.id, slug), null, JSON.stringify(slug));
  await repo.setOrganizationStatus(db, a.id, "suspended");
  assert.equal(await repo.getActiveMembership(db, sam.id, "alpha"), null, "suspended organization");
  assert.deepEqual(await repo.listActiveMembershipsForUser(db, sam.id), []);
  await repo.setOrganizationStatus(db, a.id, "active");
  await repo.setOrganizationStatus(db, a.id, "archived");
  assert.equal(await repo.getActiveMembership(db, sam.id, "alpha"), null, "archived organization");
  await repo.setOrganizationStatus(db, a.id, "active");
  assert.ok((await repo.getActiveMembership(db, sam.id, "alpha")));
  await otherOwner(db, a);
  assert.ok((await repo.revokeMembership(db, a.id, sam.id, ADMIN, { now: at(3) })).ok);
  assert.equal(await repo.getActiveMembership(db, sam.id, "alpha"), null, "revoked membership: access ends immediately");
  assert.deepEqual(await repo.listActiveMembershipsForUser(db, sam.id), []);
  assert.ok((await repo.restoreMembership(db, a.id, sam.id, { role: "member", actor: ADMIN })).ok);
  assert.equal((await repo.getActiveMembership(db, sam.id, "alpha")).role, "member");
  await assert.rejects(() => repo.getActiveMembership(db, "not-a-uuid", "alpha"), (e) => e.code === "invalid_user_id");
});

test("memberships: list, change role, revoke and restore are scoped to one organization; bad input is refused", async () => {
  const db = openPortalDb();
  const [a, b] = [await org(db, "alpha"), await org(db, "bravo")];
  const sam = await user(db, "user_01AAAAA", "sam@example.com", "Sam");
  await invite(db, a, "sam@example.com", "member");
  await invite(db, b, "sam@example.com", "member");
  await activate(db, sam);
  assert.deepEqual((await repo.listMembers(db, a.id)).map((m) => [m.email, m.name, m.role, m.status]), [["sam@example.com", "Sam", "member", "active"]]);
  assert.equal((await repo.setMemberRole(db, a.id, sam.id, "owner", ADMIN)).ok, true);
  assert.equal((await repo.getMembership(db, a.id, sam.id)).role, "owner");
  await otherOwner(db, a);
  assert.equal((await repo.getMembership(db, b.id, sam.id)).role, "member", "the other organization is untouched");
  assert.equal((await repo.setMemberRole(db, a.id, sam.id, "admin", ADMIN)).error, "invalid_role");
  assert.equal((await repo.revokeMembership(db, a.id, sam.id, "")).error, "invalid_actor");
  assert.ok((await repo.revokeMembership(db, a.id, sam.id, ADMIN)).ok);
  assert.equal((await repo.revokeMembership(db, a.id, sam.id, ADMIN)).error, "already_revoked", "already revoked");
  assert.equal((await repo.setMemberRole(db, a.id, sam.id, "owner", ADMIN)).error, "not_found", "no role changes on a revoked membership");
  assert.equal((await repo.restoreMembership(db, b.id, sam.id, { actor: ADMIN })).error, "not_revoked", "bravo's membership was never revoked");
  assert.equal((await repo.getMembership(db, b.id, sam.id)).status, "active");
});

/* ------------------------------------------------------------------ projects and activity */

test("projects: create with defaults, update, list in order; validation errors are specific", async () => {
  const db = openPortalDb();
  const o = await org(db, "acme");
  const p = (await repo.createProject(db, o.id, { name: "Company website" }, { now: NOW })).project;
  assert.deepEqual([p.kind, p.status, p.live_url, p.summary], ["website", "discovery", null, null]);
  const q = (await repo.createProject(db, o.id, { name: "Booking portal", kind: "web-app", status: "build", liveUrl: "https://example.com", summary: "Phase two\nof the build" }, { now: at(1) })).project;
  assert.equal(q.summary, "Phase two\nof the build");
  assert.deepEqual((await repo.listProjects(db, o.id)).map((x) => x.name), ["Company website", "Booking portal"]);
  const u = await repo.updateProject(db, o.id, p.id, { status: "live", liveUrl: "https://acme.example/", summary: null }, { now: at(2) });
  assert.deepEqual([u.project.status, u.project.live_url, u.project.updated_at], ["live", "https://acme.example/", at(2).toISOString()]);
  assert.equal((await repo.updateProject(db, o.id, p.id, { liveUrl: null })).project.live_url, null, "a URL can be cleared");
  for (const [patch, error] of [[{ name: "" }, "invalid_name"], [{ status: "launched" }, "invalid_status"], [{ liveUrl: "http://x.example" }, "invalid_live_url"], [{ kind: "A B" }, "invalid_kind"], [{ summary: "x".repeat(2001) }, "invalid_summary"], [{}, "nothing_to_update"]]) assert.equal((await repo.updateProject(db, o.id, p.id, patch)).error, error, error);
  for (const [input, error] of [[{ name: "" }, "invalid_name"], [{ name: "x", status: "nope" }, "invalid_status"], [{ name: "x", liveUrl: "ftp://x.example" }, "invalid_live_url"], [undefined, "invalid_name"]]) assert.equal((await repo.createProject(db, o.id, input)).error, error, error);
  assert.equal((await repo.createProject(db, crypto.randomUUID(), { name: "Orphan" })).error, "invalid_organization", "unknown organization is refused by the foreign key");
  assert.equal(count(db, "projects"), 2);
});

test("activity: record and list; client feed shows client-visible events only; user-level events carry no organization", async () => {
  const db = openPortalDb();
  const [a, b] = [await org(db, "alpha"), await org(db, "bravo")];
  const rec = (organizationId, action, visibility, now) => repo.recordActivity(db, { organizationId, actorType: "admin", actorRef: ADMIN, action, entityType: "project", entityId: "p1", detail: { status: "live" }, visibility }, { now });
  assert.ok((await rec(a.id, "project.status_changed", "client", at(1))).ok);
  assert.ok((await rec(a.id, "project.note_added", "internal", at(2))).ok);
  assert.ok((await rec(b.id, "project.status_changed", "client", at(3))).ok);
  assert.ok((await rec(null, "user.signed_in", undefined, at(4))).ok);
  assert.deepEqual((await repo.listActivity(db, a.id)).map((r) => r.action), ["project.status_changed"]);
  assert.deepEqual((await repo.listActivity(db, a.id, { clientVisibleOnly: false })).map((r) => r.action), ["project.note_added", "project.status_changed"]);
  assert.deepEqual((await repo.listActivity(db, b.id)).map((r) => r.organization_id), [b.id]);
  assert.equal(rows(db, "SELECT visibility FROM activity_log WHERE organization_id IS NULL")[0].visibility, "internal");
  assert.equal((await repo.recordActivity(db, { organizationId: null, actorType: "client", actorRef: "u", action: "user.signed_in", visibility: "client" })).ok, true, "forced to internal when there is no organization");
  assert.equal(rows(db, "SELECT visibility FROM activity_log WHERE organization_id IS NULL").every((r) => r.visibility === "internal"), true);
  for (const [entry, error] of [[{ actorType: "admin", actorRef: "x", action: "a.b" }, "organization_required"], [{ organizationId: a.id, actorType: "robot", actorRef: "x", action: "a.b" }, "invalid_actor_type"], [{ organizationId: a.id, actorType: "admin", actorRef: "", action: "a.b" }, "invalid_actor"], [{ organizationId: a.id, actorType: "admin", actorRef: "x", action: "Bad Action" }, "invalid_action"], [{ organizationId: a.id, actorType: "admin", actorRef: "x", action: "a.b", visibility: "public" }, "invalid_visibility"], [{ organizationId: a.id, actorType: "admin", actorRef: "x", action: "a.b", detail: { big: "x".repeat(2100) } }, "detail_too_large"]]) assert.equal((await repo.recordActivity(db, entry)).error, error, error);
  const circular = {};
  circular.self = circular;
  assert.equal((await repo.recordActivity(db, { organizationId: a.id, actorType: "admin", actorRef: "x", action: "a.b", detail: circular })).error, "invalid_detail");
  assert.equal((await repo.listActivity(db, a.id, { limit: 1, clientVisibleOnly: false })).length, 1);
  assert.equal((await repo.listActivity(db, a.id, { limit: 9999, clientVisibleOnly: false })).length, 2, "an out-of-range limit falls back to the default");
});
