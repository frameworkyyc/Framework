/* Framework Admin: Analytics. /admin/analytics is the portfolio across every client website: whether Cloudflare Web Analytics and Google Search Console are connected, which Cloudflare account each
   website reads (Framework's or the client's own), and the last figures that were read and saved (with the time they were read). Nothing here calls Cloudflare or Google and nothing is estimated:
   a website that has not been read shows "Not read yet". Each row opens that website's Analytics tab (/admin/websites/:id/analytics), where the site tag, property, the client's own account and
   write-only token are saved and tested (the existing multi-account panel). /admin/analytics/:id goes to the same place. Server text is only ever set as text. */
import { h, api, errorState, fmtDateTime } from "./ui.js";
import { pageHead, grid, span, card, kpi, pill, segmented, dataList, barChart, empty } from "./ds.js";

const enc = encodeURIComponent;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const nf = (n) => (Number.isFinite(n) ? n.toLocaleString("en-CA") : "—");
const host = (u) => String(u || "").replace(/^https?:\/\//, "").replace(/\/$/, "");

const connPill = (on, accountNote) => h("span", { class: "ds-conn__stack" }, pill(on ? "Connected" : "Not connected", on ? "ok" : "quiet"), accountNote ? h("span", { class: "ds-muted", text: accountNote }) : null);
const hasFigures = (s) => Boolean((s.cloudflare.figures && s.cloudflare.fetchedAt) || (s.searchConsole.figures && s.searchConsole.fetchedAt));
const lastRead = (s) => [s.cloudflare.fetchedAt, s.searchConsole.fetchedAt].filter(Boolean).sort().pop() || null;
const needsSetup = (s) => !s.cloudflare.connected || !s.searchConsole.connected;

const COLS = [
  { label: "Website", cls: "ds-dl__c--main", render: (s) => h("span", { class: "ds-site" }, h("strong", { class: "ds-site__n", text: s.name }), h("span", { class: "ds-muted", text: s.organizationName + (s.url ? " · " + host(s.url) : "") })) },
  { label: "Traffic (Cloudflare)", render: (s) => connPill(s.cloudflare.connected, s.cloudflare.connected ? (s.cloudflare.account === "own" ? "Client’s own account" : "Framework’s account") : "") },
  { label: "Search (Google)", render: (s) => connPill(s.searchConsole.connected, "") },
  { label: "Last 30 days read", render: (s) => {
    const parts = [];
    if (s.cloudflare.figures && s.cloudflare.fetchedAt) parts.push(`${nf(s.cloudflare.figures.pageViews)} page views`);
    if (s.searchConsole.figures && s.searchConsole.fetchedAt) parts.push(`${nf(s.searchConsole.figures.clicks)} clicks`);
    return parts.length ? h("span", { class: "ds-site" }, h("strong", { class: "ds-site__n", text: parts.join(" · ") }), h("span", { class: "ds-muted", text: "Read " + fmtDateTime(lastRead(s)) })) : h("span", { class: "ds-muted", text: s.cloudflare.connected || s.searchConsole.connected ? "Not read yet" : "Not connected" });
  } },
];

const HELP = [
  ["Cloudflare shows no data", "Check the Web Analytics site tag (in the site’s settings in Cloudflare, not the token in the snippet) and that the website carries the Web Analytics snippet. Use Test on the website’s Analytics tab."],
  ["Cloudflare refuses the token", "For a client’s own account the read-only token needs Account Analytics: Read and must be limited to that same account. Paste a new token on the website’s Analytics tab; it is saved encrypted and is never shown again."],
  ["Search Console says no access", "Add Framework’s connected Google account as a Restricted user on the client’s property in Search Console, and check the Search Console API is on in the Google Cloud project."],
  ["Google needs reconnecting", "If Google no longer accepts Framework’s sign-in, the connection has to be set up again. The steps are in worker/portal/WEBSITE-ANALYTICS.md."],
];

export async function render(ctx) {
  const m = ctx.url.pathname.replace(/\/+$/, "").match(/^\/admin\/analytics(?:\/([^/]+))?$/);
  if (m && m[1]) { ctx.navigate("/admin/websites/" + enc(decodeURIComponent(m[1])) + "/analytics"); return { title: "Analytics", node: h("div", { class: "ds-page" }) }; }
  let data;
  try { data = await api("/analytics/summary"); } catch (err) { return { title: "Analytics", node: h("div", { class: "ds-page" }, errorState(err, ctx.retry)) }; }
  const head = pageHead({ title: "Analytics", sub: "Traffic and search across every client website: what is connected, and the last figures that were read." });
  if (!data.available) return { title: "Analytics", node: h("div", { class: "ds-page" }, head, card({ body: empty({ title: "Analytics isn’t available on this site yet", body: "A database change is waiting for approval. Nothing has been changed.", ic: "analytics" }) })) };

  const all = data.websites, total = all.length;
  const cf = all.filter((s) => s.cloudflare.connected).length, gsc = all.filter((s) => s.searchConsole.connected).length, own = all.filter((s) => s.cloudflare.connected && s.cloudflare.account === "own").length;
  const views = all.reduce((a, s) => a + (s.cloudflare.figures && s.cloudflare.fetchedAt ? s.cloudflare.figures.pageViews || 0 : 0), 0);
  const clicks = all.reduce((a, s) => a + (s.searchConsole.figures && s.searchConsole.fetchedAt ? s.searchConsole.figures.clicks || 0 : 0), 0);
  const readCount = all.filter(hasFigures).length;
  const kpis = grid(
    span(kpi({ label: "Traffic connected", value: String(cf), unit: `of ${total}`, note: own ? `${plural(own, "website")} on the client’s own account` : "All on Framework’s account", tone: total && cf === total ? "ok" : null }), 3),
    span(kpi({ label: "Search connected", value: String(gsc), unit: `of ${total}`, note: total - gsc ? `${total - gsc} not connected` : "Every website connected", tone: total && gsc === total ? "ok" : null }), 3),
    span(kpi({ label: "Page views, last read", value: readCount ? nf(views) : "—", note: readCount ? `From ${plural(readCount, "website")} (30 days, as last read)` : "Nothing read yet" }), 3),
    span(kpi({ label: "Search clicks, last read", value: readCount ? nf(clicks) : "—", note: readCount ? "30 days, as last read" : "Nothing read yet" }), 3));

  const p = data.platform || {};
  const platform = card({ title: "Connections", sub: "What the server itself is set up to read. These are settings, not data.", body: h("ul", { class: "ds-statuslist" },
    [["Cloudflare Web Analytics (Framework’s account)", p.cloudflare, "Credentials are saved on the server."], ["Google Search Console", p.search_console, "Framework’s Google sign-in is saved on the server."],
      ["Clients’ own Cloudflare accounts", data.ownAccounts && data.ownAccounts.available && data.ownAccounts.key, data.ownAccounts && !data.ownAccounts.available ? "A database change is waiting." : "Needs the server’s encryption key."]]
      .map(([label, ok, note]) => h("li", { class: "ds-statuslist__i" }, pill(ok ? "Ready" : "Not set up", ok ? "ok" : "warn"), h("span", null, h("strong", { text: label }), h("span", { class: "ds-muted", text: " " + (ok ? "" : note) }))))) });

  const top = all.filter((s) => s.cloudflare.figures && s.cloudflare.fetchedAt && s.cloudflare.figures.pageViews > 0).sort((a, b) => b.cloudflare.figures.pageViews - a.cloudflare.figures.pageViews).slice(0, 12);
  const chart = card({ title: "Page views by website", sub: "Last 30 days, as last read. Websites that have not been read are not shown.",
    body: top.length ? barChart({ data: top.map((s) => ({ label: s.name, value: s.cloudflare.figures.pageViews })), label: "Page views by website", unit: "page views" }) : empty({ title: "No figures read yet", body: "Figures appear once a client opens their Analytics page or you test a connection.", ic: "analytics" }) });

  const help = card({ title: "Troubleshooting", sub: "Each website’s Analytics tab has a Test button that says exactly what is wrong.", body: h("dl", { class: "ds-help" }, HELP.map(([q, a]) => h("div", { class: "ds-help__i" }, h("dt", { text: q }), h("dd", { text: a })))) });

  let filter = "all", query = "";
  const listHost = h("div", { class: "ds-list-host" }), status = h("p", { class: "ds-muted", role: "status" });
  const draw = () => {
    const q = query.toLowerCase();
    const rows = all.filter((s) => (filter === "all" || (filter === "setup" && needsSetup(s)) || (filter === "ok" && !needsSetup(s))) && (!q || `${s.name} ${s.organizationName} ${s.url || ""}`.toLowerCase().includes(q)));
    status.textContent = `${plural(rows.length, "website")}${rows.length !== total ? ` of ${total}` : ""}.`;
    listHost.replaceChildren(rows.length ? dataList({ label: "Website analytics", cls: "ds-dl--analytics", columns: COLS, rows: rows.map((s) => ({ ...s, href: "/admin/websites/" + enc(s.id) + "/analytics" })) })
      : empty({ title: total ? "No website matches" : "No websites yet", body: total ? "Try another filter or search." : "Add a website first; then connect its analytics here.", ic: "analytics" }));
  };
  const find = h("input", { class: "input ds-find", type: "search", placeholder: "Find a website or client", "aria-label": "Find a website or client", autocomplete: "off", oninput: (e) => { query = e.target.value.trim(); draw(); } });
  const seg = segmented({ label: "Show", value: "all", onChange: (v) => { filter = v; draw(); }, options: [{ id: "all", label: "All", count: total }, { id: "setup", label: "Needs setup", count: all.filter(needsSetup).length }, { id: "ok", label: "Fully connected", count: all.filter((s) => !needsSetup(s)).length }] });
  const list = card({ title: "Websites", body: [h("div", { class: "ds-toolbar" }, seg, find), listHost, status] });
  draw();
  const node = h("div", { class: "ds-page" }, head, kpis, grid(span(chart, 8), span(platform, 4)), list, help);
  return { title: "Analytics", node, crumbs: [["Admin", "/admin"], ["Analytics", null]] };
}
