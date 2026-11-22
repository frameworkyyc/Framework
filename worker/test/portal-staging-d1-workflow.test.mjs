// Guards the manual STAGING portal D1 migration workflow and its check script (the Production ones have their own tests and are untouched). Nothing here contacts Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { STAGING, checkConfig, checkInfo, checkPendingBefore, checkPendingAfter, checkTablesBefore, checkTablesAfter, checkColumnsAfter, fingerprint, compareFingerprints } from "../../.github/scripts/portal-staging-d1-check.mjs";
import { EXPECTED as PROD } from "../../.github/scripts/portal-d1-check.mjs";

const root = new URL("../../", import.meta.url);
const raw = readFileSync(new URL(".github/workflows/portal-staging-d1-migration.yml", root), "utf8");
const code = raw.replace(/^\s*#.*$/gm, "").replace(/\s+#\s.*$/gm, "");
const stagingConfig = readFileSync(new URL("migrations/portal/wrangler.migrate.staging.jsonc", root), "utf8");
const prodConfig = readFileSync(new URL("migrations/portal/wrangler.migrate.production.jsonc", root), "utf8");

test("trigger is workflow_dispatch only; verify-only by default; the Staging database name is typed; dedicated environment; read-only token; own concurrency group", () => {
  const on = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]), ["workflow_dispatch"]);
  assert.ok(!/push:|pull_request|schedule|workflow_run|repository_dispatch|release|issue_comment/.test(code));
  assert.match(on, /confirm_database:[\s\S]*framework-portal-staging[\s\S]*required: true[\s\S]*type: string/);
  assert.match(on, /mode:[\s\S]*type: choice\n\s+default: verify-only\n\s+options:\n\s+- verify-only\n\s+- apply/);
  assert.match(code, /^permissions:\n  contents: read\n/m); assert.equal([...code.matchAll(/^\s*permissions:/gm)].length, 1);
  assert.match(code, /concurrency:\n  group: portal-staging-d1-migration\n  cancel-in-progress: false/);
  assert.match(code, /environment: staging-portal-d1\n/); assert.ok(!/production-portal-d1/.test(code), "never the Production approval environment");
  assert.match(code, /timeout-minutes: \d+/);
});
test("it can never touch Production: only the Staging config, the Staging name check, ref Staging; no Production database name, id or config anywhere", () => {
  assert.match(code, /CONFIG: migrations\/portal\/wrangler\.migrate\.staging\.jsonc/);
  assert.match(code, /CONFIRM_DATABASE" != "framework-portal-staging"/);
  assert.match(code, /REF" != "refs\/heads\/Staging"/); assert.ok(!/refs\/heads\/main/.test(code));
  assert.ok(!new RegExp(`${PROD.id}|wrangler\\.migrate\\.production|wrangler\\.jsonc|framework-feedback|47d90f94|c4815cdc`).test(code));
  assert.ok(!/"framework-portal"/.test(code), "the Production database name is never typed or accepted");
  assert.match(code, /portal-staging-d1-check\.mjs config/); assert.ok(!/portal-d1-check\.mjs/.test(code), "only the Staging check script is run");
  const calls = code.split("\n").filter((l) => l.includes('"$RUNNER_TEMP/wrangler/node_modules/.bin/wrangler"'));
  assert.ok(calls.length >= 8);
  for (const c of calls) { assert.match(c, /-c "\$CONFIG"/, c); assert.match(c, /d1 (info|time-travel info|migrations (list|apply)|execute) PORTAL_DB/, c); if (!/d1 (info|time-travel info)/.test(c)) assert.match(c, /--remote/, c); }
  assert.ok(!/\bdeploy\b|wrangler (versions|publish|secret|r2|kv|delete)|d1 (delete|create)|time-travel (restore|list)/.test(code));
});
test("inputs reach the shell only through env vars, and are validated before checkout and before any Cloudflare call", () => {
  for (const m of code.matchAll(/run: \|?[^\n]*\n((?:\s{10,}[^\n]*\n?)*)/g)) assert.ok(!/\$\{\{/.test(m[1]), "no ${{ }} inside a run script");
  const firstRun = code.indexOf("run: |"), checkout = code.indexOf("actions/checkout");
  assert.ok(firstRun > 0 && firstRun < checkout);
  assert.match(code, /MODE" != "verify-only" \] && \[ "\$MODE" != "apply"/);
});
test("secrets: only the two Cloudflare environment secrets, passed per step, never echoed; no artifacts, no extra actions; Wrangler pinned and installed before any secret is exposed", () => {
  assert.deepEqual([...new Set([...code.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]))].sort(), ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN"]);
  assert.ok(!/^env:[\s\S]*?CLOUDFLARE_API_TOKEN/m.test(code.slice(code.indexOf("\nenv:"), code.indexOf("\njobs:"))));
  assert.ok(!/echo[^\n]*(TOKEN|SECRET|secrets\.)|set -x|--verbose|\bwhoami\b|ACTIONS_STEP_DEBUG|upload-artifact|actions\/cache/.test(code));
  const uses = [...code.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.equal(uses.length, 2); for (const u of uses) assert.match(u, /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/, u);
  assert.match(code, /persist-credentials: false/); assert.match(code, /WRANGLER_VERSION: "4\.147\.0"/);
  const steps = code.split(/\n      - /).slice(1);
  const install = steps.findIndex((s) => /npm install/.test(s)), firstSecret = steps.findIndex((s) => /secrets\./.test(s));
  assert.ok(install >= 0 && firstSecret > install && !/secrets\./.test(steps[install]));
  assert.ok(!/^\s*run:\s*["']/m.test(code) && !/\t/.test(raw));
});
test("order: config, remote id, pending, tables, fingerprint, bookmark, apply (only in apply mode, only with a bookmark), then verification of pending, tables, columns and screenshot data", () => {
  const order = ["check.mjs config", "check.mjs info", "check.mjs pending-before", "check.mjs tables-before", "check.mjs fingerprint \"$RUNNER_TEMP/fingerprint-before.txt\"", "check.mjs bookmark", "migrations apply", "check.mjs pending-after", "check.mjs tables-after", "check.mjs columns-after", "check.mjs fingerprint-compare"].map((n) => code.indexOf(n));
  assert.ok(order.every((i) => i > 0), JSON.stringify(order)); assert.deepEqual([...order].sort((a, b) => a - b), order);
  const stepOf = (name) => { const i = code.indexOf("- name: " + name); return code.slice(i, code.indexOf("\n      - ", i + 5)); };
  assert.ok(!/if:/.test(stepOf("Record a Time Travel recovery bookmark")), "the bookmark is taken in both modes");
  const apply = stepOf("Apply the pending migrations"); assert.match(apply, /if: \$\{\{ inputs\.mode == 'apply' \}\}/); assert.match(apply, /test -s "\$RUNNER_TEMP\/bookmark\.txt" \|\| \{ echo "FAIL: no recovery bookmark/);
  assert.equal(code.split("\n").filter((l) => /migrations apply/.test(l)).length, 1);
  const sql = [...code.matchAll(/--command "([^"]*)"/g)].map((m) => m[1]);
  for (const c of sql) assert.match(c, /^SELECT /, "read-only SQL only: " + c);
  assert.ok(!/--file|INSERT|UPDATE|DELETE|DROP|ALTER/i.test(sql.join(" ")));
});

/* ------------------------------------------------------------------ the check script */
const throwsFail = (fn, re) => assert.throws(fn, (e) => re.test(e.message));
const listOf = (...files) => `\n ⛅️ wrangler 4.147.0\nResource location: remote \n\nMigrations to be applied:\n┌────┐\n│ name │\n├────┤\n${files.map((f) => `│ ${f} │\n`).join("")}└────┘\n`;
const NONE = "\n ⛅️ wrangler 4.147.0\nResource location: remote \n\n✅ No migrations to apply!\n";
const exec = (...names) => JSON.stringify([{ results: names.map((name) => ({ name })), success: true, meta: {} }]);

test("script: the config must be exactly the Staging one, and the Production database is refused outright", () => {
  assert.match(checkConfig(stagingConfig), /framework-portal-staging/);
  throwsFail(() => checkConfig(prodConfig), /Production|Staging/);
  const mutate = (fn) => { const c = JSON.parse(stagingConfig.replace(/^\s*\/\/.*$/gm, "")); fn(c); return JSON.stringify(c); };
  for (const bad of [mutate((c) => { c.d1_databases[0].database_id = PROD.id; }), mutate((c) => { c.d1_databases[0].database_name = "framework-portal"; }), mutate((c) => { c.d1_databases[0].database_id = "1".repeat(8) + "-0000-4000-8000-000000000000"; }),
    mutate((c) => { c.d1_databases.push({ binding: "DB", database_name: "framework-feedback", database_id: "47d90f94-3846-4711-9495-ab3479431a6f" }); }), mutate((c) => { c.vars = { A: "1" }; }), "not json"]) throwsFail(() => checkConfig(bad), /config|target|define|exactly|Production|Staging/i);
});
test("script: remote info must be the Staging name AND id; Production is refused", () => {
  assert.match(checkInfo(JSON.stringify({ uuid: STAGING.id, name: STAGING.name })), /ok/);
  for (const bad of [{ uuid: PROD.id, name: PROD.name }, { uuid: PROD.id, name: STAGING.name }, { uuid: STAGING.id, name: PROD.name }, { uuid: STAGING.id, name: "other" }, { name: STAGING.name }, {}]) throwsFail(() => checkInfo(JSON.stringify(bad)), /name|id|Production/i);
  throwsFail(() => checkInfo("no json"), /JSON/);
});
test("script: only the applicable migration may be pending; apply needs one; anything else fails closed", () => {
  const f = STAGING.applicable[0];
  assert.equal(checkPendingBefore(listOf(f), "apply"), "pending: " + f); assert.equal(checkPendingBefore(listOf(f), "verify-only"), "pending: " + f);
  assert.equal(checkPendingBefore(NONE, "verify-only"), "pending: none"); throwsFail(() => checkPendingBefore(NONE, "apply"), /at least one/);
  throwsFail(() => checkPendingBefore(listOf(f, "0099_unknown.sql"), "apply"), /unexpected/); throwsFail(() => checkPendingBefore(listOf("0030_website_workspace.sql"), "apply"), /unexpected/); throwsFail(() => checkPendingBefore(listOf("0029_website_analytics_accounts.sql"), "apply"), /unexpected/);
  throwsFail(() => checkPendingBefore("garbage", "apply"), /could not read/);
  assert.equal(checkPendingAfter(NONE), "no pending migrations"); throwsFail(() => checkPendingAfter(listOf(f)), /still pending/);
});
test("script: tables must include everything applied (extras are left alone), stay unchanged, and the new columns appear next to the kept ones", () => {
  const all = PROD.tables;
  assert.match(checkTablesBefore(exec("d1_migrations", "_cf_KV", ...all, "demo_extra")), /extra, left alone: demo_extra/);
  throwsFail(() => checkTablesBefore(exec(...all.slice(1))), /missing/);
  assert.match(checkTablesAfter(exec(...all), exec(...all)), /unchanged/); throwsFail(() => checkTablesAfter(exec(...all, "new_table"), exec(...all)), /changed/);
  assert.match(checkColumnsAfter(exec("id", ...STAGING.newColumns, ...STAGING.keptColumns)), /6 new, 6 kept/);
  throwsFail(() => checkColumnsAfter(exec("id", ...STAGING.keptColumns)), /missing columns/); throwsFail(() => checkColumnsAfter(exec("id", ...STAGING.newColumns)), /missing columns/);
});
test("script: the screenshot fingerprint must be identical before and after", () => {
  const row = (o) => JSON.stringify([{ results: [{ websites: 2, with_screenshot: 1, bytes: 100, hashes: "ab", ...o }], success: true }]);
  const a = fingerprint(row({})), b = fingerprint(row({}));
  assert.match(compareFingerprints(a, b), /unchanged/);
  for (const o of [{ websites: 3 }, { with_screenshot: 0 }, { bytes: 99 }, { hashes: "cd" }]) throwsFail(() => compareFingerprints(a, fingerprint(row(o))), /changed/);
  throwsFail(() => fingerprint("[]"), /fingerprint|JSON/); throwsFail(() => fingerprint("x"), /JSON/);
});
test("this workflow, its script and its environment are the only Staging migration path and are not used by the Production workflow", () => {
  assert.deepEqual(STAGING.applicable, ["0031_website_staging_screenshot.sql"]);
  assert.ok(PROD.migrations.includes(STAGING.applicable[0]), "0031 is in the shared migration list like every migration file; applying it to Production still needs the Production workflow and its own approval");
  assert.ok(!/staging-portal-d1/.test(readFileSync(new URL(".github/workflows/portal-production-d1-migration.yml", root), "utf8")));
});
