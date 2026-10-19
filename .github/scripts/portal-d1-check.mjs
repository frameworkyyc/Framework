// Safety checks for the manually triggered Production portal D1 migration workflow (.github/workflows/portal-production-d1-migration.yml).
// Each check reads Wrangler's output on stdin (or the migration config file) and exits non-zero on ANY mismatch or surprise ("fail closed").
// It never prints secrets: the only values it handles are database names/ids, migration file names and table names.
// Usage: node portal-d1-check.mjs <config|info|pending-before|pending-after|tables-before|tables-after|indexes-after> [arg] < wrangler-output
import { readFileSync } from "node:fs";

export const EXPECTED = Object.freeze({
  name: "framework-portal",
  id: "b213b7db-ed29-4ab6-946c-0728dd6709e8",
  binding: "PORTAL_DB",
  migrationsDir: ".",
  migration: "0001_portal_foundation.sql",
  tables: ["activity_log", "invitations", "memberships", "organizations", "portal_sessions", "portal_users", "projects"],
  indexes: [
    "idx_activity_org_client_time", "idx_activity_org_time", "idx_invitations_one_pending", "idx_invitations_org", "idx_invitations_pending_email",
    "idx_invitations_workos", "idx_memberships_org", "idx_memberships_user", "idx_organizations_revenue_client", "idx_portal_sessions_expiry",
    "idx_portal_sessions_user", "idx_projects_org_created", "idx_projects_org_status",
  ],
});
// Tables Cloudflare/Wrangler own; they may exist and are ignored. Anything else that is not expected is a surprise.
const SYSTEM_TABLE = /^(d1_migrations|_cf_[A-Za-z0-9_]*|sqlite_[A-Za-z0-9_]*)$/;
const fail = (msg) => { throw new Error(msg); };
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

export function checkConfig(text) {
  let cfg;
  try { cfg = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")); } catch { fail("migration config is not valid JSON"); }
  const dbs = cfg.d1_databases;
  if (!Array.isArray(dbs) || dbs.length !== 1) fail("migration config must bind exactly one D1 database");
  const [d] = dbs;
  if (d.binding !== EXPECTED.binding || d.database_name !== EXPECTED.name || d.database_id !== EXPECTED.id || d.migrations_dir !== EXPECTED.migrationsDir) fail("migration config does not target the expected Production portal database");
  for (const k of ["main", "vars", "assets", "r2_buckets", "previews", "kv_namespaces", "routes"]) if (cfg[k] !== undefined) fail("migration config must not define " + k);
  return "config ok: " + d.database_name;
}

export function checkInfo(text) {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end < start) fail("d1 info returned no JSON");
  let info;
  try { info = JSON.parse(text.slice(start, end + 1)); } catch { fail("d1 info returned unreadable JSON"); }
  if (info.name !== EXPECTED.name) fail("remote database name does not match (expected " + EXPECTED.name + ")");
  if ((info.uuid ?? info.id) !== EXPECTED.id) fail("remote database id does not match (expected " + EXPECTED.id + ")");
  return "remote database ok: " + info.name + " " + info.uuid;
}

/** Names of the unapplied migration files in `wrangler d1 migrations list` output, or [] only when it clearly says nothing is pending. */
export function pendingMigrations(text) {
  const names = [...new Set(text.match(/\b\d{4}_[A-Za-z0-9_.-]+\.sql\b/g) ?? [])];
  if (names.length === 0 && !/No migrations to apply/i.test(text)) fail("could not read the pending migrations (unrecognised output)");
  if (names.length > 0 && /No migrations to apply/i.test(text)) fail("contradictory migration list output");
  return names;
}
export function checkPendingBefore(text, mode) {
  const names = pendingMigrations(text);
  if (mode === "apply" && !(names.length === 1 && names[0] === EXPECTED.migration)) fail("apply requires exactly one pending migration, " + EXPECTED.migration + "; found: " + (names.join(", ") || "none"));
  if (names.some((n) => n !== EXPECTED.migration)) fail("unexpected pending migration(s): " + names.filter((n) => n !== EXPECTED.migration).join(", "));
  return "pending: " + (names.join(", ") || "none");
}
export function checkPendingAfter(text) {
  const names = pendingMigrations(text);
  if (names.length) fail("migrations still pending after apply: " + names.join(", "));
  return "no pending migrations";
}

/** `wrangler d1 execute --json` output -> list of values of the `name` column. */
export function namesFromExecute(text) {
  const start = text.indexOf("["), end = text.lastIndexOf("]");
  if (start < 0 || end < start) fail("d1 execute returned no JSON");
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch { fail("d1 execute returned unreadable JSON"); }
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || first.success === false || !Array.isArray(first.results)) fail("d1 execute did not succeed");
  return first.results.map((r) => String(r.name));
}
export function checkTablesBefore(text, mode) {
  const user = namesFromExecute(text).filter((n) => !SYSTEM_TABLE.test(n));
  if (mode === "apply" && user.length) fail("the Production database is not empty; found tables: " + user.join(", "));
  return "user tables before: " + (user.join(", ") || "none");
}
export function checkTablesAfter(text) {
  const user = namesFromExecute(text).filter((n) => !SYSTEM_TABLE.test(n));
  if (!sameSet(user, EXPECTED.tables)) fail("tables do not match the expected set; found: " + (user.join(", ") || "none"));
  return "tables ok: " + user.sort().join(", ");
}
export function checkIndexesAfter(text) {
  const names = namesFromExecute(text).filter((n) => !/^sqlite_autoindex_/.test(n));
  if (!sameSet(names, EXPECTED.indexes)) fail("indexes do not match the expected set; found " + names.length);
  return "indexes ok: " + names.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    const input = () => readFileSync(0, "utf8");
    const out = {
      config: () => checkConfig(readFileSync(arg, "utf8")),
      info: () => checkInfo(input()),
      "pending-before": () => checkPendingBefore(input(), arg),
      "pending-after": () => checkPendingAfter(input()),
      "tables-before": () => checkTablesBefore(input(), arg),
      "tables-after": () => checkTablesAfter(input()),
      "indexes-after": () => checkIndexesAfter(input()),
    }[cmd];
    if (!out) fail("unknown check");
    console.log(out());
  } catch (e) {
    console.error("FAIL: " + e.message);
    process.exit(1);
  }
}
