// Safety checks for the manually triggered Production portal D1 migration workflow (.github/workflows/portal-production-d1-migration.yml).
// Each check reads Wrangler's output on stdin (or the migration config file) and exits non-zero on ANY mismatch or surprise ("fail closed").
// It never prints secrets: the only values it handles are database names/ids, migration file names and table names.
// Usage: node portal-d1-check.mjs <config|info|pending-before|pending-after|tables-before|tables-after|indexes-after> [arg] < wrangler-output
import { readFileSync } from "node:fs";

// The migrations Production may receive, IN ORDER, with exactly the tables and indexes each one creates. A run is allowed only when the pending list is a tail of this
// list (for example 0002, 0003, 0004 on a database that already has 0001), and the tables already in the database must equal what the already-applied migrations create.
// 0004 only adds columns to `invitations`, 0006 and 0009 one column to `brand_kits`, 0010 one column to `service_requests` (no table or index). 0011 also adds one nullable column to `support_requests` and four default price rows to `service_prices`. 0005-0012 are all additive. Anything else fails closed.
export const STAGES = Object.freeze([
  {
    file: "0001_portal_foundation.sql",
    tables: ["activity_log", "invitations", "memberships", "organizations", "portal_sessions", "portal_users", "projects"],
    indexes: [
      "idx_activity_org_client_time", "idx_activity_org_time", "idx_invitations_one_pending", "idx_invitations_org", "idx_invitations_pending_email",
      "idx_invitations_workos", "idx_memberships_org", "idx_memberships_user", "idx_organizations_revenue_client", "idx_portal_sessions_expiry",
      "idx_portal_sessions_user", "idx_projects_org_created", "idx_projects_org_status",
    ],
  },
  { file: "0002_business_profile.sql", tables: ["business_profile_answers"], indexes: [] },
  { file: "0003_portal_feedback.sql", tables: ["portal_feedback"], indexes: ["idx_portal_feedback_created", "idx_portal_feedback_user"] },
  { file: "0004_invitation_delivery.sql", tables: [], indexes: [] },
  { file: "0005_branding.sql", tables: ["brand_assets", "brand_kits", "brand_uploads", "service_requests"], indexes: ["idx_brand_assets_org", "idx_brand_uploads_org", "idx_service_requests_open", "idx_service_requests_org"] },
  { file: "0006_brand_name.sql", tables: [], indexes: [] }, // one nullable column on brand_kits
  {
    file: "0007_client_services.sql",
    tables: ["invoices", "service_notifications", "support_attachments", "support_messages", "support_requests"],
    indexes: ["idx_invoices_org", "idx_service_notifications_pending", "idx_support_attachments_request", "idx_support_messages_request", "idx_support_requests_org"],
  },
  { file: "0008_approved_emails.sql", tables: ["approved_emails"], indexes: [] },
  { file: "0009_brand_sections.sql", tables: [], indexes: [] }, // one nullable column on brand_kits
  { file: "0010_service_pricing.sql", tables: ["service_prices"], indexes: [] }, // one table, plus one nullable column on service_requests
  { file: "0011_websites.sql", tables: ["website_milestones", "websites"], indexes: ["idx_support_requests_website", "idx_website_milestones_site", "idx_websites_org"] }, // two tables, one nullable column on support_requests, four service_prices rows
  { file: "0012_website_management.sql", tables: ["portal_services", "website_packages"], indexes: ["idx_website_packages_org"] }, // two tables, four seed rows
  { file: "0013_staff_access.sql", tables: ["portal_staff"], indexes: [] }, // one table (Master Client Access), one seed row (a pending grant for hello@frameworkco.ca)
  { file: "0014_brand_requirements.sql", tables: ["brand_requirements"], indexes: [] }, // one table (per-client Branding requirement overrides), no seed rows
]);
export const EXPECTED = Object.freeze({
  name: "framework-portal",
  id: "b213b7db-ed29-4ab6-946c-0728dd6709e8",
  binding: "PORTAL_DB",
  migrationsDir: ".",
  migrations: STAGES.map((s) => s.file),
  tables: STAGES.flatMap((s) => s.tables),
  indexes: STAGES.flatMap((s) => s.indexes),
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
/** The pending list must be a TAIL of the known, ordered list: nothing unknown, nothing skipped, nothing out of order. */
export function assertPendingIsTail(names) {
  const known = EXPECTED.migrations;
  const unknown = names.filter((n) => !known.includes(n));
  if (unknown.length) fail("unexpected pending migration(s): " + unknown.join(", "));
  const tail = known.slice(known.length - names.length);
  if (names.length > known.length || names.some((n, i) => n !== tail[i])) fail("pending migrations are not the next ones in order; found: " + names.join(", "));
}
export function checkPendingBefore(text, mode) {
  const names = [...pendingMigrations(text)].sort();
  assertPendingIsTail(names);
  if (mode === "apply" && names.length === 0) fail("apply requires at least one pending migration; none found");
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
/** Tables that must already exist given which migrations are still pending (everything not pending has been applied). */
export function tablesAlreadyApplied(pendingNames) {
  return STAGES.filter((st) => !pendingNames.includes(st.file)).flatMap((st) => st.tables);
}
export function checkTablesBefore(text, mode, pendingNames = EXPECTED.migrations) {
  const user = namesFromExecute(text).filter((n) => !SYSTEM_TABLE.test(n));
  const want = tablesAlreadyApplied(pendingNames);
  if (!sameSet(user, want)) fail("the Production database does not match its migration state; expected tables: " + (want.join(", ") || "none") + "; found: " + (user.join(", ") || "none"));
  return "user tables before: " + ([...user].sort().join(", ") || "none");
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
  const [cmd, arg, arg2] = process.argv.slice(2);
  try {
    const input = () => readFileSync(0, "utf8");
    const out = {
      config: () => checkConfig(readFileSync(arg, "utf8")),
      info: () => checkInfo(input()),
      "pending-before": () => checkPendingBefore(input(), arg),
      "pending-after": () => checkPendingAfter(input()),
      "tables-before": () => checkTablesBefore(input(), arg, pendingMigrations(readFileSync(arg2, "utf8"))),
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
