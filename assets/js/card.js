/* Digital business card (/card): applies card-config.js, builds the contact file and QR code, and shares the link.
   The page's links work without this script; it adds Save Contact, Share and the QR code. Nothing here sends data
   anywhere: no analytics, no cookies, no storage. */
(function () {
  "use strict";
  var cfg = window.FRAMEWORK_CARD || {};
  var $ = function (id) { return document.getElementById(id); };
  var text = function (v) { return typeof v === "string" ? v.trim() : ""; };
  var httpsUrl = function (v) { v = text(v); return /^https:\/\/[^\s]+$/i.test(v) ? v : ""; };

  var name = text(cfg.name), title = text(cfg.title), company = text(cfg.company) || "Framework";
  var phone = text(cfg.phone).replace(/[^\d+]/g, ""), email = text(cfg.email);
  var website = httpsUrl(cfg.websiteUrl), publicCardUrl = httpsUrl(cfg.cardUrl);

  /* ------------------------------------------------------------------ which address does this copy of the card use?
     The live site always uses the permanent public address. Any other host (Staging, local testing) uses its own, so a QR code
     or shared link made while testing never points at production. */
  var resolveCardUrl = function () {
    var own = window.location.origin + "/card";
    if (!/^https?:$/.test(window.location.protocol)) return publicCardUrl || own;
    if (!publicCardUrl) return own;
    var host = window.location.hostname, pub = new URL(publicCardUrl).hostname;
    return host === pub || host === "www." + pub || "www." + host === pub ? publicCardUrl : own;
  };
  var cardUrl = resolveCardUrl();

  /* ------------------------------------------------------------------ identity */
  if (name) { $("card-name").textContent = name; document.title = name + " | " + company; }
  if (title) $("card-role").textContent = title + ", " + company;

  /* ------------------------------------------------------------------ call / text / email / website */
  var shown = 0;
  var setLink = function (id, href) { var el = $(id); if (href) { el.href = href; el.hidden = false; shown++; } else el.hidden = true; };
  setLink("act-call", /^\+?\d{7,15}$/.test(phone) ? "tel:" + phone : "");
  setLink("act-text", /^\+?\d{7,15}$/.test(phone) ? "sms:" + phone : "");
  setLink("act-email", /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "mailto:" + email : "");
  $("trio").setAttribute("data-count", String(shown));
  if (website) $("act-web").href = website;

  /* ------------------------------------------------------------------ social links (only those configured) */
  var I = function (inner) { return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + inner + "</svg>"; };
  var NETWORKS = {
    instagram: { label: "Instagram", svg: I('<rect x="4" y="4" width="16" height="16" rx="4.5"/><circle cx="12" cy="12" r="3.8"/><circle class="fill" cx="16.9" cy="7.1" r="1.1"/>') },
    linkedin: { label: "LinkedIn", svg: I('<path d="M6 9.5v8.5M6 6v.1M10.5 18v-8.5m0 3c0-2 1.5-3 3-3s3 1 3 3.2V18"/>') },
    facebook: { label: "Facebook", svg: I('<path d="M15.5 4h-2A3.5 3.5 0 0 0 10 7.5V20M6.5 11h9"/>') },
    x: { label: "X", svg: I('<path d="M5 4.5 19 19.5M19 4.5 5 19.5"/>') },
    youtube: { label: "YouTube", svg: I('<rect x="3" y="6" width="18" height="12" rx="3.5"/><path class="fill" d="M10.5 9.5v5l4.3-2.5-4.3-2.5Z"/>') },
    tiktok: { label: "TikTok", svg: I('<path d="M13.5 4v10.2a3.2 3.2 0 1 1-3.2-3.2M13.5 4c.3 2.2 1.8 3.7 4 3.9"/>') }
  };
  var list = $("social");
  list.innerHTML = "";
  Object.keys(NETWORKS).forEach(function (key) {
    var url = httpsUrl(cfg.social && cfg.social[key]);
    if (!url) return;
    var li = document.createElement("li"), a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", company + " on " + NETWORKS[key].label + " (opens in a new tab)");
    a.innerHTML = NETWORKS[key].svg;
    li.appendChild(a); list.appendChild(li);
  });
  list.hidden = !list.children.length;

  /* ------------------------------------------------------------------ status line */
  var statusTimer = 0;
  var say = function (message) {
    var el = $("card-status");
    el.textContent = message;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(function () { el.textContent = ""; }, 6000);
  };

  /* ------------------------------------------------------------------ Save Contact (.vcf download) */
  var contact = { name: name, company: company, role: title, phone: phone, email: email, websiteUrl: website, cardUrl: cardUrl };
  $("save-contact").addEventListener("click", function () {
    var blob = new Blob([window.FrameworkVCard.build(contact)], { type: "text/vcard;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = window.FrameworkVCard.fileName(contact); a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    // The browser cannot tell us whether the file was opened or imported, so only say what to do next.
    say("Open the contact file to save my details.");
  });

  /* ------------------------------------------------------------------ Share Card */
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
    copy(cardUrl).then(function () { say("Link copied: " + cardUrl); }, function () { say("Copying is not available here. The card link is " + cardUrl); });
  };
  $("share-card").addEventListener("click", function () {
    if (!navigator.share) { copyLink(); return; }
    navigator.share({ title: (name ? name + " | " : "") + company, text: (name ? name + ", " : "") + (title ? title + " of " : "") + company, url: cardUrl }).catch(function (err) {
      if (err && err.name === "AbortError") return; // the person closed the share sheet
      copyLink();
    });
  });

  /* ------------------------------------------------------------------ QR code overlay (<dialog>: focus is trapped, Esc closes, focus returns) */
  var dialog = $("qr-dialog"), opener = null, qrBuilt = false;
  var buildQr = function () {
    if (qrBuilt) return;
    var qr = window.qrcode(0, "M"); // smallest version that fits, 15% error correction
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
  $("toggle-qr").addEventListener("click", openQr);
  $("qr-close").addEventListener("click", closeQr);
  dialog.addEventListener("click", function (e) { // a click on the dim backdrop (outside the box), not on the box's own padding
    var r = dialog.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeQr();
  });

  /* ------------------------------------------------------------------ reveal the features that need this script */
  $("save-contact").hidden = false;
  $("utility").hidden = false;
})();
