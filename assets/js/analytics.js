/* FRAMEWORK — website analytics (Google Analytics 4), consent first. Reads the Measurement ID from analytics-config.js.
   - No ID set: this script does nothing at all (no request, no cookie, no storage, no banner, no console output).
   - ID set: nothing is requested from Google until the visitor clicks Allow. The choice is kept in this browser only (localStorage key
     "fw_analytics_consent"; no cookie of ours). A browser Global Privacy Control or Do Not Track signal always counts as "denied".
     "Privacy preferences" in the footer lets the visitor change their mind.
   - Even when allowed: Google signals and ad personalization are switched off, and only these things are measured: page views and the
     events below. Nothing from a form (names, emails, messages) is ever sent.
   Events (see worker/SEO.md): assessment_cta (a click on a link marked data-track="assessment_cta"), contact_cta, generate_lead (a form was
   successfully sent; parameter "form" is "contact" or "assessment"). window.fwTrack(name, params) sends one; it is a no-op without consent. */
(function () {
  "use strict";

  var cfg = window.FRAMEWORK_ANALYTICS || {};
  var id = typeof cfg.ga4 === "string" && /^G-[A-Z0-9]{4,}$/.test(cfg.ga4) ? cfg.ga4 : "";
  window.fwTrack = function () {}; // replaced below only when an ID is configured
  if (!id) return;

  var KEY = "fw_analytics_consent";
  var memory = null; // when storage is blocked the choice lasts for this page view only
  var loaded = false;
  var bar = null;

  var signal = function () { return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1"; };
  var read = function () { try { var v = window.localStorage.getItem(KEY); return v === "granted" || v === "denied" ? v : null; } catch (e) { return null; } };
  var state = function () { return signal() ? "denied" : read() || memory; };
  var store = function (value) { memory = value; try { window.localStorage.setItem(KEY, value); } catch (e) { /* memory only */ } };

  var gtag = function () { window.dataLayer.push(arguments); };

  var load = function () {
    if (loaded) { gtag("consent", "update", { analytics_storage: "granted" }); window["ga-disable-" + id] = false; return; }
    loaded = true;
    window.dataLayer = window.dataLayer || [];
    gtag("consent", "default", { analytics_storage: "granted", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
    gtag("js", new Date());
    gtag("config", id, { allow_google_signals: false, allow_ad_personalization_signals: false });
    var s = document.createElement("script");
    s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(id);
    document.head.appendChild(s);
  };

  var stop = function () {
    window["ga-disable-" + id] = true;
    if (loaded) gtag("consent", "update", { analytics_storage: "denied" });
  };

  window.fwTrack = function (name, params) {
    if (state() !== "granted" || !loaded || typeof name !== "string") return;
    var p = { transport_type: "beacon" };
    for (var k in params) if (Object.prototype.hasOwnProperty.call(params || {}, k)) p[k] = params[k];
    gtag("event", name, p);
  };

  var hideBar = function () { if (bar) bar.hidden = true; };
  var choose = function (value) {
    store(value); hideBar();
    if (value === "granted") load(); else stop();
    var prefs = document.getElementById("fw-prefs"); if (prefs) prefs.focus();
  };

  var showBar = function (focus) {
    if (signal()) return;
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "fw-consent"; bar.id = "fw-consent"; bar.setAttribute("role", "region"); bar.setAttribute("aria-labelledby", "fw-consent-title");
      bar.innerHTML = '<p><strong id="fw-consent-title">Website analytics</strong>May we use Google Analytics to see which pages are useful and how people find us? It stays off unless you allow it, and it never affects how the site works. <a href="/privacy#analytics">How it works</a></p>' +
        '<div class="fw-consent__actions"><button class="btn btn--secondary" type="button" data-fw-consent="granted">Allow</button><button class="btn btn--secondary" type="button" data-fw-consent="denied">No thanks</button></div>';
      bar.addEventListener("click", function (e) { var b = e.target.closest("[data-fw-consent]"); if (b) choose(b.getAttribute("data-fw-consent")); });
      document.body.appendChild(bar);
    }
    bar.hidden = false;
    if (focus) { var first = bar.querySelector("[data-fw-consent]"); if (first) first.focus(); }
  };

  var addPrefsLink = function () {
    var base = document.querySelector(".site-footer__base");
    if (!base || document.getElementById("fw-prefs") || signal()) return;
    var b = document.createElement("button");
    b.type = "button"; b.id = "fw-prefs"; b.className = "fw-prefs"; b.textContent = "Privacy preferences";
    b.addEventListener("click", function () { showBar(true); });
    base.appendChild(b);
  };

  // Clicks on links marked data-track (assessment and contact prompts).
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("[data-track]") : null;
    if (!el) return;
    window.fwTrack(el.getAttribute("data-track"), { location: el.getAttribute("data-track-location") || "page", link_path: (el.getAttribute("href") || "").split("#")[0].slice(0, 100) });
  });

  window.fwAnalytics = { id: id, state: state };

  var start = function () {
    addPrefsLink();
    var s = state();
    if (s === "granted") load();
    else if (s === null) showBar(false);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
