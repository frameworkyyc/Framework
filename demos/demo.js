// Framework demo websites — shared behaviour.
// 1. Personalisation: /demos/fence-deck.html?for=Total+Fencing+Solutions&accent=0F766E shows that business name and brand colour.
//    The same controls are exposed as window.FrameworkDemo so the "Make it yours" panel and the showroom can drive a demo live.
//    Photos chosen by a visitor stay in their browser (object URLs); nothing is uploaded.
// 2. Mobile menu toggle.
// 3. The quote form is a demo: it never sends anything, it just shows a confirmation.
// 4. Photos: each .ph placeholder with a data-src is replaced by that picture once the file exists (assets/img/demos/<demo>/hero.jpg, project-1.jpg ... project-5.jpg);
//    a slot with no file yet keeps its placeholder, so a partly filled set never shows a broken image. Project photos load as they near the screen.
// 5. Project photos open in a lightbox.
// 6. ?embed=1 (used by the showroom preview) hides the demo banner and mobile bar.
(function () {
  var doc = document.documentElement;
  var params = new URLSearchParams(location.search);
  if (params.get("embed") === "1") doc.classList.add("is-embed");
  var slug = document.body.getAttribute("data-demo") || "";
  var state = { name: "", accent: "" };
  var baseTitle = document.title;

  function cleanName(v) { return String(v || "").replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, 60); }
  function cleanHex(v) { v = String(v || "").replace(/^#/, ""); return /^[0-9a-f]{6}$/i.test(v) ? "#" + v.toUpperCase() : ""; }
  function lum(hex) {
    var n = parseInt(hex.slice(1), 16), c = [n >> 16 & 255, n >> 8 & 255, n & 255].map(function (v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function mix(hex, to, k) {
    var a = parseInt(hex.slice(1), 16), out = [16, 8, 0].map(function (s) { var v = a >> s & 255; return Math.round(v + (to - v) * k); });
    return "#" + out.map(function (v) { return ("0" + v.toString(16)).slice(-2); }).join("");
  }

  function linkUp() {
    document.querySelectorAll("a[data-keep-for]").forEach(function (a) {
      var u = new URL(a.getAttribute("data-href") || a.getAttribute("href"), location.href);
      if (!a.getAttribute("data-href")) a.setAttribute("data-href", a.getAttribute("href"));
      if (state.name) u.searchParams.set("for", state.name); else u.searchParams.delete("for");
      if (state.accent) u.searchParams.set("accent", state.accent.slice(1)); else u.searchParams.delete("accent");
      a.setAttribute("href", u.pathname.split("/").pop() + u.search);
    });
    document.querySelectorAll("a[data-enquire]").forEach(function (a) {
      var q = new URLSearchParams();
      if (state.name) q.set("business", state.name);
      if (slug) q.set("demo", slug);
      if (state.accent) q.set("accent", state.accent.slice(1));
      a.setAttribute("href", "../contact.html" + (q.toString() ? "?" + q : "") + "#contact-form");
    });
  }

  function setName(v) {
    var name = cleanName(v);
    state.name = name;
    var shown = name || null;
    document.querySelectorAll("[data-biz]").forEach(function (el) {
      if (!el.hasAttribute("data-biz-default")) el.setAttribute("data-biz-default", el.textContent);
      el.textContent = shown || el.getAttribute("data-biz-default");
    });
    document.querySelectorAll("[data-biz-initial]").forEach(function (el) {
      if (!el.hasAttribute("data-biz-default")) el.setAttribute("data-biz-default", el.textContent);
      el.textContent = shown ? shown.charAt(0).toUpperCase() : el.getAttribute("data-biz-default");
    });
    document.title = shown ? baseTitle.replace(/^[^—|]+/, shown + " ") : baseTitle;
    linkUp();
    window.dispatchEvent(new CustomEvent("demo:change"));
  }

  function setAccent(v) {
    var hex = cleanHex(v);
    state.accent = hex;
    var s = doc.style;
    if (!hex) { ["--accent", "--on-accent", "--accent-on-dark", "--accent-ink"].forEach(function (k) { s.removeProperty(k); }); }
    else {
      var light = lum(hex) > 0.42;
      s.setProperty("--accent", hex);
      s.setProperty("--on-accent", light ? "#111111" : "#FFFFFF");
      s.setProperty("--accent-on-dark", light ? hex : mix(hex, 255, 0.45));
      s.setProperty("--accent-ink", light ? mix(hex, 0, 0.45) : hex);
    }
    linkUp();
    window.dispatchEvent(new CustomEvent("demo:change"));
  }

  var made = [];
  function paint(box, url, alt) {
    var img = box.querySelector("img");
    if (!img) { img = document.createElement("img"); img.decoding = "async"; box.appendChild(img); }
    img.src = url; if (alt) img.alt = alt;
    img.removeAttribute("width"); img.removeAttribute("height");
    box.classList.add("ph--photo"); box.removeAttribute("role"); box.removeAttribute("aria-label");
    box.setAttribute("data-yours", "1");
  }
  function slots() { return [].slice.call(document.querySelectorAll(".hero .ph, .projects .ph")); }
  function setPhotos(files) {
    made.forEach(function (u) { URL.revokeObjectURL(u); }); made = [];
    var list = [].slice.call(files || []).filter(function (f) { return f && /^image\/(jpeg|png|webp|avif)$/.test(f.type) && f.size < 15e6; }).slice(0, 6);
    var boxes = slots();
    list.forEach(function (f, i) { if (!boxes[i]) return; var u = URL.createObjectURL(f); made.push(u); paint(boxes[i], u, "Your photo " + (i + 1)); });
    window.dispatchEvent(new CustomEvent("demo:change"));
    return list.length;
  }
  function reset() {
    setName(""); setAccent("");
    made.forEach(function (u) { URL.revokeObjectURL(u); }); made = [];
    slots().forEach(function (box) {
      if (!box.hasAttribute("data-yours")) return;
      box.removeAttribute("data-yours");
      var img = box.querySelector("img"); if (img) img.remove();
      box.classList.remove("ph--photo"); load(box, true);
    });
  }

  window.FrameworkDemo = { slug: slug, state: state, setName: setName, setAccent: setAccent, setPhotos: setPhotos, reset: reset };

  // Initial personalisation from the link.
  if (params.get("for")) setName(params.get("for")); else linkUp();
  if (params.get("accent")) setAccent(params.get("accent"));

  // Mobile menu
  var head = document.querySelector(".site-head");
  var btn = document.querySelector(".menu-btn");
  if (head && btn) {
    btn.addEventListener("click", function () {
      var open = head.classList.toggle("is-open");
      btn.setAttribute("aria-expanded", String(open));
    });
    head.querySelectorAll(".nav a").forEach(function (a) {
      a.addEventListener("click", function () { head.classList.remove("is-open"); btn.setAttribute("aria-expanded", "false"); });
    });
  }

  document.querySelectorAll("form[data-demo-form]").forEach(function (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      form.classList.add("is-done");
      var done = form.querySelector(".form-done");
      if (done) done.focus();
    });
  });

  // Photos
  function load(box, force) {
    if (box.hasAttribute("data-yours") || (!force && box.__loading)) return;
    box.__loading = true;
    var probe = new Image();
    probe.onload = function () {
      if (box.hasAttribute("data-yours")) return;
      var img = document.createElement("img");
      img.src = probe.src; img.alt = box.getAttribute("aria-label") || ""; img.width = probe.naturalWidth; img.height = probe.naturalHeight;
      img.decoding = "async";
      box.appendChild(img); box.classList.add("ph--photo"); box.removeAttribute("role"); box.removeAttribute("aria-label");
      box.__loading = false;
    };
    probe.onerror = function () { box.__loading = false; };
    probe.src = new URL(box.getAttribute("data-src"), location.href).href;
  }
  var boxes = [].slice.call(document.querySelectorAll(".ph[data-src]"));
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { io.unobserve(e.target); load(e.target); } }); }, { rootMargin: "900px 0px" });
    boxes.forEach(function (b) { if (b.closest(".hero")) load(b); else io.observe(b); });
  } else boxes.forEach(function (b) { load(b); });

  // Lightbox for project photos
  var lb, lbImg, lbCap, lbIdx = 0, lbList = [], lastFocus;
  function lbBuild() {
    lb = document.createElement("div");
    lb.className = "lightbox"; lb.hidden = true; lb.setAttribute("role", "dialog"); lb.setAttribute("aria-modal", "true"); lb.setAttribute("aria-label", "Project photo");
    lb.innerHTML = '<button class="lightbox__x" type="button" aria-label="Close">×</button><button class="lightbox__n lightbox__n--prev" type="button" aria-label="Previous photo">‹</button><figure><img alt=""><figcaption></figcaption></figure><button class="lightbox__n lightbox__n--next" type="button" aria-label="Next photo">›</button>';
    document.body.appendChild(lb);
    lbImg = lb.querySelector("img"); lbCap = lb.querySelector("figcaption");
    lb.addEventListener("click", function (e) { if (e.target === lb || e.target.closest(".lightbox__x")) lbClose(); else if (e.target.closest(".lightbox__n--prev")) lbGo(-1); else if (e.target.closest(".lightbox__n--next")) lbGo(1); });
    document.addEventListener("keydown", function (e) { if (lb.hidden) return; if (e.key === "Escape") lbClose(); else if (e.key === "ArrowLeft") lbGo(-1); else if (e.key === "ArrowRight") lbGo(1); });
  }
  function lbShow() { var b = lbList[lbIdx], img = b.querySelector("img"); lbImg.src = img ? img.currentSrc || img.src : ""; lbImg.alt = ""; lbCap.textContent = (b.getAttribute("data-photo") || "").replace(/^Project:\s*/, ""); }
  function lbGo(d) { lbIdx = (lbIdx + d + lbList.length) % lbList.length; lbShow(); }
  function lbClose() { lb.hidden = true; document.documentElement.classList.remove("lb-open"); if (lastFocus) lastFocus.focus(); }
  document.addEventListener("click", function (e) {
    var box = e.target.closest && e.target.closest(".projects .ph--photo");
    if (!box) return;
    if (!lb) lbBuild();
    lbList = [].slice.call(document.querySelectorAll(".projects .ph--photo"));
    lbIdx = lbList.indexOf(box); lastFocus = box; lbShow();
    lb.hidden = false; document.documentElement.classList.add("lb-open"); lb.querySelector(".lightbox__x").focus();
  });
  document.querySelectorAll(".projects .ph").forEach(function (b) { b.setAttribute("tabindex", "0"); b.addEventListener("keydown", function (e) { if ((e.key === "Enter" || e.key === " ") && b.classList.contains("ph--photo")) { e.preventDefault(); b.click(); } }); });

  document.querySelectorAll("[data-year]").forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
