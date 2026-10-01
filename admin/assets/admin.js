/* Framework Admin — shell and router.
   Builds the sidebar from modules.js, routes by URL (History API), and hands each module a small context. */

import { h, api, errorState } from "./ui.js";
import { MODULES } from "./modules.js";

const MARK = `<svg viewBox="0 0 1092 1092" aria-hidden="true" focusable="false"><rect width="1092" height="1092" fill="#0A0A0A"/><path fill="#FFFFFF" d="M302 245H815V347H411V741L302 851Z"/><path fill="#FFFFFF" d="M435 517L512 440H815V545H534V842H435Z"/></svg>`;

const shell = document.getElementById("adm-shell");
let main;
let side;
let toggle;
let notice;
let navLinks = [];
let routeToken = 0;

/* ---------- Shell ---------- */

function brand() {
  const a = h("a", { class: "adm-brand", href: "/admin", "data-link": "", "aria-label": "Framework Admin home" });
  a.insertAdjacentHTML("afterbegin", MARK); // constant markup, no data involved
  a.append(h("span", { class: "adm-brand__word" }, "Framework"));
  return a;
}

function navItem(m) {
  if (!m.enabled) {
    return h("li", null, h("span", { class: "adm-nav__link is-disabled", "aria-disabled": "true" }, m.label, h("span", { class: "adm-nav__later" }, "Later")));
  }
  const a = h("a", { class: "adm-nav__link", href: m.path, "data-link": "", "data-module": m.id }, m.label);
  navLinks.push(a);
  return h("li", null, a);
}

function buildShell() {
  const live = MODULES.filter((m) => m.enabled);
  const later = MODULES.filter((m) => !m.enabled);

  toggle = h("button", { class: "menu-toggle", type: "button", "aria-expanded": "false", "aria-controls": "adm-side" }, "Menu");
  const bar = h("header", { class: "adm-bar" }, brand(), toggle);

  const userLine = h("p", { id: "adm-user" }, "");
  side = h(
    "aside",
    { class: "adm-side", id: "adm-side" },
    h("div", { class: "adm-side__head" }, brand(), h("span", { class: "adm-side__label" }, "Admin")),
    h(
      "nav",
      { class: "adm-nav", "aria-label": "Admin" },
      h("div", { class: "adm-nav__group" }, h("ul", null, live.map(navItem))),
      later.length
        ? h("div", { class: "adm-nav__group" }, h("p", { class: "adm-side__label adm-nav__group-label" }, "Coming later"), h("ul", null, later.map(navItem)))
        : null,
    ),
    h("div", { class: "adm-side__foot" }, userLine, h("a", { href: "/", target: "_blank", rel: "noopener" }, "View website"), h("a", { href: "/cdn-cgi/access/logout" }, "Sign out")),
  );

  notice = h("p", { class: "adm-notice", role: "status", hidden: true });
  main = h("main", { class: "adm-main", id: "adm-main", tabindex: "-1" }, notice);
  shell.replaceChildren(bar, side, main);

  toggle.addEventListener("click", () => setNav(toggle.getAttribute("aria-expanded") !== "true"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && side.classList.contains("is-open")) { setNav(false); toggle.focus(); }
  });
  window.matchMedia("(min-width: 1024px)").addEventListener("change", (e) => { if (e.matches) setNav(false); });
}

function setNav(open) {
  side.classList.toggle("is-open", open);
  document.body.classList.toggle("adm-nav-open", open);
  toggle.setAttribute("aria-expanded", String(open));
}

/* ---------- Router ---------- */

const clean = (p) => p.replace(/\/+$/, "") || "/";

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

async function route() {
  const token = ++routeToken;
  const url = new URL(location.href);
  const module = resolve(url.pathname);
  navLinks.forEach((a) => (a.dataset.module === (module && module.id) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  setNav(false);

  let node;
  let title;
  if (!module) {
    title = "Not found";
    node = h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, "Not found"), h("p", { class: "adm-sub" }, "There is nothing at this address."),
      h("p", null, h("a", { class: "adm-link", href: "/admin", "data-link": "" }, "Back to overview")));
  } else {
    main.setAttribute("aria-busy", "true");
    try {
      const mod = await module.load();
      const result = await mod.render({ url, navigate, notify, retry: route });
      if (token !== routeToken) return;
      ({ title, node } = result);
    } catch (err) {
      if (token !== routeToken) return;
      title = "Error";
      node = h("div", { class: "adm-page" }, h("h1", { class: "adm-title", tabindex: "-1" }, module.label), errorState(err, route));
    }
  }
  main.removeAttribute("aria-busy");
  [...main.children].forEach((c) => { if (c !== notice) c.remove(); });
  main.append(node);
  document.title = `${title} — Framework Admin`;
  const heading = main.querySelector(".adm-title");
  (heading || main).focus({ preventScroll: true });
  window.scrollTo(0, 0);
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
