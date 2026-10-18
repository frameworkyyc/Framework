/* FRAMEWORK — advertising-measurement consent (shared by the assessment page and the privacy policy page)
   Remembers the visitor's choice about Meta's advertising measurement (the Meta Pixel). It loads nothing itself.
   - Stored in this browser only (localStorage key "fw_meta_consent": "granted" or "denied"). No cookie is set.
   - A browser Global Privacy Control or Do Not Track signal always counts as "denied" and cannot be overridden here.
   - No stored choice means "not asked yet", which also means measurement stays off. */
(function () {
  "use strict";

  var KEY = "fw_meta_consent";
  var listeners = [];
  var memory = null; // used when storage is blocked (private mode): the choice then applies to this page view only

  var read = function () {
    try {
      var v = window.localStorage.getItem(KEY);
      return v === "granted" || v === "denied" ? v : null;
    } catch (e) { return null; }
  };
  var browserSignal = function () {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
  };

  window.FrameworkConsent = {
    key: KEY,
    browserSignal: browserSignal,
    // "granted" | "denied" | null (not asked yet)
    get: function () { return browserSignal() ? "denied" : read() || memory; },
    set: function (value) {
      if (value !== "granted" && value !== "denied") return;
      memory = value;
      try { window.localStorage.setItem(KEY, value); } catch (e) { /* storage blocked: memory only */ }
      listeners.forEach(function (fn) { try { fn(value); } catch (e) { /* one listener must not break the others */ } });
    },
    subscribe: function (fn) { listeners.push(fn); }
  };
})();
