/**
 * Framework Admin: the request engine API. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; writes also need PORTAL_ADMIN_WRITES and a same-origin request with the
 * X-Framework-Admin header. Staff see every request of every client, reply (visible to the client and queued as an email), keep private notes, send quotes, record an agreement
 * made outside the portal, upload proofs and final files, grant extra revision rounds, move a request along the lifecycle, and set each service's defaults.
 *
 *   GET  /requests?scope=attention|open|closed|all        requests of EVERY client, each with its organization and why it needs attention
 *   GET  /requests/attention                              counts for the Admin navigation
 *   GET  /requests/settings                               every service with its effective settings (revisions included, price mode, turnaround)
 *   POST /requests/settings                               { type_key, enabled?, revisions_included?, pricing_mode?, price?, turnaround_note? }
 *   GET  /clients/:org/requests                           one client's requests
 *   GET  /clients/:org/requests/:id                       the whole request: timeline (private notes marked), files, quotes, the answers, allowed moves
 *   POST /clients/:org/requests/:id/seen                  marks it seen by staff
 *   POST /clients/:org/requests/:id/reply                 { body, internal? }
 *   POST /clients/:org/requests/:id/status                { status, note? }          every move except "quoted" and "approved"
 *   POST /clients/:org/requests/:id/quotes                { title, scope, amount, valid_until? }   sends a quote (amount typed in dollars, stored as cents, CAD)
 *   POST /clients/:org/requests/:id/quotes/:q/withdraw
 *   POST /clients/:org/requests/:id/approve               { quote_id?, note? }       RECORDS an agreement (Framework's record; the portal's own acceptance is a separate closed gate)
 *   POST /clients/:org/requests/:id/revisions             { count }                  extra revision rounds agreed with the client
 *   POST /clients/:org/requests/:id/files                 multipart: file + meta { role: proof | final | attachment, note? }
 *   POST /clients/:org/requests/:id/files/:f/preview      multipart: file (a picture shown for a PDF proof)
 *   GET  /clients/:org/requests/:id/files/:f/download     the file as a download, or with ?view=1 a proof's picture inline (recorded)
 * Nothing deletes a request, an entry, a file or a quote. A database without migration 0020 answers { available: false }.
 */
import { getOrganizationById } from "./repo/orgs.js";
import { UUID } from "./repo/common.js";
import { parseAmountToCents, formatMoney } from "./repo/invoices.js";
import * as repo from "./requests/repo.js";
import * as svc from "./requests/service.js";
import { TYPES, KINDS, getType, effectiveSettings, describeDetails, typeLabel } from "./requests/registry.js";
import { staffMoves, STATUS_LABEL, staffAttentionReason } from "./requests/workflow.js";
import { quoteAcceptanceOpen } from "./requests/quote-gate.js";
import { dispatchNotifications, notificationTotals } from "./service-notifications.js";
import { emailConfig } from "../assessment.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const STATUS = {
  not_found: 404, forbidden: 403, conflict: 409, closed: 409, not_permitted_move: 409, use_quote_or_approval: 422, no_proof: 409, quote_required: 409, quote_not_open: 409,
  invalid_status: 422, invalid_message: 422, message_required: 422, invalid_actor: 422, invalid_title: 422, invalid_scope: 422, scope_required: 422, invalid_amount: 422, invalid_date: 422, invalid_count: 422,
  invalid_role: 422, invalid_type: 422, invalid_revisions: 422, invalid_pricing: 422, invalid_price: 422, invalid_turnaround: 422, invalid_settings: 422, not_allowed: 409, too_many_files: 409,
  type_not_allowed: 415, content_mismatch: 422, active_content: 422, pdf_encrypted: 422, empty_file: 422, no_file: 400, file_too_large: 413, invalid_name: 422,
  archive_unsafe_entry: 422, archive_encrypted: 422, archive_unsupported: 422, archive_entries: 422, archive_too_large: 422, image_dimensions: 422,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));

async function tablesPresent(db) { try { await db.prepare("SELECT 1 FROM requests LIMIT 1").first(); return true; } catch { return false; } }

const publicRequest = (r) => ({ id: r.id, kind: r.kind, kindLabel: KINDS[r.kind] ? KINDS[r.kind].label : r.kind, typeKey: r.typeKey, typeLabel: r.typeLabel, title: r.title, status: r.status, statusLabel: STATUS_LABEL[r.status], createdAt: r.createdAt, statusChangedAt: r.statusChangedAt, lastMessageAt: r.lastMessageAt, lastMessageBy: r.lastMessageBy, closed: r.closed, needsLook: r.newForAdmin, neededBy: r.neededBy, revisions: { included: r.revisionsIncluded, paid: r.revisionsPaid, used: r.revisionsUsed, left: r.revisionsLeft } });
const publicThread = (t, env) => ({
  request: { ...publicRequest(t.request), details: describeDetails(getType(t.request.typeKey), t.request.details), brand: t.request.brand, moves: staffMoves(t.request.status) },
  events: t.events, files: t.files, quotes: t.quotes.map((q) => ({ ...q, amountLabel: formatMoney(q.amountCents) })),
  quoteAcceptanceOpen: quoteAcceptanceOpen(env),
});
const SCOPES = ["attention", "open", "closed", "all"];
const settingsRows = async (db) => {
  const saved = await repo.listTypeSettings(db).catch(() => new Map());
  return TYPES.filter((t) => !t.hidden).map((t) => { const e = effectiveSettings(t, saved.get(t.key)); return { typeKey: t.key, kind: t.kind, kindLabel: KINDS[t.kind].label, label: t.label, proofs: t.proofs, enabled: e.enabled, revisionsIncluded: e.revisionsIncluded, pricingMode: e.pricing.mode, price: e.pricing.fixedPriceCents == null ? "" : (e.pricing.fixedPriceCents / 100).toFixed(2), turnaroundNote: e.turnaroundNote, customised: saved.has(t.key) }; });
};

async function globalApi(request, env, kind, deps, principal) {
  const method = kind === "save-settings" ? "POST" : "GET";
  if (request.method !== method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: method });
  if (method === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const db = env.PORTAL_DB;
  try {
    if (!(await tablesPresent(db))) return json({ available: false });
    const now = deps.now || new Date();
    if (kind === "list" || kind === "attention") await dispatchNotifications(env, { ...deps, now });
    if (kind === "list") {
      const scope = new URL(request.url).searchParams.get("scope");
      const use = SCOPES.includes(scope) ? scope : "attention";
      const list = await repo.listRequestsAllAdmin(db, { scope: use });
      return json({ available: true, scope: use, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" }, requests: list.map((r) => ({ ...publicRequest(r), organization: { id: r.organizationId, name: r.orgName }, reason: r.reason })), totals: await repo.adminTotals(db) });
    }
    if (kind === "attention") return json({ available: true, requests: await repo.adminTotals(db), emails: { ...(await notificationTotals(db)), configured: emailConfig(env).ok } });
    if (kind === "settings") return json({ available: true, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1" }, services: await settingsRows(db), acceptanceOpen: quoteAcceptanceOpen(env) });
    // save-settings
    const read = await readJson(request, ["type_key", "enabled", "revisions_included", "pricing_mode", "price", "turnaround_note"]);
    if (read.response) return read.response;
    const b = read.body, type = getType(b.type_key);
    if (!type) return err(422, "invalid_type", "Unknown service.");
    const saved = (await repo.listTypeSettings(db)).get(type.key), cur = effectiveSettings(type, saved);
    const pricingMode = b.pricing_mode === undefined ? cur.pricing.mode : b.pricing_mode;
    let fixed = cur.pricing.fixedPriceCents;
    if (b.price !== undefined) { fixed = b.price === "" || b.price === null ? null : parseAmountToCents(String(b.price)); if (b.price !== "" && b.price !== null && fixed === null) return err(422, "invalid_price", "Enter the price in dollars, for example 150.00."); }
    const rev = b.revisions_included === undefined ? (saved ? saved.revisions_included : null) : b.revisions_included === null || b.revisions_included === "" ? null : Number(b.revisions_included);
    const r = await repo.saveTypeSettings(db, type.key, { enabled: b.enabled === undefined ? cur.enabled : b.enabled === true, revisionsIncluded: rev, pricingMode, fixedPriceCents: pricingMode === "fixed" ? fixed : null, turnaroundNote: b.turnaround_note === undefined ? cur.turnaroundNote || null : b.turnaround_note }, principal && principal.email, { now });
    return r.ok ? json({ ok: true }) : fromFailure(r);
  } catch (e) {
    console.error("admin requests api error:", e && e.name);
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}

/** @param path pathname with "/api/admin" removed. @returns Response, or null when it is not a Requests route. */
export async function handleRequestsApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (seg[0] === "requests" && seg.length === 1) return globalApi(request, env, "list", deps, principal);
  if (seg[0] === "requests" && seg.length === 2 && seg[1] === "attention") return globalApi(request, env, "attention", deps, principal);
  if (seg[0] === "requests" && seg.length === 2 && seg[1] === "settings") return globalApi(request, env, request.method === "POST" ? "save-settings" : "settings", deps, principal);
  if (!(seg[0] === "clients" && seg[2] === "requests")) return null;
  const rest = seg.slice(3);
  let route = null;
  if (rest.length === 0) route = { kind: "list", method: "GET" };
  else if (rest.length === 1) route = { kind: "thread", method: "GET", target: rest[0] };
  else if (rest.length === 2 && ["seen", "reply", "status", "quotes", "approve", "revisions", "files"].includes(rest[1])) route = { kind: rest[1], method: "POST", target: rest[0] };
  else if (rest.length === 4 && rest[1] === "quotes" && rest[3] === "withdraw") route = { kind: "withdraw", method: "POST", target: rest[0], sub: rest[2] };
  else if (rest.length === 4 && rest[1] === "files" && rest[3] === "preview") route = { kind: "preview", method: "POST", target: rest[0], sub: rest[2] };
  else if (rest.length === 4 && rest[1] === "files" && rest[3] === "download") route = { kind: "download", method: "GET", target: rest[0], sub: rest[2] };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(seg[1])) return err(404, "not_found", "No such organization.");
  if ((route.target !== undefined && !UUID.test(route.target)) || (route.sub !== undefined && !UUID.test(route.sub))) return err(404, "not_found", "Not found.");
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
    const sv = { db, bucket: env.PORTAL_FILES, env, now };
    if (["files", "preview", "download"].includes(route.kind) && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");
    const exists = async () => Boolean(await repo.getRequest(db, org.id, route.target));

    if (route.kind === "list") {
      const list = await repo.listRequestsAdmin(db, org.id);
      return json({ available: true, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) }, organization: { id: org.id, name: org.name }, requests: list.map((r) => ({ ...publicRequest(r), reason: r.reason })) });
    }
    if (route.kind === "thread") {
      const t = await repo.getAdminThread(db, org.id, route.target);
      return t ? json({ available: true, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) }, organization: { id: org.id, name: org.name }, ...publicThread(t, env) }) : err(404, "not_found", "No such request.");
    }
    if (route.kind === "seen") { if (!(await exists())) return err(404, "not_found", "No such request."); await repo.markAdminSeen(db, org.id, route.target, { now }); return json({ ok: true }); }
    if (route.kind === "reply") {
      const read = await readJson(request, ["body", "internal"]);
      if (read.response) return read.response;
      if (read.body.internal !== undefined && typeof read.body.internal !== "boolean") return err(422, "invalid_message", "The change was not made.");
      if (!(await exists())) return err(404, "not_found", "No such request.");
      const r = await repo.addStaffMessage(db, org.id, route.target, read.body.body, actor, { internal: read.body.internal === true, now });
      if (r.ok && read.body.internal !== true) await dispatchNotifications(env, { ...deps, now });
      return r.ok ? json({ ok: true, eventId: r.eventId }, 201) : fromFailure(r);
    }
    if (route.kind === "status") {
      const read = await readJson(request, ["status", "note"]);
      if (read.response) return read.response;
      const r = await repo.setStatus(db, org.id, route.target, read.body.status, actor, { note: read.body.note ?? "", now });
      if (r.ok) await dispatchNotifications(env, { ...deps, now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "quotes") {
      const read = await readJson(request, ["title", "scope", "amount", "valid_until"]);
      if (read.response) return read.response;
      const cents = parseAmountToCents(String(read.body.amount ?? ""));
      if (cents === null) return err(422, "invalid_amount", "Enter the amount in dollars, for example 180.00.");
      const r = await repo.createQuote(db, org.id, route.target, { title: read.body.title, scope: read.body.scope, amountCents: cents, validUntil: read.body.valid_until || null }, actor, { now });
      if (r.ok) await dispatchNotifications(env, { ...deps, now });
      return r.ok ? json({ ok: true, id: r.id }, 201) : fromFailure(r);
    }
    if (route.kind === "withdraw") { const r = await repo.withdrawQuote(db, org.id, route.target, route.sub, actor, { now }); return r.ok ? json({ ok: true }) : fromFailure(r); }
    if (route.kind === "approve") {
      const read = await readJson(request, ["quote_id", "note"]);
      if (read.response) return read.response;
      if (read.body.quote_id !== undefined && read.body.quote_id !== null && !(typeof read.body.quote_id === "string" && UUID.test(read.body.quote_id))) return err(404, "not_found", "No such quote.");
      const r = await repo.approveRequest(db, org.id, route.target, { via: "staff_record", quoteId: read.body.quote_id || null, note: read.body.note ?? "", actorLabel: actor }, { now });
      if (r.ok) await dispatchNotifications(env, { ...deps, now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "revisions") {
      const read = await readJson(request, ["count"]);
      if (read.response) return read.response;
      const r = await repo.grantRevisions(db, org.id, route.target, Number(read.body.count), actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "files") {
      const read = await readUpload(request, { withMeta: true });
      if (read.response) return read.response;
      if (Object.keys(read.meta).some((k) => !["role", "note"].includes(k)) || typeof read.meta.role !== "string") return err(422, "invalid_role", "The change was not made.");
      const r = await svc.adminUpload(sv, { organizationId: org.id, requestId: route.target, role: read.meta.role, file: read.file, actor, note: typeof read.meta.note === "string" ? read.meta.note.slice(0, 1000) : "" });
      return r.ok ? json({ ok: true, eventId: r.eventId }, 201) : fromFailure(r);
    }
    if (route.kind === "preview") {
      const read = await readUpload(request, { withMeta: false });
      if (read.response) return read.response;
      const r = await svc.adminUploadPreview(sv, { organizationId: org.id, requestId: route.target, fileId: route.sub, file: read.file });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "download") {
      const r = await svc.adminOpenFile(sv, { organizationId: org.id, requestId: route.target, fileId: route.sub, view: new URL(request.url).searchParams.get("view") === "1", actor });
      return r.ok ? r.response : fromFailure(r);
    }
    return null;
  } catch (e) {
    console.error("admin requests api error:", e && e.name); // never the message: it can carry SQL text, values or storage details
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}

export { typeLabel, staffAttentionReason };
