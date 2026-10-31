/**
 * Invoices data layer (Client Services). Metadata only: the PDF lives in private R2 (the file service, Phase 2, keeps the two in step).
 *
 * Rules, on top of the shared repository rules (common.js):
 *  - Amounts are typed in by Framework staff in dollars and stored as whole cents, CAD only. Nothing is calculated (no tax, no totals, no conversion), and nothing is
 *    ever read from the PDF.
 *  - A draft (published_at IS NULL) does not exist for clients. A published invoice stays visible until archived. Invoices are ARCHIVED, never routinely deleted:
 *    there is deliberately no delete function. Retention: see CLIENT-SERVICES.md (kept six years after the end of the year they were issued, then reviewed).
 *  - "Overdue" is not stored: it is derived from the due date and today's date when unpaid, so it can never be out of date.
 *  - Every statement names organization_id; a row is addressed by (id, organization_id). Clients (owners only, see policy.js) read through the client_* functions,
 *    which never return storage keys, hashes, internal notes or drafts.
 */
import { newId, isoTime, requireOrgId, requireId, ok, fail, isConstraintViolation, isUniqueViolation, validActor } from "./common.js";
import { validateText, validateEnum } from "./validate.js";

export const PAYMENT_STATUSES = ["unpaid", "paid", "void"];
export const MAX_AMOUNT_CENTS = 100_000_000_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const NUMBER = /^[A-Za-z0-9._/-]{1,40}$/;

/* ------------------------------------------------------------------ pure helpers */

/** "1234.5", "1,234.50", "$1234" -> whole cents, or null. At most two decimals; never negative; no exponent notation. */
export function parseAmountToCents(raw) {
  if (typeof raw === "number") raw = Number.isFinite(raw) ? String(raw) : "";
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(v);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0") || 0);
  return cents <= MAX_AMOUNT_CENTS ? cents : null;
}

/** 123456 -> "$1,234.56 CAD". Display only. */
export function formatMoney(cents) {
  if (!Number.isInteger(cents) || cents < 0) return "";
  const dollars = Math.floor(cents / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${dollars}.${String(cents % 100).padStart(2, "0")} CAD`;
}

/** A real calendar date as YYYY-MM-DD, or null. */
export function validDate(raw) {
  const m = typeof raw === "string" ? DATE.exec(raw) : null;
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] ? raw : null;
}

/** The status a person should see: paid and void as stored, otherwise overdue once the due date has passed. `today` is YYYY-MM-DD in the portal's day (America/Edmonton, see todayOf). */
export function effectiveStatus(row, today) {
  if (row.paymentStatus === "paid" || row.paymentStatus === "void") return row.paymentStatus;
  return row.dueDate && validDate(today) && row.dueDate < today ? "overdue" : "unpaid";
}

/** The last day an invoice record should be kept before it is even considered for destruction: 31 December of the sixth year after the year it was issued. */
export function retainUntil(issueDate) {
  const d = validDate(issueDate);
  return d ? `${Number(d.slice(0, 4)) + 6}-12-31` : null;
}

/** The portal's day, in Framework's time zone (America/Edmonton), as YYYY-MM-DD: an invoice is overdue from the day AFTER its due date there, not from midnight UTC (which is the evening of the due date in Calgary). */
const EDMONTON = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" });
export const todayOf = (now = new Date()) => { const p = Object.fromEntries(EDMONTON.formatToParts(now).map((x) => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}`; };

/* ------------------------------------------------------------------ rows */

const COLS = "id, organization_id, invoice_number, issue_date, due_date, amount_cents, currency, payment_status, paid_at, description, internal_note, format, content_type, size_bytes, sha256, storage_key, created_at, created_by, updated_at, updated_by, published_at, published_by, archived_at, archived_by";
const row = (r) => ({
  id: r.id, organizationId: r.organization_id, invoiceNumber: r.invoice_number, issueDate: r.issue_date, dueDate: r.due_date, amountCents: r.amount_cents, currency: r.currency,
  paymentStatus: r.payment_status, paidAt: r.paid_at, description: r.description, internalNote: r.internal_note, format: r.format, contentType: r.content_type, size: r.size_bytes,
  sha256: r.sha256, storageKey: r.storage_key, hasFile: Boolean(r.storage_key), createdAt: r.created_at, createdBy: r.created_by, updatedAt: r.updated_at, updatedBy: r.updated_by,
  publishedAt: r.published_at, publishedBy: r.published_by, archivedAt: r.archived_at, archivedBy: r.archived_by, published: Boolean(r.published_at), archived: Boolean(r.archived_at),
  retainUntil: retainUntil(r.issue_date),
});

function after(db, { organizationId, actor, action, entityId, at, visibility = "internal" }) {
  return db
    .prepare("INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) SELECT ?, ?, 'admin', ?, ?, 'invoice', ?, ?, ? WHERE changes() > 0")
    .bind(newId(), organizationId, actor.trim(), action, entityId, visibility, at);
}

/** Validates the staff-entered fields. Returns { ok, value } with cents, or the first problem. */
export function normaliseInvoiceInput(input, { partial = false } = {}) {
  const i = input && typeof input === "object" ? input : {};
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(i, k);
  if (!partial || has("invoiceNumber")) { if (typeof i.invoiceNumber !== "string" || !NUMBER.test(i.invoiceNumber.trim())) return fail("invalid_invoice_number"); out.invoiceNumber = i.invoiceNumber.trim(); }
  if (!partial || has("issueDate")) { const d = validDate(i.issueDate); if (!d) return fail("invalid_issue_date"); out.issueDate = d; }
  if (has("dueDate")) { if (i.dueDate === null || i.dueDate === "") out.dueDate = null; else { const d = validDate(i.dueDate); if (!d) return fail("invalid_due_date"); out.dueDate = d; } }
  else if (!partial) out.dueDate = null;
  if (!partial || has("amount") || has("amountCents")) {
    const cents = has("amountCents") && Number.isInteger(i.amountCents) ? i.amountCents : parseAmountToCents(i.amount);
    if (cents === null || cents < 0 || cents > MAX_AMOUNT_CENTS) return fail("invalid_amount");
    out.amountCents = cents;
  }
  if (has("description")) { const t = validateText(i.description, 300); if (t === undefined) return fail("invalid_description"); out.description = t; }
  if (has("internalNote")) { const t = validateText(i.internalNote, 500); if (t === undefined) return fail("invalid_note"); out.internalNote = t; }
  if (out.dueDate && out.issueDate && out.dueDate < out.issueDate) return fail("due_before_issue");
  return ok({ value: out });
}

/* ------------------------------------------------------------------ Framework Admin */

/** A new DRAFT invoice. Not visible to the client until published. */
export async function createInvoice(db, organizationId, input, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  if (!validActor(actor)) return fail("invalid_actor");
  const n = normaliseInvoiceInput(input);
  if (!n.ok) return n;
  const v = n.value, id = newId(), at = isoTime(now);
  try {
    await db.batch([
      db
        .prepare("INSERT INTO invoices (id, organization_id, invoice_number, issue_date, due_date, amount_cents, description, internal_note, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(id, organizationId, v.invoiceNumber, v.issueDate, v.dueDate ?? null, v.amountCents, v.description ?? null, v.internalNote ?? null, at, actor.trim(), at, actor.trim()),
      after(db, { organizationId, actor, action: "invoice.created", entityId: id, at }),
    ]);
  } catch (err) {
    if (isUniqueViolation(err)) return fail("duplicate_number");
    if (isConstraintViolation(err)) return fail("invalid_invoice");
    throw err;
  }
  return ok({ id });
}

export async function getInvoiceAdmin(db, organizationId, invoiceId) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  const r = await db.prepare(`SELECT ${COLS} FROM invoices WHERE id = ? AND organization_id = ?`).bind(invoiceId, organizationId).first();
  return r ? row(r) : null;
}

export async function listInvoicesAdmin(db, organizationId, { includeArchived = false } = {}) {
  requireOrgId(organizationId);
  const rows = (await db.prepare(`SELECT ${COLS} FROM invoices WHERE organization_id = ? ${includeArchived ? "" : "AND archived_at IS NULL"} ORDER BY issue_date DESC, invoice_number DESC`).bind(organizationId).all()).results;
  return rows.map(row);
}

/** Edit the staff-entered fields. A paid or archived invoice's amount and number are locked (void it or archive and re-issue instead). */
export async function updateInvoice(db, organizationId, invoiceId, patch, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const cur = await getInvoiceAdmin(db, organizationId, invoiceId);
  if (!cur) return fail("not_found");
  if (cur.archived) return fail("archived");
  const n = normaliseInvoiceInput(patch, { partial: true });
  if (!n.ok) return n;
  const v = n.value;
  if (cur.paymentStatus === "paid" && ("amountCents" in v || "invoiceNumber" in v || "issueDate" in v)) return fail("paid_locked");
  const merged = { dueDate: "dueDate" in v ? v.dueDate : cur.dueDate, issueDate: v.issueDate ?? cur.issueDate };
  if (merged.dueDate && merged.dueDate < merged.issueDate) return fail("due_before_issue");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db
        .prepare("UPDATE invoices SET invoice_number = ?, issue_date = ?, due_date = ?, amount_cents = ?, description = ?, internal_note = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL")
        .bind(v.invoiceNumber ?? cur.invoiceNumber, merged.issueDate, merged.dueDate, v.amountCents ?? cur.amountCents, "description" in v ? v.description : cur.description, "internalNote" in v ? v.internalNote : cur.internalNote, at, actor.trim(), invoiceId, organizationId),
      after(db, { organizationId, actor, action: "invoice.updated", entityId: invoiceId, at }),
    ]);
    if (res[0].meta.changes !== 1) return fail("not_found");
  } catch (err) {
    if (isUniqueViolation(err)) return fail("duplicate_number");
    if (isConstraintViolation(err)) return fail("invalid_invoice");
    throw err;
  }
  return ok();
}

/** Records the PDF's metadata once the file service has stored the object. Returns the previous key (to be deleted) or null. */
export async function setInvoiceFile(db, organizationId, invoiceId, file, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const cur = await getInvoiceAdmin(db, organizationId, invoiceId);
  if (!cur) return fail("not_found");
  if (cur.archived) return fail("archived");
  const at = isoTime(now);
  try {
    const res = await db.batch([
      db.prepare("UPDATE invoices SET format = ?, content_type = ?, size_bytes = ?, sha256 = ?, storage_key = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL")
        .bind(file.ext, file.contentType, file.size, file.sha256, file.storageKey, at, actor.trim(), invoiceId, organizationId),
      after(db, { organizationId, actor, action: cur.hasFile ? "invoice.file_replaced" : "invoice.file_added", entityId: invoiceId, at }),
    ]);
    if (res[0].meta.changes !== 1) return fail("not_found");
  } catch (err) {
    if (isConstraintViolation(err)) return fail("invalid_file");
    throw err;
  }
  return ok({ previousKey: cur.storageKey });
}

/** Publishing makes the invoice visible to the organization's owners and queues the client notification. Needs the PDF. */
export async function publishInvoice(db, organizationId, invoiceId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const cur = await getInvoiceAdmin(db, organizationId, invoiceId);
  if (!cur) return fail("not_found");
  if (cur.archived) return fail("archived");
  if (cur.published) return ok({ changed: false });
  if (!cur.hasFile) return fail("needs_file");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE invoices SET published_at = ?, published_by = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND published_at IS NULL AND archived_at IS NULL AND storage_key IS NOT NULL").bind(at, actor.trim(), at, actor.trim(), invoiceId, organizationId),
    after(db, { organizationId, actor, action: "invoice.published", entityId: invoiceId, at, visibility: "client" }),
    db.prepare("INSERT INTO service_notifications (id, organization_id, audience, event, entity_type, entity_id, created_at) SELECT ?, ?, 'client', 'invoice_published', 'invoice', ?, ? WHERE changes() > 0 AND NOT EXISTS (SELECT 1 FROM service_notifications n WHERE n.organization_id = ? AND n.audience = 'client' AND n.event = 'invoice_published' AND n.entity_id = ?)").bind(newId(), organizationId, invoiceId, at, organizationId, invoiceId),
  ]);
  return ok({ changed: res[0].meta.changes === 1 });
}

/** Paid needs a payment date (today when omitted). Setting it back to unpaid clears the date. */
export async function setPaymentStatus(db, organizationId, invoiceId, status, actor, { paidOn = null, now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  if (!validateEnum(status, PAYMENT_STATUSES)) return fail("invalid_status");
  const paidAt = status === "paid" ? (paidOn === null ? todayOf(now) : validDate(paidOn)) : null;
  if (status === "paid" && !paidAt) return fail("invalid_paid_date");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE invoices SET payment_status = ?, paid_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(status, paidAt, at, actor.trim(), invoiceId, organizationId),
    after(db, { organizationId, actor, action: "invoice.payment_" + status, entityId: invoiceId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/** Archiving hides the invoice from the client and from the default admin list. The row and its file are kept. */
export async function archiveInvoice(db, organizationId, invoiceId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE invoices SET archived_at = ?, archived_by = ?, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NULL").bind(at, actor.trim(), at, actor.trim(), invoiceId, organizationId),
    after(db, { organizationId, actor, action: "invoice.archived", entityId: invoiceId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

export async function restoreInvoice(db, organizationId, invoiceId, actor, { now = new Date() } = {}) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  if (!validActor(actor)) return fail("invalid_actor");
  const at = isoTime(now);
  const res = await db.batch([
    db.prepare("UPDATE invoices SET archived_at = NULL, archived_by = NULL, updated_at = ?, updated_by = ? WHERE id = ? AND organization_id = ? AND archived_at IS NOT NULL").bind(at, actor.trim(), invoiceId, organizationId),
    after(db, { organizationId, actor, action: "invoice.restored", entityId: invoiceId, at }),
  ]);
  return res[0].meta.changes === 1 ? ok() : fail("not_found");
}

/* ------------------------------------------------------------------ client (owners only: enforced by policy.js before these are called) */

const CLIENT_VISIBLE = "organization_id = ? AND published_at IS NOT NULL AND archived_at IS NULL AND payment_status <> 'void'";

/** What an owner sees: number, dates, amount, effective status and whether a PDF exists. Never keys, hashes, internal notes, drafts, archived or void invoices. */
export async function listClientInvoices(db, organizationId, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const today = todayOf(now);
  const rows = (await db.prepare(`SELECT ${COLS} FROM invoices WHERE ${CLIENT_VISIBLE} ORDER BY issue_date DESC, invoice_number DESC`).bind(organizationId).all()).results;
  return rows.map((r) => { const x = row(r); return { id: x.id, invoiceNumber: x.invoiceNumber, issueDate: x.issueDate, dueDate: x.dueDate, amountCents: x.amountCents, description: x.description, status: effectiveStatus(x, today), paidAt: x.paidAt, format: x.format, size: x.size, hasFile: x.hasFile }; });
}

/** One invoice file an owner may download, or null. */
export async function getClientInvoiceFile(db, organizationId, invoiceId) {
  requireOrgId(organizationId); requireId(invoiceId, "invoice_id");
  const r = await db.prepare(`SELECT ${COLS} FROM invoices WHERE id = ? AND ${CLIENT_VISIBLE} AND storage_key IS NOT NULL`).bind(invoiceId, organizationId).first();
  if (!r) return null;
  const x = row(r);
  return { id: x.id, invoiceNumber: x.invoiceNumber, format: x.format, contentType: x.contentType, size: x.size, storageKey: x.storageKey };
}

/** Counts for cards and the hub: published, unarchived, non-void invoices that are unpaid and how many are overdue. */
export async function clientInvoiceSummary(db, organizationId, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const today = todayOf(now);
  const r = await db.prepare(`SELECT count(*) AS total, COALESCE(sum(payment_status = 'unpaid'), 0) AS unpaid, COALESCE(sum(payment_status = 'unpaid' AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue FROM invoices WHERE ${CLIENT_VISIBLE}`).bind(today, organizationId).first();
  return { total: r.total, unpaid: r.unpaid, overdue: r.overdue };
}

/** For Admin's attention card: drafts waiting to be published and published invoices past due. */
export async function adminInvoiceSummary(db, organizationId, { now = new Date() } = {}) {
  requireOrgId(organizationId);
  const r = await db.prepare("SELECT COALESCE(sum(published_at IS NULL), 0) AS drafts, COALESCE(sum(published_at IS NOT NULL AND payment_status = 'unpaid' AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue, count(*) AS total FROM invoices WHERE organization_id = ? AND archived_at IS NULL").bind(todayOf(now), organizationId).first();
  return { total: r.total, drafts: r.drafts, overdue: r.overdue };
}

/** Every storage key of an organization's invoice PDFs, archived ones included (they are kept). Used so housekeeping never mistakes an invoice file for an orphan. */
export async function listInvoiceStorageKeys(db, organizationId) {
  requireOrgId(organizationId);
  return (await db.prepare("SELECT storage_key FROM invoices WHERE organization_id = ? AND storage_key IS NOT NULL").bind(organizationId).all()).results.map((r) => r.storage_key);
}

/** Counts across every organization for the Admin dashboard: drafts waiting to be published and published invoices past due. */
export async function adminInvoiceTotals(db, { now = new Date() } = {}) {
  const r = await db.prepare("SELECT COALESCE(sum(published_at IS NULL), 0) AS drafts, COALESCE(sum(published_at IS NOT NULL AND payment_status = 'unpaid' AND due_date IS NOT NULL AND due_date < ?), 0) AS overdue FROM invoices WHERE archived_at IS NULL AND organization_id IN (SELECT id FROM organizations WHERE status <> 'archived') /* cross-tenant: Admin totals; deleted clients are left out */").bind(todayOf(now)).first();
  return { drafts: r.drafts, overdue: r.overdue };
}
