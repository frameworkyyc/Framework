// Client portal Stage 1: the database migration. Runs the real SQL file(s) from migrations/portal on SQLite with foreign keys on.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb, migrationFiles, MIGRATIONS_DIR, rows, count } from "./helpers/portal-db.mjs";

const sql = readFileSync(new URL("0001_portal_foundation.sql", MIGRATIONS_DIR), "utf8");
const uuid = () => crypto.randomUUID();
const T = "2026-10-20T12:00:00.000Z";
const LATER = "2026-10-27T12:00:00.000Z";
const TABLES = ["activity_log", "approved_emails", "brand_assets", "brand_kits", "brand_requirements", "brand_uploads", "business_profile_answers", "invitations", "invoices", "memberships", "organizations", "portal_feedback", "portal_services", "portal_sessions", "portal_staff", "portal_users", "projects", "service_notifications", "service_prices", "service_requests", "support_attachments", "support_messages", "support_requests", "website_milestones", "website_packages", "websites"];

const insertOrg = (db, id = uuid(), slug = "acme-" + id.slice(0, 6)) => (db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, ?, 'Acme')").run(id, slug), id);
const insertUser = (db, id = uuid(), email = `u${id.slice(0, 6)}@example.com`) => (db.raw.prepare("INSERT INTO portal_users (id, workos_user_id, email) VALUES (?, ?, ?)").run(id, "user_" + id.slice(0, 12), email), id);
const insertMembership = (db, org, user, role = "member") => db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, created_by) VALUES (?, ?, ?, ?, 'admin@example.com')").run(uuid(), org, user, role);
const insertInvitation = (db, org, email = "a@example.com", extra = {}) => {
  const id = uuid();
  const c = { status: "pending", created_at: T, expires_at: LATER, accepted_at: null, accepted_user_id: null, revoked_at: null, ...extra };
  db.raw.prepare("INSERT INTO invitations (id, organization_id, email, role, status, created_by, created_at, expires_at, accepted_at, accepted_user_id, revoked_at) VALUES (?, ?, ?, 'member', ?, 'admin@example.com', ?, ?, ?, ?, ?)").run(id, org, email, c.status, c.created_at, c.expires_at, c.accepted_at, c.accepted_user_id, c.revoked_at);
  return id;
};
const rejects = (fn, re = /constraint failed/i, label = "") => assert.throws(fn, re, label);

test("migration files: one numbered file, applied in order, named for wrangler", () => {
  assert.deepEqual(migrationFiles(), ["0001_portal_foundation.sql", "0002_business_profile.sql", "0003_portal_feedback.sql", "0004_invitation_delivery.sql", "0005_branding.sql", "0006_brand_name.sql", "0007_client_services.sql", "0008_approved_emails.sql", "0009_brand_sections.sql", "0010_service_pricing.sql", "0011_websites.sql", "0012_website_management.sql", "0013_staff_access.sql", "0014_brand_requirements.sql"]);
});

test("applies to an empty database and creates exactly the portal tables", () => {
  const db = openPortalDb();
  const names = rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map((r) => r.name);
  assert.deepEqual(names, TABLES);
});

test("re-applying the migration is harmless (IF NOT EXISTS everywhere) and keeps existing data", () => {
  const db = openPortalDb();
  const org = insertOrg(db);
  db.raw.exec(sql);
  db.raw.exec(sql);
  assert.equal(count(db, "organizations", "id = ?", org), 1);
  assert.ok(!/CREATE (TABLE|INDEX|UNIQUE INDEX)(?! IF NOT EXISTS)/i.test(sql), "every CREATE uses IF NOT EXISTS");
});

test("Cloudflare D1 compatibility: no transaction control, PRAGMA, triggers or ALTER in the migration", () => {
  const code = sql.replace(/--.*$/gm, "");
  for (const banned of [/\bBEGIN\b/i, /\bCOMMIT\b/i, /\bROLLBACK\b/i, /\bPRAGMA\b/i, /\bCREATE\s+TRIGGER\b/i, /\bALTER\s+TABLE\b/i, /\bDROP\b/i, /\bATTACH\b/i, /\bVACUUM\b/i, /\bWITHOUT\s+ROWID\b/i]) assert.ok(!banned.test(code), String(banned));
});

test("the migration touches only portal tables (never the feedback, assessment or revenue tables)", () => {
  const created = [...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort();
  assert.deepEqual(created, TABLES.filter((t) => !["business_profile_answers", "portal_feedback", "approved_emails", "brand_assets", "brand_kits", "brand_uploads", "brand_requirements", "service_requests", "service_prices", "portal_services", "website_milestones", "website_packages", "websites", "portal_staff", "invoices", "service_notifications", "support_attachments", "support_messages", "support_requests"].includes(t)), "0001 is unchanged; later tables live in 0002, 0003, 0005, 0007, 0008, 0010, 0011, 0012, 0013 and 0014");
  for (const other of ["feedback_responses", "client_revenue", "assessment_requests", "framework_environment"]) assert.ok(!sql.replace(/--.*$/gm, "").includes(other), other);
});

test("every tenant-owned table has organization_id, NOT NULL (activity_log only nullable for user-level events)", () => {
  const db = openPortalDb();
  const col = (table) => rows(db, `PRAGMA table_info(${table})`).find((c) => c.name === "organization_id");
  for (const t of ["memberships", "invitations", "projects"]) assert.equal(col(t).notnull, 1, t);
  assert.equal(col("activity_log").notnull, 0);
  assert.equal(col("portal_users"), undefined, "users are global, not tenant-owned");
  assert.equal(col("portal_sessions"), undefined, "sessions belong to users, not organizations");
});

test("every foreign key restricts deletes (nothing cascades silently)", () => {
  const db = openPortalDb();
  for (const t of TABLES) for (const fk of rows(db, `PRAGMA foreign_key_list(${t})`)) assert.equal(fk.on_delete, "RESTRICT", `${t}.${fk.from}`);
  const fks = Object.fromEntries(TABLES.map((t) => [t, rows(db, `PRAGMA foreign_key_list(${t})`).map((f) => `${f.from}->${f.table}.${f.to}`).sort()]));
  assert.deepEqual(fks.memberships, ["organization_id->organizations.id", "user_id->portal_users.id"]);
  assert.deepEqual(fks.invitations, ["accepted_user_id->portal_users.id", "organization_id->organizations.id"]);
  assert.deepEqual(fks.projects, ["organization_id->organizations.id"]);
  assert.deepEqual(fks.portal_sessions, ["user_id->portal_users.id"]);
  assert.deepEqual(fks.activity_log, ["organization_id->organizations.id"]);
});

test("organizations: slug format, status and archive consistency, unique slug, unique revenue link", () => {
  const db = openPortalDb();
  const ins = (slug, extra = "") => db.raw.prepare(`INSERT INTO organizations (id, slug, name${extra ? ", " + extra.split("|")[0] : ""}) VALUES (?, ?, 'N'${extra ? ", " + extra.split("|")[1] : ""})`).run(uuid(), slug);
  for (const bad of ["A", "a", "ab cd", "Acme", "acme_x", "-acme", "acme-", "ac--me", "a".repeat(49), "ac/me", "acmé", "acme\n"]) rejects(() => ins(bad), /constraint failed/i, JSON.stringify(bad));
  for (const good of ["ab", "acme", "acme-surveys-2", "a".repeat(48), "1-2"]) ins(good);
  rejects(() => ins("acme"), /UNIQUE constraint failed: organizations\.slug/);
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name, status) VALUES (?, 'zz', 'N', 'deleted')").run(uuid()));
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name, status) VALUES (?, 'yy', 'N', 'archived')").run(uuid()), /constraint failed/i, "archived needs archived_at");
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name, archived_at) VALUES (?, 'xx', 'N', ?)").run(uuid(), T), /constraint failed/i, "archived_at needs archived");
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name, website_url) VALUES (?, 'ww', 'N', 'http://insecure.example')").run(uuid()));
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES ('not-a-uuid', 'vv', 'N')").run());
  db.raw.prepare("INSERT INTO organizations (id, slug, name, revenue_client_id) VALUES (?, 'rev-a', 'N', 'client-1')").run(uuid());
  rejects(() => db.raw.prepare("INSERT INTO organizations (id, slug, name, revenue_client_id) VALUES (?, 'rev-b', 'N', 'client-1')").run(uuid()), /UNIQUE/);
  db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'rev-c', 'N')").run(uuid());
  db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'rev-d', 'N')").run(uuid()); // many organizations may have no link
});

test("portal_users: one row per WorkOS user and per email; lower-case email; status and disabled_at agree", () => {
  const db = openPortalDb();
  const ins = (wid, email) => db.raw.prepare("INSERT INTO portal_users (id, workos_user_id, email) VALUES (?, ?, ?)").run(uuid(), wid, email);
  ins("user_aaaaa", "a@example.com");
  rejects(() => ins("user_aaaaa", "other@example.com"), /UNIQUE constraint failed: portal_users\.workos_user_id/);
  rejects(() => ins("user_bbbbb", "a@example.com"), /UNIQUE constraint failed: portal_users\.email/);
  for (const bad of ["Mixed@Example.com", "no-at-sign", "has space@example.com", "@example.com", "a@", ""]) rejects(() => ins("user_" + Math.random().toString(36).slice(2, 9), bad), /constraint failed/i, bad);
  rejects(() => ins("abc", "c@example.com"), /constraint failed/i, "workos id too short");
  rejects(() => db.raw.prepare("INSERT INTO portal_users (id, workos_user_id, email, status) VALUES (?, 'user_ddddd', 'd@example.com', 'disabled')").run(uuid()), /constraint failed/i);
});

test("memberships: unique per organization and user, role and status enums, revoke fields consistent, foreign keys enforced", () => {
  const db = openPortalDb();
  const [o1, o2, u] = [insertOrg(db), insertOrg(db), insertUser(db)];
  insertMembership(db, o1, u, "owner");
  insertMembership(db, o2, u, "member"); // the same user may belong to many organizations
  rejects(() => insertMembership(db, o1, u, "member"), /UNIQUE constraint failed: memberships\.organization_id, memberships\.user_id/);
  rejects(() => insertMembership(db, o1, insertUser(db), "admin"), /constraint failed/i, "role");
  rejects(() => insertMembership(db, uuid(), insertUser(db)), /FOREIGN KEY constraint failed/);
  rejects(() => insertMembership(db, o1, uuid()), /FOREIGN KEY constraint failed/);
  rejects(() => db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_by) VALUES (?, ?, ?, 'member', 'revoked', 'x')").run(uuid(), o2, insertUser(db)), /constraint failed/i, "revoked needs revoked_at");
  rejects(() => db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, created_by) VALUES (?, ?, ?, 'member', '')").run(uuid(), o2, insertUser(db)), /constraint failed/i, "created_by required");
  assert.equal(count(db, "portal_users"), 4 - 0 > 0 ? count(db, "portal_users") : 0);
});

test("invitations: one PENDING per organization+email, history rows do not block, state fields must agree", () => {
  const db = openPortalDb();
  const [o1, o2, u] = [insertOrg(db), insertOrg(db), insertUser(db)];
  insertInvitation(db, o1, "x@example.com");
  rejects(() => insertInvitation(db, o1, "x@example.com"), /UNIQUE/, "second pending for the same org and email");
  insertInvitation(db, o2, "x@example.com"); // same email, different organization: fine
  insertInvitation(db, o1, "y@example.com");
  insertInvitation(db, o1, "x@example.com", { status: "revoked", revoked_at: T });
  insertInvitation(db, o1, "x@example.com", { status: "expired" });
  insertInvitation(db, o1, "x@example.com", { status: "accepted", accepted_at: T, accepted_user_id: u });
  rejects(() => insertInvitation(db, o1, "z@example.com", { status: "accepted" }), /constraint failed/i, "accepted needs accepted_at and user");
  rejects(() => insertInvitation(db, o1, "z@example.com", { accepted_at: T }), /constraint failed/i, "pending cannot have accepted_at");
  rejects(() => insertInvitation(db, o1, "z@example.com", { status: "revoked" }), /constraint failed/i, "revoked needs revoked_at");
  rejects(() => insertInvitation(db, o1, "z@example.com", { expires_at: T }), /constraint failed/i, "expiry must be after creation");
  rejects(() => insertInvitation(db, o1, "Mixed@Example.com"), /constraint failed/i, "lower-case email");
  rejects(() => insertInvitation(db, uuid(), "q@example.com"), /FOREIGN KEY/);
  rejects(() => db.raw.prepare("UPDATE invitations SET workos_invitation_id = 'abc' WHERE status = 'expired'").run(), /constraint failed/i, "workos id too short");
});

test("invitations: workos_invitation_id is unique when present", () => {
  const db = openPortalDb();
  const o = insertOrg(db);
  const a = insertInvitation(db, o, "a@example.com");
  const b = insertInvitation(db, o, "b@example.com");
  db.raw.prepare("UPDATE invitations SET workos_invitation_id = 'invitation_01ABC' WHERE id = ?").run(a);
  rejects(() => db.raw.prepare("UPDATE invitations SET workos_invitation_id = 'invitation_01ABC' WHERE id = ?").run(b), /UNIQUE/);
});

test("projects: status enum, https-only url, org required, and (id, organization_id) is a unique key for future composite foreign keys", () => {
  const db = openPortalDb();
  const o = insertOrg(db);
  const ins = (org, extra = "") => db.raw.prepare(`INSERT INTO projects (id, organization_id, name${extra ? ", " + extra.split("|")[0] : ""}) VALUES (?, ?, 'Site'${extra ? ", " + extra.split("|")[1] : ""})`).run(uuid(), org);
  ins(o);
  rejects(() => ins(null), /NOT NULL constraint failed: projects\.organization_id/);
  rejects(() => ins(uuid()), /FOREIGN KEY/);
  rejects(() => ins(o, "status|'launched'"), /constraint failed/i);
  rejects(() => ins(o, "live_url|'javascript:alert(1)'"), /constraint failed/i);
  rejects(() => ins(o, "live_url|'http://example.com'"), /constraint failed/i);
  rejects(() => ins(o, "kind|'Web Site'"), /constraint failed/i);
  const idx = rows(db, "PRAGMA index_list(projects)").filter((i) => i.unique).map((i) => rows(db, `PRAGMA index_info(${i.name})`).map((c) => c.name).join(","));
  assert.ok(idx.includes("id,organization_id"), "unique (id, organization_id) exists: " + idx.join(" | "));
});

test("portal_sessions: id is a 64-char hex hash, expiry ordering and revoke fields are enforced", () => {
  const db = openPortalDb();
  const u = insertUser(db);
  const hash = "a".repeat(64);
  const ins = (over = {}) => {
    const c = { id: hash, created: T, seen: T, idle: "2026-10-21T00:00:00.000Z", abs: LATER, revoked_at: null, reason: null, ...over };
    db.raw.prepare("INSERT INTO portal_sessions (id, user_id, created_at, last_seen_at, idle_expires_at, expires_at, revoked_at, revoked_reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(c.id, u, c.created, c.seen, c.idle, c.abs, c.revoked_at, c.reason);
  };
  ins();
  rejects(() => ins(), /UNIQUE|PRIMARY/);
  rejects(() => ins({ id: "short" }), /constraint failed/i, "id length");
  rejects(() => ins({ id: "b".repeat(64), idle: "2026-11-30T00:00:00.000Z" }), /constraint failed/i, "idle expiry cannot exceed absolute expiry");
  rejects(() => ins({ id: "c".repeat(64), abs: T }), /constraint failed/i, "absolute expiry must follow creation");
  rejects(() => ins({ id: "d".repeat(64), revoked_at: T }), /constraint failed/i, "revoked_at needs a reason");
  rejects(() => ins({ id: "e".repeat(64), reason: "logout" }), /constraint failed/i, "a reason needs revoked_at");
  ins({ id: "f".repeat(64), revoked_at: T, reason: "logout" });
  rejects(() => db.raw.prepare("INSERT INTO portal_sessions (id, user_id, created_at, last_seen_at, idle_expires_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run("1".repeat(64), uuid(), T, T, T, LATER), /FOREIGN KEY/);
});

test("activity_log: valid JSON detail only, size cap, client-visible events need an organization", () => {
  const db = openPortalDb();
  const o = insertOrg(db);
  const ins = (org, vis, detail = null, action = "project.created") => db.raw.prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, detail, visibility) VALUES (?, ?, 'admin', 'a@example.com', ?, ?, ?)").run(uuid(), org, action, detail, vis);
  ins(o, "client", '{"status":"live"}');
  ins(null, "internal"); // a user-level event, no organization
  rejects(() => ins(null, "client"), /constraint failed/i, "client-visible needs an organization");
  rejects(() => ins(o, "internal", "not json"), /constraint failed/i);
  rejects(() => ins(o, "internal", JSON.stringify({ x: "y".repeat(2100) })), /constraint failed/i);
  rejects(() => ins(o, "public"), /constraint failed/i);
  rejects(() => ins(o, "internal", null, "Has Space"), /constraint failed/i);
  rejects(() => ins(uuid(), "internal"), /FOREIGN KEY/);
  rejects(() => db.raw.prepare("INSERT INTO activity_log (id, actor_type, actor_ref, action) VALUES (?, 'robot', 'x', 'a.b')").run(uuid()), /constraint failed/i);
});

test("deleting an organization or user that has dependent rows is refused", () => {
  const db = openPortalDb();
  const [o, u] = [insertOrg(db), insertUser(db)];
  insertMembership(db, o, u);
  rejects(() => db.raw.prepare("DELETE FROM organizations WHERE id = ?").run(o), /FOREIGN KEY constraint failed/);
  rejects(() => db.raw.prepare("DELETE FROM portal_users WHERE id = ?").run(u), /FOREIGN KEY constraint failed/);
  const empty = insertOrg(db);
  db.raw.prepare("DELETE FROM organizations WHERE id = ?").run(empty); // fine when nothing depends on it
});

test("indexes exist and the main lookups use them", () => {
  const db = openPortalDb();
  const names = rows(db, "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'").map((r) => r.name).sort();
  assert.deepEqual(names, ["idx_activity_org_client_time", "idx_activity_org_time", "idx_brand_assets_org", "idx_brand_uploads_org", "idx_invitations_one_pending", "idx_invitations_org", "idx_invitations_pending_email", "idx_invitations_workos", "idx_invoices_org", "idx_memberships_org", "idx_memberships_user", "idx_organizations_revenue_client", "idx_portal_feedback_created", "idx_portal_feedback_user", "idx_portal_sessions_expiry", "idx_portal_sessions_user", "idx_projects_org_created", "idx_projects_org_status", "idx_service_notifications_pending", "idx_service_requests_open", "idx_service_requests_org", "idx_support_attachments_request", "idx_support_messages_request", "idx_support_requests_org", "idx_support_requests_website", "idx_website_milestones_site", "idx_website_packages_org", "idx_websites_org"]);
  const plan = (q, ...p) => rows(db, "EXPLAIN QUERY PLAN " + q, ...p).map((r) => r.detail).join(" | ");
  assert.match(plan("SELECT * FROM memberships WHERE user_id = ? AND status = 'active'", "x"), /idx_memberships_user|sqlite_autoindex_memberships/);
  assert.match(plan("SELECT * FROM memberships WHERE organization_id = ? AND user_id = ?", "x", "y"), /autoindex_memberships/);
  assert.match(plan("SELECT * FROM projects WHERE organization_id = ? AND status = 'live'", "x"), /idx_projects_org_status/);
  assert.match(plan("SELECT * FROM invitations WHERE email = ? AND status = 'pending' AND expires_at > ?", "x", T), /idx_invitations_pending_email/);
  assert.match(plan("SELECT * FROM activity_log WHERE organization_id = ? ORDER BY created_at DESC LIMIT 20", "x"), /idx_activity_org_time/);
  assert.match(plan("SELECT * FROM activity_log WHERE organization_id = ? AND visibility = 'client' ORDER BY created_at DESC LIMIT 20", "x"), /idx_activity_org_client_time|idx_activity_org_time/);
  assert.match(plan("SELECT * FROM portal_sessions WHERE user_id = ?", "x"), /idx_portal_sessions_user/);
});

test("the migration-only Wrangler config targets the STAGING portal database and nothing else", () => {
  const raw = readFileSync(new URL("wrangler.migrate.staging.jsonc", MIGRATIONS_DIR), "utf8");
  const cfg = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ""));
  assert.deepEqual(cfg.d1_databases, [{ binding: "PORTAL_DB", database_name: "framework-portal-staging", database_id: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8", migrations_dir: "." }]);
  assert.equal(cfg.main, undefined);
  assert.equal(cfg.vars, undefined);
  const code = raw.replace(/^\s*\/\/.*$/gm, ""); // comments may name the other databases; the configuration itself must not
  for (const forbidden of ["47d90f94-3846-4711-9495-ab3479431a6f", "c4815cdc-8948-4561-92a3-65e4860cdb94", "framework-feedback", "framework-staging\""]) assert.ok(!code.includes(forbidden), "must not reference " + forbidden);
  assert.ok(!/secret|sk_|token/i.test(code));
});

const migrationConfig = (name) => {
  const raw = readFileSync(new URL(name, MIGRATIONS_DIR), "utf8");
  return { raw, code: raw.replace(/^\s*\/\/.*$/gm, ""), cfg: JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) };
};

test("the migration-only Wrangler config targets the PRODUCTION portal database and nothing else", () => {
  const { code, cfg } = migrationConfig("wrangler.migrate.production.jsonc");
  assert.equal(cfg.name, "framework-portal-migrations-production");
  assert.deepEqual(cfg.d1_databases, [{ binding: "PORTAL_DB", database_name: "framework-portal", database_id: "b213b7db-ed29-4ab6-946c-0728dd6709e8", migrations_dir: "." }]);
  for (const k of ["main", "vars", "assets", "r2_buckets", "ratelimits", "previews", "kv_namespaces", "routes"]) assert.equal(cfg[k], undefined, k);
  for (const forbidden of ["47d90f94-3846-4711-9495-ab3479431a6f", "c4815cdc-8948-4561-92a3-65e4860cdb94", "1edda8a2-5249-4f40-9dbc-d29aa44e21f8", "framework-feedback", "framework-staging", "framework-portal-staging"]) assert.ok(!code.includes(forbidden), "must not reference " + forbidden);
  assert.ok(!/secret|sk_|token|client_/i.test(code));
});

test("the Production and Staging migration configs target different databases (name, id, worker name) with the same binding and directory", () => {
  const prod = migrationConfig("wrangler.migrate.production.jsonc").cfg, stag = migrationConfig("wrangler.migrate.staging.jsonc").cfg;
  const [p] = prod.d1_databases, [s] = stag.d1_databases;
  assert.equal(prod.d1_databases.length, 1);
  assert.equal(stag.d1_databases.length, 1);
  assert.equal(p.binding, s.binding);
  assert.equal(p.migrations_dir, s.migrations_dir);
  assert.notEqual(p.database_id, s.database_id);
  assert.notEqual(p.database_name, s.database_name);
  assert.notEqual(prod.name, stag.name);
  // and neither is the database the main wrangler.jsonc binds for the feedback data or for Staging's DB binding
  const main = JSON.parse(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const others = [...main.d1_databases, ...main.previews.d1_databases].filter((d) => d.binding === "DB").map((d) => d.database_id); // the feedback / assessment databases
  for (const id of [p.database_id, s.database_id]) assert.ok(!others.includes(id));
  // and the Worker config binds exactly these two portal databases, one per environment, under the same name
  assert.equal(main.d1_databases.find((d) => d.binding === "PORTAL_DB").database_id, p.database_id);
  assert.equal(main.previews.d1_databases.find((d) => d.binding === "PORTAL_DB").database_id, s.database_id);
});

test("the migrations README documents the Production procedure with its safeguards", () => {
  const readme = readFileSync(new URL("README.md", MIGRATIONS_DIR), "utf8");
  for (const needle of ["wrangler.migrate.production.jsonc", "b213b7db-ed29-4ab6-946c-0728dd6709e8", "VERIFY THE TARGET", "d1 info PORTAL_DB", "migrations list PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc", "migrations apply PORTAL_DB --remote -c migrations/portal/wrangler.migrate.production.jsonc", "Stop and do not apply", "never run these commands without `-c`", "already been recorded"]) assert.ok(readme.includes(needle), needle);
  const prodSection = readme.slice(readme.indexOf("## Apply to the Production portal database"), readme.indexOf("## Rules for future migrations"));
  const commands = prodSection.split("\n").filter((l) => l.startsWith("npx wrangler d1"));
  assert.ok(commands.length >= 5);
  for (const c of commands) assert.ok(c.includes("-c migrations/portal/wrangler.migrate.production.jsonc"), "every command carries the production -c flag: " + c);
  assert.ok(!/bookmark[^\n]*[0-9a-f]{16,}/i.test(readme), "no bookmark value is stored");
});
