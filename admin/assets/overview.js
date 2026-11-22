/* Framework Admin — Overview module: /admin. A working dashboard: what needs a person first, then clients, support requests, invoices, feedback and what just happened.
   Everything is live data from the Admin API; each part loads on its own, so one failing part never blanks the page. Server text is never inserted as HTML. */

import { h, api, stateBlock, fmtDate, confirmDialog } from "./ui.js";
import { responseCards } from "./feedback.js";
import { navIcon, badge } from "./kit.js";
import { card, barChart, pill, icon as dsIcon, segmented, button } from "./ds.js";

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

const section = (id, title, body, more, plain = false) =>
  h("section", { class: (plain ? "adm-dash__top " : "rk-card ") + "adm-dash__sec", "aria-labelledby": id },
    h("div", { class: "rk-card__head" }, h("h2", { class: "rk-card__title", id, text: title }), more ? h("a", { class: "adm-link", href: more[0], "data-link": "" }, more[1] + " →") : null),
    body);

const empty = (text) => h("p", { class: "rk-quiet" }, navIcon("check"), h("span", { text }));

/** The ranked list of things that need a person. Most urgent first; each item says what and where to go. `key` and `fp` identify the issue and what it looks like right now: a dismissed
 *  item stays away while its fingerprint is unchanged and comes back when something new happens (a bigger count, a newer item). */
export function attentionItems({ dash, services, assess, feedback }) {
  const items = [];
  const add = (key, fp, tone, text, href, label) => items.push({ key, fp: String(fp), tone, text, href, label });
  if (services && services.emails && services.emails.failed) add("email.failed", services.emails.failed, "bad", plural(services.emails.failed, "notification email") + " failed to send", "/admin/support", "Open Support Requests");
  // Client notifications that could not be emailed because nobody on the approved list could receive them: one line per client (the newest three), naming the addresses
  // that are not approved. It clears itself once they are approved, or by "Dismiss" for addresses that never will be.
  const skipped = (services && services.emails && services.emails.unapproved) || [];
  for (const o of skipped.slice(0, 3)) {
    const who = o.recipients.length ? `Not approved: ${o.recipients.join(", ")}.` : "Nobody with access can receive email.";
    items.push({ key: "email.unapproved:" + o.organizationId, fp: String(o.notices), tone: "warn", text: `${o.orgName}: ${plural(o.notices, "client notification")} not emailed. ${who}`, href: "/admin/approved-emails", label: "Open Approved Emails", dismiss: { organizationId: o.organizationId, orgName: o.orgName } });
  }
  if (skipped.length > 3) items.push({ key: "email.unapproved.more", fp: String(skipped.length), tone: "warn", text: `${skipped.length - 3} more ${skipped.length - 3 === 1 ? "client has" : "clients have"} notifications not emailed because an address isn’t approved`, href: "/admin/approved-emails", label: "Open Approved Emails" });
  if (assess && assess.unsent) add("assess.unsent", assess.unsent, "bad", plural(assess.unsent, "assessment request") + " saved but not emailed", "/admin/assessments", "Open Assessments");
  const inv = dash && dash.invoices;
  if (inv && inv.overdue) add("invoices.overdue", `${inv.overdue}|${inv.overdueItems[0] ? inv.overdueItems[0].number : ""}`, "bad", `${plural(inv.overdue, "invoice")} past due`, inv.overdueItems[0] ? `/admin/clients/${enc(inv.overdueItems[0].organizationId)}/invoices` : "/admin/clients", "Review");
  const sup = dash && dash.support;
  if (sup && sup.attention) add("support.attention", `${sup.attention}|${sup.items && sup.items[0] ? sup.items[0].lastMessageAt || sup.items[0].id : ""}`, "warn", plural(sup.attention, "support request") + " with new activity", "/admin/support", "Open Support Requests");
  const cl = dash && dash.clients;
  if (cl && cl.withoutAccess.length) add("clients.noaccess", `${cl.withoutAccess.length}|${cl.withoutAccess[0].id}`, "warn", `${plural(cl.withoutAccess.length, "client")} with nobody signed in or invited yet`, `/admin/clients/${enc(cl.withoutAccess[0].id)}`, "Invite someone");
  if (cl && cl.lapsedInvitations) add("clients.lapsed", cl.lapsedInvitations, "warn", plural(cl.lapsedInvitations, "invitation") + " expired without being accepted", "/admin/clients", "Open Clients");
  if (inv && inv.drafts) add("invoices.drafts", `${inv.drafts}|${inv.draftItems[0] ? inv.draftItems[0].number : ""}`, "info", plural(inv.drafts, "draft invoice") + " not published yet", inv.draftItems[0] ? `/admin/clients/${enc(inv.draftItems[0].organizationId)}/invoices` : "/admin/clients", "Review");
  if (services && services.emails && !services.emails.failed && services.emails.pending) add("email.pending", services.emails.pending, "info", plural(services.emails.pending, "notification email") + " waiting to be sent", "/admin/support", "Open Support Requests");
  if (feedback && feedback.stats.unreviewed) add("feedback.unreviewed", `${feedback.stats.unreviewed}|${feedback.recent && feedback.recent[0] ? feedback.recent[0].id : ""}`, "info", plural(feedback.stats.unreviewed, "client feedback response", "client feedback responses") + " not reviewed", "/admin/feedback", "Open Feedback");
  return items;
}

const TONE_ICON = { bad: "warn", warn: "warn", info: "bell" };
const fpOf = (v) => String(v).replace(/[^A-Za-z0-9._:|,-]/g, "_").slice(0, 80);

/** One "Needs attention" card: what, a link to where it is fixed, and an X that sets it aside. The X is remembered on the server (across refreshes and sessions) with a fingerprint of the
 *  issue as it is now, so a new occurrence of the same issue shows up again. The "notifications not emailed" warning keeps its own confirmed dismissal (nothing is sent; it is audited). */
function todoRow(it, onGone) {
  const li = h("li", { class: "adm-todo__item ds-nc adm-todo__item--" + it.tone },
    h("span", { class: "ds-nc__ico", "aria-hidden": "true" }, dsIcon(TONE_ICON[it.tone] || "bell")),
    h("span", { class: "adm-todo__text ds-nc__text", text: it.text }));
  const link = h("a", { class: "adm-link ds-nc__go", href: it.href, "data-link": "" }, it.label + " →");
  const status = h("span", { class: "visually-hidden", role: "status" });
  const gone = (words, undo) => {
    li.classList.add("is-dismissed");
    li.replaceChildren(h("span", { class: "adm-todo__text adm-sub ds-nc__text", text: words }), undo || "", status);
    if (onGone) onGone();
  };
  const x = h("button", { class: "adm-todo__dismiss ds-nc__x", type: "button", "aria-label": "Dismiss: " + it.text, title: "Dismiss", onclick: async () => {
    if (it.dismiss) {
      if (!(await confirmDialog({ title: "Dismiss this warning?", body: `Nothing is sent. The skipped notifications for ${it.dismiss.orgName} stay unsent and this warning is cleared. Approve the addresses instead if the client should receive emails.`, confirmLabel: "Dismiss warning" }))) return;
      x.disabled = true;
      try {
        await api("/services/notifications/dismiss", { method: "POST", body: { organization_id: it.dismiss.organizationId } });
        status.textContent = `Warning for ${it.dismiss.orgName} dismissed.`;
        gone(`Dismissed: ${it.dismiss.orgName}.`);
      } catch { x.disabled = false; status.textContent = "That didn’t work and nothing was changed."; li.append(h("span", { class: "adm-sub", text: "That didn’t work and nothing was changed." })); }
      return;
    }
    x.disabled = true;
    try {
      await api("/activity/state", { method: "POST", body: { scope: "attention", key: it.key, fingerprint: fpOf(it.fp), state: "dismissed" } });
      const undo = h("button", { class: "adm-link ds-nc__undo", type: "button", onclick: async () => {
        undo.disabled = true;
        try { await api("/activity/state", { method: "POST", body: { scope: "attention", key: it.key, state: "restored" } }); location.reload(); } catch { undo.disabled = false; }
      } }, "Undo");
      status.textContent = "Dismissed. It will come back if it happens again.";
      gone("Dismissed. It comes back if it happens again.", undo);
    } catch { x.disabled = false; status.textContent = "That didn’t work and nothing was changed."; }
  } }, dsIcon("close"));
  li.append(h("span", { class: "adm-todo__acts ds-nc__acts" }, link), x, status);
  return li;
}

/** "Needs attention": compact cards, most urgent first. Dismissed items (same fingerprint) are left out; everything else is as before. */
function attentionSection(items, dismissed = {}) {
  const shown = items.filter((it) => !(it.key && Object.prototype.hasOwnProperty.call(dismissed, it.key) && dismissed[it.key] === fpOf(it.fp)));
  const clear = () => h("p", { class: "adm-todo__clear", role: "status" }, "All clear. Nothing needs your attention right now.");
  const holder = h("div", null);
  let left = shown.length;
  const body = shown.length
    ? h("ul", { class: "adm-todo ds-ncs" }, shown.map((it) => todoRow(it, () => { left -= 1; if (left === 0) holder.append(clear()); })))
    : clear();
  holder.append(body);
  return section("adm-attn", "Needs attention", holder, null, true);
}

/** The client activity feed: what clients did in the portal (support and change requests, Branding requests, brand files, website updates and answers, feedback, ...), newest first.
 *  Each entry names the client, the action, the time and links to where it is handled. "Action needed" entries are told apart from "For your information" ones. Read and dismissed are
 *  remembered on the server (the history itself is never deleted); a burst of the same event for one client is one entry with a count. null when the feed cannot load. */
export function activityFeed(data) {
  if (!data || !data.available || !Array.isArray(data.events)) return null;
  const events = data.events.map((e) => ({ ...e }));
  let view = "new";
  const mark = (ids, state) => api("/activity/state", { method: "POST", body: { scope: "event", ids, state } });
  const listHost = h("div", { class: "ds-act__host" }), summary = h("p", { class: "ds-muted ds-act__sum", role: "status" });
  const inView = (e) => (view === "new" ? e.state === "new" : view === "dismissed" ? e.state === "dismissed" : e.state !== "dismissed");
  const draw = () => {
    const fresh = events.filter((e) => e.state === "new"), need = fresh.filter((e) => e.kind === "action");
    summary.textContent = fresh.length ? `${fresh.length} new${need.length ? ` · ${need.length} need${need.length === 1 ? "s" : ""} a response` : ""}` : "You’re up to date.";
    markAll.hidden = !fresh.length;
    const rows = events.filter(inView);
    listHost.replaceChildren(rows.length ? h("ul", { class: "ds-act" }, rows.map((e) => entry(e))) : h("p", { class: "ds-muted ds-act__none", text: view === "new" ? "Nothing new. Recent client activity appears here as it happens." : view === "dismissed" ? "Nothing dismissed." : "No client activity in the last 30 days." }));
  };
  const entry = (e) => {
    const act = async (state, btn) => { btn.disabled = true; try { await mark([e.id], state); e.state = state === "unread" ? "new" : state; draw(); } catch { btn.disabled = false; } };
    const link = h("a", { class: "ds-act__go adm-link", href: e.href, "data-link": "", onclick: () => { if (e.state === "new") { e.state = "read"; mark([e.id], "read").catch(() => {}); } } }, "Open →");
    const read = e.state === "new" ? h("button", { class: "ds-act__btn", type: "button", title: "Mark as read", "aria-label": `Mark as read: ${e.clientName} ${e.label}`, onclick: (ev) => act("read", ev.currentTarget) }, dsIcon("check")) : null;
    const back = e.state === "dismissed" ? h("button", { class: "ds-act__btn ds-act__btn--text", type: "button", onclick: (ev) => act("unread", ev.currentTarget) }, "Restore") : null;
    const x = e.state !== "dismissed" ? h("button", { class: "ds-act__btn", type: "button", title: "Dismiss", "aria-label": `Dismiss: ${e.clientName} ${e.label}`, onclick: (ev) => act("dismissed", ev.currentTarget) }, dsIcon("close")) : null;
    return h("li", { class: "ds-act__row" + (e.state === "new" ? " is-new" : "") },
      h("span", { class: "ds-act__dot", "aria-hidden": "true" }),
      h("span", { class: "ds-act__main" },
        h("span", { class: "ds-act__what" }, h("strong", { text: e.clientName }), ` ${e.label}`, e.count > 1 ? h("span", { class: "ds-muted", text: ` (${e.count} times)` }) : null),
        h("span", { class: "ds-act__meta" }, pill(e.kind === "action" ? "Action needed" : "For your information", e.kind === "action" ? "warn" : "quiet"), h("span", { class: "ds-muted", text: ago(e.at) }))),
      h("span", { class: "ds-act__acts" }, link, read, back, x));
  };
  let markBtn = null;
  const markAll = button("Mark all as read", { onClick: async () => {
    const ids = events.filter((e) => e.state === "new").slice(0, 50).map((e) => e.id); if (!ids.length) return;
    markBtn.disabled = true;
    try { await mark(ids, "read"); events.forEach((e) => { if (ids.includes(e.id)) e.state = "read"; }); } catch { /* nothing changed */ }
    markBtn.disabled = false; draw();
  } });
  markBtn = markAll;
  const seg = segmented({ label: "Show", value: "new", onChange: (v) => { view = v; draw(); }, options: [{ id: "new", label: "New" }, { id: "all", label: "All" }, { id: "dismissed", label: "Dismissed" }] });
  draw();
  return card({ title: "Client activity", sub: "What clients did in the portal, with where to handle it.", actions: markAll, cls: "ds-actcard", body: [h("div", { class: "ds-act__bar" }, seg, summary), listHost] });
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
  const count = reqs.total ? h("p", { class: "adm-sub adm-req__count", role: "status", text: `${reqs.total} outstanding${parts.length ? ` · ${parts.join(" · ")}` : ""}` }) : null;
  const list = reqs.items.length
    ? h("ul", { class: "adm-feed" }, reqs.items.map((r) => row(`${r.orgName}: ${r.type}`, `${r.statusLabel}${r.note ? ` · ${r.note}` : ""} · ${fmtDate(r.createdAt)}`, requestHref(r))))
    : empty("No client requests need a response.");
  const more = reqs.total > reqs.items.length ? h("p", { class: "adm-sub", text: `Showing the newest ${reqs.items.length} of ${reqs.total}.` }) : null;
  const title = h("h2", { id: "adm-req", text: "Client requests" }); title.className = "rk-card__title";
  return h("section", { class: "rk-card adm-dash__sec" + (reqs.items.length ? " adm-dash__sec--wide" : ""), id: "adm-req-sec", "aria-labelledby": "adm-req" },
    h("div", { class: "rk-card__head" }, title, reqs.support ? h("a", { class: "adm-link", href: "/admin/support", "data-link": "" }, "All support requests →") : null),
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

/** The two-column block. A card left alone on its row (an odd one out) takes the full width, so there is never an empty half. null when there is nothing to show. */
function columns(cells) {
  if (!cells.length) return null;
  const single = cells.filter((c) => !c.classList.contains("adm-dash__sec--wide"));
  if (single.length % 2 === 1) single[single.length - 1].classList.add("adm-dash__sec--wide");
  return h("div", { class: "adm-dash__cols" }, ...cells);
}

/** The weekly activity card: counts of the allow-listed activity events for the last eight weeks (GET /dashboard/trends). null when it cannot load. */
function activityCard(trends) {
  if (!trends || !trends.available || !Array.isArray(trends.weeks)) return null;
  const data = trends.weeks.map((w) => ({ label: "Week of " + fmtDate(w.start + "T00:00:00Z"), value: w.total }));
  const total = data.reduce((a, d) => a + d.value, 0);
  return card({ title: "Weekly activity", sub: total ? `${total.toLocaleString("en-CA")} events in the last eight weeks: new clients, invitations, requests, feedback and invoices.` : "Nothing has happened in the last eight weeks yet.",
    body: total ? barChart({ data, label: "Activity per week", unit: "events" }) : null });
}

export async function render() {
  const [dash, feedback, services, assess, trends, activity] = await Promise.all([quiet("/dashboard"), quiet("/overview"), quiet("/services/attention"), quiet("/assessments/summary"), quiet("/dashboard/trends"), quiet("/activity")]);
  const d = dash && dash.available ? dash : null;
  const svc = services && services.available ? services : null;
  const recent = feedback && feedback.recent.length
    ? responseCards(feedback.recent.slice(0, 3))
    : feedback ? stateBlock({ title: "No feedback yet", body: "Responses appear here after a client completes the feedback form." }) : null;

  // The outstanding support requests are rows of the Client requests list; the separate Support requests list is only the fallback when that list cannot load.
  const requestsEl = requestsSection(d && d.requests);
  const requestsCard = requestsTile(d && d.requests);
  const node = h("div", { class: "adm-page adm-dash" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, "Overview"),
      d ? h("p", { class: "adm-sub", text: `Live data · updated ${ago(d.generatedAt)}` }) : null)),
    ...[
      attentionSection(attentionItems({ dash: d, services: svc, assess, feedback }), activity && activity.available ? activity.attention.dismissed : {}),
      activityFeed(activity),
      kpiGrid({ dash: d, feedback, requestsCard }),
      activityCard(trends),
      columns([requestsEl, requestsEl ? null : supportSection(d && d.support), invoiceSection(d && d.invoices)].filter(Boolean)),
      recent ? section("adm-recent", "Recent feedback", recent, feedback.recent.length ? ["/admin/feedback", "All feedback"] : null) : null,
    ].filter(Boolean),
  );
  if (requestsEl) watchRequests(requestsEl, requestsCard);
  if (!d && !feedback) node.append(stateBlock({ title: "The overview couldn't load", body: "Nothing has been changed. Reload the page to try again.", actionLabel: "Reload", onAction: () => location.reload() }));
  return { title: "Overview", node };
}
