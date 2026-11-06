/* Contractor landing page motion: reveal on scroll, parallax, scroll-linked page previews.
   Everything is decorative. Without this script (or with reduced motion) the page shows in full. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;
  var clamp = function (n, a, b) { return Math.min(b, Math.max(a, n)); };
  if (reduce || !hasIO) return; // static page: nothing is hidden by default

  root.classList.add("cx-js");
  var revealEls = doc.querySelectorAll("[data-reveal], .cx-in, [data-draw], [data-nest]");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  revealEls.forEach(function (el) { io.observe(el); });

  var hero = doc.querySelector(".cx-hero");
  var previews = [].slice.call(doc.querySelectorAll("[data-scroll-preview]"));
  var bands = [].slice.call(doc.querySelectorAll("[data-parallax]"));
  var stages = [].slice.call(doc.querySelectorAll(".cx-stage__visual"));
  var live = new Set();
  var watch = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) live.add(e.target); else live.delete(e.target); });
    schedule();
  }, { rootMargin: "25% 0px 25% 0px" });
  [hero].concat(stages, bands).forEach(function (el) { if (el) watch.observe(el); });

  function measure() {
    previews.forEach(function (p) {
      var img = p.querySelector(".cx-frame__page"), view = p.querySelector(".cx-frame__view");
      if (img && view) p.style.setProperty("--shift", Math.max(0, img.offsetHeight - view.clientHeight) + "px");
    });
  }
  previews.forEach(function (p) { var img = p.querySelector("img"); if (img) img.addEventListener("load", measure); });

  var ticking = false;
  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  function update() {
    ticking = false;
    var vh = window.innerHeight;
    if (hero && live.has(hero)) hero.style.setProperty("--sy", String(Math.min(window.scrollY, vh)));
    if (hero && live.has(hero)) {
      [].forEach.call(hero.querySelectorAll("[data-depth]"), function (el) { el.style.setProperty("--depth", el.getAttribute("data-depth")); });
    }
    bands.forEach(function (b) {
      if (!live.has(b)) return;
      var host = b.parentElement, r = host.getBoundingClientRect();
      b.style.setProperty("--par", b.getAttribute("data-parallax"));
      b.style.setProperty("--bp", String(clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1)));
    });
    stages.forEach(function (s) {
      if (!live.has(s)) return;
      var r = s.getBoundingClientRect();
      var p = clamp((vh * 0.9 - r.top) / (r.height + vh * 0.5), 0, 1);
      s.style.setProperty("--p", p.toFixed(4));
      var f = s.querySelector("[data-scroll-preview]"); if (f) f.style.setProperty("--p", p.toFixed(4));
    });
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", function () { measure(); schedule(); });
  window.addEventListener("load", function () { measure(); schedule(); });
  measure(); schedule();
})();
