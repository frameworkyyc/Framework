/* FRAMEWORK — combined client revenue (homepage)
   Asks the Worker for the one combined total (/api/client-revenue) and, when it returns one, reveals the band and
   counts the figure up from $0 the first time the band scrolls into view (once per page load).
   The API gives { total: "$2.5M+", value: 2500000 }. `value` is what we count to; if it is missing we fall back to
   showing `total` as plain text. No total at all: the band stays hidden. Individual client figures never reach
   the browser. Reduced motion: the finished figure is shown straight away. */
(function () {
  "use strict";

  var block = document.querySelector("[data-revenue-total]");
  if (!block) return;

  var DURATION = 2500;
  var live = block.querySelector('[data-fill="total"]');
  var ghost = block.querySelector('[data-fill="ghost"]');
  var spoken = block.querySelector('[data-fill="final"]');
  var figure = block.querySelector(".results__figure");

  var format = function (n) { return "$" + String(Math.floor(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "+"; };
  var easeOut = function (t) { return 1 - Math.pow(1 - t, 4); }; // smooth, natural deceleration
  var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  var started = false;
  var run = function (target, finalText) {
    if (started) return;
    started = true;
    block.classList.add("is-in");
    if (target === null || reduced) {
      live.textContent = finalText;
      block.style.setProperty("--p", "1");
      return;
    }
    var t0 = null;
    var frame = function (now) {
      if (t0 === null) t0 = now;
      var t = Math.min((now - t0) / DURATION, 1);
      var p = easeOut(t);
      live.textContent = t < 1 ? format(target * p) : finalText;
      block.style.setProperty("--p", p.toFixed(4));
      if (t < 1) window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  };

  fetch("/api/client-revenue", { credentials: "same-origin" })
    .then(function (res) { if (!res.ok) throw new Error("client-revenue " + res.status); return res.json(); })
    .then(function (data) {
      if (!data || typeof data.total !== "string" || !data.total) return; // nothing to show: stay hidden

      var value = data.value;
      var counting = typeof value === "number" && isFinite(value) && value > 0 && value < 1e12;
      var finalText = counting ? format(value) : data.total;
      var target = counting ? Math.floor(value) : null;

      ghost.textContent = finalText;
      spoken.textContent = finalText;
      live.textContent = counting && !reduced ? format(0) : finalText;
      figure.style.setProperty("--len", String(finalText.length));
      block.hidden = false;

      if ("IntersectionObserver" in window) {
        var io = new IntersectionObserver(function (entries) {
          if (!entries[entries.length - 1].isIntersecting) return;
          io.disconnect();
          run(target, finalText);
        }, { threshold: 0.3 });
        io.observe(block);
      } else {
        run(target, finalText);
      }
    })
    .catch(function () { /* unavailable: leave the block hidden */ });
})();
