/* FRAMEWORK — live website demos inside the device mockups (portfolio)
   A .device-stage with data-live-demo="<name>" shows the real website in its laptop and phone screens instead
   of screenshots. The embedded site runs its own animation, scrolling and looping ("Portfolio Demo Mode");
   this file only loads it, sizes it and keeps it out of the way. */
(function () {
  "use strict";

  /* ---------- The ONE place the demo URLs live ----------
     `production` is used on frameworkco.ca, `preview` everywhere else (staging.frameworkco.ca, workers.dev, local).
     A null URL means "no live demo here": the stage keeps its screenshots. To go live in Production, set the
     Production URL below; nothing else needs to change. */
  var DEMOS = {
    aurora: {
      production: "https://aurora.frameworkco.ca/?portfolioDemo=1",
      preview: "https://staging.aurora.frameworkco.ca/?portfolioDemo=1"
    }
  };
  var PRODUCTION_HOSTS = ["frameworkco.ca", "www.frameworkco.ca"];

  /* Loading policy: load once the stage is within 60% of a screen of the viewport; unload only after it has been
     more than 3 screens away for 15 continuous seconds. The gap (and the delay) means small scroll movements never
     create or destroy anything. */
  var LOAD_MARGIN = "60% 0px 60% 0px";
  var UNLOAD_MARGIN = "300% 0px 300% 0px";
  var UNLOAD_DELAY = 15000;

  var isProduction = PRODUCTION_HOSTS.indexOf(window.location.hostname.toLowerCase()) !== -1;

  Array.prototype.forEach.call(document.querySelectorAll(".device-stage[data-live-demo]"), function (stage) {
    var config = DEMOS[stage.getAttribute("data-live-demo")];
    var url = config ? (isProduction ? config.production : config.preview) : null;
    if (!url) return; // no live demo configured for this environment: keep the screenshots

    var screens = Array.prototype.slice.call(stage.querySelectorAll(".device__live"));
    if (!screens.length) return;
    stage.classList.add("is-live");

    var loaded = false;
    var unloadTimer = null;

    /* Size an iframe: a fixed logical viewport (data-live-width wide), scaled to fill its screen box exactly.
       The height follows the box's own aspect ratio, so there is never a gap or an overflow. */
    var size = function (screen, frame) {
      var width = parseFloat(screen.getAttribute("data-live-width")) || 1440;
      var boxW = screen.clientWidth;
      var boxH = screen.clientHeight;
      if (!boxW || !boxH) return;
      var scale = boxW / width;
      frame.style.width = width + "px";
      frame.style.height = boxH / scale + "px";
      frame.style.setProperty("--live-scale", scale.toFixed(5));
    };
    var fit = function (screen) {
      var frame = screen.querySelector(".device__live-frame");
      if (frame) size(screen, frame);
    };
    var fitAll = function () { screens.forEach(fit); };

    var load = function () {
      window.clearTimeout(unloadTimer);
      unloadTimer = null;
      if (loaded) return;
      loaded = true;
      screens.forEach(function (screen) {
        var frame = document.createElement("iframe");
        frame.className = "device__live-frame";
        frame.title = screen.getAttribute("data-title") || "Website demonstration";
        frame.tabIndex = -1; // never a keyboard stop
        frame.setAttribute("scrolling", "no");
        frame.setAttribute("referrerpolicy", "no-referrer");
        // A visual display, not a browser: the page can run its scripts but can't navigate us, open popups or submit forms.
        frame.setAttribute("sandbox", "allow-scripts allow-same-origin");
        // 1) final size, 2) join the page, 3) force one layout so the frame really has that size, 4) only then start
        // the navigation. The site's very first script therefore sees the true viewport width (1440 / 390).
        size(screen, frame);
        screen.appendChild(frame);
        void frame.offsetWidth;
        frame.addEventListener("load", function () {
          // An iframe's empty about:blank also fires "load" (Chrome: synchronously, Firefox: a moment later). Ignore it:
          // while it is still our own blank page its location is readable; once the real, cross-origin site is in, it throws.
          try { if (frame.contentWindow.location.href === "about:blank") return; } catch (e) { /* real site loaded */ }
          frame.classList.add("is-loaded");
        });
        frame.src = url;
      });
    };

    var unload = function () {
      unloadTimer = null;
      if (!loaded) return;
      loaded = false;
      screens.forEach(function (screen) {
        var frame = screen.querySelector(".device__live-frame");
        if (frame) frame.remove();
      });
    };

    if ("ResizeObserver" in window) {
      var ro = new ResizeObserver(fitAll);
      screens.forEach(function (screen) { ro.observe(screen); });
    } else {
      window.addEventListener("resize", fitAll);
    }

    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        if (entries[entries.length - 1].isIntersecting) load();
      }, { rootMargin: LOAD_MARGIN }).observe(stage);

      new IntersectionObserver(function (entries) {
        if (entries[entries.length - 1].isIntersecting) {
          window.clearTimeout(unloadTimer);
          unloadTimer = null;
        } else if (loaded && unloadTimer === null) {
          unloadTimer = window.setTimeout(unload, UNLOAD_DELAY);
        }
      }, { rootMargin: UNLOAD_MARGIN }).observe(stage);
    } else {
      load();
    }
  });
})();
