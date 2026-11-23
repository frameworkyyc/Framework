/* Framework Admin: shell and router. Builds the sidebar, top bar (breadcrumbs, search, attention) and the section tabs from the six navigation sections below, routes by URL (History API),
   and hands each module a small context. The older pages keep their own addresses; this file only decides which section each one belongs to. */

import { h, api, errorState } from "./ui.js";
import { MODULES } from "./modules.js";
import { icon, tabs, crumbs, pageSkeleton } from "./ds.js";
import { openSearch } from "./search.js";
import { NAV, sectionOf, clean } from "./nav.js";

const MARK = `<svg viewBox="0 0 1092 1092" aria-hidden="true" focusable="false"><rect width="1092" height="1092" fill="#0A0A0A"/><path fill="#FFFFFF" d="M302 245H815V347H411V741L302 851Z"/><path fill="#FFFFFF" d="M435 517L512 440H815V545H534V842H435Z"/></svg>`;

const shell = document.getElementById("adm-shell");
let main;
let side;
let toggle;
let notice;
let topCrumbs;
let attn;
let routeToken = 0;
let navLinks = [];

/* ---------- Navigation: six sections; Operations and Settings group the older pages (their addresses do not change) ---------- */

/* Environment switch (Framework staff only: Admin sits behind Cloudflare Access). Which environment this is comes from the verified Framework hostnames alone; the link is the other
   environment's fixed /admin entry point, so no session, token, query or client path is carried across and the destination does its own sign-in. Other hosts show nothing. */
const ENV_HOSTS = { production: ["frameworkco.ca", "www.frameworkco.ca"], staging: ["staging.frameworkco.ca"] };
const ENV_HERE = Object.keys(ENV_HOSTS).find((k) => ENV_HOSTS[k].includes(location.hostname.toLowerCase())) || null;
const ENV_SWITCH = ENV_HERE === "staging" ? { label: "Switch to Production", href: "https://frameworkco.ca/admin" } : ENV_HERE === "production" ? { label: "Switch to Staging", href: "https://staging.frameworkco.ca/admin" } : null;

function brand(tag = false) {
  const a = h("a", { class: "adm-brand", href: "/admin", "data-link": "", "aria-label": "Framework Admin home" });
  a.insertAdjacentHTML("afterbegin", MARK); // constant markup, no data involved
  a.append(h("span", { class: "adm-brand__word" }, "Framework"));
  if (tag && ENV_HERE === "staging") a.append(h("span", { class: "ds-envtag", text: "Staging" }));
  return a;
}

function navItem(n) {
  const a = h("a", { class: "ds-nav__link", href: n.path, "data-link": "", "data-section": n.id }, icon(n.icon), h("span", { text: n.label }));
  navLinks.push(a);
  return h("li", null, a);
}

function buildShell() {
  toggle = h("button", { class: "menu-toggle ds-iconbtn", type: "button", "aria-expanded": "false", "aria-controls": "adm-side", "aria-label": "Menu" }, icon("menu"));
  const searchBtn = (cls) => h("button", { class: "ds-searchbtn " + cls, type: "button", onclick: () => openSearch(), "aria-label": "Search clients, websites and pages" }, icon("search"), h("span", { text: "Search" }), h("kbd", { text: "/" }));
  const bar = h("header", { class: "ds-mobilebar" }, brand(true), h("button", { class: "ds-iconbtn", type: "button", "aria-label": "Search", onclick: () => openSearch() }, icon("search")), toggle);

  const userLine = h("p", { id: "adm-user" }, "");
  const envBadge = ENV_HERE === "staging" ? h("span", { class: "ds-envtag ds-envtag--side", text: "Staging" }) : null;
  side = h("aside", { class: "adm-side", id: "adm-side" },
    h("div", { class: "adm-side__head ds-side__head" }, brand()),
    h("nav", { class: "adm-nav", "aria-label": "Admin" }, h("ul", { class: "ds-nav" }, NAV.filter((n) => MODULES.some((m) => m.enabled && m.id === n.id)).map(navItem))),
    h("div", { class: "ds-side__foot" }, envBadge, userLine, h("a", { href: "/", target: "_blank", rel: "noopener" }, "View website"), h("a", { href: "/cdn-cgi/access/logout" }, "Sign out"), ENV_SWITCH ? h("a", { class: "ds-envlink", href: ENV_SWITCH.href, rel: "noopener noreferrer", text: ENV_SWITCH.label }) : null));

  topCrumbs = h("div", { class: "ds-top__crumbs" });
  attn = h("a", { class: "ds-attn", href: "/admin/support", "data-link": "", hidden: true });
  notice = h("p", { class: "adm-notice", role: "status", hidden: true });
  main = h("main", { class: "adm-main", id: "adm-main", tabindex: "-1" }, notice);
  const top = h("header", { class: "ds-top" }, topCrumbs, h("div", { class: "ds-top__search" }, searchBtn("")), attn);
  shell.replaceChildren(bar, side, h("div", { class: "ds-main" }, top, main));

  toggle.addEventListener("click", () => setNav(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && side.classList.contains("is-open")) { setNav(false); toggle.focus(); }
    const typing = /^(input|textarea|select)$/i.test((e.target && e.target.tagName) || "") || (e.target && e.target.isContentEditable);
    if ((e.key === "/" && !typing && !e.metaKey && !e.ctrlKey) || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k")) { e.preventDefault(); openSearch(); }
  });
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (e) => { if (e.matches) setNav(false); });
}

function setNav(open) {
  side.classList.toggle("is-open", open);
  document.body.classList.toggle("adm-nav-open", open);
  toggle.setAttribute("aria-expanded", String(open));
}

/* ---------- Router ---------- */

function resolve(pathname) {
  const path = clean(pathname);
  const live = MODULES.filter((m) => m.enabled);
  // Overview owns exactly /admin; every other module owns its prefix.
  const hit = live.find((m) => m.id !== "overview" && (path === m.path || path.startsWith(m.path + "/")));
  if (hit) return hit;
  return path === "/admin" ? live.find((m) => m.id === "overview") : null;
}

export function navigate(href, { replace = false } = {}) {
  if (replace) history.replaceState(null, "", href);
  else history.pushState(null, "", href);
  route();
}

export function notify(message) {
  notice.textContent = message;
  notice.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { notice.hidden = true; }, 7000);
}

/** What needs attention (support requests with new activity), shown on Operations, on Support and in the top bar. A courtesy: any failure simply shows no badge. */
async function refreshBadge() {
  try {
    const a = await api("/services/attention");
    const n = a && a.available && a.support ? a.support.attention : 0;
    document.querySelectorAll(".adm-nav__badge, .adm-nav__sr").forEach((el) => el.remove());
    const link = navLinks.find((x) => x.dataset.section === "operations");
    if (n > 0 && link) link.append(h("span", { class: "adm-nav__badge", "aria-hidden": "true", text: String(n) }), h("span", { class: "visually-hidden adm-nav__sr", text: `, ${n} need attention` }));
    attn.hidden = !(n > 0); attn.replaceChildren(icon("bell"), h("span", { text: `${n} need${n === 1 ? "s" : ""} attention` }));
  } catch { /* no badge */ }
}

function defaultCrumbs(section, title) {
  const items = [["Admin", "/admin"]];
  if (section && section.id !== "overview") items.push([section.label, section.path]);
  if (title && (!section || title !== section.label)) items.push([title, null]);
  else if (section && section.id === "overview") items.push(["Overview", null]);
  return items.length > 1 ? items : [["Overview", null]];
}

async function route() {
  const token = ++routeToken;
  if (clean(location.pathname) === "/admin/portal-feedback") history.replaceState(null, "", "/admin/feedback/portal" + location.search); // the old address now lives under the Feedback tabs
  if (clean(location.pathname) === "/admin/demo-traffic") history.replaceState(null, "", "/admin/leads/activity" + location.search); // Demo traffic is now the Activity view of Leads
  const url = new URL(location.href);
  const module = resolve(url.pathname);
  const section = sectionOf(url.pathname);
  navLinks.forEach((a) => (section && a.dataset.section === section.id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  setNav(false);

  let node;
  let title;
  let crumbItems;
  if (!module) {
    title = "Not found";
    node = h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, "Not found"), h("p", { class: "adm-sub" }, "There is nothing at this address."),
      h("p", null, h("a", { class: "adm-link", href: "/admin", "data-link": "" }, "Back to overview")));
  } else {
    main.setAttribute("aria-busy", "true");
    [...main.children].forEach((c) => { if (c !== notice) c.remove(); });
    main.append(pageSkeleton());
    try {
      const mod = await module.load();
      const result = await mod.render({ url, navigate, notify, retry: route });
      if (token !== routeToken) return;
      ({ title, node } = result);
      crumbItems = result.crumbs;
    } catch (err) {
      if (token !== routeToken) return;
      title = "Error";
      node = h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, module.label), errorState(err, route));
    }
  }
  main.removeAttribute("aria-busy");
  [...main.children].forEach((c) => { if (c !== notice) c.remove(); });
  topCrumbs.replaceChildren(crumbs(crumbItems || defaultCrumbs(section, title)));
  // The pages of a grouped section (Operations, Settings) share one row of section tabs above their content.
  if (section && section.children) main.append(h("div", { class: "ds-subnav" }, tabs({ label: section.label + " sections", current: section.children.map(([, href]) => href).filter((href) => clean(url.pathname) === href || (href !== section.path && clean(url.pathname).startsWith(href + "/"))).sort((a, b) => b.length - a.length)[0] || section.path, items: section.children.map(([label, href]) => ({ id: href, label, href })) })));
  main.append(node);
  document.title = `${title} | Framework Admin`;
  const heading = main.querySelector(".adm-title, .ds-title");
  (heading || main).focus({ preventScroll: true });
  window.scrollTo(0, 0);
  if (location.hash.length > 1) { const target = document.getElementById(decodeURIComponent(location.hash.slice(1))); if (target) target.scrollIntoView(); } // a link such as /admin/settings/service-pricing#svc-x scrolls to its card
  refreshBadge();
}

document.addEventListener("click", (e) => {
  const a = e.target.closest && e.target.closest("a[data-link]");
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  const dest = new URL(a.href);
  if (dest.href !== location.href) navigate(dest.pathname + dest.search);
  else route();
});
window.addEventListener("popstate", route);

/* ---------- Boot ---------- */

buildShell();
api("/me").then((me) => { document.getElementById("adm-user").textContent = me.email; }).catch(() => {});
route();
