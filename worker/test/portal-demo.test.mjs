// The static demo portal (/portal/demo) and the new client-facing views: static, labelled, fail-closed, no script / inline style, auth intact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePortal } from "../portal/router.js";
import { makeWorld, ORIGIN } from "./helpers/portal-e2e.mjs";

const T0 = new Date("2026-03-10T17:00:00Z");
const css = readFileSync(new URL("../../assets/css/portal.css", import.meta.url), "utf8");


const boom = () => { throw new Error("database touched"); };
const throwing = { prepare: boom, batch: boom, exec: boom };
const world = await makeWorld();
const demoEnv = (over = {}) => ({ ...world.env, PORTAL_DEMO: "1", PORTAL_DB: throwing, ...over });
const get = (path, env = demoEnv(), init) => handlePortal(new Request(ORIGIN + path, init), env, { now: T0 });

const PAGES = ["/portal/demo", "/portal/demo/projects", "/portal/demo/projects/website", "/portal/demo/projects/brand-identity", "/portal/demo/projects/launch-photography",
  "/portal/demo/activity", "/portal/demo/activity?type=milestone", "/portal/demo/documents", "/portal/demo/documents?project=website", "/portal/demo/account"];

test("every demo page renders from static data without touching the database, a session or a cookie", async () => {
  for (const p of PAGES) {
    const res = await get(p);
    assert.equal(res.status, 200, p);
    assert.equal(res.headers.get("set-cookie"), null, p);
    const html = await res.text();
    assert.match(html, /class="demo-banner"/, p + " carries the demonstration banner");
    assert.match(html, /fictional/i);
    assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, p + " has one h1");
    assert.match(html, /<a class="skip-link" href="#main">/);
    assert.match(html, /<main id="main"/);
    assert.match(html, /aria-current="page"/);
  }
});
test("demo pages carry no script, no inline style and no inline handler, and the strict CSP is unchanged", async () => {
  for (const p of PAGES) {
    const res = await get(p);
    const html = await res.text();
    assert.ok(!/<script/i.test(html), p);
    assert.ok(!/\sstyle\s*=/i.test(html), p);
    assert.ok(!/\son[a-z]+\s*=/i.test(html), p);
    assert.ok(!/<form[^>]*method="post"/i.test(html), p + " has no write form");
    const csp = res.headers.get("content-security-policy");
    assert.match(csp, /default-src 'none'/);
    assert.ok(!/script-src|unsafe-inline/.test(csp));
    assert.match(res.headers.get("cache-control") || "", /no-store/);
  }
});
test("the demo is read-only: other methods are refused, unknown paths and projects are 404", async () => {
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal((await get("/portal/demo", demoEnv(), { method: m, body: "x=1" })).status, 405, m);
  for (const p of ["/portal/demo/projects/nope", "/portal/demo/nope", "/portal/demo/projects/website/x", "/portal/demo/members"]) assert.equal((await get(p)).status, 404, p);
});
test("the demo is fail-closed: off without the flag, and never on a production host even with the flag", async () => {
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: undefined }))).status, 404);
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: "true" }))).status, 404);
  assert.equal((await get("/portal/demo", demoEnv({ PORTAL_DEMO: "0" }))).status, 404);
  const prod = demoEnv({ PORTAL_BASE_URL: "https://frameworkco.ca", PORTAL_ALLOW_PRODUCTION: "1" });
  const res = await handlePortal(new Request("https://frameworkco.ca/portal/demo"), prod, { now: T0 });
  assert.equal(res.status, 404);
  const www = demoEnv({ PORTAL_BASE_URL: "https://www.frameworkco.ca", PORTAL_ALLOW_PRODUCTION: "1" });
  assert.equal((await handlePortal(new Request("https://www.frameworkco.ca/portal/demo/projects"), www, { now: T0 })).status, 404);
});
test("query filters are allow-listed: unknown values are ignored and are never reflected", async () => {
  const html = await (await get("/portal/demo/activity?type=%3Cimg%20src=x%3E&project=%22%3E%3Cb%3E")).text();
  assert.ok(!html.includes("<img src=x>") && !html.includes("<b>"));
  const filtered = await (await get("/portal/demo/activity?type=milestone")).text();
  const all = await (await get("/portal/demo/activity")).text();
  assert.ok(filtered.length < all.length);
});
test("demo documents are preview-only: downloads are visibly inert and no file link exists", async () => {
  const html = await (await get("/portal/demo/documents")).text();
  assert.match(html, /not available in the demo/i);
  assert.match(html, /Sample document/);
  assert.ok(!/href="[^"]*\.(pdf|docx?|xlsx?|zip)"/i.test(html));
});

test("live pages use the new design, show honest not-connected blocks and keep tenant isolation", async () => {
  const w = await makeWorld();
  const a = await w.org("alpha", "Alpha Co"), b = await w.org("beta", "Beta Co");
  await w.invite(a, "ann@alpha.test", "owner");
  const br = w.browser();
  const user = w.user(1, "ann@alpha.test");
  const signed = await br.signIn(user);
  assert.ok([302, 303].includes(signed.status), "signed in");
  for (const path of ["", "/projects", "/activity", "/documents", "/account"]) {
    const res = await br.get("/portal/o/alpha" + path);
    assert.equal(res.status, 200, path);
    const html = await res.text();
    assert.match(html, /\/assets\/css\/portal\.css/);
    assert.ok(!/<script/i.test(html) && !/\sstyle\s*=/i.test(html), path);
    assert.ok(!html.includes("Harbour &amp; Pine") && !html.includes("Harbour & Pine"), "no demo content in live pages");
  }
  const docs = await (await br.get("/portal/o/alpha/documents")).text();
  assert.match(docs, /Not connected yet/);
  assert.equal((await br.get("/portal/o/beta")).status, 404);
  assert.equal((await br.get("/portal/o/beta/documents")).status, 404);
  assert.equal((await br.get("/portal/o/beta/account")).status, 404);
});
test("live documents and account require a session", async () => {
  const w = await makeWorld();
  await w.org("alpha", "Alpha Co");
  for (const p of ["/documents", "/account", ""]) {
    const res = await handlePortal(new Request(ORIGIN + "/portal/o/alpha" + p), w.env, { now: T0 });
    assert.ok([302, 303, 401, 404].includes(res.status), p + " " + res.status);
    assert.notEqual(res.status, 200);
  }
});

test("the stylesheet is self-contained: no remote imports or urls, honours reduced motion, print and forced colours, and has focus styles", () => {
  assert.ok(!/@import|url\(\s*["']?https?:/i.test(css));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media print/);
  assert.match(css, /forced-colors/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /\.skip-link/);
});
