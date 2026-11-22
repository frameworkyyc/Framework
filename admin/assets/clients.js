/* Framework Admin — Clients: /admin/clients (organizations, New client) and /admin/clients/:id (organization, invitations, members, Business Profile review).
   Access management lives in clients-access.js; the Business Profile review below stays read-only. */

import { h, api, fmtDate, stateBlock } from "./ui.js";
import { statCard, searchBox } from "./kit.js";
import { newClientPanel, accessSections } from "./clients-access.js";
import { actionsMenu, deleteClient, restoreClient } from "./clients-delete.js";
import { dashboard, sectionMap, stepAccordion, disclosure, chip, icon, STATE_TEXT } from "./client-dashboard.js";
import { pageHead, grid, span, card, kpi, pill, tabs, segmented, dataList, empty, icon as dsIcon } from "./ds.js";

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const statusWord = (s) => (s === "archived" ? "Deleted" : cap(s));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

/** The client workspace: one header and one row of tabs around every page of a client. The pages keep their own addresses; Websites and Access are new tabs. */
const CLIENT_TABS = [["", "Overview"], ["websites", "Websites"], ["branding", "Branding"], ["invoices", "Billing"], ["support", "Support"], ["requests", "Requests"], ["additional-services", "Services"], ["access", "Access"], ["profile", "Profile"]];

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/clients\/([^/]+)(\/branding|\/website|\/websites|\/profile|\/invoices|\/support|\/requests|\/additional-services|\/access)?$/);
  if (!m) return renderList(ctx);
  const id = decodeURIComponent(m[1]), tab = (m[2] || "").slice(1);
  if (tab === "website") { ctx.navigate("/admin/websites?client=" + m[1], { replace: true }); return { title: "Websites", node: document.createElement("div") }; } // the old address
  const [hdr, inner] = await Promise.all([api("/clients/" + encodeURIComponent(id)).catch(() => null), innerPage(id, tab, ctx)]);
  if (!hdr || !hdr.organization) return inner; // a client that cannot be read: the page's own error state
  return clientShell(hdr, tab, inner, ctx);
}

async function innerPage(id, tab, ctx) {
  if (tab === "branding") return (await import("./branding.js")).render(id, ctx);
  if (tab === "additional-services") return (await import("./client-services.js")).render(id, ctx);
  if (tab === "requests") return (await import("./requests.js")).render(ctx);
  if (tab === "support") return (await import("./support.js")).render(id, ctx);
  if (tab === "invoices") return (await import("./invoices.js")).render(id, ctx);
  if (tab === "profile") return renderProfile(id, ctx);
  if (tab === "websites") return renderClientWebsites(id, ctx);
  return renderDetail(id, ctx, tab === "access" ? "access" : "overview");
}

function clientShell(data, tab, inner, ctx) {
  const o = data.organization, deleted = o.status === "archived", writes = Boolean(data.capabilities && data.capabilities.writes);
  const menu = writes && !deleted ? actionsMenu({ label: `Actions for ${o.name}`, items: [{ label: "Delete client", danger: true, run: () => deleteClient(o, { notify: ctx.notify, after: () => ctx.navigate("/admin/clients") }) }] }) : null;
  const label = (CLIENT_TABS.find(([t]) => t === tab) || [])[1] || "Overview";
  const node = h("div", { class: "ds-page ds-clientshell" },
    pageHead({ title: o.name, back: ["All clients", "/admin/clients"], actions: menu }),
    h("p", { class: "ds-sub ds-sub--row" }, pill(deleted ? "Deleted" : "Active", deleted ? "warn" : "ok"), h("span", { class: "ds-muted", text: "Created " + fmtDate(o.created_at) }), o.website_url ? h("a", { class: "ds-link", href: o.website_url, target: "_blank", rel: "noopener noreferrer", text: o.website_url.replace(/^https?:\/\//, "") }) : null),
    tabs({ label: "Client sections", current: tab, items: CLIENT_TABS.map(([t, l]) => ({ id: t, label: l, href: `/admin/clients/${encodeURIComponent(o.id)}${t ? "/" + t : ""}` })) }),
    h("div", { class: "ds-clientshell__body" }, inner.node));
  return { title: `${label} | ${o.name}`, node, crumbs: [["Admin", "/admin"], ["Clients", "/admin/clients"], [o.name, tab ? `/admin/clients/${encodeURIComponent(o.id)}` : null], ...(tab ? [[label, null]] : [])] };
}

async function renderClientWebsites(id, ctx) {
  const { clientWebsites } = await import("./sites.js");
  return { title: "Websites", node: await clientWebsites(id, ctx) };
}

/* ---------- List ---------- */


/** Business Profile completion: a thin native progress bar and the percentage. The bar is decorative (the percentage and a screen-reader sentence carry the meaning), and a native element needs no inline style (the Admin CSP forbids those). */
function completion(p) {
  if (!p) return h("span", { class: "adm-clientrow__profile adm-muted" }, "Profile not available");
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  return h("span", { class: "adm-clientrow__profile" },
    h("progress", { class: "adm-meter", max: 100, value: pct, "aria-hidden": "true" }),
    h("span", { class: "adm-clientrow__pct", "aria-hidden": "true" }, `${p.percent}%`),
    h("span", { class: "visually-hidden" }, `Business Profile ${p.percent}% complete (${p.done} of ${p.total} steps)`));
}

/** One whole row is the link (no arrow: the actions menu sits beside it): name first (full width), then when it was created and how far the Business Profile is. Members and invitations live on the client's own page. */
const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

async function renderList(ctx) {
  const [data, sitesData] = await Promise.all([api("/clients"), api("/websites").catch(() => null)]);
  const rows = data.clients.filter((c) => c.status !== "archived");
  const deleted = data.clients.filter((c) => c.status === "archived");
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const done = () => ctx.retry();
  const bySite = new Map();
  if (sitesData && sitesData.available) for (const w of sitesData.websites) { const e = bySite.get(w.organizationId) || { n: 0, staging: 0 }; e.n += 1; if (w.stagingUrl) e.staging += 1; bySite.set(w.organizationId, e); }
  const create = newClientPanel({ navigate: ctx.navigate, writesEnabled: writes });
  const pcts = rows.map((c) => (c.profile ? Math.max(0, Math.min(100, Number(c.profile.percent) || 0)) : null)).filter((n) => n !== null);
  const avgPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : null, notStarted = pcts.filter((n) => n === 0).length;
  const withSites = rows.filter((c) => bySite.has(c.id)).length;
  const kpis = rows.length ? grid(
    span(kpi({ label: "Clients", value: String(rows.length), note: deleted.length ? `${deleted.length} deleted` : "active" }), 3),
    sitesData && sitesData.available ? span(kpi({ label: "With a website", value: String(withSites), unit: `of ${rows.length}`, note: `${[...bySite.values()].reduce((a, e) => a + e.n, 0)} websites in all`, href: "/admin/websites" }), 3) : null,
    avgPct === null ? null : span(kpi({ label: "Business Profile", value: avgPct + "%", note: "average completion" }), 3),
    avgPct === null ? null : span(kpi({ label: "Not started", value: String(notStarted), note: notStarted ? "no Business Profile answers yet" : "Everyone has started", tone: notStarted ? "warn" : "ok" }), 3)) : null;
  const cols = [
    { label: "Client", cls: "ds-dl__c--main", render: (c) => h("span", { class: "ds-client" }, h("span", { class: "ds-avatar", "aria-hidden": "true", text: initials(c.name) }), h("span", { class: "ds-site" }, h("a", { class: "ds-site__n ds-site__a", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "", text: c.name }), h("span", { class: "ds-muted", text: "Created " + fmtDate(c.created_at) }))) },
    { label: "Websites", render: (c) => { const e = bySite.get(c.id); return e ? h("span", { class: "ds-env-mini" }, `${e.n} ${e.n === 1 ? "website" : "websites"}`, e.staging === e.n ? pill("Staging set up", "info") : pill(`${e.n - e.staging} without Staging`, "quiet")) : h("span", { class: "ds-muted", text: "None" }); } },
    { label: "Business Profile", render: (c) => (c.profile ? h("span", { class: "ds-prof" }, h("progress", { class: "ds-meter", max: 100, value: Math.max(0, Math.min(100, Number(c.profile.percent) || 0)), "aria-hidden": "true" }), h("span", { text: `${c.profile.percent}%` }), h("span", { class: "rk-sr", text: ` Business Profile ${c.profile.percent}% complete` })) : h("span", { class: "ds-muted", text: "Not available" })) },
    { label: "", cls: "ds-dl__c--end", render: (c) => (writes ? actionsMenu({ label: `Actions for ${c.name}`, items: [{ label: "Delete client", danger: true, run: () => deleteClient(c, { notify: ctx.notify, after: done }) }] }) : null) },
  ];
  const listHost = h("div", { class: "ds-list-host" });
  const status = h("p", { class: "ds-muted", role: "status", text: `${plural(rows.length, "organization")}.` });
  const draw = (q) => {
    const shown = rows.filter((c) => !q || c.name.toLowerCase().includes(q));
    status.textContent = q ? `${plural(shown.length, "organization")} match.` : `${plural(rows.length, "organization")}.`;
    listHost.replaceChildren(shown.length ? dataList({ label: "Client organizations", cls: "ds-dl--clients", columns: cols, rows: shown }) : empty({ title: rows.length ? "No client matches" : "No client organizations yet", body: rows.length ? "Try another name." : writes ? "Use New client to add the first one, then invite its first owner." : "Nothing has been created yet. Changes are switched off on this site.", ic: "clients" }));
  };
  const find = searchBox({ label: "Find a client", placeholder: "Find a client", onInput: draw });
  draw("");
  const trash = deleted.length ? disclosure({ id: "deleted-clients", title: "Deleted clients", className: "adm-acc--quiet", meta: String(deleted.length),
    children: h("ul", { class: "adm-clientlist adm-clientlist--deleted", "aria-label": "Deleted clients" }, deleted.map((c) => h("li", { class: "adm-deleteditem" },
      h("div", { class: "adm-deleteditem__text" }, h("a", { class: "adm-link", href: "/admin/clients/" + encodeURIComponent(c.id), "data-link": "" }, c.name), h("span", { class: "adm-clientrow__date", text: "Deleted " + fmtDate(c.archived_at) })),
      writes ? h("button", { class: "btn btn--secondary adm-small", type: "button", "aria-label": `Restore ${c.name}`, onclick: () => restoreClient(c, { notify: ctx.notify, after: done }) }, "Restore") : null))) }) : null;
  const node = h("div", { class: "ds-page" },
    pageHead({ title: "Clients", sub: "Client organizations, the people who can open their portal, and their websites.", actions: create.button || null }),
    writes ? null : h("p", { class: "ds-banner" }, "Changes are switched off on this site: you can look at clients, but not create them or change who has access."),
    create.panel,
    data.profile_available ? null : h("p", { class: "ds-banner" }, "Business Profile data isn’t available on this deployment (its database migration hasn’t been applied)."),
    kpis,
    h("div", { class: "ds-toolbar" }, find), card({ body: [listHost, status] }), trash);
  return { title: "Clients", node, crumbs: [["Admin", "/admin"], ["Clients", null]] };
}

/* ---------- Detail ---------- */

const spec = (rows) => h("dl", { class: "adm-spec" }, rows.filter(Boolean).map(([k, v]) => h("div", null, h("dt", { text: k }), h("dd", null, v))));

async function renderDetail(id, ctx, view = "overview") {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const welcome = ctx.url.searchParams.get("welcome") === "1";
  const dash = dashboard({ org: o, profile: data.profile_available ? p : null, members: data.members, invitations: data.invitations, branding: data.branding, websites: data.websites, invoices: data.invoices, support: data.support });

  const info = disclosure({
    id: "org-details", title: "Organization details", className: "adm-acc--quiet",
    meta: o.status === "active" ? "Active" : statusWord(o.status),
    children: spec([
      ["Status", o.status === "active" ? "Active" : statusWord(o.status)],
      ["Portal address", h("code", { class: "adm-code" }, "/portal/o/" + o.slug)],
      o.website_url ? ["Website", h("a", { class: "adm-link", href: o.website_url, rel: "noopener noreferrer", target: "_blank" }, o.website_url.replace(/^https:\/\//, ""))] : ["Website", h("span", { class: "adm-muted" }, "Not given")],
      ["Created", fmtDate(o.created_at)],
    ]),
  });

  const deletedOrg = o.status === "archived";
  const writes = Boolean(data.capabilities && data.capabilities.writes);
  const done = () => ctx.retry();
  const menu = writes && !deletedOrg ? actionsMenu({ label: `Actions for ${o.name}`, items: [{ label: "Delete client", danger: true, run: () => deleteClient(o, { notify: ctx.notify, after: () => ctx.navigate("/admin/clients") }) }] }) : null;
  const deletedBanner = deletedOrg ? h("div", { class: "adm-banner adm-banner--alert adm-deletedbanner", role: "status" },
    h("p", { class: "adm-deletedbanner__text" }, `This client was deleted${o.archived_at ? " on " + fmtDate(o.archived_at) : ""}. Its team can’t open the portal, and it is hidden from the active lists. Invoices, support requests and other records are kept.`),
    writes ? h("button", { class: "btn btn--secondary adm-small", type: "button", onclick: () => restoreClient(o, { notify: ctx.notify, after: done }) }, "Restore client") : null) : null;
  const access = deletedOrg ? null : accessSections({ orgId: o.id, orgName: o.name, welcome, onData: (d) => dash.update(d.members, d.invitations) });

  const node = h("div", { class: "adm-page adm-detail" },
    deletedBanner,
    ...(view === "access" ? [access || h("p", { class: "adm-muted" }, "Access isn’t managed for a deleted client.")] : [dash.overview, info]),
  );
  return { title: o.name + " — Clients", node };
}

/* ---------- Business Profile detail: /admin/clients/:id/profile ---------- */

/** All seven sections as collapsed accordions, each with its completion state and answered count, so missing information is visible without opening anything. Read-only. */
async function renderProfile(id, ctx) {
  const data = await api("/clients/" + encodeURIComponent(id));
  const o = data.organization;
  const p = data.profile;
  const back = h("a", { class: "adm-back", href: "/admin/clients/" + encodeURIComponent(o.id), "data-link": "" }, "← " + o.name);
  if (!data.profile_available) {
    return { title: "Business Profile — " + o.name, node: h("div", { class: "adm-page adm-detail" }, back, h("h1", { class: "adm-title", tabindex: "-1" }, "Business Profile"), h("p", { class: "adm-banner" }, "Business Profile data isn’t available on this deployment.")) };
  }
  const pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
  const allOpen = () => [...document.querySelectorAll(".adm-acc--step")].every((d) => d.open);
  const toggleAll = h("button", { class: "adm-linkbtn", type: "button", "aria-live": "polite", text: "Expand all", onclick: () => {
    const open = !allOpen();
    document.querySelectorAll(".adm-acc--step").forEach((d) => { d.open = open; });
    toggleAll.textContent = open ? "Collapse all" : "Expand all";
  } });
  const missing = p.steps.filter((s) => s.state !== "complete");
  // Export: Copy for AI, Download PDF and Copy Complete Client Brief. The text is fetched with the page so the copy happens inside the click.
  const live = h("p", { class: "adm-msg", role: "status", tabindex: "-1", hidden: true });
  const say = (text, tone = "info") => { live.textContent = text; live.className = "adm-msg is-" + tone; live.setAttribute("role", tone === "error" ? "alert" : "status"); live.hidden = !text; };
  let exp = null;
  try { exp = await api("/clients/" + encodeURIComponent(id) + "/profile-export"); } catch { exp = null; }
  let timer = 0;
  const copyBtn = (label, text, said, cls) => {
    const b = h("button", { class: "btn " + cls, type: "button", onclick: async () => {
      try { await navigator.clipboard.writeText(text); b.textContent = "Copied to clipboard"; say(said, "success"); }
      catch { say("Copying was blocked by the browser. Allow clipboard access for this site and try again.", "error"); return; }
      clearTimeout(timer); timer = setTimeout(() => { b.textContent = label; say(""); }, 3000);
    } }, label);
    return b;
  };
  const exportBar = exp ? h("div", { class: "adm-exportwrap" },
    h("div", { class: "adm-export" },
      copyBtn("Copy for AI", exp.profileMarkdown, "Business Profile copied to clipboard. Paste it into ChatGPT or Claude.", "btn--primary"),
      h("a", { class: "btn btn--secondary", href: `/api/admin/clients/${encodeURIComponent(id)}/profile-export.pdf`, download: "" }, "Download PDF"),
      copyBtn("Copy Complete Client Brief", exp.briefMarkdown, "Complete client brief copied to clipboard. Paste it into ChatGPT or Claude.", "btn--secondary")),
    exp.discovery && !exp.discovery.complete ? h("p", { class: "adm-field__hint", text: "Brand Discovery " + ({ in_progress: "has been started but not submitted", not_started: "hasn’t been started", none: "hasn’t been assigned" }[exp.discovery.state] || "isn’t complete") + ". The client brief says so." }) : null) : null;
  const node = h("div", { class: "adm-page adm-detail" },
    back,
    h("div", { class: "adm-head" }, h("div", null, h("span", { class: "eyebrow" }, o.name), h("h1", { class: "adm-title", tabindex: "-1" }, "Business Profile"),
      h("p", { class: "adm-sub" }, "Answers are shown as the client saved them; staff cannot edit them here.")), exportBar),
    live,
    h("div", { class: "adm-tile adm-tile--profile adm-tile--" + (p.done === p.total ? "ok" : p.steps.every((s) => s.answered === 0) ? "plain" : "pending") },
      h("p", { class: "adm-tile__label" }, "Completion"),
      h("p", { class: "adm-tile__big" }, `${p.percent}%`, h("span", { class: "adm-tile__unit", text: "complete" })),
      h("progress", { class: "adm-meter adm-meter--lg", max: 100, value: pct, "aria-label": `Business Profile ${p.percent} percent complete` }),
      h("p", { class: "adm-tile__note" }, `${p.done} of ${p.total} sections complete` + (p.last_saved ? ` · last saved ${fmtDate(p.last_saved)}` : " · nothing saved yet")),
      missing.length ? h("p", { class: "adm-tile__note" }, "Needs answers: " + missing.map((s) => s.title).join(", ")) : h("p", { class: "adm-tile__note" }, "Every section is complete.")),
    h("section", { class: "adm-section", "aria-labelledby": "adm-prof-h" },
      h("div", { class: "adm-section-title" }, h("h2", { id: "adm-prof-h", text: "Sections and saved answers" }), toggleAll),
      p.steps.every((s) => s.answered === 0) ? h("p", { class: "adm-muted" }, "This organization hasn’t saved any Business Profile answers yet.") : null,
      h("div", { class: "adm-accgroup" }, p.steps.map(stepAccordion))));
  return { title: "Business Profile — " + o.name, node };
}
