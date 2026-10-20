/* Framework Admin — Portal Feedback module (read-only): /admin/portal-feedback. Messages sent by signed-in portal clients.
   Separate from the website project "Client Feedback" survey. Client text is only ever inserted as text. */

import { h, api, fmtDateTime, stateBlock } from "./ui.js";

export async function render() {
  const data = await api("/portal-feedback");
  const rows = data.items;
  const table = h("table", { class: "adm-table adm-table--left" },
    h("thead", null, h("tr", null, ["Organization", "Type", "Submitted", "About", "Message"].map((t) => h("th", { scope: "col" }, t)))),
    h("tbody", null, rows.map((r) => h("tr", null,
      h("td", { "data-label": "Organization" }, h("span", { class: "adm-client" }, r.organization.name)),
      h("td", { "data-label": "Type" }, r.kind_label),
      h("td", { "data-label": "Submitted" }, fmtDateTime(r.created_at)),
      h("td", { "data-label": "About" }, r.page_label || h("span", { class: "adm-muted" }, "Not specified")),
      h("td", { "data-label": "Message", class: "adm-feedback-msg" }, h("span", { class: "adm-answer", text: r.message })),
    ))),
  );
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Portal Feedback"),
      h("p", { class: "adm-sub" }, "Messages from signed-in portal clients, newest first. Read-only."))),
    data.available ? null : h("p", { class: "adm-banner" }, "Portal feedback isn’t available on this deployment yet (its database migration hasn’t been applied)."),
    rows.length ? table : data.available ? stateBlock({ title: "No portal feedback yet", body: "Messages appear here when a client uses “Send feedback” in the portal." }) : null,
    rows.length ? h("p", { class: "adm-sub", role: "status" }, `${rows.length} ${rows.length === 1 ? "message" : "messages"}.` + (data.truncated ? " Only the newest 500 are shown." : "")) : null,
  );
  return { title: "Portal Feedback", node };
}
