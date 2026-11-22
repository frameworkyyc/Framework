// Safety checks for the manually triggered STAGING portal D1 migration workflow (.github/workflows/portal-staging-d1-migration.yml).
// Same idea as portal-d1-check.mjs (which guards Production and is untouched): each check reads Wrangler's output on stdin (or the config file) and exits non-zero on ANY mismatch ("fail closed").
// It only ever accepts the Staging database (name AND id) and refuses the Production database id and name. It never prints secrets: it handles database names/ids, migration file names, table and column names,
// one Time Travel bookmark and a few counts.
// Usage: node portal-staging-d1-check.mjs <config|info|pending-before|tables-before|bookmark|fingerprint|fingerprint-compare|pending-after|tables-after|columns-after> [arg] [arg2] < wrangler-output
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { EXPECTED as PRODUCTION, pendingMigrations, namesFromExecute, parseBookmark } from "./portal-d1-check.mjs";

/** The one database this workflow may touch. */
export const STAGING = Object.freeze({
  name: "framework-portal-staging",
  id: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8",
  binding: "PORTAL_DB",
  migrationsDir: ".",
  // Everything up to and including 0030 is already applied to Staging. The only migration this workflow may apply is listed here; add the next one by a reviewed change, like the Production list.
  applicable: Object.freeze(["0031_website_staging_screenshot.sql"]),
  // What 0031 adds to `websites` (and the Production columns it must leave alone).
  newColumns: Object.freeze(["staging_screenshot_format", "staging_screenshot_key", "staging_screenshot_name", "staging_screenshot_sha256", "staging_screenshot_size", "staging_screenshot_type"]),
  keptColumns: Object.freeze(["screenshot_format", "screenshot_key", "screenshot_name", "screenshot_sha256", "screenshot_size", "screenshot_type"]),
});
const PRODUCTION_ID = PRODUCTION.id, PRODUCTION_NAME = PRODUCTION.name;
const SYSTEM_TABLE = /^(d1_migrations|_cf_[A-Za-z0-9_]*|sqlite_[A-Za-z0-9_]*)$/;
const fail = (msg) => { throw new Error(msg); };

export function checkConfig(text) {
  let cfg;
  try { cfg = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")); } catch { fail("migration config is not valid JSON"); }
  const dbs = cfg.d1_databases;
  if (!Array.isArray(dbs) || dbs.length !== 1) fail("migration config must bind exactly one D1 database");
  const [d] = dbs;
  if (d.database_id === PRODUCTION_ID || d.database_name === PRODUCTION_NAME) fail("migration config names the Production database; this workflow never touches Production");
  if (d.binding !== STAGING.binding || d.database_name !== STAGING.name || d.database_id !== STAGING.id || d.migrations_dir !== STAGING.migrationsDir) fail("migration config does not target the Staging portal database");
  for (const k of ["main", "vars", "assets", "r2_buckets", "previews", "kv_namespaces", "routes"]) if (cfg[k] !== undefined) fail("migration config must not define " + k);
  return "config ok: " + d.database_name;
}

export function checkInfo(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) fail("d1 info returned no JSON");
  let info;
  try { info = JSON.parse(text.slice(start, end + 1)); } catch { fail("d1 info returned unreadable JSON"); }
  const id = info.uuid ?? info.id;
  if (id === PRODUCTION_ID || info.name === PRODUCTION_NAME) fail("the remote database is Production; stopping");
  if (info.name !== STAGING.name) fail("remote database name does not match (expected " + STAGING.name + ")");
  if (id !== STAGING.id) fail("remote database id does not match (expected " + STAGING.id + ")");
  return "remote database ok: " + info.name + " " + id;
}

/** Pending migrations on Staging: only ones this workflow may apply. Apply mode needs at least one. */
export function checkPendingBefore(text, mode) {
  const names = [...pendingMigrations(text)].sort();
  const unexpected = names.filter((n) => !STAGING.applicable.includes(n));
  if (unexpected.length) fail("unexpected pending migration(s) on Staging: " + unexpected.join(", "));
  if (mode === "apply" && names.length === 0) fail("apply requires at least one pending migration; none found");
  return "pending: " + (names.join(", ") || "none");
}
export function checkPendingAfter(text) {
  const names = pendingMigrations(text);
  if (names.length) fail("migrations still pending after apply: " + names.join(", "));
  return "no pending migrations";
}

const userTables = (text) => namesFromExecute(text).filter((n) => !SYSTEM_TABLE.test(n));
/** Every table the applied migrations create must exist. Extra tables (Staging-only experiments) are listed, never touched. */
export function checkTablesBefore(text) {
  const have = userTables(text), missing = PRODUCTION.tables.filter((t) => !have.includes(t));
  if (missing.length) fail("the Staging database is missing expected tables: " + missing.join(", "));
  const extra = have.filter((t) => !PRODUCTION.tables.includes(t));
  return `tables ok: ${have.length} (extra, left alone: ${extra.join(", ") || "none"})`;
}
/** The migration adds no table: the table list after must be exactly the list before. */
export function checkTablesAfter(afterText, beforeText) {
  const a = userTables(afterText).sort().join(","), b = userTables(beforeText).sort().join(",");
  if (a !== b) fail("the table list changed during the migration (it must not)");
  return "tables unchanged: " + userTables(afterText).length;
}
/** The new Staging columns exist and the Production screenshot columns are still there. */
export function checkColumnsAfter(text) {
  const have = namesFromExecute(text);
  const missing = [...STAGING.newColumns, ...STAGING.keptColumns].filter((c) => !have.includes(c));
  if (missing.length) fail("websites is missing columns: " + missing.join(", "));
  return "columns ok: " + STAGING.newColumns.length + " new, " + STAGING.keptColumns.length + " kept";
}

/** A fixed fingerprint of the Production-style screenshot data in `websites`: how many rows, how many have a screenshot, and their total size and hashes. Equal before and after means nothing was rewritten. */
export function fingerprint(text) {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < start) fail("d1 execute returned no JSON");
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { fail("d1 execute returned unreadable JSON"); }
  const r = parsed && parsed[0] && parsed[0].success !== false && Array.isArray(parsed[0].results) ? parsed[0].results[0] : null;
  if (!r) fail("could not read the screenshot fingerprint");
  return JSON.stringify({ websites: r.websites, with_screenshot: r.with_screenshot, bytes: r.bytes, hashes: r.hashes });
}
export function compareFingerprints(before, after) {
  if (before.trim() !== after.trim()) fail("existing screenshot data changed during the migration");
  return "existing screenshot data unchanged: " + after.trim();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg, arg2] = process.argv.slice(2);
  try {
    const input = () => readFileSync(0, "utf8");
    const out = {
      config: () => checkConfig(readFileSync(arg, "utf8")),
      info: () => checkInfo(input()),
      "pending-before": () => checkPendingBefore(input(), arg),
      "tables-before": () => checkTablesBefore(input()),
      "pending-after": () => checkPendingAfter(input()),
      "tables-after": () => checkTablesAfter(input(), readFileSync(arg, "utf8")),
      "columns-after": () => checkColumnsAfter(input()),
      fingerprint: () => { const f = fingerprint(input()); writeFileSync(arg, f + "\n"); return "screenshot fingerprint: " + f; },
      "fingerprint-compare": () => compareFingerprints(readFileSync(arg, "utf8"), readFileSync(arg2, "utf8")),
      bookmark: () => {
        const b = parseBookmark(input());
        writeFileSync(arg, b + "\n");
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, "### Staging D1 recovery bookmark (framework-portal-staging)\n\n`" + b + "`\n\nRestore point recorded before any migration. Recovery (manual, owner-approved only): `wrangler d1 time-travel restore PORTAL_DB --bookmark=<value>` with the Staging migration config.\n");
        return "bookmark recorded: " + b;
      },
    }[cmd];
    if (!out) fail("unknown check");
    console.log(out());
  } catch (e) {
    console.error("FAIL: " + e.message);
    process.exit(1);
  }
}
