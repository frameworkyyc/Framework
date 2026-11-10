/* Framework Admin — Leads: the call queue. "Queue Call" flags a lead to phone on a day (default tomorrow) with an optional reason, WITHOUT contacting it: the lead's
   approval and outreach status are never touched. This file holds the date/note dialog (one lead or many) and the Call card on a lead's page (date, overdue, reschedule, remove, call made).
   API: POST /leads/<id>/call, POST /leads/<id>/call-clear, and the bulk actions queue_call / clear_call. Text from the server is only ever set as text. */

import { h } from "./ui.js";
import { card } from "./kit.js";
import { callDue, callChip, dayWord } from "./leads-common.js";

export const todayEd = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" }); // YYYY-MM-DD
/** The day after today in Edmonton (the default call day). */
export const tomorrowEd = () => { const [y, m, d] = todayEd().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10); };

/**
 * The call date and note in a dialog. `names` says who it is for ("Summit Fencing" or "12 leads"); `current` ({ on, note }) prefills a reschedule.
 * Resolves { call_on, note } or null when cancelled.
 */
export function queueCallDialog({ title = "Queue Call", names, current = null, confirmLabel = "Queue call" }) {
  return new Promise((resolve) => {
    const day = h("input", { class: "input", id: "ld-call-day", type: "date", required: true, min: todayEd(), value: current && current.on && current.on >= todayEd() ? current.on : tomorrowEd() });
    const note = h("textarea", { class: "input", id: "ld-call-note", rows: "3", maxlength: "200", placeholder: "Why call this business? (optional)" }, current && current.note ? current.note : "");
    const dialog = h("dialog", { class: "adm-dialog ld-ocdlg", "aria-labelledby": "ld-call-title" },
      h("form", { method: "dialog" },
        h("h2", { id: "ld-call-title", text: title }),
        h("p", { text: `${names}. This is a reminder to phone them later. It does not mark them as contacted, and their approval and outreach status stay as they are.` }),
        h("div", { class: "adm-field" }, h("label", { for: "ld-call-day", text: "Call on" }), day, h("p", { class: "adm-field__hint", text: "Tomorrow unless you pick another day." })),
        h("div", { class: "adm-field" }, h("label", { for: "ld-call-note", text: "Notes (optional)" }), note),
        h("div", { class: "adm-dialog__actions" },
          h("button", { class: "btn btn--secondary", type: "submit", value: "cancel", formnovalidate: true }, "Cancel"),
          h("button", { class: "btn btn--primary", type: "submit", value: "confirm" }, confirmLabel))));
    dialog.addEventListener("close", () => {
      const out = dialog.returnValue === "confirm" && day.value ? { call_on: day.value, note: note.value.trim() || undefined } : null;
      dialog.remove();
      resolve(out);
    });
    document.body.append(dialog);
    dialog.showModal();
  });
}

/** The Call card on a lead's page: when, why, and the three things you can do. null when the lead is not queued. */
export function callCard({ lead, ready, reschedule, remove, made }) {
  const c = lead.call;
  if (!c) return null;
  const rows = [["Call on", h("span", null, dayWord(c.on), " ", callDue(c))], c.note ? ["Why", c.note] : null, c.queued_at ? ["Queued", dayWord(c.queued_at.slice(0, 10))] : null].filter(Boolean);
  const acts = ready ? h("div", { class: "adm-actions" },
    h("button", { class: "btn btn--primary", type: "button", onclick: made }, "Call made"),
    h("button", { class: "btn btn--secondary", type: "button", onclick: reschedule }, "Reschedule"),
    h("button", { class: "btn btn--secondary", type: "button", onclick: remove }, "Remove from queue")) : null;
  return card("Call queue", h("div", null,
    h("div", { class: "ld-ochead" }, callChip(c), h("span", { class: "adm-muted", text: "A queued call is a reminder, not a contact. Approval and outreach are unchanged." })),
    h("dl", { class: "adm-spec ld-ocfacts" }, rows.map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", null, v)))), acts), { id: "ld-call" });
}

