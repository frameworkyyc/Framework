// First-organization onboarding runbook: migrations/portal-ops/onboard-organization.sql, add-first-project.sql and verify-organization.sql.
// The SQL is only ever executed here, against throw-away in-memory databases built from the real migration, and is proven to do the same
// thing as the data-layer functions, to be safe to repeat and to resume after a partial run, and to be unable to touch any other organization.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { openPortalDb, rows, count } from "./helpers/portal-db.mjs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as repo from "../portal/repo/index.js";

const OPS = new URL("../../migrations/portal-ops/", import.meta.url);
const read = (f) => readFileSync(new URL(f, OPS), "utf8");
const ONBOARD = read("onboard-organization.sql"), PROJECT = read("add-first-project.sql"), INVITE = read("invite-member.sql"), VERIFY = read("verify-organization.sql"), README = read("README.md");
const ACTOR = "admin:test";
const VALUES = { __SLUG__: "acme-co", __NAME__: "Acme Co", __OWNER_EMAIL__: "owner@acme.example", __ACTOR__: ACTOR, __PROJECT_NAME__: "Acme website", __PROJECT_STATUS__: "build", __EMAIL__: "second@acme.example", __ROLE__: "member" };
const fill = (sql, over = {}) => Object.entries({ ...VALUES, ...over }).reduce((s, [k, v]) => s.replaceAll(k, v), sql);
const statementsOf = (sql) => sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);
const TABLES = ["organizations", "portal_users", "memberships", "invitations", "projects", "activity_log", "portal_sessions"];
const dump = (db) => Object.fromEntries(TABLES.map((t) => [t, rows(db, `SELECT * FROM ${t} ORDER BY id`)]));
const keyed = (d) => new Map(TABLES.flatMap((t) => d[t].map((r) => [t + ":" + r.id, JSON.stringify(r)])));
function changes(before, after) {
  const b = keyed(before), a = keyed(after);
  return { added: [...a.keys()].filter((k) => !b.has(k)), changed: [...a.keys()].filter((k) => b.has(k) && b.get(k) !== a.get(k)), removed: [...b.keys()].filter((k) => !a.has(k)) };
}
/** Comparable form: generated ids and all timestamps are ignored. */
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function normalized(d) {
  const orgIds = new Map(d.organizations.map((o, i) => [o.id, "org:" + o.slug]));
  const projIds = new Map(d.projects.map((p) => [p.id, "project:" + p.name]));
  const invIds = new Map(d.invitations.map((i) => [i.id, "invitation:" + i.email + ":" + i.status]));
  const clean = (r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== "id").map(([k, v]) => [k, typeof v === "string" && ISO.test(v) ? "<time>" : orgIds.get(v) ?? projIds.get(v) ?? invIds.get(v) ?? v]));
  return JSON.stringify(Object.fromEntries(TABLES.map((t) => [t, d[t].map((r) => JSON.stringify(clean(r))).sort()])));
}
const exec = (db, sql) => db.raw.exec(sql);
const bySlug = (db, slug) => rows(db, "SELECT id FROM organizations WHERE slug = ?", slug)[0]?.id;

/** A world with two unrelated organizations that must never be touched. */
function existingOrgs(db) {
  const T0 = "2026-10-01T00:00:00.000Z";
  exec(db, `INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 'alpha', 'Alpha', 'active', '${T0}', '${T0}'), ('bbbbbbbb-0000-4000-8000-00000000000b', 'bravo', 'Bravo', 'suspended', '${T0}', '${T0}')`);
  exec(db, `INSERT INTO portal_users (id, workos_user_id, email, name, status, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'user_01ALPHAOWN', 'alpha-owner@example.com', 'A', 'active', '${T0}')`);
  exec(db, `INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES ('30000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', '11111111-1111-4111-8111-111111111111', 'owner', 'active', '${T0}', 'seed')`);
  exec(db, `INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at) VALUES ('10000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-4000-8000-00000000000b', 'bravo-owner@example.com', 'owner', 'pending', '${T0}', 'seed', '2099-01-01T00:00:00.000Z')`);
  exec(db, `INSERT INTO projects (id, organization_id, name, kind, status, created_at, updated_at) VALUES ('40000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'Alpha site', 'website', 'live', '${T0}', '${T0}')`);
  exec(db, `INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, visibility, created_at) VALUES ('20000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-00000000000a', 'admin', 'seed', 'project.created', 'client', '${T0}')`);
}
const world = () => { const db = openPortalDb(); existingOrgs(db); return db; };

/* ------------------------------------------------------------------ onboard-organization.sql */
test("onboarding SQL = data layer: the same organization and owner invitation as createOrganization + createInvitation (+ one internal audit entry)", async () => {
  const bySql = world(), byCode = world();
  exec(bySql, fill(ONBOARD));
  const org = await repo.createOrganization(byCode, { slug: "acme-co", name: "Acme Co" });
  assert.ok(org.ok);
  assert.ok((await repo.createInvitation(byCode, org.organization.id, { email: "owner@acme.example", role: "owner", createdBy: ACTOR })).ok);
  assert.ok((await repo.recordActivity(byCode, { organizationId: org.organization.id, actorType: "admin", actorRef: ACTOR, action: "org.onboarded", entityType: "organization", entityId: org.organization.id, visibility: "internal" })).ok);
  assert.equal(normalized(dump(bySql)), normalized(dump(byCode)));
  const inv = rows(bySql, "SELECT * FROM invitations WHERE email = 'owner@acme.example'")[0];
  assert.equal(inv.role, "owner"); assert.equal(inv.status, "pending");
  assert.ok(UUID.test(inv.id) && UUID.test(bySlug(bySql, "acme-co")), "generated ids are valid version-4 UUIDs");
  const days = (Date.parse(inv.expires_at) - Date.parse(inv.created_at)) / 86400000;
  assert.ok(days > 6.99 && days < 7.01, "valid for 7 days, the same as the data layer's default");
  assert.deepEqual(rows(bySql, "SELECT visibility, actor_type FROM activity_log WHERE action = 'org.onboarded'").map((r) => ({ ...r })), [{ visibility: "internal", actor_type: "admin" }]);
});
test("onboarding SQL touches only the new organization: every other organization, member, invitation, project and audit row is byte-for-byte unchanged", () => {
  const db = world(), before = dump(db);
  exec(db, fill(ONBOARD));
  const c = changes(before, dump(db));
  assert.deepEqual(c.changed, []); assert.deepEqual(c.removed, []);
  assert.deepEqual(c.added.map((k) => k.split(":")[0]).sort(), ["activity_log", "invitations", "organizations"]);
});
test("onboarding SQL is repeatable: running the file again (and again) changes nothing and duplicates nothing", () => {
  const db = world();
  exec(db, fill(ONBOARD));
  const once = JSON.stringify(dump(db));
  exec(db, fill(ONBOARD)); exec(db, fill(ONBOARD));
  assert.equal(JSON.stringify(dump(db)), once, "byte-for-byte identical, timestamps included");
});
test("onboarding SQL resumes after a partial run: stopping after ANY statement and running the whole file again ends in exactly the full result", () => {
  const statements = statementsOf(fill(ONBOARD));
  assert.equal(statements.length, 4);
  const full = world(); exec(full, fill(ONBOARD));
  for (let k = 0; k <= statements.length; k++) {
    const db = world();
    for (const st of statements.slice(0, k)) exec(db, st);
    exec(db, fill(ONBOARD));
    assert.equal(normalized(dump(db)), normalized(dump(full)), `stopped after statement ${k}`);
    assert.equal(count(db, "activity_log", "action = 'org.onboarded'"), 1, `one audit entry (k=${k})`);
    assert.equal(count(db, "invitations", "email = 'owner@acme.example'"), 1, `one invitation (k=${k})`);
  }
});
test("onboarding SQL can never add an owner to an organization that already has people: a wrongly typed (existing) slug creates nothing", () => {
  const db = world(), before = dump(db);
  exec(db, fill(ONBOARD, { __SLUG__: "alpha", __OWNER_EMAIL__: "intruder@evil.example" }));
  assert.deepEqual(changes(before, dump(db)), { added: [], changed: [], removed: [] }, "alpha has an active member: no invitation, no audit entry, nothing");
  // an existing organization that has a live invitation already is not given a second one either
  exec(db, fill(ONBOARD, { __SLUG__: "bravo", __OWNER_EMAIL__: "second@bravo.example" }));
  assert.deepEqual(changes(before, dump(db)), { added: [], changed: [], removed: [] });
  assert.equal(count(db, "invitations", "email IN ('intruder@evil.example', 'second@bravo.example')"), 0);
});
test("onboarding SQL: an expired, never-used invitation is closed and re-issued; after acceptance a re-run grants nothing", async () => {
  const db = world();
  exec(db, fill(ONBOARD));
  const orgId = bySlug(db, "acme-co");
  exec(db, "UPDATE invitations SET created_at = '2026-01-01T00:00:00.000Z', expires_at = '2026-01-08T00:00:00.000Z' WHERE email = 'owner@acme.example'"); // a week that has long passed
  exec(db, fill(ONBOARD));
  assert.deepEqual(rows(db, "SELECT status FROM invitations WHERE email = 'owner@acme.example' ORDER BY created_at").map((r) => r.status), ["expired", "pending"]);
  assert.equal(count(db, "activity_log", "action = 'org.onboarded'"), 1);
  // the owner signs in: invitation accepted through the real data-layer path
  const up = await repo.upsertUserFromIdentity(db, { workosUserId: "user_01ACMEOWNER", email: "owner@acme.example", name: "Acme Owner" });
  const act = await repo.activatePendingInvitations(db, { user: up.user, emailVerified: true });
  assert.ok(act.ok); assert.equal(act.activated.length, 1);
  const after = dump(db);
  exec(db, fill(ONBOARD));
  exec(db, fill(ONBOARD, { __OWNER_EMAIL__: "someone-else@acme.example" }));
  assert.deepEqual(changes(after, dump(db)), { added: [], changed: [], removed: [] }, "an organization with members receives no further owner from this file");
  assert.equal(count(db, "memberships", "organization_id = ? AND status = 'active'", orgId), 1);
});
test("onboarding SQL fails LOUDLY on unreplaced or bad placeholders, and the file can then be corrected and run again to a clean result", () => {
  const clean = world(); exec(clean, fill(ONBOARD));
  const bad = [
    ["unreplaced slug", { __SLUG__: "__SLUG__" }], ["unreplaced email", { __OWNER_EMAIL__: "__OWNER_EMAIL__" }], ["unreplaced name", { __NAME__: "__NAME__" }], ["unreplaced actor", { __ACTOR__: "__ACTOR__" }],
    ["upper-case slug", { __SLUG__: "Acme-Co" }], ["slug with a space", { __SLUG__: "acme co" }], ["double hyphen", { __SLUG__: "acme--co" }], ["upper-case email", { __OWNER_EMAIL__: "Owner@Acme.example" }], ["email with a space", { __OWNER_EMAIL__: "owner @acme.example" }], ["email without @", { __OWNER_EMAIL__: "owner" }],
  ];
  for (const [label, over] of bad) {
    const db = world();
    assert.throws(() => exec(db, fill(ONBOARD, over)), /constraint|CHECK|NOT NULL/i, label);
    assert.equal(count(db, "invitations", "status = 'pending' AND email NOT IN ('bravo-owner@example.com')"), 0, label + ": no invitation exists");
    exec(db, fill(ONBOARD)); // correct it and run again
    assert.equal(normalized(dump(db)), normalized(dump(clean)), label + ": a corrected re-run reaches the clean result");
  }
});

/* ------------------------------------------------------------------ add-first-project.sql */
test("project SQL = data layer: the same project and CLIENT-visible 'project created' entry as createProject + recordActivity", async () => {
  const bySql = world(), byCode = world();
  exec(bySql, fill(ONBOARD)); exec(bySql, fill(PROJECT));
  const org = await repo.createOrganization(byCode, { slug: "acme-co", name: "Acme Co" });
  await repo.createInvitation(byCode, org.organization.id, { email: "owner@acme.example", role: "owner", createdBy: ACTOR });
  await repo.recordActivity(byCode, { organizationId: org.organization.id, actorType: "admin", actorRef: ACTOR, action: "org.onboarded", entityType: "organization", entityId: org.organization.id, visibility: "internal" });
  const pr = await repo.createProject(byCode, org.organization.id, { name: "Acme website", kind: "website", status: "build" });
  assert.ok(pr.ok);
  await repo.recordActivity(byCode, { organizationId: org.organization.id, actorType: "admin", actorRef: ACTOR, action: "project.created", entityType: "project", entityId: pr.project.id, visibility: "client" });
  assert.equal(normalized(dump(bySql)), normalized(dump(byCode)));
});
test("project SQL is repeatable, resumable, scoped to one active organization, and rejects a bad status", () => {
  const db = world(); exec(db, fill(ONBOARD)); exec(db, fill(PROJECT));
  const once = JSON.stringify(dump(db));
  exec(db, fill(PROJECT)); exec(db, fill(PROJECT));
  assert.equal(JSON.stringify(dump(db)), once);
  const statements = statementsOf(fill(PROJECT)); assert.equal(statements.length, 2);
  for (let k = 0; k <= 2; k++) {
    const d = world(); exec(d, fill(ONBOARD)); for (const st of statements.slice(0, k)) exec(d, st); exec(d, fill(PROJECT));
    assert.equal(normalized(dump(d)), normalized(dump(db)), `stopped after statement ${k}`);
  }
  const before = dump(db);
  exec(db, fill(PROJECT, { __SLUG__: "no-such-org" })); // unknown organization: matches nothing
  exec(db, fill(PROJECT, { __SLUG__: "bravo" }));       // suspended organization: no project
  assert.deepEqual(changes(before, dump(db)), { added: [], changed: [], removed: [] });
  for (const over of [{ __PROJECT_STATUS__: "__PROJECT_STATUS__" }, { __PROJECT_STATUS__: "done" }, { __PROJECT_NAME__: "__PROJECT_NAME__" }, { __ACTOR__: "__ACTOR__" }]) {
    const d = world(); exec(d, fill(ONBOARD));
    assert.throws(() => exec(d, fill(PROJECT, over)), /constraint|CHECK|NOT NULL/i, JSON.stringify(over));
  }
});

/* ------------------------------------------------------------------ invite-member.sql */
test("invite SQL = data layer: the same invitation as createInvitation (+ one internal audit entry); repeatable and resumable", async () => {
  const bySql = world(), byCode = world();
  exec(bySql, fill(ONBOARD)); exec(bySql, fill(INVITE));
  const org = await repo.createOrganization(byCode, { slug: "acme-co", name: "Acme Co" });
  await repo.createInvitation(byCode, org.organization.id, { email: "owner@acme.example", role: "owner", createdBy: ACTOR });
  await repo.recordActivity(byCode, { organizationId: org.organization.id, actorType: "admin", actorRef: ACTOR, action: "org.onboarded", entityType: "organization", entityId: org.organization.id, visibility: "internal" });
  const inv = await repo.createInvitation(byCode, org.organization.id, { email: "second@acme.example", role: "member", createdBy: ACTOR });
  assert.ok(inv.ok);
  await repo.recordActivity(byCode, { organizationId: org.organization.id, actorType: "admin", actorRef: ACTOR, action: "member.invited", entityType: "invitation", entityId: inv.invitation.id, visibility: "internal" });
  assert.equal(normalized(dump(bySql)), normalized(dump(byCode)));
  const once = JSON.stringify(dump(bySql));
  exec(bySql, fill(INVITE)); exec(bySql, fill(INVITE));
  assert.equal(JSON.stringify(dump(bySql)), once);
  const statements = statementsOf(fill(INVITE)); assert.equal(statements.length, 3);
  for (let k = 0; k <= 3; k++) {
    const d = world(); exec(d, fill(ONBOARD)); for (const st of statements.slice(0, k)) exec(d, st); exec(d, fill(INVITE));
    assert.equal(normalized(dump(d)), normalized(dump(bySql)), `stopped after statement ${k}`);
    assert.equal(count(d, "activity_log", "action = 'member.invited'"), 1, `k=${k}`);
  }
});
test("invite SQL is scoped to one active organization and one person: other organizations are untouched; unknown, suspended or wrongly spelled targets create nothing; bad input is rejected", async () => {
  const db = world(); exec(db, fill(ONBOARD));
  const before = dump(db);
  exec(db, fill(INVITE, { __SLUG__: "no-such-org" })); exec(db, fill(INVITE, { __SLUG__: "bravo" })); // unknown; suspended
  assert.deepEqual(changes(before, dump(db)), { added: [], changed: [], removed: [] });
  exec(db, fill(INVITE));
  const c = changes(before, dump(db));
  assert.deepEqual(c.changed, []); assert.deepEqual(c.removed, []); assert.deepEqual(c.added.map((k) => k.split(":")[0]).sort(), ["activity_log", "invitations"]);
  for (const over of [{ __ROLE__: "admin" }, { __ROLE__: "__ROLE__" }, { __EMAIL__: "Second@Acme.example" }, { __EMAIL__: "__EMAIL__" }, { __ACTOR__: "__ACTOR__" }]) {
    const d = world(); exec(d, fill(ONBOARD));
    assert.throws(() => exec(d, fill(INVITE, over)), /constraint|CHECK|NOT NULL/i, JSON.stringify(over));
  }
  // someone who is already an active member is not invited again (and a re-invite never downgrades or duplicates)
  const up = await repo.upsertUserFromIdentity(db, { workosUserId: "user_01SECOND00", email: "second@acme.example", name: "Second" });
  assert.ok((await repo.activatePendingInvitations(db, { user: up.user, emailVerified: true })).ok);
  const after = dump(db);
  exec(db, fill(INVITE));
  assert.deepEqual(changes(after, dump(db)), { added: [], changed: [], removed: [] });
  assert.equal(count(db, "memberships", "status = 'active' AND user_id = ?", up.user.id), 1);
});

/* ------------------------------------------------------------------ verify-organization.sql */
test("verify SQL is read-only and answers the questions the runbook asks", () => {
  const db = world(); exec(db, fill(ONBOARD)); exec(db, fill(PROJECT));
  const before = JSON.stringify(dump(db));
  const queries = statementsOf(fill(VERIFY));
  assert.equal(queries.length, 6);
  for (const q of queries) assert.match(q, /^SELECT\b/i);
  const results = queries.map((q) => db.raw.prepare(q).all());
  assert.equal(JSON.stringify(dump(db)), before, "changes nothing");
  assert.equal(results[0].length, 1); assert.equal(results[0][0].slug, "acme-co");
  assert.deepEqual(results[1].map((r) => [r.email, r.role, r.status]), [["owner@acme.example", "owner", "pending"]]);
  assert.equal(results[2].length, 0, "no members before the first sign-in");
  assert.deepEqual(results[3].map((r) => r.name), ["Acme website"]);
  assert.deepEqual(results[4].map((r) => [r.action, r.visibility]).sort(), [["org.onboarded", "internal"], ["project.created", "client"]]);
  assert.ok(results[5].some((r) => r.slug === "acme-co") && results[5].some((r) => r.slug === "alpha"));
});
test("the onboarding SQL files are narrow and non-destructive: only INSERT / UPDATE, every statement named after one slug, known placeholders only, known tables only", () => {
  for (const [name, sql, expectedPlaceholders] of [["onboard-organization.sql", ONBOARD, ["__ACTOR__", "__NAME__", "__OWNER_EMAIL__", "__SLUG__"]], ["add-first-project.sql", PROJECT, ["__ACTOR__", "__PROJECT_NAME__", "__PROJECT_STATUS__", "__SLUG__"]], ["invite-member.sql", INVITE, ["__ACTOR__", "__EMAIL__", "__ROLE__", "__SLUG__"]]]) {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    assert.ok(!/\b(DELETE|DROP|ALTER|PRAGMA|BEGIN|COMMIT|ROLLBACK|ATTACH|TRIGGER|REPLACE|TRUNCATE|CREATE)\b/i.test(code), name);
    assert.deepEqual([...new Set(code.match(/__[A-Z_]+__/g))].sort(), expectedPlaceholders, name);
    for (const st of statementsOf(sql)) {
      assert.ok(/^(UPDATE|INSERT INTO)\b/.test(st), `${name}: ${st.slice(0, 40)}`);
      assert.ok(st.includes("'__SLUG__'"), `${name}: every statement is scoped by the slug: ${st.slice(0, 60)}`);
      assert.ok(/\bWHERE\b/i.test(st), `${name}: every statement has a WHERE: ${st.slice(0, 60)}`);
    }
    for (const t of code.match(/\b(?:UPDATE|INTO|FROM|JOIN)\s+(\w+)/gi).map((x) => x.split(/\s+/)[1])) assert.ok(["organizations", "invitations", "memberships", "activity_log", "projects", "portal_users"].includes(t), `${name}: ${t}`);
    assert.match(sql, /^-- Framework client portal/);
  }
  const verify = VERIFY.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE|CREATE|PRAGMA)\b/i.test(verify), "verify-organization.sql is SELECT only");
  assert.ok(!readdirSync(new URL("../../migrations/portal/", import.meta.url)).some((f) => /onboard|project|verify/i.test(f)), "not in the migrations folder wrangler applies");
  assert.deepEqual(readdirSync(OPS).sort(), ["README.md", "add-first-project.sql", "emergency-offboard.sql", "emergency-reenable.sql", "invite-member.sql", "onboard-organization.sql", "verify-organization.sql"]);
});

/* ------------------------------------------------------------------ the result through the real router */
test("end to end through the real router: SQL-onboarded organization works for its owner, a second organization stays invisible to them, and the project shows", async () => {
  const w = await makeWorld();
  exec(w.db, fill(ONBOARD)); exec(w.db, fill(PROJECT));
  exec(w.db, fill(ONBOARD, { __SLUG__: "other-co", __NAME__: "Other Co", __OWNER_EMAIL__: "owner@other.example" }));
  exec(w.db, fill(PROJECT, { __SLUG__: "other-co", __PROJECT_NAME__: "Other secret project" }));
  const owner = w.user(1, "owner@acme.example");
  const b = w.browser();
  assert.equal((await b.signIn(owner)).status, 303);
  const home = await b.get("/portal");
  assert.equal(home.status, 303);
  assert.equal(home.headers.get("Location"), "/portal/o/acme-co", "one organization: straight to it");
  const org = await b.get("/portal/o/acme-co");
  assert.equal(org.status, 200);
  const html = await org.text();
  assert.match(html, /Acme Co/); assert.match(html, /Acme website/);
  assert.doesNotMatch(html, /Other secret project|Other Co/);
  assert.equal((await b.get("/portal/o/other-co")).status, 404, "another organization is not found, not forbidden");
  assert.equal((await b.get("/portal/o/other-co/projects")).status, 404);
  assert.equal(count(w.db, "memberships", "status = 'active'"), 1);
  assert.equal(count(w.db, "invitations", "status = 'pending' AND email = 'owner@other.example'"), 1, "the other organization's invitation stays unused");
  // a stranger (no invitation) signs in with WorkOS but gets nothing
  const stranger = w.browser();
  assert.equal((await stranger.signIn(w.user(2, "stranger@example.com"))).status, 303);
  assert.equal((await stranger.get("/portal/o/acme-co")).status, 404);
});
test("the runbook README documents onboarding: who does what, the isolation check, the first sign-in test and the cleanup", () => {
  for (const needle of ["onboard-organization.sql", "add-first-project.sql", "invite-member.sql", "verify-organization.sql", "Create the WorkOS user", "tenant isolation", "first sign-in", "Do not assume the D1 Console", "emergency-offboard.sql", "email_conflict", "never delete the WorkOS user"]) assert.ok(README.toLowerCase().includes(needle.toLowerCase()), needle);
});

test("launch documents exist, stay out of the public site, and cover the decisions the launch needs", () => {
  const dir = new URL("../portal/", import.meta.url);
  const launch = readFileSync(new URL("LAUNCH.md", dir), "utf8"), draft = readFileSync(new URL("PRIVACY-DRAFT.md", dir), "utf8");
  for (const needle of ["MFA recommendation", "Required", "Mandatory", "Recommended", "first Production sign-in test", "WAF", "Tenant isolation", "PORTAL_ALLOW_PRODUCTION", "Time Travel", "email_conflict", "launch change"]) assert.ok(launch.includes(needle), "LAUNCH.md: " + needle);
  for (const needle of ["DRAFT", "WorkOS", "cookies", "United States", "Alberta", "PIPA", "[DECISION", "retention", "hello@frameworkco.ca"]) assert.ok(draft.includes(needle) || draft.toLowerCase().includes(needle.toLowerCase()), "PRIVACY-DRAFT.md: " + needle);
  const ignore = readFileSync(new URL("../../.assetsignore", import.meta.url), "utf8").split("\n").map((l) => l.trim());
  assert.ok(ignore.includes("worker/"), "worker/ (and so these drafts) is never published as a static asset");
  assert.ok(!/PORTAL_ENABLED"\s*:\s*"1"/.test(launch.replace(/`[^`]*`/g, "")), "the plan does not itself enable anything");
});
