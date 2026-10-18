/* Framework Admin — Assessments module: /admin/assessments
   Free Online Presence Assessment requests, whether each one reached Framework's inbox, whether this deployment
   can send email at all, a test-email button, and one-click recovery of anything that was saved but not emailed. */

import { h, api, ApiError, fmtDateTime, shortRef, stateBlock, confirmDialog } from "./ui.js";

// "YYYY-MM-DD" shown as a plain calendar day (no time-zone shifting).
const dayFmt = new Intl.DateTimeFormat("en-CA", { dateStyle: "long", timeZone: "UTC" });
const fmtDay = (ymd) => (/^\d{4}-\d{2}-\d{2}$/.test(ymd || "") ? dayFmt.format(new Date(ymd + "T00:00:00Z")) : "");
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const isoDay = (iso) => String(iso || "").slice(0, 10);

const metric = (label, value, note) =>
  h("div", { class: "adm-metric" },
    h("p", { class: "adm-metric__label" }, label),
    h("div", { class: "adm-metric__value" }, value),
    note ? h("p", { class: "adm-metric__note" }, note) : null);

const PROBLEMS = {
  missing_api_key: "RESEND_API_KEY is not set for this deployment.",
  missing_from: "ASSESSMENT_FROM is not set for this deployment. A plain variable that exists only in the Cloudflare dashboard is removed by the next deploy: set it in wrangler.jsonc (previews.vars) or as a secret.",
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

function details(r, ctx) {
  let tracking = {};
  try { tracking = JSON.parse(r.tracking || "{}") || {}; } catch { tracking = {}; }
  const rows = FIELDS.map(([label, key]) => [label, r[key]]).concat(Object.entries(tracking).map(([k, v]) => [k, v]));
  rows.push(["Marketing emails", r.marketing_opt_in ? "Opted in" : "No"], ["Request ID", r.id]);
  const reference = r.last_interaction_at || isoDay(r.created_at);
  rows.push(["Submitted", fmtDateTime(r.created_at)],
    ["Last interaction", r.last_interaction_at ? fmtDay(r.last_interaction_at) : "None recorded"],
    ["Retention reference date", `${fmtDay(reference)} (${r.last_interaction_at ? "last interaction" : "submission date, because no interaction is recorded"})`]);
  const saving = ctx.saving.has(r.id);
  const input = h("input", { class: "input adm-interaction__date", type: "date", id: "li-" + r.id, value: r.last_interaction_at || "", min: isoDay(r.created_at), max: localToday(), disabled: saving });
  const save = (value) => ctx.saveInteraction(r, value);
  const editor = h("form", { class: "adm-interaction", onsubmit: (e) => { e.preventDefault(); save(input.value || null); } },
    h("label", { for: "li-" + r.id }, "Record last meaningful interaction"),
    h("div", { class: "adm-interaction__row" },
      input,
      h("button", { class: "btn btn--secondary adm-small", type: "submit", disabled: saving }, "Save date"),
      h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: saving, onclick: () => save(localToday()) }, "Today"),
      r.last_interaction_at ? h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: saving, onclick: () => save(null) }, "Clear") : null),
    h("p", { class: "adm-interaction__hint" }, "Update this when there is real follow-up (a reply, a meeting, a project). The 24-month retention review counts from this date, or from the submission date if none is recorded."));
  const open = ctx.open.has(r.id);
  const el = h("details", { class: "adm-details", open },
    h("summary", null, "Show all details"),
    h("dl", null, rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", { text: String(v) })))),
    editor);
  el.addEventListener("toggle", () => { if (el.open) ctx.open.add(r.id); else ctx.open.delete(r.id); });
  return el;
}

export async function render() {
  const busy = new Set();   // ids with a delete request in flight: blocks double submission
  const saving = new Set(); // ids with a last-interaction save in flight
  const open = new Set();   // ids whose "Show all details" is open (kept across repaints)
  // Read-only identity check first: shows which database this deployment is connected to (best effort).
  const dbInfo = await api("/database").catch(() => null);
  let data = await api("/assessments");   // the unfiltered view: counts, email health and the newest 200 requests
  let shown = data.requests;              // what the table lists right now (all, or the search result)
  let matched = data.total;               // how many requests match the current search (or the total)
  let query = "";
  let searching = false;
  let searchToken = 0;
  let searchTimer = null;

  // Three stable containers: typing in the search box only repaints the results, so the box keeps focus.
  const top = h("div");
  const results = h("div");
  const feedback = h("p", { class: "adm-notice", role: "status", hidden: true });
  const say = (message) => { feedback.textContent = message; feedback.hidden = !message; };

  const input = h("input", { class: "input adm-search__input", id: "adm-q", type: "search", placeholder: "Search business, contact or email", autocomplete: "off", maxlength: "100", spellcheck: "false" });
  const clearBtn = h("button", { class: "btn btn--secondary adm-small", type: "button", hidden: true, onclick: () => clearSearch() }, "Clear");
  const searchForm = h("form", { class: "adm-search", role: "search", onsubmit: (e) => { e.preventDefault(); runSearch(true); } },
    h("label", { class: "visually-hidden", for: "adm-q" }, "Search assessment requests by business name, contact name or email"),
    input, clearBtn);

  const run = async (label, fn) => {
    say(label + "…");
    try { await fn(); } catch (err) { say("That didn’t complete (" + (err.code || "error") + "). Nothing has been changed."); }
  };

  /* ---------------- search ---------------- */
  const normalise = (v) => String(v || "").replace(/\s+/g, " ").trim().slice(0, 100);
  const localMatch = (r, q) => [r.business_name, r.contact_name, r.email].some((v) => String(v || "").toLowerCase().includes(q));

  // When every request is already loaded the filter is instant and local. When there are more than the newest 200,
  // the search is run by the server over the whole table, so older requests are found too.
  async function runSearch(immediate) {
    window.clearTimeout(searchTimer);
    query = normalise(input.value);
    clearBtn.hidden = !query;
    const token = ++searchToken;
    if (!query) { shown = data.requests; matched = data.total; searching = false; paintResults(); return; }
    if (!data.truncated) {
      const q = query.toLowerCase();
      shown = data.requests.filter((r) => localMatch(r, q)); matched = shown.length; searching = false; paintResults(); return;
    }
    const go = async () => {
      searching = true; paintResults();
      try {
        const res = await api("/assessments?q=" + encodeURIComponent(query));
        if (token !== searchToken) return; // a newer search replaced this one
        shown = res.requests; matched = res.matched;
      } catch (err) {
        if (token !== searchToken) return;
        say("The search didn’t complete (" + (err.code || "error") + "). The list below may be out of date.");
      } finally {
        if (token === searchToken) { searching = false; paintResults(); }
      }
    };
    if (immediate) await go(); else searchTimer = window.setTimeout(go, 250);
  }
  function clearSearch() { input.value = ""; runSearch(true); input.focus(); }
  input.addEventListener("input", () => runSearch(false));
  input.addEventListener("keydown", (e) => { if (e.key === "Escape" && input.value) { e.preventDefault(); clearSearch(); } });

  const refresh = async () => { data = await api("/assessments"); await runSearch(true); paintTop(); };

  /* ---------------- row actions ---------------- */
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
    paintResults();
    const drop = (counts) => {
      data.requests = data.requests.filter((x) => x.id !== r.id);
      shown = shown.filter((x) => x.id !== r.id);
      matched = Math.max(0, matched - 1);
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
      open.delete(r.id);
      paintTop(); paintResults();
      feedback.scrollIntoView({ block: "nearest" });
    }
  };

  // Record (or clear) the last meaningful interaction. The server validates the date; its message is shown as is.
  const saveInteraction = async (r, value) => {
    if (saving.has(r.id)) return;
    saving.add(r.id); paintResults();
    try {
      const res = await api("/assessments/" + encodeURIComponent(r.id), { method: "PATCH", body: { last_interaction_at: value } });
      for (const list of [data.requests, shown]) { const row = list.find((x) => x.id === r.id); if (row) row.last_interaction_at = res.last_interaction_at; }
      say(res.last_interaction_at ? `Recorded ${fmtDay(res.last_interaction_at)} as the last interaction with ${r.business_name || "this request"}.` : `Cleared the last interaction for ${r.business_name || "this request"}. Retention now counts from the submission date.`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) say(err.detail || "That date isn’t valid. Nothing was changed.");
      else if (err instanceof ApiError && err.status === 404) say("That request no longer exists. Reload the page.");
      else say(`Couldn’t save the date (${err.code || "error"}). Nothing was changed.`);
    } finally {
      saving.delete(r.id); paintResults();
    }
  };
  const ctx = { open, saving, saveInteraction };

  const testEmail = () => run("Sending a test email", async () => {
    const r = await api("/assessments/test-email", { method: "POST", body: {} });
    say(r.ok ? `Test email accepted by the email provider. Check ${r.to} (and spam).` : `Test email failed: ${r.error}`);
  });

  const resend = (id) => run(id ? "Resending" : "Resending unsent notifications", async () => {
    const r = await api("/assessments/resend", { method: "POST", body: id ? { id } : {} });
    await refresh();
    say(r.attempted === 0 ? "Nothing to resend." : r.failed === 0 ? `Resent ${r.sent} notification${r.sent === 1 ? "" : "s"}. Check ${data.email.notify_to}.` : `Resent ${r.sent}, ${r.failed} still failing: ${r.results.find((x) => !x.ok).error}`);
  });

  /* ---------------- painting ---------------- */
  function paintTop() {
    const e = data.email;
    top.replaceChildren(
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
        metric("Not emailed", String(data.unsent), data.unsent ? "Saved here; use Resend once email works" : null))));
  }

  const resultsLine = () => {
    if (searching) return "Searching…";
    if (!query) return data.truncated ? `Showing the newest ${shown.length} of ${data.total} requests. Use search to find older ones.` : `${data.total} request${data.total === 1 ? "" : "s"}.`;
    const base = `${matched} request${matched === 1 ? " matches" : "s match"} “${query}”.`;
    return matched > shown.length ? `${base} Showing the newest ${shown.length}; refine the search to narrow it down.` : base;
  };

  function paintResults() {
    clearBtn.hidden = !query;
    const rows = shown;
    let body;
    if (rows.length) {
      body = h("table", { class: "adm-table" },
        h("thead", null, h("tr", null, ["Business", "Submitted", "Contact", "Notification", ""].map((t) => h("th", { scope: "col" }, t || h("span", { class: "visually-hidden" }, "Actions"))))),
        h("tbody", null, rows.map((r) => h("tr", null,
          h("td", { "data-label": "Business" }, h("span", { class: "adm-client" }, r.business_name || "—"), h("span", { class: "adm-client__sub" }, (r.website || "") + " · Ref " + shortRef(r.id)), details(r, ctx)),
          h("td", { "data-label": "Submitted" }, fmtDateTime(r.created_at)),
          h("td", { "data-label": "Contact" }, r.contact_name, h("span", { class: "adm-client__sub" }, r.email)),
          h("td", { "data-label": "Notification" },
            h("span", { class: "adm-status-mark " + (r.notify_status === "sent" ? "is-reviewed" : "is-unreviewed") }, statusLabel(r)),
            r.notify_status !== "sent" && r.notify_error ? h("span", { class: "adm-client__sub" }, "Reason: " + r.notify_error) : null,
            r.notify_attempts ? h("span", { class: "adm-client__sub" }, `${r.notify_attempts} attempt${r.notify_attempts === 1 ? "" : "s"}`) : null),
          // The flex layout lives on an inner wrapper: a <td> that is itself display:flex stops being a table cell,
          // so its bottom border no longer lines up with the rest of the row.
          h("td", { "data-label": "" }, h("div", { class: "adm-row-actions" },
            r.notify_status !== "sent" ? h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: busy.has(r.id), onclick: () => resend(r.id) }, "Resend") : null,
            (() => {
              const b = h("button", { class: "adm-icon-btn", type: "button", title: "Delete assessment", "aria-label": "Delete assessment from " + (r.business_name || "Ref " + shortRef(r.id)), disabled: busy.has(r.id), onclick: () => remove(r) });
              b.insertAdjacentHTML("afterbegin", TRASH);
              return b;
            })())),
        ))));
    } else if (query && !searching) {
      body = stateBlock({ title: "No matching assessments", body: `Nothing matches “${query}”. Check the spelling, or try part of a business name, a contact name or an email address.`, actionLabel: "Clear search", onAction: clearSearch });
    } else if (!query) {
      body = stateBlock({ title: "No assessment requests yet", body: "Requests from the /assessment form appear here, whether or not the notification email went out." });
    } else {
      body = h("div");
    }
    results.replaceChildren(h("p", { class: "adm-sub adm-results-line", role: "status" }, resultsLine()), body);
  }

  const node = h("div", { class: "adm-page" }, top, h("section", { class: "adm-section" }, searchForm, results));
  paintTop();
  paintResults();
  return { title: "Assessments", node };
}
