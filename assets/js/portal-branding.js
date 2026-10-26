/* Branding page enhancement. Optional: sections open and close natively and every colour code is plain selectable text without it.
   Reveals the "Copy" buttons next to colour codes and copies the code to the clipboard, announcing the result politely. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  /* Accordion sections arrive closed (compact on a phone). On a wide screen open them all; a link to a section (#colours) opens that section on any screen. */
  var sections = document.querySelectorAll("details.acc");
  function openFromHash() {
    var id = (location.hash || "").slice(1), target = id && document.getElementById(id);
    if (target && target.tagName === "DETAILS") target.open = true;
  }
  if (sections.length && window.matchMedia && window.matchMedia("(min-width: 900px)").matches) Array.prototype.forEach.call(sections, function (d) { d.open = true; });
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
  var buttons = document.querySelectorAll("[data-copy]");
  if (!buttons.length || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
  var live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.hidden = false;
    btn.addEventListener("click", function () {
      var value = btn.getAttribute("data-copy");
      navigator.clipboard.writeText(value).then(function () {
        live.textContent = "Copied " + value;
        var label = btn.firstChild;
        var was = label.nodeValue;
        label.nodeValue = "Copied";
        setTimeout(function () { label.nodeValue = was; }, 1600);
      }, function () { live.textContent = "Couldn’t copy. Select the code to copy it."; });
    });
  });
})();
