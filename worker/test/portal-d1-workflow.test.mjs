// Guards the manual Production portal D1 migration workflow and its check script. Plain-text checks (no YAML parser is installed) plus
// the script's checks run against realistic Wrangler output. Nothing here contacts Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { EXPECTED, checkConfig, checkInfo, checkPendingBefore, checkPendingAfter, checkTablesBefore, checkTablesAfter, checkIndexesAfter } from "../../.github/scripts/portal-d1-check.mjs";

const root = new URL("../../", import.meta.url);
const raw = readFileSync(new URL(".github/workflows/portal-production-d1-migration.yml", root), "utf8");
const code = raw.replace(/^\s*#.*$/gm, "").replace(/\s+#\s.*$/gm, "");
const sql = readFileSync(new URL("migrations/portal/0001_portal_foundation.sql", root), "utf8");
const prodConfig = readFileSync(new URL("migrations/portal/wrangler.migrate.production.jsonc", root), "utf8");

test("trigger is workflow_dispatch only; default mode is verify-only; the database name is typed; read-only token; serialised", () => {
  const on = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), ["workflow_dispatch"]);
  assert.ok(!/push:|pull_request|schedule|workflow_run|repository_dispatch|release|issue_comment/.test(code));
  assert.match(on, /confirm_database:[\s\S]*required: true[\s\S]*type: string/);
  assert.match(on, /mode:[\s\S]*type: choice\n\s+default: verify-only\n\s+options:\n\s+- verify-only\n\s+- apply/);
  assert.match(code, /^permissions:\n  contents: read\n/m);
  assert.equal([...code.matchAll(/^\s*permissions:/gm)].length, 1);
  assert.match(code, /concurrency:\n  group: portal-production-d1-migration\n  cancel-in-progress: false/);
  assert.match(code, /environment: production-portal-d1\n/);
  assert.match(code, /timeout-minutes: \d+/);
});
test("inputs reach the shell only through env vars (no expression injection) and are validated first", () => {
  for (const m of code.matchAll(/run: \|?[^\n]*\n((?:\s{10,}[^\n]*\n?)*)/g)) assert.ok(!/\$\{\{/.test(m[1]), "no ${{ }} inside a run script");
  assert.ok(!/run:[^\n]*\$\{\{/.test(code));
  assert.match(code, /CONFIRM_DATABASE" != "framework-portal"/);
  assert.match(code, /REF" != "refs\/heads\/Staging"[\s\S]*REF" != "refs\/heads\/main"/);
  const firstRun = code.indexOf("run: |"), checkout = code.indexOf("actions/checkout");
  assert.ok(firstRun > 0 && firstRun < checkout, "the input check runs before checkout and before any Cloudflare call");
});
test("secrets are named only as environment secrets, passed per step, never echoed, never in the repository", () => {
  assert.deepEqual([...new Set([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  assert.ok(!/^env:[\s\S]*?CLOUDFLARE_API_TOKEN/m.test(code.slice(code.indexOf("\nenv:"), code.indexOf("\njobs:"))), "no workflow-level secret exposure");
  assert.ok(!/echo[^\n]*(TOKEN|SECRET|secrets\.)|set -x|--verbose|\bwhoami\b|ACTIONS_STEP_DEBUG|upload-artifact|actions\/cache/.test(code));
  assert.ok(!/(cfut_|cfat_|[A-Za-z0-9_-]{40,})/.test(code.replace(/[0-9a-f]{40}/g, "")), "no token-shaped value or unpinned long literal");
});
test("actions are on the allow-list and pinned to full SHAs; Wrangler is pinned to an exact version", () => {
  const uses = [...code.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.equal(uses.length, 2);
  for (const u of uses) assert.match(u, /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/, u);
  assert.match(code, /persist-credentials: false/);
  assert.match(code, /WRANGLER_VERSION: "\d+\.\d+\.\d+"/);
  assert.ok(!/wrangler@(latest|\^|~|\*)/.test(code));
  for (const line of code.split("\n").filter((l) => /\bwrangler@/.test(l))) assert.match(line, /wrangler@\$WRANGLER_VERSION/);
});
test("every Wrangler call targets the Production config explicitly; PORTAL_DB only; remote calls say --remote", () => {
  const calls = code.split("\n").filter((l) => /wrangler@/.test(l));
  assert.equal(calls.length, 7);
  for (const c of calls) {
    assert.match(c, /-c "\$CONFIG"/, c);
    assert.match(c, /d1 (info|migrations (list|apply)|execute) PORTAL_DB/, c);
    if (!/d1 info/.test(c)) assert.match(c, /--remote/, c);
  }
  assert.match(code, /CONFIG: migrations\/portal\/wrangler\.migrate\.production\.jsonc/);
  assert.ok(!/wrangler\.jsonc|wrangler\.migrate\.staging|framework-portal-staging|framework-staging|framework-feedback|47d90f94|1edda8a2|c4815cdc/.test(code));
  assert.ok(!/\bdeploy\b|wrangler (versions|publish|secret|r2|kv|delete)|d1 (delete|create|time-travel)/.test(code));
});
test("the only SQL the workflow sends is read-only schema introspection; apply happens in exactly one step, only in apply mode", () => {
  const commands = [...code.matchAll(/--command "([^"]*)"/g)].map((m) => m[1]);
  assert.ok(commands.length >= 3);
  for (const c of commands) assert.match(c, /^SELECT name FROM sqlite_master WHERE type='(table|index)' ORDER BY name$/, c);
  const applies = code.split("\n").filter((l) => /migrations apply/.test(l));
  assert.equal(applies.length, 1);
  const stepStart = code.lastIndexOf("- name:", code.indexOf("migrations apply"));
  assert.match(code.slice(stepStart, code.indexOf("migrations apply")), /if: \$\{\{ inputs\.mode == 'apply' \}\}/);
  assert.ok(!/--file|execute[^\n]*--command "(?!SELECT)/.test(code));
});
test("order: config check, remote id check, pending list, table list, then apply, then post-verification", () => {
  const order = ["portal-d1-check.mjs config", "portal-d1-check.mjs info", "portal-d1-check.mjs pending-before", "portal-d1-check.mjs tables-before", "migrations apply", "portal-d1-check.mjs pending-after", "portal-d1-check.mjs tables-after", "portal-d1-check.mjs indexes-after"].map((n) => code.indexOf(n));
  assert.ok(order.every((i) => i > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
});
test("this is the only extra workflow, and the existing CI workflow is untouched in spirit (no Cloudflare, no secrets)", () => {
  assert.deepEqual(readdirSync(new URL(".github/workflows/", root)).sort(), ["ci.yml", "portal-production-d1-migration.yml"]);
  const ci = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
  assert.ok(!/secrets\.|CLOUDFLARE|wrangler|migrat/i.test(ci.replace(/^\s*#.*$/gm, "")));
});

/* ------------------------------------------------------------------ the check script, against realistic Wrangler output */
const throwsFail = (fn, re) => assert.throws(fn, (e) => re.test(e.message));
const LIST_PENDING = `\n ⛅️ wrangler 4.151.2\n────────────────────\nResource location: remote \n\nMigrations to be applied:\n┌────────────────────────────┐\n│ Name                       │\n├────────────────────────────┤\n│ 0001_portal_foundation.sql │\n└────────────────────────────┘\n`;
const LIST_NONE = `\n ⛅️ wrangler 4.151.2\n────────────────────\nResource location: remote \n\n✅ No migrations to apply!\n`;
const exec = (...names) => JSON.stringify([{ results: names.map((name) => ({ name })), success: true, meta: {} }]);

test("script: the Production config must be exactly the expected one", () => {
  assert.match(checkConfig(prodConfig), /framework-portal/);
  const mutate = (fn) => { const c = JSON.parse(prodConfig.replace(/^\s*\/\/.*$/gm, "")); fn(c); return JSON.stringify(c); };
  for (const bad of [
    mutate((c) => { c.d1_databases[0].database_id = "1edda8a2-5249-4f40-9dbc-d29aa44e21f8"; }),
    mutate((c) => { c.d1_databases[0].database_name = "framework-portal-staging"; }),
    mutate((c) => { c.d1_databases[0].binding = "DB"; }),
    mutate((c) => { c.d1_databases.push({ binding: "DB", database_name: "framework-feedback", database_id: "47d90f94-3846-4711-9495-ab3479431a6f" }); }),
    mutate((c) => { c.main = "worker/index.js"; }),
    mutate((c) => { c.vars = { A: "1" }; }),
    "not json",
  ]) throwsFail(() => checkConfig(bad), /config|target|define|exactly/i);
});
test("script: remote info must match the expected name AND id", () => {
  assert.match(checkInfo(JSON.stringify({ uuid: EXPECTED.id, name: EXPECTED.name, num_tables: 0, file_size: 12288 })), /ok/);
  for (const bad of [
    JSON.stringify({ uuid: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8", name: EXPECTED.name }),
    JSON.stringify({ uuid: EXPECTED.id, name: "framework-portal-staging" }),
    JSON.stringify({ name: EXPECTED.name }),
    "", "no json here", "{broken",
  ]) throwsFail(() => checkInfo(bad), /match|JSON|unreadable/i);
});
test("script: pending migrations - apply needs exactly 0001; anything else fails closed", () => {
  assert.match(checkPendingBefore(LIST_PENDING, "apply"), /0001_portal_foundation\.sql/);
  assert.match(checkPendingBefore(LIST_PENDING, "verify-only"), /0001/);
  assert.match(checkPendingBefore(LIST_NONE, "verify-only"), /none/);
  throwsFail(() => checkPendingBefore(LIST_NONE, "apply"), /exactly one pending/);
  throwsFail(() => checkPendingBefore(LIST_PENDING.replace("0001_portal_foundation.sql", "0001_create_feedback_responses.sql"), "verify-only"), /unexpected pending/);
  throwsFail(() => checkPendingBefore(LIST_PENDING.replace("└", "│ 0002_something.sql │\n└"), "apply"), /exactly one pending|unexpected/);
  throwsFail(() => checkPendingBefore("something unexpected", "verify-only"), /unrecognised/);
  throwsFail(() => checkPendingBefore("", "apply"), /unrecognised/);
  throwsFail(() => checkPendingBefore(LIST_PENDING + LIST_NONE, "apply"), /contradictory/);
});
test("script: tables before - an apply into a non-empty database is refused; system tables are ignored", () => {
  assert.match(checkTablesBefore(exec(), "apply"), /none/);
  assert.match(checkTablesBefore(exec("_cf_KV", "d1_migrations", "sqlite_sequence"), "apply"), /none/);
  throwsFail(() => checkTablesBefore(exec("organizations"), "apply"), /not empty/);
  throwsFail(() => checkTablesBefore(exec("framework_feedback_responses"), "apply"), /not empty/);
  assert.match(checkTablesBefore(exec("organizations"), "verify-only"), /organizations/, "verify-only just reports");
  throwsFail(() => checkTablesBefore("nope", "apply"), /JSON/);
  throwsFail(() => checkTablesBefore(JSON.stringify([{ results: [], success: false }]), "apply"), /did not succeed/);
});
test("script: after apply the tables and indexes must be exactly the expected sets", () => {
  assert.match(checkPendingAfter(LIST_NONE), /no pending/);
  throwsFail(() => checkPendingAfter(LIST_PENDING), /still pending/);
  assert.match(checkTablesAfter(exec(...EXPECTED.tables, "d1_migrations", "_cf_KV")), /tables ok/);
  throwsFail(() => checkTablesAfter(exec(...EXPECTED.tables.slice(1))), /do not match/);
  throwsFail(() => checkTablesAfter(exec(...EXPECTED.tables, "extra_table")), /do not match/);
  assert.match(checkIndexesAfter(exec(...EXPECTED.indexes, "sqlite_autoindex_projects_1")), /13/);
  throwsFail(() => checkIndexesAfter(exec(...EXPECTED.indexes.slice(1))), /do not match/);
});
test("script: the expected tables, indexes and migration name are exactly what 0001_portal_foundation.sql creates", () => {
  assert.deepEqual([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort(), [...EXPECTED.tables].sort());
  assert.deepEqual([...sql.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]).sort(), [...EXPECTED.indexes].sort());
  assert.ok(readdirSync(new URL("migrations/portal/", root)).includes(EXPECTED.migration));
  assert.deepEqual(readdirSync(new URL("migrations/portal/", root)).filter((f) => /^\d{4}_.*\.sql$/.test(f)), [EXPECTED.migration], "no other migration file would be applied with it");
});
