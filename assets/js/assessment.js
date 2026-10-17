/* FRAMEWORK — Free Online Presence Assessment page (/assessment)
   - validates and submits the request form to POST /api/assessment (nothing is shown as "received" until the
     server says so; inputs are kept on any failure; the button locks while a request is in flight)
   - Cloudflare Turnstile and the Meta Pixel switch on only when /api/assessment/config supplies their IDs;
     the Pixel additionally needs the visitor's consent, and its Lead event fires only after a confirmed submission
   - small page behaviour: scroll reveal, mobile sticky call-to-action */
(function () {
  "use strict";

  var form = document.getElementById("assessment-form");
  if (!form) return;

  var pageLoadedAt = Date.now();
  var $ = function (id) { return document.getElementById(id); };
  var submitBtn = $("as-submit");
  var statusBox = $("as-status");
  var successBox = $("as-success");
  var turnstileBox = $("as-turnstile");

  var store = {
    get: function (k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
    sget: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
    sset: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  /* ---------------------------------------------------------------- campaign attribution */

  var TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];
  var attribution = (function () {
    var saved = {};
    try { saved = JSON.parse(store.sget("fw_attribution") || "{}") || {}; } catch (e) { saved = {}; }
    var params = new URLSearchParams(window.location.search);
    var found = false;
    TRACKING_KEYS.forEach(function (k) {
      var v = params.get(k);
      if (v) { saved[k] = v.slice(0, 150); found = true; }
    });
    var ref = "";
    try { ref = document.referrer ? new URL(document.referrer).origin : ""; } catch (e) { ref = ""; }
    if (!saved._landing) { saved._landing = (window.location.pathname + window.location.search).slice(0, 200); }
    if (!saved._referrer && ref && ref !== window.location.origin) { saved._referrer = ref; }
    if (found || !store.sget("fw_attribution")) store.sset("fw_attribution", JSON.stringify(saved));
    return saved;
  })();

  /* ---------------------------------------------------------------- validation (mirrors the server) */

  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

  var validEmail = function (v) { return v.length <= 254 && EMAIL_RE.test(v) && v.indexOf("..") === -1 && !/^\.|\.@|@\./.test(v); };

  var validWebsite = function (input) {
    var s = input.trim();
    if (!s || s.length > 300 || /\s/.test(s)) return false;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { if (!/^https?:\/\//i.test(s)) return false; }
    else if (/^(javascript|data|vbscript|file|mailto|tel|blob):/i.test(s)) return false;
    else s = "https://" + s;
    var url;
    try { url = new URL(s); } catch (e) { return false; }
    if (url.username || url.password) return false;
    var host = url.hostname.toLowerCase();
    if (host === "localhost" || /^\d+(\.\d+){3}$/.test(host) || host.indexOf(":") !== -1) return false;
    var labels = host.split(".");
    if (labels.length < 2) return false;
    for (var i = 0; i < labels.length; i++) { if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(labels[i])) return false; }
    return /^([a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1]);
  };

  var validPhone = function (v) {
    return /^[0-9+()\-.\s]+(ext\.?\s?\d{1,6})?$/i.test(v) && v.replace(/\D/g, "").length >= 7 && v.replace(/\D/g, "").length <= 15;
  };

  var value = function (name) { return (form.elements[name].value || "").trim(); };

  var checks = [
    ["business_name", function () { return value("business_name") ? "" : "Enter your business name."; }],
    ["website", function () {
      var v = value("website");
      if (!v) return "Enter your website address.";
      return validWebsite(v) ? "" : "Enter a valid website address, like yourcompany.ca.";
    }],
    ["contact_name", function () { return value("contact_name") ? "" : "Enter your name."; }],
    ["email", function () {
      var v = value("email");
      if (!v) return "Enter your business email address.";
      return validEmail(v) ? "" : "Enter an email address like name@company.ca.";
    }],
    ["location", function () { return value("location") ? "" : "Enter your city and province."; }],
    ["industry", function () { return value("industry") ? "" : "Tell us what type of business you run."; }],
    ["phone", function () {
      var v = value("phone");
      return !v || validPhone(v) ? "" : "Enter a phone number we can reach you on, or leave this blank.";
    }],
    ["privacy_ack", function () { return form.elements.privacy_ack.checked ? "" : "Please confirm this so we can prepare your assessment."; }]
  ];

  var fieldEl = function (name) { return form.querySelector('[data-field="' + name + '"]'); };
  var inputOf = function (name) { return form.elements[name]; };

  var setError = function (name, message) {
    var field = fieldEl(name);
    var input = inputOf(name);
    if (!field || !input) return;
    var err = field.querySelector(".field__error");
    field.classList.toggle("has-error", !!message);
    if (err) err.textContent = message || "";
    if (message) input.setAttribute("aria-invalid", "true"); else input.removeAttribute("aria-invalid");
  };

  var validate = function () {
    var firstBad = null;
    checks.forEach(function (c) {
      var message = c[1]();
      setError(c[0], message);
      if (message && !firstBad) firstBad = c[0];
    });
    return firstBad;
  };

  // Re-check a field as soon as the visitor leaves it or edits one that already shows an error.
  checks.forEach(function (c) {
    var input = inputOf(c[0]);
    if (!input) return;
    var recheck = function () { setError(c[0], c[1]()); };
    input.addEventListener("blur", function () { if (input.value || fieldEl(c[0]).classList.contains("has-error")) recheck(); });
    input.addEventListener(input.type === "checkbox" ? "change" : "input", function () {
      if (fieldEl(c[0]).classList.contains("has-error")) recheck();
    });
  });

  /* ---------------------------------------------------------------- status + success */

  var showStatus = function (message) {
    statusBox.textContent = message;
    statusBox.hidden = !message;
  };

  var uuid = function () {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    var bytes = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.prototype.map.call(bytes, function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
  };
  // One id per attempt, reused for retries so a flaky network can never create a duplicate request.
  var submissionId = uuid();

  /* ---------------------------------------------------------------- Meta Pixel (consent-gated) */

  var pixelId = null;
  var pixelLoaded = false;
  var consentBar = $("as-consent");

  var consentState = function () {
    if (navigator.globalPrivacyControl === true || navigator.doNotTrack === "1") return "denied";
    return store.get("fw_meta_consent"); // "granted" | "denied" | null
  };

  var loadPixel = function () {
    if (pixelLoaded || !pixelId || consentState() !== "granted") return;
    pixelLoaded = true;
    /* eslint-disable */
    !function (f, b, e, v, n, t, s) {
      if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); };
      if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = [];
      t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
    }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
    /* eslint-enable */
    window.fbq("init", pixelId);
    window.fbq("track", "PageView");
  };

  var setupConsent = function () {
    if (!pixelId) return; // no Pixel configured: nothing to ask, nothing loads
    var state = consentState();
    if (state === "granted") { loadPixel(); return; }
    if (state === "denied" || !consentBar) return;
    consentBar.hidden = false;
    Array.prototype.forEach.call(consentBar.querySelectorAll("[data-consent]"), function (btn) {
      btn.addEventListener("click", function () {
        store.set("fw_meta_consent", btn.getAttribute("data-consent"));
        consentBar.hidden = true;
        loadPixel();
        syncSticky();
      });
    });
    syncSticky();
  };

  // The conversion: only ever called after the server has confirmed the request.
  var trackLead = function (id) {
    if (!pixelLoaded || !window.fbq) return;
    window.fbq("track", "Lead", { content_name: "Online Presence Assessment" }, { eventID: id });
  };

  /* ---------------------------------------------------------------- Turnstile (when configured) */

  var turnstileToken = "";
  var turnstileWidget = null;
  var turnstileEnabled = false;

  var setupTurnstile = function (siteKey) {
    if (!siteKey) return;
    turnstileEnabled = true;
    turnstileBox.hidden = false;
    var script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.onload = function () {
      if (!window.turnstile) return;
      turnstileWidget = window.turnstile.render(turnstileBox, {
        sitekey: siteKey,
        callback: function (token) { turnstileToken = token; },
        "expired-callback": function () { turnstileToken = ""; },
        "error-callback": function () { turnstileToken = ""; }
      });
    };
    document.head.appendChild(script);
  };

  var resetTurnstile = function () {
    turnstileToken = "";
    if (turnstileWidget !== null && window.turnstile) { try { window.turnstile.reset(turnstileWidget); } catch (e) { /* ignore */ } }
  };

  fetch("/api/assessment/config", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (cfg) {
      if (!cfg) return;
      setupTurnstile(cfg.turnstileSiteKey);
      pixelId = typeof cfg.metaPixelId === "string" && /^\d{5,20}$/.test(cfg.metaPixelId) ? cfg.metaPixelId : null;
      setupConsent();
    })
    .catch(function () { /* optional extras stay off */ });

  /* ---------------------------------------------------------------- submit */

  var busy = false;

  var setBusy = function (on) {
    busy = on;
    submitBtn.disabled = on;
    submitBtn.setAttribute("aria-busy", on ? "true" : "false");
    submitBtn.textContent = on ? "Sending…" : "Request My Free Assessment";
  };

  var FRIENDLY = {
    try_again: "That went through a little too fast. Please try again.",
    try_again_later: "We’ve had a lot of requests from this connection. Please try again a little later, or email info@frameworkco.ca.",
    verification_failed: "We couldn’t confirm you’re human. Please complete the check and try again.",
    verification_unavailable: "We couldn’t run the spam check just now. Please try again in a moment.",
    forbidden: "Something went wrong with this request. Please reload the page and try again."
  };
  var GENERIC_FAILURE = "We couldn’t send your request just now, and it has not been received. Your answers are still here — please try again, or email info@frameworkco.ca.";

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (busy) return;
    showStatus("");

    var firstBad = validate();
    if (firstBad) {
      var bad = inputOf(firstBad);
      bad.focus();
      if (bad.scrollIntoView) bad.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    if (turnstileEnabled && !turnstileToken) {
      showStatus("Please complete the spam check below, then submit again.");
      return;
    }

    var payload = {
      business_name: value("business_name"),
      website: value("website"),
      contact_name: value("contact_name"),
      email: value("email"),
      location: value("location"),
      industry: value("industry"),
      phone: value("phone"),
      services: value("services"),
      service_area: value("service_area"),
      profiles: value("profiles"),
      concern: value("concern"),
      additional_info: value("additional_info"),
      privacy_ack: form.elements.privacy_ack.checked,
      marketing_opt_in: form.elements.marketing_opt_in.checked,
      submission_id: submissionId,
      elapsed_ms: Date.now() - pageLoadedAt,
      hp: form.elements.fax_number.value,
      turnstile_token: turnstileToken,
      tracking: {},
      landing: attribution._landing || "",
      referrer: attribution._referrer || ""
    };
    TRACKING_KEYS.forEach(function (k) { if (attribution[k]) payload.tracking[k] = attribution[k]; });

    setBusy(true);
    fetch("/api/assessment", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
      })
      .then(function (r) {
        if (r.status === 200 && r.body && r.body.ok === true) {
          var sentId = submissionId;
          form.hidden = true;
          successBox.hidden = false;
          successBox.focus();
          if (successBox.scrollIntoView) successBox.scrollIntoView({ block: "center", behavior: "smooth" });
          trackLead(sentId); // only after the server confirmed the request
          submissionId = uuid();
          return;
        }
        setBusy(false);
        if (r.status === 422 && r.body && r.body.fields) {
          var first = null;
          Object.keys(r.body.fields).forEach(function (name) {
            if (fieldEl(name)) { setError(name, r.body.fields[name]); if (!first) first = name; }
          });
          if (first) { inputOf(first).focus(); return; }
        }
        if (r.body && (r.body.error === "verification_failed" || r.body.error === "verification_unavailable")) resetTurnstile();
        showStatus((r.body && FRIENDLY[r.body.error]) || GENERIC_FAILURE);
      })
      .catch(function () {
        setBusy(false);
        showStatus(GENERIC_FAILURE);
      });
  });

  /* ---------------------------------------------------------------- page behaviour */

  // Scroll reveal. Without IntersectionObserver everything is simply shown.
  var revealEls = Array.prototype.slice.call(document.querySelectorAll("[data-reveal]"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    revealEls.forEach(function (el) { io.observe(el); });
  } else {
    revealEls.forEach(function (el) { el.classList.add("is-in"); });
  }

  // Mobile sticky CTA: shown once the hero buttons have scrolled away, hidden again while the form is on screen.
  var sticky = $("as-sticky");
  var heroCta = document.querySelector('[data-cta="hero"]');
  var formSection = $("request");
  var heroGone = false;
  var formVisible = false;
  var syncSticky = function () {
    if (!sticky) return;
    var consentOpen = consentBar && !consentBar.hidden;
    sticky.hidden = !(heroGone && !formVisible && !consentOpen);
  };
  if (sticky && heroCta && formSection && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      var e = entries[entries.length - 1];
      heroGone = !e.isIntersecting; // hero button out of view (below the fold on small phones, or scrolled past)
      syncSticky();
    }).observe(heroCta);
    new IntersectionObserver(function (entries) {
      formVisible = entries[entries.length - 1].isIntersecting;
      syncSticky();
    }, { threshold: 0.05 }).observe(formSection);
  }
})();
