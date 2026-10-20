/* Business Profile form enhancement. Optional: the form works without it, and the server always normalizes and validates.
   1. Website fields: tidies what was typed the same way the server will (trim, add https:// when there is no http:// or https://). Cosmetic only.
   2. Warns before leaving with unsaved changes and shows a Saving state.
   3. After a refused save (Business Profile, Account name, Feedback), moves keyboard focus to the error summary. */
(function (root) {
  "use strict";
  /** Same rule as withProtocol() in worker/portal/profile-schema.js. */
  function withProtocol(raw) {
    var v = String(raw == null ? "" : raw).trim();
    if (!v) return "";
    return /^https?:\/\//i.test(v) ? v.replace(/^https?:\/\//i, function (m) { return m.toLowerCase(); }) : "https://" + v;
  }
  if (root) root.FrameworkWebsite = { withProtocol: withProtocol };

  /* 3. After a refused save the page reloads at the top. Move focus to the error summary: that announces the problems, scrolls the summary into
        view (also on a phone, where the invalid field may be far below) and leaves the keyboard on its links, one Tab from each invalid field. */
  var summary = typeof document !== "undefined" && document.querySelector("[data-error-summary]");
  if (summary) {
    try { summary.focus(); } catch (err) { /* focus is a convenience: the summary is still the first thing in the form */ }
    if (typeof summary.scrollIntoView === "function") summary.scrollIntoView({ block: "start" });
  }

  var form = typeof document !== "undefined" && document.querySelector("form[data-guard]");
  if (!form) return;
  var status = form.querySelector("[data-status]");
  var button = form.querySelector("[data-save]");
  var dirty = false;
  var submitting = false;

  Array.prototype.forEach.call(form.querySelectorAll("input[data-website]"), function (input) {
    input.addEventListener("blur", function () {
      var tidy = withProtocol(input.value);
      if (tidy !== input.value) input.value = tidy;
    });
  });

  form.addEventListener("input", function () {
    dirty = true;
    if (status) status.textContent = "Unsaved changes";
  });
  form.addEventListener("submit", function () {
    submitting = true;
    if (status) status.textContent = "Saving…";
    if (button) {
      button.setAttribute("aria-disabled", "true");
      button.textContent = "Saving…";
    }
  });
  window.addEventListener("beforeunload", function (event) {
    if (dirty && !submitting) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
})(typeof window !== "undefined" ? window : null);
