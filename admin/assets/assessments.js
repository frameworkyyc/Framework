/* Framework Admin — Assessments module: /admin/assessments
   Free Online Presence Assessment requests, whether each one reached Framework's inbox, whether this deployment
   can send email at all, a test-email button, and one-click recovery of anything that was saved but not emailed. */

import { h, api, ApiError, fmtDateTime, shortRef, stateBlock, confirmDialog } from "./ui.js";

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

// Constant markup (no data involved), same approach as the brand mark in admin.js.
const TRASH = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="square"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>`;

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
  const busy = new Set(); // ids with a delete request in flight: blocks double submission
  // Read-only identity check first: shows which database this deployment is connected to (best effort).
  const dbInfo = await api("/database").catch(() => null);
  let data = await api("/assessments");
  const node = h("div", { class: "adm-page" });

  const feedback = h("p", { class: "adm-notice", role: "status", hidden: true });
  const say = (message) => { feedback.textContent = message; feedback.hidden = !message; };

  const run = async (label, fn) => {
    say(label + "…");
    try { await fn(); } catch (err) { say("That didn’t complete (" + (err.code || "error") + "). Nothing has been changed."); }
  };

  const reload = async () => { data = await api("/assessments"); paint(); };

  const remove = async (r) => {
    if (busy.has(r.id)) return;
    const label = r.business_name || "this request";
    const confirmed = await confirmDialog({
      title: "Delete this assessment?",
      body: "This permanently deletes the request from the database. It cannot be undone. Emails already sent are not affected.",
      details: [["Business", label], ["Submitted", fmtDateTime(r.created_at)], ["Contact", r.email]],
      confirmLabel: "Delete Assessment",
      cancelLabel: "Cancel",
    });
    if (!confirmed || busy.has(r.id)) return;
    busy.add(r.id);
    paint();
    const drop = (counts) => {
      data.requests = data.requests.filter((x) => x.id !== r.id);
      if (counts) Object.assign(data, { total: counts.total, sent: counts.sent, unsent: counts.unsent });
      else { data.total -= 1; if (r.notify_status === "sent") data.sent -= 1; else data.unsent -= 1; }
    };
    try {
      const res = await api("/assessments/" + encodeURIComponent(r.id), { method: "DELETE" });
      drop(res);
      say(`Deleted the assessment from ${label}.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) { drop(null); say(`${label} had already been deleted. The list has been updated.`); }
      else say(`Couldn’t delete the assessment from ${label} (${err.code || "error"}). It has not been deleted.`);
    } finally {
      busy.delete(r.id);
      paint();
      feedback.scrollIntoView({ block: "nearest" });
    }
  };

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
            h("td", { "data-label": "", class: "adm-row-actions" },
              r.notify_status !== "sent" ? h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: busy.has(r.id), onclick: () => resend(r.id) }, "Resend") : null,
              (() => {
                const b = h("button", { class: "adm-icon-btn", type: "button", title: "Delete assessment", "aria-label": "Delete assessment from " + (r.business_name || "Ref " + shortRef(r.id)), disabled: busy.has(r.id), onclick: () => remove(r) });
                b.insertAdjacentHTML("afterbegin", TRASH);
                return b;
              })()),
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
      h("p", { class: "adm-banner" + (e.can_send ? "" : " adm-banner--alert") }, h("strong", null, e.can_send ? "Email delivery: ready. " : "Email delivery: NOT working. "), emailSummary(e),
        dbInfo ? h("span", { class: "adm-banner__line" }, "Database environment: " + (dbInfo.environment ? dbInfo.environment + " (marker found)." : "not marked (expected for Production).")) : null,
        h("span", { class: "adm-banner__line" }, "Spam check (Turnstile): " + ({ on: "on.", off: "off. The form relies on the hidden field, timing check and rate limit only.", misconfigured: "NOT enforced: set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET." })[data.spam_check])),
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
