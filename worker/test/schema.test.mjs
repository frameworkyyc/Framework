// Run with:  node --test worker/test/*.mjs
// Guards the database structure: the staging starting schema, the numbered migrations and the tables the Worker
// creates for itself must all describe the SAME structure, and the identity check must be read-only.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { ensureSchema, SCHEMA } from "../shared.js";
import { ensureAssessmentSchema, resetAssessmentSchemaForTests } from "../assessment.js";
import { handleDatabaseApi } from "../admin/database-api.js";

const read = (f) => readFileSync(new URL("../../migrations/" + f, import.meta.url), "utf8");
const MIGRATIONS = ["0001_create_feedback_responses.sql", "0002_add_reviewed_at.sql", "0003_create_client_revenue.sql", "0004_create_assessment_requests.sql", "0005_assessment_delivery_tracking.sql", "0006_assessment_last_interaction.sql"];
const APP_TABLES = ["feedback_responses", "assessment_requests", "client_revenue"];

const d1 = (db, log = []) => ({
  raw: db,
  prepare(sql) {
    log.push(sql);
    let a = [];
    const s = { bind: (...x) => { a = x; return s; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes } }; }, first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }) };
    return s;
  },
});
const shape = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all().map((c) => `${c.name}|${c.type}|${c.notnull}|${c.dflt_value}|${c.pk}`).sort();

const viaInit = () => { const db = new DatabaseSync(":memory:"); db.exec(read("staging-init.sql")); return db; };
const viaMigrations = () => { const db = new DatabaseSync(":memory:"); for (const f of MIGRATIONS) db.exec(read(f)); return db; };
const viaRuntime = async () => {
  resetAssessmentSchemaForTests();
  const db = new DatabaseSync(":memory:"); const w = d1(db);
  await w.prepare(SCHEMA).run();                       // what the Worker does for feedback_responses
  db.exec(read("0002_add_reviewed_at.sql"));           // the optional "reviewed" column
  db.exec(read("0003_create_client_revenue.sql"));     // client_revenue is migration-only
  await ensureAssessmentSchema(w);                     // what the Worker does for assessment_requests
  return db;
};

beforeEach(() => resetAssessmentSchemaForTests());

test("staging-init.sql, the numbered migrations and the Worker's own table creation all produce the same structure", async () => {
  const [a, b, c] = [viaInit(), viaMigrations(), await viaRuntime()];
  for (const table of APP_TABLES) {
    assert.ok(shape(a, table).length > 0, table + " exists");
    assert.deepEqual(shape(a, table), shape(b, table), table + ": init vs migrations");
    assert.deepEqual(shape(a, table), shape(c, table), table + ": init vs runtime");
  }
});

test("staging-init.sql covers every table the code uses, and the delivery-tracking columns", () => {
  const db = viaInit();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name).sort();
  assert.deepEqual(tables, [...APP_TABLES, "framework_environment"].sort());
  const cols = shape(db, "assessment_requests").map((c) => c.split("|")[0]);
  for (const c of ["notify_status", "notify_error", "notified_at", "notify_attempts", "confirm_status", "confirm_error", "last_interaction_at"]) assert.ok(cols.includes(c), c);
  assert.ok(shape(db, "feedback_responses").map((c) => c.split("|")[0]).includes("reviewed_at"));
});

test("a database created from staging-init.sql starts EMPTY: no customer data, only the environment marker", () => {
  const db = viaInit();
  for (const t of APP_TABLES) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  assert.deepEqual(db.prepare("SELECT key, value FROM framework_environment").all().map((r) => ({ ...r })), [{ key: "environment", value: "staging" }]);
});

test("staging-init.sql is non-destructive and idempotent by construction: only CREATE TABLE IF NOT EXISTS and one INSERT OR IGNORE", () => {
  const sql = read("staging-init.sql").replace(/--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|REPLACE)\b/i.test(sql), "no ALTER/UPDATE/DROP/DELETE");
  const statements = sql.split(";").map((x) => x.trim()).filter(Boolean);
  const creates = statements.filter((x) => /^CREATE TABLE/i.test(x));
  assert.equal(creates.length, 4);
  assert.ok(creates.every((x) => /^CREATE TABLE IF NOT EXISTS\b/i.test(x)));
  const others = statements.filter((x) => !/^CREATE TABLE/i.test(x));
  assert.equal(others.length, 1);
  assert.match(others[0], /^INSERT OR IGNORE INTO framework_environment/i);
});

test("LIVE STATE: framework-staging currently holds only the Worker-created (empty) assessment_requests; the script completes and adds the rest", async () => {
  const raw = new DatabaseSync(":memory:");
  await ensureAssessmentSchema(d1(raw)); // exactly what loading the admin page did on Staging
  raw.exec(read("staging-init.sql"));
  const tables = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ["assessment_requests", "client_revenue", "feedback_responses", "framework_environment"]);
  assert.deepEqual(raw.prepare("SELECT key, value FROM framework_environment").all().map((r) => ({ ...r })), [{ key: "environment", value: "staging" }]);
  for (const t of APP_TABLES) assert.equal(raw.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0);
});

test("the previous (ALTER-based) approach would have failed on that live state, which is why the script no longer uses ALTER", async () => {
  const raw = new DatabaseSync(":memory:");
  await ensureAssessmentSchema(d1(raw));
  assert.throws(() => raw.exec(read("0005_assessment_delivery_tracking.sql")), /duplicate column/i);
});

test("existing rows are preserved when the script runs on a database that already has data", async () => {
  const raw = new DatabaseSync(":memory:");
  await ensureAssessmentSchema(d1(raw));
  raw.prepare("INSERT INTO assessment_requests (id, created_at, business_name, email) VALUES ('keep-111111111111111','2026-10-20','Keep Me Ltd.','k@example.com')").run();
  raw.exec(read("staging-init.sql"));
  assert.equal(raw.prepare("SELECT business_name FROM assessment_requests").get().business_name, "Keep Me Ltd.");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM framework_environment").get().n, 0, "a database that holds data is never labelled");
});

test("SAFETY: running it against a populated Production-style database changes nothing and does not label it 'staging'", () => {
  const prod = viaMigrations();
  prod.prepare("INSERT INTO feedback_responses (id, created_at, form_version, satisfaction, rating_visual_design, rating_ease_of_use, rating_mobile_experience, rating_accuracy, rating_professionalism, rating_communication, rating_overall_product, improvement, impact, fair_price, recommend, liked, testimonial_permission, logo_permission, services) VALUES ('keep-1','2026-01-01','1',9,5,5,5,5,5,5,5,'x','x','x',9,'x','No','No','x')").run();
  prod.prepare("INSERT INTO client_revenue (client_id, revenue) VALUES ('c', 2500000)").run();
  const before = ["feedback_responses", "client_revenue", "assessment_requests"].map((t) => shape(prod, t).join(";"));
  prod.exec(read("staging-init.sql")); // no error, no change
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM framework_environment").get().n, 0);
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM feedback_responses").get().n, 1);
  assert.equal(prod.prepare("SELECT revenue FROM client_revenue").get().revenue, 2500000);
  assert.deepEqual(["feedback_responses", "client_revenue", "assessment_requests"].map((t) => shape(prod, t).join(";")), before);
});

test("running it repeatedly is harmless: no errors, data kept, a single marker", () => {
  const db = viaInit();
  db.prepare("INSERT INTO client_revenue (client_id, revenue) VALUES ('demo', 1000)").run();
  db.exec(read("staging-init.sql")); db.exec(read("staging-init.sql"));
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM client_revenue").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM framework_environment").get().n, 1);
});

/* ---------------------------------------------------------------- database identity check */

const ask = (env, method = "GET", path = "/database") => handleDatabaseApi(new Request("https://x/api/admin" + path, { method }), env, {}, path);

test("identity check on an empty/new database: no tables, no marker, nothing created", async () => {
  const raw = new DatabaseSync(":memory:"); const log = [];
  const res = await ask({ DB: d1(raw, log) });
  assert.deepEqual(await res.json(), { environment: null, tables: [], rows: { feedback_responses: null, assessment_requests: null, client_revenue: null } });
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get().n, 0);
  assert.ok(log.every((s) => /^\s*SELECT/i.test(s)), "only SELECT statements: " + log.join(" | "));
});

test("identity check reports the staging marker and row counts, never row contents", async () => {
  const raw = viaInit();
  raw.prepare("INSERT INTO assessment_requests (id, created_at, business_name, email) VALUES ('a-1111111111111111','2026-10-20','Secret Co','private@example.com')").run();
  const log = [];
  const res = await ask({ DB: d1(raw, log) }); const text = await res.text(); const out = JSON.parse(text);
  assert.equal(out.environment, "staging");
  assert.equal(out.rows.assessment_requests, 1); assert.equal(out.rows.feedback_responses, 0);
  assert.ok(!/Secret Co|private@example/.test(text));
  assert.ok(log.every((s) => /^\s*SELECT/i.test(s)));
});

test("identity check on a production-style database reports no marker", async () => {
  const raw = viaMigrations(); // populated structure, never run through staging-init.sql
  assert.equal((await (await ask({ DB: d1(raw) })).json()).environment, null);
});

test("identity check: only GET, needs a database, hides internals on error", async () => {
  assert.equal((await ask({ DB: d1(viaInit()) }, "POST")).status, 405);
  assert.equal((await ask({})).status, 503);
  const broken = { prepare: () => ({ all: async () => { throw new Error("D1_ERROR: internal detail"); } }) };
  const res = await ask({ DB: broken }); const t = await res.text();
  assert.equal(res.status, 503); assert.ok(!/internal detail|D1_ERROR/.test(t));
  assert.equal(await handleDatabaseApi(new Request("https://x/api/admin/feedback"), { DB: d1(viaInit()) }, {}, "/feedback"), null);
});

/* ---------------------------------------------------------------- Production readiness */

test("PRODUCTION: a database in Production's current shape gains assessment_requests without any existing table or row being touched", async () => {
  const prod = new DatabaseSync(":memory:");
  prod.exec(SCHEMA);                                   // feedback_responses (as created by the Worker)
  prod.exec(read("0002_add_reviewed_at.sql"));
  prod.exec(read("0003_create_client_revenue.sql"));
  prod.prepare("INSERT INTO feedback_responses (id, created_at, form_version, satisfaction, rating_visual_design, rating_ease_of_use, rating_mobile_experience, rating_accuracy, rating_professionalism, rating_communication, rating_overall_product, improvement, impact, fair_price, recommend, liked, testimonial_permission, logo_permission, services) VALUES ('real-1','2026-09-01','1',10,5,5,5,5,5,5,5,'x','x','x',10,'x','Yes','Yes','x')").run();
  prod.prepare("INSERT INTO client_revenue (client_id, revenue) VALUES ('aurora', 2500000)").run();
  const before = ["feedback_responses", "client_revenue"].map((t) => shape(prod, t).join(";"));

  // (a) what the Worker does by itself on first use
  resetAssessmentSchemaForTests();
  await ensureAssessmentSchema(d1(prod));
  // (b) the optional pre-creation script, run before or after: harmless
  prod.exec(read("production-assessment-tables.sql"));
  prod.exec(read("production-assessment-tables.sql"));

  assert.deepEqual(shape(prod, "assessment_requests"), shape(viaInit(), "assessment_requests"), "same final structure as Staging");
  assert.deepEqual(["feedback_responses", "client_revenue"].map((t) => shape(prod, t).join(";")), before, "existing tables unchanged");
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM feedback_responses").get().n, 1);
  assert.equal(prod.prepare("SELECT revenue FROM client_revenue WHERE client_id='aurora'").get().revenue, 2500000);
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'framework_environment'").get().n, 0, "Production is never marked staging");
});

test("production-assessment-tables.sql is a single, additive CREATE TABLE IF NOT EXISTS", () => {
  const sql = read("production-assessment-tables.sql").replace(/--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|ALTER|UPDATE|INSERT|REPLACE)\b/i.test(sql));
  const statements = sql.split(";").map((x) => x.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
  assert.match(statements[0], /^CREATE TABLE IF NOT EXISTS assessment_requests/);
});

/* ---------------------------------------------------------------- last_interaction_at: additive on every starting point */

test("last_interaction_at is NULLable, additive, and brought to existing tables without touching rows (Staging and Production shapes)", async () => {
  // A table exactly as it exists today in Staging/Production (before this column), with real-looking rows.
  const old = new DatabaseSync(":memory:");
  old.exec(read("0004_create_assessment_requests.sql"));
  old.exec(read("0005_assessment_delivery_tracking.sql"));
  old.prepare("INSERT INTO assessment_requests (id, created_at, business_name, email, notify_status) VALUES ('old-1111111111111111','2026-10-01T10:00:00.000Z','Old Co','o@example.com','sent')").run();
  const before = old.prepare("SELECT * FROM assessment_requests").all().map((r) => ({ ...r }));

  resetAssessmentSchemaForTests();
  await ensureAssessmentSchema(d1(old)); // what the Worker does on first use after the deploy
  const cols = shape(old, "assessment_requests");
  assert.ok(cols.includes("last_interaction_at|TEXT|0|null|0"), "nullable TEXT, no default");
  const after = old.prepare("SELECT * FROM assessment_requests").all().map((r) => ({ ...r }));
  assert.equal(after.length, 1);
  assert.equal(after[0].last_interaction_at, null, "existing rows stay NULL");
  const { last_interaction_at, ...rest } = after[0];
  assert.deepEqual(rest, before[0], "every other value, including created_at, is unchanged");

  // the manual migration file is also safe on such a table, and fails harmlessly if the Worker already added the column
  const manual = new DatabaseSync(":memory:"); manual.exec(read("0004_create_assessment_requests.sql")); manual.exec(read("0005_assessment_delivery_tracking.sql"));
  manual.exec(read("0006_assessment_last_interaction.sql"));
  assert.throws(() => manual.exec(read("0006_assessment_last_interaction.sql")), /duplicate column/i);
  assert.deepEqual(shape(manual, "assessment_requests"), shape(old, "assessment_requests"));
});

test("0006 migration is a single additive ALTER", () => {
  const sql = read("0006_assessment_last_interaction.sql").replace(/--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE|UPDATE|INSERT|REPLACE|NOT NULL)\b/i.test(sql));
  assert.equal(sql.split(";").map((x) => x.trim()).filter(Boolean).length, 1);
  assert.match(sql, /ALTER TABLE assessment_requests ADD COLUMN last_interaction_at TEXT/);
});
