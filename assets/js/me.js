/* Personal quick-access page (/me): Share Card and Show QR for the PUBLIC business card.
   Both always use the permanent Production address from card-config.js (the same one /card uses on the live site), even when /me is opened
   on Staging. The View Card link works without this script; it adds Share and the QR code. Nothing here sends data anywhere: no analytics,
   no cookies, no storage, no network requests (the QR code is drawn locally by the same vendor/qrcode.js the card uses). */
(function () {
  "use strict";
  var CARD_URL = "https://frameworkco.ca/card";
  var cfg = window.FRAMEWORK_CARD || {};
  // card-config.js is the one place the public address lives; accept it only if it is still the exact Production card.
  var cardUrl = cfg.cardUrl === CARD_URL ? cfg.cardUrl : CARD_URL;
  var $ = function (id) { return document.getElementById(id); };
  var TITLE = "Framework | Digital Business Card";

  var statusTimer = 0;
  var say = function (message) {
    var el = $("me-status");
    el.textContent = message;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(function () { el.textContent = ""; }, 4000);
  };

  /* ------------------------------------------------------------------ Share Card: the native share sheet, or copy the link */
  var copy = function (value) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(value);
    return new Promise(function (resolve, reject) {
      var t = document.createElement("textarea");
      t.value = value; t.setAttribute("readonly", ""); t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t); t.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
      document.body.removeChild(t);
      ok ? resolve() : reject(new Error("copy_failed"));
    });
  };
  var copyLink = function () {
    copy(cardUrl).then(function () { say("Link copied"); }, function () { say("Copying isn’t available here. The link is " + cardUrl); });
  };
  $("me-share").addEventListener("click", function () {
    if (!navigator.share) { copyLink(); return; }
    navigator.share({ title: TITLE, url: cardUrl }).catch(function (err) {
      if (err && err.name === "AbortError") return; // the share sheet was closed: not an error
      copyLink();
    });
  });

  /* ------------------------------------------------------------------ Show QR (<dialog>: focus is trapped, Esc closes, focus returns) */
  var dialog = $("qr-dialog"), opener = null, qrBuilt = false;
  var buildQr = function () {
    if (qrBuilt) return;
    var qr = window.qrcode(0, "M");
    qr.addData(cardUrl, "Byte");
    qr.make();
    var n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    $("qr-box").innerHTML = '<svg viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="QR code linking to ' + cardUrl + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    $("qr-url").textContent = cardUrl.replace(/^https:\/\//, "");
    qrBuilt = true;
  };
  var hasModal = typeof dialog.showModal === "function";
  var onKey = function (e) { if (e.key === "Escape") closeQr(); };
  var openQr = function () {
    buildQr();
    opener = document.activeElement;
    document.documentElement.classList.add("card-lock");
    if (hasModal) dialog.showModal(); else { dialog.setAttribute("open", ""); document.addEventListener("keydown", onKey); }
    $("qr-close").focus();
  };
  var closeQr = function () {
    if (hasModal) { if (dialog.open) dialog.close(); } else { dialog.removeAttribute("open"); document.removeEventListener("keydown", onKey); afterClose(); }
  };
  var afterClose = function () {
    document.documentElement.classList.remove("card-lock");
    if (opener && opener.focus) opener.focus();
    opener = null;
  };
  dialog.addEventListener("close", afterClose);
  $("me-qr").addEventListener("click", openQr);
  $("qr-close").addEventListener("click", closeQr);
  dialog.addEventListener("click", function (e) { // a click on the dim backdrop, not on the box's own padding
    var r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeQr();
  });

  /* reveal the two actions that need this script */
  $("me-share").hidden = false;
  $("me-qr").hidden = false;
})();
