/**
 * Framework Admin: every client's invoices in one read-only list (Operations, Invoices). Behind Cloudflare Access and ADMIN_EMAILS like every Admin route; one SELECT through readOnlyDb.
 * It returns what Admin already sees per client (number, dates, amount, derived status, whether a PDF exists, published) and never the storage key, hash, internal note or description.
 * Archived invoices and deleted clients are left out. Creating and editing stay on each client's Billing tab. A database without migration 0007 answers { available: false }.
 *
 *   GET /invoices   { available, generatedAt, summary: { outstandingCents, overdueCount, draftCount, paidCents }, invoices: [...] }   newest first, at most 500
 */
import { readOnlyDb } from "./admin-clients.js";
import * as inv from "./repo/invoices.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

export async function handleInvoicesIndexApi(request, env, principal, path, deps = {}) {
  if (path !== "/invoices") return null;
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
  if (!env.PORTAL_DB) return json({ available: false });
  const now = deps.now || new Date();
  const today = inv.todayOf(now);
  let rows;
  try {
    rows = (await readOnlyDb(env.PORTAL_DB).prepare("SELECT i.id, i.organization_id, o.name AS org_name, i.invoice_number, i.issue_date, i.due_date, i.amount_cents, i.currency, i.payment_status, i.paid_at, i.storage_key, i.published_at FROM invoices i JOIN organizations o ON o.id = i.organization_id WHERE i.archived_at IS NULL AND o.status <> 'archived' ORDER BY i.issue_date DESC, i.invoice_number DESC LIMIT 500").all()).results || [];
  } catch { return json({ available: false }); }
  const list = rows.map((r) => {
    const x = { paymentStatus: r.payment_status, dueDate: r.due_date };
    return { id: r.id, organizationId: r.organization_id, organizationName: r.org_name, invoiceNumber: r.invoice_number, issueDate: r.issue_date, dueDate: r.due_date, amountCents: r.amount_cents, amount: inv.formatMoney(r.amount_cents), currency: r.currency,
      status: r.published_at || r.payment_status !== "unpaid" ? inv.effectiveStatus(x, today) : "draft", paidAt: r.paid_at, hasFile: Boolean(r.storage_key), published: Boolean(r.published_at) };
  });
  const sum = (f) => list.filter(f).reduce((a, i) => a + i.amountCents, 0);
  return json({ available: true, generatedAt: now.toISOString(), summary: {
    outstandingCents: sum((i) => i.published && (i.status === "unpaid" || i.status === "overdue")), overdueCount: list.filter((i) => i.status === "overdue").length,
    draftCount: list.filter((i) => !i.published).length, paidCents: sum((i) => i.status === "paid") }, invoices: list });
}
