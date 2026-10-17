/**
 * Framework Admin — database identity check (GET /api/admin/database).
 *
 * Lets an admin prove which D1 database a deployment is really connected to, BEFORE anything is written:
 *  - strictly read-only (only SELECTs; it never creates, alters or inserts anything, unlike the module endpoints
 *    that make sure their table exists first),
 *  - reports the environment marker row (framework_environment) that migrations/staging-init.sql writes into the
 *    staging database only, the list of tables, and row COUNTS (never row contents, so no personal data).
 * Only reachable after authenticateAdmin() (see router.js).
 */

import { json } from "../shared.js";

const KNOWN_TABLES = ["feedback_responses", "assessment_requests", "client_revenue"];

export async function handleDatabaseApi(request, env, principal, path) {
  if (path !== "/database") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!env.DB) return json({ error: "database_unavailable" }, 503);

  try {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
    ).all();
    const tables = results.map((r) => r.name);

    let environment = null;
    if (tables.includes("framework_environment")) {
      const row = await env.DB.prepare("SELECT value FROM framework_environment WHERE key = 'environment'").first();
      environment = row && typeof row.value === "string" ? row.value.slice(0, 40) : null;
    }

    const rows = {};
    for (const table of KNOWN_TABLES) {
      // table names come from the constant list above, never from the request
      rows[table] = tables.includes(table) ? (await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n : null;
    }
    return json({ environment, tables, rows });
  } catch (err) {
    console.error("admin database check error:", err && err.message);
    return json({ error: "database_unavailable" }, 503);
  }
}
