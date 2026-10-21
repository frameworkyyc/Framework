// Phase 6B accessibility improvements, checked at the markup/CSS/script level (the browser behaviour is checked separately in Chromium):
// form-border and tile-number contrast, the error summary (links, focus hook, scripts only where they have a job), aria-required without native
// validation, autocomplete tokens, no duplicate Account headings, touch-target hit areas, and that none of it loosens CSP, CSRF or isolation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, revOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { PROFILE_STEPS } from "../portal/profile-schema.js";
import { PORTAL_CSP, PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const CSS = read("assets/css/portal.css");
const token = (name) => CSS.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
const lum = (hex) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rule = (selector) => { const m = CSS.match(new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*\\{([^}]*)\\}")); return m ? m[1] : ""; };
const form = (o) => new URLSearchParams(o).toString();

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  return { w, ann, mia, bob };
}
async function post(w, who, path, fields, { csrf } = {}) {
  const page = await (await who.get(path)).text();
  return handlePortal(new Request(ORIGIN + path, { method: "POST", body: form({ csrf: csrf ?? csrfOf(page), rev: revOf(page), ...fields }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const summaryLinks = (html) => [...(html.match(/data-error-summary[\s\S]*?<\/ul><\/div>/) || [""])[0].matchAll(/<a href="#([^"]+)">/g)].map((m) => m[1]);

/* ------------------------------------------------------------------ contrast */

test("form control borders meet 3:1 against the page (WCAG 1.4.11); the old decorative grey is not used for them", () => {
  const edge = token("field-edge"), paper = token("paper");
  assert.ok(ratio(edge, paper) >= 3, `field edge ${edge} is ${ratio(edge, paper).toFixed(2)}:1`);
  assert.ok(ratio(token("stone"), paper) < 3, "stone stays a decoration-only colour");
  const controls = rule('.field input[type="text"], .field input[type="email"], .field input[type="tel"], .field input[type="url"], .field textarea, .field select');
  assert.match(controls, /border:\s*1px solid var\(--field-edge\)/);
  assert.ok(!/var\(--stone\)/.test(controls));
  assert.ok(ratio(token("ink"), paper) >= 7, "the focus outline stays ink");
  assert.match(rule(".field input:focus, .field textarea:focus, .field select:focus"), /outline:\s*2px solid var\(--ink\)/);
});

test("the numbers on 'Coming soon' tiles are readable text colour (4.5:1), not the decorative grey", () => {
  assert.match(rule(".tile--soon .tile__n"), /color:\s*var\(--slate\)/);
  assert.ok(ratio(token("slate"), token("paper")) >= 4.5);
  assert.ok(!/\.tile--soon \.tile__n\s*\{[^}]*var\(--stone\)/.test(CSS));
});

test("error summary colours and invalid-field borders are legible (signal is at least 4.5:1)", () => {
  assert.ok(ratio(token("signal"), token("paper")) >= 4.5);
  assert.match(CSS, /\.field input\[aria-invalid="true"\][^{]*\{\s*border-color:\s*var\(--signal\)/);
});

/* ------------------------------------------------------------------ Business Profile markup */

test("every REQUIRED Business Profile question is aria-required and no question uses native required validation (partial saves stay possible)", async () => {
  const { ann } = await setup();
  for (const step of PROFILE_STEPS) {
    const html = await (await ann.get(`/portal/o/alpha/profile/${step.id}`)).text();
    assert.ok(!/<(input|textarea|select)\b[^>]*\srequired(\s|=|>)/.test(html), `${step.id}: no native required attribute`);
    assert.match(html, /<form method="post"[^>]*\snovalidate>/, `${step.id}: novalidate stays`);
    for (const f of step.fields) {
      const el = html.match(new RegExp(`<(?:input|textarea|select)\\b[^>]*name="${f.id}"[^>]*>`));
      if (f.kind === "choice") {
        const fs = html.match(new RegExp(`<fieldset[^>]*id="p-${step.id}-${f.id}"[^>]*>`))[0];
        assert.equal(/aria-required="true"/.test(fs), Boolean(f.required), `${f.id} radio group`);
        if (f.required) assert.match(fs, /role="radiogroup"/);
      } else assert.equal(/aria-required="true"/.test(el[0]), Boolean(f.required), `${step.id}.${f.id}`);
    }
  }
});

test("contact and organization fields carry the right autocomplete tokens; other answers stay off", async () => {
  const { ann } = await setup();
  const want = { legal: "organization", cname: "name", crole: "organization-title", cemail: "email", cphone: "tel", site: "url" };
  const seen = {};
  for (const step of PROFILE_STEPS) {
    const html = await (await ann.get(`/portal/o/alpha/profile/${step.id}`)).text();
    for (const m of html.matchAll(/<input\b[^>]*name="([a-z]+)"[^>]*>/g)) if (m[1] !== "csrf" && m[1] !== "rev" && !/type="radio"/.test(m[0])) seen[m[1]] = (m[0].match(/autocomplete="([^"]*)"/) || [])[1];
  }
  for (const [id, token] of Object.entries(want)) assert.equal(seen[id], token, id);
  for (const [id, token] of Object.entries(seen)) if (!(id in want)) assert.equal(token, "off", id);
  const { mia } = await setup();
  assert.match(await (await mia.get("/portal/o/alpha/account")).text(), /id="an" name="name" type="text"[^>]*autocomplete="name"/);
});

/* ------------------------------------------------------------------ error summary */

test("a refused Business Profile save shows an error summary whose links target the invalid fields; focus script loads only then", async () => {
  const { w, ann } = await setup();
  const ok = await ann.get("/portal/o/alpha/profile/contact");
  assert.equal(ok.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT, "the profile step already loads its one script");
  const clean = await ok.text();
  assert.ok(!clean.includes("data-error-summary"), "no summary on a normal load");
  const res = await post(w, ann, "/portal/o/alpha/profile/contact", { cname: "Ann", cemail: "not-an-email", cphone: "12" });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /<div class="error-summary" role="alert" tabindex="-1" data-error-summary aria-labelledby="error-summary-title">/);
  const links = summaryLinks(html);
  assert.deepEqual(links, ["p-contact-cemail", "p-contact-cphone"], "one link per invalid field, in form order");
  for (const id of links) assert.ok(ids(html).has(id), `${id} exists on the page`);
  assert.match(html, /Email: Enter a valid email address\./);
  assert.match(html, /<script src="\/assets\/js\/portal-profile\.js" defer><\/script>/);
  assert.ok(html.indexOf("data-error-summary") < html.indexOf(`<form method="post" action="/portal/o/alpha/profile/contact"`), "the summary is above the form");
  assert.ok(html.indexOf("data-error-summary") < html.indexOf('id="p-contact-cname"'), "and before the first field");
  assert.match(html, /name="cemail"[^>]*aria-invalid="true"/);
  assert.ok(!/<script>|style=/.test(html), "no inline script or style");
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT);
});

test("the summary escapes what it shows, a valid submission shows none, and one problem uses the singular heading", async () => {
  const { w, ann } = await setup();
  const one = await (await post(w, ann, "/portal/o/alpha/profile/contact", { cname: "Ann", cemail: "bad", cphone: "403-555-0100" })).text();
  assert.match(one, /Some answers need attention\. Nothing was saved\./);
  assert.deepEqual(summaryLinks(one), ["p-contact-cemail"]);
  const saved = await post(w, ann, "/portal/o/alpha/profile/contact", { cname: "Ann <b>", cemail: "ann@alpha.test", cphone: "" });
  assert.equal(saved.status, 303);
  const bad = await (await post(w, ann, "/portal/o/alpha/profile/online", { site: "<script>alert(1)</script>" })).text();
  assert.ok(!bad.includes("<script>alert"), "submitted text is never echoed unescaped");
  assert.deepEqual(summaryLinks(bad), ["p-online-site"]);
});

test("Feedback and Account name errors get the same summary, with the script only on those error pages", async () => {
  const { w, ann } = await setup();
  const normal = await ann.get("/portal/o/alpha/feedback");
  assert.equal(normal.headers.get("content-security-policy"), PORTAL_CSP, "no script on a normal feedback page");
  const fb = await post(w, ann, "/portal/o/alpha/feedback", { kind: "", message: "" });
  assert.equal(fb.status, 422);
  const fbHtml = await fb.text();
  const fbLinks = summaryLinks(fbHtml);
  assert.ok(fbLinks.length >= 1);
  for (const id of fbLinks) assert.ok(ids(fbHtml).has(id), id);
  assert.match(fbHtml, /portal-profile\.js/);
  const acc = await post(w, ann, "/portal/o/alpha/account", { name: "   " });
  assert.equal(acc.status, 422);
  const accHtml = await acc.text();
  assert.deepEqual(summaryLinks(accHtml), ["an"]);
  assert.ok(ids(accHtml).has("an"));
  assert.match(accHtml, /portal-profile\.js/);
  assert.equal((await ann.get("/portal/o/alpha/account")).headers.get("content-security-policy"), PORTAL_CSP);
});

test("the focus script moves focus to the summary only when one exists, never throws without a form, and adds no network or storage access", () => {
  const js = read("assets/js/portal-profile.js");
  assert.match(js, /querySelector\("\[data-error-summary\]"\)/);
  assert.match(js, /summary\.focus\(\)/);
  assert.ok(js.indexOf("data-error-summary") < js.indexOf("if (!form) return;"), "the focus step runs before the form-only code, so Account and Feedback pages get it too");
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|document\.cookie|eval\(|innerHTML/.test(js));
  const tab = rule(".error-summary");
  assert.match(tab, /scroll-margin-top/, "the sticky header never covers the summary");
  assert.match(rule(".error-summary:focus"), /outline:\s*2px solid var\(--ink\)/);
});

/* ------------------------------------------------------------------ Account headings */

test("Account has one heading per section, each labelling its region, and no hidden duplicates", async () => {
  const { ann, mia } = await setup();
  for (const who of [ann, mia]) {
    const html = await (await who.get("/portal/o/alpha/account")).text();
    const h2 = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((m) => m[1]);
    assert.deepEqual(h2, ["Organization", "You", "Notifications", "Help and privacy"]);
    assert.ok(!/<h2[^>]*visually-hidden/.test(html));
    for (const m of html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)) assert.match(html, new RegExp(`<h2 class="section__title" id="${m[1]}">`), m[1]);
  }
});

/* ------------------------------------------------------------------ touch targets */

test("small links get a 44px hit area through an invisible pseudo-element, and the header controls reach 44px on phones", () => {
  assert.match(rule(".foot a::after, .crumb a::after, .text-link::after"), /inset:\s*-15px -6px/);
  assert.match(rule(".foot a, .crumb a, .text-link"), /position:\s*relative/);
  assert.match(CSS, /\.primary a \{ min-width: 44px;/);
  assert.match(CSS, /@media \(max-width: 880px\), \(pointer: coarse\) \{ \.signout \.btn[^}]*min-height: 44px/);
  assert.match(CSS, /\.signout \.btn::after \{ content: ""; position: absolute; inset: -4px; \}/, "the 36px desktop sign-out button gets a 44px hit area");
  const stepper = rule(".stepper a");
  assert.match(stepper, /min-height:\s*44px/);
});

/* ------------------------------------------------------------------ nothing else loosened */

test("the changes keep CSRF, the CSP and tenant isolation: a bad token is refused, no inline script/style anywhere, another organization is still a 404", async () => {
  const { w, ann, bob } = await setup();
  const forged = await post(w, ann, "/portal/o/alpha/profile/contact", { cname: "x" }, { csrf: "forged" });
  assert.equal(forged.status, 403);
  assert.ok(!(await forged.text()).includes("data-error-summary"));
  for (const p of ["", "/profile", "/profile/contact", "/account", "/members", "/feedback"]) {
    const res = await ann.get("/portal/o/alpha" + p);
    const csp = res.headers.get("content-security-policy");
    assert.ok(csp === PORTAL_CSP || csp === PORTAL_CSP_WITH_SCRIPT, p);
    assert.ok(!/style=|<script>/.test(await res.text()), p);
  }
  assert.equal((await bob.get("/portal/o/alpha/profile/contact")).status, 404);
  assert.equal((await post(w, bob, "/portal/o/beta/profile/contact", { cname: "Bob", cemail: "bad" })).status, 422);
});

test("sign-in and system pages keep every part of the page inside a landmark: banner, main and contentinfo (axe 'region')", () => {
  const frame = readFileSync(new URL("../portal/frame.js", import.meta.url), "utf8");
  const auth = frame.slice(frame.indexOf("export function authFrame"));
  assert.match(auth, /<header class="auth__top">/);
  assert.match(auth, /<main id="main"/);
  assert.match(auth, /\$\{footer\}/);
  assert.doesNotMatch(auth, /<div class="auth__top">/);
});

test("the skip link target <main> can receive focus (tabindex -1) on every portal page, and shows no focus ring of its own", () => {
  for (const f of ["../portal/frame.js", "../portal/ui.js"]) assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /<main id="main"[^>]*tabindex="-1"/, f);
  assert.match(readFileSync(new URL("../../assets/css/portal.css", import.meta.url), "utf8"), /^main:focus \{ outline: none; \}/m);
});
