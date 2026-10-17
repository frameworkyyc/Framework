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
const MIGRATIONS = ["0001_create_feedback_responses.sql", "0002_add_reviewed_at.sql", "0003_create_client_revenue.sql", "0004_create_assessment_requests.sql", "0005_assessment_delivery_tracking.sql"];
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
  for (const c of ["notify_status", "notify_error", "notified_at", "notify_attempts", "confirm_status", "confirm_error"]) assert.ok(cols.includes(c), c);
  assert.ok(shape(db, "feedback_responses").map((c) => c.split("|")[0]).includes("reviewed_at"));
});

test("a database created from staging-init.sql starts EMPTY: no customer data, only the environment marker", () => {
  const db = viaInit();
  for (const t of APP_TABLES) assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, 0, t);
  assert.deepEqual(db.prepare("SELECT key, value FROM framework_environment").all().map((r) => ({ ...r })), [{ key: "environment", value: "staging" }]);
});

test("staging-init.sql contains nothing destructive and inserts no data besides the marker", () => {
  const sql = read("staging-init.sql").replace(/--.*$/gm, "");
  assert.ok(!/\b(DROP|DELETE|TRUNCATE|REPLACE\s+INTO)\b/i.test(sql));
  const inserts = sql.match(/\bINSERT\b[^;]*;/gi) || [];
  assert.equal(inserts.length, 1);
  assert.match(inserts[0], /framework_environment/);
});

test("SAFETY: running staging-init.sql against a populated database (e.g. Production) does NOT label it 'staging'", () => {
  const prod = new DatabaseSync(":memory:");
  prod.exec(SCHEMA);
  prod.exec(read("0002_add_reviewed_at.sql")); // Production already has these, as it does in real life
  prod.prepare("INSERT INTO feedback_responses (id, created_at, form_version, satisfaction, rating_visual_design, rating_ease_of_use, rating_mobile_experience, rating_accuracy, rating_professionalism, rating_communication, rating_overall_product, improvement, impact, fair_price, recommend, liked, testimonial_permission, logo_permission, services) VALUES ('keep-1','2026-01-01',1,9,5,5,5,5,5,5,5,'x','x','x',9,'x','No','No','x')").run();
  assert.throws(() => prod.exec(read("staging-init.sql")), /duplicate column/i); // stops at the ALTER, as documented
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM framework_environment").get().n, 0, "no marker on a populated database");
  assert.equal(prod.prepare("SELECT COUNT(*) AS n FROM feedback_responses").get().n, 1, "existing data untouched");
});

test("re-running staging-init.sql on the staging database is harmless to its data and keeps a single marker", () => {
  const db = viaInit();
  db.prepare("INSERT INTO client_revenue (client_id, revenue) VALUES ('demo', 1000)").run();
  assert.throws(() => db.exec(read("staging-init.sql")), /duplicate column/i);
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
