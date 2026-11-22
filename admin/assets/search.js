/* Framework Admin: global search (press / or Ctrl/Cmd+K). It searches what the Admin already knows: its pages, the clients and the websites. Read-only; it changes nothing, and every result is a
   link. The lists are loaded the first time it opens and kept for a minute. Names are set as text only. */
import { h, api } from "./ui.js";
import { icon } from "./ds.js";
import { NAV } from "./nav.js";

let cache = null, loadedAt = 0;
const pages = () => NAV.flatMap((n) => [{ label: n.label, href: n.path, kind: "Page", hay: n.label }, ...(n.children || []).filter(([, href]) => href !== n.path).map(([label, href]) => ({ label, href, kind: n.label, hay: `${label} ${n.label}` }))]);

async function load() {
  if (cache && Date.now() - loadedAt < 60000) return cache;
  const out = [...pages()];
  const [clients, sites] = await Promise.all([api("/clients").catch(() => null), api("/websites").catch(() => null)]);
  if (clients && Array.isArray(clients.clients)) for (const c of clients.clients) if (c.status !== "archived") out.push({ label: c.name, href: "/admin/clients/" + encodeURIComponent(c.id), kind: "Client", hay: c.name });
  if (sites && Array.isArray(sites.websites)) for (const s of sites.websites) out.push({ label: s.name, href: "/admin/websites/" + encodeURIComponent(s.id), kind: "Website", sub: s.organizationName, hay: `${s.name} ${s.organizationName || ""} ${s.productionUrl || ""} ${s.stagingUrl || ""}` });
  cache = out; loadedAt = Date.now();
  return out;
}

export async function openSearch() {
  if (document.querySelector("dialog.ds-cmd")) return;
  const input = h("input", { type: "search", placeholder: "Search clients, websites and pages", "aria-label": "Search", autocomplete: "off", spellcheck: "false" });
  const list = h("ul", { class: "ds-cmd__list", role: "listbox", "aria-label": "Results" });
  const dlg = h("dialog", { class: "ds-cmd", "aria-label": "Search" }, h("div", { class: "ds-cmd__in" }, icon("search"), input), list);
  let all = [], shown = [], at = 0;
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = (q ? all.filter((x) => x.hay.toLowerCase().includes(q)) : all.filter((x) => x.kind === "Page" || x.kind === "Client").slice(0, 8)).slice(0, 12);
    at = Math.min(at, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((x, i) => h("li", { class: "ds-cmd__item", role: "presentation" }, h("a", { href: x.href, "data-link": "", role: "option", "aria-selected": i === at ? "true" : "false", onclick: () => dlg.close() }, h("span", { text: x.label }), x.sub ? h("span", { class: "ds-muted", text: x.sub }) : null, h("span", { class: "ds-cmd__kind", text: x.kind })))) : [h("li", { class: "ds-cmd__empty", text: all.length ? "Nothing matches that." : "Loading…" })]));
  };
  input.addEventListener("input", () => { at = 0; draw(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); at = (at + (e.key === "ArrowDown" ? 1 : -1) + shown.length) % Math.max(1, shown.length); draw(); }
    else if (e.key === "Enter" && shown[at]) { e.preventDefault(); const a = list.querySelectorAll("a")[at]; if (a) a.click(); }
  });
  dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener("close", () => dlg.remove());
  document.body.append(dlg); dlg.showModal(); input.focus(); draw();
  try { all = await load(); } catch { all = pages(); }
  draw();
}
