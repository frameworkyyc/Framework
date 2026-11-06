/* Framework Admin — Demo traffic module: /admin/demo-traffic
   Private reporting on the demo landing page: tracking links, who-used-which-link visits (an indication, not proof of who visited), the choices a visitor made and enquiries.
   Link labels and company names are user text: everything is set as text, never as markup. Needs the proposed migration 0021 (until then the page says so). */

import { h, api, errorState, confirmDialog } from "./ui.js";
import { badge, fold, statCard, emptyState } from "./kit.js";

const NS = "http://www.w3.org/2000/svg";
export const when = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Edmonton" });
const whenSec = new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeStyle: "medium", timeZone: "America/Edmonton" });
export const fmt = (f, iso) => (iso && Number.isFinite(Date.parse(iso)) ? f.format(new Date(iso)) : "");
const num = (n) => new Intl.NumberFormat("en-CA").format(Number(n) || 0);
export const pretty = (v) => String(v || "").replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());
const HEX = /^#[0-9A-Fa-f]{6}$/;

const BOT_REASONS = { head: "Link check (HEAD request)", no_user_agent: "No browser signature", user_agent: "Crawler, preview or scanner", network: "Mail-security or data-centre network", no_accept_language: "Looks automated" };
const EVENTS = { link_open: "Opened the link", view: "Viewed the page", active: "Interacted with the page", discipline: "Chose a discipline", vibe: "Chose a vibe", colour: "Chose a colour", company: "Entered a company", open: "Opened the demo", enquiry: "Sent an enquiry" };

/** A square colour swatch. The colour is an SVG fill attribute (validated hex), so no inline style is needed. */
export function swatch(hex) {
  if (!HEX.test(hex || "")) return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "dt-swatch"); svg.setAttribute("viewBox", "0 0 1 1"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "Colour " + hex.toUpperCase());
  const r = document.createElementNS(NS, "rect"); r.setAttribute("width", "1"); r.setAttribute("height", "1"); r.setAttribute("fill", hex); svg.append(r);
  return svg;
}

function timeline(data) {
  const j = data.journey;
  const facts = [j.link_label ? "Link: " + j.link_label : "Direct visit", j.country, j.device ? pretty(j.device) : "", j.bot && j.bot_reason ? "Flagged: " + (BOT_REASONS[j.bot_reason] || "automated") : ""].filter(Boolean).join(" · ");
  return h("div", null,
    h("p", { class: "adm-muted", text: facts }),
    h("ol", { class: "dt-timeline" }, data.events.map((e) => h("li", null,
      h("time", { datetime: e.at, text: fmt(whenSec, e.at) }),
      h("span", null, EVENTS[e.type] || e.type, e.value ? h("strong", { text: ": " + (e.type === "discipline" || e.type === "vibe" ? pretty(e.value) : e.value) }) : null, e.bot ? " " : null, e.bot ? badge("Likely bot", "warn") : null)))));
}

function visitorRow(j) {
  const body = h("div", null, h("p", { class: "adm-muted", text: "Loading…" }));
  let loaded = false;
  const chips = [
    j.bot ? badge("Likely bot", "warn") : j.human ? badge("Verified", "ok") : badge("Not verified", "pending"),
    swatch(j.colour),
    j.demo_opens ? badge("Demo opened" + (j.demo_opens > 1 ? " ×" + j.demo_opens : ""), "ok") : null,
    j.enquired ? badge("Enquiry", "ok") : null,
  ];
  const meta = [[j.discipline, j.vibe].filter(Boolean).map(pretty).join(" · "), j.company].filter(Boolean).join(" · ");
  const el = fold({ number: fmt(when, j.last_seen_at), title: j.link_label || "Direct", meta, badges: chips.filter(Boolean), body });
  el.addEventListener("toggle", async () => {
    if (!el.open || loaded) return;
    loaded = true;
    try { body.replaceChildren(timeline(await api("/demo-traffic/journeys/" + encodeURIComponent(j.id)))); }
    catch { loaded = false; body.replaceChildren(h("p", { class: "adm-muted", text: "The timeline couldn’t be loaded. Close this row and open it again." })); }
  });
  return el;
}

/** The Demo traffic report. /admin/demo-traffic and the Leads "Activity" view both render it; `title` is the page heading and `before` (optional) is a node placed under it, such as tabs. */
export async function activity({ title = "Demo traffic", before = null } = {}) {
  const status = await api("/demo-traffic/status");
  const node = h("div", { class: "adm-page" },
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, "Framework Admin"), h("h1", { class: "adm-title", tabindex: "-1" }, title))),
    before,
    h("p", { class: "dt-note", text: "A link visit shows which link was used, not who visited." }));

  if (!status.ready) {
    node.append(emptyState({ title: "Demo traffic isn’t set up yet", body: `The database tables (proposed migration ${status.migration || "0021_demo_traffic.sql"}) have not been applied, so nothing is recorded and no links can be created until they are. Visitors are not affected: links still open the demo.` }));
    return { title, node };
  }
  if (!status.secret) node.append(h("p", { class: "adm-notice", role: "status", text: "A signing key is needed to create and copy links. Set DEMO_LINK_SECRET (or PORTAL_SESSION_PEPPER) for this deployment." }));

  let days = 30, bots = false, lastCreated = null; // lastCreated: the link just made, kept visible across the refresh that follows
  const stats = h("div"), visitors = h("div"), linksBox = h("div");
  const note = h("p", { class: "adm-notice", role: "status", hidden: true });
  const say = (text) => { note.textContent = text; note.hidden = !text; };
  const query = () => `days=${days}&bots=${bots ? 1 : 0}`;

  const exportLink = h("a", { class: "btn btn--primary dt-export", href: "#", download: "" }, "Export CSV");
  const sync = () => exportLink.setAttribute("href", "/api/admin/demo-traffic/export.csv?" + query());

  const period = h("select", { class: "input", id: "dt-days", "aria-label": "Period", onchange: (e) => { days = Number(e.target.value); loadReport(); } },
    [[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]].map(([v, t]) => h("option", { value: v, selected: v === days ? true : null }, t)));
  const botBox = h("input", { type: "checkbox", id: "dt-bots", onchange: (e) => { bots = e.target.checked; loadReport(); } });
  const filters = h("div", { class: "dt-filters" }, period, h("label", { class: "adm-check", for: "dt-bots" }, botBox, h("span", { text: "Include likely bots and scanners" })), exportLink);

  async function loadReport() {
    sync();
    try {
      const [s, list] = await Promise.all([api("/demo-traffic/summary?" + query()), api("/demo-traffic/journeys?" + query())]);
      const opens = bots ? s.link_opens : s.link_opens - s.likely_bots;
      stats.replaceChildren(h("div", { class: "rk-stats" },
        statCard({ label: "Link opens", value: num(opens), hint: bots ? "including likely bots" : s.likely_bots ? num(s.likely_bots) + " likely bots hidden" : "" }),
        statCard({ label: "Verified visitors", value: num(s.verified), hint: "interacted with the page" }),
        statCard({ label: "Companies applied", value: num(s.companies_applied) }),
        statCard({ label: "Demo opens", value: num(s.demo_opens) }),
        statCard({ label: "Enquiries", value: num(s.enquiries), tone: s.enquiries ? "ok" : "" })));
      visitors.replaceChildren(...[
        h("div", { class: "adm-section-title" }, h("h2", { text: "Visitors" })),
        list.journeys.length ? h("div", { class: "rk-folds" }, list.journeys.map(visitorRow)) : h("p", { class: "adm-muted", text: "No visits in this period." }),
        list.journeys.length >= list.limit ? h("p", { class: "adm-muted", text: `Showing the newest ${list.limit}. The CSV export has every event.` }) : null].filter(Boolean)); // replaceChildren turns null into the text "null"
    } catch (err) { stats.replaceChildren(errorState(err, loadReport)); visitors.replaceChildren(); }
  }

  /* ---------------- links ---------------- */
  const copy = async (link, btn, fallback) => {
    try { await navigator.clipboard.writeText(link.url); btn.textContent = "Copied"; window.setTimeout(() => { btn.textContent = "Copy link"; }, 2000); }
    catch { fallback.hidden = false; fallback.value = link.url; fallback.focus(); fallback.select(); } // no clipboard permission: show the link to copy by hand
  };
  const linkRow = (l) => {
    const manual = h("input", { class: "input dt-link__manual", type: "text", readonly: true, hidden: true, "aria-label": "Link for " + l.label });
    const copyBtn = h("button", { class: "btn btn--secondary", type: "button", disabled: l.url ? null : true }, "Copy link");
    copyBtn.addEventListener("click", () => copy(l, copyBtn, manual));
    const counts = `${num(l.link_opens)} opens · ${num(l.verified_visits)} verified · ${num(l.enquiries)} enquiries` + (l.link_opens_bots ? ` · ${num(l.link_opens_bots)} likely bots` : "") + (l.last_activity ? " · last " + fmt(when, l.last_activity) : "");
    return h("li", { class: "dt-link" },
      h("div", null, h("span", { class: "dt-link__name", text: l.label }), " ", l.revoked_at ? badge("Revoked", "bad") : null, h("div", { class: "dt-link__counts", text: counts })),
      l.revoked_at ? null : copyBtn, manual);
  };

  async function mutate(label, fn) {
    say(label + "…");
    try { await fn(); say(""); await loadLinks(); await loadReport(); }
    catch (err) { say(err.code === "secret_missing" ? "A signing key is needed to create links." : "That didn’t complete (" + (err.code || "error") + "). Nothing has been changed."); }
  }

  function managePanel(links) {
    const label = h("input", { class: "input", id: "dt-label", type: "text", maxlength: "120", required: true, autocomplete: "off" });
    const noteIn = h("input", { class: "input", id: "dt-note", type: "text", maxlength: "500", autocomplete: "off" });
    const created = h("div", null, lastCreated ? h("p", { class: "adm-notice", role: "status" }, "Link created for “" + lastCreated.label + "”: ", h("strong", { text: lastCreated.url })) : null);
    const form = h("form", { class: "adm-form", onsubmit: (e) => {
      e.preventDefault();
      if (!label.value.trim()) return;
      mutate("Creating the link", async () => {
        const { link } = await api("/demo-traffic/links", { method: "POST", body: { label: label.value, note: noteIn.value || undefined } });
        label.value = ""; noteIn.value = "";
        lastCreated = link;
      });
    } },
      h("div", { class: "adm-field" }, h("label", { for: "dt-label", text: "Prospect label" }), label, h("p", { class: "adm-field__hint", text: "Private. Shown only here and in the CSV, never in the link." })),
      h("div", { class: "adm-field" }, h("label", { for: "dt-note", text: "Note (optional)" }), noteIn),
      h("div", { class: "adm-actions" }, h("button", { class: "btn btn--primary", type: "submit", disabled: status.secret ? null : true }, "Create link")));
    const rows = links.map((l) => h("li", { class: "dt-link" },
      h("div", null, h("span", { class: "dt-link__name", text: l.label }), l.note ? h("div", { class: "dt-link__counts", text: l.note }) : null),
      h("div", { class: "adm-row-actions" },
        l.revoked_at ? null : h("button", { class: "btn btn--secondary", type: "button", onclick: async () => {
          if (await confirmDialog({ title: "Revoke this link?", body: "The link stops creating visits and opens the demo as an ordinary visit. History is kept.", details: [["Label", l.label]], confirmLabel: "Revoke link" })) mutate("Revoking", () => api(`/demo-traffic/links/${l.id}/revoke`, { method: "POST", body: {} }));
        } }, "Revoke"),
        h("button", { class: "btn btn--secondary", type: "button", onclick: async () => {
          if (await confirmDialog({ title: "Delete this link and its data?", body: "This permanently deletes the link and every visit and event recorded through it. It cannot be undone.", details: [["Label", l.label]], confirmLabel: "Delete link and data" })) mutate("Deleting", () => api(`/demo-traffic/links/${l.id}`, { method: "DELETE", body: { confirm: true } }));
        } }, "Delete"))));
    return h("details", { class: "rk-manage" }, h("summary", { class: "rk-manage__sum" }, h("span", { class: "rk-card__title", text: "Manage" }), h("span", { class: "rk-fold__meta", text: "Create a link, revoke, delete" })),
      h("div", { class: "rk-manage__body" }, form, created, rows.length ? h("ul", { class: "dt-links" }, rows) : null));
  }

  async function loadLinks() {
    try {
      const { links } = await api("/demo-traffic/links?" + query());
      const open = linksBox.querySelector("details.rk-manage[open]"), keep = Boolean(open); // keep Manage open across a refresh
      const manage = managePanel(links); if (keep) manage.open = true;
      linksBox.replaceChildren(
        h("div", { class: "adm-section-title" }, h("h2", { text: "Links" })),
        links.length ? h("ul", { class: "dt-links" }, links.map(linkRow)) : h("p", { class: "adm-muted", text: "No links yet. Open Manage to create the first one." }),
        manage);
    } catch (err) { linksBox.replaceChildren(errorState(err, loadLinks)); }
  }

  node.append(note, filters, stats, h("section", { class: "adm-section" }, visitors), h("section", { class: "adm-section" }, linksBox));
  await Promise.all([loadReport(), loadLinks()]);
  return { title, node };
}

export const render = () => activity();
