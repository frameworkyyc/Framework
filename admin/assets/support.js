/* Framework Admin — Clients: Support & Change Requests for one client (/admin/clients/:id/support).
   Staff read each request's whole conversation, reply to the client, keep private notes, attach a file, and move the request through its statuses. This file only
   presents and submits: what each status allows, who sees what, and the file checks are decided by the server (worker/portal/admin-support.js). Server text is never
   inserted as HTML. Nothing here deletes a message, a file or a request. */

import { h, api, confirmDialog, errorState, fmtDateTime } from "./ui.js";
import { chip } from "./client-dashboard.js";

const CATEGORY = { website_change: "Website change", design_revision: "Logo or design revision", technical_issue: "Technical issue", general: "General support" };
const STATUS = { new: "New", in_review: "In review", quoted: "Quote sent", approved: "Approved", in_progress: "In progress", completed: "Completed", declined: "Declined" };
const STATUS_ORDER = ["new", "in_review", "quoted", "approved", "in_progress", "completed", "declined"];
const CONFIRM = {
  quoted: ["Mark as Quote sent?", "Tell the client a quote has been sent. Nothing goes ahead until they approve it."],
  approved: ["Record approval?", "Only do this once the client has agreed to the quote. The client will see that Framework recorded their approval."],
  declined: ["Decline this request?", "The request closes and the client can no longer reply on it. Explain why in the note."],
  completed: ["Mark as completed?", "The request closes and the client can no longer reply on it."],
};
const ERROR_TEXT = {
  invalid_status: "Choose a status.", not_billable: "Only website and design change requests can be quoted or approved.",
  invalid_message: "That message is too long (up to 4,000 characters).", message_required: "Write something first.",
  type_not_allowed: "That kind of file isn’t accepted. Use an image, PDF, text, Word, Excel, PowerPoint or ZIP.", invalid_name: "That file name can’t be used.",
  content_mismatch: "The file’s contents don’t match its type.", active_content: "The file contains active content, so it can’t be stored.", pdf_encrypted: "Password-protected PDFs can’t be stored.",
  empty_file: "That file is empty.", file_too_large: "That file is over the 10 MB limit.", too_many_attachments: "This request already has the maximum of 3 attachments.", no_file: "Choose a file first.",
  not_found: "That request no longer exists. The page has been refreshed.", conflict: "That request changed while you were working. The page has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.", storage_unavailable: "File storage isn’t available on this site. Nothing was uploaded.", storage_write_failed: "The file couldn’t be stored just now.",
  session: "Your admin session has ended. Reload the page to sign in again.", denied: "This account isn’t allowed to make that change.", network: "Can’t reach the server. Check your connection and try again.",
};
const GENERIC = "That didn’t work and nothing was changed. Try again, and reload the page if it keeps happening.";
export const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;
const fmtSize = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export async function render(orgId, ctx) {
  const base = "/clients/" + encodeURIComponent(orgId) + "/support";
  let data;
  try { data = await api(base); } catch (err) { return { title: "Support requests", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(orgId), "data-link": "" }, "← " + (data.organization ? data.organization.name : "Client"));
  if (!data.available) return { title: "Support requests", node: h("div", { class: "adm-page" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Support & Change Requests"), h("p", { class: "adm-banner" }, "Support requests aren’t available on this deployment (its database migration hasn’t been applied).")) };

  const root = h("div", { class: "adm-page adm-supportpage" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const opened = new Set();
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
  async function reload() { try { data = await api(base); draw(); } catch { /* the previous view stays */ } }
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
  const fileLink = (rid, a) => h("a", { class: "adm-link", href: `/api/admin${base}/${encodeURIComponent(rid)}/files/${encodeURIComponent(a.id)}/download`, download: "" }, `${a.name} (${fmtSize(a.size)})`);

  function threadView(rid, thread) {
    const r = thread.request;
    const change = r.scope === "change";
    const statuses = STATUS_ORDER.filter((s) => change || (s !== "quoted" && s !== "approved"));
    const select = h("select", { class: "input", id: "st-" + rid, "aria-label": "Status" }, statuses.map((s) => h("option", { value: s, selected: r.status === s ? true : null, text: STATUS[s] })));
    const note = h("textarea", { class: "input", rows: "2", maxlength: "4000", id: "stn-" + rid, "aria-label": "Note to the client with the status change (optional)", placeholder: "Note to the client (optional)" });
    const statusBtn = h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: caps().writes ? null : true, onclick: () => {
      const c = CONFIRM[select.value];
      perform({ confirm: c ? { title: c[0], body: c[1], details: [["Request", r.title], ["New status", STATUS[select.value]]], confirmLabel: "Yes, update" } : null,
        request: () => api(`${base}/${encodeURIComponent(rid)}/status`, { method: "POST", body: { status: select.value, note: note.value.trim() || null } }), success: `Status is now ${STATUS[select.value]}.` });
    } }, "Update status");
    const msgs = thread.messages.map((m) => {
      if (m.kind === "status") return h("li", { class: "adm-msgrow adm-msgrow--status" }, h("p", null, h("strong", { text: `Status: ${STATUS[m.statusTo] || m.statusTo}` }), " ", h("span", { class: "adm-muted", text: `${m.authorName} · ${fmtDateTime(m.createdAt)}` })), m.body ? h("p", { text: m.body }) : null);
      const files = thread.attachments.filter((a) => a.messageId === m.id);
      return h("li", { class: "adm-msgrow" + (m.authorType === "staff" ? " is-staff" : "") + (m.visibility === "internal" ? " is-note" : "") },
        h("p", null, h("strong", { text: m.authorType === "staff" ? (m.authorName || "Framework") : (m.authorName || "Client") }), " ", h("span", { class: "adm-muted", text: fmtDateTime(m.createdAt) }), m.visibility === "internal" ? chip("pending", "Private note, not shown to the client", "info") : null),
        h("p", { class: "adm-msgrow__body", text: m.body }), files.length ? h("ul", { class: "adm-msgrow__files" }, files.map((a) => h("li", null, fileLink(rid, a)))) : null);
    });
    const body = h("textarea", { class: "input", rows: "4", maxlength: "4000", id: "rb-" + rid, required: true });
    const internal = h("input", { type: "checkbox", id: "ri-" + rid });
    const file = h("input", { class: "input", type: "file", id: "rf-" + rid, accept: ".png,.jpg,.jpeg,.webp,.pdf,.txt,.docx,.xlsx,.pptx,.zip" });
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const form = h("form", { class: "adm-form", novalidate: true },
      h("div", { class: "adm-field" }, h("label", { for: body.id, text: "Reply to the client" }), body),
      h("div", { class: "adm-field" }, h("label", { for: file.id, text: "Attach a file (optional)" }), file),
      h("label", { class: "adm-check" }, internal, " Private note: keep it for staff (the client is not shown it or emailed)"),
      err,
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: caps().writes ? null : true }, "Send")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      const f = file.files && file.files[0];
      if (f && !caps().storage) { err.textContent = errorText({ code: "storage_unavailable" }); err.hidden = false; return; }
      let sent = false;
      const isNote = internal.checked;
      await perform({
        request: async () => {
          const r1 = await api(`${base}/${encodeURIComponent(rid)}/reply`, { method: "POST", body: { body: body.value, internal: isNote } }); sent = true;
          if (f) { const fd = new FormData(); fd.append("file", f); fd.append("meta", JSON.stringify({ messageId: r1.messageId })); await api(`${base}/${encodeURIComponent(rid)}/attach`, { method: "POST", body: fd }); }
          return r1;
        },
        success: isNote ? "Private note saved." : "Reply sent. The client will see it in the portal.",
        onError: (e) => (sent ? `Your message was saved, but the file wasn’t attached: ${errorText(e)}` : errorText(e)),
      });
    });
    return h("div", { class: "adm-thread" },
      change ? h("p", { class: "adm-banner" }, "A change request may be billable. Send a quote before any work starts, and set Approved only once the client has agreed to it.") : null,
      h("div", { class: "adm-statusrow" }, h("label", { for: select.id, class: "adm-field__label", text: "Status" }), select, note, statusBtn),
      h("ol", { class: "adm-msglist", "aria-label": "Conversation" }, msgs),
      r.closed ? h("p", { class: "adm-muted", text: "This request is closed: the client can’t reply, but you can still add a reply or a private note." }) : null,
      form);
  }

  async function openThread(rid, host) {
    host.replaceChildren(h("p", { class: "adm-muted", text: "Loading…" }));
    try {
      const thread = await api(`${base}/${encodeURIComponent(rid)}`);
      host.replaceChildren(threadView(rid, thread));
      if (caps().writes && thread.request.needsLook) { try { await api(`${base}/${encodeURIComponent(rid)}/seen`, { method: "POST", body: {} }); } catch { /* a courtesy: the thread is unaffected */ } }
    } catch (e) { host.replaceChildren(h("p", { class: "adm-banner", text: errorText(e) })); }
  }

  function card(r) {
    const host = h("div", { class: "adm-reqbody" });
    const det = h("details", { class: "adm-acc adm-req", id: "req-" + r.id, open: opened.has(r.id) ? true : null, ontoggle: (ev) => { if (ev.target.open) { opened.add(r.id); openThread(r.id, host); } else opened.delete(r.id); } },
      h("summary", { class: "adm-acc__sum" }, h("span", { class: "adm-acc__title" }, r.title), h("span", { class: "adm-acc__meta" },
        r.needsLook ? chip("pending", "New activity", "info") : null, chip(r.closed ? "plain" : "ok", STATUS[r.status]), chip(r.scope === "change" ? "warn" : "plain", r.scope === "change" ? "Change (may be billable)" : "Support"))),
      h("div", { class: "adm-acc__body" }, h("p", { class: "adm-sub", text: `${CATEGORY[r.category]} · opened ${fmtDateTime(r.createdAt)} · last message ${fmtDateTime(r.lastMessageAt)}` }), host));
    if (opened.has(r.id)) openThread(r.id, host);
    return det;
  }

  function draw() {
    const s = data.summary;
    root.replaceChildren(...[
      back,
      h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, data.organization.name), h("h1", { class: "adm-title", tabindex: "-1" }, "Support & Change Requests"),
        h("p", { class: "adm-sub" }, "Read each request, reply to the client, keep private notes and update the status. Nothing is deleted."))),
      caps().writes ? null : h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can read requests, but not reply or change them."),
      live,
      h("p", { class: "adm-inv__chips" }, [s.unseen ? chip("pending", plural(s.unseen, "request") + " with new activity", "info") : null, chip("plain", s.total ? `${s.open} open of ${s.total}` : "No requests yet")]),
      data.requests.length ? h("div", { class: "adm-accgroup" }, data.requests.map(card)) : h("p", { class: "adm-muted", text: "This client hasn’t sent any requests." }),
    ].filter(Boolean));
  }
  draw();
  return { title: "Support requests — " + data.organization.name, node: root };
}
