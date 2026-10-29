/* Website live previews: a website is shown in a sandboxed frame only when ITS OWN headers permit framing; otherwise the page falls back to the optional screenshot or a plain card.
   Nothing is proxied (the browser loads the website itself), the frame can reach nothing of the portal, and the CSP gains frame-src for that one page only. No network is used: the header check
   gets a stub fetch. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sites from "../portal/repo/websites.js";
import * as WF from "../portal/website-files.js";
import { PORTAL_CSP, securityHeaders } from "../portal/http.js";
import { checkEmbeddable, diagnoseEmbeddable, framingAllowed, previewableUrl, frameSources } from "../portal/website-preview.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const MIGRATION = read("migrations/portal-proposed/0011_websites.sql");
const ADMIN = "admin@framework.test";
const H = (o) => new Headers(o);
const html = (headers = {}, status = 200) => new Response("<html>SECRET-PAGE-BODY</html>", { status, headers: { "Content-Type": "text/html; charset=utf-8", ...headers } });
const stub = (map) => { const calls = []; const f = async (url, init) => { calls.push({ url, init }); const r = map[url] ?? map["*"]; if (!r) throw new Error("network"); return typeof r === "function" ? r() : r; }; f.calls = calls; return f; };

test("framing rules: X-Frame-Options and CSP frame-ancestors are both honoured, and 'self' only counts when the website IS the portal's origin", () => {
  const P = "https://staging.frameworkco.ca", O = "https://alpha.example.ca";
  assert.ok(framingAllowed(H({}), P, O), "no restriction");
  assert.ok(!framingAllowed(H({ "x-frame-options": "DENY" }), P, O));
  assert.ok(!framingAllowed(H({ "x-frame-options": "SAMEORIGIN" }), P, O));
  assert.ok(framingAllowed(H({ "x-frame-options": "SAMEORIGIN" }), P, P));
  assert.ok(!framingAllowed(H({ "x-frame-options": "ALLOW-FROM https://staging.frameworkco.ca" }), P, O), "obsolete value is not trusted");
  assert.ok(!framingAllowed(H({ "content-security-policy": "default-src 'self'; frame-ancestors 'none'" }), P, O));
  assert.ok(!framingAllowed(H({ "content-security-policy": "frame-ancestors 'self'" }), P, O));
  assert.ok(framingAllowed(H({ "content-security-policy": "frame-ancestors 'self'" }), P, P));
  assert.ok(framingAllowed(H({ "content-security-policy": "frame-ancestors *" }), P, O));
  assert.ok(framingAllowed(H({ "content-security-policy": "frame-ancestors https://staging.frameworkco.ca" }), P, O));
  assert.ok(framingAllowed(H({ "content-security-policy": "frame-ancestors https://*.frameworkco.ca" }), P, O));
  assert.ok(!framingAllowed(H({ "content-security-policy": "frame-ancestors https://other.example.com" }), P, O));
  assert.ok(!framingAllowed(H({ "content-security-policy": "frame-ancestors" }), P, O), "an empty list allows nobody");
  assert.ok(!framingAllowed(H({ "content-security-policy": "script-src 'self', frame-ancestors 'none'" }), P, O), "every policy must allow it");
});

test("only public https website names are ever contacted: no IP addresses, localhost, internal names, credentials, ports or other schemes", () => {
  assert.ok(previewableUrl("https://alpha.example.ca/"));
  for (const bad of ["http://alpha.example.ca/", "https://127.0.0.1/", "https://10.0.0.5/", "https://[::1]/", "https://localhost/", "https://intranet/", "https://printer.local/", "https://a.internal/", "https://u:p@alpha.example.ca/", "https://alpha.example.ca:8443/", "javascript:alert(1)", "file:///etc/passwd", "not a url", ""]) assert.equal(previewableUrl(bad), null, bad);
});

test("checkEmbeddable: allowed, blocked, wrong type, error status, unreachable, no fetch; the body is never read", async () => {
  const P = "https://staging.frameworkco.ca", U = "https://alpha.example.ca/";
  const ok = await checkEmbeddable(U, { fetch: stub({ [U]: html() }), portalOrigin: P });
  assert.deepEqual(ok, { embeddable: true, reason: "ok", frameOrigins: ["https://alpha.example.ca"], status: 200 });
  let cancelled = false, read2 = false;
  const spy = () => { const r = html(); return new Proxy(r, { get: (t, k) => (k === "text" || k === "json" || k === "arrayBuffer" ? () => { read2 = true; } : k === "body" ? { cancel: async () => { cancelled = true; } } : typeof t[k] === "function" ? t[k].bind(t) : t[k]) }); };
  await checkEmbeddable(U, { fetch: stub({ [U]: spy }), portalOrigin: P });
  assert.ok(cancelled && !read2, "the response body is cancelled, never read");
  assert.equal((await checkEmbeddable(U, { fetch: stub({ [U]: html({ "X-Frame-Options": "DENY" }) }), portalOrigin: P })).reason, "blocked");
  assert.equal((await checkEmbeddable(U, { fetch: stub({ [U]: new Response("x", { headers: { "Content-Type": "application/pdf" } }) }), portalOrigin: P })).reason, "not_html");
  assert.equal((await checkEmbeddable(U, { fetch: stub({ [U]: html({}, 500) }), portalOrigin: P })).reason, "status");
  assert.equal((await checkEmbeddable(U, { fetch: stub({}), portalOrigin: P })).reason, "unreachable");
  assert.equal((await checkEmbeddable(U, { portalOrigin: P })).reason, "unavailable");
  assert.equal((await checkEmbeddable("http://alpha.example.ca/", { fetch: stub({ "*": html() }), portalOrigin: P })).embeddable, false, "http is never previewed (mixed content)");
  const f = stub({ [U]: html() }); await checkEmbeddable(U, { fetch: f, portalOrigin: P });
  assert.equal(f.calls[0].init.method, "GET"); assert.equal(f.calls[0].init.redirect, "manual"); assert.ok(!("credentials" in f.calls[0].init) && !f.calls[0].init.headers.Cookie, "no cookies or credentials are sent");
});

test("redirects are followed by hand, each hop vetted, and every origin passed through is reported (the CSP names them); a redirect to an unsafe place is refused", async () => {
  const P = "https://staging.frameworkco.ca";
  const to = (loc) => new Response(null, { status: 301, headers: { Location: loc } });
  const r = await checkEmbeddable("https://alpha.example.ca/", { fetch: stub({ "https://alpha.example.ca/": to("https://www.alpha.example.ca/home"), "https://www.alpha.example.ca/home": html() }), portalOrigin: P });
  assert.deepEqual(r.frameOrigins, ["https://alpha.example.ca", "https://www.alpha.example.ca"]);
  for (const loc of ["http://alpha.example.ca/", "https://127.0.0.1/admin", "https://localhost/", "javascript:alert(1)"]) assert.equal((await checkEmbeddable("https://alpha.example.ca/", { fetch: stub({ "https://alpha.example.ca/": to(loc) }), portalOrigin: P })).embeddable, false, loc);
  const loop = stub({ "*": to("https://alpha.example.ca/") });
  assert.equal((await checkEmbeddable("https://alpha.example.ca/", { fetch: loop, portalOrigin: P })).embeddable, false);
  assert.ok(loop.calls.length <= 6, "a redirect loop stops");
});

test("results are cached per portal and address; a cache failure never breaks the check", async () => {
  const P = "https://staging.frameworkco.ca", U = "https://alpha.example.ca/";
  const store = new Map(); const cache = { match: async (k) => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } };
  const f = stub({ [U]: html() });
  await checkEmbeddable(U, { fetch: f, portalOrigin: P, cache }); await checkEmbeddable(U, { fetch: f, portalOrigin: P, cache });
  assert.equal(f.calls.length, 1, "the second view does not contact the website");
  const broken = { match: async () => { throw new Error("x"); }, put: async () => { throw new Error("y"); } };
  assert.equal((await checkEmbeddable(U, { fetch: stub({ [U]: html() }), portalOrigin: P, cache: broken })).embeddable, true);
});

test("securityHeaders: frame-src is added only for plain https origins and only when asked; the shared policy is unchanged", () => {
  assert.ok(!/frame-src/.test(PORTAL_CSP) && /frame-ancestors 'none'/.test(PORTAL_CSP));
  assert.ok(!/frame-src/.test(securityHeaders().get("Content-Security-Policy")));
  const csp = securityHeaders({}, { frameSrc: ["https://alpha.example.ca", "https://www.alpha.example.ca"] }).get("Content-Security-Policy");
  assert.match(csp, /; frame-src https:\/\/alpha\.example\.ca https:\/\/www\.alpha\.example\.ca$/);
  assert.match(csp, /frame-ancestors 'none'/, "the portal still cannot be framed");
  for (const bad of ["http://a.example.ca", "https://a.example.ca; script-src *", "*", "https://a.example.ca/path", "data:", "'self'", "https://a b.example.ca"]) assert.ok(!/frame-src/.test(securityHeaders({}, { frameSrc: [bad] }).get("Content-Security-Policy")), bad);
  assert.deepEqual(frameSources({ embeddable: false, frameOrigins: ["https://a.example.ca"] }), []);
});

/* ------------------------------------------------------------------ through the router */

async function setup({ previewFetch } = {}) {
  const w = await makeWorld();
  w.env.PORTAL_WEBSITE = "1"; w.env.PORTAL_FILES = fakeR2(); w.db.raw.exec(MIGRATION);
  if (previewFetch) w.previewFetch = previewFetch;
  const alpha = await w.org("alpha", "Alpha Co");
  await w.invite(alpha, "ann@alpha.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const deps = { db: w.db, bucket: w.env.PORTAL_FILES, env: w.env, now: w.clock.now() };
  const add = async (input) => { const r = await sites.createWebsite(w.db, alpha.id, input, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const addShot = async (id) => assert.ok((await WF.adminSetScreenshot(deps, { organizationId: alpha.id, websiteId: id, actor: ADMIN, file: { name: "h.png", bytes: S.png(320, 200) } })).ok);
  return { w, ann, add, addShot, alpha };
}
const LIVE = { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true };
const iframes = (t) => [...t.matchAll(/<iframe\b[^>]*>/g)].map((m) => m[0]);

test("a website that permits framing gets a live, lazy, sandboxed preview in a desktop-style frame, and the CSP allows exactly that origin on this page only", async () => {
  const f = stub({ "https://alpha.example.ca/": html() });
  const s = await setup({ previewFetch: f });
  await s.add(LIVE);
  const res = await s.ann.get("/portal/o/alpha/website");
  const page = await res.text();
  const frames = iframes(page);
  assert.equal(frames.length, 1);
  const tag = frames[0];
  assert.match(tag, /src="https:\/\/alpha\.example\.ca\/"/);
  assert.match(tag, /loading="lazy"/); assert.match(tag, /referrerpolicy="no-referrer"/); assert.match(tag, /allow=""/); assert.match(tag, /title="Live preview of Main website"/);
  const sandbox = /sandbox="([^"]*)"/.exec(tag)[1].split(" ");
  assert.ok(!sandbox.includes("allow-same-origin") && !sandbox.includes("allow-top-navigation") && !sandbox.some((x) => /top-navigation|forms|modals|downloads|popups-to-escape/.test(x) && x !== "allow-popups-to-escape-sandbox"), "sandbox: " + sandbox.join(" "));
  assert.deepEqual(sandbox.sort(), ["allow-popups", "allow-popups-to-escape-sandbox", "allow-scripts"]);
  assert.match(page, /ws-frame__bar/); assert.match(page, /Visit website/); assert.match(page, /target="_blank" rel="noopener noreferrer"/);
  const csp = res.headers.get("Content-Security-Policy");
  assert.match(csp, /; frame-src https:\/\/alpha\.example\.ca$/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(res.headers.get("X-Frame-Options"), "DENY");
  assert.ok(!/SECRET-PAGE-BODY/.test(page), "nothing of the website's own page is copied into the portal");
  for (const other of ["/portal/o/alpha", "/portal/o/alpha/account"]) assert.ok(!/frame-src/.test((await s.ann.get(other)).headers.get("Content-Security-Policy")), other + " has no frame-src");
});

test("a website that forbids framing falls back: the optional screenshot in the same frame if there is one, else a plain card; Visit website always works, and the CSP is not widened", async () => {
  const f = stub({ "https://alpha.example.ca/": html({ "X-Frame-Options": "SAMEORIGIN" }) });
  const s = await setup({ previewFetch: f });
  const id = await s.add(LIVE);
  let res = await s.ann.get("/portal/o/alpha/website"), page = await res.text();
  assert.equal(iframes(page).length, 0);
  assert.match(page, /class="ws-card"/); assert.match(page, /Visit website/); assert.match(page, /href="https:\/\/alpha\.example\.ca\/"/);
  assert.ok(!/frame-src/.test(res.headers.get("Content-Security-Policy")));
  await s.addShot(id);
  res = await s.ann.get("/portal/o/alpha/website"); page = await res.text();
  assert.equal(iframes(page).length, 0);
  assert.match(page, /<img class="ws-frame__img" src="\/portal\/o\/alpha\/website\/[^"]+\/screenshot"/); assert.match(page, /Visit website/);
  assert.ok(!/class="ws-card"/.test(page));
});

test("when the website is unreachable, the preview is simply absent: the page, its details and the link still work", async () => {
  const s = await setup({ previewFetch: stub({}) });
  await s.add({ ...LIVE, domain_registrar: "Namecheap", domain_owner: "client" });
  const res = await s.ann.get("/portal/o/alpha/website"); const page = await res.text();
  assert.equal(res.status, 200); assert.equal(iframes(page).length, 0);
  assert.match(page, /Namecheap · owned by You/); assert.match(page, /Visit website/);
});

test("with no way to check (no previewFetch, as in these tests by default) no preview is attempted; screenshot-only websites keep working", async () => {
  const s = await setup();
  const id = await s.add(LIVE); await s.addShot(id);
  const page = await (await s.ann.get("/portal/o/alpha/website")).text();
  assert.equal(iframes(page).length, 0); assert.match(page, /ws-frame__img/);
});

test("in development, no address, http-only and several-website views never preview (and never contact anything)", async () => {
  const f = stub({ "*": html() });
  const s = await setup({ previewFetch: f });
  await s.add({ name: "New shop", origin: "framework", status: "in_development", managed_by_framework: true, published: true });
  assert.equal(iframes(await (await s.ann.get("/portal/o/alpha/website")).text()).length, 0);
  assert.equal(f.calls.length, 0, "nothing contacted for a website still being built");
  const s2 = await setup({ previewFetch: stub({ "*": html() }) });
  await s2.add({ ...LIVE, url: "http://alpha.example.ca" });
  assert.equal(iframes(await (await s2.ann.get("/portal/o/alpha/website")).text()).length, 0, "http is never framed");
  const f3 = stub({ "*": html() }); const s3 = await setup({ previewFetch: f3 });
  await s3.add(LIVE); await s3.add({ ...LIVE, name: "Second", url: "https://second.example.ca" });
  const list = await s3.ann.get("/portal/o/alpha/website");
  assert.equal(iframes(await list.text()).length, 0); assert.equal(f3.calls.length, 0, "the list page contacts no website"); assert.ok(!/frame-src/.test(list.headers.get("Content-Security-Policy")));
});

test("a website's own page can be opened on its detail page; the iframe never points anywhere but the stored address", async () => {
  const s = await setup({ previewFetch: stub({ "https://alpha.example.ca/": html() }) });
  const id = await s.add(LIVE);
  const res = await s.ann.get(`/portal/o/alpha/website/${id}`);
  assert.equal(iframes(await res.text()).length, 1);
  assert.match(res.headers.get("Content-Security-Policy"), /frame-src https:\/\/alpha\.example\.ca$/);
});

test("the preview module has no inline script or style, and the portal's own origin is never framed with allow-same-origin", async () => {
  const s = await setup({ previewFetch: stub({ "https://staging.frameworkco.ca/": html() }) });
  await s.add({ ...LIVE, url: ORIGIN + "/" });
  const page = await (await s.ann.get("/portal/o/alpha/website")).text();
  for (const tag of iframes(page)) assert.ok(!/allow-same-origin/.test(tag));
  assert.ok(!/<script|\sstyle=|\son[a-z]+=/i.test(page));
});

test("the check reports the HTTP status it saw (so a platform error is visible) and a same-zone problem reads as a status, not as a block", async () => {
  const P = "https://staging.frameworkco.ca";
  const r = await checkEmbeddable("https://frameworkco.ca/", { fetch: stub({ "https://frameworkco.ca/": html({}, 530) }), portalOrigin: P });
  assert.deepEqual(r, { embeddable: false, reason: "status", frameOrigins: [], status: 530 });
  const d = await diagnoseEmbeddable("https://frameworkco.ca/", { fetch: stub({ "https://frameworkco.ca/": html({ "X-Frame-Options": "DENY" }) }), portalOrigin: P });
  assert.equal(d.reason, "blocked"); assert.equal(d.summary.xFrameOptions, "DENY"); assert.deepEqual(d.hops, [{ host: "frameworkco.ca", status: 200 }]);
  assert.equal((await diagnoseEmbeddable("http://x.example.ca/", { fetch: stub({}), portalOrigin: P })).reason, "address_not_checkable");
  assert.equal((await diagnoseEmbeddable("https://x.example.ca/", { portalOrigin: P })).reason, "unavailable");
});

test("each fresh check is logged with words and a status code only (never the address); a cached answer is not logged again", async () => {
  const lines = []; const orig = console.log; console.log = (l) => lines.push(l);
  try {
    const s = await setup({ previewFetch: stub({ "https://alpha.example.ca/": html({}, 530) }) });
    await s.add(LIVE);
    await s.ann.get("/portal/o/alpha/website");
  } finally { console.log = orig; }
  const evt = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).find((x) => x && x.evt === "website.preview");
  assert.ok(evt, "logged");
  assert.deepEqual([evt.outcome, evt.reason, evt.status], ["fallback", "status", 530]);
  assert.ok(!lines.join("\n").includes("alpha.example.ca"), "the website's address is never logged");
});

test("the Worker is configured so a fetch to its own zone reaches the website (Cloudflare: otherwise it goes to the zone's origin, ignoring Workers)", () => {
  const cfg = read("wrangler.jsonc");
  assert.match(cfg, /"compatibility_flags":\s*\["global_fetch_strictly_public"\]/);
  const src = ["worker/index.js", "worker/assessment.js", "worker/card.js"].map(read).join("\n");
  assert.ok(!/fetch\(["`']https?:\/\/(www\.)?frameworkco\.ca/.test(src), "nothing else in the Worker fetches its own zone");
});
