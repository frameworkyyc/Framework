/* Business Profile form enhancement. Optional: the form works without it. Warns before leaving with unsaved changes and shows a Saving state. */
(function () {
  var form = document.querySelector("form[data-guard]");
  if (!form) return;
  var status = form.querySelector("[data-status]");
  var button = form.querySelector("[data-save]");
  var dirty = false;
  var submitting = false;
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
})();
