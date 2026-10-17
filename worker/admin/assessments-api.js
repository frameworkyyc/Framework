/**
 * Framework Admin — assessment requests API (GET/POST /api/admin/assessments…).
 * Only ever called after authenticateAdmin() succeeded (see router.js).
 *
 *   GET  /assessments            requests (newest first), counts, and whether this deployment can send email
 *   GET  /assessments/summary    { total, unsent } for the Overview banner
 *   POST /assessments/resend     re-send notifications for requests that never got one ({ id } for just one)
 *   POST /assessments/test-email send a test message to the notification address and report the provider's answer
 */

import { json } from "../shared.js";
import { ensureAssessmentSchema, emailHealth, resendUnsent, sendTestEmail } from "../assessment.js";

const LIST_LIMIT = 200;
const ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

/** State-changing requests must come from our own pages: same Origin plus a custom header (CSRF defence). */
function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return request.headers.get("X-Framework-Admin") === "1";
}

async function counts(db) {
  const row = await db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN notify_status = 'sent' THEN 1 ELSE 0 END), 0) AS sent FROM assessment_requests").first();
  return { total: row.total, sent: row.sent, unsent: row.total - row.sent };
}

/**
 * @param path pathname with the "/api/admin" prefix removed
 * @returns Response, or null if the path is not an assessments route
 */
export async function handleAssessmentsApi(request, env, principal, path, deps = {}) {
  if (path !== "/assessments" && !path.startsWith("/assessments/")) return null;
  if (!env.DB) return json({ error: "database_unavailable" }, 503);
  const method = request.method;
  const notAllowed = (allow) => json({ error: "method_not_allowed" }, 405, { Allow: allow });

  try {
    await ensureAssessmentSchema(env.DB);

    if (path === "/assessments") {
      if (method !== "GET") return notAllowed("GET");
      const { results } = await env.DB.prepare(`SELECT * FROM assessment_requests ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`).all();
      const c = await counts(env.DB);
      // ip_hash is internal bookkeeping for the rate limiter; it is not shown.
      const requests = results.map(({ ip_hash, ...rest }) => rest);
      return json({ email: emailHealth(env), ...c, truncated: c.total > requests.length, requests });
    }

    if (path === "/assessments/summary") {
      if (method !== "GET") return notAllowed("GET");
      const c = await counts(env.DB);
      return json({ total: c.total, unsent: c.unsent });
    }

    if (path === "/assessments/resend") {
      if (method !== "POST") return notAllowed("POST");
      if (!sameOriginWrite(request)) return json({ error: "forbidden" }, 403);
      let body = {};
      try { body = await request.json(); } catch { /* an empty body means "all unsent" */ }
      const id = body && typeof body.id === "string" ? body.id : null;
      if (id && !ID_PATTERN.test(id)) return json({ error: "not_found" }, 404);
      return json(await resendUnsent(env, { id }, deps));
    }

    if (path === "/assessments/test-email") {
      if (method !== "POST") return notAllowed("POST");
      if (!sameOriginWrite(request)) return json({ error: "forbidden" }, 403);
      return json(await sendTestEmail(env, deps));
    }
  } catch (err) {
    console.error("admin assessments api error:", err && err.message);
    return json({ error: "database_unavailable" }, 503);
  }
  return null;
}
