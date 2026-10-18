/* FRAMEWORK — privacy policy page: the control for changing the advertising-measurement choice.
   Shown only when advertising measurement is actually switched on for the site (the same public setting the
   assessment page reads). When it is not, the page says so and offers nothing to choose. */
(function () {
  "use strict";

  var none = document.getElementById("pp-none");
  var controls = document.getElementById("pp-controls");
  var status = document.getElementById("pp-status");
  var note = document.getElementById("pp-note");
  var consent = window.FrameworkConsent;
  if (!none || !controls || !consent) return;

  var buttons = Array.prototype.slice.call(controls.querySelectorAll("[data-pp]"));

  var paint = function () {
    var state = consent.get();
    var blocked = consent.browserSignal();
    status.textContent = blocked
      ? "Advertising measurement is off."
      : state === "granted" ? "Advertising measurement is allowed on the assessment page."
      : state === "denied" ? "Advertising measurement is off."
      : "You have not chosen yet, so advertising measurement is off.";
    note.hidden = !blocked;
    buttons.forEach(function (b) {
      var value = b.getAttribute("data-pp");
      b.setAttribute("aria-pressed", String(state === value));
      b.disabled = blocked && value === "granted";
    });
  };

  buttons.forEach(function (b) {
    b.addEventListener("click", function () {
      consent.set(b.getAttribute("data-pp"));
      paint();
    });
  });

  fetch("/api/assessment/config", { credentials: "same-origin" })
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (cfg) {
      if (!cfg || typeof cfg.metaPixelId !== "string" || !/^\d{5,20}$/.test(cfg.metaPixelId)) return; // not switched on
      none.hidden = true;
      controls.hidden = false;
      paint();
    })
    .catch(function () { /* leave the "not switched on" text */ });
})();
