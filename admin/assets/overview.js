/* Framework Admin — Overview module: /admin. A working dashboard: what needs a person first, then clients, support requests, invoices, feedback and what just happened.
   Everything is live data from the Admin API; each part loads on its own, so one failing part never blanks the page. Server text is never inserted as HTML. */

import { h, api, stateBlock, fmtDate } from "./ui.js";
import { responseTable } from "./feedback.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const money = (cents) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format((Number(cents) || 0) / 100);
const quiet = (path) => api(path).catch(() => null); // a part that cannot load is simply left out
const enc = encodeURIComponent;

/** "5 min ago", "3 h ago", "2 d ago", then the date. */
export function ago(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const m = Math.round((now - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  if (m < 14400) return `${Math.round(m / 1440)} d ago`;
  return fmtDate(iso);
}

const kpi = ({ label, value, unit, note, href, local = false }) =>
  h("a", { class: "adm-kpi", href, "data-link": local ? null : "" },
    h("span", { class: "adm-kpi__label", text: label }),
    h("span", { class: "adm-kpi__value" }, value, unit ? h("span", { class: "adm-kpi__unit", text: unit }) : null),
    h("span", { class: "adm-kpi__note", text: note || " " }));

const section = (id, title, body, more) =>
  h("section", { class: "adm-section adm-dash__sec", "aria-labelledby": id },
    h("div", { class: "adm-section-title" }, h("h2", { id, text: title }), more ? h("a", { class: "adm-link", href: more[0], "data-link": "" }, more[1] + " →") : null),
    body);

const empty = (text) => h("p", { class: "adm-sub adm-dash__empty", text });

/** The ranked list of things that need a person. Most urgent first; each item says what and where to go. */
export function attentionItems({ dash, services, assess, feedback }) {
  const items = [];
  const add = (tone, text, href, label) => items.push({ tone, text, href, label });
  if (services && services.emails && services.emails.failed) add("bad", plural(services.emails.failed, "notification email") + " failed to send", "/admin/support", "Open Support Requests");
  if (assess && assess.unsent) add("bad", plural(assess.unsent, "assessment request") + " saved but not emailed", "/admin/assessments", "Open Assessments");
  const inv = dash && dash.invoices;
  if (inv && inv.overdue) add("bad", `${plural(inv.overdue, "invoice")} past due`, inv.overdueItems[0] ? `/admin/clients/${enc(inv.overdueItems[0].organizationId)}/invoices` : "/admin/clients", "Review");
  const sup = dash && dash.support;
  if (sup && sup.attention) add("warn", plural(sup.attention, "support request") + " with new activity", "/admin/support", "Open Support Requests");
  const cl = dash && dash.clients;
  if (cl && cl.withoutAccess.length) add("warn", `${plural(cl.withoutAccess.length, "client")} with nobody signed in or invited yet`, `/admin/clients/${enc(cl.withoutAccess[0].id)}`, "Invite someone");
  if (cl && cl.lapsedInvitations) add("warn", plural(cl.lapsedInvitations, "invitation") + " expired without being accepted", "/admin/clients", "Open Clients");
  if (inv && inv.drafts) add("info", plural(inv.drafts, "draft invoice") + " not published yet", inv.draftItems[0] ? `/admin/clients/${enc(inv.draftItems[0].organizationId)}/invoices` : "/admin/clients", "Review");
  if (services && services.emails && !services.emails.failed && services.emails.pending) add("info", plural(services.emails.pending, "notification email") + " waiting to be sent", "/admin/support", "Open Support Requests");
  if (feedback && feedback.stats.unreviewed) add("info", plural(feedback.stats.unreviewed, "client feedback response", "client feedback responses") + " not reviewed", "/admin/feedback", "Open Feedback");
  return items;
}

function attentionSection(items) {
  const body = items.length
    ? h("ul", { class: "adm-todo" }, items.map((it) => h("li", { class: "adm-todo__item adm-todo__item--" + it.tone },
      h("span", { class: "adm-todo__text", text: it.text }), h("a", { class: "adm-link", href: it.href, "data-link": "" }, it.label + " →"))))
    : h("p", { class: "adm-todo__clear", role: "status" }, "All clear. Nothing needs your attention right now.");
  return section("adm-attn", "Needs attention", body);
}

function kpiGrid({ dash, feedback, requestsCard }) {
  const cl = dash && dash.clients, sup = dash && dash.support, inv = dash && dash.invoices, st = feedback && feedback.stats;
  const cards = [];
  if (requestsCard) cards.push(requestsCard); // first position; the Clients tile gives way to it (Clients stays in the navigation)
  else if (cl) cards.push(kpi({ label: "Clients", value: String(cl.active), note: `${plural(cl.people, "person", "people")} with access${cl.pendingInvitations ? ` · ${cl.pendingInvitations} invited` : ""}`, href: "/admin/clients" }));
  if (sup) cards.push(kpi({ label: "Support requests", value: String(sup.open), unit: "open", note: sup.attention ? `${sup.attention} with new activity` : "Nothing new", href: "/admin/support" }));
  if (inv) cards.push(kpi({ label: "Invoices", value: money(inv.outstandingCents), note: inv.outstandingCount ? `${plural(inv.outstandingCount, "unpaid invoice")}${inv.overdue ? ` · ${inv.overdue} past due` : ""}` : "Nothing outstanding", href: "/admin/clients" }));
  if (st) cards.push(kpi({ label: "Client feedback", value: st.total ? (st.avg_satisfaction === null ? "—" : st.avg_satisfaction.toFixed(1)) : "—", unit: st.total ? "/ 10" : null, note: st.total ? `${plural(st.total, "response")}${st.unreviewed ? ` · ${st.unreviewed} unreviewed` : ""}` : "No feedback yet", href: "/admin/feedback" }));
  return cards.length ? h("div", { class: "adm-kpis", role: "group", "aria-label": "Summary" }, cards) : null;
}

/** The first summary tile: how many client requests are outstanding. It scrolls to the detailed list below instead of leaving the page. */
export function requestsTile(reqs) {
  if (!reqs) return null;
  const parts = [reqs.branding ? `${reqs.branding} Branding` : null, reqs.support ? `${reqs.support} support or change` : null].filter(Boolean);
  const tile = kpi({ label: "Client requests", value: String(reqs.total), unit: "outstanding", note: reqs.total ? parts.join(" · ") : "Nothing outstanding", href: "#adm-req-sec", local: true });
  tile.addEventListener("click", (ev) => {
    const sec = document.getElementById("adm-req-sec");
    if (!sec) return;
    ev.preventDefault();
    sec.scrollIntoView({ behavior: window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    const heading = sec.querySelector("h2");
    heading.setAttribute("tabindex", "-1");
    heading.focus({ preventScroll: true });
  });
  return tile;
}

const row = (main, meta, href) =>
  h("li", { class: "adm-feed__row" },
    href ? h("a", { class: "adm-feed__main adm-link", href, "data-link": "", text: main }) : h("span", { class: "adm-feed__main", text: main }),
    h("span", { class: "adm-feed__meta", text: meta }));

/** Where a request lives: a Branding request on its client's Branding page (Service requests opens by itself when one is outstanding), a support or change request on its own page. */
const requestHref = (r) => (r.kind === "branding" ? `/admin/clients/${enc(r.organizationId)}/branding` : `/admin/support/${enc(r.organizationId)}/${enc(r.id)}`);

/** Outstanding client requests across every client, newest first: client, type, status, date, and a link to the request. Closed and declined ones are never in the data. */
export function requestsSection(reqs) {
  if (!reqs) return null;
  const parts = [reqs.branding ? plural(reqs.branding, "Branding request") : null, reqs.support ? plural(reqs.support, "support or change request", "support or change requests") : null].filter(Boolean);
  const count = h("p", { class: "adm-sub adm-req__count", role: "status", text: reqs.total ? `${reqs.total} outstanding${parts.length ? ` · ${parts.join(" · ")}` : ""}` : "Nothing outstanding" });
  const list = reqs.items.length
    ? h("ul", { class: "adm-feed" }, reqs.items.map((r) => row(`${r.orgName}: ${r.type}`, `${r.statusLabel}${r.note ? ` · ${r.note}` : ""} · ${fmtDate(r.createdAt)}`, requestHref(r))))
    : empty("No client requests need a response.");
  const more = reqs.total > reqs.items.length ? h("p", { class: "adm-sub", text: `Showing the newest ${reqs.items.length} of ${reqs.total}.` }) : null;
  return h("section", { class: "adm-section adm-dash__sec adm-dash__sec--wide", id: "adm-req-sec", "aria-labelledby": "adm-req" },
    h("div", { class: "adm-section-title" }, h("h2", { id: "adm-req", text: "Client requests" }), reqs.support ? h("a", { class: "adm-link", href: "/admin/support", "data-link": "" }, "All support requests →") : null),
    count, list, more);
}

/** Keeps the section current without a reload: every minute and whenever the tab becomes visible again, and only while the section is on the page. */
function watchRequests(first, firstTile) {
  let current = first, tile = firstTile, timer = 0;
  const stop = () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  const refresh = async () => {
    if (!current.isConnected) return stop();
    const data = await quiet("/dashboard/requests");
    const next = data && data.available !== false ? requestsSection(data.requests) : null;
    if (next && current.isConnected) {
      current.replaceWith(next); current = next;
      const nextTile = requestsTile(data.requests); // the count in the first summary tile moves with the list
      if (tile && tile.isConnected && nextTile) { tile.replaceWith(nextTile); tile = nextTile; }
    }
  };
  const onVisible = () => { if (document.visibilityState === "visible") refresh(); };
  timer = window.setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", onVisible);
}

function supportSection(sup) {
  if (!sup) return null;
  const body = sup.items.length
    ? h("ul", { class: "adm-feed" }, sup.items.map((r) => row(`${r.orgName}: ${r.title}`, `${r.reason || "Open"} · ${ago(r.lastMessageAt)}`, `/admin/support/${enc(r.organizationId)}/${enc(r.id)}`)))
    : empty("No support requests need attention.");
  return section("adm-sup", "Support requests", body, ["/admin/support", "All support requests"]);
}

function invoiceSection(inv) {
  if (!inv) return null;
  const rows = [
    ...inv.overdueItems.map((r) => row(`${r.orgName}: ${r.number}`, `${money(r.cents)} · due ${fmtDate(r.dueDate)}`, `/admin/clients/${enc(r.organizationId)}/invoices`)),
    ...inv.draftItems.map((r) => row(`${r.orgName}: ${r.number}`, `${money(r.cents)} · draft`, `/admin/clients/${enc(r.organizationId)}/invoices`)),
  ];
  return section("adm-inv", "Invoices", rows.length ? h("ul", { class: "adm-feed" }, rows) : empty(inv.outstandingCount ? "Nothing is past due and no drafts are waiting." : "No invoices are outstanding."), ["/admin/clients", "Clients"]);
}

function clientSection(cl) {
  if (!cl) return null;
  const lines = [];
  if (cl.profile && cl.profile.total) lines.push(row("Business Profile completion", `${cl.profile.avgPercent}% on average · ${cl.profile.incomplete} of ${cl.profile.total} not finished`));
  for (const c of cl.withoutAccess) lines.push(row(c.name, "Nobody has access yet", `/admin/clients/${enc(c.id)}`));
  if (cl.lapsedInvitations) lines.push(row(plural(cl.lapsedInvitations, "expired invitation"), "Resend or replace from the client's page"));
  return section("adm-cl", "Clients", lines.length ? h("ul", { class: "adm-feed" }, lines) : empty("No clients yet. Add the first one under Clients."), ["/admin/clients", "All clients"]);
}

function activitySection(items) {
  if (!items) return null;
  const body = items.length
    ? h("ul", { class: "adm-feed" }, items.map((a) => row(a.orgName ? `${a.label}: ${a.orgName}` : a.label, ago(a.at), a.organizationId ? `/admin/clients/${enc(a.organizationId)}` : null)))
    : empty("Nothing has happened yet.");
  return section("adm-act", "Recent activity", body);
}

export async function render() {
  const [dash, feedback, services, assess] = await Promise.all([quiet("/dashboard"), quiet("/overview"), quiet("/services/attention"), quiet("/assessments/summary")]);
  const d = dash && dash.available ? dash : null;
  const svc = services && services.available ? services : null;
  const recent = feedback && feedback.recent.length
    ? responseTable(feedback.recent.slice(0, 5), ["client", "date", "satisfaction", "recommend", "testimonial", "view"])
    : feedback ? stateBlock({ title: "No feedback yet", body: "Responses appear here after a client completes the feedback form." }) : null;

  // The outstanding support requests are rows of the Client requests list; the separate Support requests list is only the fallback when that list cannot load.
  const requestsEl = requestsSection(d && d.requests);
  const requestsCard = requestsTile(d && d.requests);
  const node = h("div", { class: "adm-page adm-dash" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Overview"),
      d ? h("p", { class: "adm-sub", text: `Live data · updated ${ago(d.generatedAt)}` }) : null)),
    ...[
      attentionSection(attentionItems({ dash: d, services: svc, assess, feedback })),
      kpiGrid({ dash: d, feedback, requestsCard }),
      h("div", { class: "adm-dash__cols" }, ...[requestsEl, requestsEl ? null : supportSection(d && d.support), invoiceSection(d && d.invoices), clientSection(d && d.clients), activitySection(d && d.activity)].filter(Boolean)),
      recent ? section("adm-recent", "Recent feedback", recent, feedback.recent.length ? ["/admin/feedback", "All feedback"] : null) : null,
    ].filter(Boolean),
  );
  if (requestsEl) watchRequests(requestsEl, requestsCard);
  if (!d && !feedback) node.append(stateBlock({ title: "The overview couldn't load", body: "Nothing has been changed. Reload the page to try again.", actionLabel: "Reload", onAction: () => location.reload() }));
  return { title: "Overview", node };
}
