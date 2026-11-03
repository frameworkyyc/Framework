/* Brand Discovery enhancement. Optional: every step is a plain form and works without this file. It only keeps the choices tidy while a person clicks:
   liking a card clears "Not for me" on it (and the other way round), picking cards switches the question back to "Choose from these", and choosing
   "I'm not sure" or "Surprise me" clears the cards it makes meaningless. The server applies the same rules on every save, so nothing depends on this. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var all = function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  all(document, ".dq").forEach(function (q) {
    var likes = all(q, ".dc__in--like"), nos = all(q, ".dc__in--no"), modes = all(q, ".dq__mode input[type=radio]");
    var setMode = function (v) { modes.forEach(function (r) { r.checked = r.value === v; }); };
    likes.forEach(function (box) {
      box.addEventListener("change", function () {
        if (!box.checked) return;
        var no = box.parentNode.querySelector(".dc__in--no");
        if (no) no.checked = false;
        setMode("picks");
      });
    });
    nos.forEach(function (box) {
      box.addEventListener("change", function () {
        if (!box.checked) return;
        var like = box.parentNode.querySelector(".dc__in--like");
        if (like) like.checked = false;
        var current = modes.filter(function (r) { return r.checked; })[0];
        if (current && current.value === "not_sure") setMode("picks");
      });
    });
    modes.forEach(function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        if (r.value === "not_sure" || r.value === "surprise") likes.forEach(function (b) { b.checked = false; });
        if (r.value === "not_sure") nos.forEach(function (b) { b.checked = false; });
      });
    });
  });

  /* A second click on a submit button while the page is being saved would repeat the save: ignore it. */
  all(document, "form.dsc__form").forEach(function (form) {
    form.addEventListener("submit", function (ev) {
      if (form.getAttribute("data-busy") === "1") { ev.preventDefault(); return; }
      form.setAttribute("data-busy", "1");
      window.setTimeout(function () { form.removeAttribute("data-busy"); }, 8000);
    });
  });
})();
