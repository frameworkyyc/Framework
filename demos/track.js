// Framework demo pages: private, first-party visit counts. No cookies, no account, no email, no IP or user-agent stored.
// A visit gets a random id kept in this tab's sessionStorage. A prospect's tracking link adds its journey id to the URL fragment (#j=...), which
// is read once and removed from the address bar. Events: view, active (first real interaction), discipline, vibe, colour, company (only when the
// visitor presses "See your name on the website"), open (the full-demo link). Do Not Track and Global Privacy Control switch everything off.
// See worker/DEMO-TRAFFIC.md for what is recorded and how long it is kept.
(function () {
  var KEY = "fw_dj", ENDPOINT = "/api/demo-events", ID = /^[A-Za-z0-9_-]{22}$/;
  var embed = /[?&]embed=1(?:&|$)/.test(location.search);
  var off = navigator.doNotTrack === "1" || window.doNotTrack === "1" || navigator.msDoNotTrack === "1" || navigator.globalPrivacyControl === true;
  var journey = "", queue = [], timer = 0, activeSent = false, memory = "";

  function newId() {
    var a = new Uint8Array(16); (window.crypto || window.msCrypto).getRandomValues(a);
    var s = ""; for (var i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function read() { try { return sessionStorage.getItem(KEY) || ""; } catch (e) { return memory; } }
  function write(v) { memory = v; try { sessionStorage.setItem(KEY, v); } catch (e) { /* storage blocked: stays in memory for this page */ } }

  // A prospect-link journey id arrives in the fragment. Take it once and remove it from the URL either way.
  var hash = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  var fromLink = hash.get("j");
  if (hash.has("j")) {
    hash.delete("j");
    if (history.replaceState) history.replaceState(null, "", location.pathname + location.search + (hash.toString() ? "#" + hash : ""));
  }

  if (!off && !embed) {
    journey = fromLink && ID.test(fromLink) ? fromLink : read();
    if (!ID.test(journey)) journey = newId();
    write(journey);
  }

  function flush(final) {
    clearTimeout(timer); timer = 0;
    if (!queue.length || !journey) { queue = []; return; }
    var payload = JSON.stringify({ j: journey, e: queue.splice(0, 12) });
    try {
      if (final && navigator.sendBeacon) { navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" })); return; }
      fetch(ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, keepalive: true, credentials: "omit", cache: "no-store" }).catch(function () { /* analytics must never get in the way */ });
    } catch (e) { /* ignore */ }
    if (queue.length) timer = setTimeout(flush, 300);
  }
  function send(type, value) {
    if (!journey) return;
    var ev = { t: type }; if (value != null && value !== "") ev.v = String(value);
    queue.push(ev); if (!timer) timer = setTimeout(flush, 600);
  }
  function active() { if (activeSent || !journey) return; activeSent = true; send("active"); }

  if (journey && document.body && document.body.hasAttribute("data-track")) {
    send("view");
    ["pointerdown", "keydown", "touchstart", "wheel"].forEach(function (t) { window.addEventListener(t, function (e) { if (e.isTrusted) active(); }, { passive: true, once: false }); });
    window.addEventListener("scroll", function (e) { if (e.isTrusted && window.scrollY > 40) active(); }, { passive: true });
  }
  window.addEventListener("pagehide", function () { flush(true); });
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") flush(true); });

  window.FrameworkTrack = { enabled: !!journey, id: function () { return journey; }, send: send, active: active, flush: function () { flush(false); } };
})();
