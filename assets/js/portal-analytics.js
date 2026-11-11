/* Website analytics: reads a day aloud on hover, touch or the arrow keys. Everything it shows is already in the page (each day's text is in data-t); it fetches nothing and keeps nothing. */
(function () {
  "use strict";
  var charts = document.querySelectorAll(".an-chart");
  Array.prototype.forEach.call(charts, function (chart) {
    var hits = chart.querySelectorAll(".an-hit");
    var cursor = chart.querySelector(".an-cursor");
    var out = document.getElementById(chart.getAttribute("aria-describedby"));
    if (!hits.length || !cursor || !out) return;
    var rest = out.textContent;
    var at = -1;
    function show(i) {
      if (i < 0 || i >= hits.length) return;
      at = i;
      cursor.setAttribute("x1", hits[i].getAttribute("data-x"));
      cursor.setAttribute("x2", hits[i].getAttribute("data-x"));
      cursor.classList.add("is-on");
      out.textContent = hits[i].getAttribute("data-t");
    }
    function clear() { at = -1; cursor.classList.remove("is-on"); out.textContent = rest; }
    Array.prototype.forEach.call(hits, function (r, i) {
      r.addEventListener("pointerenter", function () { show(i); });
      r.addEventListener("pointerdown", function () { show(i); });
    });
    chart.addEventListener("pointerleave", function () { if (document.activeElement !== chart) clear(); });
    chart.addEventListener("blur", clear);
    chart.addEventListener("keydown", function (ev) {
      var k = ev.key, next = at;
      if (k === "ArrowRight") next = at < 0 ? hits.length - 1 : Math.min(hits.length - 1, at + 1);
      else if (k === "ArrowLeft") next = at < 0 ? hits.length - 1 : Math.max(0, at - 1);
      else if (k === "Home") next = 0;
      else if (k === "End") next = hits.length - 1;
      else if (k === "Escape") { clear(); return; }
      else return;
      ev.preventDefault();
      show(next);
    });
  });
})();
