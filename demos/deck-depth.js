// Fence & Decks: interactions for the content-depth sections. All content is real HTML first; this layer adds the selectors.
(function () {
  var doc = document.documentElement;
  var motion = doc.classList.contains("motion");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ---- Tab sets: materials and fence styles ---- */
  var sets = {};
  $$("[data-tabset]").forEach(function (root) {
    var tabs = $$("[role=tab]", root), panels = $$("[role=tabpanel]", root);
    function select(id) {
      tabs.forEach(function (t) { var on = t.getAttribute("data-t") === id; t.setAttribute("aria-selected", String(on)); t.tabIndex = on ? 0 : -1; });
      panels.forEach(function (p) { p.hidden = p.getAttribute("data-p") !== id; });
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { select(t.getAttribute("data-t")); }); t.tabIndex = t.getAttribute("aria-selected") === "true" ? 0 : -1; });
    sets[root.getAttribute("data-tabset")] = { select: select, root: root };
  });

  /* ---- Find my match ---- */
  var finder = $("[data-finder]");
  if (finder && sets.mat) {
    var MAT = {
      pt: { cost: 1, up: 4, life: 2, nat: 3, name: "Pressure-treated pine", why: "It keeps the budget lean and is easy to repair, as long as you are happy to seal it regularly." },
      cedar: { cost: 2, up: 3, life: 3, nat: 5, name: "Western red cedar", why: "You get warm, natural colour for a modest premium, with a stain-and-seal routine to keep it that way." },
      composite: { cost: 3, up: 1, life: 4, nat: 3, name: "Capped composite", why: "It trades a higher price for almost no upkeep, so weekends go to the deck, not to maintaining it." },
      pvc: { cost: 4, up: 1, life: 5, nat: 2, name: "Cellular PVC", why: "It stays cooler and shrugs off moisture, which suits wet or very sunny spots and a long life." },
      ipe: { cost: 5, up: 3, life: 5, nat: 5, name: "Tropical hardwood", why: "It is the statement choice: dense, dramatic and built to last for decades, if the budget allows." }
    };
    var pick = { budget: "balanced", upkeep: "little", look: "natural" }, out = $(".finder__out", finder);
    function score(m) {
      var s = 0;
      if (pick.budget === "lean") s -= m.cost * 3.5; else if (pick.budget === "balanced") s -= Math.abs(m.cost - 3) * 1.6; else s += (m.life + m.nat) * .5;
      if (pick.upkeep === "little") s -= m.up * 1; else if (pick.upkeep === "none") s -= m.up * 2.6;
      if (pick.look === "natural") s += m.nat * 1.5; else s += (6 - m.nat) * 1.1;
      return s;
    }
    function best() { var b = null, bs = -1e9; Object.keys(MAT).forEach(function (k) { var v = score(MAT[k]); if (v > bs) { bs = v; b = k; } }); return b; }
    function show(go) {
      var k = best(), m = MAT[k]; out.textContent = "";
      var b = document.createElement("b"); b.textContent = m.name; out.appendChild(b);
      out.appendChild(document.createTextNode(" is your best match. " + m.why));
      var btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Show me"; btn.addEventListener("click", function () { sets.mat.select(k); var r = sets.mat.root.getBoundingClientRect(); window.scrollTo({ top: window.scrollY + r.top - 170, behavior: "smooth" }); }); out.appendChild(btn);
      if (go) sets.mat.select(k);
    }
    $$("button[role=radio]", finder).forEach(function (b) {
      b.addEventListener("click", function () {
        var g = b.getAttribute("data-k"); pick[g] = b.getAttribute("data-v");
        $$("button[data-k=" + g + "]", finder).forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); });
        show(true);
      });
    });
    show(false);
  }

  /* ---- Deck design studio ---- */
  var studio = $("[data-studio]");
  if (studio) {
    studio.classList.add("is-live");
    function setAria(btn, on) { btn.setAttribute("aria-checked", String(on)); btn.parentNode.classList.toggle("is-on", on); }
    $$("button[data-g=rail]", studio).forEach(function (b) {
      b.addEventListener("click", function () { studio.setAttribute("data-rail", b.getAttribute("data-v")); $$("button[data-g=rail]", studio).forEach(function (x) { setAria(x, x === b); }); });
    });
    $$("button[data-g=extra]", studio).forEach(function (b) {
      b.addEventListener("click", function () { var k = b.getAttribute("data-v"), on = b.getAttribute("aria-checked") !== "true"; studio.setAttribute("data-" + k, on ? "1" : "0"); setAria(b, on); if (k === "light" && on) { studio.setAttribute("data-night", "1"); syncTime(); } });
    });
    var timeBtns = $$("[data-time]", studio);
    function syncTime() { var n = studio.getAttribute("data-night") === "1"; timeBtns.forEach(function (t) { t.setAttribute("aria-pressed", String((t.getAttribute("data-time") === "night") === n)); }); }
    timeBtns.forEach(function (t) { t.addEventListener("click", function () { studio.setAttribute("data-night", t.getAttribute("data-time") === "night" ? "1" : "0"); syncTime(); }); });
  }

  /* ---- Timeline progress ---- */
  var tl = $(".tl");
  if (tl) {
    var steps = $$(".tl__s", tl), tick = false;
    function upd() {
      tick = false; var r = tl.getBoundingClientRect(), vh = window.innerHeight, mark = vh * 0.58;
      tl.style.setProperty("--p", clamp((mark - r.top) / r.height, 0, 1).toFixed(3));
      steps.forEach(function (s) { s.classList.toggle("is-on", s.getBoundingClientRect().top < mark); });
    }
    window.addEventListener("scroll", function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
    window.addEventListener("resize", upd); upd();
  }

  /* ---- Detail cards reveal ---- */
  var cards = $$(".dcard");
  if (cards.length) {
    if (motion && "IntersectionObserver" in window) { var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.2 }); cards.forEach(function (c) { io.observe(c); }); }
    else cards.forEach(function (c) { c.classList.add("in"); });
  }

  /* ---- Sub-navigation: highlight the section in view ---- */
  var links = $$(".subnav a[href^='#']");
  if (links.length && "IntersectionObserver" in window) {
    var map = {}; links.forEach(function (a) { map[a.getAttribute("href").slice(1)] = a; });
    var vis = {};
    var so = new IntersectionObserver(function (es) {
      es.forEach(function (e) { vis[e.target.id] = e.isIntersecting ? e.intersectionRatio : 0; });
      var top = null, v = 0; Object.keys(vis).forEach(function (k) { if (vis[k] > v) { v = vis[k]; top = k; } });
      links.forEach(function (a) { a.setAttribute("aria-current", String(top && map[top] === a)); });
      var cur = top && map[top]; if (cur && cur.scrollIntoView && cur.parentNode.scrollWidth > cur.parentNode.clientWidth) cur.parentNode.scrollTo({ left: cur.offsetLeft - 24, behavior: "smooth" });
    }, { rootMargin: "-30% 0px -55% 0px", threshold: [0, .05, .2] });
    Object.keys(map).forEach(function (id) { var s = document.getElementById(id); if (s) so.observe(s); });
  }
})();
