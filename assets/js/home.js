/* Homepage: reveal sections as they scroll into view. Adds the "js" class only when it can also reveal, so without JavaScript,
   without IntersectionObserver and under prefers-reduced-motion everything is simply visible. */
(function () {
  "use strict";
  var root = document.documentElement;
  if (!("IntersectionObserver" in window) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  root.classList.add("js");
  var items = document.querySelectorAll("[data-reveal], .nx");
  var show = function (el) { el.classList.add("is-in"); };
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  items.forEach(function (el) { io.observe(el); });
  window.setTimeout(function () { items.forEach(show); }, 6000); // never leave anything hidden
})();
