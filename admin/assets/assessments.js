/* Framework Admin — Assessments module: /admin/assessments
   Free Online Presence Assessment requests, whether each one reached Framework's inbox, whether this deployment
   can send email at all, a test-email button, and one-click recovery of anything that was saved but not emailed. */

import { h, api, fmtDateTime, shortRef, stateBlock } from "./ui.js";

const metric = (label, value, note) =>
  h("div", { class: "adm-metric" },
    h("p", { class: "adm-metric__label" }, label),
    h("div", { class: "adm-metric__value" }, value),
    note ? h("p", { class: "adm-metric__note" }, note) : null);

const PROBLEMS = {
  missing_api_key: "RESEND_API_KEY is not set for this deployment.",
  missing_from: "ASSESSMENT_FROM is not set for this deployment.",
  invalid_from: "ASSESSMENT_FROM is not a valid sender. Use  Framework <hello@frameworkco.ca>  (with the angle brackets).",
};

const emailSummary = (e) => {
  if (!e.can_send) return PROBLEMS[e.problem] || "Email is not configured.";
  return `Ready to send from ${e.from_used} to ${e.notify_to}.` + (e.from === "corrected" ? " The sender setting was missing its angle brackets and is being corrected automatically; it is worth fixing in Cloudflare." : "");
};

const statusLabel = (r) =>
  r.notify_status === "sent" ? "Emailed" : r.notify_status === "not_configured" ? "Not emailed — email not configured" : r.notify_status === "failed" ? "Not emailed — delivery failed" : "Not emailed — pending";

const FIELDS = [
  ["Business", "business_name"], ["Website", "website"], ["Contact", "contact_name"], ["Email", "email"], ["Phone", "phone"],
  ["City / Province", "location"], ["Industry", "industry"], ["Services", "services"], ["Service area", "service_area"],
  ["Profile links", "profiles"], ["Main concern", "concern"], ["Additional information", "additional_info"],
  ["Landing page", "landing"], ["Referrer", "referrer"],
];

function details(r) {
  let tracking = {};
  try { tracking = JSON.parse(r.tracking || "{}") || {}; } catch { tracking = {}; }
  const rows = FIELDS.map(([label, key]) => [label, r[key]]).concat(Object.entries(tracking).map(([k, v]) => [k, v]));
  rows.push(["Marketing emails", r.marketing_opt_in ? "Opted in" : "No"], ["Request ID", r.id]);
  return h("details", { class: "adm-details" },
    h("summary", null, "Show all details"),
    h("dl", null, rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: String(v) })))));
}

export async function render() {
  let data = await api("/assessments");
  const node = h("div", { class: "adm-page" });

  const feedback = h("p", { class: "adm-notice", role: "status", hidden: true });
  const say = (message) => { feedback.textContent = message; feedback.hidden = !message; };

  const run = async (label, fn) => {
    say(label + "…");
    try { await fn(); } catch (err) { say("That didn’t complete (" + (err.code || "error") + "). Nothing has been changed."); }
  };

  const reload = async () => { data = await api("/assessments"); paint(); };

  const testEmail = () => run("Sending a test email", async () => {
    const r = await api("/assessments/test-email", { method: "POST", body: {} });
    say(r.ok ? `Test email accepted by the email provider. Check ${r.to} (and spam).` : `Test email failed: ${r.error}`);
  });

  const resend = (id) => run(id ? "Resending" : "Resending unsent notifications", async () => {
    const r = await api("/assessments/resend", { method: "POST", body: id ? { id } : {} });
    await reload();
    say(r.attempted === 0 ? "Nothing to resend." : r.failed === 0 ? `Resent ${r.sent} notification${r.sent === 1 ? "" : "s"}. Check ${data.email.notify_to}.` : `Resent ${r.sent}, ${r.failed} still failing: ${r.results.find((x) => !x.ok).error}`);
  });

  function paint() {
    const e = data.email;
    const rows = data.requests;
    const table = rows.length
      ? h("table", { class: "adm-table" },
          h("thead", null, h("tr", null, ["Business", "Submitted", "Contact", "Notification", ""].map((t) => h("th", { scope: "col" }, t || h("span", { class: "visually-hidden" }, "Actions"))))),
          h("tbody", null, rows.map((r) => h("tr", null,
            h("td", { "data-label": "Business" }, h("span", { class: "adm-client" }, r.business_name || "—"), h("span", { class: "adm-client__sub" }, (r.website || "") + " · Ref " + shortRef(r.id)), details(r)),
            h("td", { "data-label": "Submitted" }, fmtDateTime(r.created_at)),
            h("td", { "data-label": "Contact" }, r.contact_name, h("span", { class: "adm-client__sub" }, r.email)),
            h("td", { "data-label": "Notification" },
              h("span", { class: "adm-status-mark " + (r.notify_status === "sent" ? "is-reviewed" : "is-unreviewed") }, statusLabel(r)),
              r.notify_status !== "sent" && r.notify_error ? h("span", { class: "adm-client__sub" }, "Reason: " + r.notify_error) : null,
              r.notify_attempts ? h("span", { class: "adm-client__sub" }, `${r.notify_attempts} attempt${r.notify_attempts === 1 ? "" : "s"}`) : null),
            h("td", { "data-label": "" }, r.notify_status !== "sent" ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => resend(r.id) }, "Resend") : null),
          ))))
      : stateBlock({ title: "No assessment requests yet", body: "Requests from the /assessment form appear here, whether or not the notification email went out." });

    node.replaceChildren(
      h("div", { class: "adm-head" },
        h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Assessments"),
          h("p", { class: "adm-sub" }, "Free Online Presence Assessment requests, newest first.")),
        h("div", { class: "adm-actions" },
          h("button", { class: "btn btn--secondary", type: "button", onclick: testEmail }, "Send test email"),
          data.unsent ? h("button", { class: "btn btn--primary", type: "button", onclick: () => resend(null) }, `Resend ${data.unsent} unsent`) : null)),
      feedback,
      h("p", { class: "adm-banner", style: e.can_send ? null : "border-color:#0A0A0A;color:#0A0A0A" }, h("strong", null, e.can_send ? "Email delivery: ready. " : "Email delivery: NOT working. "), emailSummary(e)),
      h("section", { class: "adm-section", "aria-label": "Summary" }, h("div", { class: "adm-metrics" },
        metric("Requests", String(data.total)),
        metric("Emailed", String(data.sent)),
        metric("Not emailed", String(data.unsent), data.unsent ? "Saved here; use Resend once email works" : null))),
      h("section", { class: "adm-section" }, table,
        data.truncated ? h("p", { class: "adm-sub" }, "Only the newest 200 are listed.") : null),
    );
  }
  paint();
  return { title: "Assessments", node };
}
