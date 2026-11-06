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
  var h1 = $(".hero h1, .c-hero h1");
  if (h1 && motion) {
    var label = h1.textContent.trim(), n = 0;
    h1.setAttribute("aria-label", label);
    (function wrap(node) {
      [].slice.call(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (w) {
            if (!w) return;
            if (/^\s+$/.test(w)) { frag.appendChild(document.createTextNode(" ")); return; }
            var o = document.createElement("span"), i = document.createElement("span");
            o.className = "w"; o.setAttribute("aria-hidden", "true"); i.style.setProperty("--i", n++); i.textContent = w; o.appendChild(i); frag.appendChild(o);
          });
          node.replaceChild(frag, c);
        } else if (c.nodeType === 1) wrap(c);
      });
    })(h1);
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
    var box = $(".hero__grid .ph, .c-hero__bg");
    if (box && motion) {
      var sl = document.createElement("div"); sl.className = "slats"; sl.setAttribute("aria-hidden", "true");
      for (var i = 0; i < 12; i++) { var s = document.createElement("span"); s.className = "slat"; s.style.setProperty("--i", i); sl.appendChild(s); }
      box.appendChild(sl);
      setTimeout(function () { sl.remove(); }, 2600);
    }
    estimator();
  }
  if (slug === "landscaping") dusk();
  if (slug === "renovations") tour();
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
      a += '<path d="M0 ' + ground + 'H600" stroke="currentColor" stroke-width="1.5" fill="none"/>';
      if (type === "deck") {
        var bays = clamp(Math.round(area / 90), 2, 7), w = 420 + (area - 80) / 520 * 150, x0 = (W - w) / 2, step = w / bays, top = 98;
        a += '<path d="M' + x0 + " " + top + "H" + (x0 + w) + "V" + (top + 14) + "H" + x0 + 'Z" stroke="currentColor" fill="none" stroke-width="1.6"/>';
        for (var i = 0; i <= bays; i++) a += '<path d="M' + (x0 + i * step - 4) + " " + (top + 14) + "V" + ground + 'h8V' + (top + 14) + '" stroke="currentColor" fill="none" stroke-opacity=".75"/>';
        if (extra) for (var j = 0; j <= bays; j++) { var px = x0 + j * step; a += '<path d="M' + px + " " + top + "V" + (top - 46) + '" stroke="currentColor" fill="none" stroke-width="1.6"/>'; if (j < bays) a += '<path d="M' + px + " " + (top - 46) + "H" + (px + step) + "M" + px + " " + (top - 6) + "H" + (px + step) + '" stroke="currentColor" fill="none" stroke-opacity=".8"/><path d="M' + (px + 14) + " " + (top - 6) + "L" + (px + 38) + " " + (top - 40) + '" stroke="currentColor" fill="none" stroke-opacity=".3"/>'; }
      } else {
        var bay = clamp(Math.round(len / 16), 2, 12), w2 = 380 + (len - 20) / 180 * 190, x1 = (W - w2) / 2, st = w2 / bay, h = tall === 6 ? 90 : 60, t = ground - h;
        for (var k = 0; k <= bay; k++) a += '<path d="M' + (x1 + k * st - 3) + " " + (t - 8) + "V" + (ground + 12) + 'h6V' + (t - 8) + 'Z" stroke="currentColor" fill="none" stroke-width="1.5"/>';
        for (var m = 0; m < bay; m++) {
          var bx = x1 + m * st + 4, bw = st - 8;
          if (type === "cedar") { for (var q = 0; q < Math.floor(bw / 8); q++) a += '<path d="M' + (bx + q * 8) + " " + t + "V" + ground + '" stroke="currentColor" stroke-opacity=".55" fill="none"/>'; a += '<path d="M' + bx + " " + (t + 14) + "h" + bw + "M" + bx + " " + (ground - 14) + "h" + bw + '" stroke="currentColor" stroke-opacity=".9" fill="none"/>'; }
          else { for (var q2 = 0; q2 < Math.floor(bw / 10); q2++) a += '<path d="M' + (bx + 3 + q2 * 10) + " " + (t + 4) + "V" + (ground - 4) + '" stroke="currentColor" stroke-opacity=".6" fill="none"/>'; a += '<path d="M' + bx + " " + (t + 4) + "h" + bw + "M" + bx + " " + (ground - 4) + "h" + bw + '" stroke="currentColor" fill="none"/>'; }
        }
        if (extra) { var gx = x1 + st * Math.floor(bay / 2); a += '<path d="M' + gx + " " + (t + 6) + "h" + st + "V" + ground + "H" + gx + 'Z" stroke="currentColor" stroke-width="2.4" fill="none"/>'; }
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

  /* ---- Landscaping: afternoon to dusk, on the real patio photo ---- */
  function dusk() {
    var root = $("#evenings .dusk"); if (!root) return;
    var range = $(".dusk__range", root), tagB = $(".dusk__tag b", root), tagS = $(".dusk__tag span", root), stops = $$(".dusk__scale span", root);
    var COPY = [["Afternoon", "Bright and open. This is the yard you see when you plan it."], ["Golden hour", "Warm light on stone and timber. Planting and texture do the work."], ["Dusk", "Low-voltage lighting takes over: paths, walls and seating, all on a timer."]];
    function set(v) {
      var d = clamp(v / 100, 0, 1), i = d < 0.34 ? 0 : d < 0.72 ? 1 : 2;
      root.style.setProperty("--d", d.toFixed(3)); range.value = v;
      tagB.textContent = COPY[i][0]; tagS.textContent = COPY[i][1];
      stops.forEach(function (s, k) { s.style.opacity = k === i ? 1 : .45; });
    }
    var user = false, raf;
    range.addEventListener("input", function () { user = true; cancelAnimationFrame(raf); set(+range.value); });
    set(0);
    if (motion) seen($(".dusk__stage", root), function () {
      var t0 = performance.now(), dur = 5200;
      (function f(now) { if (user) return; var k = clamp((now - t0) / dur, 0, 1); k = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; set(k * 100); if (k < 1) raf = requestAnimationFrame(f); })(t0);
    });
  }

  /* ---- Renovations: hotspot tour of the finished rooms ---- */
  function tour() {
    var root = $("#inside"); if (!root) return;
    var ROOMS = {
      kitchen: { src: "hero.jpg", alt: "A finished open-plan kitchen with a waterfall quartz island", facts: [["6 weeks", "Timeline"], ["Open-plan, new layout", "Scope"], ["Fixed price", "Contract"]], spots: [
        [62, 66, "Waterfall quartz island", "Full-height waterfall edges hide the seams and take daily life in their stride. Templated on site for a tight fit."],
        [55, 15, "Layered lighting", "Pendants on a dimmer, plus recessed pot lights, so every task has the right light and the room has a mood."],
        [66, 38, "Herringbone backsplash", "A tile feature behind the range, with a pot filler where you actually cook."],
        [12, 80, "Wide-plank flooring", "Waterproof plank runs through the whole open plan for one calm, continuous floor."]] },
      bathroom: { src: "project-2.jpg", alt: "A finished bathroom with a walk-in glass shower", facts: [["3 weeks", "Timeline"], ["Curbless walk-in shower", "Scope"], ["Waterproofed to code", "Detail"]], spots: [
        [41, 50, "Frameless glass", "10 mm tempered glass with black hardware keeps the room open and easy to clean."],
        [52, 10, "Rain shower", "A ceiling rain head plus handheld on a slide bar, on a thermostatic valve."],
        [64, 42, "Recessed niche", "Framed and waterproofed before the tile goes on, in place of clutter-catching shelves."],
        [66, 88, "Linear drain", "Curbless entry with a linear drain: no threshold, and a floor that slopes properly."]] },
      basement: { src: "project-3.jpg", alt: "A finished basement living room", facts: [["8 weeks", "Timeline"], ["Family room and bath", "Scope"], ["Permitted and inspected", "Process"]], spots: [
        [87, 32, "Egress window", "A code-compliant egress window and proper well make a legal bedroom or rec room."],
        [77, 16, "Recessed lighting", "Slim LED pot lights keep a low ceiling feeling taller and brighter."],
        [13, 62, "Feature fireplace", "An electric fireplace wall gives the room a focal point with no chimney or gas permit."],
        [22, 88, "Warm, dry floors", "Moisture-rated plank over a dimpled membrane, so the floor stays warm and dry."]] }
    };
    var tabs = $$("[data-room]", root), stage = $(".tour__stage", root), img = $("img", stage), hots = $(".tour__hots", stage), card = $(".tour__card", stage), facts = $(".tour__facts", root);
    var key, spots = [], cur = 0, user = false, timer;
    function show(i) {
      cur = i; var s = ROOMS[key].spots[i];
      $$(".hot", hots).forEach(function (h, k) { h.setAttribute("aria-pressed", String(k === i)); });
      $("small", card).textContent = "Detail " + (i + 1) + " of " + ROOMS[key].spots.length; $("b", card).textContent = s[2]; $("p", card).textContent = s[3];
      card.style.animation = "none"; void card.offsetWidth; card.style.animation = "";
    }
    function room(k) {
      key = k; var r = ROOMS[k]; clearTimeout(timer);
      img.src = "../assets/img/demos/renovations/" + r.src; img.alt = r.alt;
      hots.textContent = "";
      r.spots.forEach(function (s, i) {
        var b = document.createElement("button"); b.type = "button"; b.className = "hot"; b.style.setProperty("--x", s[0] + "%"); b.style.setProperty("--y", s[1] + "%");
        b.setAttribute("aria-label", s[2]); b.textContent = String(i + 1); b.addEventListener("click", function () { user = true; clearTimeout(timer); show(i); }); hots.appendChild(b);
      });
      facts.textContent = ""; r.facts.forEach(function (f) { var li = document.createElement("li"), b = document.createElement("b"), sp = document.createElement("span"); b.textContent = f[0]; sp.textContent = f[1]; li.appendChild(b); li.appendChild(sp); facts.appendChild(li); });
      tabs.forEach(function (t) { t.setAttribute("aria-selected", String(t.getAttribute("data-room") === k)); });
      show(0);
    }
    tabs.forEach(function (t) { t.addEventListener("click", function () { user = true; room(t.getAttribute("data-room")); }); });
    room("kitchen");
    if (motion) seen(stage, function () {
      (function next() { if (user) return; timer = setTimeout(function () { if (user) return; var n = cur + 1; if (n < ROOMS[key].spots.length) { show(n); next(); } }, 3400); })();
    });
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
