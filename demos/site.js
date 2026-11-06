// Framework demo website engine: one website, four disciplines x four vibes (16 designs), personalised with a company name and colour.
// ?d=<discipline>&v=<vibe>&c=<RRGGBB> choose the design; the company name travels in the URL fragment (#n=...) or sessionStorage, never the query string.
// The landing page drives a live preview through window.FrameworkSite.set(). Nothing here is sent anywhere; see track.js for the optional, private counts.
(function () {
  var DATA = window.FW_SITE_DATA, CRED = window.FW_SITE_CREDITS || {};
  var DISC = Object.keys(DATA), VIBES = ["rugged", "modern", "minimal", "friendly"];
  var doc = document.documentElement, body = document.body;
  var params = new URLSearchParams(location.search);
  var embed = params.get("embed") === "1";
  if (embed) doc.classList.add("is-embed");
  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var BASE = "../assets/img/demos/";

  function cleanName(v) { return String(v || "").replace(/[\u0000-\u001F<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 60); }
  function cleanHex(v) { v = String(v || "").replace(/^#/, ""); return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : ""; }
  function lum(hex) { var n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; }
  function mix(hex, to, k) { var a = parseInt(hex.slice(1), 16); return "#" + [16, 8, 0].map(function (s) { var v = a >> s & 255; return ("0" + Math.round(v + (to - v) * k).toString(16)).slice(-2); }).join(""); }
  function el(tag, props) {
    var e = document.createElement(tag), kids = [].slice.call(arguments, 2);
    Object.keys(props || {}).forEach(function (k) { var v = props[k]; if (v == null || v === false) return; if (k === "class") e.className = v; else if (k === "text") e.textContent = v; else e.setAttribute(k, v === true ? "" : v); });
    kids.forEach(function (c) { if (c == null) return; e.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
    return e;
  }

  // ---- State: URL > session > defaults ----
  var saved = {};
  try { saved = JSON.parse(sessionStorage.getItem("fw_demo") || "{}") || {}; } catch (e) { saved = {}; }
  var hashP = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var state = {
    d: DATA[params.get("d")] ? params.get("d") : DATA[saved.d] ? saved.d : "fence-deck",
    v: VIBES.indexOf(params.get("v")) > -1 ? params.get("v") : VIBES.indexOf(saved.v) > -1 ? saved.v : "modern",
    c: cleanHex(params.get("c")) || cleanHex(saved.c) || "",
    n: cleanName(hashP.get("n") || saved.n || "")
  };
  if (hashP.has("n")) { hashP.delete("n"); }
  if (location.hash && !hashP.has("j") && history.replaceState && !embed) history.replaceState(null, "", location.pathname + location.search + (hashP.toString() ? "#" + hashP : ""));
  function persist() { try { sessionStorage.setItem("fw_demo", JSON.stringify(state)); } catch (e) { /* storage blocked */ } }

  // ---- Colour ----
  function paint() {
    var d = DATA[state.d], hex = state.c || d.accent, light = lum(hex) > 0.42, s = doc.style;
    s.setProperty("--accent", hex);
    s.setProperty("--on-accent", light ? "#111111" : "#FFFFFF");
    s.setProperty("--accent-ink", light ? mix(hex, 0, 0.5) : hex);
    s.setProperty("--accent-lite", light ? hex : mix(hex, 255, 0.4));
    s.setProperty("--accent-soft", "color-mix(in srgb," + hex + " 14%,transparent)");
  }

  // ---- Build ----
  var root = document.getElementById("site");
  function pickPhotos() {
    var d = DATA[state.d], hero = d.heroByVibe[state.v], pool = d.order.filter(function (k) { return k !== hero && d.photos[k]; }).slice(0, 3);
    return { hero: hero, projects: pool };
  }
  function img(key, alt, eager) {
    var i = new Image(); i.src = BASE + state.d + "/" + key + ".jpg"; i.alt = alt || ""; i.decoding = "async"; if (!eager) i.loading = "lazy"; return i;
  }
  var names = { company: null };
  function bizName() { return state.n || DATA[state.d].name; }
  function build() {
    var d = DATA[state.d], ph = pickPhotos(), name = bizName();
    root.textContent = "";
    var bar = el("div", { class: "s-bar" }, el("div", { class: "s-wrap s-bar__in" }, el("span", {}, el("strong", {}, "Sample website by Framework."), " Business and reviews are illustrative."),
      el("span", { class: "s-bar__l" }, el("a", { href: "./", "data-back": "" }, "← Change style"), el("a", { href: "../contact.html", "data-enquire": "" }, "Get a site like this →"))));
    var head = el("header", { class: "s-head" }, el("div", { class: "s-wrap s-head__in" },
      el("a", { class: "s-logo", href: "#top" }, el("span", { class: "s-logo__m", "data-initial": "" }, name.charAt(0).toUpperCase()), el("span", { "data-biz": "" }, name)),
      el("nav", { class: "s-nav", "aria-label": "Main" }, el("a", { href: "#projects" }, "Projects"), el("a", { href: "#services" }, "Services"), el("a", { href: "#process" }, "Process")),
      el("a", { class: "s-btn s-btn--sm", href: "#enquire" }, "Enquire"),
      el("button", { class: "s-menu", type: "button", "aria-expanded": "false", "aria-label": "Menu" }, el("i", {}), el("i", {}))));
    var hp = d.photos[ph.hero];
    var hero = el("section", { class: "s-hero", id: "top" }, el("figure", { class: "s-hero__img" }, img(ph.hero, hp[0] + ", " + hp[1], true)),
      el("div", { class: "s-wrap s-hero__in" }, el("div", { class: "s-hero__copy" }, el("p", { class: "s-kicker" }, d.kicker),
        el.apply(null, ["h1", { class: "s-h1" }].concat(d.h1.map(function (line, i) { return el("span", { class: "s-h1__l", style: null }, line + (i < d.h1.length - 1 ? " " : "")); }))),
        el("p", { class: "s-lead" }, d.lead),
        el("div", { class: "s-cta" }, el("a", { class: "s-btn", href: "#enquire" }, "Get a free quote"), el("a", { class: "s-link", href: "tel:" + d.tel }, "Call " + fmtTel(d.tel)))),
        el.apply(null, ["ul", { class: "s-trust" }].concat(d.facts.map(function (f) { return el("li", {}, el("b", {}, f[0]), el("span", {}, f[1])); })))));
    var stripe = el("div", { class: "s-stripe", "aria-hidden": "true" });
    var intro = el("section", { class: "s-sec s-intro", id: "about" }, el("div", { class: "s-wrap s-intro__g" }, el("p", { class: "s-label s-rv" }, name), el("p", { class: "s-intro__t s-rv" }, d.intro)));
    var cards = ph.projects.map(function (k, i) {
      var p = d.photos[k];
      return el("article", { class: "s-card s-rv", style: null }, el("figure", { class: "s-card__img" }, img(k, p[0] + ", " + p[1])),
        el("div", { class: "s-card__t" }, el("span", { class: "s-card__p" }, p[1]), el("h3", {}, p[0]), el("p", {}, p[3])));
    });
    var proj = el("section", { class: "s-sec s-proj", id: "projects" }, el("div", { class: "s-wrap" }, el("header", { class: "s-sec__h s-rv" }, el("p", { class: "s-label" }, "Selected projects"), el("h2", {}, "Recent work")),
      el.apply(null, ["div", { class: "s-proj__g" }].concat(cards))));
    var svc = el("section", { class: "s-sec s-svc", id: "services" }, el("div", { class: "s-wrap" }, el("header", { class: "s-sec__h s-rv" }, el("p", { class: "s-label" }, "Services"), el("h2", {}, "What we do")),
      el.apply(null, ["ul", { class: "s-svc__g" }].concat(d.services.map(function (s, i) { return el("li", { class: "s-rv" }, el("span", { class: "s-n" }, "0" + (i + 1)), el("h3", {}, s[0]), el("p", {}, s[1])); })))));
    var proc = el("section", { class: "s-sec s-proc", id: "process" }, el("div", { class: "s-wrap" }, el("header", { class: "s-sec__h s-rv" }, el("p", { class: "s-label" }, "Process"), el("h2", {}, "How it works")),
      el.apply(null, ["ol", { class: "s-proc__g" }].concat(d.steps.map(function (s, i) { return el("li", { class: "s-rv" }, el("span", { class: "s-n" }, "0" + (i + 1)), el("h3", {}, s[0]), el("p", {}, s[1])); })))));
    var sel = el.apply(null, ["select", { name: "type", id: "f-type" }].concat(d.types.map(function (t) { return el("option", {}, t); })));
    var form = el("form", { class: "s-form", "data-demo-form": "" },
      el("label", {}, "Name", el("input", { name: "name", autocomplete: "name", required: true })), el("label", {}, "Phone", el("input", { name: "phone", type: "tel", autocomplete: "tel", required: true })),
      el("label", { class: "full" }, "Email", el("input", { name: "email", type: "email", autocomplete: "email" })), el("label", { class: "full" }, "Project type", sel),
      el("label", { class: "full" }, "Details", el("textarea", { name: "details", placeholder: "Size, timeline, anything we should know" })),
      el("div", { class: "full" }, el("button", { class: "s-btn s-btn--block", type: "submit" }, "Request my free quote")),
      el("p", { class: "s-note full" }, "Demo form, nothing is sent."), el("p", { class: "s-done full", tabindex: "-1", role: "status" }, "Thanks! On a live site this request would go straight to your inbox and phone."));
    var enq = el("section", { class: "s-sec s-enq", id: "enquire" }, el("div", { class: "s-wrap s-enq__g" },
      el("div", { class: "s-enq__t s-rv" }, el("p", { class: "s-label" }, "Enquire"), el("h2", {}, "Tell us about your project."), el("p", { class: "s-enq__p" }, "We will get back to you within one business day, usually sooner."),
        el("a", { class: "s-tel", href: "tel:" + d.tel }, fmtTel(d.tel)), el("p", { class: "s-meta" }, d.hours + " · Calgary & surrounding area")), el("div", { class: "s-rv" }, form)));
    var credits = [], seen = {};
    ph.projects.concat([ph.hero]).forEach(function (k) { var c = CRED[state.d + "/" + k]; if (c && !seen[c[1]]) { seen[c[1]] = 1; credits.push(el("a", { href: "https://unsplash.com/@" + c[1] + "?utm_source=framework&utm_medium=referral", rel: "noopener", target: "_blank" }, c[0])); } });
    var cr = el("span", { class: "s-credits" }, "Sample photos by ");
    credits.forEach(function (a, i) { cr.appendChild(a); cr.appendChild(document.createTextNode(i < credits.length - 1 ? ", " : " ")); });
    cr.appendChild(document.createTextNode("on ")); cr.appendChild(el("a", { href: "https://unsplash.com/?utm_source=framework&utm_medium=referral", rel: "noopener", target: "_blank" }, "Unsplash")); cr.appendChild(document.createTextNode("."));
    var foot = el("footer", { class: "s-foot" }, el("div", { class: "s-wrap s-foot__in" }, el("span", {}, "© " + new Date().getFullYear() + " ", el("span", { "data-biz": "" }, name), ". Calgary, Alberta."), el("span", {}, "Website by ", el("a", { href: "../index.html" }, "Framework")), cr));
    var mobile = el("div", { class: "s-mbar" }, el("a", { class: "s-btn s-btn--ghost", href: "tel:" + d.tel }, "Call"), el("a", { class: "s-btn", href: "#enquire" }, "Free quote"));
    var main = el("main", { class: "s-main" }, hero, stripe, intro, proj, svc, proc, enq);
    root.appendChild(bar); root.appendChild(head); root.appendChild(main); root.appendChild(foot); root.appendChild(mobile);
    document.title = name + " — " + d.label + " demo website by Framework";
    wire();
  }
  function fmtTel(t) { return "(" + t.slice(0, 3) + ") " + t.slice(3, 6) + "-" + t.slice(6); }

  // ---- Behaviour ----
  var io = null, scrollOn = false;
  function wire() {
    var head = root.querySelector(".s-head"), btn = root.querySelector(".s-menu");
    btn.addEventListener("click", function () { var o = head.classList.toggle("is-open"); btn.setAttribute("aria-expanded", String(o)); });
    [].forEach.call(head.querySelectorAll(".s-nav a,.s-btn"), function (a) { a.addEventListener("click", function () { head.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); }); });
    var form = root.querySelector("form");
    form.addEventListener("submit", function (e) { e.preventDefault(); form.classList.add("is-done"); var dn = form.querySelector(".s-done"); if (dn) dn.focus(); });
    links();
    // reveal
    var rv = [].slice.call(root.querySelectorAll(".s-rv"));
    if (io) io.disconnect();
    if ("IntersectionObserver" in window && !reduce) {
      doc.classList.add("s-motion");
      io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { threshold: 0.12, rootMargin: "0px 0px -5% 0px" });
      rv.forEach(function (n, i) { n.style.setProperty("--d", (i % 3) * 80 + "ms"); io.observe(n); });
    } else rv.forEach(function (n) { n.classList.add("in"); });
    onScroll();
  }
  function onScroll() { var h = root.querySelector(".s-head"); if (h) h.classList.toggle("is-solid", window.scrollY > 40); }
  if (!scrollOn) { scrollOn = true; window.addEventListener("scroll", onScroll, { passive: true }); }
  function links() {
    var back = root.querySelector("[data-back]"), enq = root.querySelector("[data-enquire]");
    if (back) back.setAttribute("href", "./");
    if (enq) { var q = new URLSearchParams({ demo: state.d }); enq.setAttribute("href", "../contact.html?" + q + "#contact-form"); }
  }

  // ---- Public API (used by the landing page preview) ----
  function apply(next, animate) {
    var rebuild = false;
    if (next.d && DATA[next.d] && next.d !== state.d) { state.d = next.d; rebuild = true; }
    if (next.v && VIBES.indexOf(next.v) > -1 && next.v !== state.v) { state.v = next.v; rebuild = true; }
    if (typeof next.c === "string") { state.c = cleanHex(next.c); }
    if (typeof next.n === "string") { var nn = cleanName(next.n); if (nn !== state.n) { state.n = nn; if (!rebuild) names.company = nn; } }
    persist(); paint();
    body.setAttribute("data-vibe", state.v); body.setAttribute("data-disc", state.d);
    if (rebuild) {
      if (animate && !reduce) { root.classList.add("is-switching"); setTimeout(function () { build(); window.scrollTo(0, 0); requestAnimationFrame(function () { root.classList.remove("is-switching"); }); }, 220); }
      else build();
    } else {
      var n = bizName();
      [].forEach.call(root.querySelectorAll("[data-biz]"), function (e) { e.textContent = n; });
      [].forEach.call(root.querySelectorAll("[data-initial]"), function (e) { e.textContent = n.charAt(0).toUpperCase(); });
      var d = DATA[state.d]; document.title = n + " — " + d.label + " demo website by Framework";
    }
  }
  window.FrameworkSite = { state: state, set: function (next) { apply(next || {}, true); }, DATA: DATA };

  // ---- Start ----
  persist(); paint();
  body.setAttribute("data-vibe", state.v); body.setAttribute("data-disc", state.d);
  build();
  var pre = document.getElementById("preload"); if (pre) pre.remove();
  requestAnimationFrame(function () { body.classList.add("is-ready"); });
})();
