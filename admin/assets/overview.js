/* Framework Admin — Overview module: /admin */

import { h, api, stateBlock } from "./ui.js";
import { responseTable } from "./feedback.js";

const metric = (label, value, unit, note) =>
  h("div", { class: "adm-metric" },
    h("p", { class: "adm-metric__label" }, label),
    h("div", { class: "adm-metric__value" }, value, unit ? h("span", { class: "adm-metric__unit" }, unit) : null),
    note ? h("p", { class: "adm-metric__note" }, note) : null);

export async function render() {
  const data = await api("/overview");
  const s = data.stats;
  const none = s.total === 0;
  const avg = (n) => (n === null ? "—" : n.toFixed(1));

  const recent = data.recent.length
    ? responseTable(data.recent, ["client", "date", "satisfaction", "recommend", "testimonial", "view"])
    : stateBlock({ title: "No feedback yet", body: "Responses appear here after a client completes the feedback form." });

  // Never let a saved-but-unemailed assessment request go unnoticed: surface it on the first screen.
  const alert = h("p", { class: "adm-banner adm-banner--alert", hidden: true, role: "status" });
  api("/assessments/summary").then((a) => {
    if (!a.unsent) return;
    alert.replaceChildren(h("strong", null, `${a.unsent} assessment request${a.unsent === 1 ? "" : "s"} saved but not emailed. `), h("a", { class: "adm-link", href: "/admin/assessments", "data-link": "" }, "Review and resend →"));
    alert.hidden = false;
  }).catch(() => {});

  // What needs a person: requests nobody has looked at, invoices to publish or past due, and notification emails that did not go out.
  const attn = h("section", { class: "adm-section", "aria-labelledby": "adm-attn", hidden: true });
  api("/services/attention").then((a) => {
    if (!a.available) return;
    const items = [];
    const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
    if (a.support.attention) items.push([plural(a.support.attention, "support request") + " with new activity", "/admin/support", "Open Support Requests"]);
    if (a.invoices.overdue) items.push([plural(a.invoices.overdue, "published invoice") + " past due", "/admin/clients", "Open Clients"]);
    if (a.invoices.drafts) items.push([plural(a.invoices.drafts, "draft invoice") + " not published yet", "/admin/clients", "Open Clients"]);
    if (a.emails.failed) items.push([plural(a.emails.failed, "notification email") + " failed to send", "/admin/support", "Open Support Requests"]);
    else if (a.emails.pending) items.push([plural(a.emails.pending, "notification email") + " waiting to be sent", "/admin/support", "Open Support Requests"]);
    if (!items.length) return;
    attn.replaceChildren(h("div", { class: "adm-section-title" }, h("h2", { id: "adm-attn" }, "Needs attention")),
      h("ul", { class: "adm-attnlist" }, items.map(([text, href, label]) => h("li", null, h("span", { text }), h("a", { class: "adm-link", href, "data-link": "" }, label + " →")))));
    attn.hidden = false;
  }).catch(() => {});

  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Overview"))),

    alert,
    attn,
    h("section", { class: "adm-section", "aria-label": "Feedback summary" }, h("div", { class: "adm-metrics" },
      metric("Total feedback", String(s.total), null, s.unreviewed ? `${s.unreviewed} unreviewed` : null),
      metric("Avg. satisfaction", none ? "—" : avg(s.avg_satisfaction), none ? null : "/ 10"),
      metric("Avg. recommendation", none ? "—" : avg(s.avg_recommend), none ? null : "/ 10"),
      metric("Testimonial permissions", String(s.testimonial_yes), null, none ? null : `${s.logo_yes} also allow portfolio use`),
    )),

    h("section", { class: "adm-section", "aria-labelledby": "adm-recent" },
      h("div", { class: "adm-section-title" }, h("h2", { id: "adm-recent" }, "Recent feedback"),
        data.recent.length ? h("a", { class: "adm-link", href: "/admin/feedback", "data-link": "" }, "All feedback →") : null),
      recent),
  );
  return { title: "Overview", node };
}
