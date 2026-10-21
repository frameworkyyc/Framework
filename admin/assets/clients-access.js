/* Framework Admin — Clients: access management (create a client, invite people, send / resend / replace / revoke invitations, change roles, remove access).
   This file only presents and submits. Every rule (who may do what, the last-owner protection, expiry, duplicates, delivery state) is enforced by the
   server APIs (worker/portal/admin-access.js); nothing here decides access. Server text is never inserted as HTML, and only friendly copy for known codes is shown. */

import { h, api, confirmDialog, errorState, fmtDate, fmtDateTime } from "./ui.js";

const ROLE_LABEL = { owner: "Owner", member: "Member" };
const ROLE_HELP = {
  owner: "Owners can do everything members can, and can also see the organization’s team list.",
  member: "Members can use the portal and edit the Business Profile. They can’t see the team list.",
};
const CHANNEL = { workos: "WorkOS", resend: "Framework email" };

/** Plain-language copy for the server's error codes. Anything unknown gets the generic line: no internals are ever shown. */
const FAILURE_REASON = {
  workos_unreachable: "WorkOS could not be reached.",
  workos_unauthorized: "WorkOS refused the request (check the portal’s WorkOS key).",
  workos_rate_limited: "WorkOS asked us to slow down.",
  workos_rejected: "WorkOS did not accept the request.",
  workos_unavailable: "WorkOS had a problem on its side.",
  workos_bad_response: "WorkOS answered in a way we couldn’t use.",
  workos_not_configured: "WorkOS isn’t configured on this site.",
  missing_workos_invitation: "There is no WorkOS invitation to resend.",
  email_provider_failed: "The email provider did not accept the message.",
  email_not_configured: "Email sending isn’t configured on this site.",
  provider_error: "The provider returned an unexpected error.",
  sending_disabled: "Sending is switched off on this site.",
};
const ERROR_TEXT = {
  invalid_name: "Enter the business name.",
  invalid_slug: "The URL name can only use lower-case letters, digits and single hyphens (2 to 48 characters).",
  slug_taken: "That URL name is already used by another client. Choose a different one.",
  invalid_website_url: "The website must be a full address starting with https://",
  invalid_email: "Enter a valid email address.",
  invalid_role: "Choose Owner or Member.",
  already_pending: "There is already a pending invitation for this email address. Revoke it first, or use Send or Resend on it.",
  already_member: "This person already has access to this organization.",
  organization_inactive: "This organization isn’t active, so it can’t receive invitations.",
  last_owner: "This is the organization’s only active owner. Make someone else an owner first.",
  still_pending: "This invitation is still valid. Revoke it first, or resend it.",
  already_revoked: "This invitation was already revoked.",
  already_expired: "This invitation has already expired. Replace it to invite the person again.",
  already_accepted: "This invitation was already accepted.",
  not_revoked: "This person still has access.",
  expired_replace_required: "This invitation has expired. Replace it with a new invitation first.",
  already_submitted: "This invitation was already submitted. Use Resend instead.",
  not_yet_submitted: "This invitation hasn’t been sent yet. Use Send first.",
  invitation_revoked: "This invitation was revoked.",
  send_in_progress: "Another request is already working on this invitation. Wait a moment, then check its status.",
  not_found: "That item no longer exists. The page has been refreshed.",
  writes_disabled: "Changes are switched off on this site, so nothing was changed.",
  sending_disabled: "Sending is switched off on this site. The invitation was saved but nothing was sent.",
  recipient_not_allowed: "That address isn’t on the approved list for the controlled test, so nothing was created or sent.",
  recipient_allowlist_missing: "Invitations are locked on this site: no approved recipients are configured. Nothing was created or sent.",
  provider_not_configured: "The email and WorkOS settings are incomplete on this site. Nothing was sent.",
  delivery_tracking_unavailable: "Delivery tracking isn’t available on this database. Nothing was sent.",
  delivery_unrecorded: "The provider was asked, but the result couldn’t be saved. Check the invitation’s status before trying again.",
  session: "Your admin session has ended. Reload the page to sign in again.",
  denied: "This account isn’t allowed to make that change.",
  network: "Couldn’t reach the server. Nothing was changed; check your connection and try again.",
  unavailable: "The portal database isn’t available right now. Nothing was changed.",
};
const GENERIC = "Something went wrong and the change may not have been made. Refresh the page to see the current state, then try again.";
export const errorText = (err) => ERROR_TEXT[err && err.code] || GENERIC;

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/* ---------- Invitation and delivery wording (delivery is never described as arrival in an inbox) ---------- */

function isExpired(i) {
  return i.status === "expired" || Boolean(i.past_expiry);
}

function statusView(i) {
  if (i.status === "accepted") return { label: "Accepted", note: i.accepted_at ? fmtDate(i.accepted_at) : "" };
  if (i.status === "revoked") {
    const cleanup = i.workos_cleanup === "pending" ? "Access is closed, but the WorkOS invitation still needs to be cancelled." : i.workos_cleanup === "done" ? "The WorkOS invitation was cancelled too." : "";
    return { label: "Revoked", note: [i.revoked_at ? fmtDate(i.revoked_at) : "", cleanup].filter(Boolean).join(" · "), warn: i.workos_cleanup === "pending" };
  }
  if (isExpired(i)) return { label: "Expired", note: `Expired ${fmtDate(i.expires_at)}. It can’t be sent again; replace it to invite this person again.`, warn: true };
  return { label: "Pending", note: `Valid until ${fmtDate(i.expires_at)}` };
}

function deliveryView(i) {
  const d = i.delivery || { state: "not_tracked" };
  const when = d.attempted_at ? fmtDateTime(d.attempted_at) : "";
  if (d.state === "not_tracked") return { label: "Not tracked", note: "Delivery tracking isn’t available on this database." };
  if (d.state === "submitted") return { label: `Submitted to ${CHANNEL[d.channel] || "provider"}`, note: `${when ? when + " · " : ""}The provider accepted the request. Arrival in the inbox isn’t confirmed.` };
  if (d.state === "failed") return { label: "Send failed", note: `${when ? when + " · " : ""}${FAILURE_REASON[d.error] || "The provider request failed."} Nothing was sent.`, warn: true };
  return { label: "Not sent", note: i.status === "pending" && !isExpired(i) ? "Saved, but no email has been sent." : "" };
}

/* ---------- Shared bits ---------- */

const textButton = (label, props = {}) => h("button", { class: "btn btn--secondary adm-small", type: "button", ...props }, label);

function field({ id, label, hint, error, input }) {
  const err = error ? h("p", { class: "adm-field__error", id: id + "-e", role: "alert", text: error }) : null;
  const describe = [hint ? id + "-h" : "", err ? id + "-e" : ""].filter(Boolean).join(" ");
  if (describe) input.setAttribute("aria-describedby", describe);
  if (error) input.setAttribute("aria-invalid", "true");
  return h("div", { class: "adm-field" + (error ? " has-error" : "") }, h("label", { for: id, text: label }), hint ? h("p", { class: "adm-field__hint", id: id + "-h", text: hint }) : null, input, err);
}

/* ================================================================== New client (list page) */

/**
 * The "New client" action and its form. Returns { button, panel }. Creating the organization sends the administrator straight to its page, where the
 * invitation form is waiting (?welcome=1), so the next step (the first owner) is obvious.
 */
export function newClientPanel({ navigate, writesEnabled = true }) {
  let busy = false;
  const panel = h("section", { class: "adm-panel", id: "adm-new-client", "aria-labelledby": "adm-new-client-h", hidden: true });
  const button = h("button", { class: "btn btn--primary", type: "button", "aria-expanded": "false", "aria-controls": "adm-new-client", disabled: writesEnabled ? null : true, title: writesEnabled ? null : "Changes are switched off on this site" }, "New client");

  function show(errors = {}, values = { name: "", website: "", slug: "" }, message = "") {
    const name = h("input", { id: "nc-name", class: "input", type: "text", maxlength: "120", autocomplete: "off", required: true, value: values.name });
    const website = h("input", { id: "nc-website", class: "input", type: "text", inputmode: "url", autocapitalize: "none", spellcheck: "false", autocomplete: "off", value: values.website, placeholder: "https://example.com" });
    const slug = h("input", { id: "nc-slug", class: "input", type: "text", maxlength: "48", autocapitalize: "none", spellcheck: "false", autocomplete: "off", value: values.slug, placeholder: "made from the name" });
    const submit = h("button", { class: "btn btn--primary", type: "submit" }, "Create client");
    const cancel = h("button", { class: "btn btn--secondary", type: "button", onclick: () => close(true) }, "Cancel");
    const status = h("p", { class: "adm-msg" + (message ? " is-error" : ""), role: "alert", tabindex: "-1", text: message });
    const form = h("form", { class: "adm-form", novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      if (busy) return;
      const v = { name: name.value.trim(), website: website.value.trim(), slug: slug.value.trim() };
      if (!v.name) return show({ name: ERROR_TEXT.invalid_name }, v);
      busy = true; submit.disabled = true; cancel.disabled = true; submit.textContent = "Creating…";
      // a bare domain is accepted the way the portal's own website field accepts it: the https:// is added; the server still validates the result
      const site = v.website && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v.website) ? "https://" + v.website : v.website;
      try {
        const body = { name: v.name };
        if (site) body.websiteUrl = site;
        if (v.slug) body.slug = v.slug;
        const out = await api("/clients", { method: "POST", body });
        navigate("/admin/clients/" + encodeURIComponent(out.organization.id) + "?welcome=1");
      } catch (err) {
        busy = false;
        const byField = { invalid_name: "name", invalid_slug: "slug", slug_taken: "slug", invalid_website_url: "website" }[err && err.code];
        show(byField ? { [byField]: errorText(err) } : {}, v, byField ? "" : errorText(err));
        (byField ? document.getElementById("nc-" + byField) : panel.querySelector(".adm-msg"))?.focus();
      }
    } },
      h("h2", { id: "adm-new-client-h", text: "New client" }),
      h("p", { class: "adm-sub", text: "Creates the organization only. You’ll invite its first owner next. Nothing is emailed." }),
      field({ id: "nc-name", label: "Business name", error: errors.name, input: name }),
      field({ id: "nc-website", label: "Website (optional)", hint: "The client’s current or new site.", error: errors.website, input: website }),
      field({ id: "nc-slug", label: "URL name (optional)", hint: "Lower-case letters, digits and hyphens. It becomes part of the portal address. Leave it blank to make one from the business name.", error: errors.slug, input: slug }),
      status,
      h("div", { class: "adm-actions" }, submit, cancel),
    );
    panel.replaceChildren(form);
  }

  function close(refocus) {
    panel.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  }
  button.addEventListener("click", () => {
    if (!panel.hidden) return close(true);
    show();
    panel.hidden = false;
    button.setAttribute("aria-expanded", "true");
    document.getElementById("nc-name").focus();
  });
  panel.addEventListener("keydown", (e) => { if (e.key === "Escape") close(true); });
  return { button, panel };
}

/* ================================================================== Access sections (detail page) */

/**
 * The Invitations and Members sections for one organization. Returns a container that loads itself.
 * @param opts { orgId, orgName, welcome }
 */
export function accessSections({ orgId, orgName, welcome = false }) {
  const root = h("div", { class: "adm-access" });
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  let data = null;
  let busy = false;
  const base = "/clients/" + encodeURIComponent(orgId);

  function say(text, tone = "info", { focus = true } = {}) {
    live.textContent = text;
    live.className = "adm-msg is-" + tone;
    live.setAttribute("role", tone === "error" || tone === "warning" ? "alert" : "status");
    live.hidden = !text;
    if (text && focus) live.focus({ preventScroll: false });
  }

  async function load() {
    root.setAttribute("aria-busy", "true");
    try {
      data = await api(base + "/access");
      draw();
    } catch (err) {
      root.replaceChildren(errorState(err, () => { root.replaceChildren(loading()); load(); }));
    } finally {
      root.removeAttribute("aria-busy");
    }
  }
  const loading = () => h("p", { class: "adm-loading", role: "status" }, "Loading people and invitations…");

  /**
   * One administrative action: confirm (when asked), lock the whole panel against double submits, call the API, report the outcome in plain words,
   * then reload the real state from the server.
   */
  async function perform({ confirm, request, onSuccess, onFailure }) {
    if (busy) return;
    if (confirm && !(await confirmDialog(confirm))) return;
    busy = true;
    lock(true);
    say("Working…", "info", { focus: false });
    let outcome;
    try {
      outcome = onSuccess(await request());
    } catch (err) {
      outcome = (onFailure && onFailure(err)) || { tone: "error", text: errorText(err) };
    }
    busy = false;
    await refreshQuietly();
    say(outcome.text, outcome.tone);
    lock(false);
  }
  async function refreshQuietly() {
    try { data = await api(base + "/access"); draw(); } catch { /* the previous view stays; the message above says what happened */ }
  }
  function lock(on) {
    root.toggleAttribute("aria-busy", on);
    root.querySelectorAll("button, input, select").forEach((el) => {
      if (on) { el.dataset.wasDisabled = el.disabled ? "1" : ""; el.disabled = true; }
      else if (el.dataset.wasDisabled === "") el.disabled = false;
    });
  }

  /* ----- invitations ----- */

  function inviteForm(caps) {
    const email = h("input", { id: "iv-email", class: "input", type: "email", maxlength: "254", autocomplete: "off", spellcheck: "false", autocapitalize: "none", required: true });
    const radio = (value, checked) => h("label", { class: "adm-choice" }, h("input", { type: "radio", name: "iv-role", value, checked: checked ? true : null }), h("span", null, h("strong", { text: ROLE_LABEL[value] }), h("span", { class: "adm-muted", text: " — " + ROLE_HELP[value] })));
    const submit = h("button", { class: "btn btn--primary", type: "submit", disabled: caps.writes && caps.recipients !== "missing" ? null : true }, "Review invitation");
    const emailError = h("p", { class: "adm-field__error", id: "iv-email-e", role: "alert", hidden: true });
    email.setAttribute("aria-describedby", "iv-email-e");
    return h("form", { class: "adm-form adm-form--inline", novalidate: true, "aria-label": "Invite someone", onsubmit: (ev) => {
      ev.preventDefault();
      emailError.hidden = true; email.removeAttribute("aria-invalid");
      const value = email.value.trim();
      const role = root.querySelector('input[name="iv-role"]:checked').value;
      if (!value) { emailError.textContent = ERROR_TEXT.invalid_email; emailError.hidden = false; email.setAttribute("aria-invalid", "true"); email.focus(); return; }
      perform({
        confirm: {
          title: "Create this invitation?",
          body: "This saves the invitation. It does not email anyone: you choose when to send it from the list below.",
          details: [["Person", value], ["Role", ROLE_LABEL[role]], ["Organization", orgName], ["Valid for", "7 days"]],
          confirmLabel: "Create invitation",
        },
        request: () => api(base + "/invitations", { method: "POST", body: { email: value, role } }),
        onSuccess: () => { email.value = ""; return { tone: "success", text: `Invitation created for ${value}. It has not been sent. Use Send in the list below when you’re ready.` }; },
        onFailure: (err) => {
          if (err.code === "invalid_email") { emailError.textContent = errorText(err); emailError.hidden = false; email.setAttribute("aria-invalid", "true"); return { tone: "error", text: errorText(err) }; }
          return { tone: "error", text: errorText(err) };
        },
      });
    } },
      h("div", { class: "adm-field" }, h("label", { for: "iv-email", text: "Email address" }), email, emailError),
      h("fieldset", { class: "adm-field adm-fieldset" }, h("legend", { text: "Role" }), radio("member", true), radio("owner", false)),
      h("div", { class: "adm-actions" }, submit),
    );
  }

  function inviteActions(i, caps) {
    const to = i.email;
    const cannotSend = !caps.sending || caps.recipients === "missing";
    const sendTitle = cannotSend ? (caps.recipients === "missing" ? "Invitations are locked: no approved recipients" : "Sending is switched off on this site") : null;
    const btns = [];
    const sendNow = (mode) => perform({
      confirm: mode === "send"
        ? {
            title: i.delivery && i.delivery.state === "failed" ? "Try sending this invitation again?" : "Send this invitation?",
            body: "Framework will ask WorkOS (or, if the person already has an account, our own email service) to notify them. A provider accepting the request does not confirm the message reaches their inbox.",
            details: [["To", to], ["Role", ROLE_LABEL[i.role]], ["Expires", fmtDate(i.expires_at)]],
            confirmLabel: "Send invitation",
          }
        : {
            title: "Resend this invitation?",
            body: "The same invitation is sent again. Its expiry date does not change.",
            details: [["To", to], ["Expires", fmtDate(i.expires_at)]],
            confirmLabel: "Resend invitation",
          },
      request: () => api(`${base}/invitations/${encodeURIComponent(i.id)}/${mode}`, { method: "POST", body: {} }),
      onSuccess: (res) => ({ tone: "success", text: `Submitted to ${CHANNEL[res.delivery.channel] || "the provider"} for ${to}. The provider accepted the request; this does not confirm the message reached their inbox.` }),
      onFailure: (err) => err.code === "delivery_failed"
        ? { tone: "error", text: `The request to ${CHANNEL[err.data.delivery && err.data.delivery.channel] || "the provider"} failed. ${FAILURE_REASON[err.data.delivery && err.data.delivery.error] || ""} Nothing was sent to ${to}. You can try again.`.replace("  ", " ") }
        : null,
    });
    if (i.status === "pending" && !isExpired(i)) {
      const d = (i.delivery && i.delivery.state) || "not_tracked";
      if (d === "submitted") btns.push(textButton("Resend", { "aria-label": "Resend invitation to " + to, disabled: cannotSend ? true : null, title: sendTitle, onclick: () => sendNow("resend") }));
      else if (d !== "not_tracked") btns.push(textButton(d === "failed" ? "Try again" : "Send", { "aria-label": (d === "failed" ? "Try sending again to " : "Send invitation to ") + to, disabled: cannotSend ? true : null, title: sendTitle, onclick: () => sendNow("send") }));
      btns.push(textButton("Revoke", { "aria-label": "Revoke invitation for " + to, onclick: () => perform({
        confirm: {
          title: "Revoke this invitation?",
          body: "The person will no longer be able to use it to get access. If it was submitted through WorkOS, Framework will also ask WorkOS to cancel it.",
          details: [["Person", to], ["Role", ROLE_LABEL[i.role]]],
          confirmLabel: "Revoke invitation",
        },
        request: () => api(`${base}/invitations/${encodeURIComponent(i.id)}/revoke`, { method: "POST", body: {} }),
        onSuccess: (res) => revokeOutcome(res, to),
      }) }));
    } else if (i.status === "revoked" && i.workos_cleanup === "pending") {
      btns.push(textButton("Retry WorkOS cancel", { "aria-label": "Retry cancelling the WorkOS invitation for " + to, disabled: cannotSend ? true : null, title: sendTitle, onclick: () => perform({
        confirm: { title: "Cancel the WorkOS invitation?", body: "Access is already closed in Framework. This only asks WorkOS to cancel its copy of the invitation.", details: [["Person", to]], confirmLabel: "Cancel at WorkOS" },
        request: () => api(`${base}/invitations/${encodeURIComponent(i.id)}/revoke`, { method: "POST", body: {} }),
        onSuccess: (res) => revokeOutcome(res, to),
      }) }));
    }
    if (isExpired(i) || i.status === "revoked") {
      btns.push(textButton("Replace", { "aria-label": "Replace invitation for " + to, disabled: caps.recipients === "missing" ? true : null, title: caps.recipients === "missing" ? "Invitations are locked: no approved recipients" : null, onclick: () => perform({
        confirm: {
          title: "Replace this invitation?",
          body: `Creates a new invitation for the same person, valid for 7 days. The old one stays in the history. Nothing is sent until you choose Send.`,
          details: [["Person", to], ["Role", ROLE_LABEL[i.role]]],
          confirmLabel: "Create replacement",
        },
        request: () => api(`${base}/invitations/${encodeURIComponent(i.id)}/replace`, { method: "POST", body: {} }),
        onSuccess: () => ({ tone: "success", text: `A new 7-day invitation was created for ${to}. It has not been sent yet.` }),
      }) }));
    }
    return btns;
  }

  function revokeOutcome(res, to) {
    const w = res.workos || { state: "none" };
    if (w.state === "revoke_failed") {
      return { tone: "warning", text: `The invitation for ${to} is revoked, so they can’t use it to get access. But cancelling it at WorkOS failed (${FAILURE_REASON[w.error] || "unexpected error"}). Use “Retry WorkOS cancel” on that row to finish the cleanup.` };
    }
    return { tone: "success", text: w.state === "revoked" ? `Invitation for ${to} revoked, and the WorkOS invitation was cancelled.` : `Invitation for ${to} revoked.` };
  }

  function invitationsSection(caps) {
    const list = data.invitations;
    const table = list.length
      ? h("table", { class: "adm-table adm-table--left" },
          h("caption", { class: "visually-hidden" }, "Invitations"),
          h("thead", null, h("tr", null, ["Person", "Role", "Invitation", "Delivery", ""].map((t) => h("th", { scope: "col" }, t || h("span", { class: "visually-hidden" }, "Actions"))))),
          h("tbody", null, list.map((i) => {
            const s = statusView(i), d = deliveryView(i);
            return h("tr", null,
              h("td", { "data-label": "Person" }, h("span", { class: "adm-client" }, i.email), h("span", { class: "adm-client__sub" }, `Created ${fmtDate(i.created_at)}`)),
              h("td", { "data-label": "Role" }, ROLE_LABEL[i.role] || i.role),
              h("td", { "data-label": "Invitation" }, h("span", { class: "adm-cstate adm-cstate--" + (s.warn ? "warn" : i.status) }, s.label), s.note ? h("span", { class: "adm-client__sub" }, s.note) : null),
              h("td", { "data-label": "Delivery" }, h("span", { class: "adm-cstate adm-cstate--" + (d.warn ? "warn" : "plain") }, d.label), d.note ? h("span", { class: "adm-client__sub" }, d.note) : null),
              h("td", { "data-label": "" }, h("div", { class: "adm-row-actions" }, inviteActions(i, caps))),
            );
          })))
      : h("div", { class: "adm-empty" }, h("p", { class: "adm-client" }, "No invitations yet."), h("p", { class: "adm-sub" }, caps.writes ? "Invite the first owner above. They’ll get access when they sign in with that email address." : "Nothing has been invited yet. Changes are switched off on this site."));
    return h("section", { class: "adm-section", "aria-labelledby": "adm-inv-h" },
      h("div", { class: "adm-section-title" }, h("h2", { id: "adm-inv-h", text: "Invitations" })),
      h("p", { class: "adm-sub" }, "Creating an invitation and sending it are separate steps. Access is only granted when the person signs in with the invited email address."),
      !caps.writes ? h("p", { class: "adm-banner" }, "Changes are switched off on this site. You can look, but not create, send, revoke or remove.") : !caps.sending ? h("p", { class: "adm-banner" }, "Sending is switched off on this site. You can create and revoke invitations, but nothing will be emailed.") : null,
      caps.recipients === "missing" ? h("p", { class: "adm-banner adm-banner--alert" }, "Invitations are locked: no approved recipients are configured on this site, so none can be created or sent.") : caps.recipients === "configured" ? h("p", { class: "adm-banner" }, "Controlled test: invitations can only be created for, and sent to, approved recipients. The server refuses any other address.") : null,
      caps.writes ? inviteForm(caps) : null, // with changes switched off there is nothing to submit, so the form is not shown (the banner above says why)
      table,
    );
  }

  /* ----- members ----- */

  function memberActions(m, caps) {
    if (m.status !== "active") return [];
    const who = m.name || m.email;
    const only = m.last_active_owner;
    const btns = [];
    const toRole = m.role === "owner" ? "member" : "owner";
    btns.push(textButton(toRole === "owner" ? "Make owner" : "Make member", { "aria-label": `${toRole === "owner" ? "Make" : "Change"} ${who} ${toRole === "owner" ? "an owner" : "a member"}`, disabled: only && toRole === "member" ? true : null, title: only && toRole === "member" ? "The only active owner can’t be demoted" : null, onclick: () => perform({
      confirm: {
        title: toRole === "owner" ? `Make ${who} an owner?` : `Make ${who} a member?`,
        body: toRole === "owner" ? "They will be able to see the organization’s team list as well." : "They will keep access to the portal but will no longer see the team list.",
        details: [["Person", who], ["From", ROLE_LABEL[m.role]], ["To", ROLE_LABEL[toRole]]],
        confirmLabel: toRole === "owner" ? "Make owner" : "Make member",
      },
      request: () => api(`${base}/members/${encodeURIComponent(m.user_id)}/role`, { method: "POST", body: { role: toRole } }),
      onSuccess: (res) => ({ tone: "success", text: res.changed ? `${who} is now ${toRole === "owner" ? "an owner" : "a member"}.` : `${who} already had that role.` }),
    }) }));
    btns.push(textButton("Remove access", { "aria-label": "Remove access for " + who, disabled: only ? true : null, title: only ? "The only active owner can’t be removed" : null, onclick: () => perform({
      confirm: {
        title: `Remove ${who}’s access?`,
        body: `They will no longer be able to open ${orgName}’s portal. ${orgName}’s Business Profile, projects and history stay exactly as they are, and you can invite them again later.`,
        details: [["Person", who], ["Role", ROLE_LABEL[m.role]]],
        confirmLabel: "Remove access",
      },
      request: () => api(`${base}/members/${encodeURIComponent(m.user_id)}/remove`, { method: "POST", body: {} }),
      onSuccess: () => ({ tone: "success", text: `${who} no longer has access. ${orgName}’s information was not changed.` }),
    }) }));
    return btns;
  }

  function membersSection(caps) {
    const list = data.members;
    const table = list.length
      ? h("table", { class: "adm-table adm-table--left" },
          h("caption", { class: "visually-hidden" }, "Members"),
          h("thead", null, h("tr", null, ["Person", "Role", "Access", "Last sign-in", ""].map((t) => h("th", { scope: "col" }, t || h("span", { class: "visually-hidden" }, "Actions"))))),
          h("tbody", null, list.map((m) => h("tr", null,
            h("td", { "data-label": "Person" }, h("span", { class: "adm-client" }, m.name || m.email), m.name ? h("span", { class: "adm-client__sub" }, m.email) : null),
            h("td", { "data-label": "Role" }, ROLE_LABEL[m.role] || m.role),
            h("td", { "data-label": "Access" }, h("span", { class: "adm-cstate adm-cstate--" + (m.status === "active" && m.user_status === "active" ? "complete" : "missing") }, m.status === "revoked" ? "Access removed" : m.user_status !== "active" ? "Account disabled" : "Active"),
              m.last_active_owner ? h("span", { class: "adm-client__sub" }, "Only active owner") : null),
            h("td", { "data-label": "Last sign-in" }, m.last_login_at ? fmtDate(m.last_login_at) : h("span", { class: "adm-muted" }, "Never")),
            h("td", { "data-label": "" }, h("div", { class: "adm-row-actions" }, caps.writes ? memberActions(m, caps) : [])),
          ))))
      : h("div", { class: "adm-empty" }, h("p", { class: "adm-client" }, "No members yet."), h("p", { class: "adm-sub" }, "People appear here after they sign in with an invited email address."));
    return h("section", { class: "adm-section", "aria-labelledby": "adm-mem-h" },
      h("div", { class: "adm-section-title" }, h("h2", { id: "adm-mem-h", text: "Members" })),
      h("p", { class: "adm-sub" }, `${plural(list.filter((m) => m.status === "active" && m.user_status === "active").length, "person", "people")} can open this organization’s portal. Removing someone’s access never deletes ${orgName}’s information.`),
      table,
    );
  }

  /* ----- draw ----- */

  function draw() {
    const caps = data.capabilities || { writes: false, sending: false };
    const wasFocused = document.activeElement && document.activeElement.id;
    const welcomeBox = welcome
      ? h("div", { class: "adm-welcome", role: "status" }, h("p", { class: "adm-client" }, `${orgName} was created.`), h("p", { class: "adm-sub" }, "Next step: invite its first owner using the form below. They’ll get access when they sign in with that email address."))
      : null;
    welcome = false; // only on first draw
    root.replaceChildren(...[welcomeBox, live, invitationsSection(caps), membersSection(caps)].filter(Boolean));
    if (wasFocused && document.getElementById(wasFocused) && document.getElementById(wasFocused).tagName !== "BUTTON") document.getElementById(wasFocused).focus();
  }

  root.append(loading());
  load().then(() => { if (welcomeBox_(root)) document.getElementById("iv-email")?.focus(); });
  return root;
}
const welcomeBox_ = (root) => Boolean(root.querySelector(".adm-welcome"));
