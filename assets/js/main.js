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
     Validates required fields, then opens the visitor's email app with the message pre-filled. */
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

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var firstInvalid = null;
    form.querySelectorAll("[required]").forEach(function (input) {
      if (!validateField(input) && !firstInvalid) firstInvalid = input;
    });
    if (firstInvalid) { firstInvalid.focus(); return; }

    var val = function (id) { return form.elements[id].value.trim(); };
    var lines = ["Name: " + val("name"), "Email: " + val("email")];
    if (val("business")) lines.push("Business: " + val("business"));
    if (val("project_type")) lines.push("Project type: " + val("project_type"));
    lines.push("", val("message"));

    var href = "mailto:" + form.dataset.mailto +
      "?subject=" + encodeURIComponent("New project enquiry — frameworkco.ca") +
      "&body=" + encodeURIComponent(lines.join("\n"));

    form.hidden = true;
    success.hidden = false;
    success.focus();
    window.location.href = href;
  });
})();
