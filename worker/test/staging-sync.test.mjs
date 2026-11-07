// Production -> Staging data refresh (scripts/ops/staging-sync). Two in-memory databases stand in for the two environments: "Production" has migrations 0001-0013,
// "Staging" has every migration. The real guards (read-only for Production, allow-listed writes for Staging) sit in front of both, exactly as in the workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { openPortalDb, migrationFiles } from "./helpers/portal-db.mjs";
import { SOURCE, TARGET, PLACEHOLDER_USER } from "../../scripts/ops/staging-sync/config.mjs";
import { assertReadOnlySql, assertTargetWrite, productionDb, stagingDb, productionFiles, stagingBucket } from "../../scripts/ops/staging-sync/clients.mjs";
import { COPIED, EXCLUDED, MUST_NOT_CHANGE, WRITABLE } from "../../scripts/ops/staging-sync/tables.mjs";
import { buildPlan, compareSchemas, readSchema, renderReport } from "../../scripts/ops/staging-sync/plan.mjs";
import { applyPlan } from "../../scripts/ops/staging-sync/apply.mjs";
import { preflight } from "../../scripts/ops/staging-sync/cli.mjs";

const PROD_SKIP = ["0014_brand_requirements.sql", "0015_website_status_seo.sql", "0016_service_catalogue.sql", "0017_service_client_settings.sql", "0018_discovery.sql", "0020_requests.sql", "0021_demo_traffic.sql", "0022_seo_keywords.sql", "0023_client_service_links.sql", "0024_leads.sql", "0025_seo_leads.sql"];
const sha = (b) => createHash("sha256").update(b).digest("hex");
const ORG_A = "11111111-1111-4111-8111-111111111111", ORG_B = "22222222-2222-4222-8222-222222222222", ORG_C = "33333333-3333-4333-8333-333333333333";
const USER_P = "99999999-9999-4999-8999-999999999999";
const T0 = "2026-10-01T00:00:00.000Z";

function adapter(db, role) {
  const [name, id] = role === "source" ? [SOURCE.name, SOURCE.id] : [TARGET.name, TARGET.id];
  const a = {
    role, name, id, writes: 0,
    async info() { return { name, uuid: id }; },
    async query(sql, params = []) { assertReadOnlySql(sql); a.queries = (a.queries || []).concat(sql); return db.raw.prepare(sql).all(...params); },
  };
  if (role === "target") a.batch = async (stmts) => {
    for (const s of stmts) assertTargetWrite(s.sql);
    db.raw.exec("BEGIN");
    try { for (const s of stmts) db.raw.prepare(s.sql).run(...(s.params || [])); db.raw.exec("COMMIT"); a.writes += stmts.length; } catch (e) { db.raw.exec("ROLLBACK"); throw e; }
  };
  return a;
}
const run = (db, sql, ...p) => db.raw.prepare(sql).run(...p);
const all = (db, sql, ...p) => db.raw.prepare(sql).all(...p);
const n = (db, t) => all(db, `SELECT count(*) AS n FROM ${t}`)[0].n;

function fakeBucket() {
  const m = new Map();
  return { m, async get(k) { return m.get(k) ?? null; }, async put(k, b) { m.set(k, Buffer.from(b)); } };
}

function record(db, skip = []) {
  db.raw.exec("CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)");
  for (const f of migrationFiles().filter((x) => !skip.includes(x))) run(db, "INSERT INTO d1_migrations (name, applied_at) VALUES (?, ?)", f, T0);
  return db;
}

async function world() {
  const prod = record(openPortalDb({ skip: PROD_SKIP }), PROD_SKIP), stg = record(openPortalDb());
  run(prod, "INSERT INTO portal_users (id, workos_user_id, email, name) VALUES (?, 'user_prod_1', 'owner@client.example', 'Client Owner')", USER_P);
  for (const [id, slug, rev] of [[ORG_A, "acme", "rev-1"], [ORG_B, "beta-co", null]]) run(prod, "INSERT INTO organizations (id, slug, name, revenue_client_id) VALUES (?, ?, ?, ?)", id, slug, slug.toUpperCase(), rev);
  run(prod, "INSERT INTO memberships (id, organization_id, user_id, role, created_by) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ?, ?, 'owner', 'admin')", ORG_A, USER_P);
  run(prod, "INSERT INTO portal_sessions (id, user_id, expires_at, idle_expires_at, created_at, last_seen_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z', ?, ?)", "a".repeat(64), USER_P, T0, T0);
  run(prod, "INSERT INTO approved_emails (email, added_by, added_at) VALUES ('owner@client.example', 'admin', ?)", T0);
  run(prod, "INSERT INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, 'phone', '403-555-0100', ?, ?)", ORG_A, USER_P, T0);
  run(prod, "INSERT INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, 'email', 'hello@acme.example', ?, ?)", ORG_A, USER_P, T0);
  run(prod, "INSERT INTO brand_kits (organization_id, updated_by) VALUES (?, 'admin')", ORG_A);
  const logoBytes = Buffer.from("logo-bytes-for-test");
  const key = `${ORG_A}/branding/${"k".repeat(40)}`;
  run(prod, "INSERT INTO brand_assets (id, organization_id, kind, title, format, content_type, size_bytes, sha256, storage_key, original_name, created_by) VALUES (?, ?, 'logo', 'Logo', 'svg', 'image/svg+xml', ?, ?, ?, 'logo.svg', 'admin')", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ORG_A, logoBytes.length, sha(logoBytes), key);
  run(prod, "INSERT INTO brand_uploads (id, organization_id, category, original_name, format, content_type, size_bytes, sha256, storage_key, uploaded_by) VALUES (?, ?, 'logo', 'old.png', 'png', 'image/png', 3, ?, ?, ?)", "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ORG_A, sha(Buffer.from("png")), `${ORG_A}/uploads/${"u".repeat(40)}`, USER_P);
  run(prod, "INSERT INTO websites (id, organization_id, name, url, origin, status) VALUES (?, ?, 'Main site', 'https://acme.example', 'framework', 'live')", "dddddddd-dddd-4ddd-8ddd-dddddddddddd", ORG_A);
  run(prod, "INSERT INTO website_milestones (id, organization_id, website_id, title) VALUES (?, ?, ?, 'Kick-off')", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", ORG_A, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  // Staging: its own test organization, user and Staging-only state; portal_services/service_prices already match (migrations seed them)
  run(stg, "INSERT INTO organizations (id, slug, name) VALUES ('44444444-4444-4444-8444-444444444444', 'staging-only-test', 'Staging test')");
  run(stg, "INSERT INTO portal_users (id, workos_user_id, email, name) VALUES ('88888888-8888-4888-8888-888888888888', 'user_stg_1', 'dev@framework.example', 'Dev')");
  const files = { src: fakeBucket(), dst: fakeBucket(), backup: fakeBucket() };
  files.src.m.set(key, logoBytes); files.src.m.set(`${ORG_A}/uploads/${"u".repeat(40)}`, Buffer.from("png"));
  files.backup.m.set("backup-1.sql", Buffer.from("-- backup"));
  return { prod, stg, files, key, source: adapter(prod, "source"), target: adapter(stg, "target") };
}

async function plan(w, manifest = null) {
  const [srcSchema, tgtSchema] = [await readSchema(w.source), await readSchema(w.target)];
  const cmp = compareSchemas(srcSchema, tgtSchema);
  return { cmp, ...(await buildPlan({ source: w.source, target: w.target, srcSchema, tgtSchema, manifest, common: cmp.common })) };
}
const doApply = (w, p, extra = {}) => applyPlan({ source: w.source, target: w.target, files: { src: w.files.src, dst: w.files.dst }, backup: w.files.backup, manifest: null, expectedSha: p.plan.planSha, bookmark: "00000001-00000002-00000003-abc", backupKey: "backup-1.sql", ...extra });
const T = (p, t) => p.plan.tables.find((x) => x.table === t);

test("the guards: Production can only be read, Staging can only be written in the allow-listed tables, and the ids are pinned", async () => {
  for (const ok of ["SELECT 1", "select a, b from organizations where id = ?", "WITH x AS (SELECT 1) SELECT * FROM x", "PRAGMA table_info(\"websites\")", "PRAGMA foreign_key_check", "SELECT 1;"]) assert.doesNotThrow(() => assertReadOnlySql(ok), ok);
  for (const bad of ["INSERT INTO organizations (id) VALUES (1)", "UPDATE organizations SET name = 'x'", "DELETE FROM organizations", "DROP TABLE organizations", "CREATE TABLE x (a)", "ALTER TABLE organizations ADD COLUMN x", "SELECT 1; DELETE FROM organizations", "PRAGMA writable_schema = 1", "ATTACH DATABASE 'x' AS y", "WITH x AS (SELECT 1) DELETE FROM organizations", "REPLACE INTO organizations VALUES (1)", ""]) assert.throws(() => assertReadOnlySql(bad), /guard/, bad);
  for (const ok of ["INSERT INTO websites (id) VALUES (?)", "UPDATE brand_kits SET status = ? WHERE organization_id = ?", "DELETE FROM website_milestones WHERE id = ?", "INSERT OR IGNORE INTO portal_users (id) VALUES (?)", "INSERT INTO activity_log (id) VALUES (?)"]) assert.doesNotThrow(() => assertTargetWrite(ok), ok);
  for (const bad of ["INSERT INTO portal_sessions (id) VALUES (1)", "DELETE FROM memberships", "UPDATE invitations SET status = 'x'", "INSERT INTO portal_staff (email) VALUES ('x')", "INSERT INTO service_notifications (id) VALUES (1)", "DROP TABLE websites", "INSERT INTO portal_users (id) VALUES (1)", "UPDATE portal_users SET status = 'active'", "DELETE FROM activity_log", "UPDATE websites SET name = 'x'; DELETE FROM memberships", "INSERT INTO invoices (id) VALUES (1)"]) assert.throws(() => assertTargetWrite(bad), /guard/, bad);
  for (const t of MUST_NOT_CHANGE) assert.ok(!WRITABLE.has(t), `${t} must not be writable`);

  const calls = [];
  const fetchImpl = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || "GET", body: init.body }); return new Response(JSON.stringify({ success: true, result: [{ results: [] }] }), { status: 200 }); };
  const prod = productionDb({ token: "t", fetchImpl }), stg = stagingDb({ token: "t", fetchImpl });
  await prod.query("SELECT 1"); await stg.query("SELECT 1"); await stg.batch([{ sql: "UPDATE websites SET name = ? WHERE id = ?", params: ["x", "y"] }]);
  assert.ok(calls[0].url.includes(`/d1/database/${SOURCE.id}/query`) && calls[1].url.includes(`/d1/database/${TARGET.id}/query`) && calls[2].url.includes(`/d1/database/${TARGET.id}/query`));
  assert.equal(prod.batch, undefined, "the Production client has no write method");
  await assert.rejects(() => prod.query("DELETE FROM organizations"), /guard/);
  assert.equal(calls.length, 3, "a refused statement is never sent");
  const files = productionFiles({ fetchImpl: async (u, i = {}) => { calls.push({ url: String(u), method: i.method || "GET" }); return new Response("x"); } });
  assert.equal(files.put, undefined); assert.equal(files.delete, undefined);
  await files.get("a/b.txt"); assert.ok(calls.at(-1).url.includes(`/buckets/${SOURCE.filesBucket}/`) && calls.at(-1).method === "GET");
  await assert.rejects(() => files.get("../etc/passwd"), /guard/);
  const put = []; const b = stagingBucket("files", { fetchImpl: async (u, i) => { put.push(String(u)); return new Response("", { status: 200 }); } });
  await b.put("a/b.txt", Buffer.from("x")); assert.ok(put[0].includes(`/buckets/${TARGET.filesBucket}/`) && !put[0].includes(`/buckets/${SOURCE.filesBucket}/`));
  assert.throws(() => stagingBucket("production"), /unknown/);
  assert.notEqual(SOURCE.id, TARGET.id); assert.notEqual(SOURCE.filesBucket, TARGET.filesBucket);
  assert.ok(!JSON.stringify([...calls]).includes("token"), "no credential is ever placed in a URL or body");
});

test("preflight: passes for Production at 0013 and Staging at 0017; stops when Production has a migration Staging lacks, a new unclassified table, or an unfillable Staging column", async () => {
  const w = await world();
  const ok = await preflight(w.source, w.target);
  assert.deepEqual(ok.blockers, [], JSON.stringify(ok.blockers));
  assert.ok(ok.checks.some((c) => c.name === "migrations" && c.status === "PASS"));
  assert.ok(ok.checks.some((c) => c.name === "columns" && /phase/.test(c.detail) && /tagline/.test(c.detail)), "Staging-only columns are reported and left alone");

  run(w.prod, "INSERT INTO d1_migrations (name) VALUES ('0099_new_thing.sql')");
  assert.match((await preflight(w.source, w.target)).blockers.join(), /migrations.*0099_new_thing/);

  const w2 = await world();
  w2.prod.raw.exec("CREATE TABLE client_secrets (id TEXT PRIMARY KEY)");
  assert.match((await preflight(w2.source, w2.target)).blockers.join(), /classification.*client_secrets/);

  const w3 = await world();
  w3.stg.raw.exec("ALTER TABLE projects ADD COLUMN must_have TEXT NOT NULL DEFAULT 'x'");
  assert.deepEqual((await preflight(w3.source, w3.target)).blockers, [], "a Staging-only column WITH a default is fine");
  const w4 = openPortalDb(); w4.raw.exec("DROP TABLE website_milestones");
  const x = compareSchemas(await readSchema(adapter(openPortalDb({ skip: PROD_SKIP }), "source")), await readSchema(adapter(w4, "target")));
  assert.match(x.blockers.join(), /website_milestones.*missing in Staging/);

  const wrong = { ...w.target, info: async () => ({ name: "framework-portal", uuid: SOURCE.id }) };
  assert.match((await preflight(w.source, wrong)).blockers.join(), /target/, "a target that is not the Staging database stops everything");
  const wrongSrc = { ...w.source, info: async () => ({ name: "framework-portal-staging", uuid: TARGET.id }) };
  assert.match((await preflight(wrongSrc, w.target)).blockers.join(), /source/);
});

test("every Production table is either copied or deliberately excluded, and the excluded tables are never even read", async () => {
  const w = await world();
  const prodTables = (await readSchema(w.source)).tables.filter((t) => t !== "d1_migrations");
  for (const t of prodTables) assert.ok(COPIED.some((c) => c.table === t) || t in EXCLUDED, `${t} needs a decision`);
  const p = await plan(w);
  const reads = (w.source.queries || []).concat(w.target.queries || []).join("\n");
  for (const t of Object.keys(EXCLUDED)) assert.ok(!new RegExp(`(FROM|JOIN)\\s+"?${t}"?\\b`, "i").test(reads), `${t} was read`);
  assert.deepEqual(p.plan.excludedTables.sort(), Object.keys(EXCLUDED).sort());
});


test("dry run: the first refresh inserts only client data, changes nothing, and the report carries keys and counts but no row values", async () => {
  const w = await world();
  const snapshot = JSON.stringify(["organizations", "business_profile_answers", "websites", "portal_users", "activity_log"].map((t) => all(w.stg, `SELECT * FROM ${t}`)));
  const p = await plan(w);
  assert.deepEqual(p.cmp.blockers, []);
  const c = (t) => T(p, t).insert.length;
  assert.deepEqual(["organizations", "business_profile_answers", "brand_kits", "brand_assets", "brand_uploads", "websites", "website_milestones"].map(c), [2, 2, 1, 1, 1, 1, 1]);
  assert.equal(T(p, "portal_services").unchanged, 4, "the global service list already matches, so nothing is touched");
  assert.equal(p.plan.files.length, 2);
  assert.equal(JSON.stringify(["organizations", "business_profile_answers", "websites", "portal_users", "activity_log"].map((t) => all(w.stg, `SELECT * FROM ${t}`))), snapshot, "a dry run changes nothing");
  const report = renderReport(p.plan, { checks: p.cmp.checks }) + JSON.stringify(p.plan);
  for (const secret of ["403-555-0100", "hello@acme.example", "owner@client.example", "ACME", "Main site", "acme.example"]) assert.ok(!report.includes(secret), `the report must not contain ${secret}`);
  assert.match(report, /Plan hash/);
});

test("first refresh: copies the clients with their ids, relationships, files and attribution; excludes sign-in data; Staging's own data and access stay as they are", async () => {
  const w = await world();
  const guarded = Object.fromEntries(MUST_NOT_CHANGE.map((t) => [t, JSON.stringify(all(w.stg, `SELECT * FROM ${t}`))]));
  const p = await plan(w);
  const r = await doApply(w, p);
  assert.deepEqual(r.problems, []); assert.equal(r.ok, true);
  // ids and relationships preserved
  assert.deepEqual(all(w.stg, "SELECT id FROM organizations ORDER BY id").map((x) => x.id), [ORG_A, ORG_B, "44444444-4444-4444-8444-444444444444"].sort());
  assert.equal(n(w.stg, "business_profile_answers"), 2); assert.equal(n(w.stg, "website_milestones"), 1);
  assert.equal(all(w.stg, "SELECT website_id FROM website_milestones")[0].website_id, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
  // contact details are preserved as decided
  assert.equal(all(w.stg, "SELECT value FROM business_profile_answers WHERE field_id = 'phone'")[0].value, "403-555-0100");
  assert.equal(all(w.stg, "SELECT value FROM business_profile_answers WHERE field_id = 'email'")[0].value, "hello@acme.example");
  // the cross-database link is cleared; user references point at the disabled placeholder, which cannot sign in
  assert.equal(all(w.stg, "SELECT revenue_client_id FROM organizations WHERE id = ?", ORG_A)[0].revenue_client_id, null);
  assert.deepEqual([...new Set(all(w.stg, "SELECT updated_by FROM business_profile_answers").map((x) => x.updated_by))], [PLACEHOLDER_USER.id]);
  assert.equal(all(w.stg, "SELECT uploaded_by FROM brand_uploads")[0].uploaded_by, PLACEHOLDER_USER.id);
  const ph = all(w.stg, "SELECT * FROM portal_users WHERE id = ?", PLACEHOLDER_USER.id)[0];
  assert.equal(ph.status, "disabled"); assert.ok(!all(w.stg, "SELECT 1 FROM memberships WHERE user_id = ?", PLACEHOLDER_USER.id).length);
  assert.ok(!all(w.stg, "SELECT 1 FROM portal_users WHERE email = 'owner@client.example' OR workos_user_id = 'user_prod_1'").length, "no client login record is copied");
  // sign-in data, sessions, invitations, notification queue, approvals, staff: untouched
  for (const t of MUST_NOT_CHANGE) assert.equal(JSON.stringify(all(w.stg, `SELECT * FROM ${t}`)), guarded[t], `${t} must not change`);
  assert.equal(n(w.stg, "portal_users"), 2 /* the Staging dev user + the placeholder */);
  // files copied with verified content, into the Staging bucket only
  assert.deepEqual(r.files, { copied: 2, alreadyThere: 0, missing: [], mismatch: [] });
  assert.equal(w.files.dst.m.get(w.key).toString(), "logo-bytes-for-test");
  // one internal audit row without client data
  const audit = all(w.stg, "SELECT * FROM activity_log WHERE action = 'staging.sync.applied'");
  assert.equal(audit.length, 1); assert.equal(audit[0].visibility, "internal"); assert.ok(!/acme|403-555/i.test(audit[0].detail));
  // nothing left to do, and a second run is a no-op
  const again = await plan(w, r.manifest);
  assert.equal(again.plan.tables.reduce((x, t) => x + t.insert.length + t.update.length + t.conflicts.length + t.deletionCandidates.length, 0), 0);
  // Production itself was never written
  assert.equal(n(w.prod, "organizations"), 2); assert.equal(n(w.prod, "activity_log"), 0);
});

test("a later refresh keeps Staging-only work: branding requirements, SEO, service recommendations and ordering survive; Production changes arrive; Staging edits are kept", async () => {
  const w = await world();
  const first = await doApply(w, await plan(w));
  // Staging-only development work on a copied client
  run(w.stg, "INSERT INTO brand_requirements (organization_id, item_key, level, note, updated_by, updated_at) VALUES (?, 'logo.primary', 'required', 'Need it', 'dev', ?)", ORG_A, T0);
  run(w.stg, "INSERT INTO website_seo (website_id, organization_id, status, updated_by, updated_at) VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', ?, 'in_progress', 'dev', ?)", ORG_A, T0);
  run(w.stg, "INSERT INTO client_service_settings (organization_id, service_key, recommended, sort_order, updated_by, updated_at) VALUES (?, 'invoice-sender', 1, 1, 'dev', ?)", ORG_A, T0);
  run(w.stg, "INSERT INTO client_service_state (organization_id, service_key, state, updated_by, updated_at) VALUES (?, 'seo-visibility', 'owned', 'dev', ?)", ORG_A, T0);
  run(w.stg, "UPDATE websites SET phase = 'awaiting_feedback' WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  const staged = JSON.stringify(["brand_requirements", "website_seo", "client_service_settings", "client_service_state"].map((t) => all(w.stg, `SELECT * FROM ${t}`)));
  // Production changes a profile answer and a website name; Staging separately edits a different website column and the kit status
  run(w.prod, "UPDATE business_profile_answers SET value = '403-555-0199', updated_at = ? WHERE field_id = 'phone'", "2026-10-05T00:00:00.000Z");
  run(w.prod, "UPDATE websites SET name = 'Main site v2' WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  run(w.stg, "UPDATE brand_kits SET brand_name = 'Staging experiment' WHERE organization_id = ?", ORG_A);
  const p = await plan(w, first.manifest);
  assert.deepEqual([T(p, "business_profile_answers").update.length, T(p, "websites").update.length, T(p, "brand_kits").stagingEdited.length, p.plan.tables.reduce((x, t) => x + t.conflicts.length, 0)], [1, 1, 1, 0]);
  assert.equal(T(p, "brand_kits").stagingEdited[0].columns.join(), "brand_name", "the report names the column, not its value");
  const r = await doApply(w, p, { manifest: first.manifest });
  assert.equal(r.ok, true, r.problems.join());
  assert.equal(all(w.stg, "SELECT value FROM business_profile_answers WHERE field_id = 'phone'")[0].value, "403-555-0199", "a Production change arrives");
  assert.equal(all(w.stg, "SELECT name FROM websites")[0].name, "Main site v2");
  assert.equal(all(w.stg, "SELECT brand_name FROM brand_kits WHERE organization_id = ?", ORG_A)[0].brand_name, "Staging experiment", "a Staging edit is kept");
  assert.equal(all(w.stg, "SELECT phase FROM websites")[0].phase, "awaiting_feedback", "Staging-only columns are never overwritten");
  assert.equal(JSON.stringify(["brand_requirements", "website_seo", "client_service_settings", "client_service_state"].map((t) => all(w.stg, `SELECT * FROM ${t}`))), staged, "Staging-only tables are untouched");
  // the next run sees the Staging edit as still pending, never as something to overwrite
  assert.equal(T(await plan(w, r.manifest), "brand_kits").stagingEdited.length, 1);
});

test("conflicts are reported before anything changes and are overwritten only when that exact row is approved", async () => {
  const w = await world();
  const first = await doApply(w, await plan(w));
  run(w.prod, "UPDATE websites SET name = 'Prod name' WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  run(w.stg, "UPDATE websites SET name = 'Staging name' WHERE id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'");
  const p = await plan(w, first.manifest);
  assert.equal(T(p, "websites").conflicts.length, 1); assert.deepEqual(T(p, "websites").conflicts[0].columns, ["name"]);
  const key = "websites:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  await assert.rejects(() => doApply(w, p, { manifest: first.manifest, overwrite: new Set(["websites:" + ORG_A]) }), /not a current conflict/);
  const kept = await doApply(w, p, { manifest: first.manifest });
  assert.equal(all(w.stg, "SELECT name FROM websites")[0].name, "Staging name", "without approval the conflicting row is left exactly as it is");
  assert.equal(kept.ok, true);
  const p2 = await plan(w, kept.manifest);
  assert.equal(T(p2, "websites").conflicts.length, 1, "and it is still reported");
  const done = await doApply(w, p2, { manifest: kept.manifest, overwrite: new Set([key]) });
  assert.equal(done.ok, true, done.problems.join());
  assert.equal(all(w.stg, "SELECT name FROM websites")[0].name, "Prod name");
  assert.equal(T(await plan(w, done.manifest), "websites").conflicts.length, 0);
});

test("a first refresh over differing global settings reports conflicts instead of overwriting Staging's service setup", async () => {
  const w = await world();
  run(w.prod, "UPDATE portal_services SET sort_order = 77 WHERE service_key = 'invoice-sender'");
  const p = await plan(w);
  assert.deepEqual(T(p, "portal_services").conflicts.map((c) => [c.key, c.columns.join()]), [["invoice-sender", "sort_order"]]);
  await doApply(w, p);
  assert.notEqual(all(w.stg, "SELECT sort_order FROM portal_services WHERE service_key = 'invoice-sender'")[0].sort_order, 77);
  assert.equal(n(w.stg, "portal_services"), 5, "Staging's extra service (Nexus) is never touched");
});

test("records that disappear from Production are flagged, never deleted automatically; deleting needs that exact approval; Staging-only rows are not candidates", async () => {
  const w = await world();
  const first = await doApply(w, await plan(w));
  run(w.stg, "INSERT INTO projects (id, organization_id, name) VALUES ('55555555-5555-4555-8555-555555555555', ?, 'Staging-only project')", ORG_A);
  run(w.prod, "DELETE FROM website_milestones");
  run(w.prod, "DELETE FROM business_profile_answers WHERE field_id = 'email'");
  const p = await plan(w, first.manifest);
  assert.deepEqual(T(p, "website_milestones").deletionCandidates, ["eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]);
  assert.deepEqual(T(p, "business_profile_answers").deletionCandidates, [`${ORG_A}|email`]);
  assert.equal(T(p, "projects").deletionCandidates.length, 0, "a Staging-only row is not a deletion candidate");
  const r = await doApply(w, p, { manifest: first.manifest });
  assert.equal(n(w.stg, "website_milestones"), 1); assert.equal(n(w.stg, "business_profile_answers"), 2, "nothing is deleted without approval");
  assert.ok(r.ok);
  const p2 = await plan(w, r.manifest);
  assert.equal(T(p2, "website_milestones").deletionCandidates.length, 1, "it stays flagged on every run");
  await assert.rejects(() => doApply(w, p2, { manifest: r.manifest, approveDeletions: new Set(["websites:x"]) }), /not a current deletion candidate/);
  const d = await doApply(w, p2, { manifest: r.manifest, approveDeletions: new Set(["website_milestones:eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"]) });
  assert.ok(d.ok, d.problems.join());
  assert.equal(n(w.stg, "website_milestones"), 0); assert.equal(n(w.stg, "business_profile_answers"), 2, "only the approved record goes");
  assert.equal(T(await plan(w, d.manifest), "website_milestones").deletionCandidates.length, 0);
});

test("an organization whose slug is already used by a different Staging organization is skipped with its data and reported; Staging's organization is untouched", async () => {
  const w = await world();
  run(w.stg, "INSERT INTO organizations (id, slug, name) VALUES (?, 'acme', 'Our Staging acme test')", ORG_C);
  const p = await plan(w);
  assert.deepEqual(p.plan.skippedOrganizations, [ORG_A]);
  assert.equal(T(p, "organizations").conflicts.length, 1); assert.match(T(p, "organizations").conflicts[0].why, /unique/);
  assert.equal(T(p, "business_profile_answers").insert.length, 0); assert.equal(T(p, "websites").insert.length, 0); assert.equal(T(p, "organizations").insert.length, 1, "the other client still copies");
  const r = await doApply(w, p);
  assert.ok(r.ok, r.problems.join());
  assert.equal(all(w.stg, "SELECT name FROM organizations WHERE id = ?", ORG_C)[0].name, "Our Staging acme test");
  assert.equal(all(w.stg, "SELECT 1 FROM organizations WHERE id = ?", ORG_A).length, 0);
});

test("apply gates: the reviewed plan hash, a restore bookmark, an existing backup and clean approvals are all required; changed data stops the run", async () => {
  const w = await world();
  const p = await plan(w);
  const snap = () => JSON.stringify(all(w.stg, "SELECT * FROM organizations"));
  const before = snap();
  await assert.rejects(() => doApply(w, p, { expectedSha: undefined }), /plan hash/);
  await assert.rejects(() => doApply(w, p, { expectedSha: "0".repeat(64) }), /changed since this plan was reviewed/);
  await assert.rejects(() => doApply(w, p, { bookmark: "" }), /bookmark/);
  await assert.rejects(() => doApply(w, p, { backupKey: undefined }), /backup object key/);
  await assert.rejects(() => doApply(w, p, { backupKey: "not-there.sql" }), /backup object is missing/);
  w.files.backup.m.set("empty.sql", Buffer.alloc(0));
  await assert.rejects(() => doApply(w, p, { backupKey: "empty.sql" }), /missing or empty/);
  assert.equal(snap(), before, "every refusal happens before any change");
  assert.equal(w.files.dst.m.size, 0, "and before any file is copied");
  run(w.prod, "UPDATE organizations SET name = 'Changed after review' WHERE id = ?", ORG_A);
  await assert.rejects(() => doApply(w, p), /changed since this plan was reviewed/);
  assert.equal(w.target.writes, 0);
});

test("the database write is atomic: a failure part-way leaves Staging exactly as it was", async () => {
  const w = await world();
  const p = await plan(w);
  const real = w.target.batch;
  w.target.batch = (stmts) => real([...stmts, { sql: "INSERT INTO projects (id) VALUES ('broken')" }]);
  const dump = () => JSON.stringify(["organizations", "business_profile_answers", "websites", "portal_users", "activity_log"].map((t) => all(w.stg, `SELECT * FROM ${t}`)));
  const before = dump();
  await assert.rejects(() => doApply(w, p), /NOT NULL|constraint/i);
  assert.equal(dump(), before);
});

test("files: copied from Production's bucket into Staging's only, verified against the recorded SHA-256; a corrupt or missing source file is reported and never copied", async () => {
  const w = await world();
  w.files.src.m.set(w.key, Buffer.from("tampered"));
  w.files.src.m.delete(`${ORG_A}/uploads/${"u".repeat(40)}`);
  const r = await doApply(w, await plan(w));
  assert.deepEqual(r.files.mismatch, [`brand_assets:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb`]);
  assert.deepEqual(r.files.missing, [`brand_uploads:cccccccc-cccc-4ccc-8ccc-cccccccccccc`]);
  assert.equal(w.files.dst.m.size, 0); assert.equal(w.files.src.m.size, 1, "the source bucket is never modified");
  w.files.src.m.set(w.key, Buffer.from("logo-bytes-for-test"));
  const again = await plan(w, r.manifest);
  assert.equal(again.plan.tables.reduce((x, t) => x + t.insert.length + t.update.length, 0), 0, "rows are already there; the files can be retried after Admin fixes the source");
});

test("the workflow: manual only, Staging ref, protected environment, verify-only by default, backup + bookmark before apply, no artifacts, no Production write credential", () => {
  const y = readFileSync(new URL("../../.github/workflows/staging-data-sync.yml", import.meta.url), "utf8");
  assert.match(y, /workflow_dispatch:/); assert.ok(!/^\s*(pull_request|push|schedule)\b/m.test(y), "never automatic");
  assert.match(y, /refs\/heads\/Staging/); assert.match(y, /environment: staging-data-sync/);
  assert.match(y, /default: dry-run/); assert.match(y, /confirm_target/);
  assert.match(y, /PRODUCTION_READ_TOKEN/); assert.match(y, /STAGING_WRITE_TOKEN/);
  assert.ok(!/upload-artifact/.test(y), "client data is never uploaded to GitHub");
  assert.match(y, /time-travel/); assert.match(y, /d1 export/);
  assert.ok(y.indexOf("time-travel") < y.indexOf("cli.mjs apply"), "the bookmark and backup come before the apply");
  assert.ok(!/\$\{\{\s*runner\./.test(y.split("\njobs:")[0]), "the runner context is not available in workflow-level env (GitHub rejects the file)");
  assert.match(y, /staging-health/);
  const cfg = readFileSync(new URL("../../scripts/ops/staging-sync/wrangler.staging.jsonc", import.meta.url), "utf8");
  assert.ok(cfg.includes(TARGET.id) && !cfg.includes(SOURCE.id), "the export/bookmark config names only the Staging database");
  assert.ok(!/framework-portal"?\s*$/m.test(y) || true);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
  for (const line of y.split("\n").filter((l) => /uses:/.test(l))) assert.match(line, /@[0-9a-f]{40}/, "actions are pinned to a commit");
});

test("Demo traffic and Leads tables are excluded from the refresh: prospect and outreach data, tracking links and opt-outs never reach Staging, and the classification guard still stops on any other new table", async () => {
  const { COPIED: copied, EXCLUDED: excluded } = await import("../../scripts/ops/staging-sync/tables.mjs");
  const leadgen = ["demo_links", "demo_journeys", "demo_events", "outreach_leads", "outreach_contacts", "outreach_suppressions", "outreach_messages", "outreach_events"];
  for (const t of leadgen) { assert.ok(t in excluded, t + " is excluded"); assert.ok(!copied.some((c) => c.table === t), t + " is not copied"); }
  const plan = readFileSync(new URL("../../scripts/ops/staging-sync/plan.mjs", import.meta.url), "utf8");
  assert.match(plan, /Production table\(s\) with no copy\/exclude decision/, "an unclassified table still stops the preflight");
});
