/* The Website dashboard (worker/portal/website-workspace.js, assets/css/portal-website-workspace.css): modular cards for the live site, the preview, what needs the client, recent updates, genuine
   traffic figures and the request expander. No migration: it reads what 0030, 0011 and 0028 already hold. Pure renderer tests, then the real router. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sites from "../portal/repo/websites.js";
import * as wk from "../portal/repo/website-workspace.js";
import { workspaceSections } from "../portal/website-workspace.js";
import { PORTAL_CSP } from "../portal/http.js";

const src = (f) => readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
const vm = { base: "/portal/o/alpha" };
const SITE = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha Contracting", url: "https://alpha.example.ca/", status: "live", hasScreenshot: false, managedByFramework: true };
const NOW = new Date("2026-11-22T18:00:00.000Z");
const U = (o) => ({ id: "u" + Math.random().toString(16).slice(2, 10), title: "Homepage layout updated", detail: "New hero and spacing.", environment: "staging", kind: "approval", status: "awaiting_review", decisionNote: null, decidedAt: null, publishedAt: "2026-11-21T10:00:00.000Z", createdAt: "2026-11-21T10:00:00.000Z", updatedAt: "2026-11-21T10:00:00.000Z", ...o });
const T = (o) => ({ id: "t" + Math.random().toString(16).slice(2, 10), title: "Upload project photos", detail: "Six to ten photos.", cta: "upload", dueDate: "2026-12-05", status: "open", responseText: null, publishedAt: "2026-11-01T10:00:00.000Z", createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", ...o });
const WS = (updates, tasks, over = {}) => ({ available: true, stagingUrl: "https://staging.alpha.example.ca", updates, tasks, needsReview: updates.filter((u) => u.kind === "approval" && u.status === "awaiting_review").length, needed: tasks.filter((t) => t.status === "open").length, ...over });
const O = (workspace, over = {}) => ({ workspace, csrf: "tok", canDecide: true, canRespond: true, canRequest: true, staff: false, now: NOW, ...over });
const noInline = (h) => !/ style=|<style|<script|javascript:|\son[a-z]+=["']/i.test(h);

test("cards: pending items under Needs your attention with a count, everything decided under Recent updates; every row is closed until chosen", () => {
  const ws = WS([U({ title: "Review homepage" }), U({ title: "Services page refined", status: "approved", decidedAt: "2026-11-12T10:00:00.000Z" }), U({ title: "Gallery added", kind: "info", status: "info" })], [T({ title: "Confirm service area", cta: "respond", dueDate: "2026-11-10" }), T({ title: "Send logo files", status: "done", updatedAt: "2026-10-22T10:00:00.000Z" })]);
  const h = workspaceSections(vm, SITE, O(ws, { title: true }));
  const needs = /<section class="wd-card wd-needs"[\s\S]*?<\/section>/.exec(h)[0], recent = /<section class="wd-card wd-recent"[\s\S]*?<\/section>/.exec(h)[0];
  assert.match(needs, /Needs your attention <span class="wd-count">2</);
  assert.ok(needs.includes("Review homepage") && needs.includes("Confirm service area") && !needs.includes("Services page refined") && !needs.includes("Send logo files"));
  assert.ok(recent.includes("Services page refined") && recent.includes("Gallery added") && recent.includes("Send logo files") && !recent.includes("Review homepage"));
  assert.match(needs, /Overdue since Nov 10/); assert.match(needs, /wd-mk--late/, "an overdue task is marked, with words as well as colour");
  assert.match(h, /<a class="wd-need" href="#needed">2 need you<\/a>/); assert.match(h, /<h1 class="wd-title">Alpha Contracting<\/h1>/); assert.match(h, /Managed by Framework/);
  assert.ok(!/<details[^>]*\sopen[\s>]/.test(h), "nothing is open by default: rows, the request form, the two groups");
  assert.ok(noInline(h));
});

test("approval and tasks keep their controls: Approve, Reject with required notes, Respond, Upload, a review link; a member only sees where it stands; master access never decides", () => {
  const u = U({ title: "Review homepage" }), up = T({ cta: "upload" }), rs = T({ title: "Confirm area", cta: "respond" }), rv = T({ title: "Approve content", cta: "review" });
  const owner = workspaceSections(vm, SITE, O(WS([u], [up, rs, rv])));
  assert.match(owner, new RegExp(`action="/portal/o/alpha/website/${SITE.id}/updates/${u.id}/approve"`)); assert.match(owner, new RegExp(`action="/portal/o/alpha/website/${SITE.id}/updates/${u.id}/reject"`));
  assert.match(owner, /<textarea[^>]*name="note"[^>]*minlength="3"[^>]*required/); assert.match(owner, /name="csrf" value="tok"/);
  assert.match(owner, new RegExp(`/website/${SITE.id}/tasks/${rs.id}/respond`)); assert.match(owner, /requests\/new\?kind=change&amp;title=Upload%20project%20photos/);
  assert.match(owner, /<a class="wd-link" href="https:\/\/staging\.alpha\.example\.ca\/?"[^>]*>Open preview ↗/);
  const member = workspaceSections(vm, SITE, O(WS([u], [rs]), { canDecide: false }));
  assert.ok(!/updates\/[^"]+\/approve/.test(member) && /An account owner can approve or reject this update\./.test(member));
  assert.match(member, new RegExp(`/tasks/${rs.id}/respond`), "any member can still answer a task");
  const staff = workspaceSections(vm, SITE, O(WS([u], [rs]), { canDecide: false, canRespond: false, staff: true }));
  assert.match(staff, /Only the client’s account owner can approve or reject updates\./); assert.ok(!/\/respond"|\/approve"/.test(staff));
  const rejected = workspaceSections(vm, SITE, O(WS([U({ status: "rejected", decisionNote: "Make the headline <b>bigger</b>", decidedAt: "2026-11-20T10:00:00.000Z" })], [])));
  assert.match(rejected, /Make the headline &lt;b&gt;bigger&lt;\/b&gt;/); assert.match(rejected, /Framework will revise this/);
});

test("recent updates show five and keep the rest one tap away; nothing is dropped", () => {
  const many = Array.from({ length: 8 }, (_, i) => U({ title: `Done ${i}`, status: "approved", decidedAt: `2026-10-${String(10 + i).padStart(2, "0")}T10:00:00.000Z` }));
  const h = workspaceSections(vm, SITE, O(WS(many, [])));
  const recent = /<section class="wd-card wd-recent"[\s\S]*?<\/section>/.exec(h)[0];
  for (let i = 0; i < 8; i++) assert.ok(recent.includes(`Done ${i}`), `Done ${i}`);
  assert.match(recent, /<details class="wd-earlier"><summary[^>]*>Earlier updates \(3\)/);
  assert.ok(recent.indexOf("Done 7") < recent.indexOf("Done 0"), "newest first");
  assert.match(workspaceSections(vm, SITE, O(WS([], []))), /Nothing needs you right now\./);
});

test("website cards: the screenshot when there is one, a neutral panel when not; Production and Staging are never titles; an unlaunched site says so", () => {
  const none = workspaceSections(vm, SITE, O(WS([], [])));
  assert.match(none, /No screenshot yet/); assert.match(none, /No preview image yet/); assert.ok(!/<img /.test(none), "no stock or invented picture, ever");
  const withShot = workspaceSections(vm, { ...SITE, hasScreenshot: true }, O(WS([], [])));
  assert.match(withShot, new RegExp(`<img src="/portal/o/alpha/website/${SITE.id}/screenshot" alt="Screenshot of Alpha Contracting"`)); assert.ok(!/No screenshot yet/.test(withShot));
  assert.match(withShot, /No preview image yet/, "automatic preview capture is a later step: the preview card stays neutral until a picture is stored");
  assert.ok(!/<h2[^>]*>(Production|Staging)/.test(withShot));
  const dev = workspaceSections(vm, { ...SITE, status: "in_development" }, O(WS([], [], { stagingUrl: null })));
  assert.match(dev, /Not launched/); assert.match(dev, /No preview yet/); assert.ok(!/Open live site|Open preview/.test(dev));
});

test("website traffic: genuine figures only. Real data shows numbers; stale says when it was read; not connected and errors show no numbers at all", () => {
  const data = { period: { from: "2026-10-24", to: "2026-11-21" }, totals: { visits: 1284, pageViews: 3902 }, previous: { visits: 1146, pageViews: 3500 }, series: Array.from({ length: 29 }, (_, i) => ({ date: `d${i}`, visits: i % 7, pageViews: i })) };
  const ok = workspaceSections(vm, SITE, O(WS([], []), { traffic: { state: "ok", data, fetchedAt: "2026-11-22T17:40:00.000Z" }, analyticsLink: true }));
  assert.match(ok, /<p class="wd-big">1,284<\/p>/); assert.match(ok, /<strong>3,902<\/strong>/); assert.match(ok, /▲ 12%/); assert.equal((ok.match(/<rect /g) || []).length, 29); assert.match(ok, /Cloudflare Web Analytics/);
  assert.match(ok, new RegExp(`href="/portal/o/alpha/website/${SITE.id}/analytics"`)); assert.match(ok, /Counts visits, not people/);
  const stale = workspaceSections(vm, SITE, O(WS([], []), { traffic: { state: "stale", code: "query_failed", data, fetchedAt: "2026-11-20T10:00:00.000Z" }, analyticsLink: true }));
  assert.match(stale, /Showing the figures read on Nov 20/);
  for (const traffic of [null, { state: "not_enabled" }, { state: "not_connected" }]) {
    const h = workspaceSections(vm, SITE, O(WS([], []), { traffic, analyticsLink: false }));
    assert.match(h, /Not connected yet/); assert.ok(!/wd-big|<svg|<rect |analytics"/.test(h), "no figures, no chart, and no link to a page that does not exist");
  }
  const err = workspaceSections(vm, SITE, O(WS([], []), { traffic: { state: "error", code: "query_failed" }, analyticsLink: true }));
  assert.match(err, /Couldn’t load right now/); assert.ok(!/wd-big|<rect /.test(err));
  const flat = workspaceSections(vm, SITE, O(WS([], []), { traffic: { state: "ok", data: { ...data, totals: { visits: 0, pageViews: 0 }, previous: { visits: 0, pageViews: 0 }, series: [] }, fetchedAt: "x" } }));
  assert.match(flat, /<p class="wd-big">0<\/p>/, "a real zero is shown as zero");
  assert.ok(noInline(ok) && noInline(err));
});

test("request a change: a closed expander holding the same form as before; hidden for people who cannot send requests", () => {
  const h = workspaceSections(vm, SITE, O(WS([], [])));
  assert.match(h, /<details class="wd-rq"><summary class="wd-btn">Request a change/);
  assert.match(h, new RegExp(`<form class="wd-form" method="post" action="/portal/o/alpha/website/${SITE.id}/requests" enctype="multipart/form-data">`)); assert.match(h, /type="file"/); assert.match(h, /<option value="change">/); assert.match(h, /<option value="support">/);
  assert.ok(!/id="wd-rq-h"/.test(workspaceSections(vm, SITE, O(WS([], []), { canRequest: false }))));
});

test("the page: grey ground edge to edge, the cards, Details and Additional services closed and complete, the strict script-free policy, nothing inline", async () => {
  const w = await makeWorld({});
  w.env.PORTAL_WEBSITE = "1";
  const A = await w.org("alpha", "Alpha Co"); await w.invite(A, "ann@alpha.test", "owner");
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const id = (await sites.createWebsite(w.db, A.id, { name: "Alpha Contracting", url: "https://alpha.example.ca", origin: "client", status: "live", managedByFramework: true, published: true }, "admin@framework.test", { now: w.clock.now() })).id;
  await wk.createUpdate(w.db, A.id, id, { title: "Homepage layout updated", detail: "New hero.", environment: "staging", kind: "approval", published: true }, "admin@framework.test", { now: w.clock.now() });
  const res = await ann.get(`/portal/o/alpha/website/${id}`); const h = await res.text();
  assert.equal(res.status, 200); assert.equal(res.headers.get("Content-Security-Policy"), PORTAL_CSP, "still the strict, script-free policy");
  assert.match(h, /<main id="main" class="page page--bleed"/); assert.match(h, /<div class="wd-ground"><div class="wd-wrap">/); assert.match(h, /portal-website-workspace\.css/);
  assert.match(h, /<h1 class="h1 h1--section">Alpha Contracting<\/h1>/, "the website's own page keeps its breadcrumb and heading"); assert.match(h, /1 needs you/);
  assert.match(await (await ann.get("/portal/o/alpha/website")).text(), /<h1 class="wd-title">Alpha Contracting<\/h1>/, "with one website, /website is that website's dashboard, headed by its name");
  const groups = [...h.matchAll(/<details class="wd-moreg"([^>]*)><summary><b>([^<]+)<\/b>/g)].map((m) => [m[2], m[1]]);
  assert.deepEqual(groups, [["Details", ""], ["Additional services", ""]], "both groups exist and are closed");
  assert.match(h, /Download website files/); assert.match(h, /Get support/); assert.ok(!/Request a change<\/h3>/.test(h), "the request action is the card, not a second row");
  assert.match(h, /Not connected yet/, "this website has no analytics settings: no numbers, no invented chart");
  assert.match(h, new RegExp(`href="/portal/o/alpha/website/${id}/analytics"`));
  assert.ok(noInline(h));
  // an uploaded screenshot (migration 0011) becomes the live card's picture through the existing authorised route
  w.db.raw.prepare("UPDATE websites SET screenshot_key = ?, screenshot_name = 's.png', screenshot_format = 'png', screenshot_type = 'image/png', screenshot_size = 10, screenshot_sha256 = ? WHERE id = ?").run("x".repeat(48), "a".repeat(64), id);
  const h2 = await (await ann.get(`/portal/o/alpha/website/${id}`)).text();
  assert.match(h2, new RegExp(`<img src="/portal/o/alpha/website/${id}/screenshot"`)); assert.ok(!/No screenshot yet/.test(h2));
});

test("the stylesheet: sharp corners, no shadow, no inline style hooks, reduced motion switches every animation and transition off, and the phone order is Needs, Request, Recent, Traffic", () => {
  const css = src("assets/css/portal-website-workspace.css");
  assert.ok(!/border-radius:\s*[^0\s]|box-shadow:(?!\s*inset)|@import|url\(/.test(css.replace(/\/\*[\s\S]*?\*\//g, "")), "no rounded corners, no drop shadows, no external or inline images");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ \.wd \*, \.wd \*::before, \.wd \*::after \{ animation: none !important; transition: none !important; \} \}/);
  const order = (c) => Number(new RegExp(`\\.wd-${c} \\{[^}]*order: (\\d)`).exec(css.slice(css.indexOf("max-width: 640px")))[1]);
  assert.deepEqual(["needs", "req", "recent", "traffic"].map(order), [3, 4, 5, 6]);
  const js = src("worker/portal/website-workspace.js");
  assert.ok(!/style=|<script|innerHTML|fetch\(/.test(js), "the renderer writes no inline style or script and fetches nothing");
});
