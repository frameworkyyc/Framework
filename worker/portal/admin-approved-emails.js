/**
 * Framework Admin: Approved Emails API. The list of addresses that may be invited to the portal and may receive Client Services emails. Behind Cloudflare Access and
 * ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header. Every change is audited
 * (activity_log, internal, naming the admin). The list is used together with the Cloudflare secret PORTAL_INVITE_ALLOWLIST: an address is approved when it is in
 * either, so nothing approved before this existed stops working. The secret itself is never written from here.
 *
 *   GET  /approved-emails           { available, emails: [{email, note, addedBy, addedAt}], setting: {addresses: [{email, inList}]}, capabilities }
 *   POST /approved-emails           { email, note? }   approve an address (idempotent)
 *   POST /approved-emails/remove    { email }          stop approving an address (idempotent); never ends anyone's existing access. { stillApprovedBySetting: true } when the
 *                                                      Cloudflare secret also lists it (it must then be removed there too)
 *   POST /approved-emails/import    {}                 copy every address of the Cloudflare secret into this list, so the secret can later be deleted
 * The address is sent in the body, never in the URL.
 */
import { addApproved, removeApproved, listApproved, MAX_APPROVED } from "./repo/approved-emails.js";
import { parseAllowlist, ALLOWLIST_SETTING } from "./invite-recipients.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const STATUS = { invalid_email: 422, invalid_note: 422, list_full: 409, invalid_actor: 500 };
const fromFailure = (r) => (STATUS[r.error] && STATUS[r.error] !== 500 ? err(STATUS[r.error], r.error, r.message || "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

export async function handleApprovedEmailsApi(request, env, principal, path, deps = {}) {
  const m = path.match(/^\/approved-emails(?:\/(remove|import))?$/);
  if (!m) return null;
  const kind = m[1] || "root";
  const method = request.method;
  const wanted = kind === "root" && method === "GET" ? "GET" : "POST";
  if (method !== wanted || (method !== "GET" && method !== "POST")) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: kind === "root" ? "GET, POST" : "POST" });
  if (method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const db = env.PORTAL_DB;
  const now = deps.now || new Date();
  const actor = principal && principal.email;
  try {
    let body = {};
    if (method === "POST") {
      const read = await readJson(request, kind === "root" ? ["email", "note"] : kind === "remove" ? ["email"] : []);
      if (read.response) return read.response;
      body = read.body;
    }
    if (method === "POST" && kind !== "import" && typeof body.email !== "string") return err(422, "invalid_email", "Enter a plain, valid email address.");

    if (method === "POST" && kind === "root") {
      const r = await addApproved(db, body.email, actor, { note: body.note, now });
      return r.ok ? json({ email: r.email, changed: r.changed }, r.changed ? 201 : 200) : fromFailure(r);
    }
    if (method === "POST" && kind === "remove") {
      const r = await removeApproved(db, body.email, actor, { now });
      // An address that is ALSO in the Cloudflare secret stays approved until it is removed there: say so, so a removal is never mistaken for a revocation.
      return r.ok ? json({ email: r.email, changed: r.changed, stillApprovedBySetting: parseAllowlist(env[ALLOWLIST_SETTING]).has(r.email) }) : fromFailure(r);
    }
    if (method === "POST" && kind === "import") {
      let added = 0;
      for (const email of parseAllowlist(env[ALLOWLIST_SETTING])) {
        const r = await addApproved(db, email, actor, { source: "setting", now });
        if (!r.ok) return fromFailure(r);
        if (r.changed) added++;
      }
      return json({ added });
    }

    // GET
    const list = await listApproved(db);
    const stored = new Set(list.rows.map((r) => r.email));
    const setting = [...parseAllowlist(env[ALLOWLIST_SETTING])].sort().map((email) => ({ email, inList: stored.has(email) }));
    return json({
      available: list.available,
      emails: list.rows.map((r) => ({ email: r.email, note: r.note, addedBy: r.added_by, addedAt: r.added_at })),
      setting: { addresses: setting },
      limit: MAX_APPROVED,
      capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" },
    });
  } catch (e) {
    console.error("admin approved emails api error:", e && e.name); // never the message
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
