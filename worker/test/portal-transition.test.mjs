/* Branded page transitions, loading states and the editorial sign-in (worker/portal/TRANSITIONS.md), Staging only (PORTAL_TRANSITIONS). Proves that with the flag OFF every page is exactly what it was
   (no script, the strict CSP), that with it ON the only change is the same-origin assets, the curtain markup and the script-allowing CSP on the pages that use them, that authentication and the
   redirects are untouched, and what the script may and may not do (it runs here against a stand-in for the browser, so the rules are checked as behaviour, not only as text). */
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { PORTAL_CSP, PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";
import { transitionsOn } from "../portal/config.js";

const src = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const csp = (res) => res.headers.get("Content-Security-Policy").split(";")[0] && res.headers.get("Content-Security-Policy");

async function setup({ fx = true, demo = false, orgs = 1 } = {}) {
  const w = await makeWorld();
  if (fx) w.env.PORTAL_TRANSITIONS = "1";
  if (demo) w.env.PORTAL_DEMO = "1";
  const alpha = await w.org("alpha", "Alpha Co"); await w.invite(alpha, "ann@alpha.test", "owner");
  if (orgs > 1) { const beta = await w.org("beta", "Beta Co"); await w.invite(beta, "ann@alpha.test", "member"); }
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  return { w, alpha, ann, anon: w.browser() };
}
const noInline = (html) => !/ style=|<style|<script(?![^>]*\ssrc=)|javascript:|\son[a-z]+=["']/i.test(html);

test("the flag: only exactly \"1\" turns it on", () => {
  assert.equal(transitionsOn({ PORTAL_TRANSITIONS: "1" }), true);
  for (const v of [undefined, "", "0", "true", "yes", " 1 x"]) assert.equal(transitionsOn({ PORTAL_TRANSITIONS: v }), false, String(v));
  assert.equal(transitionsOn(undefined), false);
});

test("flag OFF: sign-in and signed-in pages are what they were: no script, no curtain, the strict script-free CSP", async () => {
  const s = await setup({ fx: false });
  const login = await s.anon.get("/portal/login"); const html = await login.text();
  assert.equal(login.status, 200); assert.equal(csp(login), PORTAL_CSP, "no script-src at all");
  assert.match(html, /<body class="auth">/); assert.match(html, /class="btn btn--primary" href="\/portal\/login\?start=1"/);
  assert.ok(!/portal-transition|portal-signin|fw-curtain|fw-fx|data-fw-/.test(html));
  const home = await s.ann.get("/portal/o/alpha"); const h = await home.text();
  assert.equal(home.status, 200); assert.equal(csp(home), PORTAL_CSP); assert.ok(!/portal-transition|fw-curtain|fw-fx|<script/.test(h));
});

test("flag ON: the editorial sign-in is minimal: one instruction, Continue, a discreet help link and Privacy; the session-ended notice is kept", async () => {
  const s = await setup({ demo: true });
  const login = await s.anon.get("/portal/login"); const html = await login.text();
  assert.equal(login.status, 200);
  assert.equal(csp(login), PORTAL_CSP_WITH_SCRIPT, "script-src 'self' and nothing else widened");
  assert.ok(!/unsafe-inline|unsafe-eval|https?:\/\/[^ ;]*script/i.test(csp(login).replace(/https:\/\/(api|cdn)\.fontshare\.com|https:\/\/api\.workos\.com/g, "")));
  assert.ok(noInline(html), "no inline style, inline script or event handler");
  for (const t of ["Client", "Portal", "Enter your email to receive a one-time sign-in code.", ">Need help?<", 'href="mailto:hello@frameworkco.ca"', 'href="/privacy.html"', ">Privacy<"]) assert.ok(html.includes(t), t);
  for (const t of ["demonstration", "/portal/demo", "Not signed in yet", "Access is by invitation", "Calgary", "invitation was sent", "We’ll email you", "Questions?", "si__eyebrow"]) assert.ok(!html.includes(t), "removed: " + t);
  assert.ok(!html.includes(">hello@frameworkco.ca<"), "the address is no longer printed, only linked");
  assert.match(html, /<a class="si__btn" data-fw-signin href="\/portal\/login\?start=1">/, "Continue is the same link auth.js built");
  assert.equal([...html.matchAll(/class="fw-curtain"/g)].length, 1); assert.match(html, /role="status" data-fw-status/);
  assert.match(html, /<meta name="fw-fx" content="page">/); assert.match(html, /href="\/assets\/css\/portal-transition\.css"/); assert.match(html, /href="\/assets\/css\/portal-signin\.css"/); assert.match(html, /<script src="\/assets\/js\/portal-transition\.js"><\/script>/);
  assert.ok(html.indexOf("portal-transition.css") < html.indexOf("portal-transition.js"), "the stylesheet blocks first, so the curtain never flashes");
  assert.match(html, /<h1 class="si__title">/); assert.equal([...html.matchAll(/<h1/g)].length, 1);
  const plain = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " "); assert.ok(plain.length < 420, "very little text on the page (" + plain.length + " characters)");
  const ended = await (await s.anon.get("/portal/login?r=ended")).text(); assert.match(ended, /Your previous session has ended\. Please sign in again\./); assert.match(ended, /role="status"/);
  const fwd = await (await s.anon.get("/portal/login?login_hint=ann%40alpha.test")).text(); assert.match(fwd, /data-fw-signin href="\/portal\/login\?start=1&amp;login_hint=ann%40alpha\.test"/, "forwarded parameters survive");
});

test("flag ON: authentication is untouched: the same redirect to WorkOS, the same state cookie, the same callback, the same sign-out", async () => {
  const off = await setup({ fx: false }), on = await setup({ fx: true });
  const a = await off.anon.get("/portal/login?start=1"), b = await on.anon.get("/portal/login?start=1");
  assert.equal(a.status, b.status); assert.equal(new URL(a.headers.get("Location")).origin, new URL(b.headers.get("Location")).origin);
  assert.deepEqual([...new URL(b.headers.get("Location")).searchParams.keys()].sort(), [...new URL(a.headers.get("Location")).searchParams.keys()].sort());
  assert.equal(a.headers.getSetCookie().length, b.headers.getSetCookie().length);
  assert.equal(on.ann.jar.size, off.ann.jar.size, "the sign-in (callback included) sets exactly the same cookies, no extra one");
  assert.equal((await on.ann.get("/portal/o/alpha")).status, 200, "and the session it made works");
  const cb = await on.anon.get("/portal/auth/callback?code=x&state=y"); assert.ok(!/portal-transition|fw-curtain/.test(await cb.text()), "an error page from the callback has no animation to wait for");
});

test("flag ON: signed-in pages get the curtain, the assets and the script CSP; error and no-access pages do not", async () => {
  const s = await setup({ orgs: 2 });
  const home = await s.ann.get("/portal/o/alpha"); const h = await home.text();
  assert.equal(csp(home), PORTAL_CSP_WITH_SCRIPT); assert.ok(noInline(h));
  assert.match(h, /<meta name="fw-fx" content="app">/); assert.equal([...h.matchAll(/class="fw-curtain"/g)].length, 1);
  assert.ok(h.indexOf('class="skip-link"') < h.indexOf('class="fw-curtain"') && h.indexOf('class="fw-curtain"') < h.indexOf('<header class="bar'), "skip link first, then the curtain, then the page");
  assert.match(h, /<main id="main" class="wrap page"/, "the page's own layout is unchanged");
  const picker = await (await s.ann.get("/portal")).text(); assert.match(picker, /Choose an organization/); assert.match(picker, /<meta name="fw-fx" content="app">/);
  const nf = await s.ann.get("/portal/o/nope"); assert.ok(!/portal-transition|fw-curtain/.test(await nf.text()), "a 404 is shown at once"); assert.equal(csp(nf), PORTAL_CSP);
});

test("the stylesheet: a black full-screen curtain that never takes the pointer, with reduced motion, no external references, and the website's drawing", () => {
  const css = src("assets/css/portal-transition.css"), si = src("assets/css/portal-signin.css");
  assert.match(css, /\.fw-curtain \{[^}]*position: fixed; inset: 0;[^}]*background: #0A0A0A;[^}]*pointer-events: none;/);
  for (const c of ["fw-intro", "fw-enter", "fw-leave", "fw-loading"]) assert.match(css, new RegExp(`html\\.${c} `), c);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none !important/); assert.match(css, /@media print \{ \.fw-curtain \{ display: none; \} \}/);
  assert.ok(!/@import|url\(|expression\(/.test(css + si), "nothing is fetched by the stylesheets");
  assert.match(si, /@media \(prefers-reduced-motion: reduce\)/); assert.match(si, /min-height: 56px/, "a comfortable touch target"); assert.match(si, /env\(safe-area-inset-top\)/);
  const site = src("assets/css/styles.css"), path = (s) => /M215\.2 312\.1[^"]+/.exec(s)?.[0];
  assert.ok(path(src("index.html")) && src("worker/portal/frame.js").includes(path(src("index.html"))), "the curtain's outer F is the website hero drawing, not a redraw");
  assert.ok(site.includes("dw-outer") && /stroke-dasharray: 1/.test(css), "same stroke-draw technique (pathLength 1)");
});

test("the script: classes only. It never prevents or delays navigation, fetches nothing, and stores only a short-lived hint", () => {
  const js = src("assets/js/portal-transition.js");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|localStorage|document\.cookie|innerHTML|insertAdjacentHTML|eval\(|new Function|location\.(href|assign|replace)\s*=|window\.open|stopPropagation|stopImmediatePropagation|preventDefault\(/.test(js), "no navigation hijacking and no injected HTML");
  assert.match(js, /sessionStorage/); assert.match(js, /prefers-reduced-motion: reduce/); assert.match(js, /pageshow/); assert.match(js, /persisted/); assert.match(js, /Escape/); assert.match(js, /GIVE_UP/); assert.match(js, /ev\.defaultPrevented/);
  assert.ok(!/setTimeout\([^)]*(location|submit\(\)|click\(\))/.test(js), "no timer ever starts or postpones a navigation");
  assert.ok((js.match(/window\.setTimeout/g) || []).length >= 2, "timers only change classes");
});

/* ---- the script against a stand-in for the browser ---- */
function browser({ path = "/portal/o/alpha", search = "", hint = null, reduce = false, metaFx = "app" } = {}) {
  const store = new Map(); if (hint) store.set("fw.tr", JSON.stringify(hint));
  const classes = new Set(), listeners = {}, timers = []; let status = "";
  const status_el = { get textContent() { return status; }, set textContent(v) { status = v; } };
  const documentElement = { classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)), contains: (c) => classes.has(c) } };
  const document = { documentElement, querySelector: (sel) => (sel.includes("fw-fx") ? (metaFx ? { getAttribute: () => metaFx } : null) : sel.includes("data-fw-status") ? status_el : null), addEventListener: (t, f) => (listeners["d" + t] = f) };
  let now = Date.now(); const location = { origin: "https://staging.frameworkco.ca", pathname: path, search, href: "https://staging.frameworkco.ca" + path + search };
  const window = { document, location, sessionStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    matchMedia: () => ({ matches: reduce }), setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].fn = null; },
    addEventListener: (t, f) => (listeners["w" + t] = f) };
  const ctx = vm.createContext({ window, document, URL, JSON, Date: { now: () => now } }); ctx.window.Date = ctx.Date;
  vm.runInContext(src("assets/js/portal-transition.js"), ctx);
  const anchor = (href, extra = {}) => ({ href: new URL(href, location.href).href, target: "", hasAttribute: (a) => !!extra[a], ...extra });
  const click = (a, ev = {}) => { const e = { defaultPrevented: false, button: 0, target: { closest: () => a }, ...ev }; listeners.dclick(e); };
  const tick = (ms) => { now += ms; timers.filter((t) => t.fn && t.at <= now).forEach((t) => { const f = t.fn; t.fn = null; f(); }); };
  return { classes, store, anchor, click, tick, listeners, status: () => status, setPath: (p) => { location.pathname = p; } };
}
const classOf = (b) => [...b.classes].sort().join(" ");

test("script: arriving. Only a fresh hint from a portal link animates; direct links, refresh, Back and stale hints show nothing", () => {
  const T = Date.now();
  assert.equal(classOf(browser()), "", "no hint (direct link, refresh, Back/Forward)");
  assert.equal(classOf(browser({ hint: { k: "nav", t: Date.now() } })), "fw-enter");
  assert.equal(classOf(browser({ hint: { k: "nav", t: Date.now() - 60_000 } })), "", "stale");
  assert.equal(classOf(browser({ hint: { k: "in", t: Date.now() - 5000 } })), "fw-intro", "the sign-in intro on a signed-in page");
  const login = browser({ hint: { k: "in", t: Date.now() }, metaFx: "page" }); assert.equal(classOf(login), "", "not on the sign-in or error pages…"); assert.ok(login.store.has("fw.tr"), "…the hint waits for the portal");
  assert.equal(classOf(browser({ hint: { k: "in", t: T - 30 * 60_000 } })), "", "an old sign-in hint is dropped");
  const ok = browser({ hint: { k: "nav", t: Date.now() } }); assert.equal(ok.store.has("fw.tr"), false, "consumed: a refresh does not replay it");
  assert.equal(classOf(browser({ hint: { k: "in", t: Date.now() }, reduce: true })), "", "reduced motion: no intro");
  assert.equal(classOf(browser({ hint: { k: "nav", t: Date.now() }, reduce: true })), "", "reduced motion: no transition");
});

test("script: leaving. A link to another major section dips to black at once; everything else navigates untouched", () => {
  const b = browser();
  b.click(b.anchor("/portal/o/alpha/account")); assert.equal(classOf(b), "fw-leave", "the dip starts on the click"); assert.match(b.store.get("fw.tr"), /"k":"nav"/);
  b.tick(300); assert.equal(classOf(b), "fw-leave", "a quick navigation never becomes a loader");
  b.tick(400); assert.equal(classOf(b), "fw-leave fw-loading", "a genuine wait (over 0.65 s) shows the animated mark"); assert.equal(b.status(), "Loading", "announced politely");
  b.tick(9000); assert.equal(classOf(b), "", "gives up by itself if the page is still here (a download, a stalled request)"); assert.equal(b.status(), ""); assert.equal(b.store.has("fw.tr"), false);
  const inSection = browser({ path: "/portal/o/alpha/branding" }); inSection.click(inSection.anchor("/portal/o/alpha/branding/book")); assert.equal(classOf(inSection), "", "inside Branding: instant, as before");
  const anchorOnly = browser({ path: "/portal/o/alpha/branding" }); anchorOnly.click(anchorOnly.anchor("#logo")); assert.equal(classOf(anchorOnly), "", "an in-page anchor");
  for (const [label, a, ev] of [["modified click", ["/portal/o/alpha/account"], { ctrlKey: true }], ["shift click", ["/portal/o/alpha/account"], { shiftKey: true }], ["middle button", ["/portal/o/alpha/account"], { button: 1 }], ["a handler already took it", ["/portal/o/alpha/account"], { defaultPrevented: true }],
    ["new tab", ["/portal/o/alpha/account", { target: "_blank" }], {}], ["download attribute", ["/portal/o/alpha/account", { download: true }], {}], ["opt out", ["/portal/o/alpha/account", { "data-fw-skip": true }], {}],
    ["another site", ["https://example.com/portal/o/alpha/account"], {}], ["outside the portal", ["/privacy.html"], {}], ["a file download route", ["/portal/o/alpha/branding/files/abc"], {}], ["a pdf", ["/portal/o/alpha/invoices/9/statement.pdf"], {}]]) {
    const x = browser(); x.click(x.anchor(a[0], a[1] || {}), ev); assert.equal(classOf(x), "", label);
  }
  const org = browser({ path: "/portal/o/alpha/account" }); org.click(org.anchor("/portal/o/beta/account")); assert.equal(classOf(org), "fw-leave", "another organization is another section");
  const dir = browser({ path: "/portal" }); dir.click(dir.anchor("/portal/o/alpha")); assert.equal(classOf(dir), "fw-leave", "directory to a client");
});

test("script: reduced motion has no decorative dip; a real wait still shows the still mark; Escape and Back never leave a curtain", () => {
  const r = browser({ reduce: true }); r.click(r.anchor("/portal/o/alpha/account")); assert.equal(classOf(r), "", "no dip"); assert.equal(r.store.has("fw.tr"), false, "and nothing for the next page to animate");
  r.tick(700); assert.equal(classOf(r), "fw-loading", "a real wait: the mark (still, per the stylesheet)");
  const b = browser(); b.click(b.anchor("/portal/o/alpha/account")); b.tick(700); b.listeners.dkeydown({ key: "Tab" }); assert.equal(classOf(b), "fw-leave fw-loading", "other keys do nothing");
  b.listeners.dkeydown({ key: "Escape" }); assert.equal(classOf(b), "", "Escape stops waiting");
  const c = browser(); c.click(c.anchor("/portal/o/alpha/account")); c.listeners.wpageshow({ persisted: true }); assert.equal(classOf(c), "", "Back from the bfcache: no stuck curtain");
  const d = browser({ hint: { k: "nav", t: Date.now() } }); d.listeners.wpageshow({ persisted: false }); assert.equal(classOf(d), "fw-enter", "an ordinary load keeps its arrival");
  const s = browser(); s.click(s.anchor("/portal/login?start=1", { "data-fw-signin": true })); assert.match(s.store.get("fw.tr"), /"k":"in"/, "Continue records the sign-in for the portal's intro");
  const e = browser({ hint: { k: "nav", t: Date.now() } }); e.click(e.anchor("/portal/o/alpha/members")); assert.equal(classOf(e), "fw-leave", "a leave replaces the arrival state, so the dip is never hidden by it");
});

test("forms: a slow save shows the mark only after a real wait; sign-out dips; a stopped submission shows nothing", () => {
  const mkForm = (action) => ({ nodeName: "FORM", getAttribute: () => action });
  const run = (action, prevented = false) => { const b = browser(); const f = mkForm(action); b.listeners.dsubmit({ target: f, defaultPrevented: prevented }); b.tick(1); return b; };
  const slow = run("/portal/o/alpha/account/save"); assert.equal(classOf(slow), "", "not at once"); slow.tick(600); assert.match(classOf(slow), /fw-loading/); assert.equal(slow.status(), "Loading"); slow.tick(9000); assert.equal(classOf(slow), "", "and it gives up by itself");
  assert.equal(classOf(run("/portal/o/alpha/account/save", true)) , "", "a prevented submit is untouched");
  const out = run("/portal/logout"); assert.match(classOf(out), /fw-leave/, "sign-out is a navigation: the dip, then the black sign-in");
});

test("config: transitions enabled in both environments by explicit reviewed vars", () => {
  const cfg = src("wrangler.jsonc"), top = cfg.slice(0, cfg.indexOf('"previews"')).replace(/^\s*\/\/.*$/gm, ""), pre = cfg.slice(cfg.indexOf('"previews"'));
  assert.match(top, /"PORTAL_TRANSITIONS": "1"/, "Production explicitly enables transitions"); assert.match(pre, /"PORTAL_TRANSITIONS": "1"/);
  assert.equal(JSON.parse(src("scripts/ops/staging-expected.json")).plainVars.PORTAL_TRANSITIONS, "1");
});
