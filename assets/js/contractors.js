/* Contractor landing page motion: reveal on scroll and light parallax.
   The laptop/phone mockups run on the Portfolio's own script (main.js).
   Everything here is decorative. Without this script (or with reduced motion) the page shows in full. */
(function () {
  "use strict";
  var doc = document, root = doc.documentElement;
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var hasIO = "IntersectionObserver" in window;
  var clamp = function (n, a, b) { return Math.min(b, Math.max(a, n)); };
  if (reduce || !hasIO) return; // static page: nothing is hidden by default

  root.classList.add("cx-js");
  /* [data-draw] also holds the homepage logo drawing back until it is on screen, so its cycle begins from the start */
  var revealEls = doc.querySelectorAll("[data-reveal], .cx-in, [data-draw]");
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  revealEls.forEach(function (el) { io.observe(el); });

  var hero = doc.querySelector(".cx-hero");
  var bands = [].slice.call(doc.querySelectorAll("[data-parallax]"));
  var live = new Set();
  var watch = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) live.add(e.target); else live.delete(e.target); });
    schedule();
  }, { rootMargin: "25% 0px 25% 0px" });
  [hero].concat(bands).forEach(function (el) { if (el) watch.observe(el); });
  if (hero) [].forEach.call(hero.querySelectorAll("[data-depth]"), function (el) { el.style.setProperty("--depth", el.getAttribute("data-depth")); });

  var ticking = false;
  function schedule() { if (!ticking) { ticking = true; requestAnimationFrame(update); } }
  function update() {
    ticking = false;
    var vh = window.innerHeight;
    if (hero && live.has(hero)) hero.style.setProperty("--sy", String(Math.min(window.scrollY, vh)));
    bands.forEach(function (b) {
      if (!live.has(b)) return;
      var r = b.parentElement.getBoundingClientRect();
      b.style.setProperty("--par", b.getAttribute("data-parallax"));
      b.style.setProperty("--bp", String(clamp((r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2), -1, 1)));
    });
  }
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  schedule();
})();
