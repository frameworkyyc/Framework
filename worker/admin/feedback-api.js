/**
 * Framework Admin — feedback API (GET/PATCH/DELETE /api/admin/feedback…).
 * Only ever called after authenticateAdmin() succeeded (see router.js). Reads and writes the existing
 * `feedback_responses` table through the existing DB binding; no new tables.
 */

import { COLUMNS, RATING_KEYS, ensureSchema, json, csvCell } from "../shared.js";

const ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;
const LIST_LIMIT = 1000;

const RATING_COLUMNS = RATING_KEYS.map((k) => "rating_" + k);
const SUMMARY_COLUMNS = [
  "id",
  "created_at",
  "satisfaction",
  "recommend",
  "improvement",
  "testimonial_permission",
  "logo_permission",
  "revenue",
  "attribution_name",
  "attribution_business",
  ...RATING_COLUMNS,
];

/* ---- Optional `reviewed_at` column (migrations/0002). The API works with or without it. ---- */

let reviewedCache = { supported: false, at: 0 };

async function reviewedSupported(db) {
  const now = Date.now();
  // A positive answer is cached for the life of the isolate; a negative one is re-checked every 30s so that
  // running the migration takes effect without a redeploy.
  if (reviewedCache.supported || now - reviewedCache.at < 30000) return reviewedCache.supported;
  const { results } = await db.prepare("PRAGMA table_info(feedback_responses)").all();
  reviewedCache = { supported: results.some((c) => c.name === "reviewed_at"), at: now };
  return reviewedCache.supported;
}

export function resetReviewedCacheForTests() {
  reviewedCache = { supported: false, at: 0 };
}

const summaryColumns = (reviewed) => (reviewed ? [...SUMMARY_COLUMNS, "reviewed_at"] : SUMMARY_COLUMNS);
const allColumns = (reviewed) => (reviewed ? [...COLUMNS, "reviewed_at"] : COLUMNS);

const round1 = (n) => (n === null || n === undefined ? null : Math.round(n * 10) / 10);

/* ---- Handlers ---- */

async function me(principal) {
  return json({ email: principal.email });
}

async function overview(env) {
  await ensureSchema(env.DB);
  const reviewed = await reviewedSupported(env.DB);
  const stats = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            AVG(satisfaction) AS avg_satisfaction,
            AVG(recommend) AS avg_recommend,
            COALESCE(SUM(CASE WHEN testimonial_permission LIKE 'Yes%' THEN 1 ELSE 0 END), 0) AS testimonial_yes,
            COALESCE(SUM(CASE WHEN logo_permission = 'Yes' THEN 1 ELSE 0 END), 0) AS logo_yes
            ${reviewed ? ", COALESCE(SUM(CASE WHEN reviewed_at IS NULL THEN 1 ELSE 0 END), 0) AS unreviewed" : ""}
       FROM feedback_responses`,
  ).first();
  const { results: recent } = await env.DB.prepare(
    `SELECT ${summaryColumns(reviewed).join(", ")} FROM feedback_responses ORDER BY created_at DESC LIMIT 5`,
  ).all();
  return json({
    reviewed_supported: reviewed,
    stats: {
      total: stats.total,
      avg_satisfaction: round1(stats.avg_satisfaction),
      avg_recommend: round1(stats.avg_recommend),
      testimonial_yes: stats.testimonial_yes,
      logo_yes: stats.logo_yes,
      unreviewed: reviewed ? stats.unreviewed : null,
    },
    recent,
  });
}

async function list(env) {
  await ensureSchema(env.DB);
  const reviewed = await reviewedSupported(env.DB);
  const { results } = await env.DB.prepare(
    `SELECT ${summaryColumns(reviewed).join(", ")} FROM feedback_responses ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`,
  ).all();
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM feedback_responses").first();
  return json({ reviewed_supported: reviewed, total: count.n, truncated: count.n > results.length, responses: results });
}

async function one(env, id) {
  await ensureSchema(env.DB);
  const reviewed = await reviewedSupported(env.DB);
  const row = await env.DB.prepare(`SELECT ${allColumns(reviewed).join(", ")} FROM feedback_responses WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  return json({ reviewed_supported: reviewed, response: row });
}

async function remove(env, id) {
  await ensureSchema(env.DB);
  const result = await env.DB.prepare("DELETE FROM feedback_responses WHERE id = ?").bind(id).run();
  if (!result.meta || result.meta.changes === 0) return json({ error: "not_found" }, 404);
  return json({ ok: true });
}

async function setReviewed(request, env, id) {
  await ensureSchema(env.DB);
  if (!(await reviewedSupported(env.DB))) return json({ error: "reviewed_unavailable" }, 409);
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || typeof body.reviewed !== "boolean") return json({ error: "validation_failed" }, 422);
  const stamp = body.reviewed ? new Date().toISOString() : null;
  const result = await env.DB.prepare("UPDATE feedback_responses SET reviewed_at = ? WHERE id = ?").bind(stamp, id).run();
  if (!result.meta || result.meta.changes === 0) return json({ error: "not_found" }, 404);
  return json({ ok: true, reviewed_at: stamp });
}

const csvResponse = (columns, rows, filename) => {
  const lines = [columns.join(",")].concat(rows.map((r) => columns.map((c) => csvCell(r[c])).join(",")));
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
    },
  });
};

async function exportAll(env) {
  await ensureSchema(env.DB);
  const reviewed = await reviewedSupported(env.DB);
  const columns = allColumns(reviewed);
  const { results } = await env.DB.prepare(`SELECT ${columns.join(", ")} FROM feedback_responses ORDER BY created_at DESC`).all();
  const day = new Date().toISOString().slice(0, 10);
  return csvResponse(columns, results, `framework-client-feedback-${day}.csv`);
}

async function exportOne(env, id, format) {
  await ensureSchema(env.DB);
  const reviewed = await reviewedSupported(env.DB);
  const columns = allColumns(reviewed);
  const row = await env.DB.prepare(`SELECT ${columns.join(", ")} FROM feedback_responses WHERE id = ?`).bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  if (format === "json") return json({ response: row });
  return csvResponse(columns, [row], `framework-feedback-${id.slice(0, 8)}.csv`);
}

/* ---- Routing ---- */

/** State-changing requests must come from our own pages: same Origin plus a custom header (CSRF defence). */
function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return request.headers.get("X-Framework-Admin") === "1";
}

/**
 * @param path pathname with the "/api/admin" prefix removed, e.g. "/feedback/export"
 * @returns Response, or null if the path is not a feedback route
 */
export async function handleFeedbackApi(request, env, principal, path) {
  const method = request.method;

  if (path === "/me") return method === "GET" ? me(principal) : json({ error: "method_not_allowed" }, 405, { Allow: "GET" });

  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const url = new URL(request.url);

  try {
    if (path === "/overview") return method === "GET" ? await overview(env) : json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    if (path === "/feedback") return method === "GET" ? await list(env) : json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
    if (path === "/feedback/export") return method === "GET" ? await exportAll(env) : json({ error: "method_not_allowed" }, 405, { Allow: "GET" });

    const m = path.match(/^\/feedback\/([^/]+)(\/export)?$/);
    if (!m) return null;
    const id = m[1];
    if (!ID_PATTERN.test(id)) return json({ error: "not_found" }, 404);

    if (m[2]) {
      if (method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
      return await exportOne(env, id, url.searchParams.get("format") === "json" ? "json" : "csv");
    }
    if (method === "GET") return await one(env, id);
    if (method === "DELETE" || method === "PATCH") {
      if (!sameOriginWrite(request)) return json({ error: "forbidden" }, 403);
      return method === "DELETE" ? await remove(env, id) : await setReviewed(request, env, id);
    }
    return json({ error: "method_not_allowed" }, 405, { Allow: "GET, PATCH, DELETE" });
  } catch (err) {
    console.error("admin feedback api error:", err && err.message);
    return json({ error: "database_unavailable" }, 503);
  }
}
