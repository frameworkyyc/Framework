/* Framework Admin: Websites. /admin/websites lists every website of every client (status, Production and Staging, renewals, what waits on the client, what is connected); /admin/websites/:id is
   one website's workspace with tabs: Overview, Environments, Domain and hosting, Review, SEO, Analytics, Files, Milestones. Production and Staging are shown together and each is edited in one
   obvious place (the Edit button on its card, or the Environments tab). It uses only existing data and endpoints: the list is GET /api/admin/websites, everything else is the per-client
   website API the old page used (same calls, same rules). Server text is only ever set as text. */
import { h, api, confirmDialog, errorState, fmtDate } from "./ui.js";
import { pageHead, grid, span, card, kpi, pill, fact, facts, tabs, segmented, button, drawer, toast, field, switchInput, empty, dataList, icon } from "./ds.js";
import { seoPanel } from "./website-seo.js";
import { analyticsPanel } from "./website-analytics.js";
import { workspacePanel } from "./website-workspace.js";
import { STATUS, PHASE, STAGE_LABEL, ORIGIN, PARTY, errorText, orNull, select, text, date, filesCard, screenshotCard, milestonesCard, previewCard } from "./site-blocks.js";

const enc = encodeURIComponent;
const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const daysUntil = (iso) => (iso ? Math.round((Date.parse(iso + "T00:00:00Z") - Date.now()) / 86400000) : null);
const isLive = (s) => Boolean(s.productionUrl) && s.status !== "in_development";

/** The next renewal (domain or hosting) as { days, label, tone } or null. */
function nextRenewal(s) {
  const c = [["Domain", s.domain && s.domain.renewal], ["Hosting", s.hosting && s.hosting.renewal]].filter(([, d]) => d).map(([what, d]) => ({ what, d, days: daysUntil(d) })).sort((a, b) => a.days - b.days)[0];
  if (!c) return null;
  const tone = c.days < 0 ? "bad" : c.days <= 60 ? "warn" : "quiet";
  const label = c.days < 0 ? `${c.what} overdue` : c.days === 0 ? `${c.what} renews today` : c.days <= 90 ? `${c.what} in ${plural(c.days, "day")}` : `${c.what} ${fmtDate(c.d + "T00:00:00Z", "medium")}`;
  return { days: c.days, label, tone };
}
const needsClient = (s) => (s.awaitingReview || 0) + (s.openTasks || 0);

/* ======================================================================================================== list */

const SITE_COLS = [
  { label: "Website", cls: "ds-dl__c--main", render: (s) => h("span", { class: "ds-site" }, h("strong", { class: "ds-site__n", text: s.name }), h("span", { class: "ds-muted", text: s.organizationName })) },
  { label: "Production", render: (s) => h("span", { class: "ds-env-mini" }, s.productionUrl ? h("span", { class: "ds-env-mini__h", text: host(s.productionUrl) }) : h("span", { class: "ds-muted", text: "No address yet" }), pill(isLive(s) ? "Live" : STATUS[s.status] || "—", isLive(s) ? "ok" : "quiet")) },
  { label: "Staging", render: (s) => h("span", { class: "ds-env-mini" }, s.stagingUrl ? h("span", { class: "ds-env-mini__h", text: host(s.stagingUrl) }) : h("span", { class: "ds-muted", text: "Not set up" }), s.stagingUrl ? pill("Set up", "info") : null) },
  { label: "Renews", render: (s) => { const r = nextRenewal(s); return r ? pill(r.label, r.tone) : h("span", { class: "ds-muted", text: "—" }); } },
  { label: "Needs the client", render: (s) => needsClient(s) ? pill([s.awaitingReview ? `${s.awaitingReview} to review` : "", s.openTasks ? plural(s.openTasks, "task") : ""].filter(Boolean).join(" · "), "warn") : h("span", { class: "ds-muted", text: "Nothing" }) },
  { label: "Connected", render: (s) => h("span", { class: "ds-conn" }, h("span", { class: "ds-conn__i" }, h("i", { class: "ds-dot ds-dot--" + (s.analytics.cloudflare ? "ok" : "quiet"), "aria-hidden": "true" }), "Traffic", h("span", { class: "rk-sr", text: s.analytics.cloudflare ? " connected" : " not connected" })), h("span", { class: "ds-conn__i" }, h("i", { class: "ds-dot ds-dot--" + (s.analytics.searchConsole ? "ok" : "quiet"), "aria-hidden": "true" }), "Search", h("span", { class: "rk-sr", text: s.analytics.searchConsole ? " connected" : " not connected" }))) },
];



async function renderList(ctx) {
  let data;
  const clientFilter = ctx.url.searchParams.get("client") || "";
  try { data = await api("/websites"); } catch (err) { return { title: "Websites", node: h("div", { class: "ds-page" }, errorState(err, ctx.retry)) }; }
  if (!data.available) return { title: "Websites", node: h("div", { class: "ds-page" }, pageHead({ title: "Websites" }), card({ body: empty({ title: "Websites aren’t available on this site yet", body: "A database change is waiting for approval. Nothing has been changed.", ic: "websites" }) })) };
  const all = data.websites.filter((s) => !clientFilter || s.organizationId === clientFilter);
  const clientName = clientFilter && all[0] ? all[0].organizationName : "";
  let filter = "all", query = "";
  const counts = {
    all: all.length, live: all.filter((s) => s.status === "live").length, dev: all.filter((s) => s.status === "in_development").length,
    attention: all.filter((s) => needsClient(s) > 0 || (nextRenewal(s) && nextRenewal(s).days <= 60)).length, nostaging: all.filter((s) => !s.stagingUrl).length,
  };
  const renewals = all.filter((s) => { const r = nextRenewal(s); return r && r.days <= 60; }).length;
  const waiting = all.reduce((n, s) => n + needsClient(s), 0);
  const kpis = grid(
    span(kpi({ label: "Websites", value: String(counts.all), note: clientName ? `for ${clientName}` : "across all clients" }), 3),
    span(kpi({ label: "Live", value: String(counts.live), note: counts.dev ? `${plural(counts.dev, "website")} in development` : "None in development", tone: "ok" }), 3),
    span(kpi({ label: "Staging set up", value: String(all.length - counts.nostaging), unit: `of ${all.length}`, note: counts.nostaging ? `${counts.nostaging} without a Staging address` : "Every website has one", tone: counts.nostaging ? "warn" : "ok" }), 3),
    span(kpi({ label: "Waiting on clients", value: String(waiting), note: renewals ? `${plural(renewals, "renewal")} due within 60 days` : "No renewals due soon", tone: waiting ? "warn" : "ok" }), 3));

  const listHost = h("div", { class: "ds-list-host" });
  const status = h("p", { class: "ds-muted", role: "status" });
  const draw = () => {
    const q = query.toLowerCase();
    const rows = all.filter((s) => (filter === "all" || (filter === "live" && s.status === "live") || (filter === "dev" && s.status === "in_development") || (filter === "attention" && (needsClient(s) > 0 || (nextRenewal(s) && nextRenewal(s).days <= 60))) || (filter === "nostaging" && !s.stagingUrl))
      && (!q || `${s.name} ${s.organizationName} ${s.productionUrl || ""} ${s.stagingUrl || ""}`.toLowerCase().includes(q)));
    status.textContent = `${plural(rows.length, "website")}${rows.length !== all.length ? ` of ${all.length}` : ""}.`;
    listHost.replaceChildren(rows.length ? dataList({ label: "Websites", cls: "ds-dl--sites", columns: SITE_COLS, rows: rows.map((s) => ({ ...s, href: "/admin/websites/" + enc(s.id) })) })
      : empty({ title: all.length ? "No website matches" : "No websites yet", body: all.length ? "Try another filter or search." : "Add a website with the button above, or from a client.", ic: "websites" }));
  };
  const find = h("input", { class: "input ds-find", type: "search", placeholder: "Find a website or client", "aria-label": "Find a website or client", autocomplete: "off", oninput: (e) => { query = e.target.value.trim(); draw(); } });
  const seg = segmented({ label: "Show", value: "all", onChange: (v) => { filter = v; draw(); }, options: [{ id: "all", label: "All", count: counts.all }, { id: "live", label: "Live", count: counts.live }, { id: "dev", label: "In development", count: counts.dev }, { id: "attention", label: "Needs attention", count: counts.attention }, { id: "nostaging", label: "No Staging", count: counts.nostaging }] });
  const canWrite = true;
  const add = canWrite ? button("Add website", { tone: "solid", icon: "plus", onClick: () => addDrawer(ctx, clientFilter) }) : null;
  const node = h("div", { class: "ds-page" },
    pageHead({ title: clientName ? `Websites: ${clientName}` : "Websites", sub: "Every client website, its Production and Staging addresses, and what needs attention.", actions: add, back: clientFilter ? ["All websites", "/admin/websites"] : null }),
    kpis, h("div", { class: "ds-toolbar" }, seg, find), card({ body: [listHost, status] }));
  draw();
  return { title: "Websites", node, crumbs: [["Admin", "/admin"], ["Websites", clientFilter ? "/admin/websites" : null], ...(clientName ? [[clientName, null]] : [])] };
}

/** Add a website: choose the client, name it, give its address and where it stands. The full details are edited in its workspace afterwards. */
async function addDrawer(ctx, preClient) {
  let clients;
  try { clients = (await api("/clients")).clients.filter((c) => c.status !== "archived"); } catch (err) { toast(errorText(err), "bad"); return; }
  const client = h("select", { id: "aw-client", class: "input" }, clients.map((c) => h("option", { value: c.id, selected: c.id === preClient ? true : null }, c.name)));
  const name = text("aw-name", "", { maxlength: "80", placeholder: "Main website" });
  const url = text("aw-url", "", { maxlength: "300", inputmode: "url", placeholder: "example.ca", spellcheck: "false", autocapitalize: "none" });
  const status = select("aw-status", STATUS, "live"), origin = select("aw-origin", ORIGIN, "framework");
  const msg = h("p", { class: "ds-hint", role: "status" });
  const form = h("form", { class: "ds-form", novalidate: true, onsubmit: async (e) => {
    e.preventDefault();
    if (!name.value.trim()) { msg.textContent = errorText({ code: "invalid_name" }); name.focus(); return; }
    try {
      const r = await api(`/clients/${enc(client.value)}/websites`, { method: "POST", body: { name: name.value.trim(), url: orNull(url.value), origin: origin.value, status: status.value, managed_by_framework: false, published: false } });
      dr.close(); toast(`${name.value.trim()} added.`); ctx.navigate("/admin/websites/" + enc(r.id));
    } catch (err) { msg.textContent = errorText(err); }
  } },
    field("aw-client", "Client", client), field("aw-name", "Name", name, "For example “Main website” or “Online shop”."), field("aw-url", "Production address", url, "Leave it empty only while the website is still being built."),
    field("aw-status", "Where it stands", status), field("aw-origin", "Who built it", origin), msg, h("div", { class: "ds-actions" }, button("Add website", { tone: "solid", type: "submit" })));
  const dr = drawer({ title: "Add a website", sub: "You can add the Staging address, domain and hosting next.", body: form });
}

/* ======================================================================================================== workspace */

const TABS = [["", "Overview"], ["environments", "Environments"], ["domain", "Domain & hosting"], ["review", "Review"], ["seo", "SEO"], ["analytics", "Analytics"], ["files", "Files"], ["milestones", "Milestones"]];

async function renderSite(id, tab, ctx) {
  let idx, data;
  try { idx = await api("/websites/" + enc(id)); } catch (err) { return { title: "Website", node: h("div", { class: "ds-page" }, errorState(err, ctx.retry)) }; }
  const s = idx.website, base = `/clients/${enc(s.organizationId)}/websites`;
  try { data = await api(base); } catch (err) { return { title: s.name, node: h("div", { class: "ds-page" }, errorState(err, ctx.retry)) }; }
  const site = data.websites.find((x) => x.id === id);
  if (!site) return { title: "Website", node: h("div", { class: "ds-page" }, errorState({ code: "not_found" }, ctx.retry)) };
  const canWrite = () => Boolean(data.capabilities && data.capabilities.writes);
  let busy = false;
  const say = (message, tone = "info") => { if (tone === "info") return; toast(message, tone === "error" ? "bad" : "ok"); };
  async function perform({ confirm, request, success }) {
    if (busy) return false;
    if (confirm && !(await confirmDialog(confirm))) return false;
    busy = true; let ok = false;
    try { await request(); toast(success); ok = true; } catch (err) { toast(errorText(err), "bad"); }
    busy = false;
    if (ok) await ctx.retry();
    return ok;
  }
  const bctx = { base, data, canWrite, perform, say };
  const archived = Boolean(site.archivedAt);

  /* ---- the two addresses: one card each, one Edit button each ---- */
  function addressDrawer(kind) {
    const prod = kind === "production";
    const input = text("addr-" + kind, prod ? site.url : s.stagingUrl, { maxlength: "300", inputmode: "url", spellcheck: "false", autocapitalize: "none", placeholder: prod ? "example.ca" : "https://staging.example.ca" });
    const msg = h("p", { class: "ds-hint", role: "status" });
    const form = h("form", { class: "ds-form", novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      try {
        await (prod ? api(`${base}/${enc(id)}/update`, { method: "POST", body: { url: orNull(input.value) } }) : api(`${base}/${enc(id)}/workspace/staging`, { method: "POST", body: { staging_url: orNull(input.value) } }));
        dr.close(); toast(prod ? "Production address saved." : "Staging address saved."); ctx.retry();
      } catch (err) { msg.textContent = errorText(err); }
    } }, field("addr-" + kind, prod ? "Production address" : "Staging address", input, prod ? "The public website your customers see. Leave it empty only while the website is still being built." : "Where the client reviews changes before they go live. https only. Leave it empty if there is no Staging version yet."), msg,
      canWrite() ? h("div", { class: "ds-actions" }, button("Save address", { tone: "solid", type: "submit" })) : h("p", { class: "ds-hint", text: "Changes are switched off on this site." }));
    const dr = drawer({ title: prod ? "Production address" : "Staging address", sub: site.name, body: form });
  }
  const envCard = (kind) => {
    const prod = kind === "production", url = prod ? site.url : s.stagingUrl, live = prod ? isLive(s) : Boolean(url);
    return card({ tone: prod ? "" : "ink", cls: "ds-env", title: prod ? "Production" : "Staging", sub: prod ? "What customers see" : "Where changes are reviewed",
      actions: pill(prod ? (live ? "Live" : "Not launched") : (live ? "Set up" : "Not set up"), prod ? (live ? "ok" : "quiet") : (live ? "info" : "quiet")),
      body: [url ? h("a", { class: "ds-host", href: url, target: "_blank", rel: "noopener noreferrer" }, host(url), h("span", { class: "rk-sr", text: " (opens in a new tab)" })) : h("p", { class: "ds-host ds-host--none", text: prod ? "No address yet" : "No Staging address yet" })],
      foot: [url ? button(prod ? "Open site" : "Open Staging", { icon: "external", href: url, external: true }) : null, canWrite() && !archived ? button(url ? "Edit address" : prod ? "Add address" : "Add Staging address", { icon: "edit", tone: url ? "" : "solid", onClick: () => addressDrawer(kind) }) : null] });
  };

  const manage = canWrite() ? (archived
    ? button("Restore website", { onClick: () => perform({ request: () => api(`${base}/${enc(id)}/restore`, { method: "POST", body: {} }), success: `${site.name} restored.` }) })
    : button("Archive website", { tone: "danger", onClick: () => perform({ confirm: { title: "Archive this website?", body: "It is hidden from the lists. Nothing is deleted, and you can restore it later.", details: [["Website", site.name]], confirmLabel: "Archive website" }, request: () => api(`${base}/${enc(id)}/archive`, { method: "POST", body: {} }), success: `${site.name} archived.` }) })) : null;

  /* ---- tabs ---- */
  const overview = () => {
    const r = nextRenewal(s), n = needsClient(s);
    return grid(
      span(envCard("production"), 6), span(envCard("staging"), 6),
      span(kpi({ label: "Waiting on the client", value: String(n), note: n ? [s.awaitingReview ? `${s.awaitingReview} to review` : "", s.openTasks ? plural(s.openTasks, "task") : ""].filter(Boolean).join(" · ") : "Nothing", tone: n ? "warn" : "ok", href: `/admin/websites/${enc(id)}/review` }), 3),
      span(kpi({ label: "Next renewal", value: r ? (r.days < 0 ? "Overdue" : r.days + "d") : "—", note: r ? r.label : "No renewal dates recorded", tone: r ? r.tone : null, href: `/admin/websites/${enc(id)}/domain` }), 3),
      span(kpi({ label: "SEO", value: s.seoStatus ? { not_started: "Not started", in_progress: "In progress", optimised: "Optimised", monitoring: "Monitoring" }[s.seoStatus] : "—", note: s.seoStatus ? "Status shown to the client when published" : "Not set up", href: `/admin/websites/${enc(id)}/seo` }), 3),
      span(kpi({ label: "Traffic and search", value: s.analytics.cloudflare || s.analytics.searchConsole ? "Connected" : "Not connected", note: [s.analytics.cloudflare ? "Cloudflare" : "", s.analytics.searchConsole ? "Search Console" : ""].filter(Boolean).join(" · ") || "Set up in the Analytics tab", tone: s.analytics.cloudflare || s.analytics.searchConsole ? "ok" : null, href: `/admin/websites/${enc(id)}/analytics` }), 3),
      span(screenshotCard(site, bctx), 6),
      span(card({ title: "About this website", body: facts([fact("Where it stands", STAGE_LABEL[site.stage] || STATUS[site.status]), fact("Built by", ORIGIN[site.origin]), fact("Managed by Framework", site.managedByFramework ? "Yes" : "No"), fact("Launch date", site.launchDate ? fmtDate(site.launchDate + "T00:00:00Z", "long") : ""), fact("Shown to the client", site.published ? "Yes" : "Not yet")]),
        foot: button("Edit details", { icon: "edit", href: `/admin/websites/${enc(id)}/environments` }) }), 6),
      manage ? span(card({ tone: "tone", title: "Manage", sub: archived ? "This website is archived and hidden from the lists." : "Archiving hides this website from the lists. Nothing is deleted, and you can restore it later.", foot: manage }), 12) : null);
  };

  const environments = () => {
    const name = text("ws-name", site.name, { maxlength: "80", required: true }), status = select("ws-status", STATUS, site.status), origin = select("ws-origin", ORIGIN, site.origin);
    const phase = data.phaseAvailable ? select("ws-phase", PHASE, site.phase || "") : null;
    const launch = date("ws-launch", site.launchDate);
    const managed = switchInput({ id: "ws-managed", label: "Framework manages this website", checked: site.managedByFramework, hint: "Separate from where it stands: whether Framework looks after its updates, hosting or maintenance." });
    const published = switchInput({ id: "ws-published", label: "Ready to show the client", checked: site.published });
    const form = h("form", { class: "ds-form", novalidate: true, onsubmit: (e) => { e.preventDefault(); if (!name.value.trim()) { toast(errorText({ code: "invalid_name" }), "bad"); name.focus(); return; }
      perform({ request: () => api(`${base}/${enc(id)}/update`, { method: "POST", body: { ...(phase ? { phase: phase.value || null } : {}), name: name.value.trim(), origin: origin.value, status: status.value, managed_by_framework: managed.input.checked, launch_date: orNull(launch.value), published: published.input.checked } }), success: `${name.value.trim()} saved.` }); } },
      field("ws-name", "Name", name), h("div", { class: "ds-two" }, field("ws-status", "Where it stands", status), field("ws-origin", "Who built it", origin)), phase ? field("ws-phase", "Stage (optional)", phase, "Refines where it stands for the client.") : null,
      field("ws-launch", "Launch date", launch, "Optional."), managed.node, published.node, canWrite() ? h("div", { class: "ds-actions" }, button("Save details", { tone: "solid", type: "submit" })) : null);
    return grid(span(envCard("production"), 6), span(envCard("staging"), 6), span(card({ title: "About this website", sub: "Where it stands, who built it and whether the client can see it.", body: form }), 7), span(previewCard(site, bctx) || card({ title: "Live preview check", sub: "Available for a launched website with an address." }), 5));
  };

  const domain = () => {
    const edit = (what) => {
      const domainish = what === "domain", p = domainish ? site.domain : site.hosting;
      const a = text("d-a", domainish ? p.registrar : p.provider, { maxlength: "120" }), o = select("d-o", PARTY, p.owner), r = date("d-r", p.renewal);
      const form = h("form", { class: "ds-form", novalidate: true, onsubmit: async (e) => { e.preventDefault(); try { await api(`${base}/${enc(id)}/update`, { method: "POST", body: domainish ? { domain_registrar: orNull(a.value), domain_owner: o.value, domain_renewal: orNull(r.value) } : { hosting_provider: orNull(a.value), hosting_owner: o.value, hosting_renewal: orNull(r.value) } }); dr.close(); toast("Saved."); ctx.retry(); } catch (err) { toast(errorText(err), "bad"); } } },
        field("d-a", domainish ? "Registrar" : "Hosting provider", a, domainish ? "Where the domain name is registered." : "Where the website is hosted."), field("d-o", domainish ? "Who owns the domain" : "Who owns the hosting", o), field("d-r", "Renews on", r, "Optional. Renewals show on the Websites list."), canWrite() ? h("div", { class: "ds-actions" }, button("Save", { tone: "solid", type: "submit" })) : null);
      const dr = drawer({ title: domainish ? "Domain" : "Hosting", sub: site.name, body: form });
    };
    const notes = h("textarea", { id: "ws-notes", class: "input", rows: "5", maxlength: "1000" }); notes.value = site.managementNotes || "";
    const mk = (title, what, p) => card({ title, actions: canWrite() && !archived ? button("Edit", { icon: "edit", onClick: () => edit(what) }) : null, body: facts([fact(what === "domain" ? "Registrar" : "Provider", what === "domain" ? p.registrar : p.provider), fact("Owner", p.owner && p.owner !== "unknown" ? PARTY[p.owner] : ""), fact("Renews", p.renewal ? fmtDate(p.renewal + "T00:00:00Z", "long") : "")]) });
    return grid(span(mk("Domain", "domain", site.domain), 6), span(mk("Hosting", "hosting", site.hosting), 6),
      span(card({ title: "How it is managed", sub: "Plain notes for the team. Never put passwords or logins here.", body: field("ws-notes", "Notes", notes), foot: canWrite() ? button("Save notes", { tone: "solid", onClick: () => perform({ request: () => api(`${base}/${enc(id)}/update`, { method: "POST", body: { management_notes: orNull(notes.value) } }), success: "Notes saved." }) }) : null }), 12));
  };

  // The older panels load on a button (the old page had many on one screen); in a tab of their own they load straight away.
  const auto = (panel) => { window.requestAnimationFrame(() => { const b = panel.querySelector("button"); if (b && /^(Open|Load|Show)/.test(b.textContent)) b.click(); }); return panel; };
  const wrapPanel = (title, sub, panel) => grid(span(card({ title, sub, body: auto(panel) }), 12));
  const review = () => wrapPanel("Review with the client", "Updates for the client to approve, and tasks for them. Shown in their Website section; drafts stay invisible until shown.", workspacePanel({ base, site, canWrite, say, hideStaging: true }));
  const seo = () => wrapPanel("SEO and search visibility", "What Framework publishes for the client about search.", seoPanel({ base, site, canWrite, say }));
  const analytics = () => wrapPanel("Analytics", "Which Cloudflare Web Analytics site and Search Console property this website reads.", analyticsPanel({ base, site, canWrite, say }));
  const files = () => grid(span(filesCard(site, bctx), 6), span(screenshotCard(site, bctx), 6));
  const milestones = () => grid(span(milestonesCard(site, bctx), 12));
  const BODY = { "": overview, environments, domain, review, seo, analytics, files, milestones };
  const body = (BODY[tab] || overview)();

  const node = h("div", { class: "ds-page" },
    pageHead({ title: site.name, back: ["All websites", "/admin/websites"], sub: undefined, kicker: undefined,
      actions: [isLive(s) ? button("Open Production", { icon: "external", href: site.url, external: true }) : null, s.stagingUrl ? button("Open Staging", { icon: "external", href: s.stagingUrl, external: true }) : null] }),
    h("p", { class: "ds-sub ds-sub--row" }, h("a", { class: "ds-link", href: "/admin/clients/" + enc(s.organizationId), "data-link": "", text: s.organizationName }), pill(STAGE_LABEL[site.stage] || STATUS[site.status], site.status === "live" ? "ok" : site.status === "in_development" ? "info" : "quiet"), pill(site.managedByFramework ? "Managed by Framework" : "Not managed by Framework"), archived ? pill("Archived", "warn") : null),
    !canWrite() ? h("p", { class: "ds-banner", role: "status" }, "Changes are switched off on this site: you can look at this website, but not change it.") : null,
    tabs({ label: "Website sections", current: tab, items: TABS.map(([t, label]) => ({ id: t, label, href: `/admin/websites/${enc(id)}${t ? "/" + t : ""}`, count: t === "review" && needsClient(s) ? needsClient(s) : null })) }),
    body);
  return { title: site.name, node, crumbs: [["Admin", "/admin"], ["Websites", "/admin/websites"], [site.name, null]] };
}

/* ======================================================================================================== route */

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/websites(?:\/([^/]+)(?:\/([^/]+))?)?$/);
  if (m && m[1]) return renderSite(decodeURIComponent(m[1]), m[2] && TABS.some(([t]) => t === m[2]) ? m[2] : "", ctx);
  return renderList(ctx);
}

/** One client's websites, for the Websites tab of the client workspace: the same rows as the Websites list, for that client only. */
export async function clientWebsites(orgId, ctx) {
  let data;
  try { data = await api("/websites"); } catch (err) { return h("div", { class: "ds-page" }, errorState(err, ctx.retry)); }
  const mine = (data.websites || []).filter((w) => w.organizationId === orgId);
  const add = button("Add website", { tone: "solid", icon: "plus", onClick: () => addDrawer(ctx, orgId) });
  return h("div", null, card({ title: "Websites", sub: mine.length ? `${plural(mine.length, "website")}. Open one to edit its Production and Staging addresses, domain, hosting and more.` : undefined, actions: add,
    body: mine.length ? dataList({ label: "Websites", cls: "ds-dl--sites", columns: SITE_COLS, rows: mine.map((s) => ({ ...s, href: "/admin/websites/" + enc(s.id) })) }) : empty({ title: "No website yet", body: "A client with no website simply has none listed. Add one when they have one, or when Framework starts building it.", ic: "websites" }) }));
}
