// Framework demo websites — scroll motion.
// 1. "Watch it come together": a pinned scene (.build) whose SVG parts are tied to scroll progress.
//    Every element with data-b="start,end" gets --t (0 to 1, eased) while the page scrolls through that window; demo.css turns --t into movement.
//    Without this script, or with reduced motion, nothing is hidden: --t defaults to 1, so the scene shows finished.
// 2. Entrance + scroll reveals, stat count-ups, a progress bar and a light parallax on the hero photo.
(function () {
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;
  var root = document.documentElement;
  root.classList.add("motion");

  function clamp(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  var vh = function () { return window.innerHeight || document.documentElement.clientHeight; };

  // ---- Build scene
  var sec = document.querySelector(".build");
  var parts = [], steps = [], stick, bar, dots, lastP = -1, topOff = 0;
  if (sec) {
    sec.classList.add("is-live");
    stick = sec.querySelector(".build__stick");
    bar = sec.querySelector(".build__fill");
    steps = [].slice.call(sec.querySelectorAll("[data-step]"));
    parts = [].map.call(sec.querySelectorAll("[data-b]"), function (el) {
      var w = el.getAttribute("data-b").split(",");
      return { el: el, a: parseFloat(w[0]), b: parseFloat(w[1]), t: -1 };
    });
    topOff = parseFloat(getComputedStyle(stick).top) || 0;
  }
  function buildUpdate() {
    var r = sec.getBoundingClientRect();
    if (r.bottom < -200 || r.top > vh() + 200) return;
    var span = sec.offsetHeight - stick.offsetHeight;
    var p = clamp((topOff - r.top) / (span > 0 ? span : 1));
    if (p === lastP) return;
    lastP = p;
    for (var i = 0; i < parts.length; i++) {
      var q = parts[i], t = clamp((p - q.a) / (q.b - q.a));
      t = 1 - Math.pow(1 - t, 3);
      if (Math.abs(t - q.t) > 0.002 || (t !== q.t && (t === 0 || t === 1))) { q.t = t; q.el.style.setProperty("--t", t.toFixed(3)); }
    }
    var on = 0;
    steps.forEach(function (s, i) { if (p >= parseFloat(s.getAttribute("data-step")) - 0.0001) on = i; });
    steps.forEach(function (s, i) { s.classList.toggle("is-on", i === on); s.classList.toggle("is-done", i < on); });
    if (bar) bar.style.setProperty("--p", p.toFixed(3));
    sec.style.setProperty("--p", p.toFixed(3));
  }

  // ---- Reveals
  var revealSel = ".section-head,.service,.step,.review,.projects .ph,.stats>div,.faq details,.areas,.quote__info,form.card,.split>div:first-child";
  var rv = [].slice.call(document.querySelectorAll(revealSel));
  rv.forEach(function (el) {
    el.classList.add("rv");
    var sibs = el.parentNode ? [].filter.call(el.parentNode.children, function (c) { return c.classList.contains("rv"); }) : [];
    el.style.setProperty("--d", Math.min(sibs.indexOf(el), 6) * 70 + "ms");
  });
  var nums = [].slice.call(document.querySelectorAll(".stats strong"));
  function countUp(el) {
    var m = el.textContent.match(/^([^\d]*)([\d,]+(?:\.\d+)?)(.*)$/);
    if (!m) return;
    var target = parseFloat(m[2].replace(/,/g, "")), dec = (m[2].split(".")[1] || "").length, comma = m[2].indexOf(",") > -1;
    var start = performance.now(), dur = 1400;
    function fmt(v) { var s = v.toFixed(dec); return comma ? Number(s).toLocaleString("en-CA", { minimumFractionDigits: dec, maximumFractionDigits: dec }) : s; }
    function tick(now) {
      var k = clamp((now - start) / dur); k = 1 - Math.pow(1 - k, 3);
      el.textContent = m[1] + fmt(target * k) + m[3];
      if (k < 1) requestAnimationFrame(tick);
    }
    el.textContent = m[1] + fmt(0) + m[3];
    requestAnimationFrame(tick);
  }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("in");
        if (nums.indexOf(e.target.querySelector && e.target.querySelector("strong")) > -1) countUp(e.target.querySelector("strong"));
        io.unobserve(e.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -6% 0px" });
    rv.forEach(function (el) { io.observe(el); });
  } else {
    rv.forEach(function (el) { el.classList.add("in"); });
  }

  // ---- Progress bar + hero parallax
  var prog = document.createElement("div");
  prog.className = "scroll-prog";
  prog.setAttribute("aria-hidden", "true");
  document.body.appendChild(prog);
  var heroImg = null, heroBox = document.querySelector(".hero .ph");
  var ticking = false;
  function onScroll() {
    ticking = false;
    var h = document.documentElement.scrollHeight - vh();
    prog.style.transform = "scaleX(" + (h > 0 ? clamp(window.scrollY / h) : 0).toFixed(4) + ")";
    if (heroBox) {
      if (!heroImg) heroImg = heroBox.querySelector("img");
      var r = heroBox.getBoundingClientRect();
      if (heroImg && r.bottom > 0 && r.top < vh()) heroImg.style.transform = "translate3d(0," + (r.top * -0.08).toFixed(1) + "px,0) scale(1.12)";
    }
    if (sec) buildUpdate();
  }
  function request() { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", function () { lastP = -1; if (sec) topOff = parseFloat(getComputedStyle(stick).top) || 0; request(); });
  onScroll();
})();
