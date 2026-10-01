/* FRAMEWORK — client feedback form (client-feedback.html)
   Multi-step form: validates each step, keeps every answer in the DOM while moving between steps,
   and posts one JSON submission to /api/feedback (see worker/index.js). */
(function () {
  "use strict";

  var form = document.getElementById("feedback-form");
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll(".fb-step"));
  var progressItems = Array.prototype.slice.call(form.querySelectorAll(".fb-progress__item"));
  var progressText = document.getElementById("fb-progress-text");
  var backBtn = document.getElementById("fb-back");
  var nextBtn = document.getElementById("fb-next");
  var status = document.getElementById("fb-status");
  var done = document.getElementById("fb-done");
  var stepNames = steps.map(function (s) { return s.querySelector(".fb-step__title").textContent.replace(/^\s*\d+\s*/, "").trim(); });

  var current = 0;
  var submitting = false;
  var finished = false;
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // One id per page load: if a submission is retried it can never be stored twice.
  var submissionId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "fb-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);

  var $ = function (sel, root) { return (root || form).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || form).querySelectorAll(sel)); };
  var checkedValue = function (name) { var el = $('input[name="' + name + '"]:checked'); return el ? el.value : ""; };
  var checkedValues = function (name) { return $$('input[name="' + name + '"]:checked').map(function (el) { return el.value; }); };
  var textValue = function (name) { var el = form.elements[name]; return el ? el.value.trim() : ""; };

  /* ---------- Conditional fields ---------- */

  var updateReveals = function () {
    $$("[data-reveal]").forEach(function (box) {
      var rule = box.getAttribute("data-reveal").split(":");
      var key = rule[0];
      var show = false;
      if (key === "permission") {
        var opts = $$('input[name="testimonial_permission"]');
        var idx = opts.findIndex(function (o) { return o.checked; });
        show = idx !== -1 && rule[1].split(",").indexOf(String(idx)) !== -1;
      } else {
        show = checkedValues(key).indexOf(rule[1]) !== -1;
      }
      box.hidden = !show;
    });
  };

  /* ---------- Validation ---------- */

  var other = function (key, otherName, otherLabel) {
    return checkedValues(key).indexOf(otherLabel) !== -1 && !textValue(otherName);
  };

  // Each rule returns the control that needs attention, or null when the question is fine.
  var rules = {
    satisfaction: function () { return checkedValue("satisfaction") ? null : $('input[name="satisfaction"]'); },
    ratings: function () {
      var bad = null;
      $$(".fb-row").forEach(function (row) {
        var key = "ratings_" + row.getAttribute("data-row");
        var ok = !!checkedValue(key);
        row.classList.toggle("has-error", !ok);
        if (!ok && !bad) bad = $('input[name="' + key + '"]');
      });
      return bad;
    },
    improvement: function () { return checkedValue("improvement") ? null : $('input[name="improvement"]'); },
    impact: function () {
      if (!checkedValues("impact").length) return $('input[name="impact"]');
      if (other("impact", "impact_other", "Other")) return form.elements.impact_other;
      return null;
    },
    liked: function () { return textValue("liked") ? null : form.elements.liked; },
    price: function () { return checkedValue("fair_price") ? null : $('input[name="fair_price"]'); },
    recommend: function () { return checkedValue("recommend") ? null : $('input[name="recommend"]'); },
    testimonial: function () {
      var perm = checkedValue("testimonial_permission");
      // Only ask for words if they're willing for us to use them; the next question decides that.
      return perm && perm !== "No" && !textValue("testimonial") ? form.elements.testimonial : null;
    },
    permission: function () {
      var perm = checkedValue("testimonial_permission");
      if (!perm) return $('input[name="testimonial_permission"]');
      if (perm === "Yes, with my name and business") {
        if (!textValue("attribution_name")) return form.elements.attribution_name;
        if (!textValue("attribution_business")) return form.elements.attribution_business;
      } else if (perm === "Yes, attributed to my business only" && !textValue("attribution_business")) {
        return form.elements.attribution_business;
      }
      return null;
    },
    logo: function () { return checkedValue("logo_permission") ? null : $('input[name="logo_permission"]'); },
    services: function () {
      if (!checkedValues("services").length) return $('input[name="services"]');
      if (other("services", "services_other", "Other")) return form.elements.services_other;
      return null;
    }
  };

  var errorMessages = {
    permission: function (control) { return control && control.type === "text" ? "Add your details so we can credit you." : "Choose one option."; },
    impact: function (control) { return control && control.type === "text" ? "Tell us what improved." : "Select at least one option."; },
    services: function (control) { return control && control.type === "text" ? "Tell us which service." : "Select at least one option."; }
  };

  var setError = function (q, control, bad) {
    q.classList.toggle("has-error", !!bad);
    var key = q.getAttribute("data-q");
    var err = $(".field__error", q);
    if (bad && err && errorMessages[key]) err.textContent = errorMessages[key](control);
    $$("input, textarea", q).forEach(function (el) {
      if (bad) el.setAttribute("aria-invalid", "true"); else el.removeAttribute("aria-invalid");
    });
  };

  var validateStep = function (index) {
    var first = null;
    $$(".fb-q", steps[index]).forEach(function (q) {
      var rule = rules[q.getAttribute("data-q")];
      if (!rule) return; // optional question
      var control = rule();
      setError(q, control, !!control);
      if (control && !first) first = control;
    });
    return first;
  };

  /* Clear a question's error as soon as the visitor changes it. */
  form.addEventListener("input", function (e) {
    var q = e.target.closest && e.target.closest(".fb-q");
    if (q && q.classList.contains("has-error")) {
      var rule = rules[q.getAttribute("data-q")];
      var control = rule ? rule() : null;
      setError(q, control, !!control);
    }
  });
  form.addEventListener("change", function (e) {
    updateReveals();
    var q = e.target.closest && e.target.closest(".fb-q");
    if (q && q.classList.contains("has-error")) {
      var rule = rules[q.getAttribute("data-q")];
      var control = rule ? rule() : null;
      setError(q, control, !!control);
    }
  });

  /* ---------- Steps ---------- */

  var showStep = function (index, moveFocus) {
    current = index;
    steps.forEach(function (s, i) { s.hidden = i !== index; });
    progressItems.forEach(function (li, i) {
      li.classList.toggle("is-current", i === index);
      li.classList.toggle("is-done", i < index);
      if (i === index) li.setAttribute("aria-current", "step"); else li.removeAttribute("aria-current");
    });
    progressText.textContent = "Step " + (index + 1) + " of " + steps.length + " — " + stepNames[index];
    backBtn.hidden = index === 0;
    nextBtn.textContent = index === steps.length - 1 ? "Submit feedback" : "Continue";
    status.hidden = true;
    if (moveFocus) {
      var title = $(".fb-step__title", steps[index]);
      var top = form.getBoundingClientRect().top + window.pageYOffset - 96;
      window.scrollTo(0, Math.max(0, top));
      title.focus({ preventScroll: true });
    }
  };

  var showStatus = function (message) {
    status.textContent = message;
    status.hidden = false;
  };

  backBtn.addEventListener("click", function () {
    if (submitting || current === 0) return;
    showStep(current - 1, true);
  });

  /* ---------- Submit ---------- */

  var payload = function () {
    var perm = checkedValue("testimonial_permission");
    var data = {
      id: submissionId,
      website: textValue("website"), // honeypot
      satisfaction: Number(checkedValue("satisfaction")),
      ratings: {},
      improvement: checkedValue("improvement"),
      impact: checkedValues("impact"),
      impact_other: checkedValues("impact").indexOf("Other") !== -1 ? textValue("impact_other") : "",
      fair_price: checkedValue("fair_price"),
      recommend: Number(checkedValue("recommend")),
      revenue: checkedValue("revenue"),
      liked: textValue("liked"),
      could_improve: textValue("could_improve"),
      testimonial: textValue("testimonial"),
      testimonial_permission: perm,
      attribution_name: perm === "Yes, with my name and business" ? textValue("attribution_name") : "",
      attribution_title: perm === "Yes, with my name and business" ? textValue("attribution_title") : "",
      attribution_business: perm.indexOf("Yes, with") === 0 || perm.indexOf("Yes, attributed") === 0 ? textValue("attribution_business") : "",
      logo_permission: checkedValue("logo_permission"),
      services: checkedValues("services"),
      services_other: checkedValues("services").indexOf("Other") !== -1 ? textValue("services_other") : "",
      comments: textValue("comments")
    };
    $$(".fb-row").forEach(function (row) {
      var k = row.getAttribute("data-row");
      data.ratings[k] = Number(checkedValue("ratings_" + k));
    });
    return data;
  };

  var stepOfField = function (field) {
    var map = { satisfaction: 0, ratings: 0, improvement: 0, impact: 1, impact_other: 1, liked: 1, fair_price: 2, recommend: 2, revenue: 2,
      testimonial: 3, testimonial_permission: 3, attribution_name: 3, attribution_business: 3, logo_permission: 3, services: 4, services_other: 4 };
    return map[String(field).split(".")[0]];
  };

  var submit = function () {
    if (submitting || finished) return;
    submitting = true;
    nextBtn.disabled = true;
    backBtn.disabled = true;
    nextBtn.textContent = "Sending…";
    status.hidden = true;

    var controller = window.AbortController ? new AbortController() : null;
    var timeout = window.setTimeout(function () { if (controller) controller.abort(); }, 20000);

    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload()),
      credentials: "same-origin",
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
      })
      .then(function (r) {
        if (r.res.ok) {
          finished = true;
          form.hidden = true;
          done.hidden = false;
          window.scrollTo(0, Math.max(0, done.getBoundingClientRect().top + window.pageYOffset - 140));
          done.focus({ preventScroll: true });
          return;
        }
        if (r.res.status === 422 && r.body && r.body.fields && r.body.fields.length) {
          var s = stepOfField(r.body.fields[0]);
          if (typeof s === "number") showStep(s, true);
          validateStep(current);
          showStatus("Some answers need another look before we can send this.");
        } else if (r.res.status === 429) {
          showStatus("We’re receiving a lot of responses right now. Please try again in a few minutes.");
        } else {
          showStatus("Your feedback didn’t send. Please try again, or email it to hello@frameworkco.ca.");
        }
        throw new Error("not sent");
      })
      .catch(function (err) {
        if (!finished && status.hidden) showStatus("Your feedback didn’t send. Check your connection and try again, or email it to hello@frameworkco.ca.");
        return err;
      })
      .then(function () {
        window.clearTimeout(timeout);
        if (finished) return;
        submitting = false;
        nextBtn.disabled = false;
        backBtn.disabled = false;
        nextBtn.textContent = current === steps.length - 1 ? "Submit feedback" : "Continue";
      });
  };

  /* Continue / Submit (also handles Enter inside a text field) */
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (submitting || finished) return;
    var bad = validateStep(current);
    if (bad) {
      bad.focus({ preventScroll: false });
      if (bad.scrollIntoView && !reduceMotion) bad.scrollIntoView({ block: "center" });
      return;
    }
    if (current < steps.length - 1) { showStep(current + 1, true); return; }
    submit();
  });

  updateReveals();
  showStep(0, false);
})();
