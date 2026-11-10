/* About page: reveal sections as they scroll into view (drawing the line illustrations on as they arrive) and count the hours up once.
   Adds the "js" class only when it can also reveal, so without JavaScript, without IntersectionObserver and under prefers-reduced-motion
   everything is simply visible and the figures read as written. */
(function () {
  "use strict";
  var root = document.documentElement;
  if (!("IntersectionObserver" in window) || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;
  root.classList.add("js");
  var items = document.querySelectorAll(".ab [data-reveal]");
  var fmt = function (n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); };
  var count = function (el) {
    var target = Number(el.getAttribute("data-count")), suffix = el.getAttribute("data-suffix") || "";
    if (!isFinite(target) || target <= 0) return;
    var t0 = null;
    var frame = function (now) {
      if (t0 === null) t0 = now;
      var t = Math.min((now - t0) / 1800, 1), p = 1 - Math.pow(1 - t, 4);
      el.textContent = fmt(target * p) + (t < 1 ? "" : suffix);
      if (t < 1) window.requestAnimationFrame(frame);
    };
    el.textContent = "0";
    window.requestAnimationFrame(frame);
  };
  var show = function (el) {
    if (el.classList.contains("is-in")) return;
    el.classList.add("is-in");
    Array.prototype.forEach.call(el.querySelectorAll("[data-count]"), count);
  };
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) { if (e.isIntersecting) { show(e.target); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px", threshold: 0.12 });
  items.forEach(function (el) { io.observe(el); });
  window.setTimeout(function () { items.forEach(show); }, 6000); // never leave anything hidden
})();
