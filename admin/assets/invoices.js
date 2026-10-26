/* Framework Admin — Clients: Invoices for one client (/admin/clients/:id/invoices).
   Framework staff type in an invoice's details, attach the PDF, publish it for the client's owners, record payment, and archive it. This file only presents and
   submits: the checks, who may see what, and the retention rules are decided by the server (worker/portal/admin-invoices.js). Server text is never inserted as
   HTML; friendly copy is shown for known codes only. Invoices are archived, never deleted: there is no delete control. */

import { h, api, confirmDialog, errorState, fmtDate } from "./ui.js";
import { chip } from "./client-dashboard.js";

const ERROR_TEXT = {
  invalid_invoice_number: "Use an invoice number of letters, numbers and . _ / - only (up to 40 characters).",
  invalid_issue_date: "Choose a valid issue date.", invalid_due_date: "Choose a valid due date, or leave it empty.", due_before_issue: "The due date can’t be before the issue date.",
  invalid_amount: "Enter the amount in dollars, like 1500 or 1,500.00 (no more than two decimals, not negative).",
  invalid_description: "That description is too long (300 characters at most).", invalid_note: "That note is too long (500 characters at most).",
  duplicate_number: "This client already has an invoice with that number.",
  paid_locked: "A paid invoice’s number, amount and issue date are locked. Mark it unpaid or void it first.",
  archived: "That invoice is archived. Restore it to change it.",
  needs_file: "Attach the invoice PDF before publishing.",
  invalid_status: "Choose a payment status.", invalid_paid_date: "Choose a valid payment date.",
  type_not_allowed: "Only PDF files are accepted for invoices.", content_mismatch: "That file isn’t a valid PDF. Export it again.", active_content: "The PDF contains active content (scripts or embedded files), so it can’t be stored.",
  pdf_encrypted: "Password-protected PDFs can’t be stored. Export a copy without a password.", empty_file: "That file is empty.", file_too_large: "That file is over the size limit.", no_file: "Choose a PDF first.", invalid_name: "That file name can’t be used.",
  not_found: "That invoice no longer exists. The page has been refreshed.", conflict: "That invoice changed while you were working. The page has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.",
  storage_write_failed: "The file couldn’t be stored just now. Nothing was saved. Try again.", storage_read_failed: "The file couldn’t be read from storage just now.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const GENERIC = "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
export const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
const day = (d) => (d ? fmtDate(d + "T12:00:00Z") : "");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const STATUS_TEXT = { unpaid: "Unpaid", overdue: "Overdue", paid: "Paid", void: "Void" };
const STATUS_CHIP = { unpaid: ["plain"], overdue: ["warn", "warn"], paid: ["ok", "complete"], void: ["plain"] };
const labelled = (id, label, input, hint) => h("div", { class: "adm-field" }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", text: hint }) : null, input);
const today = () => new Date().toISOString().slice(0, 10);

export async function render(orgId, ctx) {
  const base = "/clients/" + encodeURIComponent(orgId) + "/invoices";
  let showArchived = false;
  let data;
  const load = () => api(base + (showArchived ? "?archived=1" : ""));
  try { data = await load(); } catch (err) { return { title: "Invoices", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← " + (data.organization ? data.organization.name : "Client"));
  if (!data.available) return { title: "Invoices", node: h("div", { class: "adm-page adm-invpage" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Invoices"), h("p", { class: "adm-banner" }, "Invoices aren’t available on this deployment (its database migration hasn’t been applied).")) };

  const root = h("div", { class: "adm-page adm-invpage" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const opened = new Set(["inv-new"]);
  let busy = false;
  const caps = () => data.capabilities;

  function say(text, tone = "info", { focus = true } = {}) {
    live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" || tone === "warning" ? "alert" : "status"); live.hidden = !text;
    if (text && focus) live.focus({ preventScroll: false });
  }
  function lock(on) {
    root.toggleAttribute("aria-busy", on);
    root.querySelectorAll("button, input, select, textarea").forEach((el) => {
      if (on) { el.dataset.wasDisabled = el.disabled ? "1" : ""; el.disabled = true; } else if (el.dataset.wasDisabled === "") el.disabled = false;
    });
  }
  async function reload() { try { data = await load(); draw(); } catch { /* the previous view stays; the message says what happened */ } }
  /** One change: confirm (when asked), lock the page, call the API, say what happened in plain words, then show the server's real state. */
  async function perform({ confirm, request, success, onError }) {
    if (busy) return false;
    if (confirm && !(await confirmDialog(confirm))) return false;
    busy = true; lock(true); say("Working…", "info", { focus: false });
    let outcome, ok = false;
    try { const res = await request(); outcome = { tone: "success", text: typeof success === "function" ? success(res) : success }; ok = true; } catch (err) { outcome = { tone: "error", text: (onError && onError(err)) || errorText(err) }; }
    busy = false;
    await reload();
    say(outcome.text, outcome.tone); lock(false);
    return ok;
  }
  const pdfBody = (file) => { const body = new FormData(); body.append("file", file); return body; };
  const downloadLink = (i) => h("a", { class: "btn btn--secondary adm-small", href: `/api/admin/clients/${encodeURIComponent(orgId)}/invoices/${encodeURIComponent(i.id)}/download`, download: "", "aria-label": `Download PDF of invoice ${i.invoiceNumber}` }, "Download PDF");

  /* ---------------------------------------------------------- fields shared by "new" and "edit" */

  function detailFields(prefix, i) {
    const f = {
      number: h("input", { class: "input", id: prefix + "-no", type: "text", maxlength: "40", autocomplete: "off", value: i ? i.invoiceNumber : "", required: true }),
      issue: h("input", { class: "input", id: prefix + "-issue", type: "date", value: i ? i.issueDate : today(), required: true }),
      due: h("input", { class: "input", id: prefix + "-due", type: "date", value: i && i.dueDate ? i.dueDate : "" }),
      amount: h("input", { class: "input", id: prefix + "-amt", type: "text", inputmode: "decimal", autocomplete: "off", value: i ? (i.amountCents / 100).toFixed(2) : "", required: true }),
      desc: h("input", { class: "input", id: prefix + "-desc", type: "text", maxlength: "300", value: i && i.description ? i.description : "" }),
      note: h("textarea", { class: "input", id: prefix + "-note", rows: "2", maxlength: "500" }, i && i.internalNote ? i.internalNote : ""),
    };
    const locked = i && i.paymentStatus === "paid";
    if (locked) for (const k of ["number", "issue", "amount"]) f[k].disabled = true;
    const nodes = [
      labelled(prefix + "-no", "Invoice number", f.number, locked ? "Locked: this invoice is paid." : "Your own numbering, for example FW-2026-014."),
      h("div", { class: "adm-fgrid" }, labelled(prefix + "-issue", "Issue date", f.issue), labelled(prefix + "-due", "Due date (optional)", f.due)),
      labelled(prefix + "-amt", "Amount (CAD)", f.amount, "Type the total as it appears on the PDF, including any tax. Nothing is calculated here."),
      labelled(prefix + "-desc", "Description (the client sees this)", f.desc),
      labelled(prefix + "-note", "Internal note (staff only)", f.note),
    ];
    const value = () => ({ invoiceNumber: f.number.value.trim(), issueDate: f.issue.value, dueDate: f.due.value || null, amount: f.amount.value.trim(), description: f.desc.value.trim() || null, internalNote: f.note.value.trim() || null });
    return { nodes, value, f };
  }

  /* ---------------------------------------------------------- new invoice */

  function newForm() {
    const fields = detailFields("inv-new", null);
    const fileInput = h("input", { class: "input", id: "inv-new-file", type: "file", accept: ".pdf,application/pdf" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const form = h("form", { class: "adm-form", novalidate: true },
      ...fields.nodes,
      labelled("inv-new-file", "Invoice PDF", fileInput, "PDF only. You can add it later, but an invoice can’t be published without it."),
      err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: caps().writes ? null : true }, "Save as draft")),
      h("p", { class: "adm-field__hint", text: "A draft is visible to Framework staff only. The client sees an invoice once you publish it." }));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const file = fileInput.files && fileInput.files[0];
      err.hidden = true;
      if (file && !caps().storage) { err.textContent = errorText({ code: "storage_unavailable" }); err.hidden = false; return; }
      let createdId = null;
      await perform({
        request: async () => { const r = await api(base, { method: "POST", body: fields.value() }); createdId = r.id; if (file) await api(`${base}/${encodeURIComponent(r.id)}/file`, { method: "POST", body: pdfBody(file) }); return r; },
        success: () => (file ? "Draft saved with its PDF. Publish it when it’s ready for the client." : "Draft saved. Attach the PDF before publishing."),
        onError: (e) => (createdId ? `The draft was saved, but its PDF wasn’t: ${errorText(e)} Add the PDF from the invoice below.` : errorText(e)),
      });
    });
    return form;
  }

  /* ---------------------------------------------------------- one invoice */

  function paymentForm(i) {
    const select = h("select", { class: "input", id: `pay-${i.id}`, "aria-label": `Payment status of invoice ${i.invoiceNumber}` }, ["unpaid", "paid", "void"].map((s) => h("option", { value: s, selected: i.paymentStatus === s ? true : null, text: STATUS_TEXT[s] })));
    const date = h("input", { class: "input", type: "date", id: `paid-${i.id}`, value: i.paidAt ? i.paidAt.slice(0, 10) : today(), "aria-label": "Date paid" });
    const sync = () => { date.parentElement.hidden = select.value !== "paid"; };
    const wrap = h("div", { class: "adm-fgrid adm-fgrid--pay" }, select, h("span", { class: "adm-paydate" }, h("label", { for: date.id, class: "visually-hidden", text: "Date paid" }), date));
    select.addEventListener("change", sync);
    const button = h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: caps().writes ? null : true, onclick: () => perform({
      confirm: select.value === "void" ? { title: "Void this invoice?", body: "A void invoice disappears from the client’s list. The record is kept.", details: [["Invoice", i.invoiceNumber], ["Amount", i.amount]], confirmLabel: "Void invoice" } : null,
      request: () => api(`${base}/${encodeURIComponent(i.id)}/payment`, { method: "POST", body: { status: select.value, ...(select.value === "paid" ? { paidOn: date.value } : {}) } }),
      success: `Invoice ${i.invoiceNumber} is now ${STATUS_TEXT[select.value].toLowerCase()}.`,
    }) }, "Update payment");
    const node = h("div", { class: "adm-payrow" }, wrap, button);
    sync(); date.parentElement.hidden = select.value !== "paid";
    return node;
  }

  function editForm(i) {
    const fields = detailFields("inv-ed-" + i.id.slice(0, 8), i);
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const form = h("form", { class: "adm-form", novalidate: true }, ...fields.nodes, err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--secondary adm-small", type: "submit", disabled: caps().writes && !i.archived ? null : true }, "Save details")));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      const v = fields.value();
      const patch = i.paymentStatus === "paid" ? { dueDate: v.dueDate, description: v.description, internalNote: v.internalNote } : v;
      perform({ request: () => api(`${base}/${encodeURIComponent(i.id)}/update`, { method: "POST", body: patch }), success: `Invoice ${i.invoiceNumber} saved.` });
    });
    return form;
  }

  function replacePdf(i) {
    const input = h("input", { type: "file", accept: ".pdf,application/pdf", class: "visually-hidden", id: `pdf-${i.id}`, "aria-label": `Choose a PDF for invoice ${i.invoiceNumber}`, onchange: () => {
      const file = input.files && input.files[0]; if (!file) return;
      perform({ confirm: i.hasFile ? { title: "Replace the PDF?", body: "The client will get the new file when they download this invoice.", details: [["Invoice", i.invoiceNumber]], confirmLabel: "Replace PDF" } : null,
        request: () => api(`${base}/${encodeURIComponent(i.id)}/file`, { method: "POST", body: pdfBody(file) }), success: i.hasFile ? "PDF replaced." : "PDF attached." });
      input.value = "";
    } });
    return [input, h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: caps().writes && caps().storage && !i.archived ? null : true, onclick: () => input.click() }, i.hasFile ? "Replace PDF" : "Attach PDF")];
  }

  function card(i) {
    const [tone, ico] = STATUS_CHIP[i.status] || ["plain"];
    const chips = [
      chip(i.published ? "ok" : "pending", i.published ? "Published" : "Draft", i.published ? "complete" : "info"),
      chip(tone, STATUS_TEXT[i.status], ico),
      chip(i.hasFile ? "plain" : "warn", i.hasFile ? `PDF ${fmtSize(i.size)}` : "No PDF", i.hasFile ? null : "warn"),
      i.archived ? chip("plain", "Archived") : null,
    ];
    const facts = [`Issued ${day(i.issueDate)}`, i.dueDate ? `Due ${day(i.dueDate)}` : "No due date", i.paidAt ? `Paid ${day(i.paidAt.slice(0, 10))}` : null, `Keep until ${day(i.retainUntil)}`].filter(Boolean).join(" · ");
    const actions = [
      i.hasFile ? downloadLink(i) : null,
      ...replacePdf(i),
      !i.published && !i.archived ? h("button", { class: "btn btn--primary adm-small", type: "button", disabled: caps().writes && i.hasFile ? null : true, title: i.hasFile ? null : "Attach the PDF first", onclick: () => perform({
        confirm: { title: "Publish this invoice?", body: "The owners of this organization will be able to see and download it, and they will be notified.", details: [["Invoice", i.invoiceNumber], ["Amount", i.amount]], confirmLabel: "Publish invoice" },
        request: () => api(`${base}/${encodeURIComponent(i.id)}/publish`, { method: "POST", body: {} }), success: `Invoice ${i.invoiceNumber} is published.`,
      }) }, "Publish") : null,
      h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: caps().writes ? null : true, onclick: () => perform({
        confirm: { title: i.archived ? "Restore this invoice?" : "Archive this invoice?", body: i.archived ? "It will return to the list and, if published, to the client’s view." : "It will be hidden from the client and from this list. The record and its PDF are kept for the retention period.", details: [["Invoice", i.invoiceNumber]], confirmLabel: i.archived ? "Restore invoice" : "Archive invoice" },
        request: () => api(`${base}/${encodeURIComponent(i.id)}/${i.archived ? "restore" : "archive"}`, { method: "POST", body: {} }), success: i.archived ? "Invoice restored." : "Invoice archived.",
      }) }, i.archived ? "Restore" : "Archive"),
    ];
    return h("li", { class: "adm-inv" + (i.archived ? " is-archived" : "") },
      h("div", { class: "adm-inv__head" }, h("h3", { class: "adm-inv__no", text: `Invoice ${i.invoiceNumber}` }), h("p", { class: "adm-inv__amount", text: i.amount })),
      h("p", { class: "adm-inv__chips" }, chips),
      h("p", { class: "adm-sub", text: facts }),
      i.description ? h("p", { text: i.description }) : null,
      i.internalNote ? h("p", { class: "adm-sub" }, h("strong", { text: "Internal: " }), i.internalNote) : null,
      h("div", { class: "adm-actions" }, actions),
      i.archived ? null : h("details", { class: "adm-inv__more" }, h("summary", null, "Payment and details"), paymentForm(i), editForm(i)));
  }

  /* ---------------------------------------------------------- page */

  function draw() {
    const list = data.invoices;
    const s = data.summary;
    const chips = [s.drafts ? chip("pending", plural(s.drafts, "draft") + " to publish", "info") : null, s.overdue ? chip("warn", `${s.overdue} past due`, "warn") : null, !s.total ? chip("plain", "No invoices yet") : null];
    root.replaceChildren(...[
      back,
      h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, data.organization.name), h("h1", { class: "adm-title", tabindex: "-1" }, "Invoices"),
        h("p", { class: "adm-sub" }, "Enter an invoice, attach its PDF and publish it for this client’s owners. Invoices are archived, never deleted."))),
      caps().writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at invoices, but not change them."),
      caps().writes && !caps().storage ? h("p", { class: "adm-banner" }, "File storage isn’t available on this site, so PDFs can’t be attached yet.") : null,
      live,
      h("p", { class: "adm-inv__chips" }, chips),
      h("details", { class: "adm-acc", id: "inv-new", open: opened.has("inv-new") || !list.length ? true : null, ontoggle: (ev) => { if (ev.target.open) opened.add("inv-new"); else opened.delete("inv-new"); } },
        h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title" }, "New invoice")), h("div", { class: "adm-acc__body" }, newForm())),
      h("section", { class: "adm-section", "aria-labelledby": "adm-invlist-h" },
        h("div", { class: "adm-section-title" }, h("h2", { id: "adm-invlist-h", text: showArchived ? "All invoices (archived included)" : "Invoices" }),
          h("button", { class: "adm-linkbtn", type: "button", onclick: async () => { showArchived = !showArchived; await reload(); } }, showArchived ? "Hide archived" : "Show archived")),
        list.length ? h("ul", { class: "adm-invlist" }, list.map(card)) : h("p", { class: "adm-muted", text: "No invoices to show." }))].filter(Boolean)); // replaceChildren would print a null as the word "null"
  }
  draw();
  return { title: "Invoices — " + data.organization.name, node: root };
}
