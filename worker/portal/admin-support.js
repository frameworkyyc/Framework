/**
 * Framework Admin: Support & Change Requests API. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a
 * same-origin request with the X-Framework-Admin header. Staff review what clients send, reply (visible to the client and queued as an email), keep private notes
 * (never shown to or emailed to the client) and move a request through its statuses. "Quote sent" and "Approved" exist only for changes that may be billable, and
 * Approved is Framework's record that the client agreed a quote: nothing here, and nothing a client does, authorizes work by itself.
 *
 *   GET  /clients/:org/support                          the organization's requests and a summary
 *   GET  /clients/:org/support/:id                      one request with its WHOLE conversation (private notes marked) and attachments
 *   POST /clients/:org/support/:id/seen                 marks the request as seen by staff
 *   POST /clients/:org/support/:id/reply                { body, internal? }   a reply, or a private note
 *   POST /clients/:org/support/:id/attach               multipart: file + meta { messageId }   one file on a staff message of this request
 *   POST /clients/:org/support/:id/status               { status, note? }
 *   GET  /clients/:org/support/:id/files/:file/download an attachment as a download (recorded)
 * Nothing deletes a message, an attachment or a request. A database without migration 0007 answers { available: false }.
 */
import { getOrganizationById } from "./repo/orgs.js";
import { UUID } from "./repo/common.js";
import * as sup from "./repo/support.js";
import * as files from "./support-files.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const STATUS = {
  not_found: 404, forbidden: 403, conflict: 409, not_billable: 409,
  invalid_status: 422, invalid_message: 422, message_required: 422, invalid_actor: 422,
  invalid_name: 422, type_not_allowed: 415, content_mismatch: 422, active_content: 422, pdf_encrypted: 422, empty_file: 422, no_file: 400, file_too_large: 413,
  archive_unsafe_entry: 422, archive_encrypted: 422, archive_unsupported: 422, archive_entries: 422, archive_too_large: 422, image_dimensions: 422, too_many_attachments: 409,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

async function tablesPresent(db) {
  try { await db.prepare("SELECT 1 FROM support_requests LIMIT 1").first(); return true; } catch { return false; }
}
const publicRequest = (r) => ({ id: r.id, category: r.category, scope: r.scope, title: r.title, status: r.status, createdAt: r.createdAt, statusChangedAt: r.statusChangedAt, lastMessageAt: r.lastMessageAt, lastMessageBy: r.lastMessageBy, closed: r.closed, needsLook: r.newForAdmin });
const publicThread = (t) => ({ request: publicRequest(t.request), messages: t.messages, attachments: t.attachments });

/** @param path pathname with "/api/admin" removed. @returns Response, or null when it is not a Support route. */
export async function handleSupportApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "support" && seg.length >= 3)) return null;
  const rest = seg.slice(3);
  let route = null;
  if (rest.length === 0) route = { kind: "list", method: "GET" };
  else if (rest.length === 1) route = { kind: "thread", method: "GET", target: rest[0] };
  else if (rest.length === 2 && ["seen", "reply", "attach", "status"].includes(rest[1])) route = { kind: rest[1], method: "POST", target: rest[0] };
  else if (rest.length === 4 && rest[1] === "files" && rest[3] === "download") route = { kind: "download", method: "GET", target: rest[0], file: rest[2] };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(seg[1])) return err(404, "not_found", "No such organization.");
  if ((route.target !== undefined && !UUID.test(route.target)) || (route.file !== undefined && !UUID.test(route.file))) return err(404, "not_found", "Not found.");
  if (route.method !== "GET") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");

  const now = deps.now || new Date();
  const actor = principal && principal.email;
  try {
    const db = env.PORTAL_DB;
    if (!(await tablesPresent(db))) return json({ available: false });
    const org = await getOrganizationById(db, seg[1]);
    if (!org) return err(404, "not_found", "No such organization.");
    const svc = { db, bucket: env.PORTAL_FILES, env, now };
    if (["attach", "download"].includes(route.kind) && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");

    if (route.kind === "list") {
      return json({ available: true, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) }, organization: { id: org.id, name: org.name }, requests: (await sup.listRequestsAdmin(db, org.id)).map(publicRequest), summary: await sup.adminSupportSummary(db, org.id) });
    }
    if (route.kind === "thread") {
      const t = await sup.getAdminThread(db, org.id, route.target);
      return t ? json({ available: true, ...publicThread(t) }) : err(404, "not_found", "No such request.");
    }
    if (route.kind === "seen") {
      if (!(await sup.getRequest(db, org.id, route.target))) return err(404, "not_found", "No such request.");
      await sup.markAdminSeen(db, org.id, route.target, { now });
      return json({ ok: true });
    }
    if (route.kind === "reply") {
      const read = await readJson(request, ["body", "internal"]);
      if (read.response) return read.response;
      if (read.body.internal !== undefined && typeof read.body.internal !== "boolean") return err(422, "invalid_message", "The change was not made.");
      if (!(await sup.getRequest(db, org.id, route.target))) return err(404, "not_found", "No such request.");
      const r = await sup.addStaffMessage(db, org.id, route.target, read.body.body, actor, { internal: read.body.internal === true, now });
      return r.ok ? json({ ok: true, messageId: r.messageId }, 201) : fromFailure(r);
    }
    if (route.kind === "attach") {
      const read = await readUpload(request, { withMeta: true });
      if (read.response) return read.response;
      if (typeof read.meta.messageId !== "string" || !UUID.test(read.meta.messageId) || Object.keys(read.meta).some((k) => k !== "messageId")) return err(422, "invalid_message", "The change was not made.");
      const r = await files.adminAttach(svc, { organizationId: org.id, requestId: route.target, messageId: read.meta.messageId, file: read.file });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "status") {
      const read = await readJson(request, ["status", "note"]);
      if (read.response) return read.response;
      const r = await sup.setRequestStatus(db, org.id, route.target, read.body.status, actor, { note: read.body.note ?? null, now });
      return r.ok ? json({ ok: true, changed: r.changed }) : fromFailure(r);
    }
    if (route.kind === "download") {
      const r = await files.adminDownloadAttachment(svc, { organizationId: org.id, requestId: route.target, attachmentId: route.file, actor });
      return r.ok ? r.response : fromFailure(r);
    }
    return null;
  } catch (e) {
    console.error("admin support api error:", e && e.name); // never the message: it can carry SQL text, values or storage details
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
