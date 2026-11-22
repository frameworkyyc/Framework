/* Framework Admin: Operations, the hub for the day-to-day inboxes: leads, enquiries, Brand Discovery, requests, support and feedback (/admin/operations). Each page keeps its own address and module;
   this page shows where things stand, with real figures only (a figure that cannot be read is simply left out), and the way in. Server text is only ever set as text. */
import { h, api } from "./ui.js";
import { pageHead, grid, span, card, kpi, icon, pill, empty } from "./ds.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const quiet = (path) => api(path).catch(() => null);

/** One way in: an icon, a title, a line about it, and (when it can be read) one figure. */
const tile = ({ href, ic, title, body, stat, tone }) => h("a", { class: "ds-card ds-linktile", href, "data-link": "" },
  h("span", { class: "ds-linktile__ico" }, icon(ic)),
  h("span", { class: "ds-linktile__text" }, h("strong", { class: "ds-linktile__t", text: title }), h("span", { class: "ds-linktile__b", text: body }), stat ? h("span", { class: "ds-linktile__s" }, pill(stat, tone || "quiet")) : null), h("i", { class: "ds-chev ds-chev--r", "aria-hidden": "true" }));

export async function render() {
  const [dash, feedback, services, assess] = await Promise.all([quiet("/dashboard"), quiet("/overview"), quiet("/services/attention"), quiet("/assessments/summary")]);
  const d = dash && dash.available ? dash : null, svc = services && services.available ? services : null;
  const sup = d && d.support, inv = d && d.invoices, req = d && d.requests, st = feedback && feedback.stats;
  const kpis = [
    sup ? kpi({ label: "Support requests", value: String(sup.open), unit: "open", note: sup.attention ? `${sup.attention} with new activity` : "Nothing new", tone: sup.attention ? "warn" : "ok", href: "/admin/support" }) : null,
    req ? kpi({ label: "Client requests", value: String(req.total), unit: "outstanding", note: req.total ? [req.branding ? `${req.branding} Branding` : "", req.support ? `${req.support} support or change` : ""].filter(Boolean).join(" · ") : "Nothing outstanding", href: "/admin/requests" }) : null,
    inv ? kpi({ label: "Invoices", value: String(inv.outstandingCount), unit: "unpaid", note: inv.overdue ? `${inv.overdue} past due` : inv.drafts ? `${inv.drafts} draft${inv.drafts === 1 ? "" : "s"}` : "None past due", tone: inv.overdue ? "bad" : "ok", href: "/admin/clients" }) : null,
    st ? kpi({ label: "Client feedback", value: String(st.total), unit: "responses", note: st.unreviewed ? `${st.unreviewed} unreviewed` : "All reviewed", tone: st.unreviewed ? "warn" : "ok", href: "/admin/feedback" }) : null,
  ].filter(Boolean);
  const unsent = assess && assess.unsent ? assess.unsent : 0;
  const tiles = [
    tile({ href: "/admin/leads", ic: "leads", title: "Leads", body: "Review, pitch and follow up prospects found by the finder." }),
    tile({ href: "/admin/assessments", ic: "assessments", title: "Enquiries", body: "Assessment requests from the website, and whether their emails went out.", stat: assess ? (unsent ? `${plural(unsent, "email")} not sent` : `${assess.total} received`) : null, tone: unsent ? "bad" : "quiet" }),
    tile({ href: "/admin/discovery", ic: "discovery", title: "Brand Discovery", body: "Discovery assessments sent to clients, and what they answered." }),
    tile({ href: "/admin/requests", ic: "requests", title: "Requests", body: "Client requests of every kind, with quotes, files and revisions.", stat: req ? (req.total ? `${req.total} outstanding` : "None outstanding") : null, tone: req && req.total ? "info" : "ok" }),
    tile({ href: "/admin/support", ic: "support", title: "Support", body: "Support conversations with clients.", stat: sup ? (sup.attention ? `${sup.attention} need attention` : `${sup.open} open`) : null, tone: sup && sup.attention ? "warn" : "quiet" }),
    tile({ href: "/admin/feedback", ic: "feedback", title: "Feedback", body: "Client feedback responses and portal feedback messages.", stat: st ? (st.unreviewed ? `${st.unreviewed} unreviewed` : `${st.total} responses`) : null, tone: st && st.unreviewed ? "warn" : "quiet" }),
  ];
  const mail = svc && svc.emails && svc.emails.failed ? card({ tone: "tone", body: h("p", { class: "ds-note" }, pill(`${plural(svc.emails.failed, "notification email")} failed to send`, "bad"), " ", h("a", { class: "ds-link", href: "/admin/support", "data-link": "" }, "Open Support")) }) : null;
  const node = h("div", { class: "ds-page" }, pageHead({ title: "Operations", sub: "The inboxes and day-to-day work, in one place." }),
    grid(...kpis.map((k) => span(k, 3)), mail ? span(mail, 12) : null, ...tiles.map((t) => span(t, 4))),
    !kpis.length && !d ? empty({ title: "Figures couldn’t be loaded", body: "The pages below still work. Reload to try again." }) : null);
  return { title: "Operations", node };
}
