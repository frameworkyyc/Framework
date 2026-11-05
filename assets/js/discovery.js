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

  /* Picture questions with many cards show four at a time. The person always sees where they are ("Reviewed 8 of 20 images, 12 left"), the last set ends in a clear
     "all reviewed" panel with one obvious way on, and nothing is lost: choices stay ticked and "Review images again" goes back to the start. Without this file every card is shown. */
  all(document, "[data-visual-pages]").forEach(function (question) {
    var grid = question.querySelector(".dq__grid");
    var cards = all(grid, ".dc");
    var pageSize = 4, total = cards.length, pageCount = Math.ceil(total / pageSize);
    if (pageCount < 2) return;

    var page = 0, seen = 0;
    var make = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
    var chosen = function () { return cards.filter(function (c) { return c.querySelector(".dc__in--like").checked; }).length; };

    var progress = make("div", "dq__progress");
    var status = make("p", "dq__status"); status.tabIndex = -1; status.setAttribute("role", "status");
    var bar = make("progress", "dq__bar"); bar.max = total; bar.setAttribute("aria-hidden", "true");
    progress.appendChild(status); progress.appendChild(bar);

    var controls = make("div", "dq__paging");
    var button = function (label, cls, action) { var b = make("button", cls, label); b.type = "button"; b.addEventListener("click", action); controls.appendChild(b); return b; };

    var done = make("div", "dq__done"); done.hidden = true; done.tabIndex = -1;
    var doneTitle = make("p", "dq__done-title"); var doneText = make("p", "dq__done-text");
    var doneActions = make("div", "dq__done-actions");
    done.appendChild(doneTitle); done.appendChild(doneText); done.appendChild(doneActions);

    var show = function (index, focus) {
      page = index;
      grid.hidden = false; controls.hidden = false; done.hidden = true;
      cards.forEach(function (card, i) { card.hidden = Math.floor(i / pageSize) !== page; });
      seen = Math.max(seen, Math.min(total, (page + 1) * pageSize));
      var first = page * pageSize + 1, last = Math.min(total, (page + 1) * pageSize), final = page === pageCount - 1;
      status.textContent = "Showing images " + first + " to " + last + " of " + total + " · Reviewed " + seen + " of " + total + " · " + (total - seen) + " left";
      bar.value = seen;
      back.disabled = page === 0;
      none.textContent = final ? "None of these, finish" : "None of these, show more";
      next.textContent = final ? "I\u2019ve seen them all" : "Next " + pageSize + " images";
      if (focus) status.focus();
    };
    var finish = function () {
      seen = total; bar.value = total;
      grid.hidden = true; controls.hidden = true; done.hidden = false;
      var n = chosen();
      status.textContent = "All " + total + " images reviewed";
      doneTitle.textContent = "That\u2019s every image";
      doneText.textContent = "You\u2019ve looked at all " + total + " images for this question, so there are no more to show. " + (n ? "You chose " + n + "." : "You didn\u2019t choose any, and that\u2019s fine.") + " Your choices are saved when you continue.";
      done.focus();
    };
    var goOn = function () {
      var sec = question.nextElementSibling;
      while (sec && !(sec.classList && sec.classList.contains("dq"))) sec = sec.nextElementSibling;
      if (sec) {
        var h = sec.querySelector(".dq__title");
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
        if (h) { h.tabIndex = -1; h.focus({ preventScroll: true }); }
        return;
      }
      var form = question.closest("form"), cont = form && form.querySelector('button[name="go"][value="next"], button[name="go"][value="submit"]');
      if (cont) cont.click();
    };

    var back = button("Previous " + pageSize, "btn btn--ghost", function () { show(page - 1, true); });
    var none = button("None of these", "btn btn--ghost", function () {
      cards.slice(page * pageSize, (page + 1) * pageSize).forEach(function (card) { card.querySelector(".dc__in--like").checked = false; });
      if (page < pageCount - 1) show(page + 1, true); else finish();
    });
    var next = button("Next " + pageSize + " images", "btn btn--primary", function () { if (page < pageCount - 1) show(page + 1, true); else finish(); });

    var again = make("button", "btn btn--ghost", "Review images again"); again.type = "button"; again.addEventListener("click", function () { show(0, true); });
    var cont = make("button", "btn btn--primary", "Continue to next section"); cont.type = "button"; cont.addEventListener("click", goOn);
    doneActions.appendChild(cont); doneActions.appendChild(again);

    grid.before(progress);
    grid.after(controls);
    controls.after(done);
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
