/* Framework Admin — Approved Emails: /admin/approved-emails. The addresses that may be invited to the portal and may receive Client Services emails. Kept in the portal
   database and used together with the Cloudflare setting PORTAL_INVITE_ALLOWLIST (approved = in either), so nothing approved before this page existed stops working.
   Removing an address stops future invitations and emails to it; it never ends anyone's existing access. Server text is never inserted as HTML. */

import { h, api, fmtDate, stateBlock, errorState, confirmDialog } from "./ui.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const ERRORS = {
  invalid_email: "Enter one plain email address, for example name@example.com.",
  invalid_note: "The note must be 120 characters or fewer.",
  list_full: "The list is full. Remove an address first.",
  writes_disabled: "Changes are switched off on this site.",
};
const errorText = (e) => ERRORS[e && e.code] || (e && e.data && ERRORS[e.data.error]) || "That didn’t work and nothing was changed. Please try again.";

export async function render(ctx) {
  const root = h("div", { class: "adm-page adm-approved" });
  let busy = false;
  const say = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const speak = (text, tone = "info") => { say.textContent = text; say.className = "adm-msg is-" + tone; say.setAttribute("role", tone === "error" ? "alert" : "status"); say.hidden = !text; if (text) say.focus({ preventScroll: true }); };

  async function load() {
    let data;
    try { data = await api("/approved-emails"); } catch (err) { root.replaceChildren(errorState(err, () => ctx.retry())); return; }
    draw(data);
  }

  async function act(request, success) {
    if (busy) return;
    busy = true;
    root.setAttribute("aria-busy", "true");
    let outcome;
    try { outcome = { tone: "success", text: success(await request()) }; } catch (err) { outcome = { tone: "error", text: errorText(err) }; }
    try { draw(await api("/approved-emails")); } catch { /* the old view stays; the message says what happened */ }
    busy = false;
    root.removeAttribute("aria-busy");
    speak(outcome.text, outcome.tone);
  }

  function draw(data) {
    const writes = Boolean(data.capabilities && data.capabilities.writes) && data.available;
    const email = h("input", { id: "ae-email", class: "input", type: "email", maxlength: "254", autocomplete: "off", spellcheck: "false", autocapitalize: "none", required: true, "aria-describedby": "ae-email-h", disabled: writes ? null : true });
    const note = h("input", { id: "ae-note", class: "input", type: "text", maxlength: "120", autocomplete: "off", disabled: writes ? null : true, placeholder: "Optional, for example “Owner, Acme Co”" });
    const form = h("form", { class: "adm-form adm-form--inline adm-approved__add", novalidate: true, "aria-label": "Approve an email address", onsubmit: (ev) => {
      ev.preventDefault();
      const value = email.value.trim();
      if (!value) { speak(ERRORS.invalid_email, "error"); email.setAttribute("aria-invalid", "true"); email.focus(); return; }
      email.removeAttribute("aria-invalid");
      act(() => api("/approved-emails", { method: "POST", body: note.value.trim() ? { email: value, note: note.value.trim() } : { email: value } }), (r) => {
        email.value = ""; note.value = "";
        return r.changed ? `${r.email} is approved.` : `${r.email} was already approved.`;
      });
    } },
      h("div", { class: "adm-field" }, h("label", { for: "ae-email", text: "Email address" }), email, h("p", { class: "adm-field__hint", id: "ae-email-h", text: "One address at a time. Matching is exact: there are no wildcards or domains." })),
      h("div", { class: "adm-field" }, h("label", { for: "ae-note", text: "Note (optional)" }), note),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: writes ? null : true }, "Approve address")));

    const rows = data.emails.map((e) => h("li", { class: "adm-approved__row" },
      h("div", { class: "adm-approved__text" },
        h("span", { class: "adm-approved__email", text: e.email }),
        h("span", { class: "adm-approved__meta", text: [e.note, `Added ${fmtDate(e.addedAt)} by ${e.addedBy}`].filter(Boolean).join(" · ") })),
      writes ? h("button", { class: "adm-linkbtn adm-approved__remove", type: "button", "aria-label": `Remove ${e.email}`, onclick: async () => {
        if (!(await confirmDialog({ title: "Remove this address?", body: "No new invitations or emails can go to it (unless the Cloudflare setting also lists it). Anyone who already has portal access keeps it.", details: [["Address", e.email]], confirmLabel: "Remove" }))) return;
        act(() => api("/approved-emails/remove", { method: "POST", body: { email: e.email } }), (r) => (r.stillApprovedBySetting ? `${r.email} was removed from this list, but the Cloudflare setting still approves it. Remove it from PORTAL_INVITE_ALLOWLIST too.` : r.changed ? `${r.email} was removed.` : `${r.email} was already removed.`));
      } }, "Remove") : null));

    const pending = data.setting.addresses.filter((a) => !a.inList);
    const setting = data.setting.addresses.length ? h("section", { class: "adm-approved__setting", "aria-labelledby": "ae-setting-h" },
      h("h2", { id: "ae-setting-h", class: "adm-approved__h", text: "Also approved in the Cloudflare setting" }),
      h("p", { class: "adm-sub", text: "These addresses come from the Cloudflare secret PORTAL_INVITE_ALLOWLIST and are approved too. They can only be removed there. Add them to the list above to manage them here; once all are added, the secret can be deleted." }),
      h("ul", { class: "adm-approved__list adm-approved__list--setting", "aria-label": "Addresses approved in the Cloudflare setting" }, data.setting.addresses.map((a) => h("li", { class: "adm-approved__row" },
        h("span", { class: "adm-approved__email", text: a.email }), h("span", { class: "adm-approved__meta", text: a.inList ? "Also in the list above" : "Setting only" })))),
      writes && pending.length ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => act(() => api("/approved-emails/import", { method: "POST", body: {} }), (r) => `${plural(r.added, "address", "addresses")} added to the list.`) }, `Add ${plural(pending.length, "address", "addresses")} to the list`) : null) : null;

    root.replaceChildren(...[
      h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Approved Emails"),
        h("p", { class: "adm-sub" }, "Only these addresses can be invited to a client portal or receive its invoice and support emails. Removing one never ends anyone’s existing access."))),
      data.available ? null : h("p", { class: "adm-banner" }, "The approved list isn’t available on this deployment yet (its database migration hasn’t been applied). Only the Cloudflare setting applies."),
      data.available && !data.capabilities.writes ? h("p", { class: "adm-banner" }, "Changes are switched off on this site: you can look at the list, but not change it.") : null,
      form,
      say,
      data.emails.length ? h("ul", { class: "adm-approved__list", "aria-label": "Approved email addresses" }, rows)
        : data.available ? stateBlock({ title: "No addresses approved here yet", body: "Add the first address above. Addresses approved in the Cloudflare setting still work." }) : null,
      data.emails.length ? h("p", { class: "adm-sub", role: "status" }, `${plural(data.emails.length, "approved address", "approved addresses")}.`) : null,
      setting,
    ].filter(Boolean)); // replaceChildren turns a null into the text "null"
  }

  root.setAttribute("aria-busy", "true");
  await load();
  root.removeAttribute("aria-busy");
  return { title: "Approved Emails", node: root };
}
