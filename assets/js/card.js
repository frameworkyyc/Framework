/* Digital business card (/card): fills the page from card-config.js, builds the contact file and QR code, and shares the link.
   Nothing here sends data anywhere: no analytics, no cookies, no storage. */
(function () {
  "use strict";
  var cfg = window.FRAMEWORK_CARD || {};
  var $ = function (id) { return document.getElementById(id); };
  var text = function (v) { return typeof v === "string" ? v.trim() : ""; };
  var httpsUrl = function (v) { v = text(v); return /^https:\/\/[^\s]+$/i.test(v) ? v : ""; };

  var name = text(cfg.name), role = text(cfg.role), phone = text(cfg.phone).replace(/[^\d+]/g, "");
  var email = text(cfg.email), website = httpsUrl(cfg.websiteUrl), cardUrl = httpsUrl(cfg.cardUrl);

  /* ------------------------------------------------------------------ identity */
  if (name) { $("card-name").textContent = name; document.title = name + " | Framework"; }
  if (role) { $("card-role").textContent = role; $("card-role").hidden = false; }

  /* ------------------------------------------------------------------ call / text / email / website */
  var shown = 0;
  var show = function (id, href) { var el = $(id); if (!href) return; el.href = href; el.hidden = false; shown++; };
  if (/^\+?\d{7,15}$/.test(phone)) { show("act-call", "tel:" + phone); show("act-text", "sms:" + phone); }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) show("act-email", "mailto:" + email);
  $("trio").setAttribute("data-count", String(shown));
  if (website) $("act-web").href = website; else $("act-web").hidden = true;

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
  var list = $("social"), any = false;
  Object.keys(NETWORKS).forEach(function (key) {
    var url = httpsUrl(cfg.social && cfg.social[key]);
    if (!url) return;
    var li = document.createElement("li"), a = document.createElement("a");
    a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
    a.setAttribute("aria-label", "Framework on " + NETWORKS[key].label + " (opens in a new tab)");
    a.innerHTML = NETWORKS[key].svg;
    li.appendChild(a); list.appendChild(li); any = true;
  });
  if (any) list.hidden = false;

  /* ------------------------------------------------------------------ status line */
  var statusTimer = 0;
  var say = function (message) {
    var el = $("card-status");
    el.textContent = message;
    clearTimeout(statusTimer);
    if (message) statusTimer = setTimeout(function () { el.textContent = ""; }, 5000);
  };

  /* ------------------------------------------------------------------ Save Contact (.vcf download) */
  $("save-contact").addEventListener("click", function () {
    var data = { name: name, company: text(cfg.company) || "Framework", role: role, phone: phone, email: email, websiteUrl: website };
    var blob = new Blob([window.FrameworkVCard.build(data)], { type: "text/vcard;charset=utf-8" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = window.FrameworkVCard.fileName(data); a.style.display = "none";
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    say("Contact file downloaded. Open it to add Framework to your contacts.");
  });

  /* ------------------------------------------------------------------ Share Card */
  var shareUrl = cardUrl || window.location.href.split("#")[0];
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
  $("share-card").addEventListener("click", function () {
    var title = (name ? name + " | " : "") + "Framework";
    if (navigator.share) {
      navigator.share({ title: title, text: "Framework business card", url: shareUrl }).catch(function (err) {
        if (err && err.name === "AbortError") return; // the person closed the share sheet
        copy(shareUrl).then(function () { say("Link copied: " + shareUrl); }, function () { say("Sharing is not available here. The card link is " + shareUrl); });
      });
      return;
    }
    copy(shareUrl).then(function () { say("Link copied: " + shareUrl); }, function () { say("Copying is not available here. The card link is " + shareUrl); });
  });

  /* ------------------------------------------------------------------ QR code (built once, from the configured card URL) */
  var qrBuilt = false;
  var buildQr = function () {
    if (qrBuilt) return;
    var qr = window.qrcode(0, "M"); // type 0 = smallest version that fits; M = 15% error correction
    qr.addData(shareUrl, "Byte");
    qr.make();
    var n = qr.getModuleCount(), quiet = 4, size = n + quiet * 2, d = "";
    for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (qr.isDark(r, c)) d += "M" + (c + quiet) + " " + (r + quiet) + "h1v1h-1z";
    $("qr-box").innerHTML = '<svg viewBox="0 0 ' + size + " " + size + '" role="img" aria-label="QR code linking to ' + shareUrl + '" shape-rendering="crispEdges"><rect width="' + size + '" height="' + size + '" fill="#fff"/><path d="' + d + '" fill="#000"/></svg>';
    $("qr-url").textContent = shareUrl.replace(/^https:\/\//, "");
    qrBuilt = true;
  };
  $("toggle-qr").addEventListener("click", function () {
    var panel = $("qr-panel"), open = panel.hidden;
    if (open) buildQr();
    panel.hidden = !open;
    this.setAttribute("aria-expanded", open ? "true" : "false");
    this.lastChild.textContent = open ? " Hide QR Code" : " Show QR Code";
    if (open && panel.scrollIntoView) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
})();
