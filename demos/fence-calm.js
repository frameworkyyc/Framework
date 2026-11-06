// Fence & Decks: calm homepage motion, plus the optional Explore panels (materials, fence styles, studio, estimator, answers). Content is real HTML first.
(function () {
  var doc = document.documentElement;
  var motion = doc.classList.contains("motion");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  var vh = function () { return window.innerHeight || doc.clientHeight; };
  var small = function () { return window.innerWidth < 900; };

  /* ---- Header: transparent over the hero, solid after ---- */
  var head = $(".site-head");
  if (head) { var hs = function () { head.classList.toggle("is-solid", window.scrollY > 48); }; window.addEventListener("scroll", hs, { passive: true }); hs(); }

  /* ---- Reveals and image curtains ---- */
  var rv = $$(".c-rv, .c-img");
  if (motion && "IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.14, rootMargin: "0px 0px -6% 0px" });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add("in"); });

  /* ---- Depth: photos drift slower than the page ---- */
  var px = $$("[data-px]").map(function (el) { return { el: el, amp: parseFloat(el.getAttribute("data-px")) || 30, frame: el.parentNode, on: true }; });
  if (motion && px.length) {
    if ("IntersectionObserver" in window) {
      var po = new IntersectionObserver(function (es) { es.forEach(function (e) { px.forEach(function (p) { if (p.frame === e.target) p.on = e.isIntersecting; }); }); }, { rootMargin: "200px 0px" });
      px.forEach(function (p) { p.on = false; po.observe(p.frame); });
    }
    var tick = false;
    var upd = function () {
      tick = false; var h = vh(), k = small() ? 0.55 : 1;
      px.forEach(function (p) {
        if (!p.on) return; var r = p.frame.getBoundingClientRect();
        var t = (h / 2 - (r.top + r.height / 2)) / (h / 2 + r.height / 2);
        p.el.style.setProperty("--py", (clamp(t, -1, 1) * p.amp * k).toFixed(1) + "px");
      });
    };
    var req = function () { if (!tick) { tick = true; requestAnimationFrame(upd); } };
    window.addEventListener("scroll", req, { passive: true }); window.addEventListener("resize", req); setTimeout(req, 60);
  }

  /* ---- Explorers: materials and fence styles ---- */
  var xps = $$("[data-xp]"), reg = {};
  xps.forEach(function (root, n) {
    root.classList.add("is-live");
    var items = $$(".xi", root), panes = $$(".xp__pane", root), stage = $(".xp__stage", root);
    function open(id, userClick) {
      items.forEach(function (it) { var on = it.getAttribute("data-i") === id; it.classList.toggle("is-open", on); var b = $(".xi__h button", it); if (b) b.setAttribute("aria-expanded", String(on)); });
      panes.forEach(function (p) { p.hidden = p.getAttribute("data-p") !== id; });
      if (userClick && small() && stage) { requestAnimationFrame(function () { var it = items.filter(function (x) { return x.getAttribute("data-i") === id; })[0], b = it && $(".xi__h button", it), sc = it && it.closest(".pn__body"); if (!b || !sc) return; var sb = stage.getBoundingClientRect().bottom, r = b.getBoundingClientRect(); if (r.top < sb + 8) sc.scrollBy({ top: r.top - sb - 14, behavior: "smooth" }); }); }
    }
    items.forEach(function (it, i) {
      var b = $(".xi__h button", it);
      b.addEventListener("click", function () { open(it.getAttribute("data-i"), true); });
      b.addEventListener("keydown", function (e) { var d = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0; if (!d) return; e.preventDefault(); var nb = $(".xi__h button", items[(i + d + items.length) % items.length]); nb.focus(); });
    });
    reg[n] = { open: open, root: root };
  });

  /* ---- Find my match ---- */
  var finder = $("[data-finder]"), matXp = $("#pn-materials [data-xp]");
  if (finder && matXp) {
    var MAT = {
      pt: { cost: 1, up: 4, life: 2, nat: 3, name: "Pressure-treated pine", why: "It keeps the budget lean and is easy to repair, as long as you are happy to seal it regularly." },
      cedar: { cost: 2, up: 3, life: 3, nat: 5, name: "Western red cedar", why: "You get warm, natural colour for a modest premium, with a stain-and-seal routine to keep it that way." },
      composite: { cost: 3, up: 1, life: 4, nat: 3, name: "Capped composite", why: "It trades a higher price for almost no upkeep, so weekends go to the deck, not to maintaining it." },
      pvc: { cost: 4, up: 1, life: 5, nat: 2, name: "Cellular PVC", why: "It stays cooler and shrugs off moisture, which suits wet or very sunny spots and a long life." },
      ipe: { cost: 5, up: 3, life: 5, nat: 5, name: "Tropical hardwood", why: "It is the statement choice: dense, dramatic and built to last for decades, if the budget allows." }
    };
    var pick = { budget: "balanced", upkeep: "little", look: "natural" }, out = $(".finder__out", finder), openMat = reg[xps.indexOf(matXp)].open;
    var score = function (m) {
      var s = 0;
      if (pick.budget === "lean") s -= m.cost * 3.5; else if (pick.budget === "balanced") s -= Math.abs(m.cost - 3) * 1.6; else s += (m.life + m.nat) * .5;
      if (pick.upkeep === "little") s -= m.up; else if (pick.upkeep === "none") s -= m.up * 2.6;
      if (pick.look === "natural") s += m.nat * 1.5; else s += (6 - m.nat) * 1.1;
      return s;
    };
    var best = function () { var b = null, bs = -1e9; Object.keys(MAT).forEach(function (k) { var v = score(MAT[k]); if (v > bs) { bs = v; b = k; } }); return b; };
    var show = function (go) {
      var k = best(), m = MAT[k]; out.textContent = "";
      var b = document.createElement("b"); b.textContent = m.name; out.appendChild(b); out.appendChild(document.createTextNode(" is your best match. " + m.why));
      var btn = document.createElement("button"); btn.type = "button"; btn.textContent = "Show me"; btn.addEventListener("click", function () { openMat(k, false); }); out.appendChild(btn);
      if (go) openMat(k, false);
    };
    $$("button[role=radio]", finder).forEach(function (b) {
      b.addEventListener("click", function () { var g = b.getAttribute("data-k"); pick[g] = b.getAttribute("data-v"); $$("button[data-k=" + g + "]", finder).forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); }); show(true); });
    });
    show(false);
  }

  /* ---- Design studio ---- */
  var st = $("[data-studio]");
  if (st) {
    var info = $(".st__info", st), last = $("button[data-g=rail][aria-checked=true]", st);
    var sync = function () { var n = st.getAttribute("data-night") === "1"; $$("[data-time]", st).forEach(function (t) { t.setAttribute("aria-pressed", String((t.getAttribute("data-time") === "night") === n)); }); };
    var showInfo = function (b) {
      var title = b.getAttribute("data-g") === "rail" ? b.getAttribute("data-n") + " railing" : b.getAttribute("data-n");
      info.textContent = "";
      var h = document.createElement("h4"); h.textContent = title; info.appendChild(h);
      [["Why choose it", b.getAttribute("data-b")], ["Trade-off", b.getAttribute("data-t")]].forEach(function (x) { var p = document.createElement("p"), s = document.createElement("span"); s.textContent = x[0]; p.appendChild(s); p.appendChild(document.createTextNode(x[1])); info.appendChild(p); });
      var c = document.createElement("p"); c.className = "st__cost"; c.textContent = b.getAttribute("data-c"); info.appendChild(c);
      info.classList.remove("is-swap"); void info.offsetWidth; info.classList.add("is-swap");
    };
    $$("button[data-g=rail]", st).forEach(function (b) { b.addEventListener("click", function () { st.setAttribute("data-rail", b.getAttribute("data-v")); $$("button[data-g=rail]", st).forEach(function (x) { x.setAttribute("aria-checked", String(x === b)); }); showInfo(b); }); });
    $$("button[data-g=extra]", st).forEach(function (b) {
      b.addEventListener("click", function () { var k = b.getAttribute("data-v"), on = b.getAttribute("aria-checked") !== "true"; st.setAttribute("data-" + k, on ? "1" : "0"); b.setAttribute("aria-checked", String(on)); showInfo(b); if (k === "light" && on && st.getAttribute("data-night") !== "1") { st.setAttribute("data-night", "1"); sync(); } });
    });
    $$("[data-time]", st).forEach(function (t) { t.addEventListener("click", function () { st.setAttribute("data-night", t.getAttribute("data-time") === "night" ? "1" : "0"); sync(); }); });
    sync();
  }

  /* ---- Explore panels ---- */
  var openPn = null, lastFocus = null;
  function focusables(root) { return $$("a[href],button:not([disabled]),input:not([disabled]),select,textarea,summary,[tabindex]:not([tabindex='-1'])", root).filter(function (e) { return e.offsetParent !== null || e === document.activeElement; }); }
  function openPanel(id, fromHash) {
    var el = document.getElementById("pn-" + id); if (!el) return;
    if (openPn && openPn !== el) closePanel(true);
    lastFocus = document.activeElement; openPn = el;
    el.hidden = false; void el.offsetWidth; el.classList.add("is-in");
    doc.classList.add("pn-open");
    var body = $(".pn__body", el); if (body) body.scrollTop = 0;
    setTimeout(function () { var x = $("[data-pn-close]", el); if (x) x.focus({ preventScroll: true }); }, 60);
    if (!fromHash && history.replaceState) history.replaceState(null, "", "#explore-" + id);
    window.dispatchEvent(new Event("resize"));
  }
  function closePanel(quiet) {
    if (!openPn) return; var el = openPn; openPn = null; el.classList.remove("is-in");
    var done = function () { el.hidden = true; }; if (motion) setTimeout(done, 520); else done();
    doc.classList.remove("pn-open");
    if (!quiet) { if (history.replaceState) history.replaceState(null, "", location.pathname + location.search); if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true }); }
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest("[data-pn]");
    if (t) { e.preventDefault(); openPanel(t.getAttribute("data-pn")); return; }
    if (e.target.closest("[data-pn-close]")) { closePanel(); return; }
    var a = openPn && e.target.closest("a[href^='#']");
    if (a && !a.hasAttribute("data-pn")) { var id = a.getAttribute("href").slice(1); closePanel(true); var dest = id && document.getElementById(id); if (dest) { e.preventDefault(); setTimeout(function () { dest.scrollIntoView({ behavior: motion ? "smooth" : "auto" }); }, 60); } }
  });
  document.addEventListener("keydown", function (e) {
    if (!openPn) return;
    if (e.key === "Escape") { e.preventDefault(); closePanel(); return; }
    if (e.key !== "Tab") return;
    var f = focusables(openPn); if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  function fromHash() { var m = /^#explore-([a-z]+)$/.exec(location.hash); if (m && document.getElementById("pn-" + m[1])) openPanel(m[1], true); else if (openPn) closePanel(true); }
  window.addEventListener("hashchange", fromHash); fromHash();
})();
