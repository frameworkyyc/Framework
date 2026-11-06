// Website availability check for Admin -> Leads (worker/site-check.js): Online / Offline / Unverified. The rule that matters most: a request that was BLOCKED is never
// reported as offline. Everything here runs against scripted responses; test/site-check-live.mjs (run by hand) probes real sites.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSite, normaliseTarget, candidates, publicHost, detectProtection, describeError, summarise, diagnosticLines, CHECK_UA } from "../site-check.js";

// status 999 (LinkedIn) is outside what the Response constructor accepts, so a stand-in object is used for it
const R = (status, headers = {}, body = "") => (status > 599 ? { status, ok: false, headers: new Headers(headers), body: null, clone() { return this; }, async text() { return body; } } : new Response(body === "" ? null : body, { status, headers }));
const AT = new Date("2026-11-06T18:00:00.000Z");
const DNS = (status) => R(200, { "content-type": "application/json" }, JSON.stringify({ Status: status }));
/** A fetch that answers from a table keyed by exact URL, then host, then "*"; a function is called with (url, init); an Error is thrown; nothing -> network failure. */
const scripted = (map, log = []) => async (url, init = {}) => {
  const u = new URL(url);
  log.push({ url: u.href, init });
  const v = map[u.href] ?? map[u.host] ?? map["*"];
  if (v instanceof Error) throw v;
  if (typeof v === "function") return v(u.href, init);
  if (!v) throw new TypeError("fetch failed");
  return v.clone();
};
const run = (website, map, opts = {}) => checkSite(website, { fetchImpl: scripted(map, opts.log), pause: async () => {}, now: () => 0, at: AT, ...opts });
const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

/* ---------------------------------------------------------------- online */

test("a normal page is Online", async () => {
  const r = await run("https://a.ca", { "https://a.ca/": R(200, {}, "<html>hi</html>") });
  assert.deepEqual([r.state, r.reason, r.httpStatus, r.redirects, r.protection], ["online", "ok", 200, 0, null]);
  assert.equal(r.summary, "Online: ok (HTTP 200) at a.ca.");
});

test("redirects are followed: apex to www, http to https, several hops", async () => {
  let r = await run("https://a.ca", { "https://a.ca/": R(301, { location: "https://www.a.ca/" }), "https://www.a.ca/": R(200, {}, "ok") });
  assert.deepEqual([r.state, r.redirects, r.finalUrl], ["online", 1, "https://www.a.ca/"]);
  r = await run("https://a.ca", { "https://a.ca/": R(301, { location: "/one" }), "https://a.ca/one": R(302, { location: "/two" }), "https://a.ca/two": R(200, {}, "ok") });
  assert.deepEqual([r.state, r.redirects, r.finalUrl], ["online", 2, "https://a.ca/two"]);
  r = await run("http://a.ca", { "https://a.ca/": timeout(), "http://a.ca/": R(301, { location: "https://a.ca/landing" }), "https://a.ca/landing": R(200, {}, "ok") });
  assert.deepEqual([r.state, r.finalUrl], ["online", "https://a.ca/landing"], "http that redirects to https");
});

test("a site that only works on www, or only on plain http, is Online (a visitor would get in)", async () => {
  assert.equal((await run("https://a.ca", { "https://www.a.ca/": R(200, {}, "ok") })).state, "online");
  assert.equal((await run("https://a.ca", { "http://a.ca/": R(200, {}, "ok") })).state, "online");
  const r = await run("https://c.ca", { "https://c.ca/": R(500), "https://www.c.ca/": R(200, {}, "fine") });
  assert.deepEqual([r.state, r.finalUrl], ["online", "https://www.c.ca/"], "a server error on one address does not outweigh a working one");
});

test("tracking parameters on the stored address do not matter and are not sent", async () => {
  const log = [];
  const r = await run("https://www.myhomehandyman.ca/?utm_campaign=gmb#top", { "*": R(200, {}, "ok") }, { log });
  assert.equal(r.state, "online");
  assert.ok(log.every((l) => !l.init || !/utm_/.test(l.url)), "no tracking parameter was requested");
  assert.equal(log[0].url, "https://www.myhomehandyman.ca/");
});

test("a redirect that needs a cookie is not mistaken for a loop", async () => {
  const r = await run("https://g.ca", { "https://g.ca/": (u, init) => (init.headers.Cookie === "s=1" ? R(200, {}, "ok") : R(302, { location: "https://g.ca/", "set-cookie": "s=1; Path=/; HttpOnly" })) });
  assert.deepEqual([r.state, r.redirects], ["online", 1]);
});

test("the request looks like a browser but says who is asking, and carries no credentials", async () => {
  const log = [];
  await run("https://a.ca", { "*": R(200, {}, "ok") }, { log });
  const h = log[0].init.headers;
  assert.equal(h["User-Agent"], CHECK_UA);
  assert.match(CHECK_UA, /^Mozilla\/5\.0 .*Chrome\/\d+.*FrameworkSiteCheck\/1\.0 \(\+https:\/\/frameworkco\.ca\)$/);
  assert.match(h.Accept, /text\/html/); assert.match(h["Accept-Language"], /^en-CA/);
  assert.ok(!("Authorization" in h) && !("Cookie" in h), "nothing of ours is sent to the site");
  assert.equal(log[0].init.redirect, "manual", "redirects are followed by hand so each hop can be checked");
});

/* ---------------------------------------------------------------- unverified: blocked is never offline */

test("bot protection and rate limits are Unverified, never Offline", async () => {
  for (const [status, headers, body] of [
    [403, { server: "cloudflare", "cf-ray": "1" }, "Just a moment..."], [403, {}, "forbidden"], [401, {}, ""], [405, {}, ""], [406, {}, ""], [429, { "retry-after": "60" }, ""],
    [999, {}, ""], [451, {}, ""], [503, { "cf-mitigated": "challenge" }, ""], [503, { server: "cloudflare", "cf-ray": "9" }, "<title>Attention Required! | Cloudflare</title>"],
    [403, { "x-datadome": "protected" }, ""], [403, { "x-sucuri-id": "1" }, ""], [403, {}, "<html>Pardon Our Interruption</html>"], [403, {}, "Please verify you are a human"],
  ]) {
    const r = await run("https://b.ca", { "*": R(status, headers, body) });
    assert.equal(r.state, "unverified", `HTTP ${status} ${body.slice(0, 30)}`);
    assert.notEqual(r.state, "offline");
    assert.match(r.summary, /Not treated as offline\./);
    assert.equal(r.httpStatus, status);
  }
});

test("a challenge page served with HTTP 200 is Unverified, not Online", async () => {
  const r = await run("https://h.ca", { "*": R(200, {}, "<title>Just a moment...</title><div id='cf-chl-widget-x'></div>") });
  assert.deepEqual([r.state, r.protection], ["unverified", "Cloudflare challenge"]);
});

test("the protection is named when it can be recognised, and diagnostics say so", async () => {
  const r = await run("https://b.ca", { "*": R(403, { server: "cloudflare", "cf-ray": "abc" }, "Attention Required! | Cloudflare") });
  assert.equal(r.protection, "Cloudflare challenge");
  assert.deepEqual(diagnosticLines(r).slice(0, 3), ["Checked 2026-11-06: unverified, blocked or protected (HTTP 403, Cloudflare challenge)", "HTTP status 403", "Bot protection seen: Cloudflare challenge"]);
  assert.equal(detectProtection(200, new Headers(), "welcome to our site"), null);
  assert.equal(detectProtection(403, new Headers({ server: "AkamaiGHost" }), ""), "Akamai");
});

test("a redirect loop is Unverified (it may be a cookie wall), and a timeout or refused connection is Unverified unless DNS says the domain is gone", async () => {
  const loop = await run("https://f.ca", { "https://f.ca/": R(302, { location: "https://f.ca/a" }), "https://f.ca/a": R(302, { location: "https://f.ca/" }), "*": R(302, { location: "https://f.ca/" }) });
  assert.deepEqual([loop.state, loop.reason], ["unverified", "redirect loop"]);
  const slow = await run("https://d.ca", { "*": timeout(), "cloudflare-dns.com": DNS(0) });
  assert.deepEqual([slow.state, slow.reason], ["unverified", "could not connect from here (timed out)"]);
  const refused = await run("https://d.ca", { "*": new TypeError("Network connection lost."), "cloudflare-dns.com": DNS(0) });
  assert.equal(refused.state, "unverified");
  const dnsDown = await run("https://d.ca", { "*": new TypeError("fetch failed") });
  assert.equal(dnsDown.state, "unverified", "when even the DNS lookup is unavailable, nothing is proven");
});

test("an address that must not be requested is never requested, and says why", async () => {
  const log = [];
  for (const bad of ["http://169.254.169.254/latest/meta-data", "http://localhost:8080/", "https://127.0.0.1/", "http://10.0.0.5/", "https://[::1]/", "https://intranet/", "https://a.internal/", "ftp://a.ca/", "https://user:pass@a.ca/", "https://a.ca:8443/", "javascript:alert(1)", "", "   "]) {
    const r = await run(bad, { "*": R(200) }, { log });
    assert.equal(r.state, "unverified", bad);
    assert.equal(r.reason, "not a public web address", bad);
  }
  assert.equal(log.length, 0, "no request was made for any of them");
  const redirect = await run("https://i.ca", { "https://i.ca/": R(302, { location: "http://10.0.0.1/admin" }) });
  assert.equal(redirect.state, "unverified", "a redirect into a private address is not followed");
});

/* ---------------------------------------------------------------- offline: hard evidence only */

test("Offline needs hard evidence: a real 404/410, an unreachable origin, a server error on every try, or a domain that does not exist", async () => {
  let r = await run("https://c.ca", { "*": R(404) });
  assert.deepEqual([r.state, r.reason, r.httpStatus], ["offline", "home page not found (HTTP 404)", 404]);
  assert.equal((await run("https://c.ca", { "*": R(410) })).state, "offline");
  r = await run("https://c.ca", { "*": R(521, { server: "cloudflare" }) });
  assert.deepEqual([r.state, r.reason], ["offline", "web server unreachable (HTTP 521)"]);
  r = await run("https://c.ca", { "*": R(500) });
  assert.deepEqual([r.state, r.reason], ["offline", "server error on every try (HTTP 500)"]);
  r = await run("https://c.ca", { "*": R(502) });
  assert.equal(r.state, "offline");
  r = await run("https://gone.example.ca", { "cloudflare-dns.com": DNS(3) });
  assert.deepEqual([r.state, r.reason, r.httpStatus], ["offline", "domain does not exist (DNS)", null]);
});

test("a 5xx is retried once: a site that recovers is Online", async () => {
  let n = 0;
  const r = await run("https://c.ca", { "https://c.ca/": () => (++n === 1 ? R(503) : R(200, {}, "back")) });
  assert.equal(r.state, "online");
});

test("a 404 that bot protection produced is not 'not found'", async () => {
  const r = await run("https://c.ca", { "*": R(404, { server: "cloudflare", "cf-mitigated": "challenge" }) });
  assert.equal(r.state, "unverified");
});

/* ---------------------------------------------------------------- diagnostics and helpers */

test("every check records what happened: status codes, redirects, timings, failure reasons", async () => {
  const r = await run("https://c.ca", { "https://c.ca/": R(404), "https://www.c.ca/": R(301, { location: "https://www.c.ca/gone" }), "https://www.c.ca/gone": R(404), "http://c.ca/": R(404) });
  assert.equal(r.attempts.length, 3);
  assert.deepEqual(r.attempts.map((a) => [a.url, a.status, a.hops, a.result]), [["https://c.ca/", 404, 0, "offline"], ["https://www.c.ca/", 404, 1, "offline"], ["http://c.ca/", 404, 0, "offline"]]);
  assert.ok(r.attempts.every((a) => Number.isInteger(a.ms) && a.error === null));
  const fail = await run("https://d.ca", { "*": timeout(), "cloudflare-dns.com": DNS(0) });
  assert.ok(fail.attempts.every((a) => a.error === "timed out" && a.status === null));
  assert.match(diagnosticLines(fail).join("\n"), /Could not connect to d\.ca: timed out/);
  assert.equal(fail.checkedAt, "2026-11-06T18:00:00.000Z");
  assert.ok(summarise(fail).length <= 300);
});

test("normaliseTarget, candidates and publicHost", () => {
  assert.equal(normaliseTarget("www.example.ca/contact?x=1#y").href, "https://www.example.ca/contact");
  assert.equal(normaliseTarget("http://example.ca:80/").href, "http://example.ca/");
  assert.equal(normaliseTarget("https://example.ca:8080/"), null);
  assert.deepEqual(candidates(normaliseTarget("https://example.ca/")).map((u) => u.href), ["https://example.ca/", "https://www.example.ca/", "http://example.ca/"]);
  assert.deepEqual(candidates(normaliseTarget("https://www.example.ca/")).map((u) => u.href), ["https://www.example.ca/", "https://example.ca/", "http://www.example.ca/"]);
  for (const h of ["example.ca", "a-b.example.co.uk", "xn--bcher-kva.example"]) assert.equal(publicHost(h), true, h);
  for (const h of ["localhost", "10.0.0.1", "[::1]", "a", "a..b.ca", "-a.ca", "a.local", "exa mple.ca", "1.2.3.4", ""]) assert.equal(publicHost(h), false, h);
  assert.equal(describeError(timeout()), "timed out");
  assert.equal(describeError(new Error("SSL handshake failed")), "TLS/certificate error");
});

test("the check never throws, whatever the site does", async () => {
  const weird = [R(200, { "content-type": "text/html" }, ""), R(204), R(302), R(302, { location: "http://[bad" }), R(299), R(418), R(599)];
  for (const res of weird) assert.ok(["online", "offline", "unverified"].includes((await run("https://w.ca", { "*": res })).state));
  const r = await checkSite("https://a.ca", { fetchImpl: null, at: AT });
  assert.equal(r.state, "unverified");
});

test("keepBody (used by the finder) returns the home page only for a site proven online with an HTML page, and nothing otherwise", async () => {
  const HTMLH = { "content-type": "text/html; charset=utf-8" };
  const page = "<html><body>" + "x".repeat(50000) + "</body></html>";
  let r = await run("https://a.ca", { "*": R(200, HTMLH, page) }, { keepBody: true });
  assert.equal(r.state, "online"); assert.equal(r.html.length, page.length, "the whole page, not just the 24 KB used to spot challenge pages");
  r = await run("https://a.ca", { "*": R(200, HTMLH, page) });
  assert.equal(r.html, null, "without keepBody no page is returned");
  r = await run("https://a.ca", { "*": R(200, { "content-type": "application/json" }, "{}") }, { keepBody: true });
  assert.deepEqual([r.state, r.html], ["online", null], "a JSON home page cannot be scored");
  for (const res of [R(403, HTMLH, "denied"), R(404, HTMLH, "nope"), R(200, HTMLH, "<title>Just a moment...</title>")]) assert.equal((await run("https://a.ca", { "*": res }, { keepBody: true })).html, null);
});
