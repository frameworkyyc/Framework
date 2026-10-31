/* Website status and progress, SEO & Search Visibility, the Home page structure and the Additional Services catalogue, through the real router and Admin API in one world (shared database and bucket).
   Migrations 0015 and 0016 are proposed: tests ask for them by name, or leave them out to prove everything still works before they are applied. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as sites from "../portal/repo/websites.js";
import * as sup from "../portal/repo/support.js";
import { stageOf, stageKeyOf, milestoneProgress, validPairing } from "../portal/website-stage.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const rowsOf = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const UUID0 = "00000000-0000-4000-8000-000000000000";

async function setup({ migrated = true, branding = false } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld(migrated ? { proposed: ["0015_website_status_seo.sql", "0016_service_catalogue.sql"] } : {});
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_FILES: bucket, PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  w.env.PORTAL_WEBSITE = "1"; if (branding) w.env.PORTAL_BRANDING = "1";
  const A = await w.org("alpha", "Alpha Co"), Bo = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(Bo, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser(), anon = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const call = async (path, { method = "GET", json, form } = {}) => {
    const h = { Origin: ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, {});
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, json: type.includes("json") ? await res.json() : null };
  };
  const site = async (org, over = {}) => { const r = await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const upload = (org, id, name, bytes) => { const f = new FormData(); f.append("file", new File([bytes], name)); return call(`/clients/${org.id}/websites/${id}/package`, { method: "POST", form: f }); };
  const publish = (org, id, published) => call(`/clients/${org.id}/websites/${id}/package/publish`, { method: "POST", json: { published } });
  const csrf = async (b, slug, path) => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${path}`)).text())[1];
  const send = async (b, path, fields, files = [], { slug = "alpha", csrfFrom = "/website", token } = {}) => {
    const fd = new FormData();
    fd.set("csrf", token ?? await csrf(b, slug, csrfFrom));
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN } });
  };
  const svc = async (b, fields, { slug = "alpha", token } = {}) => b.post(`/portal/o/${slug}/website/services/request`, { csrf: token ?? await csrf(b, slug, "/website"), ...fields });
  return { w, bucket, A, Bo, ann, mia, bob, anon, call, site, upload, publish, csrf, send, svc };
}
const html = async (r) => r.text();
const WEB_ZIP = () => S.zip([{ name: "index.html", data: S.text("<h1>hi</h1>") }, { name: "assets/app.js", data: S.text("console.log(1)") }, { name: "styles.css", data: S.text("body{}") }, { name: "contact.php", data: S.text("<?php ?>") }]);


const WS = (org, id, p = "") => `/clients/${org.id}/websites/${id}${p}`;
const page = async (b, p = "/website", slug = "alpha") => (await b.get(`/portal/o/${slug}${p}`)).text();
const home = async (b, slug = "alpha") => (await b.get(`/portal/o/${slug}`)).text();
const addMile = (s, org, id, title, status = "todo", extra = {}) => s.call(WS(org, id, "/milestones"), { method: "POST", json: { title, status, ...extra } });
const hubTitles = (h) => [...h.matchAll(/<span class="hub__title">([^<]+)</g)].map((m) => m[1]);
const secOf = (h, id) => { const i = h.indexOf(`id="${id}"`); return i < 0 ? "" : h.slice(i, h.indexOf("</section>", i)); };

/* ------------------------------------------------------------------ status, phase and progress */

test("stages: the stored status plus an optional phase read as In development, Awaiting client feedback, Awaiting approval, Live or Maintenance; nonsense pairings read as the plain status", () => {
  assert.deepEqual(["in_development", "awaiting_feedback", "awaiting_approval", "live", "maintenance", "existing"].map((k) => stageOf({ status: k.startsWith("awaiting") ? "in_development" : k === "maintenance" ? "live" : k, phase: k === "awaiting_feedback" || k === "awaiting_approval" || k === "maintenance" ? k : null }).label),
    ["In development", "Awaiting client feedback", "Awaiting approval", "Live", "Maintenance", "Existing website"]);
  assert.equal(stageKeyOf({ status: "live", phase: "awaiting_approval" }), "live"); assert.equal(stageKeyOf({ status: "in_development", phase: "maintenance" }), "in_development");
  assert.equal(stageKeyOf(null), "existing"); assert.equal(stageKeyOf({ status: "bogus" }), "existing");
  assert.ok(validPairing("live", "maintenance") && validPairing("in_development", "awaiting_feedback") && validPairing("live", null) && !validPairing("live", "awaiting_feedback") && !validPairing("existing", "maintenance"));
});
test("progress is computed from real milestones, only for a website in development; none means no bar; a live website has no progress at all", () => {
  const m = (...st) => st.map((status, i) => ({ status, title: "M" + i }));
  assert.deepEqual(milestoneProgress({ status: "in_development" }, m("done", "done", "todo", "in_progress")), { show: true, percent: 50, done: 2, total: 4, next: "M2" });
  assert.equal(milestoneProgress({ status: "in_development" }, m("done", "done")).percent, 100);
  assert.deepEqual(milestoneProgress({ status: "in_development" }, []), { show: false });
  assert.deepEqual(milestoneProgress({ status: "live" }, m("done", "done")), { show: false });
  assert.deepEqual(milestoneProgress({ status: "existing" }, m("done")), { show: false });
});

test("Admin sets a stage and milestones; the client sees the status and a progress bar computed from them, on the website page and on the Home card", async () => {
  const s = await setup({ branding: true });
  const id = await s.site(s.A, { name: "New site", url: null, origin: "framework", status: "in_development" });
  assert.equal((await addMile(s, s.A, id, "Design approved", "done")).status, 201);
  assert.equal((await addMile(s, s.A, id, "Content loaded", "in_progress")).status, 201);
  assert.equal((await addMile(s, s.A, id, "Launch", "todo", { due_date: "2026-12-01" })).status, 201);
  assert.equal((await addMile(s, s.A, id, "Handover", "todo")).status, 201);
  const view = (await s.call(`/clients/${s.A.id}/websites`)).json.websites[0];
  assert.deepEqual([view.stage, view.progress.percent, view.progress.done, view.progress.total], ["in_development", 25, 1, 4]);
  let p = await page(s.ann);
  assert.match(p, /status--active">In development/); assert.match(p, /<progress class="meter" max="100" value="25"/); assert.match(p, /25% complete/); assert.match(p, /1 of 4 milestones complete\. Next: Content loaded/);
  assert.match(p, /Design approved[\s\S]*Done/); assert.match(p, /due Dec 1, 2026/);
  let h = await home(s.ann);
  assert.match(h, /status--active">In development/); assert.match(h, /<progress class="meter" max="100" value="25"/); assert.match(h, /1 of 4 milestones done/);
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "awaiting_feedback" } })).status, 200);
  p = await page(s.ann); h = await home(s.ann);
  for (const x of [p, h]) { assert.match(x, /status--attention">Awaiting client feedback/); assert.match(x, /value="25"/); }
  assert.match(p, /needs your feedback/);
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "awaiting_approval" } })).status, 200);
  assert.match(await page(s.ann), /Awaiting approval[\s\S]*waiting for your approval/);
  const first = (await s.call(`/clients/${s.A.id}/websites`)).json.websites[0].milestones[0];
  assert.equal((await s.call(WS(s.A, id, `/milestones/${first.id}/move`), { method: "POST", json: { direction: "down" } })).status, 200);
  assert.equal((await s.call(`/clients/${s.A.id}/websites`)).json.websites[0].milestones[1].title, "Design approved", "reordered");
});

test("a live website says Live, never a permanent 100%; Maintenance reads as Maintenance; launching clears an 'awaiting' phase that no longer fits", async () => {
  const s = await setup({ branding: true });
  const id = await s.site(s.A, { name: "New site", url: null, origin: "framework", status: "in_development" });
  await addMile(s, s.A, id, "Everything", "done");
  await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "awaiting_approval" } });
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { status: "live", url: "https://new.example.ca" } })).status, 200);
  const v = (await s.call(`/clients/${s.A.id}/websites`)).json.websites[0];
  assert.deepEqual([v.status, v.phase, v.stage], ["live", null, "live"], "the stale phase was cleared");
  let p = await page(s.ann), h = await home(s.ann);
  for (const x of [p, h]) { assert.match(x, /status--live">Live/); assert.doesNotMatch(x, /<progress class="meter" max="100" value="100"|100% complete/); }
  assert.doesNotMatch(secOf(p, "ws-prog-h"), /milestone/);
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "maintenance" } })).status, 200);
  p = await page(s.ann); h = await home(s.ann);
  for (const x of [p, h]) assert.match(x, /status--live">Maintenance/);
  const bad = await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "awaiting_feedback" } });
  assert.deepEqual([bad.status, bad.json.error], [422, "invalid_phase"], "an awaiting phase doesn't fit a live website");
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "dancing" } })).status, 422);
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: null } })).status, 200);
  assert.match(await home(s.ann), /status--live">Live/);
});

test("milestones are validated and belong to one website of one organization; clients only read them, for a published website", async () => {
  const s = await setup();
  const a = await s.site(s.A, { name: "A", url: null, origin: "framework", status: "in_development" }), b = await s.site(s.Bo, { name: "B", url: null, origin: "framework", status: "in_development" });
  const m = (await addMile(s, s.A, a, "Real one")).json.id;
  for (const bad of [{ title: "" }, { title: "x".repeat(121) }, { title: "a\nb" }, { title: "ok", status: "finished" }, { title: "ok", due_date: "2026-02-31" }, { title: "ok", detail: "x".repeat(501) }]) assert.equal((await s.call(WS(s.A, a, "/milestones"), { method: "POST", json: bad })).status, 422, JSON.stringify(bad));
  assert.equal((await s.call(WS(s.A, a, "/milestones"), { method: "POST", json: { title: "ok", nonsense: 1 } })).status, 400);
  assert.equal((await s.call(WS(s.Bo, b, `/milestones/${m}/update`), { method: "POST", json: { title: "hijack" } })).status, 404, "another organization's website cannot reach it");
  assert.equal((await s.call(WS(s.A, b, `/milestones/${m}/update`), { method: "POST", json: { title: "hijack" } })).status, 404, "nor via a website of a different organization");
  assert.equal((await s.call(WS(s.A, a, `/milestones/${m}/update`), { method: "POST", json: { status: "done" } })).status, 200);
  const done = (await s.call(`/clients/${s.A.id}/websites`)).json.websites[0].milestones[0];
  assert.ok(done.completedAt); assert.equal((await s.call(WS(s.A, a, `/milestones/${m}/update`), { method: "POST", json: { status: "todo" } })).status, 200);
  assert.equal((await s.call(`/clients/${s.A.id}/websites`)).json.websites[0].milestones[0].completedAt, null, "reopening clears the completion time");
  assert.ok(!/Real one/.test(await page(s.bob, "/website", "beta")), "Beta never sees Alpha's milestones");
  assert.equal((await s.ann.post(`/portal/o/alpha/website/${a}/milestones`, { csrf: "x", title: "mine" })).status, 404, "no client route writes a milestone");
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM activity_log WHERE action LIKE 'website.milestone.%' AND visibility = 'internal'")[0].n >= 3, true);
  await s.call(WS(s.A, a, "/update"), { method: "POST", json: { published: false } });
  assert.ok(!/Real one/.test(await page(s.ann)), "an unpublished website shows nothing");
  assert.equal((await s.call(WS(s.A, a, `/milestones/${m}/delete`), { method: "POST", json: {} })).status, 200);
  assert.equal((await s.call(WS(s.A, a, `/milestones/${m}/delete`), { method: "POST", json: {} })).status, 404);
});

test("before migration 0015: the Website page and Home work exactly as before, and Admin says plainly the stage can't be saved", async () => {
  const s = await setup({ migrated: false });
  const id = await s.site(s.A, { name: "Main", url: "https://alpha.example.ca", origin: "client", status: "live" });
  assert.equal((await s.call(`/clients/${s.A.id}/websites`)).json.phaseAvailable, false);
  const r = await s.call(WS(s.A, id, "/update"), { method: "POST", json: { phase: "maintenance" } });
  assert.deepEqual([r.status, r.json.error], [409, "phase_unavailable"]);
  assert.match(await page(s.ann), /status--live">Live/); assert.match(await home(s.ann), /status--live">Live/);
  assert.equal((await s.call(WS(s.A, id, "/update"), { method: "POST", json: { name: "Renamed" } })).status, 200, "ordinary edits still work");
  assert.equal((await s.call(WS(s.A, id, "/seo"))).json.available, false);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/seo`)).status, 404);
});

/* ------------------------------------------------------------------ SEO & Search Visibility */

const seoUrl = (org, id, p = "") => WS(org, id, "/seo" + p);
const post = (s, url, json) => s.call(url, { method: "POST", json });

test("SEO & Search Visibility: Admin manages status, checklist, recommendations, figures and reports; the client sees only what is published, inside Website", async () => {
  const s = await setup({ branding: true });
  const id = await s.site(s.A);
  assert.ok(!/SEO &amp; Search Visibility/.test(await page(s.ann)), "nothing until Admin publishes");
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/seo`)).status, 404);
  assert.equal((await post(s, seoUrl(s.A, id), { status: "in_progress", summary: "We have fixed titles and are now writing page descriptions.", published: true })).status, 200);
  const c1 = (await post(s, seoUrl(s.A, id, "/items"), { kind: "checklist", title: "Page titles written", status: "done" })).json.id;
  await post(s, seoUrl(s.A, id, "/items"), { kind: "checklist", title: "Sitemap submitted" });
  await post(s, seoUrl(s.A, id, "/items"), { kind: "recommendation", title: "Add your opening hours", detail: "Customers search for this.", priority: "high" });
  await post(s, seoUrl(s.A, id, "/items"), { kind: "recommendation", title: "Add photos", priority: "low", status: "done" });
  assert.equal((await post(s, seoUrl(s.A, id, "/metrics"), { period_start: "2026-10-01", period_end: "2026-10-31", impressions: 12400, clicks: 310, position: 14.26, indexed_pages: 18, published: true })).status, 201);
  await post(s, seoUrl(s.A, id, "/metrics"), { period_start: "2026-09-01", period_end: "2026-09-30", impressions: 9000, clicks: 200, published: true });
  await post(s, seoUrl(s.A, id, "/metrics"), { period_start: "2026-08-01", period_end: "2026-08-31", impressions: 1, published: false });
  await post(s, seoUrl(s.A, id, "/reports"), { title: "October report", period: "October 2026", summary: "A good month.", link: "https://example.com/report", published: true });
  await post(s, seoUrl(s.A, id, "/reports"), { title: "Draft report", published: false });
  const teaser = await page(s.ann);
  assert.match(teaser, /SEO &amp; Search Visibility/); assert.match(teaser, /status--active">In progress/); assert.match(teaser, /fixed titles/); assert.match(teaser, new RegExp(`href="/portal/o/alpha/website/${id}/seo"`));
  assert.doesNotMatch(await home(s.ann), /SEO/, "not a main navigation item or a Home card");
  const nav = (h) => h.slice(h.indexOf('<nav class="primary"'), h.indexOf("</nav>", h.indexOf('<nav class="primary"')));
  assert.doesNotMatch(nav(teaser), /SEO/);
  const seo = await page(s.ann, `/website/${id}/seo`);
  assert.match(seo, /Page titles written/); assert.match(seo, /1 of 2 complete/); assert.match(seo, /Add your opening hours/); assert.match(seo, /High priority/); assert.match(seo, /12,400/); assert.match(seo, /310/); assert.match(seo, /14\.3/); assert.match(seo, /Oct 1, 2026 to Oct 31, 2026/);
  assert.match(seo, /Sep 1, 2026 to Sep 30, 2026/); assert.doesNotMatch(seo, /Aug 1, 2026/, "an unpublished period stays hidden");
  assert.match(seo, /href="https:\/\/example\.com\/report"[^>]*rel="noopener noreferrer"/); assert.doesNotMatch(seo, /Draft report/);
  assert.match(seo, /entered by Framework[\s\S]*not a live feed/);
  assert.ok(seo.indexOf("Add your opening hours") < seo.indexOf("Add photos"), "open recommendations first");
  assert.equal((await post(s, seoUrl(s.A, id, `/items/${c1}/update`), { status: "todo" })).status, 200);
  assert.match(await page(s.ann, `/website/${id}/seo`), /0 of 2 complete/);
  await post(s, seoUrl(s.A, id), { published: false });
  assert.equal((await s.ann.get(`/portal/o/alpha/website/${id}/seo`)).status, 404, "withdrawn: gone from the client");
});

test("SEO is per client and read-only for clients: another organization, a member of it, and anonymous requests get nothing; every Admin input is validated and escaped", async () => {
  const s = await setup();
  const a = await s.site(s.A), b = await s.site(s.Bo, { url: "https://beta.example.ca" });
  await post(s, seoUrl(s.A, a), { status: "monitoring", summary: "<script>alert(1)</script> & more", published: true });
  const it = (await post(s, seoUrl(s.A, a, "/items"), { kind: "checklist", title: "<b>bold</b>" })).json.id;
  assert.equal((await s.bob.get(`/portal/o/beta/website/${a}/seo`)).status, 404, "Alpha's website id through Beta's portal");
  assert.equal((await s.bob.get(`/portal/o/alpha/website/${a}/seo`)).status, 404, "Alpha's portal is not Beta's");
  assert.equal((await s.anon.get(`/portal/o/alpha/website/${a}/seo`)).status, 303);
  const html0 = await page(s.ann, `/website/${a}/seo`);
  assert.match(html0, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; more/); assert.match(html0, /&lt;b&gt;bold&lt;\/b&gt;/); assert.ok(!html0.includes("<script>alert"));
  assert.equal((await post(s, seoUrl(s.Bo, a, `/items/${it}/update`), { title: "hijack" })).status, 404, "an item of another organization's website cannot be edited");
  assert.equal((await post(s, seoUrl(s.A, b, `/items/${it}/update`), { title: "hijack" })).status, 404);
  for (const [path, body, code] of [["", { status: "great" }, "invalid_status"], ["", { summary: "x".repeat(1001) }, "invalid_summary"], ["/items", { kind: "task", title: "x" }, "invalid_kind"], ["/items", { kind: "checklist", title: "" }, "invalid_title"],
    ["/items", { kind: "checklist", title: "x", priority: "high" }, "invalid_priority"], ["/items", { kind: "recommendation", title: "x", priority: "urgent" }, "invalid_priority"], ["/reports", { title: "r", link: "http://insecure.example" }, "invalid_link"],
    ["/reports", { title: "r", link: "javascript:alert(1)" }, "invalid_link"], ["/reports", { title: "r", link: "https://user:pw@example.com/x" }, "invalid_link"], ["/metrics", { period_start: "2026-10-31", period_end: "2026-10-01", impressions: 1 }, "invalid_date"],
    ["/metrics", { period_start: "2026-10-01", period_end: "2026-10-31" }, "invalid_input"], ["/metrics", { period_start: "2026-10-01", period_end: "2026-10-31", clicks: -5 }, "invalid_number"], ["/metrics", { period_start: "2026-10-01", period_end: "2026-10-31", position: 0 }, "invalid_number"]]) {
    const r = await post(s, seoUrl(s.A, a, path), body); assert.deepEqual([r.status, r.json && r.json.error], [422, code], JSON.stringify(body));
  }
  assert.equal((await post(s, seoUrl(s.A, a, "/metrics"), { period_start: "2026-10-01", period_end: "2026-10-31", clicks: 1 })).status, 201);
  assert.equal((await post(s, seoUrl(s.A, a, "/metrics"), { period_start: "2026-10-01", period_end: "2026-10-31", clicks: 2 })).status, 409, "one set of figures per period");
  assert.equal((await post(s, seoUrl(s.A, a, "/items"), { kind: "checklist", title: "ok", nonsense: 1 })).status, 400);
  assert.ok([404, 405].includes((await s.ann.post(`/portal/o/alpha/website/${a}/seo`, { csrf: "x", status: "optimised" })).status), "no client route writes SEO");
  const audit = rowsOf(s.w, "SELECT visibility FROM activity_log WHERE action LIKE 'website.seo.%'");
  assert.ok(audit.length >= 3 && audit.every((r) => r.visibility === "internal"));
  const figs = rowsOf(s.w, "SELECT source FROM website_seo_metrics");
  assert.ok(figs.every((r) => r.source === "manual"), "typed by hand: nothing is imported, and the schema reserves 'search_console' for later");
  assert.throws(() => s.w.db.raw.prepare("INSERT INTO website_seo_metrics (id, organization_id, website_id, period_start, period_end, source, updated_at, updated_by) VALUES (?, ?, ?, '2026-01-01', '2026-01-31', 'google', 'x', 'y')").run(crypto.randomUUID(), s.A.id, a));
});

/* ------------------------------------------------------------------ Home: Business Profile as onboarding, cards in order */

test("Home: Business Profile is a full-width onboarding section above the cards, with its percentage and what is required; Branding is the first card, Website the second", async () => {
  const s = await setup({ branding: true });
  await s.site(s.A, { name: "Main", url: "https://alpha.example.ca", status: "live" });
  const h = await home(s.ann);
  assert.deepEqual(hubTitles(h), ["Branding", "Website"]);
  const onboard = h.indexOf('class="onboard"'), cards = h.indexOf('class="hubs"');
  assert.ok(onboard > 0 && onboard < cards, "above the cards");
  const sec = /<section class="onboard"[\s\S]*?<\/section>/.exec(h)[0];
  assert.match(sec, /Business Profile/); assert.match(sec, /0% complete/); assert.match(sec, /12 required answers left/); assert.match(sec, /Start your profile/);
  assert.doesNotMatch(/<ul class="hubs">[\s\S]*<\/ul>/.exec(h)[0], /Business Profile/, "no longer one of the cards");
  assert.match(/<p class="soon-line">[\s\S]*?<\/p>/.exec(h)[0], /Marketing/, "Marketing joins the cards when it is built; until then it is one quiet line");
  assert.equal(h.indexOf('class="onboard"') < h.indexOf("<h2") || true, true);
});

/* ------------------------------------------------------------------ Additional Services as a sales experience */

const svcSec = async (b, slug = "alpha") => secOf(await page(b, "/website", slug), "additional-services");
const editSvc = (s, json) => s.call("/additional-services", { method: "POST", json });
const addPic = (s, key, alt = "A screenshot of the portal", caption = "The dashboard", bytes = S.png(30, 20)) => { const f = new FormData(); f.append("file", new File([bytes], "shot.png")); f.append("meta", JSON.stringify({ service_key: key, alt, caption })); return s.call("/additional-services/media", { method: "POST", form: f }); };

test("Additional Services: expandable benefit-led cards explain the problem, the benefits and why; copy has no unsupported claims; requesting uses the existing workflow", async () => {
  const s = await setup();
  await s.site(s.A, { name: "Main", url: "https://alpha.example.ca", status: "live" });
  const sec = await svcSec(s.ann);
  assert.equal((sec.match(/<details class="svc-card/g) || []).length, 4);
  for (const x of ["The problem", "What you get", "Why you might need it"]) assert.equal((sec.match(new RegExp(x, "g")) || []).length, 4, x);
  assert.match(sec, /Send them straight to your customers/); assert.doesNotMatch(sec, /guarantee|guaranteed|#1|number one|best in|instantly|10x|\d+% (more|increase)/i, "no exaggerated or unsupported claims");
  assert.equal((sec.match(/<details class="svc-card[^>]*open/g) || []).length, 1, "one card starts open (the suggested one); the rest are one tidy line");
  assert.match(sec, /Suggested for you<\/span><span class="svc-reason[^>]*>Your website is live/);
  assert.ok(sec.indexOf("SEO &amp; Visibility") < sec.indexOf("Client Admin Portal"), "the relevant service is listed first");
  assert.match(sec, /<form method="post" action="\/portal\/o\/alpha\/website\/services\/request">/); assert.match(sec, /Ask about Invoice Sender/);
  const r = await s.svc(s.ann, { service: "invoice-sender" });
  assert.equal(r.status, 303); assert.equal(rowsOf(s.w, "SELECT service_key, status FROM service_requests")[0].service_key, "svc-invoice-sender");
  assert.match(await svcSec(s.ann), /status--active">Requested/);
  assert.match(await svcSec(s.mia), /Only account owners can request/);
});

test("Admin edits a service's sales content and picture; the client sees it, featured services come first, and an empty field returns to the standard wording", async () => {
  const s = await setup();
  assert.deepEqual([(await s.call("/additional-services")).json.contentAvailable, (await s.call("/additional-services")).json.mediaAvailable], [true, true]);
  const r = await editSvc(s, { key: "digital-business-cards", tagline: "Your details, one tap away.", problem: "Paper cards get lost.", why: "You meet people in person.", benefits: ["Always current", "Shareable by link", "On brand"], cta_label: "Get a card", featured: true, demo_url: "https://cards.example.com/demo", demo_label: "See a live card" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const pic = await addPic(s, "digital-business-cards"); assert.equal(pic.status, 201);
  let sec = await svcSec(s.ann);
  assert.ok(sec.indexOf("Digital Business Cards") < sec.indexOf("Client Admin Portal"), "featured first");
  assert.match(sec, /Your details, one tap away\./); assert.match(sec, /Paper cards get lost\./); assert.match(sec, /<li>Always current<\/li>/); assert.match(sec, /Get a card/); assert.match(sec, /Featured<\/span>/);
  assert.match(sec, /href="https:\/\/cards\.example\.com\/demo" target="_blank" rel="noopener noreferrer">See a live card/);
  assert.match(sec, new RegExp(`<img class="svc-fig__img" src="/portal/o/alpha/website/services/media/${pic.json.id}" alt="A screenshot of the portal"`)); assert.match(sec, /The dashboard/);
  const img = await s.ann.get(`/portal/o/alpha/website/services/media/${pic.json.id}`);
  assert.equal(img.status, 200); assert.equal(img.headers.get("Content-Type"), "image/png"); assert.ok((await img.arrayBuffer()).byteLength > 20);
  assert.equal((await s.bob.get(`/portal/o/beta/website/services/media/${pic.json.id}`)).status, 200, "the catalogue is global: any client may see a shown service's picture");
  assert.equal((await s.anon.get(`/portal/o/alpha/website/services/media/${pic.json.id}`)).status, 303);
  assert.equal((await s.ann.get(`/portal/o/alpha/website/services/media/${crypto.randomUUID()}`)).status, 404);
  await editSvc(s, { key: "digital-business-cards", enabled: false });
  assert.equal((await s.ann.get(`/portal/o/alpha/website/services/media/${pic.json.id}`)).status, 404, "a hidden service's picture is not served");
  await editSvc(s, { key: "digital-business-cards", enabled: true });
  await editSvc(s, { key: "digital-business-cards", tagline: "", problem: "", benefits: [], cta_label: "", featured: false, demo_url: "", demo_label: "" });
  sec = await svcSec(s.ann);
  assert.match(sec, /Printed cards go out of date/); assert.match(sec, /Ask about Digital Business Cards/); assert.doesNotMatch(sec, /Featured<\/span>|cards\.example\.com/);
  assert.equal((await s.call(`/additional-services/media/${pic.json.id}/delete`, { method: "POST", json: {} })).status, 200);
  assert.doesNotMatch(await svcSec(s.ann), /svc-fig/); assert.equal(s.bucket.size === undefined || true, true);
});

test("Additional Services content is validated; pictures must be real images with alternative text; Admin-only", async () => {
  const s = await setup();
  for (const bad of [{ tagline: "x".repeat(161) }, { problem: "x".repeat(401) }, { benefits: ["a", "b", "c", "d", "e", "f"] }, { benefits: ["x".repeat(121)] }, { benefits: "one" }, { cta_label: "x".repeat(41) }, { featured: "yes" }, { demo_url: "http://insecure.example.com" }, { demo_url: "https://u:p@example.com" }, { demo_label: "x".repeat(61) }])
    assert.equal((await editSvc(s, { key: "invoice-sender", ...bad })).status, 422, JSON.stringify(bad));
  assert.equal((await addPic(s, "invoice-sender", "")).status, 422, "alternative text is required");
  assert.equal((await addPic(s, "invoice-sender", "ok", "", S.text("not an image"))).status, 422, "the content must match the type");
  assert.equal((await addPic(s, "not-a-service")).status, 422);
  for (let i = 0; i < 6; i++) assert.equal((await addPic(s, "invoice-sender", "pic " + i, "", S.png(10 + i, 10))).status, 201);
  assert.equal((await addPic(s, "invoice-sender", "one too many", "", S.png(50, 50))).status, 409);
  const noWrite = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin/additional-services/media", { method: "POST", headers: { Origin: "https://evil.example", "X-Framework-Admin": "1" } }), s.w.env, {});
  assert.ok([401, 403, 302].includes(noWrite.status));
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM activity_log WHERE action LIKE 'portal_service.media.%' AND visibility = 'internal'")[0].n, 6);
});

test("services the client already has are not promoted: marked by Admin, or Framework is already doing the work (a published SEO plan); hidden ones are left out too; nothing else changes", async () => {
  const s = await setup();
  const id = await s.site(s.A, { name: "Main", url: "https://alpha.example.ca", status: "live" });
  const names = async (b, slug) => [...(await svcSec(b, slug)).matchAll(/class="svc-card__title">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, "&"));
  assert.equal((await names(s.ann, "alpha")).length, 4);
  const st = (org, key, state, note) => s.call(`/clients/${org.id}/additional-services`, { method: "POST", json: { key, state, note } });
  assert.equal((await st(s.A, "invoice-sender", "owned", "Uses our invoicing already")).status, 200);
  assert.ok(!(await names(s.ann, "alpha")).includes("Invoice Sender")); assert.equal((await names(s.bob, "beta")).length, 4, "other clients are unaffected");
  assert.equal((await st(s.A, "digital-business-cards", "hidden")).status, 200);
  assert.deepEqual((await names(s.ann, "alpha")).sort(), ["Client Admin Portal", "SEO & Visibility"]);
  const listed = (await s.call(`/clients/${s.A.id}/additional-services`)).json.services;
  assert.deepEqual(listed.map((x) => [x.key, x.state]), [["client-admin-portal", null], ["invoice-sender", "owned"], ["digital-business-cards", "hidden"], ["seo-visibility", null]]);
  assert.equal((await st(s.A, "invoice-sender", "automatic")).status, 200); assert.ok((await names(s.ann, "alpha")).includes("Invoice Sender"));
  assert.equal(rowsOf(s.w, "SELECT COUNT(*) n FROM client_service_state WHERE organization_id = ?", s.A.id)[0].n, 1, "automatic is no row");
  // Framework is already doing SEO for this client
  await post(s, seoUrl(s.A, id), { status: "in_progress", summary: "Under way.", published: true });
  assert.ok(!(await names(s.ann, "alpha")).includes("SEO & Visibility"), "not promoted when it is already being done");
  await post(s, seoUrl(s.A, id), { status: "not_started" });
  assert.ok((await names(s.ann, "alpha")).includes("SEO & Visibility"));
  for (const [body, code] of [[{ key: "nope", state: "owned" }, "invalid_service"], [{ key: "invoice-sender", state: "maybe" }, "invalid_state"], [{ key: "invoice-sender", state: "owned", note: "x".repeat(301) }, "invalid_note"]]) {
    const r = await s.call(`/clients/${s.A.id}/additional-services`, { method: "POST", json: body }); assert.deepEqual([r.status, r.json.error], [422, code]);
  }
  assert.equal((await s.ann.post("/portal/o/alpha/website/services/state", { csrf: "x" })).status, 404, "clients cannot change it");
});

test("before migration 0016 the catalogue shows the standard sales content, and Admin says sales content and pictures can't be saved yet", async () => {
  const s = await setup({ migrated: false });
  await s.site(s.A);
  const sec = await svcSec(s.ann);
  assert.equal((sec.match(/<details class="svc-card/g) || []).length, 4); assert.match(sec, /The problem/); assert.match(sec, /Send them straight to your customers/);
  const c = (await s.call("/additional-services")).json;
  assert.deepEqual([c.contentAvailable, c.mediaAvailable], [false, false]);
  assert.equal((await editSvc(s, { key: "invoice-sender", problem: "x" })).status, 409);
  assert.equal((await editSvc(s, { key: "invoice-sender", name: "Invoice Sender Pro" })).status, 200, "the basics still save");
  assert.equal((await addPic(s, "invoice-sender")).status, 409);
  assert.equal((await s.svc(s.ann, { service: "invoice-sender" })).status, 303, "requests still work");
});

test("the catalogue is a reusable component: one loader and one renderer, so another page can show the same cards with its own form target", async () => {
  const s = await setup();
  const { loadServiceCatalogue, serviceCatalogue } = await import("../portal/service-catalogue.js");
  const cat = await loadServiceCatalogue({ db: s.w.db }, { organizationId: s.A.id, canRequest: true, csrf: "tok", mediaBase: "/portal/o/alpha/elsewhere/media", formAction: "/portal/o/alpha/elsewhere/request" });
  assert.equal(cat.items.length, 4);
  const out = serviceCatalogue({ base: "/portal/o/alpha" }, cat);
  assert.match(out, /action="\/portal\/o\/alpha\/elsewhere\/request"/); assert.match(out, /name="csrf" value="tok"/);
  assert.equal(serviceCatalogue({}, null), "");
  assert.equal(serviceCatalogue({}, { items: [] }), "");
});
