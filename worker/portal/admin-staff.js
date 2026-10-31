/**
 * Framework Admin: who holds Master Client Access (the right to open any client's portal). Behind Cloudflare Access and ADMIN_EMAILS; writes also need PORTAL_ADMIN_WRITES and a
 * same-origin request with the X-Framework-Admin header. Being an Admin Portal user grants NOTHING here: each person is granted by email, and the grant binds to their portal account
 * at their first verified sign-in. The portal itself never exposes this.
 *
 *   GET  /staff-access   { available, staff: [{email, role, bound, boundAt, grantedBy, grantedAt, revoked, revokedAt}], capabilities: {writes} }
 *   POST /staff-access   { action: "grant" | "revoke", email }
 */
import { listStaff, grantStaff, revokeStaff } from "./repo/staff.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { invalid_email: 422, invalid_actor: 422, not_found: 404 };

export async function handleStaffApi(request, env, principal, path, deps = {}) {
  if (path !== "/staff-access") return null;
  const method = request.method;
  if (method !== "GET" && method !== "POST") return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: "GET, POST" });
  if (method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  try {
    if (method === "POST") {
      const read = await readJson(request, ["action", "email"]);
      if (read.response) return read.response;
      const { action, email } = read.body;
      if (action !== "grant" && action !== "revoke") return err(422, "invalid_action", "Choose grant or revoke.");
      const now = deps.now || new Date();
      const actor = principal && principal.email;
      const r = action === "grant" ? await grantStaff(env.PORTAL_DB, email, actor, { now }) : await revokeStaff(env.PORTAL_DB, email, actor, { now });
      if (!r.ok) return STATUS[r.error] ? json({ error: r.error, message: "The change was not made." }, STATUS[r.error]) : err(500, "server_error", "Something went wrong. Nothing was changed.");
    }
    const list = await listStaff(env.PORTAL_DB);
    return json({ available: list.available, staff: list.staff, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" } });
  } catch (e) {
    console.error("admin staff access api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
