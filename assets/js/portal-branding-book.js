/* Brand Book prototype: turns the plain stack of cards into a deck. Optional: without this script (or with reduced motion) the cards are an ordinary vertical stack and every link works.
   Nothing is captured or snapped: the PAGE scrolls as usual, and the position of each card is simply computed from how far it has scrolled (the next card rises over the current one).
   The active card's content scrolls inside the card when it is taller than the card, and chains to the page at its end. Cards that are not active are inert (not focusable, not read out);
   the numbered index in the bar always works. Transforms are set through the style object (allowed by the portal's CSP; no inline style attributes). Fetches and stores nothing. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var root = document.getElementById("brand-book");
  if (!root) return;

  /* "Copy" buttons next to taglines (same as the Branding page): shown only when copying is possible. */
  var copy = document.querySelectorAll("[data-copy]");
  if (copy.length && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    Array.prototype.forEach.call(copy, function (btn) {
      btn.hidden = false;
      btn.addEventListener("click", function () {
        navigator.clipboard.writeText(btn.getAttribute("data-copy") || "").then(function () { btn.firstChild.textContent = "Copied"; window.setTimeout(function () { btn.firstChild.textContent = "Copy"; }, 2000); }, function () {});
      });
    });
  }

  var runway = root.querySelector("[data-bb-runway]");
  var cards = Array.prototype.slice.call(root.querySelectorAll("[data-bb-card]"));
  var links = Array.prototype.slice.call(root.querySelectorAll("[data-bb-go]"));
  var live = root.querySelector("[data-bb-live]");
  var barEl = root.querySelector(".bb-bar");
  var header = document.querySelector(".bar");
  var n = cards.length;
  if (!runway || n < 2) return;
  var motion = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };

  var on = false, g = null, queued = false, active = -1, announced = false, lastW = 0, lastH = 0;
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var smooth = function (t) { return t * t * (3 - 2 * t); };
  var setVar = function (name, v) { root.style.setProperty(name, v); };

  function canDeck() {
    var sticky = window.CSS && CSS.supports && CSS.supports("position", "sticky");
    return !motion.matches && sticky && window.innerHeight >= 520 && window.innerWidth >= 320;
  }

  function measure() {
    var hb = header ? header.getBoundingClientRect().height : 0;
    var lift = g ? g.lift : 0;
    var bb = barEl.getBoundingClientRect().height;
    /* the gap between the portal header and the top of the book at rest (page padding), so the first card is fully on screen when the page loads */
    var gap = Math.max(0, root.getBoundingClientRect().top + window.pageYOffset + lift - hb);
    var narrow = window.innerWidth <= 880;
    var ph = narrow ? 30 : 32, edge = 14;
    var H = Math.max(380, Math.round(window.innerHeight - hb - bb));
    var S = H, T = Math.round(0.62 * H), D = S - T;
    setVar("--bb-top", hb + "px"); setVar("--bb-bar", bb + "px"); setVar("--bb-stage", H + "px"); setVar("--bb-ph", ph + "px"); setVar("--bb-edge", edge + "px");
    setVar("--bb-runway", Math.round(H + (n - 1) * S + D) + "px"); setVar("--bb-lift", gap + "px");
    cards.forEach(function (c, i) { c.style.setProperty("--bb-reserve", (n - 1 - i) * ph + "px"); });
    g = { H: H, S: S, T: T, D: D, ph: ph, edge: edge, lift: gap, start: 0 };
    /* where the pinned stage begins to hold, in page coordinates (after the variables above have taken effect) */
    g.start = runway.getBoundingClientRect().top + window.pageYOffset - hb - bb;
    lastW = window.innerWidth; lastH = window.innerHeight;
  }

  function more(sheet) {
    var overflow = sheet.scrollHeight - sheet.clientHeight > 4;
    sheet.classList.toggle("is-more", overflow && sheet.scrollHeight - sheet.scrollTop - sheet.clientHeight > 8);
    if (overflow) sheet.setAttribute("tabindex", "0"); else sheet.removeAttribute("tabindex");
  }

  function render() {
    queued = false;
    if (!on || !g) return;
    var s = window.pageYOffset - g.start, e = [1], i, k;
    for (i = 1; i < n; i++) e[i] = smooth(clamp((s - ((i - 1) * g.S + g.D)) / g.T, 0, 1));
    var now = 0;
    for (i = 0; i < n; i++) {
      var depth = 0;
      for (k = i + 1; k < n; k++) depth += e[k];
      var wait = g.H - g.ph * (n - i) - g.edge; /* where a waiting card rests: only its tab shows, stacked at the bottom */
      var ty = wait * (1 - e[i]) - 7 * Math.min(depth, 2.6);
      var sc = 1 - 0.014 * Math.min(depth, 3);
      cards[i].style.transform = "translate3d(0," + ty.toFixed(2) + "px,0) scale(" + sc.toFixed(4) + ")";
      cards[i].style.setProperty("--bb-dim", Math.min(0.16 * depth, 0.42).toFixed(3));
      if (e[i] >= 0.5) now = i;
    }
    if (now !== active) {
      active = now;
      cards.forEach(function (c, j) {
        var main = c.querySelector(".bb-card__main");
        if (main) { if (j === active) main.removeAttribute("inert"); else main.setAttribute("inert", ""); }
        c.classList.toggle("is-waiting", j > active);
        c.classList.toggle("is-active", j === active);
      });
      links.forEach(function (a, j) { if (j === active) a.setAttribute("aria-current", "true"); else a.removeAttribute("aria-current"); });
      var sheet = cards[active].querySelector("[data-bb-sheet]");
      if (sheet) more(sheet);
      if (announced && live) { var h = cards[active].querySelector(".bb-card__title"); live.textContent = "Card " + (active + 1) + " of " + n + ": " + (h ? h.textContent.replace(/^\d+\.\s*/, "") : ""); }
      announced = true;
    }
  }
  function queue() { if (!queued) { queued = true; window.requestAnimationFrame(render); } }

  function goTo(i, instant) {
    if (!on || !g) return false;
    var target = i <= 0 ? 0 : (i - 1) * g.S + g.D + g.T + 1;
    window.scrollTo({ top: g.start + target, behavior: instant ? "instant" : "smooth" }); /* "instant" overrides the page-wide smooth-scroll rule, which would animate a deep link */
    return true;
  }

  function onSheetScroll(ev) { if (on) more(ev.currentTarget); }

  function enable() {
    on = true; active = -1; announced = false;
    root.classList.add("bb--deck");
    measure(); measure(); /* twice: the first pass changes the layout the second one reads */
    cards.forEach(function (c) { var sh = c.querySelector("[data-bb-sheet]"); if (sh) sh.addEventListener("scroll", onSheetScroll, { passive: true }); });
    render();
    var id = (location.hash || "").slice(1), idx = cards.map(function (c) { return c.id; }).indexOf(id);
    if (idx > 0) goTo(idx, true);
  }
  function disable() {
    on = false; g = null; active = -1;
    root.classList.remove("bb--deck");
    ["--bb-top", "--bb-bar", "--bb-stage", "--bb-ph", "--bb-edge", "--bb-runway", "--bb-lift"].forEach(function (v) { root.style.removeProperty(v); });
    cards.forEach(function (c) {
      c.style.removeProperty("transform"); c.style.removeProperty("--bb-dim"); c.style.removeProperty("--bb-reserve"); c.classList.remove("is-waiting", "is-active");
      var main = c.querySelector(".bb-card__main"); if (main) main.removeAttribute("inert");
      var sh = c.querySelector("[data-bb-sheet]"); if (sh) { sh.removeEventListener("scroll", onSheetScroll); sh.classList.remove("is-more"); sh.removeAttribute("tabindex"); }
    });
    links.forEach(function (a) { a.removeAttribute("aria-current"); });
  }

  function update() {
    if (canDeck()) {
      if (!on) enable();
      else if (window.innerWidth !== lastW || Math.abs(window.innerHeight - lastH) > 120) { measure(); queue(); } /* a phone's address bar growing or shrinking is not a resize */
      else { var sheet = active >= 0 && cards[active].querySelector("[data-bb-sheet]"); if (sheet) more(sheet); }
    } else if (on) disable();
  }

  links.forEach(function (a, i) { a.addEventListener("click", function (ev) { if (goTo(i)) ev.preventDefault(); }); });
  cards.forEach(function (c, i) { var tab = c.querySelector(".bb-card__tab"); if (tab) tab.addEventListener("click", function () { if (on && i > active) goTo(i); }); });
  window.addEventListener("scroll", queue, { passive: true });
  window.addEventListener("resize", update);
  window.addEventListener("hashchange", function () { var idx = cards.map(function (c) { return c.id; }).indexOf((location.hash || "").slice(1)); if (on && idx >= 0) goTo(idx); });
  if (motion.addEventListener) motion.addEventListener("change", update); else if (motion.addListener) motion.addListener(update);
  update();
})();
