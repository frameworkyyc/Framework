/* Branding page enhancement. Optional: sections open and close natively and every colour code is plain selectable text without it.
   Reveals the "Copy" buttons next to colour codes and copies the code to the clipboard, announcing the result politely. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  /* Older links to a section of the single Branding page (/branding#colours and the like) land on the matching view of the four-option hub. */
  (function () {
    var m = /^(.*\/branding)\/?$/.exec(location.pathname), h = (location.hash || "").slice(1);
    if (!m || !h) return;
    var to = /^logo/.test(h) ? "/logos" : /^typography/.test(h) ? "/typography" : /^colours?$/.test(h) ? "/colours" : /^(tagline|imagery|layout|textures|iconography|style|guidelines|additional|h-kit|h-more)/.test(h) ? "/brand-kit" : "";
    if (to) location.replace(m[1] + to);
  })();
  /* Accordion sections arrive closed on every screen; the client opens the ones they want. A link to a section (#colours) opens that section. */
  function openFromHash() {
    var id = (location.hash || "").slice(1), target = id && document.getElementById(id);
    if (target && target.tagName === "DETAILS") target.open = true;
  }
  openFromHash();
  window.addEventListener("hashchange", openFromHash);
  /* A specimen is set in the client's own font file, and the page must not present a fallback font as the brand's typeface. So the card says "fallback" only when the font
     genuinely fails: every font face of that family reports a load error. It never says so just because the browser matched no face for a particular weight or style, and
     it puts the real-font state back if a face loads. (The generated .sp-* classes already carry the family; this only keeps the card's note and frame truthful.) */
  Array.prototype.forEach.call(document.querySelectorAll("[data-font-check]"), function (note) {
    var family = note.getAttribute("data-font-check");
    var stage = note.closest("li") && note.closest("li").querySelector(".tf-card__stage");
    function fail() {
      note.textContent = note.getAttribute("data-fail");
      if (stage) stage.classList.add("tf-card__stage--fallback");
    }
    function ok() {
      note.textContent = note.getAttribute("data-ok");
      if (stage) stage.classList.remove("tf-card__stage--fallback");
    }
    if (!document.fonts || typeof Array.from !== "function") return;
    var faces = Array.from(document.fonts).filter(function (f) { return String(f.family).replace(/^["']|["']$/g, "") === family; });
    if (!faces.length) return; /* nothing to judge: leave the card as the server rendered it */
    Promise.all(faces.map(function (f) { return f.load().then(function () { return true; }, function () { return false; }); })).then(function (r) { return r.some(Boolean) ? ok() : fail(); });
  });
  var buttons = document.querySelectorAll("[data-copy]");
  if (!buttons.length || !navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return;
  var live = document.createElement("p");
  live.className = "visually-hidden";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.appendChild(live);
  /* A visible "Copied" confirmation next to the code as well (tap-to-copy on a phone has no hover state to show it worked). */
  function flash(btn, text) {
    var host = (btn.closest && (btn.closest(".swatch__body") || (btn.closest(".swatch") && btn.closest(".swatch").querySelector(".swatch__body")))) || btn.parentNode;
    var tag = host.querySelector(".copied");
    if (!tag) { tag = document.createElement("span"); tag.className = "copied"; tag.setAttribute("aria-hidden", "true"); host.appendChild(tag); }
    tag.textContent = text; tag.classList.add("copied--on");
    clearTimeout(tag._t); tag._t = setTimeout(function () { tag.classList.remove("copied--on"); }, 1800);
  }
  function copy(btn) {
    var value = btn.getAttribute("data-copy");
    navigator.clipboard.writeText(value).then(function () {
      live.textContent = "Copied " + value;
      flash(btn, "Copied " + value);
      var label = btn.firstChild;
      if (label && label.nodeType === 3 && btn.classList.contains("copy")) { var was = label.nodeValue; label.nodeValue = "Copied"; setTimeout(function () { label.nodeValue = was; }, 1600); }
    }, function () { live.textContent = "Couldn’t copy. Select the code to copy it."; flash(btn, "Select the code to copy"); });
  }
  Array.prototype.forEach.call(buttons, function (btn) {
    btn.hidden = false;
    btn.addEventListener("click", function () { copy(btn); });
  });
  /* Tap-to-copy: the colour chip itself copies the HEX code (the chip stays a plain picture without script). */
  Array.prototype.forEach.call(document.querySelectorAll(".swatch"), function (sw) {
    var chip = sw.querySelector(".swatch__chip"), hexBtn = sw.querySelector("button.copy[data-copy^='#']");
    if (!chip || !hexBtn) return;
    var tap = document.createElement("button");
    tap.type = "button"; tap.className = "swatch__tap"; tap.setAttribute("data-copy", hexBtn.getAttribute("data-copy"));
    tap.setAttribute("aria-label", "Copy " + hexBtn.getAttribute("data-copy"));
    chip.parentNode.insertBefore(tap, chip); tap.appendChild(chip);
    tap.addEventListener("click", function () { copy(tap); });
  });
})();
