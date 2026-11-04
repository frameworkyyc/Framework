/* Brand Discovery enhancement. Optional: every step is a plain form and works without this file. It only keeps the choices tidy while a person clicks:
   picking cards switches the question back to "Choose from these", and choosing "I'm not sure" or "Surprise me" clears the cards it makes meaningless. The server applies the same rules on every save, so nothing depends on this. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var all = function (root, sel) { return Array.prototype.slice.call(root.querySelectorAll(sel)); };

  all(document, ".dq").forEach(function (q) {
    var likes = all(q, ".dc__in--like"), modes = all(q, ".dq__mode input[type=radio]");
    var setMode = function (v) { modes.forEach(function (r) { r.checked = r.value === v; }); };
    likes.forEach(function (box) {
      box.addEventListener("change", function () {
        if (!box.checked) return;
        setMode("picks");
      });
    });
    modes.forEach(function (r) {
      r.addEventListener("change", function () {
        if (!r.checked) return;
        if (r.value === "not_sure" || r.value === "surprise") likes.forEach(function (b) { b.checked = false; });
      });
    });
  });

  all(document, "[data-visual-pages]").forEach(function (question) {
    var grid = question.querySelector(".dq__grid");
    var cards = all(grid, ".dc");
    var pageSize = 4;
    var pageCount = Math.ceil(cards.length / pageSize);
    if (pageCount < 2) return;

    var page = 0;
    var controls = document.createElement("div");
    controls.className = "dq__paging";
    var status = document.createElement("p");
    status.tabIndex = -1;
    status.setAttribute("role", "status");
    grid.before(status);
    var button = function (label, action) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", action);
      controls.appendChild(b);
      return b;
    };
    var show = function (index, focus) {
      page = index;
      cards.forEach(function (card, i) {
        card.hidden = Math.floor(i / pageSize) !== page;
      });
      status.textContent = "Pick the ones you like · Set " + (page + 1) + " of " + pageCount;
      back.disabled = page === 0;
      next.disabled = page === pageCount - 1;
      if (focus) status.focus();
    };
    var back = button("Previous 4", function () { show(page - 1, true); });
    button("None of these", function () {
      cards.slice(page * pageSize, (page + 1) * pageSize).forEach(function (card) {
        card.querySelector(".dc__in--like").checked = false;
      });
      if (page < pageCount - 1) show(page + 1, true);
      else {
        status.textContent = "No choices selected in this set.";
        status.focus();
      }
    });
    var next = button("Next 4", function () { show(page + 1, true); });
    grid.after(controls);
    grid.classList.add("dq__grid--paged");
    show(0, false);
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
