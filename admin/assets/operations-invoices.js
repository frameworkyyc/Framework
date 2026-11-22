/* Framework Admin: Operations, Invoices. /admin/operations/invoices lists every client's invoices in one place (GET /api/admin/invoices, read-only): number, client, dates, amount, status. A row opens that
   client's Billing tab, where invoices are created, edited, published and marked paid (unchanged). Amounts and statuses are the ones already entered; nothing is estimated. Server text is only set as text. */
import { h, api, errorState, fmtDate } from "./ui.js";
import { pageHead, grid, span, card, kpi, pill, segmented, dataList, empty } from "./ds.js";

const enc = encodeURIComponent;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const money = (cents) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((Number(cents) || 0) / 100);
const TONE = { overdue: ["Past due", "bad"], unpaid: ["Unpaid", "warn"], draft: ["Draft", "quiet"], paid: ["Paid", "ok"], void: ["Void", "quiet"] };
const day = (d) => (d ? fmtDate(d + "T12:00:00Z") : "—");

const COLS = [
  { label: "Invoice", cls: "ds-dl__c--main", render: (i) => h("span", { class: "ds-site" }, h("strong", { class: "ds-site__n", text: i.invoiceNumber }), h("span", { class: "ds-muted", text: i.organizationName })) },
  { label: "Issued", render: (i) => h("span", { text: day(i.issueDate) }) },
  { label: "Due", render: (i) => h("span", { text: day(i.dueDate) }) },
  { label: "Amount", render: (i) => h("strong", { text: money(i.amountCents) }) },
  { label: "Status", render: (i) => { const [w, t] = TONE[i.status] || [i.status, "quiet"]; return pill(w, t); } },
];

export async function render(ctx) {
  let data;
  try { data = await api("/invoices"); } catch (err) { return { title: "Invoices", node: h("div", { class: "ds-page" }, errorState(err, ctx.retry)) }; }
  const head = pageHead({ title: "Invoices", sub: "Every client’s invoices. Open one to create, edit, publish or mark it paid on the client’s Billing tab." });
  if (!data.available) return { title: "Invoices", node: h("div", { class: "ds-page" }, head, card({ body: empty({ title: "Invoices aren’t available on this site yet", body: "A database change is waiting for approval. Nothing has been changed.", ic: "invoices" }) })) };
  const all = data.invoices, s = data.summary;
  const kpis = grid(
    span(kpi({ label: "Outstanding", value: money(s.outstandingCents), note: "Published and not yet paid", tone: s.outstandingCents ? "warn" : "ok" }), 3),
    span(kpi({ label: "Past due", value: String(s.overdueCount), note: s.overdueCount ? "Follow up with the client" : "Nothing past due", tone: s.overdueCount ? "bad" : "ok" }), 3),
    span(kpi({ label: "Drafts", value: String(s.draftCount), note: s.draftCount ? "Not yet visible to clients" : "No drafts waiting" }), 3),
    span(kpi({ label: "Paid", value: money(s.paidCents), note: "Across the invoices listed", tone: "ok" }), 3));
  let filter = "all", query = "";
  const listHost = h("div", { class: "ds-list-host" }), status = h("p", { class: "ds-muted", role: "status" });
  const draw = () => {
    const q = query.toLowerCase();
    const rows = all.filter((i) => (filter === "all" || i.status === filter) && (!q || `${i.invoiceNumber} ${i.organizationName}`.toLowerCase().includes(q)));
    status.textContent = `${plural(rows.length, "invoice")}${rows.length !== all.length ? ` of ${all.length}` : ""}.`;
    listHost.replaceChildren(rows.length ? dataList({ label: "Invoices", cls: "ds-dl--invoices", columns: COLS, rows: rows.map((i) => ({ ...i, href: "/admin/clients/" + enc(i.organizationId) + "/invoices" })) })
      : empty({ title: all.length ? "No invoice matches" : "No invoices yet", body: all.length ? "Try another filter or search." : "Invoices are created on a client’s Billing tab.", ic: "invoices" }));
  };
  const find = h("input", { class: "input ds-find", type: "search", placeholder: "Find an invoice or client", "aria-label": "Find an invoice or client", autocomplete: "off", oninput: (e) => { query = e.target.value.trim(); draw(); } });
  const count = (st) => all.filter((i) => i.status === st).length;
  const seg = segmented({ label: "Show", value: "all", onChange: (v) => { filter = v; draw(); }, options: [{ id: "all", label: "All", count: all.length }, { id: "overdue", label: "Past due", count: count("overdue") }, { id: "unpaid", label: "Unpaid", count: count("unpaid") }, { id: "draft", label: "Drafts", count: count("draft") }, { id: "paid", label: "Paid", count: count("paid") }] });
  draw();
  return { title: "Invoices", node: h("div", { class: "ds-page" }, head, kpis, card({ body: [h("div", { class: "ds-toolbar" }, seg, find), listHost, status] })), crumbs: [["Admin", "/admin"], ["Operations", "/admin/operations"], ["Invoices", null]] };
}
