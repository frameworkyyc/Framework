// Framework demo websites — small interaction polish (depth on hero layers, magnetic buttons, process line). Pure enhancement.
(function () {
  var doc = document.documentElement;
  var motion = doc.classList.contains("motion");
  var fine = window.matchMedia && window.matchMedia("(hover:hover) and (pointer:fine)").matches;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Process line draws once when the steps scroll into view.
  var steps = document.querySelector(".steps");
  if (steps) {
    if (motion && "IntersectionObserver" in window) new IntersectionObserver(function (es, io) { if (es[0].isIntersecting) { steps.classList.add("is-in"); io.disconnect(); } }, { threshold: 0.35 }).observe(steps);
    else steps.classList.add("is-in");
  }
  if (!motion) return;

  // Hero layers: gentle depth from the pointer (desktop) and from scroll.
  var layers = [].slice.call(document.querySelectorAll(".hero [data-depth]")), hero = document.querySelector(".hero");
  if (layers.length && hero) {
    var mx = 0, my = 0, ticking = false;
    function apply() {
      ticking = false;
      var r = hero.getBoundingClientRect(), off = clamp(-r.top, 0, 700);
      layers.forEach(function (el) {
        var d = parseFloat(el.getAttribute("data-depth")) || 0;
        el.style.setProperty("--tx", (mx * d * 60).toFixed(1) + "px");
        el.style.setProperty("--ty", (my * d * 40).toFixed(1) + "px");
        el.style.setProperty("--sy", (off * -d * 1.6).toFixed(1) + "px");
      });
    }
    function req() { if (!ticking) { ticking = true; requestAnimationFrame(apply); } }
    if (fine) {
      hero.addEventListener("pointermove", function (e) { var r = hero.getBoundingClientRect(); mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5; req(); });
      hero.addEventListener("pointerleave", function () { mx = 0; my = 0; req(); });
    }
    window.addEventListener("scroll", req, { passive: true });
    req();
  }

  // Magnetic primary buttons (desktop).
  if (fine) document.querySelectorAll(".btn--primary").forEach(function (b) {
    b.addEventListener("pointermove", function (e) {
      var r = b.getBoundingClientRect(), x = (e.clientX - r.left - r.width / 2) / r.width, y = (e.clientY - r.top - r.height / 2) / r.height;
      b.style.transform = "translate(" + (x * 8).toFixed(1) + "px," + (y * 6).toFixed(1) + "px)";
    });
    b.addEventListener("pointerleave", function () { b.style.transform = ""; });
  });
})();
