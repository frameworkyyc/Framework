/* Homepage testimonials: one at a time, cross-fading. Without JavaScript all three are simply listed one after another.
   Previous/next buttons, a 01 / 03 count, and a Pause button (WCAG 2.2.2). It rotates every 9 seconds, pauses while the pointer or
   keyboard focus is inside, when the tab is hidden or the section is off screen, and never rotates under prefers-reduced-motion. */
(function () {
  "use strict";
  var box = document.querySelector(".tm__carousel");
  if (!box) return;
  var slides = Array.prototype.slice.call(box.querySelectorAll(".tm__slide"));
  var controls = box.querySelector(".tm__controls");
  if (slides.length < 2 || !controls) return;
  var cur = box.querySelector(".tm__cur"), prev = box.querySelector(".tm__prev"), next = box.querySelector(".tm__next"), pause = box.querySelector(".tm__pause");
  var live = box.querySelector(".tm__slides");
  var reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  var INTERVAL = 9000, index = 0, timer = null, held = false, userPaused = false, visible = true;

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function show(i, announce) {
    index = (i + slides.length) % slides.length;
    slides.forEach(function (s, k) {
      var on = k === index;
      if (on) { s.setAttribute("data-active", ""); s.removeAttribute("inert"); s.removeAttribute("aria-hidden"); }
      else { s.removeAttribute("data-active"); s.setAttribute("inert", ""); s.setAttribute("aria-hidden", "true"); }
    });
    cur.textContent = pad(index + 1);
    live.setAttribute("aria-live", announce ? "polite" : "off");
  }
  function stop() { if (timer) { window.clearInterval(timer); timer = null; } }
  function start() {
    stop();
    if (reduced || held || userPaused || !visible || document.hidden) return;
    timer = window.setInterval(function () { show(index + 1, false); }, INTERVAL);
  }

  box.classList.add("is-carousel");
  controls.hidden = false;
  show(0, false);
  if (reduced) { pause.hidden = true; }

  prev.addEventListener("click", function () { show(index - 1, true); start(); });
  next.addEventListener("click", function () { show(index + 1, true); start(); });
  pause.addEventListener("click", function () {
    userPaused = !userPaused;
    pause.setAttribute("aria-pressed", userPaused ? "true" : "false");
    pause.textContent = userPaused ? "Play" : "Pause";
    live.setAttribute("aria-live", userPaused ? "polite" : "off");
    start();
  });
  box.addEventListener("mouseenter", function () { held = true; stop(); });
  box.addEventListener("mouseleave", function () { held = false; start(); });
  box.addEventListener("focusin", function () { held = true; stop(); });
  box.addEventListener("focusout", function (e) { if (!box.contains(e.relatedTarget)) { held = false; start(); } });
  box.addEventListener("keydown", function (e) {
    if (e.key === "ArrowLeft") { show(index - 1, true); start(); }
    else if (e.key === "ArrowRight") { show(index + 1, true); start(); }
  });
  document.addEventListener("visibilitychange", start);
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) { visible = entries[0].isIntersecting; start(); }, { threshold: 0.2 }).observe(box);
  }
  start();
})();
