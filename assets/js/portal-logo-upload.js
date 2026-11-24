/* Branding > Logos: the upload review sheet. Optional enhancement of a plain multipart form (the form works without this file).
   Choosing files opens a sheet with one row per file: a preview where the browser can draw one, the name and size, a note when a file looks wrong, and the three optional
   details (logo type, colour, background). Upload sends the form as it is; Cancel clears the choice. Previews are data: URLs read here (the portal's policy allows data: images,
   never blob:), and only for small pictures. Nothing is sent until Upload is pressed, and the server checks every file again. */
(function () {
  "use strict";
  if (typeof document === "undefined") return;
  var form = document.getElementById("lg-form");
  if (!form) return;
  var input = document.getElementById("lg-files");
  var sheet = document.getElementById("lg-sheet");
  var list = document.getElementById("lg-list");
  var tpl = document.getElementById("lg-row-template");
  var status = document.getElementById("lg-status");
  var submit = document.getElementById("lg-submit");
  var cancel = document.getElementById("lg-cancel");
  if (!input || !sheet || !list || !tpl || !window.FileReader || !window.DataTransfer) return;
  form.classList.add("lg-form--js");
  /* The plain fallback (one file with its three details) is removed, not hidden: its fields share names and ids with the sheet's rows and must not be sent twice. */
  var plain = form.querySelector(".lg-nojs");
  if (plain && plain.parentNode) plain.parentNode.removeChild(plain);
  var maxBytes = parseInt(form.getAttribute("data-max-bytes") || "0", 10) || 0;
  var maxFiles = parseInt(form.getAttribute("data-max-files") || "10", 10) || 10;
  var PICTURES = /\.(png|jpe?g|webp|svg)$/i;
  var OK = /\.(png|jpe?g|webp|svg|pdf|ai|eps|zip)$/i;
  var files = [];
  var opener = null;

  function size(n) { return n < 1024 ? n + " B" : n < 1048576 ? Math.round(n / 1024) + " KB" : (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + " MB"; }
  function problem(f) {
    if (!OK.test(f.name)) return "This kind of file can’t be uploaded here.";
    if (f.size === 0) return "This file is empty.";
    if (maxBytes && f.size > maxBytes) return "This file is over " + size(maxBytes) + ".";
    return "";
  }
  function sync() {
    var dt = new DataTransfer();
    files.forEach(function (f) { dt.items.add(f); });
    input.files = dt.files;
  }
  function render() {
    list.textContent = "";
    var bad = 0;
    files.forEach(function (f, i) {
      var row = tpl.content.firstElementChild.cloneNode(true);
      row.querySelectorAll("[id],[name],[for]").forEach(function (el) {
        ["id", "name", "for"].forEach(function (a) { if (el.hasAttribute(a)) el.setAttribute(a, el.getAttribute(a).replace("{i}", String(i))); });
      });
      row.querySelector(".lg-row__name").textContent = f.name;
      var p = problem(f);
      var note = row.querySelector(".lg-row__note");
      note.textContent = p ? p + " Remove it to continue." : size(f.size);
      if (p) { row.classList.add("lg-row--bad"); bad++; }
      var thumb = row.querySelector(".lg-row__thumb");
      if (!p && PICTURES.test(f.name) && f.size <= 5242880) {
        var r = new FileReader();
        r.onload = function () { var img = document.createElement("img"); img.alt = ""; img.src = String(r.result); thumb.appendChild(img); };
        r.readAsDataURL(f);
      } else { var ext = document.createElement("span"); ext.className = "lg-ext"; ext.textContent = (f.name.split(".").pop() || "file").toUpperCase().slice(0, 4); thumb.appendChild(ext); }
      row.querySelector(".lg-row__remove").addEventListener("click", function () { files.splice(i, 1); sync(); if (!files.length) close(); else render(); });
      list.appendChild(row);
    });
    submit.disabled = !files.length || bad > 0;
    status.textContent = bad ? "Remove the files marked above to continue." : files.length + (files.length === 1 ? " file" : " files") + " ready.";
  }
  function open() {
    if (!files.length) return;
    if (files.length > maxFiles) files = files.slice(0, maxFiles);
    sync(); render();
    opener = document.activeElement;
    sheet.hidden = false; document.body.classList.add("lg-open");
    var first = sheet.querySelector("select, button"); if (first) first.focus();
  }
  function close() {
    sheet.hidden = true; document.body.classList.remove("lg-open");
    files = []; input.value = ""; list.textContent = "";
    if (opener && opener.focus) opener.focus();
  }
  input.addEventListener("change", function () { files = Array.prototype.slice.call(input.files || []); open(); });
  cancel.addEventListener("click", close);
  sheet.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); close(); } });
  form.addEventListener("submit", function (e) {
    if (sheet.hidden) { e.preventDefault(); return; }
    if (!files.length || submit.disabled) { e.preventDefault(); return; }
    submit.disabled = true; cancel.disabled = true;
    status.textContent = "Uploading " + files.length + (files.length === 1 ? " file" : " files") + ". Please keep this page open.";
  });
  /* an upload that came back with results (or an error) puts keyboard focus on them */
  var focusTarget = document.querySelector("[data-error-summary]");
  if (focusTarget) { focusTarget.setAttribute("tabindex", "-1"); focusTarget.focus(); }
})();
