// Framework demo websites — each trade's signature moment. Runs after demo.js and motion.js; the page's data-demo picks the behaviour.
// Everything here is progressive: without it (or with reduced motion) the pages show the finished state.
(function () {
  var slug = document.body.getAttribute("data-demo");
  var motion = document.documentElement.classList.contains("motion");
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function money(n) { return "$" + (Math.round(n / 100) * 100).toLocaleString("en-CA"); }
  function seen(el, cb, margin) { if (!("IntersectionObserver" in window)) { cb(); return; } var io = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { io.disconnect(); cb(); } }, { threshold: 0.35, rootMargin: margin || "0px" }); io.observe(el); }

  /* ---- Opening: headline words, one animation style per trade ---- */
  var h1 = $(".hero h1");
  if (h1 && motion) {
    var label = h1.textContent.trim(), n = 0;
    h1.setAttribute("aria-label", label);
    h1.innerHTML = label.split(/\s+/).map(function (w) { return '<span class="w" aria-hidden="true"><span style="--i:' + (n++) + '">' + w.replace(/[<>&]/g, "") + "</span></span>"; }).join(" ");
    h1.classList.add("is-split");
    var kind = { "fence-deck": ["wordup", ".8s"], landscaping: ["wordblur", "1.3s"], renovations: ["wordmask", "1.2s"], "general-contractor": ["wordslam", ".7s"] }[slug];
    if (kind) { h1.style.setProperty("--wk", kind[0]); h1.style.setProperty("--wd", kind[1]); }
  }

  // Arrow keys move between the tabs in any tab group on the page.
  $$("[role=tablist]").forEach(function (list) {
    list.addEventListener("keydown", function (e) {
      var n = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0; if (!n) return;
      var tabs = $$("[role=tab]", list), i = tabs.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); var t = tabs[(i + n + tabs.length) % tabs.length]; t.focus(); t.click();
    });
  });

  if (slug === "fence-deck") {
    var box = $(".hero__grid .ph");
    if (box && motion) {
      var sl = document.createElement("div"); sl.className = "slats"; sl.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 12; i++) { var s = document.createElement("span"); s.className = "slat"; s.style.setProperty("--i", i); sl.appendChild(s); }
      box.appendChild(sl);
      setTimeout(function () { sl.remove(); }, 2600);
    }
    estimator();
  }
  if (slug === "landscaping") seasons();
  if (slug === "renovations") beforeAfter();
  if (slug === "general-contractor") tracker();

  /* ---- Fence & Decks: ballpark estimator with a live line drawing ---- */
  function estimator() {
    var root = $("#estimate"); if (!root) return;
    var type = "cedar", len = 120, area = 300, tall = 6, extra = false;
    var types = $$("[data-type]", root), sizeIn = $("[data-size]", root), sizeOut = $("[data-size-out]", root), sizeLab = $("[data-size-label]", root);
    var heightRow = $("[data-height-row]", root), tallBtns = $$("[data-tall]", root), extraIn = $("[data-extra]", root), extraLab = $("[data-extra-label]", root);
    var price = $("[data-price]", root), svg = $("[data-draw]", root), go = $("[data-est-go]", root), sumEl = $("[data-sum]", root);
    var RATE = { cedar: { 4: [48, 64], 6: [62, 82] }, aluminum: { 4: [95, 125], 6: [120, 155] } };
    function calc() {
      var lo, hi, what;
      if (type === "deck") {
        lo = 68 * area; hi = 96 * area; what = "Composite deck, " + area + " sq ft";
        if (extra) { var lf = 2.4 * Math.sqrt(area); lo += 210 * lf; hi += 280 * lf; what += " with glass railing"; }
      } else {
        var r = RATE[type][tall]; lo = r[0] * len; hi = r[1] * len;
        what = (type === "cedar" ? "Cedar fence" : "Aluminum fence") + ", " + len + " ft, " + tall + " ft high";
        if (extra) { lo += 450; hi += 700; what += " with a gate"; }
      }
      return { lo: lo, hi: hi, what: what };
    }
    function draw() {
      var a = "", ground = 170, W = 600;
      a += '<path d="M0 ' + ground + 'H600" stroke="#fff" stroke-width="1.5" fill="none"/>';
      if (type === "deck") {
        var bays = clamp(Math.round(area / 90), 2, 7), w = 420 + (area - 80) / 520 * 150, x0 = (W - w) / 2, step = w / bays, top = 98;
        a += '<path d="M' + x0 + " " + top + "H" + (x0 + w) + "V" + (top + 14) + "H" + x0 + 'Z" stroke="#fff" fill="none" stroke-width="1.6"/>';
        for (var i = 0; i <= bays; i++) a += '<path d="M' + (x0 + i * step - 4) + " " + (top + 14) + "V" + ground + 'h8V' + (top + 14) + '" stroke="#fff" fill="none" stroke-opacity=".75"/>';
        if (extra) for (var j = 0; j <= bays; j++) { var px = x0 + j * step; a += '<path d="M' + px + " " + top + "V" + (top - 46) + '" stroke="#fff" fill="none" stroke-width="1.6"/>'; if (j < bays) a += '<path d="M' + px + " " + (top - 46) + "H" + (px + step) + "M" + px + " " + (top - 6) + "H" + (px + step) + '" stroke="#fff" fill="none" stroke-opacity=".8"/><path d="M' + (px + 14) + " " + (top - 6) + "L" + (px + 38) + " " + (top - 40) + '" stroke="#fff" fill="none" stroke-opacity=".3"/>'; }
      } else {
        var bay = clamp(Math.round(len / 16), 2, 12), w2 = 380 + (len - 20) / 180 * 190, x1 = (W - w2) / 2, st = w2 / bay, h = tall === 6 ? 90 : 60, t = ground - h;
        for (var k = 0; k <= bay; k++) a += '<path d="M' + (x1 + k * st - 3) + " " + (t - 8) + "V" + (ground + 12) + 'h6V' + (t - 8) + 'Z" stroke="#fff" fill="none" stroke-width="1.5"/>';
        for (var m = 0; m < bay; m++) {
          var bx = x1 + m * st + 4, bw = st - 8;
          if (type === "cedar") { for (var q = 0; q < Math.floor(bw / 8); q++) a += '<path d="M' + (bx + q * 8) + " " + t + "V" + ground + '" stroke="#fff" stroke-opacity=".55" fill="none"/>'; a += '<path d="M' + bx + " " + (t + 14) + "h" + bw + "M" + bx + " " + (ground - 14) + "h" + bw + '" stroke="#fff" stroke-opacity=".9" fill="none"/>'; }
          else { for (var q2 = 0; q2 < Math.floor(bw / 10); q2++) a += '<path d="M' + (bx + 3 + q2 * 10) + " " + (t + 4) + "V" + (ground - 4) + '" stroke="#fff" stroke-opacity=".6" fill="none"/>'; a += '<path d="M' + bx + " " + (t + 4) + "h" + bw + "M" + bx + " " + (ground - 4) + "h" + bw + '" stroke="#fff" fill="none"/>'; }
        }
        if (extra) { var gx = x1 + st * Math.floor(bay / 2); a += '<path d="M' + gx + " " + (t + 6) + "h" + st + "V" + ground + "H" + gx + 'Z" stroke="#fff" stroke-width="2.4" fill="none"/>'; }
      }
      svg.innerHTML = a;
    }
    var shown = [0, 0], raf;
    function render() {
      var c = calc(), target = [c.lo, c.hi], from = shown.slice(), t0 = performance.now();
      cancelAnimationFrame(raf);
      (function tick(now) { var k = clamp((now - t0) / (motion ? 380 : 1), 0, 1); k = 1 - Math.pow(1 - k, 3); shown = [from[0] + (target[0] - from[0]) * k, from[1] + (target[1] - from[1]) * k]; price.textContent = money(shown[0]) + " – " + money(shown[1]); if (k < 1) raf = requestAnimationFrame(tick); })(t0);
      sumEl.textContent = c.what; draw();
    }
    function sync() {
      var deck = type === "deck";
      sizeIn.min = deck ? 80 : 20; sizeIn.max = deck ? 600 : 200; sizeIn.step = deck ? 10 : 5; sizeIn.value = deck ? area : len;
      sizeOut.textContent = deck ? area + " sq ft" : len + " ft"; sizeLab.textContent = deck ? "Deck size" : "Fence length";
      heightRow.hidden = deck; extraLab.textContent = deck ? "Add glass railing" : "Include a gate";
      types.forEach(function (b) { b.setAttribute("aria-checked", String(b.getAttribute("data-type") === type)); });
      tallBtns.forEach(function (b) { b.setAttribute("aria-checked", String(+b.getAttribute("data-tall") === tall)); });
    }
    types.forEach(function (b) { b.addEventListener("click", function () { type = b.getAttribute("data-type"); extra = false; extraIn.checked = false; sync(); render(); }); });
    tallBtns.forEach(function (b) { b.addEventListener("click", function () { tall = +b.getAttribute("data-tall"); sync(); render(); }); });
    sizeIn.addEventListener("input", function () { if (type === "deck") area = +sizeIn.value; else len = +sizeIn.value; sizeOut.textContent = type === "deck" ? area + " sq ft" : len + " ft"; render(); });
    extraIn.addEventListener("change", function () { extra = extraIn.checked; render(); });
    go.addEventListener("click", function () {
      var c = calc(), sel = $("select[name=type]"), det = $("textarea[name=details]");
      if (sel) sel.value = type === "deck" ? "New deck" : "New fence";
      if (det) det.value = "Ballpark from the estimator: " + c.what + ", about " + money(c.lo) + " to " + money(c.hi) + ".";
    });
    sync(); render();
  }

  /* ---- Landscaping: four seasons with weather ---- */
  function seasons() {
    var stage = $("#seasons .seasons__stage"); if (!stage) return;
    var tabs = $$(".seasons__tabs button"), tagB = $(".seasons__tag b", stage), tagS = $(".seasons__tag span", stage), cv = $("canvas", stage), ctx = cv.getContext("2d");
    var INFO = { spring: ["Spring: wake-up", "Perennials emerge, beds are edged and mulched, and new sod goes down."], summer: ["Summer: the payoff", "Patio season. Evening lighting, lush beds and a lawn that stays green."], autumn: ["Autumn: tuck it in", "Bulbs planted, lawns aerated and hardy shrubs set before the freeze."], winter: ["Winter: built to last", "Drainage, hardy evergreens and wall caps designed for Calgary's freeze-thaw."] };
    var order = ["spring", "summer", "autumn", "winter"], cur = "summer", auto = true, timer, parts = [], W = 0, H = 0, run = false, raf;
    function size() { var r = stage.getBoundingClientRect(), d = Math.min(window.devicePixelRatio || 1, 1.5); W = r.width; H = r.height; cv.width = W * d; cv.height = H * d; ctx.setTransform(d, 0, 0, d, 0, 0); }
    function spawn(first) {
      var p = { x: Math.random() * W, y: first ? Math.random() * H : -20, r: 1 + Math.random() * 2.6, v: .5 + Math.random() * 1.1, s: Math.random() * 6.28, a: .5 + Math.random() * .5 };
      if (cur === "summer") { p.y = Math.random() * H; p.v = .12 + Math.random() * .25; p.r = 1 + Math.random() * 1.8; }
      if (cur === "autumn") { p.r = 4 + Math.random() * 5; p.v = .9 + Math.random() * 1.1; }
      if (cur === "spring") { p.r = 3 + Math.random() * 3; p.v = .6 + Math.random() * .8; }
      return p;
    }
    function fill() { var n = Math.round(W * H / (cur === "winter" ? 5200 : 9000)); parts = []; for (var i = 0; i < n; i++) parts.push(spawn(true)); }
    function step(t) {
      if (!run) return; ctx.clearRect(0, 0, W, H);
      parts.forEach(function (p, i) {
        p.s += .02; var sway = Math.sin(p.s) * (cur === "winter" ? .6 : 1.2);
        if (cur === "summer") { p.x += sway * .3; p.y -= p.v * .4; p.a = .35 + .45 * Math.abs(Math.sin(p.s)); } else { p.x += sway + (cur === "autumn" ? .6 : .2); p.y += p.v; }
        if (p.y > H + 20 || p.y < -30 || p.x > W + 30) parts[i] = spawn(false);
        ctx.globalAlpha = p.a;
        if (cur === "winter") { ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); }
        else if (cur === "summer") { ctx.fillStyle = "#FFE9A8"; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.28); ctx.fill(); }
        else { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.s); ctx.fillStyle = cur === "autumn" ? (i % 3 ? "#D9701E" : "#B8421A") : "#FFC9DA"; ctx.beginPath(); ctx.ellipse(0, 0, p.r, p.r * .55, 0, 0, 6.28); ctx.fill(); ctx.restore(); }
      });
      ctx.globalAlpha = 1; raf = requestAnimationFrame(step);
    }
    function pick(s, byUser) {
      cur = s; stage.setAttribute("data-season", s);
      tabs.forEach(function (b) { var on = b.getAttribute("data-season") === s; b.setAttribute("aria-selected", String(on)); b.classList.toggle("is-auto", on && !byUser && auto); });
      tagB.textContent = INFO[s][0]; tagS.textContent = INFO[s][1];
      fill();
    }
    tabs.forEach(function (b) { b.addEventListener("click", function () { auto = false; clearTimeout(timer); pick(b.getAttribute("data-season"), true); }); });
    function cycle() { if (!auto) return; timer = setTimeout(function () { pick(order[(order.indexOf(cur) + 1) % 4], false); cycle(); }, 6000); }
    var reduce = !motion;
    size(); pick("summer", true);
    window.addEventListener("resize", function () { size(); fill(); });
    if ("IntersectionObserver" in window) new IntersectionObserver(function (es) {
      var v = es[0].isIntersecting;
      if (v && !run && !reduce) { run = true; raf = requestAnimationFrame(step); if (auto) { pick("spring", false); cycle(); } }
      if (!v) { run = false; cancelAnimationFrame(raf); clearTimeout(timer); }
    }, { threshold: 0.3 }).observe(stage);
  }

  /* ---- Renovations: before / after reveal ---- */
  function beforeAfter() {
    var root = $("#transformations"); if (!root) return;
    var stage = $(".ba__stage", root), range = $(".ba__range", root), imgs = $$("img", stage), tabs = $$("[data-ba]", root), facts = $$(".ba__facts b", root);
    var SETS = {
      kitchen: ["project-1", "6 weeks", "Full gut, new layout", "Custom white oak"],
      bathroom: ["project-2", "3 weeks", "Walk-in glass shower", "Large-format tile"],
      basement: ["project-3", "8 weeks", "Family room and bath", "Egress window added"],
      powder: ["project-5", "10 days", "Powder room refresh", "Feature wallpaper"]
    };
    function setPos(v) { stage.style.setProperty("--pos", v + "%"); range.value = v; range.setAttribute("aria-valuetext", Math.round(v) + "% of the photo shows before"); }
    function show(key) {
      var s = SETS[key], src = "../assets/img/demos/renovations/" + s[0] + ".jpg";
      imgs.forEach(function (i) { i.src = src; });
      tabs.forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-ba") === key)); });
      facts[0].textContent = s[1]; facts[1].textContent = s[2]; facts[2].textContent = s[3];
    }
    tabs.forEach(function (b) { b.addEventListener("click", function () { show(b.getAttribute("data-ba")); setPos(50); }); });
    range.addEventListener("input", function () { stopDemo = true; setPos(+range.value); });
    var stopDemo = false;
    if (motion) seen(stage, function () {
      var t0 = performance.now(), path = [[0, 50], [900, 12], [1900, 88], [2700, 50]];
      (function f(now) {
        if (stopDemo) return; var t = now - t0, i = 0; while (i < path.length - 2 && t > path[i + 1][0]) i++;
        var a = path[i], b = path[i + 1], k = clamp((t - a[0]) / (b[0] - a[0]), 0, 1); k = k * k * (3 - 2 * k);
        setPos(a[1] + (b[1] - a[1]) * k); if (t < 2700) requestAnimationFrame(f);
      })(t0);
    });
    show("kitchen"); setPos(50);
  }

  /* ---- General Contractor: scrub a live project schedule ---- */
  function tracker() {
    var root = $("#tracker"); if (!root) return;
    var P = {
      addition: { name: "Elbow Park rear addition", meta: "1,150 sq ft · 22 weeks", weeks: 22, budget: 412000,
        phases: [["Permits & design", 0, 3], ["Foundation", 3, 6], ["Framing", 6, 11], ["Roof & envelope", 11, 14], ["Mechanical & electrical", 14, 17], ["Finishes", 17, 21], ["Walkthrough", 21, 22]],
        photos: [[0, "project-2", "Before"], [3, "project-3", "On site"], [11, "project-1", "Envelope closed"], [21, "project-1", "Complete"]], checks: [["Permit issued", 3], ["Foundation inspection", 6], ["Framing inspection", 11], ["Insulation inspection", 16], ["Final occupancy", 22]] },
      fitout: { name: "Kensington café fit-out", meta: "2,400 sq ft · 12 weeks", weeks: 12, budget: 268000,
        phases: [["Permits & design", 0, 2], ["Demo & rough-in", 2, 4], ["Framing & drywall", 4, 6], ["Millwork", 6, 9], ["Finishes & fixtures", 9, 11], ["Handover", 11, 12]],
        photos: [[0, "project-5", "Before"], [4, "project-3", "On site"], [11, "project-4", "Complete"]], checks: [["Permit issued", 2], ["Rough-in inspection", 4], ["Health inspection", 10], ["Final occupancy", 12]] }
    };
    var key = "addition", wk = 12;
    var picks = $$("[data-job]", root), board = $(".trk__main", root), list = $(".trk__phases", root), range = $("[data-week]", root), out = $("[data-week-out]", root), of = $("[data-week-of]", root);
    var title = $("[data-t-name]", root), meta = $("[data-t-meta]", root), chip = $("[data-t-chip]", root), img = $(".trk__photo img", root), cap = $(".trk__photo span", root), spent = $("[data-spent]", root), pct = $("[data-pct]", root), meter = $(".trk__meter i", root), checks = $(".trk__checks", root);
    function build() {
      var j = P[key]; title.textContent = j.name; meta.textContent = j.meta; range.max = j.weeks; of.textContent = "of " + j.weeks;
      list.innerHTML = j.phases.map(function (p) { return "<li><b>" + p[0] + '</b><div class="trk__bar"><i></i></div><small></small></li>'; }).join("");
      checks.innerHTML = j.checks.map(function (c) { return "<li>" + c[0] + "</li>"; }).join("");
      picks.forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-job") === key)); });
      wk = Math.min(wk, j.weeks); range.value = wk; update();
    }
    function update() {
      var j = P[key]; out.textContent = wk;
      $$("li", list).forEach(function (li, i) {
        var p = j.phases[i], f = clamp((wk - p[1]) / (p[2] - p[1]), 0, 1);
        li.firstElementChild.nextElementSibling.firstElementChild.style.setProperty("--f", f);
        li.classList.toggle("is-on", f > 0 && f < 1); li.classList.toggle("is-done", f >= 1);
        li.lastElementChild.textContent = f >= 1 ? "Done" : f > 0 ? Math.round(f * 100) + "%" : "Wk " + (p[1] + 1);
      });
      $$("li", checks).forEach(function (li, i) { li.classList.toggle("is-ok", wk >= j.checks[i][1]); });
      var share = clamp(wk / j.weeks, 0, 1), b = Math.pow(share, 1.12);
      meter.style.setProperty("--b", b); spent.textContent = "$" + (Math.round(j.budget * b / 1000) * 1000).toLocaleString("en-CA"); pct.textContent = Math.round(b * 100) + "% of $" + (j.budget / 1000) + "K invoiced";
      var ph = j.photos[0]; j.photos.forEach(function (x) { if (wk >= x[0]) ph = x; });
      var src = "../assets/img/demos/general-contractor/" + ph[1] + ".jpg"; if (img.getAttribute("src") !== src) img.setAttribute("src", src);
      cap.textContent = ph[2] + " · Week " + wk;
      var cur = j.phases.filter(function (p) { return wk >= p[1] && wk < p[2]; })[0];
      chip.textContent = wk >= j.weeks ? "Complete" : cur ? cur[0] + " in progress" : "On schedule";
    }
    picks.forEach(function (b) { b.addEventListener("click", function () { key = b.getAttribute("data-job"); build(); }); });
    range.addEventListener("input", function () { stop = true; wk = +range.value; update(); });
    var stop = false;
    if (motion) seen(root.querySelector(".trk__board"), function () {
      var t0 = performance.now(), from = 0, to = Math.min(12, P[key].weeks);
      (function f(now) { if (stop) return; var k = clamp((now - t0) / 2400, 0, 1); k = 1 - Math.pow(1 - k, 3); wk = Math.round(from + (to - from) * k); range.value = wk; update(); if (k < 1) requestAnimationFrame(f); })(t0);
    }, "0px");
    wk = 0; build(); if (!motion) { wk = 12; range.value = wk; update(); } else { wk = 0; update(); }
  }
})();
