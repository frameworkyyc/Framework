/**
 * Framework Admin: Portal Feedback (read-only). Messages that signed-in portal clients sent from the portal, newest first, with the organization,
 * type, date and the section they were about. Separate from the website project "Client Feedback" survey.
 *
 * Authorization: reached only from worker/admin/router.js after authenticateAdmin() (verified Cloudflare Access token AND an email on ADMIN_EMAILS).
 * GET only, through readOnlyDb(). Messages are client content: never logged, never cached.
 */
import { readOnlyDb } from "./admin-clients.js";
import { FEEDBACK_KINDS, pageLabel } from "./repo/portal-feedback.js";

const LIMIT = 500;
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const KIND_LABEL = Object.fromEntries(FEEDBACK_KINDS);

export async function handlePortalFeedbackApi(request, env, principal, path) {
  if (path !== "/portal-feedback") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405, { Allow: "GET" });
  if (!env.PORTAL_DB) return json({ error: "portal_unavailable" }, 503);
  const rdb = readOnlyDb(env.PORTAL_DB);
  try {
    let rows;
    try {
      rows = (await rdb.prepare(
        `SELECT f.id, f.kind, f.message, f.page, f.created_at, o.id AS organization_id, o.name AS organization_name
           FROM portal_feedback f JOIN organizations o ON o.id = f.organization_id ORDER BY f.created_at DESC, f.id LIMIT ${LIMIT + 1}`,
      ).all()).results;
    } catch {
      return json({ available: false, items: [], truncated: false }); // the feedback table does not exist on this deployment yet
    }
    const items = rows.slice(0, LIMIT).map((r) => ({
      id: r.id, kind: r.kind, kind_label: KIND_LABEL[r.kind] || r.kind, message: r.message, page: r.page, page_label: r.page ? pageLabel(r.page) || null : null,
      created_at: r.created_at, organization: { id: r.organization_id, name: r.organization_name },
    }));
    return json({ available: true, items, truncated: rows.length > LIMIT });
  } catch (err) {
    console.error("admin portal feedback api error:", err && err.name);
    return json({ error: "portal_unavailable" }, 503);
  }
}
