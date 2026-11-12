/* Branded page transitions and loading states for the client portal (worker/portal/TRANSITIONS.md). Loaded synchronously in <head> (so the curtain is black at first paint and there is no flash)
   only where PORTAL_TRANSITIONS is on. It only toggles classes on <html>; /assets/css/portal-transition.css does all of the drawing.
   What it never does: prevent or delay a navigation or a form submission, touch authentication, fetch or store anything but one short-lived sessionStorage hint ("fw.tr") that says "the next page
   was reached from a portal link", hold a user behind the animation (the curtain takes no pointer events, Escape clears it, and everything clears itself after a few seconds). Direct links,
   refresh and Back/Forward carry no hint, so they show no transition at all. Reduced motion: no decorative transition; a real wait still shows the (still) mark. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement, KEY = "fw.tr";
  var reduce = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var NAV_TTL = 10000, SIGNIN_TTL = 20 * 60 * 1000; /* how long a hint stays valid */
  var LOADING_AFTER = 650; /* a navigation still pending after this long is a genuine wait */
  var FORM_AFTER = 500;
  var GIVE_UP = 9000; /* the page is still here (a download, a stalled request): take the curtain away */
  var timers = [];

  function store(kind) { try { window.sessionStorage.setItem(KEY, JSON.stringify({ k: kind, t: Date.now() })); } catch (e) { /* storage blocked: no transition, nothing else changes */ } }
  function take() { try { var v = window.sessionStorage.getItem(KEY); window.sessionStorage.removeItem(KEY); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function meta() { var m = doc.querySelector('meta[name="fw-fx"]'); return m ? m.getAttribute("content") : ""; }

  /* ---- arriving: before the first paint ---- */
  (function arrive() {
    var hint = take();
    if (!hint || reduce) return;
    var age = Date.now() - hint.t;
    if (hint.k === "in" && meta() === "app" && age >= 0 && age < SIGNIN_TTL) root.classList.add("fw-intro"); /* the first signed-in page after a sign-in */
    else if (hint.k === "nav" && age >= 0 && age < NAV_TTL) root.classList.add("fw-enter");
    else if (hint.k === "in" && meta() !== "app") store("in"); /* not a signed-in page (the sign-in itself, an error): keep it for the portal */
  })();

  function status() { return doc.querySelector("[data-fw-status]"); }
  function clear() {
    timers.forEach(function (t) { window.clearTimeout(t); }); timers = [];
    root.classList.remove("fw-leave", "fw-loading");
    var s = status(); if (s) s.textContent = "";
  }
  function later(fn, ms) { timers.push(window.setTimeout(fn, ms)); }

  /* ---- leaving: the page eases into the black while the browser navigates (nothing here delays that) ---- */
  function leaving(kind) {
    clear();
    root.classList.remove("fw-enter", "fw-intro"); /* the arrival state of this page must not outrank the leaving state */
    if (kind) store(kind);
    if (!reduce) root.classList.add("fw-leave");
    later(function () { root.classList.add("fw-loading"); var s = status(); if (s) s.textContent = "Loading"; }, LOADING_AFTER);
    later(function () { clear(); try { window.sessionStorage.removeItem(KEY); } catch (e) { /* ignore */ } }, GIVE_UP);
  }

  /* a "major section": the organization and the first path segment under it (Branding, Website, Account, ...). Moving inside a section is an ordinary, instant navigation. */
  function section(path) {
    var m = /^\/portal\/o\/([^\/]+)(?:\/([^\/]*))?/.exec(path);
    return m ? m[1] + "/" + (m[2] || "") : path.replace(/\/+$/, "");
  }
  var DOWNLOAD = /\/(files|download|downloads|export|pdf|print)(\/|$)|\.(pdf|zip|csv|xlsx?|docx?|png|jpe?g|gif|svg|webp|woff2?|ttf|otf|mp4|mov)$/i;

  doc.addEventListener("click", function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
    if (!a || a.target && a.target !== "_self" || a.hasAttribute("download") || a.hasAttribute("data-fw-skip")) return;
    var u;
    try { u = new URL(a.href, window.location.href); } catch (e) { return; }
    if (a.hasAttribute("data-fw-signin")) { /* Continue on the sign-in page: the portal plays the logo intro when the person comes back signed in */
      if (u.origin === window.location.origin) leaving("in");
      return;
    }
    if (u.origin !== window.location.origin || u.pathname.indexOf("/portal") !== 0 || DOWNLOAD.test(u.pathname)) return;
    if (u.pathname === window.location.pathname && u.search === window.location.search) return; /* same page or an in-page anchor */
    if (section(u.pathname) === section(window.location.pathname)) return; /* inside the same section: no transition */
    if (reduce) { later(function () { root.classList.add("fw-loading"); var s = status(); if (s) s.textContent = "Loading"; }, LOADING_AFTER); later(clear, GIVE_UP); return; }
    leaving("nav");
  });

  /* a form that is genuinely slow (an upload, a save): the mark appears only if it takes a while. A failed validation or an error page is never hidden: those never reach here or arrive as a normal page. */
  doc.addEventListener("submit", function (ev) {
    var f = ev.target;
    if (!f || f.nodeName !== "FORM") return;
    window.setTimeout(function () { /* after every other handler has had its say */
      if (ev.defaultPrevented) return;
      var action = (f.getAttribute("action") || "");
      if (/\/logout$/.test(action)) { leaving("nav"); return; }
      clear();
      later(function () { root.classList.remove("fw-enter", "fw-intro"); if (!reduce) root.classList.add("fw-leave"); root.classList.add("fw-loading"); var s = status(); if (s) s.textContent = "Loading"; store("nav"); }, FORM_AFTER);
      later(clear, GIVE_UP);
    }, 0);
  });

  /* Escape stops waiting: it clears the curtain (and the browser stops the load as it always does) */
  doc.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && (root.classList.contains("fw-leave") || root.classList.contains("fw-loading"))) clear(); });
  /* Back/Forward from the bfcache, or returning to this page: never leave the curtain up */
  window.addEventListener("pageshow", function (ev) { if (ev.persisted) { clear(); root.classList.remove("fw-enter", "fw-intro"); } });
})();
