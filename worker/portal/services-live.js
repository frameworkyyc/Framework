/**
 * Pages of the connected Client Services area: the hub and the Contact page (Phase 1). Invoices and Support & Change Requests arrive in later phases; until their
 * data exists they are shown as plain "Coming soon" cards (no link), so nothing suggests they can be opened. Rendered from the member's OWN organization only, with
 * no inline style or script. Every dynamic value is escaped.
 */
import { e } from "./ui.js";
import { crumb } from "./guided.js";
import { can } from "./policy.js";
import { formatMoney } from "./repo/invoices.js";
import { CATEGORIES, CATEGORY_LABEL, STATUS_LABEL, SUBMISSION_NOTICE, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, MAX_BODY, scopeOf } from "./repo/support.js";
import { UPLOAD_ERRORS } from "./branding-live.js";

export const CONTACT_EMAIL = "hello@frameworkco.ca";
const href = (vm, p) => `${vm.base}${p}`;

/** One hub card. `to` makes the whole card a link; without it the card is quiet text with a "Coming soon" tag. */
function card(vm, { title, desc, status = "", to = null, attention = false }) {
  const body = to
    ? `<span class="hub__top"><span class="hub__title">${e(title)}</span><span class="hub__arrow tile__arrow" aria-hidden="true">→</span></span><span class="hub__desc">${e(desc)}</span>${status ? `<span class="hub__status"><span class="tile__status">${attention ? `<span class="tile__action"><span class="dot dot--attention" aria-hidden="true"></span>${e(status)}</span>` : `<span class="tile__note">${e(status)}</span>`}</span></span>` : ""}`
    : `<span class="hub__top"><span class="hub__title">${e(title)}</span><span class="tag">Coming soon</span></span><span class="hub__desc">${e(desc)}</span>`;
  return to ? `<li><a class="hub" href="${e(href(vm, to))}">${body}</a></li>` : `<li><div class="hub hub--soon">${body}</div></li>`;
}

/** The hub. Invoices appear only for roles that may see them (owners). `live` says which parts have data behind them. */
export function servicesHub(vm, role, live = {}) {
  const cards = [];
  if (can(role, "invoices.view")) cards.push(card(vm, { title: "Invoices", desc: "View and download your Framework invoices.", status: live.invoices ? live.invoices.line : "", attention: Boolean(live.invoices && live.invoices.attention), to: live.invoices ? "/services/invoices" : null }));
  cards.push(card(vm, { title: "Support & Change Requests", desc: "Ask for a website change, a logo or design revision, or technical help.", status: live.support ? live.support.line : "", attention: Boolean(live.support && live.support.attention), to: live.support ? "/services/requests" : null }));
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

/* ------------------------------------------------------------------ support & change requests */

const STATUS_HELP = Object.freeze({
  new: "Framework has received your request.",
  in_review: "Framework is reviewing your request.",
  quoted: "Framework has sent you a quote. Nothing goes ahead until you approve it.",
  approved: "Framework has recorded that you approved the quote.",
  in_progress: "Framework is working on this.",
  completed: "This request is complete.",
  declined: "Framework isn’t able to take this on. See the reply below.",
});
const CATEGORY_HELP = Object.freeze({
  website_change: "A change to your website. May be quoted before work starts.",
  design_revision: "A change to your logo or other design. May be quoted before work starts.",
  technical_issue: "Something isn’t working, such as a broken page or form.",
  general: "A question or anything else.",
});
export const SUPPORT_ERRORS = Object.freeze({
  ...UPLOAD_ERRORS,
  invalid_category: "Choose what kind of request this is.", invalid_title: "Give your request a short title (up to 120 characters).",
  description_required: "Tell us what you need.", invalid_description: "That description is too long (up to 4,000 characters).",
  message_required: "Write a message first.", invalid_message: "That message is too long (up to 4,000 characters).",
  too_many_open: "You have several open requests already. Please wait for some to be completed before sending another.",
  too_many_attachments: `A request can have up to ${MAX_ATTACHMENTS} attachments in total.`, closed: "This request is closed. Please start a new one.",
  not_allowed: "You can’t do that.", not_found: "That request wasn’t found.",
});
export const when = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-CA", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Edmonton" }); };
export const statusTag = (st) => `<span class="req-status req-status--${e(st)}">${e(STATUS_LABEL[st] || st)}</span>`;
export const notice = () => `<p class="req-notice" role="note"><strong>Requests don’t authorize work.</strong> ${e(SUBMISSION_NOTICE)}</p>`;

export function requestsList(vm, items) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Client Services", "/services"], ["Support & Change Requests"]])}<h1 class="h1 h1--section">Support &amp; Change Requests</h1><p class="lead">Ask for help or a change, and follow what happens.</p></header>`;
  const cta = `<p><a class="btn btn--primary" href="${e(href(vm, "/services/requests/new"))}">New request</a></p>`;
  const rows = items.map((r) => `<li><a class="req-row" href="${e(href(vm, `/services/requests/${r.id}`))}"><span class="req-row__main"><span class="req-row__title">${e(r.title)}${r.unreadForClient ? ' <span class="req-new">New reply</span>' : ""}</span><span class="muted small">${e(CATEGORY_LABEL[r.category] || "")} · Updated ${e(when(r.lastMessageAt))}</span></span>${statusTag(r.status)}<span class="tile__arrow" aria-hidden="true">→</span></a></li>`).join("");
  const list = items.length ? `<ul class="req-list">${rows}</ul>` : `<div class="empty"><strong>No requests yet</strong>Send one whenever you need help or a change. We’ll reply here.</div>`;
  return `${head}${cta}${list}${notice()}`;
}

/** @param o { values, error, csrf } */
export function requestForm(vm, { values = {}, error = "", csrf = "" } = {}) {
  const head = `<header class="page-head page-head--compact">${crumb(vm, [["Client Services", "/services"], ["Support & Change Requests", "/services/requests"], ["New request"]])}<h1 class="h1 h1--section">New request</h1></header>`;
  const banner = error ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(SUPPORT_ERRORS[error] || "That request couldn’t be sent. Please check it and try again.")}</p>` : "";
  const cats = CATEGORIES.map((c) => `<label class="choice__opt"><input type="radio" name="category" value="${c}"${values.category === c ? " checked" : ""} required><span><strong>${e(CATEGORY_LABEL[c])}</strong><br><span class="muted small">${e(CATEGORY_HELP[c])}</span></span></label>`).join("");
  return `${head}${notice()}${banner}<form class="req-form" method="post" action="${e(href(vm, "/services/requests"))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(csrf)}">
<div class="questions"><fieldset class="field choice"><legend>What kind of request is this?</legend>${cats}</fieldset>
<div class="field"><label for="rq-title">Title</label><input id="rq-title" name="title" type="text" maxlength="120" value="${e(values.title || "")}" required></div>
<div class="field"><label for="rq-desc">What do you need?</label><span class="field__hint" id="rq-desc-h">Describe it in as much detail as helps: where it is, what you see, what you would like instead.</span><textarea id="rq-desc" name="description" rows="7" maxlength="${MAX_BODY}" aria-describedby="rq-desc-h" required>${e(values.description || "")}</textarea></div>
<div class="field"><label for="rq-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="rq-files-h">Up to ${MAX_ATTACHMENTS} files, ${MAX_ATTACHMENT_BYTES / 1048576} MB each: images, PDF, text, Word, Excel, PowerPoint or ZIP.</span><input id="rq-files" name="file" type="file" multiple aria-describedby="rq-files-h"></div></div>
<p class="step-nav"><button class="btn btn--primary" type="submit">Send request</button> <a class="btn" href="${e(href(vm, "/services/requests"))}">Cancel</a></p></form>`;
}

function messageHtml(vm, thread, m, root) {
  if (m.kind === "status") return `<li class="msg msg--status"><p><strong>Status: ${e(STATUS_LABEL[m.statusTo] || m.statusTo)}</strong> <span class="muted small">${e(when(m.createdAt))}</span></p>${m.body ? `<p class="msg__body">${e(m.body)}</p>` : ""}</li>`;
  const mine = m.authorType === "client";
  const files = thread.attachments.filter((a) => a.messageId === m.id).map((a) => `<li><a class="text-link" href="${e(href(vm, `${root}/${thread.request.id}/files/${a.id}`))}" download>${e(a.name)}</a> <span class="muted small">(${e(fileSize(a.size))})</span></li>`).join("");
  return `<li class="msg ${mine ? "msg--client" : "msg--staff"}"><p class="msg__who"><strong>${e(mine ? m.authorName || "Your team" : "Framework")}</strong> <span class="muted small">${e(when(m.createdAt))}</span></p><p class="msg__body">${e(m.body)}</p>${files ? `<ul class="msg__files">${files}</ul>` : ""}</li>`;
}

/** @param o { csrf, error, flash } */
export function requestThread(vm, thread, { csrf = "", error = "", flash = "", root = "/services/requests", trail = [["Client Services", "/services"], ["Support & Change Requests", "/services/requests"]], about = "" } = {}) {
  const r = thread.request;
  const head = `<header class="page-head page-head--compact">${crumb(vm, [...trail, [r.title]])}<h1 class="h1 h1--section">${e(r.title)}</h1><p class="req-meta">${statusTag(r.status)} <span class="muted small">${e(CATEGORY_LABEL[r.category] || "")}${about ? ` · ${e(about)}` : ""} · Sent ${e(when(r.createdAt))}</span></p><p class="lead">${e(STATUS_HELP[r.status] || "")}</p></header>`;
  const banner = error ? `<p class="form-banner form-banner--error" role="alert" tabindex="-1" data-error-summary>${e(SUPPORT_ERRORS[error] || "That couldn’t be sent. Please try again.")}</p>`
    : flash === "sent" ? `<p class="form-banner" role="status">Your request was sent. We’ll reply here.</p>` : flash === "replied" ? `<p class="form-banner" role="status">Your message was sent.</p>` : flash === "partial" ? `<p class="form-banner form-banner--error" role="alert">Your message was sent, but an attachment couldn’t be stored. You can send it again as a new message.</p>` : "";
  const warn = scopeOf(r.category) === "change" ? notice() : "";
  const conv = `<ol class="thread" aria-label="Conversation">${thread.messages.map((m) => messageHtml(vm, thread, m, root)).join("")}</ol>`;
  const left = MAX_ATTACHMENTS - thread.attachments.length;
  const reply = r.closed
    ? `<p class="muted">This request is ${r.status === "declined" ? "closed" : "complete"}. For anything else, <a class="text-link" href="${e(href(vm, root === "/services/requests" ? "/services/requests/new" : "/website"))}">start a new request</a>.</p>`
    : `<form class="req-form" method="post" action="${e(href(vm, `${root}/${r.id}/reply`))}" enctype="multipart/form-data" novalidate><input type="hidden" name="csrf" value="${e(csrf)}"><h2 class="h3" id="rp-h">Reply</h2><div class="questions"><div class="field"><label for="rp-body">Your message</label><textarea id="rp-body" name="body" rows="5" maxlength="${MAX_BODY}" required></textarea></div>${left > 0 ? `<div class="field"><label for="rp-files">Attachments <span class="field__opt">Optional</span></label><span class="field__hint" id="rp-files-h">${left} more allowed on this request.</span><input id="rp-files" name="file" type="file" multiple aria-describedby="rp-files-h"></div>` : `<p class="muted small">This request has reached its limit of ${MAX_ATTACHMENTS} attachments.</p>`}</div><p class="step-nav"><button class="btn btn--primary" type="submit">Send message</button></p></form>`;
  return `${head}${banner}${warn}${conv}${reply}`;
}

/** The hub card status for Support: counts only. */
export function supportStatusLine(s) {
  if (!s || !s.total) return "No requests yet";
  const bits = [];
  if (s.unread) bits.push(`${s.unread} new ${s.unread === 1 ? "reply" : "replies"}`);
  if (s.quoted) bits.push(`${s.quoted} ${s.quoted === 1 ? "quote" : "quotes"} to review`);
  bits.push(s.open ? `${s.open} open` : "None open");
  return bits.join(" · ");
}
