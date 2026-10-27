/* Framework Admin — Support Requests: /admin/support (requests from every client) and /admin/support/:client/:request (one conversation).
   The list says what needs attention first; opening a row shows the whole conversation without going through the client's page. All checks and rules are the
   server's (worker/portal/admin-support.js); server text is never inserted as HTML. */

import { h, api, errorState, fmtDateTime } from "./ui.js";
import { chip } from "./client-dashboard.js";

const CATEGORY = { website_change: "Website change", design_revision: "Logo or design revision", technical_issue: "Technical issue", general: "General support" };
const STATUS = { new: "New", in_review: "In review", quoted: "Quote sent", approved: "Approved", in_progress: "In progress", completed: "Completed", declined: "Declined" };
const SCOPES = [["attention", "Needs attention"], ["open", "Open"], ["closed", "Closed"], ["all", "All"]];
const REASON = { new: "New request", reply: "Client replied" };
const EMPTY = { attention: ["Nothing needs attention", "Every open request has been looked at."], open: ["No open requests", "Requests that are not completed or declined appear here."], closed: ["No closed requests", ""], all: ["No requests yet", "Requests from clients appear here."] };
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

export async function render(ctx) {
  const parts = ctx.url.pathname.replace(/\/+$/, "").split("/").filter(Boolean); // admin, support, [client, request]
  if (parts.length === 4) return (await import("./support.js")).render(decodeURIComponent(parts[2]), ctx, { only: decodeURIComponent(parts[3]), back: { href: "/admin/support", label: "← All support requests" } });
  const scope = SCOPES.some(([k]) => k === ctx.url.searchParams.get("scope")) ? ctx.url.searchParams.get("scope") : "attention";
  let data;
  try { data = await api("/support?scope=" + scope); } catch (err) { return { title: "Support Requests", node: h("div", { class: "adm-page" }, errorState(err, ctx.retry)) }; }
  if (!data.available) return { title: "Support Requests", node: h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, "Support Requests"), h("p", { class: "adm-banner" }, "Support requests aren’t available on this deployment (its database migration hasn’t been applied).")) };

  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const emails = data.emails;
  const sendNow = h("button", { class: "btn btn--secondary adm-small", type: "button", disabled: data.capabilities.writes ? null : true, onclick: async () => {
    sendNow.disabled = true; live.hidden = false; live.className = "adm-msg is-info"; live.textContent = "Sending…";
    try {
      const r = await api("/services/notifications/process", { method: "POST", body: {} });
      const x = r.result;
      live.className = "adm-msg is-success"; live.textContent = !x.configured ? "Email isn’t set up on this site, so nothing was sent." : `Sent ${x.sent}, ${x.retry} to retry, ${x.failed} failed, ${x.skipped} skipped.`;
    } catch { live.className = "adm-msg is-error"; live.textContent = "That didn’t work and nothing was changed. Try again."; }
    live.focus({ preventScroll: false }); sendNow.disabled = !data.capabilities.writes;
  } }, "Send pending emails now");
  const emailLine = emails.pending || emails.failed || !emails.configured
    ? h("p", { class: "adm-banner" }, !emails.configured ? "Email isn’t set up on this site, so notification emails are waiting. " : "", emails.pending ? `${plural(emails.pending, "notification email")} waiting to be sent. ` : "", emails.failed ? `${plural(emails.failed, "notification email")} failed after several tries. ` : "", " ", sendNow)
    : null;

  const row = (r) => h("li", null, h("a", { class: "adm-reqrow", href: `/admin/support/${encodeURIComponent(r.organization.id)}/${encodeURIComponent(r.id)}`, "data-link": "" },
    h("span", { class: "adm-reqrow__main" }, h("span", { class: "adm-reqrow__client", text: r.organization.name }), h("span", { class: "adm-reqrow__title", text: r.title }),
      h("span", { class: "adm-sub", text: `${CATEGORY[r.category]} · last message ${fmtDateTime(r.lastMessageAt)}` })),
    h("span", { class: "adm-reqrow__chips" }, r.reason ? chip("pending", REASON[r.reason], "info") : null, r.reason === "new" && r.status === "new" ? null : chip(r.closed ? "plain" : "ok", STATUS[r.status]), r.scope === "change" ? chip("warn", "May be billable", "warn") : null),
    h("span", { class: "adm-reqrow__go", "aria-hidden": "true", text: "→" })));

  const tabs = h("nav", { class: "adm-tabs", "aria-label": "Show" }, h("ul", null, SCOPES.map(([k, label]) => {
    const n = k === "attention" ? data.totals.attention : k === "open" ? data.totals.open : k === "all" ? data.totals.total : null;
    return h("li", null, h("a", { class: "adm-tab", href: "/admin/support" + (k === "attention" ? "" : "?scope=" + k), "data-link": "", "aria-current": k === scope ? "page" : null }, label, n !== null ? h("span", { class: "adm-tab__n", text: String(n) }) : null));
  })));
  const [et, eb] = EMPTY[scope];
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Support Requests"),
      h("p", { class: "adm-sub" }, "Requests from every client. Open one to read the conversation, reply and update its status."))),
    live, emailLine, tabs,
    data.requests.length ? h("ul", { class: "adm-reqlist", "aria-label": "Support requests" }, data.requests.map(row)) : h("div", { class: "adm-state", role: "status" }, h("h2", { text: et }), eb ? h("p", { text: eb }) : null));
  return { title: "Support Requests", node };
}
