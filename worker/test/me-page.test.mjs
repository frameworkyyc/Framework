// Framework Personal Dashboard (/me): exact destinations (Client Portal live, Nexus), naming, private-page metadata, home-screen tags, and the public card left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("me.html");
const section = (id) => new RegExp(`<section[^>]*aria-labelledby="${id}">([\\s\\S]*?)</section>`).exec(html)[1];
const hrefs = (s) => [...s.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

const PRODUCTION_LINKS = ["https://frameworkco.ca/", "https://frameworkco.ca/admin/clients", "https://frameworkco.ca/portal", "https://nexus.frameworktools.ca/"];
const STAGING_LINKS = ["https://staging.frameworkco.ca/", "https://staging.frameworkco.ca/admin/clients", "https://staging.frameworkco.ca/portal", "https://staging.nexus.frameworktools.ca/"];

test("Production: Website, Admin, the live Client Portal and Nexus, in that order; no 'Coming soon' or disabled entries remain anywhere", () => {
  const prod = section("env-production");
  assert.deepEqual(hrefs(prod), PRODUCTION_LINKS);
  assert.ok(!/coming soon|me-link--off|me-link__soon/i.test(html + read("assets/css/me.css")), "the unavailable state is gone");
  assert.match(prod, /<a class="me-link" href="https:\/\/frameworkco\.ca\/portal">[\s\S]*?<span>Client Portal<\/span>[\s\S]*?\(Production\)/);
  assert.match(prod, /<a class="me-link" href="https:\/\/nexus\.frameworktools\.ca\/">[\s\S]*?<span>Nexus<\/span>[\s\S]*?\(Production\)/);
});

test("Staging: Website, Admin, Client Portal and Nexus, in that order; Nexus Staging matches the Production Nexus row (same icon, same markup) and only differs by host and environment label", () => {
  const stag = section("env-staging"), prod = section("env-production");
  assert.deepEqual(hrefs(stag), STAGING_LINKS);
  const row = (sec, host, env) => new RegExp(`<li><a class="me-link" href="https://${host.replace(/\./g, "\\.")}/">([\\s\\S]*?)<span class="visually-hidden"> \\(${env}\\)</span></a></li>`).exec(sec)[1];
  assert.equal(row(stag, "staging.nexus.frameworktools.ca", "Staging"), row(prod, "nexus.frameworktools.ca", "Production"), "identical icon, label and arrow");
  assert.match(stag, /<span>Nexus<\/span>/);
});

test("the page links to exactly nine destinations (the public card plus the eight environment links); nothing else (no secrets, tokens or emails) is on it", () => {
  assert.deepEqual(hrefs(section("env-production")).concat(hrefs(section("env-staging"))), [...PRODUCTION_LINKS, ...STAGING_LINKS]);
  assert.equal(hrefs(html).length, 9);
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]), ["assets/js/card-config.js", "assets/js/vendor/qrcode.js", "assets/js/me.js"], "only local scripts; no inline script, no third-party script, no service worker");
  assert.ok(!/<script(?![^>]*\ssrc=)/i.test(html));
  assert.ok(!/@|token|secret|password|key=/i.test(html.replace(/<link[^>]*>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "")), "nothing sensitive in the markup");
});

test("naming: the page is the Framework Personal Dashboard; no trace of the old 'Quick Access' name in the page, its styles, script, headers or tests", () => {
  assert.match(html, /<title>Personal Dashboard \| Framework<\/title>/);
  assert.match(html, /<h1 class="me__name">Personal Dashboard<\/h1><p class="me__label">Framework<\/p>/);
  for (const f of ["me.html", "assets/css/me.css", "assets/js/me.js", "_headers", "worker/test/privacy.test.mjs"]) assert.ok(!/quick[- ]access/i.test(read(f)), f);
});

test("private page: noindex/nofollow, no referrer, not in navigation, sitemap or robots; served with no-index headers", () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  for (const f of ["index.html", "about.html", "services.html", "method.html", "portfolio.html", "contact.html", "card.html", "sitemap.xml", "robots.txt", "privacy.html"]) assert.ok(!/\/me\b|me\.html/.test(read(f).replace(/frameworkco\.ca\/[^"\s]*/g, "")), `${f} does not point to /me`);
  const headers = read("_headers");
  for (const p of ["/me", "/me.html"]) {
    const block = new RegExp(`^${p.replace(".", "\\.")}\\n((?:  .+\\n)+)`, "m").exec(headers);
    assert.ok(block, p);
    assert.match(block[1], /X-Robots-Tag: noindex, nofollow/); assert.match(block[1], /Referrer-Policy: no-referrer/); assert.match(block[1], /Cache-Control: no-cache/);
  }
});

test("home-screen support: title, apple touch icon (an existing brand asset), standalone metadata, safe-area viewport, no manifest or service worker", () => {
  assert.match(html, /<title>Personal Dashboard \| Framework<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Framework">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/img\/apple-touch-icon\.png">/);
  assert.ok(existsSync(new URL("../../assets/img/apple-touch-icon.png", import.meta.url)));
  assert.ok(!/manifest|serviceWorker/i.test(html));
  assert.match(read("assets/css/card.css"), /safe-area-inset-top/, "the shared page frame handles the notch and home bar");
});

test("the public card is independent of /me: it neither loads the /me stylesheet nor carries /me rules (the card's own tests pin its content)", () => {
  assert.ok(!/me\.css|\/me\b/.test(read("card.html")));
  assert.ok(!/\.me[-_ {.]/.test(read("assets/css/card.css")));
  assert.match(html, /assets\/css\/card\.css/, "/me reuses the card's frame and logo styles without copying them");
});

test("/me is served as a static page: the Worker does not intercept it, and no new route, binding or setting was added", () => {
  const w = read("wrangler.jsonc");
  assert.ok(!/"\/me"/.test(w));
  assert.ok(!/\/me\b/.test(read("worker/index.js")));
});

/* ------------------------------------------------------------------ My Business Card: View, Share, QR */
import vm from "node:vm";
import { createRequire } from "node:module";
const CARD = "https://frameworkco.ca/card";
const js = read("assets/js/me.js");
const qrSrc = read("assets/js/vendor/qrcode.js");

test("My Business Card sits directly under the header and above Production, with the approved heading, note and three actions", () => {
  const order = ["me__head", 'id="card-heading"', 'id="env-production"', 'id="env-staging"'].map((m) => html.indexOf(m));
  assert.ok(order.every((n, i) => n > 0 && (i === 0 || n > order[i - 1])), "header, My Business Card, Production, Staging");
  const card = section("card-heading");
  assert.match(card, />My Business Card<\/h2>/);
  assert.match(card, />Share your Framework contact details\.<\/p>/);
  assert.deepEqual([...card.matchAll(/<(?:a|button) class="card-act"[^>]*id="([^"]+)"[\s\S]*?<span>([^<]+)<\/span>/g)].map((m) => [m[1], m[2]]), [["me-view", "View Card"], ["me-share", "Share Card"], ["me-qr", "Show QR"]]);
});

test("View Card is a plain link to the public PRODUCTION card (works without JavaScript); Share and QR appear only once the script runs", () => {
  assert.deepEqual(hrefs(section("card-heading")), [CARD]);
  assert.match(html, /<button class="card-act" type="button" id="me-share" hidden>/);
  assert.match(html, /<button class="card-act" type="button" id="me-qr" aria-haspopup="dialog" hidden>/);
  assert.ok(!/target=/.test(section("card-heading")), "normal browser navigation, no new tab");
});

/** A tiny DOM: just enough of the page for me.js (elements by id, listeners, a dialog) so its real behaviour can be driven. */
function harness({ share, clipboard, secure = true, execCopy, showModal = true, cfgUrl } = {}) {
  const els = {};
  const el = (id) => (els[id] ??= { id, hidden: true, textContent: "", innerHTML: "", listeners: {}, classList: new Set(), focused: 0, attrs: {},
    addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, focus() { this.focused++; },
    getBoundingClientRect: () => ({ left: 20, right: 340, top: 100, bottom: 500 }), click() { (this.listeners.click || []).forEach((f) => f({ clientX: 100, clientY: 200 })); } });
  const dialog = el("qr-dialog"); dialog.open = false;
  if (showModal) { dialog.showModal = () => { dialog.open = true; }; dialog.close = () => { dialog.open = false; (dialog.listeners.close || []).forEach((f) => f()); }; }
  const doc = { listeners: {}, activeElement: el("me-qr"), documentElement: { classList: { add: (c) => (doc.locked = true), remove: (c) => (doc.locked = false) } }, getElementById: el, createElement: () => ({ style: {}, setAttribute() {}, select() {}, value: "" }), body: { appendChild() {}, removeChild() {} }, addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }, removeEventListener() {} };
  const nav = {}; if (share) nav.share = share; if (clipboard) nav.clipboard = clipboard;
  const win = { FRAMEWORK_CARD: { cardUrl: cfgUrl ?? CARD }, isSecureContext: secure, document: doc, navigator: nav };
  const ctx = vm.createContext({ window: win, document: { ...doc, execCommand: () => execCopy ?? false }, navigator: nav, setTimeout, clearTimeout });
  ctx.document.execCommand = () => execCopy ?? false; ctx.document.createElement = doc.createElement; ctx.document.body = doc.body;
  vm.runInContext(qrSrc, ctx); ctx.window.qrcode = ctx.qrcode;
  vm.runInContext(js, ctx);
  return { els, el, doc, nav };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test("Share Card: the native share sheet gets the public card URL and the card title; cancelling is silent", async () => {
  const calls = []; const h = harness({ share: (d) => { calls.push(d); return Promise.resolve(); } });
  assert.equal(h.el("me-share").hidden, false); assert.equal(h.el("me-qr").hidden, false);
  h.el("me-share").click(); await tick();
  assert.equal(JSON.stringify(calls), JSON.stringify([{ title: "Framework | Digital Business Card", url: CARD }]));
  assert.equal(h.el("me-status").textContent, "");
  const cancelled = harness({ share: () => Promise.reject(Object.assign(new Error("x"), { name: "AbortError" })), clipboard: { writeText: () => assert.fail("must not copy after a cancel") } });
  cancelled.el("me-share").click(); await tick(); await tick();
  assert.equal(cancelled.el("me-status").textContent, "", "no error, no message");
});

test("Share Card fallback: without native sharing (or if it fails) the URL is copied and a subtle 'Link copied' appears; a refused copy says where the link is", async () => {
  const copied = [];
  const none = harness({ clipboard: { writeText: (v) => (copied.push(v), Promise.resolve()) } });
  none.el("me-share").click(); await tick(); await tick();
  assert.equal(JSON.stringify(copied), JSON.stringify([CARD])); assert.equal(none.el("me-status").textContent, "Link copied");
  const broken = harness({ share: () => Promise.reject(Object.assign(new Error("x"), { name: "NotAllowedError" })), clipboard: { writeText: (v) => (copied.push(v), Promise.resolve()) } });
  broken.el("me-share").click(); await tick(); await tick();
  assert.equal(copied.length, 2); assert.equal(broken.el("me-status").textContent, "Link copied");
  const refused = harness({ clipboard: { writeText: () => Promise.reject(new Error("no")) } });
  refused.el("me-share").click(); await tick(); await tick();
  assert.match(refused.el("me-status").textContent, new RegExp(CARD.replace(/\//g, "\\/")));
});

test("the URL is pinned to the public Production card: a different configured address (for example Staging's) is never used", async () => {
  const calls = []; const h = harness({ share: (d) => (calls.push(d), Promise.resolve()), cfgUrl: "https://staging.frameworkco.ca/card" });
  h.el("me-share").click(); await tick();
  assert.equal(calls[0].url, CARD);
  assert.ok(!/staging|location|origin/i.test(js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")), "the script never looks at the page's own address");
});

test("QR: the code encodes exactly https://frameworkco.ca/card (module-for-module), on a white background with a 4-module quiet zone, drawn locally", () => {
  const h = harness(); h.el("me-qr").click();
  const svg = h.el("qr-box").innerHTML;
  const n = (/viewBox="0 0 (\d+) \d+"/.exec(svg) || [])[1] | 0, d = /<path d="([^"]+)"/.exec(svg)[1];
  assert.match(svg, /<rect width="\d+" height="\d+" fill="#fff"\/>/);
  const dark = new Set([...d.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`));
  const ctx = vm.createContext({}); vm.runInContext(qrSrc, ctx);
  const matrix = (url) => { const q = ctx.qrcode(0, "M"); q.addData(url, "Byte"); q.make(); const c = q.getModuleCount(), set = new Set(); for (let r = 0; r < c; r++) for (let k = 0; k < c; k++) if (q.isDark(r, k)) set.add(`${k + 4},${r + 4}`); return { c, set }; };
  const want = matrix(CARD), other = matrix("https://staging.frameworkco.ca/card");
  assert.equal(n, want.c + 8, "4 modules of quiet space on every side");
  assert.deepEqual([...dark].sort(), [...want.set].sort());
  assert.notDeepEqual([...other.set].sort(), [...dark].sort(), "a different URL gives a different code");
  assert.equal(h.el("qr-url").textContent, "frameworkco.ca/card");
  assert.match(svg, /aria-label="QR code linking to https:\/\/frameworkco\.ca\/card"/);
  assert.ok(!/https?:\/\/(?!frameworkco\.ca\/card)/.test(js.replace(/\/\*[\s\S]*?\*\//g, "")), "no other address, and no QR service, in the script");
});

test("QR dialog: opens modally with focus on Close, closes with the button, the backdrop and Escape (fallback path), restores focus and scrolling", () => {
  const h = harness(); const d = h.el("qr-dialog");
  h.el("me-qr").click();
  assert.equal(d.open, true); assert.equal(h.doc.locked, true); assert.equal(h.el("qr-close").focused, 1);
  h.el("qr-close").click(); assert.equal(d.open, false); assert.equal(h.doc.locked, false); assert.equal(h.el("me-qr").focused, 1, "focus returns to Show QR");
  h.el("me-qr").click(); d.listeners.click[0]({ clientX: 5, clientY: 5 }); assert.equal(d.open, false, "a tap on the dim backdrop closes it");
  h.el("me-qr").click(); d.listeners.click[0]({ clientX: 100, clientY: 200 }); assert.equal(d.open, true, "a tap inside the box does not");
  // browsers without <dialog>.showModal(): the open attribute is used and Escape is handled by the script
  const f = harness({ showModal: false }); f.el("me-qr").click();
  assert.equal("open" in f.el("qr-dialog").attrs, true);
  f.doc.listeners.keydown[0]({ key: "Enter" }); assert.equal("open" in f.el("qr-dialog").attrs, true);
  f.doc.listeners.keydown[0]({ key: "Escape" }); assert.equal("open" in f.el("qr-dialog").attrs, false);
  assert.equal(f.doc.locked, false);
  const m = html.match(/<dialog class="card__qr" id="qr-dialog" aria-labelledby="qr-title">[\s\S]*?<\/dialog>/)[0];
  assert.match(m, /id="qr-close" aria-label="Close QR code"/); assert.match(m, />Scan to view my business card<\/h2>/);
});

test("no new dependency: the QR code reuses the card's vendored generator; nothing is fetched, stored or sent; the card's own files are unchanged", () => {
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|sendBeacon|document\.cookie|serviceWorker/.test(js));
  assert.equal(read("assets/js/vendor/qrcode.js"), qrSrc);
  for (const f of ["card.html", "assets/js/card.js", "assets/css/card.css"]) assert.ok(!/me\.js|me\.css|me-qr|me-share/.test(read(f)), f);
});
