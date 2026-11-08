/* FRAMEWORK — site scripts */

/* ---- How this visit began (original landing page, latest campaign, referring site) ----
   One record per VISIT, shared by all tabs of this browser, kept in local storage under "fw_visit" and discarded after 30 minutes without activity on
   this site (a visit ends when you stop browsing, not when a tab closes). It is sent to Framework only if the visitor submits the contact or assessment
   form, so an enquiry can be traced to where it came from. No cookie, nothing sent from here. This is the only place it is written.
   - Original visit (first touch, never replaced during the visit): the page path WITHOUT any query string, and the referring site's address (origin only).
   - Latest campaign (utm_*, gclid, fbclid): a new campaign link REPLACES the previous campaign completely, together with its own landing page path
     (again without query string) and its own referring site, so two campaigns are never blended.
   A browser that sends Global Privacy Control or Do Not Track gets none of this: nothing is recorded and anything already kept is cleared.
   If local storage is blocked the visit falls back to this tab's session storage; if both are blocked the enquiry simply carries no source. */
(function () {
  "use strict";
  var KEY = "fw_visit", LEGACY = "fw_attribution", IDLE_MS = 30 * 60 * 1000;
  var CAMPAIGN = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
  var areas = function () { var out = []; try { out.push(window.localStorage); } catch (e) { /* blocked */ } try { out.push(window.sessionStorage); } catch (e) { /* blocked */ } return out; };
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") {
    areas().forEach(function (st) { try { st.removeItem(KEY); st.removeItem(LEGACY); } catch (e) { /* ignore */ } });
    return;
  }
  var now = Date.now();
  var read = function () {
    var list = areas();
    for (var i = 0; i < list.length; i++) {
      try { var v = JSON.parse(list[i].getItem(KEY) || "null"); if (v && typeof v === "object") return v; } catch (e) { /* try the next */ }
    }
    return {};
  };
  try {
    var saved = read();
    if (!(now - (Number(saved._seen) || 0) <= IDLE_MS)) saved = {}; // idle for more than 30 minutes (or unreadable): a new visit
    var params = new URLSearchParams(window.location.search), campaign = {}, found = false;
    CAMPAIGN.forEach(function (k) { var v = params.get(k); if (v) { campaign[k] = v.slice(0, 150); found = true; } });
    var path = window.location.pathname.slice(0, 200), ref = "";
    try { ref = document.referrer ? new URL(document.referrer).origin : ""; } catch (e) { ref = ""; }
    if (ref === window.location.origin) ref = "";
    if (!saved._landing) { saved._landing = path; if (ref) saved._referrer = ref; }
    if (found) {
      CAMPAIGN.concat(["_campaign_landing", "_campaign_referrer"]).forEach(function (k) { delete saved[k]; });
      Object.keys(campaign).forEach(function (k) { saved[k] = campaign[k]; });
      saved._campaign_landing = path;
      if (ref) saved._campaign_referrer = ref;
    }
    saved._seen = now;
    var text = JSON.stringify(saved), stored = false;
    areas().forEach(function (st) { try { if (!stored) { st.setItem(KEY, text); stored = true; } } catch (e) { /* try the next */ } });
    areas().forEach(function (st) { try { st.removeItem(LEGACY); } catch (e) { /* ignore */ } }); // the earlier per-tab record, if any
  } catch (e) { /* the enquiry simply carries no source */ }
})();

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
  // The visit record for the form, without its bookkeeping. Empty for Global Privacy Control / Do Not Track, and for a visit idle for 30+ minutes.
  var attribution = function () {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1" || window.doNotTrack === "1") return {};
    var st = [], rec = {};
    try { st.push(window.localStorage); } catch (e) { /* blocked */ }
    try { st.push(window.sessionStorage); } catch (e) { /* blocked */ }
    for (var i = 0; i < st.length; i++) {
      try { var v = JSON.parse(st[i].getItem("fw_visit") || "null"); if (v && typeof v === "object") { rec = v; break; } } catch (e) { /* next */ }
    }
    if (!(Date.now() - (Number(rec._seen) || 0) <= 30 * 60 * 1000)) return {};
    delete rec._seen;
    return rec;
  };

  /* Arriving from a demo website ("Make it yours"): pre-fill the business name and say which demo they liked. */
  (function () {
    // The company name comes from this tab's session (set by the demo pages), not from the URL, so it is never in a link or a server log.
    var saved = {}; try { saved = JSON.parse(window.sessionStorage.getItem("fw_demo") || "{}") || {}; } catch (e) { saved = {}; }
    var q = new URLSearchParams(window.location.search), biz = String(saved.n || q.get("business") || "").replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, 60);
    var demos = { "fence-deck": "Fence & Decks", landscaping: "Landscaping", renovations: "Renovations / Restoration", "general-contractor": "General Contracting" };
    var vibes = { rugged: "rugged", modern: "modern", minimal: "minimal", friendly: "friendly" };
    var demoKey = q.get("demo") || saved.d, demo = demos[demoKey], vibe = vibes[saved.v], bizInput = document.getElementById("business"), msg = document.getElementById("message");
    if (biz && bizInput && !bizInput.value) bizInput.value = biz;
    if (demo && msg && !msg.value) msg.value = "I'd like a website like the " + demo + " demo" + (vibe ? " in the " + vibe + " style" : "") + (biz ? ", made for " + biz : "") + ".";
  })();

  /* The demo pages' private visit id (a random value in this tab's session), so Framework can see that a demo visit led to this enquiry.
     Respects Do Not Track and Global Privacy Control; nothing from this form is stored with it (worker/DEMO-TRAFFIC.md). */
  var demoJourney = function () {
    if (navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.globalPrivacyControl === true) return "";
    try { var j = window.sessionStorage.getItem("fw_dj") || ""; return /^[A-Za-z0-9_-]{22}$/.test(j) ? j : ""; } catch (e) { return ""; }
  };

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
        hp: form.elements.hp ? form.elements.hp.value : "", turnstile_token: turnstileToken, elapsed_ms: Date.now() - loadedAt, submission_id: submissionId, page: window.location.pathname, journey: demoJourney(), attribution: attribution() })
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
