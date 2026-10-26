/**
 * Framework Admin: Invoices API. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route (the router authenticates first); writes also need
 * PORTAL_ADMIN_WRITES and a same-origin request with the X-Framework-Admin header (the existing Admin CSRF defence). Framework staff type in the invoice details,
 * attach the PDF and decide when a client may see it. Clients never reach any of this, and no route deletes an invoice: archiving keeps it.
 *
 *   GET  /clients/:org/invoices                       the organization's invoices (archived ones with ?archived=1) and a summary; never storage keys or hashes
 *   POST /clients/:org/invoices                       { invoiceNumber, issueDate, dueDate?, amount, description?, internalNote? }   a new DRAFT
 *   POST /clients/:org/invoices/:id/update            { invoiceNumber?, issueDate?, dueDate?, amount?, description?, internalNote? }
 *   POST /clients/:org/invoices/:id/file              multipart: file (PDF only)   store or replace the PDF
 *   POST /clients/:org/invoices/:id/publish           makes it visible to the organization's owners (needs the PDF) and queues the client notice
 *   POST /clients/:org/invoices/:id/payment           { status: unpaid | paid | void, paidOn? }
 *   POST /clients/:org/invoices/:id/archive | restore
 *   GET  /clients/:org/invoices/:id/download          the PDF as an attachment (recorded)
 *
 * A database without migration 0007 answers { available: false }: nothing else runs.
 */
import { getOrganizationById } from "./repo/orgs.js";
import { UUID } from "./repo/common.js";
import * as inv from "./repo/invoices.js";
import * as files from "./invoice-files.js";
import { json, err, sameOriginWrite, readJson, readUpload } from "./admin-branding.js";

const STATUS = {
  not_found: 404, forbidden: 403, archived: 409, duplicate_number: 409, paid_locked: 409, needs_file: 409, conflict: 409,
  invalid_invoice_number: 422, invalid_issue_date: 422, invalid_due_date: 422, due_before_issue: 422, invalid_amount: 422, invalid_description: 422, invalid_note: 422, invalid_status: 422,
  invalid_paid_date: 422, invalid_invoice: 422, invalid_file: 422,
  invalid_name: 422, type_not_allowed: 415, content_mismatch: 422, active_content: 422, pdf_encrypted: 422, empty_file: 422, no_file: 400, file_too_large: 413,
  storage_unavailable: 503, storage_write_failed: 502, storage_read_failed: 502, storage_delete_failed: 502,
};
const fromFailure = (r) => (STATUS[r.error] ? err(STATUS[r.error], r.error, "The change was not made.") : err(500, "server_error", "Something went wrong. Nothing was changed."));
const FIELDS = ["invoiceNumber", "issueDate", "dueDate", "amount", "description", "internalNote"];

async function tablesPresent(db) {
  try { await db.prepare("SELECT 1 FROM invoices LIMIT 1").first(); return true; } catch { return false; }
}

/** What Admin sees of an invoice: the entered figures, the derived status, whether a PDF exists. Never the storage key or hash. */
export function publicInvoice(x, today) {
  return {
    id: x.id, invoiceNumber: x.invoiceNumber, issueDate: x.issueDate, dueDate: x.dueDate, amountCents: x.amountCents, amount: inv.formatMoney(x.amountCents), currency: x.currency,
    description: x.description, internalNote: x.internalNote, paymentStatus: x.paymentStatus, status: inv.effectiveStatus(x, today), paidAt: x.paidAt, hasFile: x.hasFile, size: x.size,
    published: x.published, publishedAt: x.publishedAt, archived: x.archived, archivedAt: x.archivedAt, retainUntil: x.retainUntil, createdAt: x.createdAt, updatedAt: x.updatedAt,
  };
}

async function view(env, org, { archived, now }) {
  const db = env.PORTAL_DB;
  const today = inv.todayOf(now);
  const list = await inv.listInvoicesAdmin(db, org.id, { includeArchived: archived });
  return { available: true, capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", storage: Boolean(env.PORTAL_FILES) }, organization: { id: org.id, name: org.name }, invoices: list.map((x) => publicInvoice(x, today)), summary: await inv.adminInvoiceSummary(db, org.id, { now }) };
}

/** @param path pathname with "/api/admin" removed. @returns Response, or null when it is not an Invoices route. */
export async function handleInvoicesApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (!(seg[0] === "clients" && seg[2] === "invoices" && seg.length >= 3)) return null;
  const rest = seg.slice(3);
  let route = null;
  if (rest.length === 0) route = { kind: request.method === "POST" ? "create" : "view", method: request.method === "POST" ? "POST" : "GET" };
  else if (rest.length === 2 && ["update", "file", "publish", "payment", "archive", "restore"].includes(rest[1])) route = { kind: rest[1], method: "POST", target: rest[0] };
  else if (rest.length === 2 && rest[1] === "download") route = { kind: "download", method: "GET", target: rest[0] };
  if (!route) return null;
  if (request.method !== route.method) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: route.method });
  if (!UUID.test(seg[1])) return err(404, "not_found", "No such organization.");
  if (route.target !== undefined && !UUID.test(route.target)) return err(404, "not_found", "Not found.");
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
    if (["file", "download"].includes(route.kind) && !env.PORTAL_FILES) return err(503, "storage_unavailable", "File storage is not available on this deployment.");

    if (route.kind === "view") return json(await view(env, org, { archived: new URL(request.url).searchParams.get("archived") === "1", now }));
    if (route.kind === "create") {
      const read = await readJson(request, FIELDS);
      if (read.response) return read.response;
      const r = await inv.createInvoice(db, org.id, read.body, actor, { now });
      return r.ok ? json({ ok: true, id: r.id }, 201) : fromFailure(r);
    }
    if (route.kind === "update") {
      const read = await readJson(request, FIELDS);
      if (read.response) return read.response;
      const r = await inv.updateInvoice(db, org.id, route.target, read.body, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "file") {
      const read = await readUpload(request, { withMeta: false });
      if (read.response) return read.response;
      const r = await files.adminUploadInvoiceFile(svc, { organizationId: org.id, actor, invoiceId: route.target, file: read.file });
      return r.ok ? json({ ok: true, size: r.size }) : fromFailure(r);
    }
    if (route.kind === "publish") {
      const r = await inv.publishInvoice(db, org.id, route.target, actor, { now });
      return r.ok ? json({ ok: true, changed: r.changed }) : fromFailure(r);
    }
    if (route.kind === "payment") {
      const read = await readJson(request, ["status", "paidOn"]);
      if (read.response) return read.response;
      const r = await inv.setPaymentStatus(db, org.id, route.target, read.body.status, actor, { paidOn: read.body.paidOn === undefined || read.body.paidOn === "" ? null : read.body.paidOn, now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "archive" || route.kind === "restore") {
      const r = await (route.kind === "archive" ? inv.archiveInvoice : inv.restoreInvoice)(db, org.id, route.target, actor, { now });
      return r.ok ? json({ ok: true }) : fromFailure(r);
    }
    if (route.kind === "download") {
      const r = await files.adminDownloadInvoice(svc, { organizationId: org.id, invoiceId: route.target, actor });
      return r.ok ? r.response : fromFailure(r);
    }
    return null;
  } catch (e) {
    console.error("admin invoices api error:", e && e.name); // never the message: it can carry SQL text, values or storage details
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
