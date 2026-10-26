/**
 * Pages of the connected Client Services area: the hub and the Contact page (Phase 1). Invoices and Support & Change Requests arrive in later phases; until their
 * data exists they are shown as plain "Coming soon" cards (no link), so nothing suggests they can be opened. Rendered from the member's OWN organization only, with
 * no inline style or script. Every dynamic value is escaped.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { can } from "./policy.js";
import { formatMoney } from "./repo/invoices.js";

export const CONTACT_EMAIL = "hello@frameworkco.ca";
const href = (vm, p) => `${vm.base}${p}`;

/** One hub card. `to` makes the whole card a link; without it the card is quiet text with a "Coming soon" tag. */
function card(vm, { title, desc, status = "", to = null }) {
  const body = to
    ? `<span class="hub__top"><span class="hub__title">${e(title)}</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span><span class="hub__desc">${e(desc)}</span>${status ? `<span class="hub__status"><span class="tile__status"><span class="tile__note">${e(status)}</span></span></span>` : ""}`
    : `<span class="hub__top"><span class="hub__title">${e(title)}</span><span class="tag">Coming soon</span></span><span class="hub__desc">${e(desc)}</span>`;
  return to ? `<li><a class="hub" href="${e(href(vm, to))}">${body}</a></li>` : `<li><div class="hub hub--soon">${body}</div></li>`;
}

/** The hub. Invoices appear only for roles that may see them (owners). `live` says which parts have data behind them. */
export function servicesHub(vm, role, live = {}) {
  const cards = [];
  if (can(role, "invoices.view")) cards.push(card(vm, { title: "Invoices", desc: "View and download your Framework invoices.", status: live.invoices || "", to: live.invoices ? "/services/invoices" : null }));
  cards.push(card(vm, { title: "Support & Change Requests", desc: "Ask for a website change, a logo or design revision, or technical help.", status: live.support || "", to: live.support ? "/services/requests" : null }));
  cards.push(card(vm, { title: "Contact", desc: "How to reach Framework.", status: CONTACT_EMAIL, to: "/services/contact" }));
  return `<header class="page-head page-head--compact">${crumb(vm, [["Client Services"]])}<h1 class="h1 h1--section">Client Services</h1></header>
<nav aria-label="Client Services"><ul class="hubs">${cards.join("")}</ul></nav>`;
}

/** Contact: the address people can write to and where we are. No phone number or opening hours are shown because none are published on the site. */
export function contactPage(vm) {
  const subject = encodeURIComponent(`Client portal: ${vm.org && vm.org.name ? vm.org.name : "question"}`);
  return `<header class="page-head page-head--compact">${crumb(vm, [["Client Services", "/services"], ["Contact"]])}<h1 class="h1 h1--section">Contact</h1><p class="lead">The quickest way to reach us is by email. We read every message.</p></header>
<p><a class="btn btn--primary" href="mailto:${e(CONTACT_EMAIL)}?subject=${e(subject)}">Email ${e(CONTACT_EMAIL)}</a></p>
<dl class="contact"><div><dt>Email</dt><dd><a class="text-link" href="mailto:${e(CONTACT_EMAIL)}">${e(CONTACT_EMAIL)}</a></dd></div><div><dt>Location</dt><dd>Calgary, Alberta</dd></div></dl>
<p class="muted small">Mention your organization name so we can find your account. Anything that involves extra work is quoted for your approval before it starts.</p>`;
}

/* ------------------------------------------------------------------ invoices (owners only) */

const day = (iso) => { const d = new Date(`${iso}T12:00:00Z`); return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }); };
const STATUS_WORD = { unpaid: "Unpaid", overdue: "Overdue", paid: "Paid" };
const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 10485760 ? 0 : 1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);

/** The hub card status for Invoices, from the counts. Words only; no sums, nothing calculated beyond counting. */
export function invoiceStatusLine(s) {
  if (!s || !s.total) return "No invoices yet";
  if (s.overdue) return `${s.overdue} overdue`;
  if (s.unpaid) return `${s.unpaid} unpaid`;
  return "All paid";
}

function invoiceRow(vm, i) {
  const dates = [`Issued ${day(i.issueDate)}`, i.dueDate && i.status !== "paid" ? `Due ${day(i.dueDate)}` : "", i.status === "paid" && i.paidAt ? `Paid ${day(i.paidAt.slice(0, 10))}` : ""].filter(Boolean).join(" · ");
  const tag = `<span class="inv__status inv__status--${e(i.status)}">${e(STATUS_WORD[i.status] || "")}</span>`;
  const dl = i.hasFile ? `<a class="btn btn--small" href="${e(href(vm, `/services/invoices/${i.id}/download`))}" download>Download PDF<span class="visually-hidden"> for invoice ${e(i.invoiceNumber)} (${e(fileSize(i.size))})</span></a>` : `<span class="muted small">PDF not available</span>`;
  return `<li class="inv"><div class="inv__main"><p class="inv__no">Invoice ${e(i.invoiceNumber)}</p><p class="muted small">${e(dates)}</p>${i.description ? `<p class="small">${e(i.description)}</p>` : ""}</div><div class="inv__side"><p class="inv__amount">${e(formatMoney(i.amountCents))}</p>${tag}</div><div class="inv__act">${dl}</div></li>`;
}

/** The owner's invoice list. Read-only: Framework enters and publishes invoices. */
export function invoicesPage(vm, items) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Client Services", "/services"], ["Invoices"]])}<h1 class="h1 h1--section">Invoices</h1><p class="lead">Your invoices from Framework, in Canadian dollars. Download a PDF any time.</p></header>`;
  const body = items.length
    ? `<ul class="inv-list">${items.map((i) => invoiceRow(vm, i)).join("")}</ul>`
    : `<div class="empty"><strong>No invoices yet</strong>When Framework sends you an invoice, it will appear here.</div>`;
  return `${head}${body}<p class="muted small">Questions about an invoice? Email <a class="text-link" href="mailto:${e(CONTACT_EMAIL)}">${e(CONTACT_EMAIL)}</a> and mention the invoice number. Only owners of your organization can see invoices.</p>`;
}
