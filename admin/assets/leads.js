/* Framework Admin — Leads module: /admin/leads (list), /admin/leads/<id> (the lead panel), /admin/leads/activity (the Demo traffic report).
   Candidates come from the finder, are reviewed here (Approve / Dismiss), pitched and sent from here. API contract: /api/admin/leads/* . Text from the server is only ever set as text. */

import { h, api, errorState, stateBlock, confirmDialog } from "./ui.js";
import { badge, emptyState, fold, navIcon } from "./kit.js";
import { STATUSES, statusWord, view, shortName, leadsTabs, errText } from "./leads-common.js";
import { reviewScreen } from "./lead-review.js";

export async function render(ctx) {
  const path = ctx.url.pathname.replace(/\/+$/, "");
  if (path === "/admin/leads/activity") {
    const { activity } = await import("./demo-traffic.js");
    const res = await activity({ title: "Leads", before: leadsTabs("activity") });
    return { title: "Activity — Leads", node: res.node };
  }
  const m = path.match(/^\/admin\/leads\/([^/]+)$/);
  if (m) return (await import("./lead-panel.js")).render(decodeURIComponent(m[1]), ctx);
  return renderList(ctx);
}

const BULK = { new: true, approved: true, ready: true }; // statuses whose rows can be ticked
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/* ---------- Setup strip ---------- */

function setupItems(st) {
  const s = st.setup || {};
  const sending = s.sending || {};
  const mode = sending.mode || "off";
  return [
    ["Lead finder", s.finder && s.finder.connected, s.finder && s.finder.connected ? `${s.finder.waiting || 0} waiting to be imported.` : "Not connected. Bind the finder database (LEADGEN_DB) to find candidates."],
    ["Demo tracking links", s.tracking && s.tracking.ready, "Needs the signing key and the demo-traffic tables (migration 0021)."],
    ["Email provider", s.email && s.email.configured, s.email && s.email.configured ? `Sends from ${s.email.from || "the configured address"}.` : "Set the email provider key and the From address."],
    ["Sending", mode !== "off", mode === "test" ? `Test mode: every email goes to ${sending.test_recipient || "the test address"}, never to a business.` : mode === "live" ? "Live: emails go to real businesses." : "Off. Turn sending on (LEADS_SENDING) when you are ready; nothing is sent until then."],
    ["Mailing address", s.mailing_address, "Add LEADS_MAILING_ADDRESS. It is required in every email footer before live sending."],
    ["Delivery events", s.webhook && s.webhook.configured, "Add the Resend webhook secret so bounces and complaints are recorded."],
    ["Replies", true, "Recorded by hand: tap “Mark replied” on a lead. Replies reach your normal inbox."],
  ];
}

function setupStrip(st) {
  if (!st.ready) return null;
  const items = setupItems(st);
  const todo = items.filter(([, ok]) => !ok);
  if (!todo.length) return null;
  return fold({ title: "Setup needed", meta: todo.map(([name]) => name).join(", "),
    body: h("ul", { class: "ld-setup" }, items.map(([name, ok, text]) => h("li", { class: "ld-setup__row" },
      h("span", { class: "ld-setup__name", text: name }), badge(ok ? "Working" : "Awaiting setup", ok ? "ok" : "warn"), h("span", { class: "ld-setup__text", text })))) });
}

/* ---------- Row ---------- */

/* A row says who, what and where, and the one number that decides: the SEO Opportunity Score. The status shows in the All view (the filter above already says it elsewhere). */
function leadRow(l, { selectable, selected, onToggle, showStatus }) {
  const box = selectable ? h("label", { class: "ld-pick" }, h("input", { type: "checkbox", checked: selected.has(l.id) ? true : null, "aria-label": "Select " + l.name, onchange: (e) => onToggle(l.id, e.target.checked) })) : null;
  const meta = [l.trade, l.city, l.opted_out ? "Opted out" : showStatus ? statusWord(l.status) : ""].filter(Boolean).join(" · ");
  const scored = Number.isFinite(l.seo_score);
  return h("li", { class: "ld-row" + (selectable ? "" : " ld-row--plain") },
    box,
    h("a", { class: "ld-row__link", href: "/admin/leads/" + encodeURIComponent(l.id), "data-link": "" },
      h("span", { class: "ld-row__main" }, h("span", { class: "ld-row__name", text: shortName(l.name, l.city) }), h("span", { class: "ld-row__meta", text: meta })),
      h("span", { class: "ld-row__score ld-row__score--" + (scored ? l.seo_level : "none") }, h("span", { class: "rk-sr", text: "SEO opportunity score " }), h("span", { text: scored ? String(l.seo_score) : "–" })),
      navIcon("chevron")));
}

/* ---------- List ---------- */

function renderList(ctx) {
  const selected = new Set();
  let st = null, data = null, status = null, q = view.q || "", loadToken = 0;
  const initial = ctx.url.searchParams.get("status");
  if (initial && (initial === "all" || STATUSES.some(([id]) => id === initial))) status = initial;
  else status = view.status;

  const setup = h("div");
  const segBox = h("div");
  const search = h("input", { class: "input ld-search", type: "search", value: q, placeholder: "Search name, trade or city", "aria-label": "Search leads", autocomplete: "off" });
  let timer = 0;
  search.addEventListener("input", () => { window.clearTimeout(timer); timer = window.setTimeout(() => { q = search.value.trim(); view.q = q; selected.clear(); loadList(); }, 250); });
  const filterBox = h("div", null, segBox, search);
  const listBox = h("div");
  const barBox = h("div", { class: "ld-barbox" });
  const reviewBox = h("div");
  const main = h("div", null, setup, filterBox, listBox);
  const syncNote = h("p", { class: "ld-note", role: "status", hidden: true });
  const syncBtn = h("button", { class: "ld-menu__item", type: "button", role: "menuitem" }, "Find new candidates");
  const checkBtn = h("button", { class: "ld-menu__item", type: "button", role: "menuitem", hidden: true }, "Check websites");
  const menu = h("details", { class: "ld-menu" }, h("summary", { class: "btn btn--secondary ld-menu__btn" }, h("span", { text: "Actions" }), navIcon("chevron")), h("div", { class: "ld-menu__list", role: "menu" }, syncBtn, checkBtn));
  menu.addEventListener("click", (e) => { if (e.target.closest(".ld-menu__item")) menu.open = false; });
  document.addEventListener("click", (e) => { if (menu.open && !menu.contains(e.target)) menu.open = false; });

  const node = h("div", { class: "adm-page ld-page" },
    h("div", { class: "ld-top" }, h("h1", { class: "adm-title", tabindex: "-1" }, "Leads"), menu),
    leadsTabs("leads"), syncNote, main, reviewBox, barBox);

  const say = (t) => { syncNote.textContent = t; syncNote.hidden = !t; };

  async function sync(quiet) {
    syncBtn.disabled = true; if (!quiet) say("Checking the finder…");
    try {
      const r = await api("/leads/sync", { method: "POST", body: {} });
      if (r.imported > 0) { say(`${plural(r.imported, "new candidate")} added.`); await loadList(); }
      else say(quiet ? "" : "No new candidates right now.");
      if (st && st.setup && st.setup.finder) { st.setup.finder.waiting = r.waiting || 0; }
    } catch (err) { say(quiet ? "" : errText(err)); }
    syncBtn.disabled = false;
  }
  syncBtn.addEventListener("click", () => sync(false));

  /* Website check: leads still carrying the finder's unconfirmed "doesn't load" claim are checked here, five at a time, so a site that merely blocks robots is never called offline. */
  const unconfirmed = () => ((data && data.leads) || []).filter((l) => l.site_status === "broken" && l.status === "new").length;
  let verifying = false;
  async function verify(quiet) {
    if (verifying || !unconfirmed()) return;
    verifying = true; checkBtn.disabled = true;
    try {
      let left = unconfirmed();
      while (left > 0) {
        say(`Checking ${plural(left, "website")}…`);
        const r = await api("/leads/recheck-sites", { method: "POST", body: {} });
        if (!r.checked) break;
        left = r.remaining;
        await loadList();
      }
      say("");
    } catch (err) { say(quiet ? "" : errText(err)); }
    verifying = false; checkBtn.disabled = false;
  }
  checkBtn.addEventListener("click", () => verify(false));

  /* filter */
  function drawFilter() {
    const counts = (data && data.counts) || {};
    const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
    const btn = (id, label, n) => h("button", { class: "ld-seg__btn", type: "button", "aria-pressed": status === id ? "true" : "false", onclick: () => choose(id) }, label, n === null ? null : h("span", { class: "ld-seg__n", text: String(n) }));
    segBox.replaceChildren(h("div", { class: "ld-seg", role: "group", "aria-label": "Filter by status" },
      STATUSES.map(([id, label]) => btn(id, label, Number(counts[id]) || 0)), btn("all", "All", total)));
  }

  function choose(id) { status = id; view.status = id; selected.clear(); drawFilter(); loadList(); }

  /* list */
  async function loadList() {
    const token = ++loadToken;
    if (!data) listBox.replaceChildren(stateBlock({ title: "Loading leads…" }));
    try {
      const qs = `status=${encodeURIComponent(status || "new")}` + (q ? `&q=${encodeURIComponent(q)}` : "") + "&sort=opportunity";
      let r = await api("/leads/list?" + qs);
      if (token !== loadToken) return;
      if (!status) { // first load: New if it has any, else Approved or Ready to send, else All
        const c = r.counts || {};
        const pick = c.new > 0 ? "new" : c.approved > 0 ? "approved" : c.ready > 0 ? "ready" : "all";
        status = pick;
        if (pick !== "new") { r = await api("/leads/list?status=" + pick + (q ? `&q=${encodeURIComponent(q)}` : "") + "&sort=opportunity"); if (token !== loadToken) return; }
      }
      data = r;
      checkBtn.hidden = !unconfirmed();
      drawFilter(); drawList(); drawBar();
    } catch (err) { if (token === loadToken) listBox.replaceChildren(errorState(err, loadList)); }
  }

  function drawList() {
    const leads = data.leads || [];
    const selectable = Boolean(BULK[status]);
    if (!leads.length) {
      listBox.replaceChildren(q ? emptyState({ title: "No leads match that search", body: "Try a different name, trade or city." })
        : emptyState({ title: status === "all" ? "No leads yet" : `Nothing in ${status === "ready" ? "Ready to send" : statusWord(status)}`, body: status === "new" || status === "all" ? "New candidates appear here as the finder discovers them. Tap “Check for new candidates”." : "Leads move here as you work through them." }));
      return;
    }
    const all = selectable ? h("label", { class: "ld-selall adm-check" }, h("input", { type: "checkbox", id: "ld-selall", "aria-label": `Select all ${leads.length}`, onchange: (e) => { leads.forEach((l) => (e.target.checked ? selected.add(l.id) : selected.delete(l.id))); drawList(); drawBar(); } }), h("span", { text: `Select all ${leads.length}` })) : null;
    if (all) all.querySelector("input").checked = leads.length > 0 && leads.every((l) => selected.has(l.id));
    const ul = h("ul", { class: "ld-list", "aria-label": "Leads" }, leads.map((l) => leadRow(l, { selectable, selected, showStatus: status === "all", onToggle: (id, on) => { if (on) selected.add(id); else selected.delete(id); drawBar(); const a = document.getElementById("ld-selall"); if (a) a.checked = leads.every((x) => selected.has(x.id)); } })));
    listBox.replaceChildren(...[all, ul, leads.length >= (data.limit || 300) ? h("p", { class: "adm-muted", text: `Showing the newest ${data.limit || 300}. Search to narrow it down.` }) : null].filter(Boolean));
  }

  /* bulk bar */
  async function bulk(action, ids) {
    const done = { ok: 0, bad: [] };
    for (let i = 0; i < ids.length; i += 50) {
      const r = await api("/leads/bulk", { method: "POST", body: { action, ids: ids.slice(i, i + 50) } });
      (r.results || []).forEach((x) => (x.ok ? (done.ok += 1) : done.bad.push(x.error || "failed")));
    }
    return done;
  }

  function drawBar() {
    const n = selected.size;
    if (!n || !BULK[status]) { barBox.replaceChildren(); return; }
    const ids = [...selected];
    const acts = [];
    const busy = (btn, fn) => async () => { btn.disabled = true; try { await fn(); } finally { btn.disabled = false; } };
    if (status === "new") {
      const approve = h("button", { class: "btn btn--primary", type: "button" }, "Approve selected");
      approve.addEventListener("click", busy(approve, async () => {
        try { const d = await bulk("approve", ids); ctx.notify(`Approved ${plural(d.ok, "lead")}.` + (d.bad.length ? ` ${d.bad.length} could not be approved.` : "")); selected.clear(); await loadList(); }
        catch (err) { ctx.notify(errText(err)); }
      }));
      const dismiss = h("button", { class: "btn btn--secondary", type: "button" }, "Dismiss selected");
      dismiss.addEventListener("click", busy(dismiss, async () => {
        if (!(await confirmDialog({ title: `Dismiss ${plural(n, "lead")}?`, body: "They leave the New list and will not be contacted. You can reopen a dismissed lead later.", confirmLabel: `Dismiss ${plural(n, "lead")}` }))) return;
        try { const d = await bulk("dismiss", ids); ctx.notify(`Dismissed ${plural(d.ok, "lead")}.` + (d.bad.length ? ` ${d.bad.length} could not be dismissed.` : "")); selected.clear(); await loadList(); }
        catch (err) { ctx.notify(errText(err)); }
      }));
      acts.push(approve, dismiss);
    } else {
      const label = status === "approved" ? "Review emails" : "Review & send";
      acts.push(h("button", { class: "btn btn--primary", type: "button", onclick: () => openReview(ids, status === "approved" ? "approve" : "send") }, label));
    }
    barBox.replaceChildren(h("div", { class: "ld-bulk", role: "region", "aria-label": "Selected leads" },
      h("span", { class: "ld-bulk__n", text: `${n} selected` }), h("div", { class: "ld-bulk__acts" }, acts),
      h("button", { class: "btn btn--secondary adm-small ld-bulk__clear", type: "button", onclick: () => { selected.clear(); drawList(); drawBar(); } }, "Clear")));
  }

  function openReview(ids, mode) {
    main.hidden = true; barBox.replaceChildren(); menu.hidden = true;
    reviewBox.replaceChildren(reviewScreen({ ids, mode, notify: ctx.notify, onBack: (changed) => {
      reviewBox.replaceChildren(); main.hidden = false; menu.hidden = false; selected.clear();
      if (changed) loadList(); else { drawList(); drawBar(); }
      window.scrollTo(0, 0);
    } }));
    window.scrollTo(0, 0);
  }

  /* boot */
  (async () => {
    try { st = await api("/leads/status"); }
    catch (err) { main.replaceChildren(errorState(err, ctx.retry)); menu.hidden = true; return; }
    if (!st.ready) {
      menu.hidden = true;
      main.replaceChildren(emptyState({ title: "Leads isn’t set up yet", body: `The database tables (proposed migration ${st.migration || "0024_leads.sql"}) have not been applied, so nothing can be imported or saved until they are. Nothing else is affected.` }));
      return;
    }
    const strip = setupStrip(st);
    if (strip) setup.replaceChildren(strip);
    await loadList();
    verify(true); // once on load: unconfirmed "doesn't load" claims are checked without a click
    sync(true); // once on load: new candidates appear without a click
  })();

  return { title: "Leads", node };
}
