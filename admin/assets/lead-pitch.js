/* Framework Admin — Leads: the Pitch section of a lead panel (approach, recipient, subject, body, the automatic footer, save and approve).
   Plain-text drafting only; the server validates pricing, recipient and the approved hash. Text from the server is only ever set as text. */

import { h, api, confirmDialog, fmtDateTime } from "./ui.js";
import { badge, card } from "./kit.js";
import { errText, words } from "./leads-common.js";

const PRICING = /\$\s?\d|\b(price|pricing|cost|rates?|quote|per month|monthly|discount|free)\b/i; // same rule the server enforces on a first email
const MSG_TONE = { draft: "pending", approved: "ok", sending: "warn", sent: "ok", failed: "bad", bounced: "bad", complained: "bad" };
const MSG_WORD = { draft: "Draft", approved: "Approved", sending: "Sending", sent: "Sent", failed: "Failed", bounced: "Bounced", complained: "Complaint" };

/** Did the owner edit the current draft by hand? Edits after the latest "draft" event. */
function editedSinceDraft(timeline) {
  const ev = [...(timeline || [])].sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = (t) => ev.map((e) => e.type).lastIndexOf(t);
  return last("edited") > last("draft");
}

export function pitchSection({ data, reload, ctl }) {
  const { lead, contacts, message: msg } = data;
  const body = h("div", { class: "ld-pitch" });
  const append = (el, ...kids) => el.append(...kids.flat().filter(Boolean)); // native append() would render null as the text "null"
  const wrap = card("Pitch", body, { id: "ld-pitch" });
  wrap.id = "ld-pitch-section";
  const fail = h("p", { class: "adm-field__error", role: "alert", hidden: true });
  const ok = h("p", { class: "ld-saved", role: "status", "aria-live": "polite" });
  const say = (t) => { fail.textContent = t || ""; fail.hidden = !t; };
  ctl.pitch = { dirty: () => false, save: async () => {} };

  if (!msg) {
    if (lead.status === "approved" || lead.status === "ready") {
      const btn = h("button", { class: "btn btn--primary", type: "button" }, "Create draft");
      btn.addEventListener("click", async () => { btn.disabled = true; try { await api(`/leads/${lead.id}/draft`, { method: "POST", body: {} }); await reload(); } catch (err) { btn.disabled = false; say(errText(err)); } });
      append(body, h("p", { class: "adm-muted", text: "There is no email draft yet. It is written from this business’s own details, with no pricing, and you edit it before approving." }), h("div", { class: "adm-actions" }, btn), fail);
    } else append(body, h("p", { class: "rk-quiet", text: lead.status === "new" ? "Approve this lead to get a draft email." : "No email was drafted for this lead." }));
    return wrap;
  }

  const editable = (msg.status === "draft" || msg.status === "approved") && ["approved", "ready", "contacted"].includes(lead.status);
  const state = h("p", { class: "ld-pitch__state" }, badge(MSG_WORD[msg.status] || msg.status, MSG_TONE[msg.status] || ""), " ", h("span", { class: "adm-muted", text: (msg.kind === "followup" ? "Follow-up" : "First email") + (msg.is_test ? " (test)" : "") + (msg.sent_at ? ", sent " + fmtDateTime(msg.sent_at) : "") }));
  const footerBox = h("div", { class: "ld-footer" }, h("span", { class: "ld-label", text: "Added automatically" }), h("pre", { class: "ld-footer__text", text: msg.footer || "" }));

  if (!editable) {
    append(body, state, h("dl", { class: "ld-mail__meta" }, h("div", null, h("dt", { text: "To" }), h("dd", { text: msg.to_email || "" })), h("div", null, h("dt", { text: "Subject" }), h("dd", { text: msg.subject }))),
      h("pre", { class: "ld-mail__body", text: msg.body }), footerBox, msg.error ? h("p", { class: "adm-field__error", text: msg.error }) : null);
    return wrap;
  }

  /* editable */
  const emails = contacts.filter((c) => c.type === "email");
  const eligible = emails.filter((c) => c.eligibility === "eligible" && !c.opted_out_at);
  const current = emails.find((c) => c.id === msg.contact_id);
  const options = eligible.slice();
  if (current && !options.includes(current)) options.unshift(current);
  const to = h("select", { class: "input", id: "ld-to", disabled: options.length ? null : true, "aria-label": "Send to" },
    options.length ? options.map((c) => h("option", { value: String(c.id), selected: c.id === msg.contact_id ? true : null }, c.value + (c.eligibility !== "eligible" || c.opted_out_at ? " (not eligible)" : ""))) : h("option", { value: "" }, "No address you can send to yet"));
  const subject = h("input", { class: "input ld-subject", id: "ld-subject", type: "text", maxlength: "200", value: msg.subject, autocomplete: "off" });
  const text = h("textarea", { class: "input ld-body", id: "ld-body", rows: "14" }, msg.body);
  const count = h("p", { class: "ld-count", "aria-live": "polite" });
  const price = h("p", { class: "ld-warn", role: "status", hidden: true });

  let startSub = msg.subject, startBody = msg.body, startTo = String(msg.contact_id || "");
  const dirty = () => subject.value !== startSub || text.value !== startBody || (to.value || "") !== startTo;
  const update = () => {
    const n = words(text.value);
    count.textContent = `${n} ${n === 1 ? "word" : "words"}. ${n < 90 ? "A little short: 90 to 150 works best." : n > 150 ? "A little long: 90 to 150 works best." : "Good length."}`;
    const hit = msg.kind === "first" ? (subject.value + "\n" + text.value).match(PRICING) : null;
    price.hidden = !hit;
    price.textContent = hit ? `This mentions “${hit[0].trim()}”. First emails must not include pricing, prices or “free”: the server will refuse to approve it.` : "";
    ok.textContent = "";
    saveBtn.disabled = !dirty();
  };

  async function save() {
    await api(`/leads/${lead.id}/message`, { method: "PUT", body: { subject: subject.value, body: text.value, contact_id: to.value ? Number(to.value) : undefined } });
    startSub = subject.value; startBody = text.value; startTo = to.value || "";
  }
  ctl.pitch = { dirty, save };

  const saveBtn = h("button", { class: "btn btn--secondary", type: "button", disabled: true }, "Save");
  saveBtn.addEventListener("click", async () => {
    say(""); saveBtn.disabled = true;
    try { await save(); ctl.flash = "Saved"; await reload(); } catch (err) { saveBtn.disabled = false; say(errText(err)); }
  });

  const approved = msg.status === "approved";
  const blocked = msg.blockers.length > 0;
  const approveBtn = h("button", { class: "btn btn--primary", type: "button", disabled: approved && !dirty() ? true : null }, approved && !dirty() ? "Approved" : "Approve this exact email");
  approveBtn.addEventListener("click", async () => {
    say(""); approveBtn.disabled = true;
    try { if (dirty()) await save(); await api(`/leads/${lead.id}/message/approve`, { method: "POST", body: {} }); await reload(); }
    catch (err) { approveBtn.disabled = false; say(errText(err)); }
  });
  const unapprove = approved ? h("button", { class: "btn btn--secondary", type: "button" }, "Unapprove") : null;
  if (unapprove) unapprove.addEventListener("click", async () => { unapprove.disabled = true; try { await api(`/leads/${lead.id}/message/unapprove`, { method: "POST", body: {} }); await reload(); } catch (err) { unapprove.disabled = false; say(errText(err)); } });
  if (blocked && !approved) approveBtn.disabled = true; // the reasons are listed beneath; editing re-enables it so the server can re-check
  [subject, text, to].forEach((el) => el.addEventListener("input", () => { update(); if (blocked && !approved) approveBtn.disabled = !dirty(); }));
  to.addEventListener("change", () => { update(); if (blocked && !approved) approveBtn.disabled = !dirty(); });

  /* approach switcher */
  const approaches = data.approaches || [];
  const switcher = approaches.length ? h("div", { class: "ld-approaches", role: "radiogroup", "aria-label": "Approach" },
    approaches.map((a) => {
      const b = h("button", { class: "ld-approach", type: "button", role: "radio", "aria-checked": a.id === msg.approach ? "true" : "false" }, a.label);
      b.addEventListener("click", async () => {
        if (a.id === msg.approach) return;
        if ((dirty() || editedSinceDraft(data.timeline)) && !(await confirmDialog({ title: "Replace your edits?", body: "Changing the approach writes a new draft and replaces the subject and text you edited.", confirmLabel: "Replace draft" }))) return;
        say("");
        try { await api(`/leads/${lead.id}/draft`, { method: "POST", body: { approach: a.id } }); await reload(); } catch (err) { say(errText(err)); }
      });
      return b;
    })) : null;

  append(body, state,
    switcher ? h("div", { class: "adm-field" }, h("span", { class: "adm-field__label", text: "Approach" }), switcher) : null,
    h("div", { class: "adm-field" }, h("label", { for: "ld-to", text: "Send to" }), to),
    h("div", { class: "adm-field" }, h("label", { for: "ld-subject", text: "Subject" }), subject),
    h("div", { class: "adm-field" }, h("label", { for: "ld-body", text: "Email" }), text, count, price),
    footerBox,
    blocked ? h("ul", { class: "ld-blockers", "aria-label": "Before this can be approved" }, msg.blockers.map((b) => h("li", { text: b }))) : null,
    approved ? h("p", { class: "ld-note", text: "Approved. Changing the text sends it back to draft and you approve it again." }) : null,
    h("div", { class: "adm-actions" }, approveBtn, saveBtn, unapprove, ok), fail);
  update();
  if (ctl.flash) { ok.textContent = ctl.flash; ctl.flash = ""; }
  return wrap;
}
