/* FRAMEWORK — site scripts */
(function () {
  "use strict";

  /* ---- Mobile navigation ---- */
  var toggle = document.querySelector(".menu-toggle");
  var nav = document.getElementById("site-nav");
  if (toggle && nav) {
    var setOpen = function (open) {
      nav.classList.toggle("is-open", open);
      document.body.classList.toggle("nav-open", open);
      toggle.setAttribute("aria-expanded", String(open));
      toggle.textContent = open ? "Close" : "Menu";
    };
    toggle.addEventListener("click", function () {
      setOpen(toggle.getAttribute("aria-expanded") !== "true");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("is-open")) { setOpen(false); toggle.focus(); }
    });
    window.addEventListener("resize", function () {
      if (window.innerWidth > 960) setOpen(false);
    });
  }

  /* ---- Missing-image placeholder ----
     If a photo hasn't been added to /assets/img yet, show a blueprint
     grid with the filename instead of a broken-image icon. */
  document.querySelectorAll(".figure__media img, .work__frame img").forEach(function (img) {
    var mark = function () {
      var frame = img.parentElement;
      frame.classList.add("is-missing");
      frame.setAttribute("data-src", img.getAttribute("src"));
    };
    if (img.complete && img.naturalWidth === 0) mark();
    else img.addEventListener("error", mark);
  });

  /* ---- Contact form ----
     Validates required fields, then sends the message through /api/contact (worker/contact.js). If sending fails the visitor is told so and given the email address. */
  var form = document.getElementById("contact-form");
  if (!form) return;

  var success = document.getElementById("form-success");
  var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var validateField = function (input) {
    var field = input.closest(".field");
    var value = input.value.trim();
    var ok = !input.required || value.length > 0;
    if (ok && input.type === "email" && value) ok = emailPattern.test(value);
    field.classList.toggle("has-error", !ok);
    input.setAttribute("aria-invalid", String(!ok));
    return ok;
  };

  form.querySelectorAll("[required]").forEach(function (input) {
    input.addEventListener("blur", function () { if (input.value) validateField(input); });
    input.addEventListener("input", function () {
      if (input.closest(".field").classList.contains("has-error")) validateField(input);
    });
  });

  var errorBox = document.getElementById("form-error");
  var submitBtn = form.querySelector('[type="submit"]');
  var loadedAt = Date.now();
  var submissionId = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : String(loadedAt) + "-" + Math.random().toString(16).slice(2); // one id per attempt, reused on retry
  var mailto = form.dataset.mailto || "hello@frameworkco.ca";

  /* Cloudflare Turnstile spam check: shown only when the site supplies a key (the same key the assessment form uses). */
  var turnstileBox = document.getElementById("contact-turnstile");
  var turnstileToken = "", turnstileWidget = null, turnstileOn = false;
  if (turnstileBox && window.fetch) {
    window.fetch("/api/assessment/config").then(function (r) { return r.ok ? r.json() : null; }).then(function (cfg) {
      if (!cfg || !cfg.turnstileSiteKey) return;
      turnstileOn = true; turnstileBox.hidden = false;
      var s = document.createElement("script");
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true;
      s.onload = function () {
        if (!window.turnstile) return;
        turnstileWidget = window.turnstile.render(turnstileBox, { sitekey: cfg.turnstileSiteKey,
          callback: function (t) { turnstileToken = t; }, "expired-callback": function () { turnstileToken = ""; }, "error-callback": function () { turnstileToken = ""; } });
      };
      document.head.appendChild(s);
    }).catch(function () { /* no spam check available: the server decides */ });
  }
  var resetTurnstile = function () { turnstileToken = ""; if (turnstileWidget !== null && window.turnstile) { try { window.turnstile.reset(turnstileWidget); } catch (e) { /* ignore */ } } };

  var showError = function (text, link) {
    errorBox.textContent = text;
    if (link) { var a = document.createElement("a"); a.href = link.href; a.textContent = link.label; errorBox.appendChild(a); errorBox.appendChild(document.createTextNode(".")); }
    errorBox.hidden = false;
  };
  var failure = function () {
    // Honest failure: the message was not sent. Keep what they typed and offer the direct way in.
    var val = function (id) { return form.elements[id].value.trim(); };
    var href = "mailto:" + mailto + "?subject=" + encodeURIComponent("New project enquiry — frameworkco.ca") + "&body=" + encodeURIComponent(val("message"));
    showError("We couldn't send your message just now. Please try again, or email us directly at ", { href: href, label: mailto });
    submitBtn.disabled = false; resetTurnstile();
  };

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errorBox.hidden = true;

    var firstInvalid = null;
    form.querySelectorAll("[required]").forEach(function (input) {
      if (!validateField(input) && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) { firstInvalid.focus(); return; }
    if (turnstileOn && !turnstileToken) { showError("Please complete the check above, then send your message."); return; }

    var val = function (id) { return form.elements[id].value.trim(); };
    submitBtn.disabled = true;
    window.fetch("/api/contact", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: val("name"), email: val("email"), business: val("business"), project_type: val("project_type"), message: val("message"),
        hp: form.elements.hp ? form.elements.hp.value : "", turnstile_token: turnstileToken, elapsed_ms: Date.now() - loadedAt, submission_id: submissionId, page: window.location.pathname })
    }).then(function (r) {
      if (!r.ok) throw new Error("status " + r.status);
      form.hidden = true; success.hidden = false; success.focus();
      if (window.fwTrack) window.fwTrack("generate_lead", { form: "contact" });
    }).catch(failure);
  });
})();

/* ---- Device mockups (laptop + phone) on the portfolio ----
   Every .device-stage on the page gets two behaviours:
   - Phone: the .device__scroll capture travels up as the page scrolls (--p, 0 to 1), by exactly as far as it
     overflows the phone screen (--travel). A capture that fits the screen simply doesn't move.
   - Laptop: the .device__carousel button cycles through its .device__page screenshots on its own. */
(function () {
  "use strict";
  var stages = Array.prototype.slice.call(document.querySelectorAll(".device-stage"));
  if (!stages.length) return;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var clamp = function (v) { return Math.min(1, Math.max(0, v)); };

  /* ---------- Phone: scroll-driven ---------- */

  var measure = function (stage) {
    var img = stage.querySelector(".device__scroll");
    if (!img) return;
    var screen = img.parentElement;
    var top = parseFloat(window.getComputedStyle(img).marginTop) || 0;
    var travel = Math.max(0, img.getBoundingClientRect().height + top - screen.getBoundingClientRect().height);
    stage.style.setProperty("--travel", travel.toFixed(1) + "px");
  };

  var ticking = false;
  var render = function () {
    ticking = false;
    var vh = window.innerHeight || document.documentElement.clientHeight;
    stages.forEach(function (stage) {
      var p = 0;
      if (!reduce.matches) {
        var r = stage.getBoundingClientRect();
        p = clamp((0.85 * vh - (r.top + r.height / 2)) / (0.6 * vh));
      }
      stage.style.setProperty("--p", p.toFixed(4));
    });
  };
  var request = function () {
    if (!ticking) { ticking = true; window.requestAnimationFrame(render); }
  };
  var remeasure = function () { stages.forEach(measure); request(); };

  stages.forEach(function (stage) {
    var img = stage.querySelector(".device__scroll");
    if (img && !img.complete) img.addEventListener("load", remeasure);
  });
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", remeasure);
  window.addEventListener("load", remeasure);
  if (reduce.addEventListener) reduce.addEventListener("change", request);
  remeasure();
})();

/* Laptop: auto-advancing carousel of real pages. A new page fades in over the old one (which stays fully
   opaque underneath), so the screen is never blank. Click / Enter / Space advances now.
   Nothing runs until the laptop is on screen: the first page shows at once, moves on after ~1s, then every 4s. */
(function () {
  "use strict";
  var INTERVAL = 4000;
  var FIRST_DELAY = 1000;
  var FADE = 700;
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");

  Array.prototype.forEach.call(document.querySelectorAll(".device__carousel"), function (button) {
    var pages = button.querySelectorAll(".device__page");
    if (pages.length < 2) return;

    var site = button.getAttribute("data-site") || "Website";
    var index = 0;
    var top = 1;
    var timer = null;
    var visible = false;
    var started = false;
    var hovering = false;
    var focused = false;

    var label = function () {
      button.setAttribute("aria-label", site + " website preview: " + pages[index].getAttribute("data-title") +
        ", " + (index + 1) + " of " + pages.length + ". Activate to show the next page.");
    };

    var show = function (next) {
      var page = pages[next];
      top += 1;
      page.style.transition = "none";
      page.style.opacity = "0";
      page.style.zIndex = String(top);
      void page.offsetWidth;
      page.style.transition = reduce.matches ? "none" : "opacity " + FADE + "ms ease-in-out";
      page.style.opacity = "1";
      index = next;
      label();
    };

    var stop = function () { window.clearTimeout(timer); timer = null; };
    var schedule = function (delay) {
      stop();
      if (!visible || reduce.matches || hovering || focused || document.hidden) return;
      timer = window.setTimeout(function () { advance(); }, typeof delay === "number" ? delay : INTERVAL);
    };
    var advance = function () {
      show((index + 1) % pages.length);
      schedule(INTERVAL);
    };

    var onVisible = function (isVisible) {
      visible = isVisible;
      if (!visible) { stop(); return; }
      if (!started) { started = true; schedule(FIRST_DELAY); } else { schedule(INTERVAL); }
    };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        onVisible(entries[entries.length - 1].isIntersecting);
      }, { threshold: 0.4 }).observe(button);
    } else {
      onVisible(true);
    }

    button.addEventListener("click", advance);
    button.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") { hovering = true; stop(); } });
    button.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") { hovering = false; schedule(INTERVAL); } });
    /* keyboard focus pauses; a mouse click that leaves focus on the button does not */
    button.addEventListener("focus", function () {
      if (button.matches(":focus-visible")) { focused = true; stop(); }
    });
    button.addEventListener("blur", function () { focused = false; schedule(INTERVAL); });
    document.addEventListener("visibilitychange", function () { schedule(started ? INTERVAL : FIRST_DELAY); });
    if (reduce.addEventListener) reduce.addEventListener("change", function () { schedule(INTERVAL); });
  });
})();
