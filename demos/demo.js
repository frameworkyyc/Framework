// Framework demo websites — shared behaviour.
// 1. Personalisation: /demos/fence-deck.html?for=Total+Fencing+Solutions shows that business name wherever data-biz appears.
// 2. Mobile menu toggle.
// 3. The quote form is a demo: it never sends anything, it just shows a confirmation.
(function () {
  var params = new URLSearchParams(location.search);
  var name = (params.get("for") || "").replace(/[\u0000-\u001F<>]/g, "").trim().slice(0, 60);
  if (name) {
    document.querySelectorAll("[data-biz]").forEach(function (el) { el.textContent = name; });
    document.querySelectorAll("[data-biz-initial]").forEach(function (el) { el.textContent = name.charAt(0).toUpperCase(); });
    document.title = document.title.replace(/^[^—|]+/, name + " ");
    // Keep the name when moving between demos.
    document.querySelectorAll("a[data-keep-for]").forEach(function (a) {
      var u = new URL(a.getAttribute("href"), location.href);
      u.searchParams.set("for", name);
      a.setAttribute("href", u.pathname.split("/").pop() + u.search);
    });
  }

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

  var year = document.querySelectorAll("[data-year]");
  year.forEach(function (el) { el.textContent = String(new Date().getFullYear()); });
})();
