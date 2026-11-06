// Framework demo landing: choose a discipline, a vibe and a colour, optionally add a company name, and watch the preview update.
// The preview is the real demo website (site.html) in a same-origin iframe, driven through window.FrameworkSite.set(). Nothing is uploaded or saved.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var T = function () { return window.FrameworkTrack || { send: function () {}, id: function () { return ""; } }; };
  var LABEL = { "general-contractor": "General Contracting", "fence-deck": "Fence & Decks", renovations: "Renovations / Restoration", landscaping: "Landscaping" };
  var VIBE = { rugged: "Rugged", modern: "Modern", minimal: "Minimal", friendly: "Friendly" };
  var COLOURS = [["Ember", "#C2410C"], ["Amber", "#F2B705"], ["Forest", "#2F6B3F"], ["Teal", "#0F766E"], ["Sky", "#1D6FB8"], ["Navy", "#1E3A8A"], ["Berry", "#9D174D"], ["Plum", "#6D28D9"], ["Clay", "#8C6A43"], ["Slate", "#475569"], ["Black", "#111111"]];
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var state = { d: "", v: "", c: "", n: "" };
  var flow = $("#flow"), stage = $("#stage"), frame = $("#frame"), device = $("#device"), view = $("#view"), cover = $("#cover"), urlEl = $("#url");
  var open1 = $("#open"), open2 = $("#open2"), openbar = $("#openbar");
  var steps = $$(".step"), unlocked = 1, ready = false, frameLoaded = false, pending = null;

  function lum(hex) { var n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function cleanName(v) { return String(v || "").replace(/[\u0000-\u001F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60); }
  function cleanHex(v) { v = String(v || "").replace(/^#/, ""); return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : ""; }

  // ---- Swatches ----
  var sw = $("#swatches");
  COLOURS.forEach(function (c) {
    var b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", "false"); b.setAttribute("aria-label", c[0]); b.title = c[0];
    b.dataset.k = "c"; b.dataset.v = c[1]; b.dataset.n = c[0]; b.style.setProperty("--c", c[1]); b.style.setProperty("--t", lum(c[1]) > 0.42 ? "#111" : "#fff"); sw.appendChild(b);
  });
  var own = document.createElement("label"); own.className = "own"; own.title = "Pick any colour";
  var colourInput = document.createElement("input"); colourInput.type = "color"; colourInput.value = "#1D6FB8"; colourInput.setAttribute("aria-label", "Pick any colour");
  own.appendChild(colourInput); sw.appendChild(own);

  // ---- Step handling ----
  function setStep(i, mode) { var s = steps[i - 1]; s.classList.add("is-open"); s.classList.toggle("is-done", mode === "done"); }
  function summary(i, text) { var el = $("[data-summary]", steps[i - 1]); if (el) el.textContent = text; }
  function unlock(n) { if (n <= unlocked) return; unlocked = n; steps[n - 1].hidden = false; }
  // Guided scrolling: after a choice the next step glides into view just below the white header (below the pinned preview on tablet and phone). It only advances after a
  // first-time selection; changing an earlier choice never moves the page. The preview stays pinned and the page scrolls normally (no separate scrollbar).
  function narrow() { return window.innerWidth <= 1000; }
  function goTo(n) {
    var s = steps[n - 1]; if (!s) return;
    setTimeout(function () {
      var head = $(".top"), under = (head ? head.getBoundingClientRect().bottom : 68) + (narrow() ? (stage.hidden ? 0 : stage.offsetHeight) + 12 : 20);
      var slide = 0; try { slide = new DOMMatrix(getComputedStyle(s).transform).m42 || 0; } catch (e) { /* no transform */ } // the step is still sliding in: aim at where it settles
      window.scrollTo({ top: Math.max(0, s.getBoundingClientRect().top - slide + window.scrollY - under), behavior: reduce ? "auto" : "smooth" });
    }, 120);
  }

  function mark(k, v) {
    var group = k === "d" ? $$(".opt--disc") : k === "v" ? $$(".opt--vibe") : $$("#swatches button[role=radio]");
    group.forEach(function (b) { b.setAttribute("aria-checked", String(b.dataset.v === v)); });
  }

  // ---- Preview ----
  function siteUrl() { var q = new URLSearchParams({ embed: "1", d: state.d, v: state.v || "modern" }); if (state.c) q.set("c", state.c.slice(1)); return "site.html?" + q; }
  function openUrl() {
    var q = new URLSearchParams({ d: state.d, v: state.v || "modern" }); if (state.c) q.set("c", state.c.slice(1));
    var h = new URLSearchParams(); var j = T().id(); if (j) h.set("j", j); if (state.n) h.set("n", state.n);
    return "site.html?" + q + (h.toString() ? "#" + h : "");
  }
  function domain() { var s = state.n.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); return (s || "yourcompany").slice(0, 26) + ".ca"; }
  function fit() {
    var phone = device.dataset.mode === "phone", w0 = phone ? 390 : 1280, h0 = phone ? 760 : 800, cw = view.clientWidth || 600, s = cw / w0;
    frame.style.width = w0 + "px"; frame.style.height = h0 + "px"; frame.style.transform = "scale(" + s + ")";
    var full = Math.round(h0 * s), narrow = window.innerWidth <= 1000;
    view.style.height = (narrow ? Math.min(full, Math.round(window.innerHeight * (phone ? 0.36 : 0.3))) : full) + "px";
    document.documentElement.style.setProperty("--stage-h", (narrow && !stage.hidden ? stage.offsetHeight : 0) + "px");
  }
  function pushToFrame() {
    if (!frameLoaded) { pending = true; return; }
    try { var w = frame.contentWindow; if (w && w.FrameworkSite) w.FrameworkSite.set({ d: state.d, v: state.v || "modern", c: state.c, n: state.n }); } catch (e) { /* same-origin only */ }
  }
  function refresh() {
    urlEl.textContent = domain();
    var u = openUrl(); open1.setAttribute("href", u); open2.setAttribute("href", u);
    var q = new URLSearchParams({ demo: state.d }); $$("[data-enquire]").forEach(function (a) { a.setAttribute("href", "../contact.html?" + q + "#contact-form"); });
    try { sessionStorage.setItem("fw_demo", JSON.stringify(state)); } catch (e) { /* storage blocked */ }
  }
  frame.addEventListener("load", function () { frameLoaded = true; frame.classList.add("is-ready"); fit(); if (pending) { pending = false; pushToFrame(); } });
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(device); else window.addEventListener("resize", fit);
  window.addEventListener("resize", fit);
  $$(".seg button").forEach(function (b) { b.addEventListener("click", function () { device.dataset.mode = b.dataset.mode; $$(".seg button").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); fit(); }); });
  cover.addEventListener("click", function () { cover.hidden = true; frame.style.pointerEvents = "auto"; });
  function showStage() {
    if (!stage.hidden) return;
    var anchor = narrow() && document.activeElement && document.activeElement.closest ? document.activeElement.closest(".opt") : null, y0 = anchor ? anchor.getBoundingClientRect().top : 0;
    stage.hidden = false; openbar.hidden = false; flow.dataset.stage = "preview";
    frame.src = siteUrl(); frameLoaded = false; fit();
    // the pinned preview is inserted above the steps on tablet and phone: keep the chosen card where the visitor's eyes are
    if (anchor) { var dy = anchor.getBoundingClientRect().top - y0; if (dy) window.scrollBy({ top: dy, behavior: "instant" }); }
  }

  // ---- Choices ----
  function choose(k, v) {
    if (k === "d") {
      var first = !state.d; state.d = v; mark("d", v); summary(1, LABEL[v]); setStep(1, "done"); T().send("discipline", v);
      showStage(); if (!first) pushToFrame(); unlock(2); if (!state.v) { setStep(2, "open"); goTo(2); } refresh();
    } else if (k === "v") {
      var firstV = !state.v; state.v = v; mark("v", v); summary(2, VIBE[v]); setStep(2, "done"); T().send("vibe", v); pushToFrame(); unlock(3);
      if (firstV && !state.c) { setStep(3, "open"); goTo(3); } refresh();
    } else if (k === "c") {
      var hex = cleanHex(v); if (!hex) return; var firstC = !state.c; state.c = hex; mark("c", hex); var nm = (COLOURS.filter(function (c) { return c[1] === hex; })[0] || ["Custom"])[0];
      $("#colour-name").textContent = nm + " " + hex; summary(3, nm); setStep(3, "done"); T().send("colour", hex); pushToFrame(); unlock(4);
      if (firstC && !state.n) { setStep(4, "open"); goTo(4); } refresh();
    }
  }
  $$(".opt--disc,.opt--vibe").forEach(function (b) { b.addEventListener("click", function () { choose(b.dataset.k, b.dataset.v); }); });
  sw.addEventListener("click", function (e) { var b = e.target.closest("button[role=radio]"); if (b) choose("c", b.dataset.v); });
  var colourDebounce;
  colourInput.addEventListener("input", function () { pushColourPreview(colourInput.value); clearTimeout(colourDebounce); colourDebounce = setTimeout(function () { choose("c", colourInput.value); }, 600); });
  function pushColourPreview(v) { var hex = cleanHex(v); if (!hex) return; state.c = hex; $$("#swatches button[role=radio]").forEach(function (b) { b.setAttribute("aria-checked", "false"); }); pushToFrame(); }

  // Company name: applied only when the visitor asks to see it.
  var form = $("#name-form"), input = $("#company"), clear = $("#name-clear");
  form.addEventListener("submit", function (e) {
    e.preventDefault(); var n = cleanName(input.value); state.n = n; input.value = n;
    if (n) { summary(4, n); setStep(4, "done"); clear.hidden = false; T().send("company", n); } else { summary(4, ""); setStep(4, "open"); clear.hidden = true; }
    pushToFrame(); refresh();
  });
  clear.addEventListener("click", function () { state.n = ""; input.value = ""; clear.hidden = true; summary(4, ""); setStep(4, "open"); pushToFrame(); refresh(); });

  // Full-demo link
  [open1, open2].forEach(function (a) { a.addEventListener("click", function () { T().send("open", "preview"); if (window.FrameworkTrack) window.FrameworkTrack.flush(); refresh(); }); });

  // Keyboard: arrow keys move within a radio group
  $$("[role=radiogroup]").forEach(function (g) {
    g.addEventListener("keydown", function (e) {
      var n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!n) return;
      var items = $$("[role=radio]", g), i = items.indexOf(document.activeElement); if (i < 0) return; e.preventDefault(); var t = items[(i + n + items.length) % items.length]; t.focus(); t.click();
    });
  });
  if (window.innerWidth <= 620) { device.dataset.mode = "phone"; $$(".seg button").forEach(function (x) { x.setAttribute("aria-pressed", String(x.dataset.mode === "phone")); }); }
  refresh();
})();
