// The Staging migration runner (scripts/ops/staging-migrate.mjs) against a fake Wrangler: every safety check must stop it BEFORE anything is applied. Nothing here contacts Cloudflare.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { run, CONFIG } from "../../scripts/ops/staging-migrate.mjs";
import { STAGING, lintMigration } from "../../.github/scripts/portal-staging-d1-check.mjs";
import { EXPECTED as PROD } from "../../.github/scripts/portal-d1-check.mjs";

const F = "0031_website_staging_screenshot.sql", BM = "0000012e-00000000-0000512b-0eb669502b6d232dd1c0d1d5f7c47529";
const exec = (...names) => JSON.stringify([{ results: names.map((name) => ({ name })), success: true, meta: {} }]);
const row = (o = {}) => JSON.stringify([{ results: [{ websites: 3, with_screenshot: 2, bytes: 90, hashes: "aa,bb", ...o }], success: true }]);
const pendingList = (...f) => `Migrations to be applied:\n${f.map((x) => `│ ${x} │`).join("\n")}\n`;
const NONE = "✅ No migrations to apply!";

/** A fake Wrangler for a Staging database. `state` is what the database holds; `over` overrides single answers; `log` records every call. */
function world({ pending = [F], over = {}, state = {} } = {}) {
  const st = { applied: false, tables: PROD.tables, cols: [...STAGING.keptColumns], fp: row(), ...state }, log = [];
  const wr = (args) => {
    log.push(args.join(" "));
    const a = args.join(" ");
    if (over[a]) return typeof over[a] === "function" ? over[a](st) : over[a];
    if (args[0] === "d1" && args[1] === "info") return JSON.stringify({ uuid: STAGING.id, name: STAGING.name });
    if (args[1] === "migrations" && args[2] === "list") return st.applied || !pending.length ? NONE : pendingList(...pending);
    if (args[1] === "time-travel") return JSON.stringify({ bookmark: BM });
    if (args[1] === "migrations" && args[2] === "apply") { st.applied = true; st.cols = [...STAGING.keptColumns, ...STAGING.newColumns]; return "ok"; }
    if (args[1] === "execute") { const q = args[args.indexOf("--command") + 1]; if (/pragma_table_info/.test(q)) return exec(...st.cols); if (/sqlite_master/.test(q)) return exec("d1_migrations", ...st.tables); if (/screenshot_sha256/.test(q)) return st.fp; }
    throw new Error("unexpected call " + a);
  };
  return { wr, log, st };
}
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const applied = (log) => log.some((l) => /migrations apply/.test(l));

test("verify is read-only: it checks everything, records a bookmark, and never applies", async () => {
  const w = world(); const r = await run({ mode: "verify", wr: w.wr, read });
  assert.equal(r.ok, true); assert.equal(r.bookmark, BM); assert.deepEqual(r.pending, [F]); assert.ok(!applied(w.log));
  assert.match(r.lines.join("\n"), /PASS config[\s\S]*PASS remote database[\s\S]*PASS pending migrations[\s\S]*PASS migration SQL[\s\S]*PASS tables[\s\S]*PASS recovery bookmark/);
  assert.ok(w.log.every((l) => !/restore|delete|drop/i.test(l)), "no destructive call");
});
test("apply: bookmark first, then apply, then every after-check; the result lists what was applied", async () => {
  const w = world(); const r = await run({ mode: "apply", wr: w.wr, read });
  assert.equal(r.ok, true); assert.deepEqual(r.applied, [F]);
  const i = (re) => w.log.findIndex((l) => re.test(l));
  assert.ok(i(/time-travel/) > 0 && i(/time-travel/) < i(/migrations apply/), "the bookmark is taken before apply");
  assert.ok(w.log.every((l) => /(^| )-c migrations\/portal\/wrangler\.migrate\.staging\.jsonc( |$)/.test(l) || /execute/.test(l) && l.includes(CONFIG)), "every call uses the Staging config");
  assert.match(r.lines.join("\n"), /PASS columns after[\s\S]*PASS screenshot data after: existing screenshot data unchanged/);
});
test("apply stops BEFORE applying when: the database is Production, the name or id is wrong, nothing is pending, something unexpected is pending, tables are missing, or no bookmark comes back", async () => {
  const cases = [
    ["production database", { ["d1 info PORTAL_DB --json -c " + CONFIG]: JSON.stringify({ uuid: PROD.id, name: PROD.name }) }, /remote database/],
    ["wrong id", { ["d1 info PORTAL_DB --json -c " + CONFIG]: JSON.stringify({ uuid: "x".repeat(36), name: STAGING.name }) }, /remote database/],
    ["unknown pending", { ["d1 migrations list PORTAL_DB --remote -c " + CONFIG]: pendingList(F, "0099_unknown.sql") }, /pending migrations/],
    ["nothing pending", { ["d1 migrations list PORTAL_DB --remote -c " + CONFIG]: NONE }, /pending migrations/],
    ["unreadable pending", { ["d1 migrations list PORTAL_DB --remote -c " + CONFIG]: "garbage" }, /pending migrations/],
    ["no bookmark", { ["d1 time-travel info PORTAL_DB --json -c " + CONFIG]: "{}" }, /recovery bookmark/],
    ["bad bookmark", { ["d1 time-travel info PORTAL_DB --json -c " + CONFIG]: JSON.stringify({ bookmark: "nope" }) }, /recovery bookmark/],
  ];
  for (const [name, over, step] of cases) {
    const w = world({ over }); const r = await run({ mode: "apply", wr: w.wr, read });
    assert.equal(r.ok, false, name); assert.match(r.lines.join("\n"), new RegExp("FAIL " + step.source), name); assert.ok(!applied(w.log), name + ": nothing applied"); assert.match(r.lines.at(-1), /NEXT: nothing was changed/);
  }
  const w = world({ state: { tables: PROD.tables.slice(2) } }); const r = await run({ mode: "apply", wr: w.wr, read });
  assert.equal(r.ok, false); assert.match(r.lines.join("\n"), /FAIL tables: .*missing/); assert.ok(!applied(w.log));
});
test("apply stops before applying when the pending SQL is not additive; the linter allows exactly the additive forms", async () => {
  for (const bad of ["DROP TABLE x;", "DELETE FROM x;", "UPDATE x SET a = 1;", "ALTER TABLE a RENAME TO b;", "PRAGMA foreign_keys = OFF;", "REPLACE INTO x VALUES (1);", "-- nothing here", "SELECT 1;"]) assert.throws(() => lintMigration("0099_x.sql", bad), /not additive|no recognisable/, bad);
  for (const good of ["CREATE TABLE IF NOT EXISTS t (id TEXT REFERENCES o (id) ON DELETE RESTRICT ON UPDATE CASCADE);", "CREATE INDEX IF NOT EXISTS i ON t (id);", "ALTER TABLE websites ADD COLUMN x TEXT;", "INSERT OR IGNORE INTO t VALUES (1);", "-- DROP is only a comment\nCREATE TABLE t (a TEXT);"]) assert.equal(lintMigration("0099_x.sql", good), true, good);
  const w = world(); const r = await run({ mode: "apply", wr: w.wr, read: (p) => (/migrations\/portal\/0031/.test(p) ? "DELETE FROM websites;" : read(p)) });
  assert.equal(r.ok, false); assert.match(r.lines.join("\n"), /FAIL migration SQL: .*not additive/); assert.ok(!applied(w.log));
  for (const f of PROD.migrations) lintMigration(f, read("migrations/portal/" + f)); // every real reviewed migration file passes the additive rule
});
test("after-checks fail loudly and point at recovery: pending left over, tables changed, columns missing, existing screenshot data changed", async () => {
  const mk = (patch) => world({ over: patch });
  const cases = [
    ["still pending", { ["d1 migrations list PORTAL_DB --remote -c " + CONFIG]: (() => { let n = 0; return () => (n++ === 0 ? pendingList(F) : pendingList(F)); })() }, /FAIL pending after/],
    ["table appeared", { ["d1 execute PORTAL_DB --remote -c " + CONFIG + " --json --command " + "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"]: (st) => exec("d1_migrations", ...st.tables, ...(st.applied ? ["rogue_table"] : [])) }, /FAIL tables after/],
    ["columns missing", { ["d1 migrations apply PORTAL_DB --remote -c " + CONFIG]: (st) => { st.applied = true; return "ok"; } }, /FAIL columns after/],
    ["fingerprint changed", { ["d1 migrations apply PORTAL_DB --remote -c " + CONFIG]: (st) => { st.applied = true; st.cols = [...STAGING.keptColumns, ...STAGING.newColumns]; st.fp = row({ hashes: "zz" }); return "ok"; } }, /FAIL screenshot data after: existing screenshot data changed/],
  ];
  for (const [name, over, re] of cases) { const w = mk(over); const r = await run({ mode: "apply", wr: w.wr, read }); assert.equal(r.ok, false, name); assert.match(r.lines.join("\n"), re, name); assert.match(r.lines.at(-1), /NEXT: the migration may be partly applied[\s\S]*bookmark[\s\S]*owner's approval/, name); }
});
test("the runner holds no credential, only reads placeholders, and is kept off Production by construction", () => {
  const src = read("scripts/ops/staging-migrate.mjs");
  assert.ok(!/cfut_|cfat_|[A-Za-z0-9_-]{40,}/.test(src.replace(/[0-9a-f]{32,}/g, "")), "no token-shaped literal");
  assert.ok(!/b213b7db|47d90f94|framework-portal"|wrangler\.migrate\.production/.test(src), "Production is never named");
  assert.ok(!/restore|d1 (delete|create)/.test(src.replace(/^\s*\/\/.*$/gm, "").replace(/restore from the bookmark above only with the owner's approval/, "")), "no restore or delete command");
  assert.match(src, /CONFIG = "migrations\/portal\/wrangler\.migrate\.staging\.jsonc"/);
});

import { readHealth } from "../../scripts/ops/staging-ready.mjs";
test("staging-ready: READY only with the deployed commit equal to the Staging head and no FAIL; failing rows and a stuck build are reported plainly", () => {
  const ok = "PASS 24 | WARN 4 | FAIL 0 | 2026-11-22T21:41:24Z\n| PASS | deploy.commit | deployed code c5b1c3d is the Staging head |\n| PASS | github.check.workers-builds-framework | x |";
  assert.equal(readHealth(ok).ready, true);
  const pending = "PASS 21 | WARN 7 | FAIL 0 | t\n| WARN | deploy.commit | deployed code 6666a48 differs from the Staging head 518e1fd (a build may be pending or failed) |\n| WARN | github.check.workers-builds-framework | in_progress |";
  assert.equal(readHealth(pending).ready, false);
  const bad = "PASS 20 | WARN 4 | FAIL 1 | t\n| FAIL | smoke.login | sign-in page answers 500 |\n| PASS | deploy.commit | deployed code a is the Staging head |";
  const r = readHealth(bad); assert.equal(r.ready, false); assert.deepEqual(r.fails, ["smoke.login: sign-in page answers 500"]);
  assert.equal(readHealth("").ready, false);
});
test("staging-ready waits out a Cloudflare throttle (429 / 971) instead of reporting a failure", () => {
  const src = read("scripts/ops/staging-ready.mjs");
  assert.match(src, /429\|971/); assert.match(src, /setTimeout\(r, 90000\)/);
});
