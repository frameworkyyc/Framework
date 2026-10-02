/* FRAMEWORK — combined client revenue (homepage)
   Asks the Worker for the one combined total (/api/client-revenue) and shows it in [data-revenue-total].
   The block stays hidden until there is a total. The individual client figures are private: they live in
   worker/clients.json and never reach the browser. */
(function () {
  "use strict";

  var block = document.querySelector("[data-revenue-total]");
  if (!block) return;
  var value = block.querySelector('[data-fill="total"]');

  fetch("/api/client-revenue", { credentials: "same-origin" })
    .then(function (res) { if (!res.ok) throw new Error("client-revenue " + res.status); return res.json(); })
    .then(function (data) {
      if (!data || typeof data.total !== "string" || !data.total) return;
      value.textContent = data.total;
      block.hidden = false;
    })
    .catch(function () { /* unavailable: leave the block hidden */ });
})();
