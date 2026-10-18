/**
 * Framework Admin — assessment requests API (GET/POST /api/admin/assessments…).
 * Only ever called after authenticateAdmin() succeeded (see router.js).
 *
 *   GET  /assessments            requests (newest first), counts, and whether this deployment can send email.
 *                                ?q=<text> searches the WHOLE table (business name, contact name, email; case-insensitive)
 *   GET  /assessments/summary    { total, unsent } for the Overview banner
 *   POST /assessments/resend     re-send notifications for requests that never got one ({ id } for just one)
 *   POST /assessments/test-email send a test message to the notification address and report the provider's answer
 *   DELETE /assessments/<id>     permanently delete ONE request (no bulk delete exists)
 *   PATCH  /assessments/<id>     { last_interaction_at: "YYYY-MM-DD" | null }: record (or clear) the last meaningful interaction
 */

import { json } from "../shared.js";
import { ensureAssessmentSchema, emailHealth, resendUnsent, sendTestEmail, turnstileState } from "../assessment.js";

const LIST_LIMIT = 200;
const MAX_QUERY = 100;
const EARLIEST = "2020-01-01";
const ID_PATTERN = /^[A-Za-z0-9-]{16,64}$/;

/** Search text: trimmed, single-spaced, control characters removed, capped. */
export const cleanQuery = (raw) => String(raw || "").replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_QUERY);

const SEARCH_WHERE = "(lower(business_name) LIKE ? ESCAPE '\\' OR lower(contact_name) LIKE ? ESCAPE '\\' OR lower(email) LIKE ? ESCAPE '\\')";
/** LIKE pattern for "contains q", with the LIKE wildcards in q treated as plain characters. */
const likePattern = (q) => "%" + q.toLowerCase().replace(/[\\%_]/g, (m) => "\\" + m) + "%";

const ymd = (date) => date.toISOString().slice(0, 10);

/**
 * Validate the "last interaction" date an admin submitted. Returns { ok: true, value } (value is YYYY-MM-DD, or null to
 * clear it) or { ok: false, message }. Rules: a real calendar date; not in the future; not before 2020; not earlier
 * than the day before the request was submitted (one day of slack for the Calgary / UTC difference).
 */
export function validateInteractionDate(input, createdAt, now = new Date()) {
  if (input === null) return { ok: true, value: null };
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input)) return { ok: false, message: "Enter a date as YYYY-MM-DD." };
  const parsed = new Date(input + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime()) || ymd(parsed) !== input) return { ok: false, message: "That is not a real calendar date." };
  if (input > ymd(now)) return { ok: false, message: "The last interaction can’t be in the future." };
  const created = new Date(createdAt);
  const floor = Number.isNaN(created.getTime()) ? EARLIEST : ymd(new Date(created.getTime() - 24 * 3600e3));
  if (input < EARLIEST || input < floor) return { ok: false, message: "That date is before the request was submitted." };
  return { ok: true, value: input };
}

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
      const q = cleanQuery(new URL(request.url).searchParams.get("q"));
      let results;
      let matched;
      if (q) {
        // Searches the whole table (not just the newest page). Parameterized; wildcards in the text are literal.
        const pattern = likePattern(q);
        ({ results } = await env.DB.prepare(`SELECT * FROM assessment_requests WHERE ${SEARCH_WHERE} ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`).bind(pattern, pattern, pattern).all());
        matched = (await env.DB.prepare(`SELECT COUNT(*) AS n FROM assessment_requests WHERE ${SEARCH_WHERE}`).bind(pattern, pattern, pattern).first()).n;
      } else {
        ({ results } = await env.DB.prepare(`SELECT * FROM assessment_requests ORDER BY created_at DESC LIMIT ${LIST_LIMIT}`).all());
      }
      const c = await counts(env.DB);
      if (matched === undefined) matched = c.total;
      // ip_hash is internal bookkeeping for the rate limiter; it is not shown.
      const requests = results.map(({ ip_hash, ...rest }) => rest);
      return json({ email: emailHealth(env), spam_check: turnstileState(env), ...c, query: q, matched, truncated: matched > requests.length, requests });
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

    // DELETE /assessments/<id>: one record, by exact id. The statement is parameterized and keyed on the primary key,
    // so it cannot touch any other row. assessment_requests has no related tables, so there is nothing else to clean up.
    const m = path.match(/^\/assessments\/([^/]+)$/);
    if (m) {
      if (method !== "DELETE" && method !== "PATCH") return notAllowed("DELETE, PATCH");
      if (!sameOriginWrite(request)) return json({ error: "forbidden" }, 403);
      let id = "";
      try { id = decodeURIComponent(m[1]); } catch { /* malformed escape: falls through to the pattern check */ }
      if (!ID_PATTERN.test(id)) return json({ error: "invalid_id" }, 400);

      if (method === "PATCH") {
        let body;
        try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
        if (!body || typeof body !== "object" || Array.isArray(body) || !("last_interaction_at" in body)) return json({ error: "validation_failed", message: "Nothing to update." }, 422);
        const row = await env.DB.prepare("SELECT created_at FROM assessment_requests WHERE id = ?").bind(id).first();
        if (!row) return json({ error: "not_found" }, 404);
        const checked = validateInteractionDate(body.last_interaction_at, row.created_at, deps.now || new Date());
        if (!checked.ok) return json({ error: "validation_failed", message: checked.message }, 422);
        // Only this one column changes (never created_at), for this one row.
        await env.DB.prepare("UPDATE assessment_requests SET last_interaction_at = ? WHERE id = ?").bind(checked.value, id).run();
        return json({ ok: true, last_interaction_at: checked.value });
      }

      const result = await env.DB.prepare("DELETE FROM assessment_requests WHERE id = ?").bind(id).run();
      if (!result.meta || result.meta.changes === 0) return json({ error: "not_found" }, 404);
      const c = await counts(env.DB);
      return json({ ok: true, total: c.total, sent: c.sent, unsent: c.unsent });
    }
  } catch (err) {
    console.error("admin assessments api error:", err && err.message);
    return json({ error: "database_unavailable" }, 503);
  }
  return null;
}
