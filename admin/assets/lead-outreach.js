/* Framework Admin — Leads: outreach tracking on one lead. "Mark as Contacted" (how you reached them, when, a note, a follow-up date), the Contacted
   indicator with its details, and the form that moves it on (Replied, Interested, Not interested, Follow-up needed).
   API: POST /leads/<id>/contacted and POST /leads/<id>/outreach. Text from the server is only ever set as text. */

import { h, fmtDateTime } from "./ui.js";
import { card } from "./kit.js";
import { OUTREACH, METHODS, outreachChip, errText, dayWord } from "./leads-common.js";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" }); // YYYY-MM-DD

/** The "Mark as Contacted" form in a dialog. Resolves { method, note, follow_up_on } or null when cancelled. */
export function markContactedDialog(lead) {
  return new Promise((resolve) => {
    const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    const radios = METHODS.map(([id, label]) => h("label", { class: "ld-method" }, h("input", { type: "radio", name: "ld-method", value: id, required: true }), h("span", { text: label })));
    const note = h("textarea", { class: "input", id: "ld-oc-note", rows: "3", maxlength: "200", placeholder: "What was said, who you spoke to (optional)" });
    const when = h("input", { class: "input", id: "ld-oc-when", type: "date", min: today() });
    const dialog = h("dialog", { class: "adm-dialog ld-ocdlg", "aria-labelledby": "ld-oc-title" },
      h("form", { method: "dialog" },
        h("h2", { id: "ld-oc-title", text: "Mark as Contacted" }),
        h("p", { text: `${lead.name}. Their approval and all their details stay as they are.` }),
        h("fieldset", { class: "adm-field" }, h("legend", { text: "How did you contact them?" }), h("div", { class: "ld-oc-methods" }, radios)),
        h("div", { class: "adm-field" }, h("label", { for: "ld-oc-note", text: "Notes (optional)" }), note),
        h("div", { class: "adm-field" }, h("label", { for: "ld-oc-when", text: "Follow up on (optional)" }), when, h("p", { class: "adm-field__hint", text: "The date and time you contacted them are recorded automatically." })),
        err,
        h("div", { class: "adm-dialog__actions" },
          h("button", { class: "btn btn--secondary", type: "submit", value: "cancel", formnovalidate: true }, "Cancel"),
          h("button", { class: "btn btn--primary", type: "submit", value: "confirm" }, "Mark as Contacted"))));
    dialog.addEventListener("close", () => {
      const ok = dialog.returnValue === "confirm";
      const checked = dialog.querySelector('input[name="ld-method"]:checked');
      const out = ok && checked ? { method: checked.value, note: note.value.trim() || undefined, follow_up_on: when.value || undefined } : null;
      dialog.remove();
      resolve(out);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

const dueBadge = (day) => {
  if (!day) return null;
  const t = today();
  return day < t ? h("span", { class: "adm-chip adm-chip--bad", text: "Overdue" }) : day === t ? h("span", { class: "adm-chip adm-chip--warn", text: "Due today" }) : null;
};

/** The Contacted indicator, its details, and (when tracking is set up) the form that updates the outreach status. null when the lead has not been contacted. */
export function outreachCard({ lead, tracking, post, reload, notify }) {
  const o = lead.outreach;
  if (!o) return null;
  const rows = [
    ["Status", o.status_word],
    ["Contacted by", o.method_word || "Not recorded"],
    ["Contacted on", o.contacted_at ? fmtDateTime(o.contacted_at) : "Not recorded"],
    o.last_contact_at && o.last_contact_at !== o.contacted_at ? ["Last contact", fmtDateTime(o.last_contact_at)] : null,
    o.follow_up_on ? ["Follow up", h("span", null, dayWord(o.follow_up_on), " ", dueBadge(o.follow_up_on))] : null,
    o.note ? ["Notes", o.note] : null,
  ].filter(Boolean);
  const details = h("dl", { class: "adm-spec ld-ocfacts" }, rows.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", null, v))));
  const head = h("div", { class: "ld-ochead" }, outreachChip(o, true), h("span", { class: "adm-muted", text: `${lead.name} has been contacted. Its approval is unchanged.` }));
  if (!tracking) return card("Outreach", h("div", null, head, details, h("p", { class: "ld-hint", text: "Updating the outreach status is waiting for migration 0026 to be approved." })), { id: "ld-outreach" });

  const status = h("select", { class: "input", id: "ld-ou-status", "aria-label": "Outreach status" }, OUTREACH.map(([id, label]) => h("option", { value: id, selected: id === o.status ? true : null }, label)));
  const when = h("input", { class: "input", id: "ld-ou-when", type: "date", min: today(), value: o.follow_up_on || "" });
  const note = h("textarea", { class: "input", id: "ld-ou-note", rows: "3", maxlength: "200", placeholder: "Add a note (optional)" });
  const whenField = h("div", { class: "adm-field" }, h("label", { for: "ld-ou-when", text: "Follow up on" }), when);
  const sync = () => { whenField.hidden = status.value === "not_interested"; };
  status.addEventListener("change", sync); sync();
  const err = h("p", { class: "adm-field__error", role: "alert", hidden: true });
  const go = h("button", { class: "btn btn--primary", type: "submit" }, "Save");
  const form = h("form", { class: "adm-form ld-ocform", onsubmit: async (e) => {
    e.preventDefault(); go.disabled = true; err.hidden = true;
    try { await post("/outreach", { status: status.value, note: note.value.trim() || undefined, follow_up_on: status.value === "not_interested" ? undefined : when.value || undefined }); notify("Outreach updated."); await reload(); }
    catch (x) { go.disabled = false; err.textContent = errText(x); err.hidden = false; }
  } },
    h("div", { class: "adm-field" }, h("label", { for: "ld-ou-status", text: "Update the status" }), status),
    whenField,
    h("div", { class: "adm-field" }, h("label", { for: "ld-ou-note", text: "Notes" }), note),
    h("div", { class: "adm-actions" }, go), err);
  return card("Outreach", h("div", null, head, details, form), { id: "ld-outreach" });
}
