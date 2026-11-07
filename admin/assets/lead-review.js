/* Framework Admin — Leads: the review screen. Shows exactly what would be sent (POST /leads/send/preview), one block per recipient, then one explicit
   "Send N emails" step. Nothing is sent without that final confirmation. Used from the list (bulk) and from one lead (Review & send). Text only, no markup insertion. */

import { h, api, errorState, confirmDialog, stateBlock } from "./ui.js";
import { badge } from "./kit.js";
import { errText, codeText, iconLabel } from "./leads-common.js";

const BATCH = 10;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** ids: lead ids to review. mode "approve" lets each block approve its email first (from Approved); "send" is for emails that are already approved.
    onBack(changed) returns to the view that opened the review. */
export function reviewScreen({ ids, mode = "send", onBack, notify }) {
  let queue = ids.slice();
  const root = h("section", { class: "ld-review", "aria-labelledby": "ld-review-title" });
  const body = h("div");
  const title = h("h2", { class: "ld-review__title", id: "ld-review-title", tabindex: "-1", text: mode === "approve" ? "Review emails" : "Review & send" });
  let changed = false;
  const back = () => onBack(changed);
  root.append(h("button", { class: "btn btn--secondary adm-small ld-back", type: "button", onclick: back }, iconLabel("back", "Back")), title, body);

  async function load() {
    const batch = queue.slice(0, BATCH);
    body.replaceChildren(stateBlock({ title: "Loading the emails…", body: "Building exactly what would be sent." }));
    try {
      const [prev, st] = await Promise.all([api("/leads/send/preview", { method: "POST", body: { ids: batch } }), api("/leads/status").catch(() => null)]);
      show(prev, st, batch);
    } catch (err) { body.replaceChildren(errorState(err, load)); }
  }

  function banner(prev, st, emails) {
    const sending = st && st.setup && st.setup.sending;
    const masked = (sending && sending.test_recipient) || (emails[0] && emails[0].to) || "the test address";
    if (prev.mode === "test") return h("p", { class: "ld-banner ld-banner--test", role: "status" }, h("strong", { text: "TEST MODE: " }), `every email goes to ${masked}, nothing reaches the business.`);
    if (prev.mode === "live") return h("p", { class: "ld-banner ld-banner--live", role: "status" }, h("strong", { text: "LIVE: " }), "these emails go to the real businesses.");
    return h("p", { class: "ld-banner ld-banner--off", role: "status" }, h("strong", { text: "Sending is off: " }), (sending && sending.blocked_reason) || "you can review the emails, but nothing can be sent until sending is set up.");
  }

  function mailBlock(e, prev) {
    const needsApproval = mode === "approve" && e.blockers.length > 0 && e.blockers.every((b) => /approv/i.test(b));
    const blocked = e.blockers.length > 0 && !needsApproval;
    const state = blocked ? badge("Blocked, not sent", "bad") : needsApproval ? badge("Needs your approval", "warn") : badge(mode === "approve" ? "Approved" : "Ready", "ok");
    const actions = [];
    if (needsApproval) {
      const btn = h("button", { class: "btn btn--primary", type: "button" }, "Approve this email");
      btn.addEventListener("click", async () => {
        btn.disabled = true; btn.textContent = "Approving…";
        try { await api(`/leads/${encodeURIComponent(e.lead_id)}/message/approve`, { method: "POST", body: {} }); changed = true; await load(); }
        catch (err) { btn.disabled = false; btn.textContent = "Approve this email"; fail.textContent = errText(err); fail.hidden = false; }
      });
      actions.push(btn);
    }
    if (needsApproval || blocked) actions.push(h("a", { class: "btn btn--secondary", href: "/admin/leads/" + encodeURIComponent(e.lead_id), "data-link": "" }, "Open lead to edit"));
    const fail = h("p", { class: "adm-field__error", role: "alert", hidden: true });
    return h("article", { class: "ld-mail" + (blocked ? " ld-mail--blocked" : "") },
      h("div", { class: "ld-mail__head" }, h("h3", { class: "ld-mail__name", text: e.name }), state),
      h("dl", { class: "ld-mail__meta" },
        h("div", null, h("dt", { text: "To" }), h("dd", { text: prev.mode === "test" ? (e.real_to || "") : (e.to || e.real_to || "") })),
        prev.mode === "test" && e.to ? h("div", null, h("dt", { text: "Sent instead to" }), h("dd", { text: e.to || "" })) : null,
        h("div", null, h("dt", { text: "Subject" }), h("dd", { text: e.subject }))),
      h("pre", { class: "ld-mail__body", text: e.body }),
      h("div", { class: "ld-mail__footer" }, h("span", { class: "ld-label", text: "Added automatically" }), h("pre", { class: "ld-mail__foot", text: e.footer })),
      e.blockers.length ? h("ul", { class: "ld-blockers", "aria-label": "Why this can’t be sent" }, e.blockers.map((b) => h("li", { text: b }))) : null,
      actions.length ? h("div", { class: "adm-actions" }, actions) : null, fail);
  }

  function show(prev, st, batch) {
    const emails = Array.isArray(prev.emails) ? prev.emails : [];
    const sendable = emails.filter((e) => e.blockers.length === 0);
    const extra = queue.length - batch.length;
    const out = [];
    out.push(banner(prev, st, emails));
    if (extra > 0) out.push(h("p", { class: "ld-note", role: "status", text: `You selected ${queue.length}. Emails go out ${BATCH} at a time: this is the first ${batch.length}, and the other ${extra} come next.` }));
    if (!emails.length) out.push(h("p", { class: "adm-muted", text: "There is nothing to review for the selected leads." }));
    out.push(h("div", { class: "ld-mails" }, emails.map((e) => mailBlock(e, prev))));

    const n = sendable.length, off = prev.mode === "off";
    const send = h("button", { class: "btn btn--primary ld-send", type: "button", disabled: !n || off ? true : null }, n ? `Send ${plural(n, "email")}` : "Nothing to send yet");
    send.addEventListener("click", async () => {
      const test = prev.mode === "test";
      const ok = await confirmDialog({ title: `Send ${plural(n, "email")}?`, body: test ? "Test mode: these go to the test address only. Nothing reaches the business." : "These go to the real businesses. This cannot be undone.", details: sendable.map((e) => [e.name, e.real_to || e.to]), confirmLabel: `Send ${plural(n, "email")}` });
      if (!ok) return;
      send.disabled = true; send.textContent = "Sending…";
      try {
        const res = await api("/leads/send", { method: "POST", body: { items: sendable.map((e) => ({ lead_id: e.lead_id, hash: e.hash })) } });
        changed = true;
        results(res.results || [], emails, prev, batch);
      } catch (err) { send.disabled = false; send.textContent = `Send ${plural(n, "email")}`; notify(errText(err)); }
    });
    out.push(h("div", { class: "ld-sendbox" },
      off ? h("p", { class: "adm-muted", text: "Sending is off, so the button is disabled." }) : n < emails.length ? h("p", { class: "adm-muted", text: `${plural(emails.length - n, "email")} can’t be sent and will be left out.` }) : null,
      send));
    body.replaceChildren(...out.filter(Boolean)); // filter: replaceChildren(null) would render the text "null"
    title.focus({ preventScroll: true });
  }

  function results(list, emails, prev, batch) {
    const byId = new Map(emails.map((e) => [e.lead_id, e]));
    const okN = list.filter((r) => r.ok).length;
    queue = queue.slice(batch.length);
    const remaining = queue;
    const rows = list.map((r) => h("li", { class: "ld-result" },
      h("span", { class: "ld-result__name", text: (byId.get(r.lead_id) || {}).name || r.lead_id }),
      r.ok ? badge(prev.mode === "test" ? "Test sent" : "Sent", "ok") : badge("Failed", "bad"),
      r.ok ? null : h("span", { class: "ld-result__why", text: codeText(r.error) })));
    body.replaceChildren(...[
      h("p", { class: "ld-banner " + (okN === list.length ? "ld-banner--test" : "ld-banner--off"), role: "status" }, h("strong", { text: `${okN} of ${list.length} sent.` }), okN === list.length ? "" : " Check the ones that failed below."),
      h("ul", { class: "ld-results" }, rows),
      h("div", { class: "adm-actions" },
        remaining.length ? h("button", { class: "btn btn--primary", type: "button", onclick: load }, `Review the next ${Math.min(BATCH, remaining.length)} (${remaining.length} left)`) : null,
        h("button", { class: remaining.length ? "btn btn--secondary" : "btn btn--primary", type: "button", onclick: back }, "Done")),
    ].filter(Boolean));
    title.focus({ preventScroll: true });
  }

  load();
  return root;
}
