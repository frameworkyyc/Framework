// Framework demo websites — "Make it yours" panel.
// Lets a visitor see their own business name, brand colour and photos on a demo, then enquire. Everything stays in the browser.
(function () {
  var D = window.FrameworkDemo;
  if (!D || document.documentElement.classList.contains("is-embed")) return;
  var SW = [["#0F766E", "Teal"], ["#1D4ED8", "Blue"], ["#B91C1C", "Red"], ["#EA580C", "Orange"], ["#CA8A04", "Gold"], ["#15803D", "Green"], ["#7C3AED", "Violet"], ["#111111", "Black"]];

  var btn = document.createElement("button");
  btn.type = "button"; btn.className = "yours-btn"; btn.setAttribute("aria-label", "Make it yours: add your name, colour and photos"); btn.setAttribute("aria-expanded", "false"); btn.setAttribute("aria-controls", "yours-panel");
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 2l2.2 6.3L21 10l-5.2 3.9L17.5 21 12 17.2 6.5 21l1.7-7.1L3 10l6.8-1.7z" fill="currentColor"/></svg><span>Make it yours</span>';

  var p = document.createElement("div");
  p.id = "yours-panel"; p.className = "yours"; p.hidden = true; p.setAttribute("role", "dialog"); p.setAttribute("aria-label", "Make this website yours");
  p.innerHTML =
    '<div class="yours__head"><h2>Make it yours</h2><button type="button" class="yours__x" aria-label="Close">×</button></div>' +
    '<p class="yours__lead">See your own name, colour and photos on this site. It stays in your browser: nothing is uploaded or saved.</p>' +
    '<label class="yours__f">Business name<input type="text" maxlength="60" autocomplete="organization" placeholder="Your business name" data-y="name"></label>' +
    '<fieldset class="yours__f"><legend>Brand colour</legend><div class="yours__sw">' +
    SW.map(function (s) { return '<button type="button" class="yours__c" style="--c:' + s[0] + '" data-c="' + s[0] + '" aria-label="' + s[1] + '" aria-pressed="false"></button>'; }).join("") +
    '<label class="yours__pick" title="Any colour"><input type="color" value="#1D4ED8" data-y="color" aria-label="Custom colour"><span>Any</span></label></div></fieldset>' +
    '<label class="yours__f">Your photos<span class="yours__file"><input type="file" accept="image/jpeg,image/png,image/webp" multiple data-y="photos"><em>Choose up to 6 photos</em></span><small>The first becomes the hero, the rest fill the project gallery.</small></label>' +
    '<div class="yours__cta"><a class="btn btn--primary" data-enquire href="../contact.html">Get this made for me →</a><button type="button" class="yours__reset">Reset</button></div>';
  document.body.appendChild(btn); document.body.appendChild(p); document.documentElement.classList.add("has-yours");

  var name = p.querySelector('[data-y="name"]'), color = p.querySelector('[data-y="color"]'), photos = p.querySelector('[data-y="photos"]'), note = p.querySelector(".yours__file em");
  function pressed(hex) { p.querySelectorAll(".yours__c").forEach(function (b) { b.setAttribute("aria-pressed", String(!!hex && b.getAttribute("data-c").toUpperCase() === hex.toUpperCase())); }); }
  function open(v) {
    p.hidden = !v; btn.setAttribute("aria-expanded", String(v)); btn.classList.toggle("is-open", v);
    if (v) { name.value = D.state.name; if (D.state.accent) color.value = D.state.accent.toLowerCase(); pressed(D.state.accent); name.focus({ preventScroll: true }); }
  }
  btn.addEventListener("click", function () { open(p.hidden); });
  p.querySelector(".yours__x").addEventListener("click", function () { open(false); btn.focus(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !p.hidden) { open(false); btn.focus(); } });
  name.addEventListener("input", function () { D.setName(name.value); });
  p.querySelector(".yours__sw").addEventListener("click", function (e) { var b = e.target.closest(".yours__c"); if (!b) return; D.setAccent(b.getAttribute("data-c")); color.value = b.getAttribute("data-c").toLowerCase(); pressed(b.getAttribute("data-c")); });
  color.addEventListener("input", function () { D.setAccent(color.value); pressed(color.value); });
  photos.addEventListener("change", function () { var n = D.setPhotos(photos.files); note.textContent = n ? n + (n === 1 ? " photo added" : " photos added") : "Choose up to 6 photos (JPG, PNG or WebP)"; });
  p.querySelector(".yours__reset").addEventListener("click", function () { D.reset(); name.value = ""; photos.value = ""; pressed(""); note.textContent = "Choose up to 6 photos"; });
  D.setName(D.state.name); // refreshes the enquiry link
})();
