/* Framework Admin — "Share the feedback form" panel (Client Feedback). Reuses the existing public feedback form and its database:
   shows the link, a Copy action, a copyable invitation, and an explicit "Send feedback request" (only when email is configured). */

import { h, api, ApiError, confirmDialog } from "./ui.js";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // older browsers and non-secure contexts: select a temporary field and use the legacy command
    const t = h("textarea", { "aria-hidden": "true", tabindex: "-1" });
    t.style.position = "fixed"; t.style.left = "-9999px"; // CSSOM, not an inline style attribute (the admin CSP forbids those)
    t.value = text;
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    return ok;
  }
}

const SEND_ERRORS = {
  name: "Enter the client’s name.",
  email: "Enter a valid email address.",
  project: "Keep the project or website name under 120 characters.",
};

export async function sharePanel() {
  let info;
  try { info = await api("/feedback/share"); } catch { return null; } // the list still works without the panel
  const live = h("p", { class: "adm-sub", role: "status", "aria-live": "polite" });
  const say = (msg) => { live.textContent = msg; };

  const link = h("input", { class: "adm-share__link", type: "text", readonly: true, value: info.form_url, "aria-label": "Client feedback form link" });
  const copyLink = h("button", { class: "btn btn--secondary", type: "button", onclick: async () => say((await copyText(info.form_url)) ? "Feedback link copied." : "Couldn’t copy. Select the link and copy it manually.") }, "Copy feedback link");
  const open = h("a", { class: "btn btn--secondary", href: info.form_url, target: "_blank", rel: "noopener" }, "Open feedback form");

  const tpl = h("textarea", { class: "adm-share__tpl", readonly: true, rows: 9, "aria-label": "Invitation template" });
  tpl.value = `Subject: ${info.template.subject}\n\n${info.template.text}`;
  const copyTpl = h("button", { class: "btn btn--secondary", type: "button", onclick: async () => say((await copyText(tpl.value)) ? "Invitation copied." : "Couldn’t copy. Select the text and copy it manually.") }, "Copy invitation");

  let send = null;
  if (info.email.can_send) {
    const name = h("input", { id: "fs-name", class: "adm-share__field", type: "text", maxlength: "100", autocomplete: "off", required: true });
    const email = h("input", { id: "fs-email", class: "adm-share__field", type: "email", maxlength: "254", autocomplete: "off", required: true });
    const project = h("input", { id: "fs-project", class: "adm-share__field", type: "text", maxlength: "120", autocomplete: "off" });
    const status = h("p", { class: "adm-sub", role: "status", "aria-live": "polite" });
    const button = h("button", { class: "btn btn--primary", type: "submit" }, "Send feedback request");
    send = h("form", { class: "adm-share__form", novalidate: true, onsubmit: async (ev) => {
      ev.preventDefault();
      status.textContent = "";
      if (!name.value.trim()) { status.textContent = SEND_ERRORS.name; name.focus(); return; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim())) { status.textContent = SEND_ERRORS.email; email.focus(); return; }
      const ok = await confirmDialog({
        title: "Send this feedback request?",
        body: "An email with the feedback form link will be sent now.",
        details: [["To", `${name.value.trim()} <${email.value.trim()}>`], ...(project.value.trim() ? [["Project", project.value.trim()]] : [])],
        confirmLabel: "Send email",
      });
      if (!ok) return;
      button.disabled = true;
      status.textContent = "Sending…";
      try {
        await api("/feedback/invite", { method: "POST", body: { name: name.value, email: email.value, project: project.value } });
        status.textContent = `Sent to ${email.value.trim()}.`;
        name.value = ""; email.value = ""; project.value = "";
      } catch (err) {
        status.textContent = err instanceof ApiError && err.status === 422 ? SEND_ERRORS[(err.detail || "").toString()] || "Check the details and try again."
          : err instanceof ApiError && err.code === "email_not_configured" ? "Email sending isn’t configured on this site. Copy the invitation instead."
          : "The email wasn’t sent. Nothing was delivered; please try again or copy the invitation.";
      } finally {
        button.disabled = false;
      }
    } },
      h("div", { class: "adm-share__row" }, h("label", { for: "fs-name" }, "Client name"), name),
      h("div", { class: "adm-share__row" }, h("label", { for: "fs-email" }, "Client email"), email),
      h("div", { class: "adm-share__row" }, h("label", { for: "fs-project" }, "Project or website (optional)"), project),
      button, status,
    );
  }

  return h("section", { class: "adm-section adm-share", "aria-label": "Share the feedback form" },
    h("div", { class: "adm-section-title" }, h("h2", { text: "Share the feedback form" })),
    h("p", { class: "adm-sub" }, "The same form clients already use. Responses appear below."),
    h("div", { class: "adm-share__linkrow" }, link),
    h("div", { class: "adm-actions" }, copyLink, open),
    live,
    h("details", { class: "adm-share__more" }, h("summary", null, "Invitation email"),
      send || h("p", { class: "adm-banner" }, "Email sending isn’t configured on this site, so nothing can be sent from here. Copy the invitation below and send it from your own email."),
      h("p", { class: "adm-sub" }, "Invitation template (you can copy this and send it yourself)"), tpl, h("div", { class: "adm-actions" }, copyTpl),
    ),
  );
}
