// Client portal Stage 1: multi-tenant isolation. Organization A must never be able to see or change organization B's records
// through any repository function, and the data layer's SQL is checked mechanically so a new query cannot skip the scoping.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import { PortalDataError } from "../portal/repo/common.js";

const NOW = new Date("2026-10-20T12:00:00.000Z");
const ADMIN = "admin@frameworkco.ca";

/** Two organizations, each with members, an invitation, a project and activity; plus one user in both. */
async function world() {
  const db = openPortalDb();
  const mk = async (slug) => (await repo.createOrganization(db, { slug, name: slug }, { now: NOW })).organization;
  const [A, B] = [await mk("alpha"), await mk("bravo")];
  const usr = async (wid, email) => (await repo.upsertUserFromIdentity(db, { workosUserId: wid, email }, { now: NOW })).user;
  const [onlyA, onlyB, both] = [await usr("user_01ONLYA", "a@example.com"), await usr("user_01ONLYB", "b@example.com"), await usr("user_01BOTH0", "both@example.com")];
  const inv = async (o, email) => (await repo.createInvitation(db, o.id, { email, role: "member", createdBy: ADMIN }, { now: NOW })).invitation;
  await inv(A, "a@example.com"); await inv(A, "both@example.com"); await inv(B, "b@example.com"); await inv(B, "both@example.com");
  for (const u of [onlyA, onlyB, both]) await repo.activatePendingInvitations(db, { user: u, emailVerified: true }, { now: new Date(NOW.getTime() + 1000) });
  const pendingA = await inv(A, "pending-a@example.com");
  const pendingB = await inv(B, "pending-b@example.com");
  const projA = (await repo.createProject(db, A.id, { name: "A site" }, { now: NOW })).project;
  const projB = (await repo.createProject(db, B.id, { name: "B site" }, { now: NOW })).project;
  await repo.recordActivity(db, { organizationId: A.id, actorType: "admin", actorRef: ADMIN, action: "project.created", visibility: "client" }, { now: NOW });
  await repo.recordActivity(db, { organizationId: B.id, actorType: "admin", actorRef: ADMIN, action: "project.created", visibility: "client" }, { now: NOW });
  return { db, A, B, onlyA, onlyB, both, pendingA, pendingB, projA, projB };
}
const snapshot = (db) => JSON.stringify(["organizations", "portal_users", "memberships", "invitations", "projects", "activity_log"].map((t) => rows(db, `SELECT * FROM ${t} ORDER BY id`)));

test("reading: organization A's id never returns organization B's records, whatever B's resource id is", async () => {
  const { db, A, B, onlyB, pendingB, projB } = await world();
  assert.equal(await repo.getProject(db, A.id, projB.id), null);
  assert.equal(await repo.getInvitation(db, A.id, pendingB.id), null);
  assert.equal(await repo.getMembership(db, A.id, onlyB.id), null);
  assert.deepEqual((await repo.listProjects(db, A.id)).map((p) => p.organization_id), [A.id]);
  assert.ok((await repo.listInvitations(db, A.id)).every((i) => i.organization_id === A.id));
  assert.ok((await repo.listMembers(db, A.id)).every((m) => m.email !== "b@example.com"));
  assert.ok((await repo.listActivity(db, A.id, { clientVisibleOnly: false })).every((r) => r.organization_id === A.id));
  assert.equal((await repo.listProjects(db, B.id)).length, 1);
  // the reverse direction, for symmetry
  assert.equal(await repo.getProject(db, B.id, (await repo.listProjects(db, A.id))[0].id), null);
});

test("writing: organization A's id cannot change or revoke organization B's records, and B's data is byte-for-byte unchanged", async () => {
  const { db, A, onlyB, pendingB, projB } = await world();
  const before = snapshot(db);
  assert.equal((await repo.updateProject(db, A.id, projB.id, { name: "hijacked", status: "live" })).error, "not_found");
  assert.equal((await repo.revokeInvitation(db, A.id, pendingB.id, ADMIN)).error, "not_found");
  assert.equal((await repo.attachWorkosInvitationId(db, A.id, pendingB.id, "invitation_01HIJACK")).error, "not_found");
  assert.equal((await repo.setMemberRole(db, A.id, onlyB.id, "owner")).error, "not_found");
  assert.equal((await repo.revokeMembership(db, A.id, onlyB.id, ADMIN)).error, "not_found");
  assert.equal((await repo.restoreMembership(db, A.id, onlyB.id)).error, "not_found");
  assert.equal(snapshot(db), before, "nothing changed anywhere");
});

test("creating: a project or invitation made 'for' A lands in A only; a made-up organization id is refused by the database", async () => {
  const { db, A, B } = await world();
  const p = (await repo.createProject(db, A.id, { name: "New" })).project;
  assert.equal(p.organization_id, A.id);
  assert.equal((await repo.listProjects(db, B.id)).some((x) => x.id === p.id), false);
  assert.equal((await repo.createProject(db, crypto.randomUUID(), { name: "Orphan" })).error, "invalid_organization");
  assert.equal((await repo.createInvitation(db, crypto.randomUUID(), { email: "x@example.com", role: "member", createdBy: ADMIN })).error, "invalid_organization");
  assert.equal((await repo.recordActivity(db, { organizationId: crypto.randomUUID(), actorType: "admin", actorRef: "x", action: "a.b" })).error, "invalid_entry");
});

test("slug resolution goes through the user's own membership: only-A, only-B and both-organization users see exactly their own", async () => {
  const { db, A, B, onlyA, onlyB, both } = await world();
  const slugs = async (u) => (await repo.listActiveMembershipsForUser(db, u.id)).map((m) => m.slug);
  assert.deepEqual(await slugs(onlyA), ["alpha"]);
  assert.deepEqual(await slugs(onlyB), ["bravo"]);
  assert.deepEqual(await slugs(both), ["alpha", "bravo"]);
  assert.equal(await repo.getActiveMembership(db, onlyA.id, "bravo"), null);
  assert.equal(await repo.getActiveMembership(db, onlyB.id, "alpha"), null);
  assert.equal((await repo.getActiveMembership(db, both.id, "alpha")).organizationId, A.id);
  assert.equal((await repo.getActiveMembership(db, both.id, "bravo")).organizationId, B.id);
  // an unknown slug and someone else's slug are indistinguishable
  assert.deepEqual(await repo.getActiveMembership(db, onlyA.id, "bravo"), await repo.getActiveMembership(db, onlyA.id, "no-such-org"));
  // revoking one of the shared user's memberships leaves the other intact, and there is still only one user row for them
  await repo.revokeMembership(db, A.id, both.id, ADMIN);
  assert.deepEqual(await slugs(both), ["bravo"]);
  assert.equal(count(db, "portal_users", "email = 'both@example.com'"), 1);
});

test("every repository function that takes an organization id REFUSES a missing or malformed one instead of running unscoped", async () => {
  const { db, projA, pendingA, onlyA } = await world();
  const bad = [undefined, null, "", "not-a-uuid", 5, {}, [], "' OR 1=1 --", "*", projA.id.toUpperCase(), projA.id + " "];
  const calls = {
    getOrganizationById: (o) => repo.getOrganizationById(db, o),
    updateOrganization: (o) => repo.updateOrganization(db, o, { name: "x" }),
    setOrganizationStatus: (o) => repo.setOrganizationStatus(db, o, "active"),
    listMembers: (o) => repo.listMembers(db, o),
    getMembership: (o) => repo.getMembership(db, o, onlyA.id),
    setMemberRole: (o) => repo.setMemberRole(db, o, onlyA.id, "member"),
    revokeMembership: (o) => repo.revokeMembership(db, o, onlyA.id, ADMIN),
    restoreMembership: (o) => repo.restoreMembership(db, o, onlyA.id),
    createInvitation: (o) => repo.createInvitation(db, o, { email: "x@example.com", role: "member", createdBy: ADMIN }),
    attachWorkosInvitationId: (o) => repo.attachWorkosInvitationId(db, o, pendingA.id, "invitation_01ZZZZ"),
    getInvitation: (o) => repo.getInvitation(db, o, pendingA.id),
    listInvitations: (o) => repo.listInvitations(db, o),
    revokeInvitation: (o) => repo.revokeInvitation(db, o, pendingA.id, ADMIN),
    createProject: (o) => repo.createProject(db, o, { name: "x" }),
    getProject: (o) => repo.getProject(db, o, projA.id),
    listProjects: (o) => repo.listProjects(db, o),
    updateProject: (o) => repo.updateProject(db, o, projA.id, { name: "x" }),
    listActivity: (o) => repo.listActivity(db, o),
    recordActivity: (o) => repo.recordActivity(db, { organizationId: o, actorType: "admin", actorRef: "x", action: "a.b" }),
  };
  const before = snapshot(db);
  for (const [name, call] of Object.entries(calls)) {
    for (const value of bad) {
      if (name === "recordActivity" && value === null) continue; // null is the explicit "user-level event" marker, handled below
      await assert.rejects(() => call(value), (e) => e instanceof PortalDataError && e.code === "invalid_organization_id", `${name}(${JSON.stringify(value)})`);
    }
  }
  assert.equal(snapshot(db), before, "no refused call touched the database");
  assert.equal((await repo.recordActivity(db, { actorType: "admin", actorRef: "x", action: "a.b" })).error, "organization_required", "omitting the key entirely is refused too");
  assert.equal(Object.keys(calls).length, 19);
});

test("hostile input is data, never SQL: names, slugs, emails and urls with SQL metacharacters cannot break out or damage anything", async () => {
  const { db, A } = await world();
  const evil = ["'; DROP TABLE projects; --", '" OR "1"="1', "x'); DELETE FROM memberships; --", "%", "_", "\\", "Robert'); DROP TABLE organizations;--"];
  for (const s of evil) {
    assert.equal((await repo.createOrganization(db, { slug: s, name: "x" })).error, "invalid_slug");
    assert.equal(await repo.getOrganizationBySlug(db, s), null);
    const invited = await repo.createInvitation(db, A.id, { email: s + "@example.com", role: "member", createdBy: ADMIN });
    if (invited.ok) assert.equal(invited.invitation.email, (s + "@example.com").toLowerCase(), "a syntactically valid address is stored literally");
    else assert.equal(invited.error, "invalid_email");
    assert.equal(await repo.getActiveMembership(db, (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01EVIL0", email: "evil@example.com" })).user.id, s), null);
    const stored = (await repo.createProject(db, A.id, { name: s, summary: s })).project; // allowed text is stored literally
    assert.equal(stored.name, s);
    assert.equal(stored.summary, s);
  }
  for (const t of ["organizations", "portal_users", "memberships", "invitations", "projects", "activity_log"]) assert.ok(count(db, t) > 0, t + " still has its rows");
  assert.equal((await repo.listProjects(db, A.id)).filter((p) => p.name === "%").length, 1, "wildcard characters match only themselves");
});

/* ------------------------------------------------------------------ mechanical checks of the SQL itself */

const REPO_DIR = new URL("../portal/repo/", import.meta.url);
const files = readdirSync(REPO_DIR).filter((f) => f.endsWith(".js"));
const TENANT_TABLES = ["memberships", "invitations", "projects", "activity_log"];

/** Every SQL string literal (backtick, double- or single-quoted) that starts with a SQL verb. */
function sqlStrings() {
  const out = [];
  for (const f of files) {
    const src = readFileSync(new URL(f, REPO_DIR), "utf8");
    for (const m of src.matchAll(/(`|")\s*((?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?)\1/g)) out.push({ file: f, sql: m[2] });
  }
  return out;
}

test("SQL scan: every statement on a tenant table names organization_id, or carries an explicit, reviewed 'cross-tenant:' reason", () => {
  const found = sqlStrings();
  assert.ok(found.length > 25, "the scan actually found the repository's SQL (" + found.length + ")");
  const crossTenant = [];
  for (const { file, sql } of found) {
    const touches = TENANT_TABLES.some((t) => new RegExp(`\\b(FROM|JOIN|INTO|UPDATE)\\s+${t}\\b`, "i").test(sql));
    if (!touches) continue;
    const marker = /cross-tenant:\s*([^*]+?)\s*\*\//.exec(sql);
    if (marker) crossTenant.push(marker[1]);
    else assert.match(sql, /organization_id/, `${file}: tenant-table SQL without organization_id or a cross-tenant reason:\n${sql}`);
  }
  assert.deepEqual(crossTenant.sort(), [
    "finds the invitations addressed to the signed-in user's own verified email",
    "housekeeping that closes expired invitations for every organization",
    "lists the signed-in user's OWN memberships for the organization picker",
    "resolves one organization for the signed-in user through THEIR OWN membership",
  ]);
});

test("SQL scan: values are always bound; the only interpolations into SQL are the reviewed, fixed fragments", () => {
  const allowed = new Set([
    "COLUMNS",
    'sets.join(", ")',
    'status ? "WHERE status = ?" : ""',
    'status ? "AND status = ?" : ""',
    "clientVisibleOnly ? \"AND visibility = 'client'\" : \"\"",
    "guard",
    "ACTIVE", // portal_sessions: the fixed "not revoked, not idle-expired, not past the absolute limit" predicate (user-scoped, see portal-sessions.test.mjs)
  ]);
  const used = new Set();
  for (const { file, sql } of sqlStrings()) for (const m of sql.matchAll(/\$\{([^}]*)\}/g)) {
    used.add(m[1].trim());
    assert.ok(allowed.has(m[1].trim()), `${file}: unreviewed interpolation in SQL: \${${m[1]}}`);
  }
  assert.ok(used.size >= 5, "the scan saw the interpolations it is meant to police");
  for (const f of files) {
    const src = readFileSync(new URL(f, REPO_DIR), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\.(run|first|all|exec)\(\s*[^)]*\+\s*\w/.test(src), `${f}: SQL built by string concatenation`);
    assert.ok(!/\bdb\.(raw|exec)\b/.test(src), `${f}: raw/unprepared SQL`);
  }
});

test("data layer boundary: the repository modules contain no routes, authentication, cookies or Cloudflare bindings", () => {
  for (const f of files) {
    const src = readFileSync(new URL(f, REPO_DIR), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\b(Request|Response|Headers|fetch|cookie|Set-Cookie|env\.[A-Z_]+|PORTAL_[A-Z_]+|process\.env)\b/.test(src), `${f} reaches outside the data layer`);
  }
  assert.ok(files.includes("sessions.js"), "the session repository (Stage 2B) lives here, and passes the same boundary check");
});
