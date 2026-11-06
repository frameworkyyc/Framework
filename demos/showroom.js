// Framework demo showroom: a live preview of each demo website with "make it yours" controls.
// The preview is the real demo page in a same-origin iframe (?embed=1), driven through window.FrameworkDemo. Nothing is uploaded.
(function () {
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return [].slice.call((r || document).querySelectorAll(s)); };
  var SWATCH = ["#0F766E", "#1D4ED8", "#B91C1C", "#EA580C", "#CA8A04", "#15803D", "#7C3AED", "#111111"];
  var URLS = { "fence-deck": "ridgelinefence.ca", landscaping: "foothillsgrove.ca", renovations: "hearthandhall.ca", "general-contractor": "keystonebuild.ca" };
  var q = new URLSearchParams(location.search);
  var state = { demo: "fence-deck", mode: "desktop", name: clean(q.get("for")), accent: hex(q.get("accent")), files: [] };
  if (location.hash && URLS[location.hash.slice(1)]) state.demo = location.hash.slice(1);

  var tabs = $$(".pick"), frame = $("[data-frame]"), view = $("[data-view]"), device = $(".device"), cover = $("[data-cover]"), load = $("[data-load]");
  var nameIn = $("[data-name]"), sw = $("[data-sw]"), photos = $("[data-photos]"), note = $("[data-photos-note]"), urlEl = $("[data-url]");
  var modeBtns = $$("[data-mode]", $(".stage__bar")), openA = $("[data-open]");

  function clean(v) { return String(v || "").replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, 60); }
  function hex(v) { v = String(v || "").replace(/^#/, ""); return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : ""; }
  function domain() { var s = state.name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, ""); return (s || URLS[state.demo].replace(/\.ca$/, "")).slice(0, 28) + ".ca"; }

  // Swatches
  sw.innerHTML = SWATCH.map(function (c) { return '<button type="button" style="--c:' + c + '" data-c="' + c + '" aria-label="Colour ' + c + '" aria-pressed="false"></button>'; }).join("") + '<label class="any" title="Any colour"><input type="color" value="#1D4ED8" aria-label="Custom colour"></label>';
  function pressed() { $$("button", sw).forEach(function (b) { b.setAttribute("aria-pressed", String(!!state.accent && b.getAttribute("data-c") === state.accent)); }); }

  // Scale the full-size page to fit the preview frame
  function fit() {
    var phone = state.mode === "phone", w0 = phone ? 390 : 1280, h0 = phone ? 800 : 780, cw = view.clientWidth || 600, s = cw / w0;
    frame.style.width = w0 + "px"; frame.style.height = h0 + "px"; frame.style.transform = "scale(" + s + ")";
    view.style.height = Math.round(h0 * s) + "px";
  }
  if ("ResizeObserver" in window) new ResizeObserver(fit).observe(device); else window.addEventListener("resize", fit);

  function api() { try { return frame.contentWindow && frame.contentWindow.FrameworkDemo; } catch (e) { return null; } }
  function apply() {
    var d = api(); if (!d) return;
    d.setName(state.name); d.setAccent(state.accent);
    if (state.files.length) d.setPhotos(state.files);
  }
  function links() {
    var qs = new URLSearchParams(); if (state.name) qs.set("for", state.name); if (state.accent) qs.set("accent", state.accent.slice(1));
    var tail = qs.toString() ? "?" + qs : "";
    openA.setAttribute("href", state.demo + ".html" + tail);
    $$("[data-card]").forEach(function (a) { a.setAttribute("href", a.getAttribute("data-card") + ".html" + tail); });
    var e = new URLSearchParams(); if (state.name) e.set("business", state.name); e.set("demo", state.demo); if (state.accent) e.set("accent", state.accent.slice(1));
    $$("[data-enquire]").forEach(function (a) { a.setAttribute("href", "../contact.html?" + e + "#contact-form"); });
    urlEl.textContent = domain();
    $("#for-line").textContent = state.name ? "Made for " + state.name + ". " : "";
  }

  function select(key, push) {
    state.demo = key;
    tabs.forEach(function (b) { var on = b.getAttribute("data-demo") === key; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; });
    frame.classList.remove("is-ready"); load.hidden = false; cover.hidden = false; frame.style.pointerEvents = "none";
    frame.src = key + ".html?embed=1";
    if (push && history.replaceState) history.replaceState(null, "", "#" + key + (location.search || ""));
    links();
  }
  frame.addEventListener("load", function () { if (!frame.getAttribute("src")) return; apply(); frame.classList.add("is-ready"); load.hidden = true; fit(); });
  tabs.forEach(function (b, i) {
    b.addEventListener("click", function () { select(b.getAttribute("data-demo"), true); });
    b.addEventListener("keydown", function (e) { var n = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0; if (!n) return; e.preventDefault(); var t = tabs[(i + n + tabs.length) % tabs.length]; t.focus(); t.click(); });
  });
  cover.addEventListener("click", function () { cover.hidden = true; frame.style.pointerEvents = "auto"; frame.focus(); });

  modeBtns.forEach(function (b) { b.addEventListener("click", function () { state.mode = b.getAttribute("data-mode"); modeBtns.forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); }); device.setAttribute("data-mode", state.mode); fit(); }); });

  nameIn.addEventListener("input", function () { state.name = clean(nameIn.value); var d = api(); if (d) d.setName(state.name); links(); });
  sw.addEventListener("click", function (e) { var b = e.target.closest("button[data-c]"); if (!b) return; state.accent = b.getAttribute("data-c"); $("input[type=color]", sw).value = state.accent.toLowerCase(); var d = api(); if (d) d.setAccent(state.accent); pressed(); links(); });
  $("input[type=color]", sw).addEventListener("input", function (e) { state.accent = hex(e.target.value); var d = api(); if (d) d.setAccent(state.accent); pressed(); links(); });
  photos.addEventListener("change", function () { state.files = [].slice.call(photos.files).slice(0, 6); var d = api(), n = d ? d.setPhotos(state.files) : 0; note.textContent = state.files.length ? state.files.length + (state.files.length === 1 ? " photo added" : " photos added") : "Add photos"; });
  $$("[data-presets] button").forEach(function (b) {
    b.style.setProperty("--c", b.getAttribute("data-c"));
    b.addEventListener("click", function () {
      state.name = clean(b.getAttribute("data-name")); state.accent = hex(b.getAttribute("data-c")); nameIn.value = state.name; $("input[type=color]", sw).value = state.accent.toLowerCase();
      var d = api(); if (d) { d.setName(state.name); d.setAccent(state.accent); } pressed(); links();
    });
  });
  $("[data-reset]").addEventListener("click", function () { state.name = ""; state.accent = ""; state.files = []; nameIn.value = ""; photos.value = ""; note.textContent = "Add photos"; pressed(); var d = api(); if (d) d.reset(); links(); });

  // Phones get the phone preview only
  if (window.matchMedia("(max-width: 900px)").matches) { state.mode = "phone"; device.setAttribute("data-mode", "phone"); modeBtns.forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-mode") === "phone")); }); }

  nameIn.value = state.name; pressed(); fit();
  // Load the preview once the showroom is on screen
  var started = false;
  function start() { if (started) return; started = true; select(state.demo, false); }
  if ("IntersectionObserver" in window) new IntersectionObserver(function (es, io) { if (es[0].isIntersecting) { io.disconnect(); start(); } }, { rootMargin: "300px" }).observe($("#showroom")); else start();
  links();
})();
