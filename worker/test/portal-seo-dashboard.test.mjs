/* The SEO dashboard: search performance from published figures, tracked keywords and their verified rank checks, owner-only management, Admin recording, and the honest empty states. The Admin side of the request engine: the real Admin API over the same database and bucket as the portal. Staff list, read, reply (public and private), quote, record approval,
   upload proofs and finals, move requests along and add revision rounds; and everything that must be refused (no writes, no origin, wrong organization, bad ids, private notes to the client). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as seoRepo from "../portal/repo/website-seo.js";
import * as sites from "../portal/repo/websites.js";
import * as kw from "../portal/repo/seo-keywords.js";
import { change, series, chart } from "../portal/requests/seo-view.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = () => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now() });
const form = (o) => { const m = new Map(Object.entries(o)); return { get: (n) => (m.has(n) ? m.get(n) : null), keys: () => m.keys() }; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const ADMIN = "owner@frameworkco.ca";
async function setup({ keywords = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld({ proposed: keywords ? ["0021_seo_keywords.sql"] : [] });
  const Ao = await w.org("alpha", "Alpha Co"); const Bq = await w.org("beta", "Beta Co"); const A = Ao.id, B = Bq.id;
  await w.invite(Ao, "ann@alpha.test", "owner"); await w.invite(Ao, "mia@alpha.test", "member"); await w.invite(Bq, "bob@beta.test", "owner");
  Object.assign(w.env, { PORTAL_SERVICES: "1", PORTAL_REQUESTS: "1", PORTAL_WEBSITE: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const admin = async (path, { method = "GET", json, token = sign(claims()) } = {}) => {
    const h = { Origin: ORIGIN, ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) }; if (token) h["Cf-Access-Jwt-Assertion"] = token;
    let body; if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body }), w.env, { fetch: async () => { throw new Error("no network"); } });
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const mk = async (org, name) => { const r = await sites.createWebsite(w.db, org, { name, url: `https://${name.toLowerCase().replace(/\W/g, "")}.example.ca`, origin: "client", status: "live", published: true }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const siteA = await mk(A, "Alpha site"), siteB = await mk(B, "Beta site");
  const page = async (b, slug = "alpha") => (await b.get(`/portal/o/${slug}/seo`)).text();
  const csrf = async (b, slug = "alpha") => /name="csrf" value="([^"]+)"/.exec(await page(b, slug))[1];
  const post = async (b, path, fields = {}, slug = "alpha") => b.send(`/portal/o/${slug}${path}`, { method: "POST", body: new URLSearchParams({ csrf: await csrf(b, slug), ...fields }), headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" } });
  const publish = async (site, org, periods) => { await seoRepo.saveSeoHead(w.db, org, site, { status: "monitoring", summary: "Monitoring", published: true }, ADMIN); for (const p of periods) { const r = await seoRepo.createMetric(w.db, org, site, { ...p, published: true }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); } };
  const sql = (q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
  return { w, A, B, siteA, siteB, ann, mia, bob, admin, page, post, publish, sql };
}
const P1 = { period_start: "2026-09-01", period_end: "2026-09-30", impressions: 1000, clicks: 40, position: 14.2 };
const P2 = { period_start: "2026-10-01", period_end: "2026-10-31", impressions: 1500, clicks: 60, position: 12.7 };

test("calculations: change says up, down or flat in words, position is better when lower, and a missing comparison is stated, never guessed", () => {
  assert.deepEqual(change(60, 40), { tone: "up", good: true, text: "Up 50%" });
  assert.deepEqual(change(30, 40), { tone: "down", good: false, text: "Down 25%" });
  assert.equal(change(40, 40).tone, "flat");
  assert.deepEqual(change(12.7, 14.2, { lowerIsBetter: true }), { tone: "up", good: true, text: "Improved by 1.5 positions" });
  assert.deepEqual(change(15, 14, { lowerIsBetter: true }), { tone: "down", good: false, text: "Dropped by 1 position" });
  assert.equal(change(5, 0).text, "Up from none"); assert.equal(change(NaN, 3).tone, "none"); assert.equal(change(undefined, undefined).text, "No earlier period to compare");
  const s = series([{ source: "manual", periodStart: "2026-09-01", periodEnd: "2026-09-30" }, { source: "search_console", periodStart: "2026-10-01", periodEnd: "2026-10-31" }, { source: "search_console", periodStart: "2026-08-01", periodEnd: "2026-08-31" }]);
  assert.equal(s.source, "search_console"); assert.deepEqual(s.points.map((p) => p.periodEnd), ["2026-08-31", "2026-10-31"], "one source only, oldest first: sources are never joined into one line");
  assert.deepEqual(series([]), { source: null, points: [] });
  assert.equal(chart([5]), "", "one point is not a trend");
  const c = chart([10, 20, 15], { label: "Clicks" });
  assert.match(c, /<svg class="sd-chart"/); assert.match(c, /role="img" aria-label="Clicks: 10, 20, 15"/); assert.ok(!/style=/.test(c));
});

test("with no figures: a setup state that says what is missing, and no number anywhere", async () => {
  const { ann, page } = await setup();
  const html = await page(ann);
  assert.match(html, /Search performance/); assert.match(html, /Search figures are not connected yet/); assert.match(html, /Ask Framework to set up search reporting/); assert.match(html, /href="\/portal\/o\/alpha\/requests\/new\?type=monthly_seo"/);
  assert.match(html, /Nothing is estimated while this is not connected/);
  const m = /class="sd-kpi"|<svg class="sd-chart"|class="sd-rank"/.exec(html); assert.equal(m, null, "no figure, chart or rank is drawn: " + (m && m[0]));
  assert.ok(html.indexOf("Search performance") < html.indexOf("Keyword rankings") && html.indexOf("Keyword rankings") < html.indexOf("Connections"));
});

test("with published figures: the three figures, the change from the previous period, a trend, where they came from and what average position is NOT", async () => {
  const { ann, A, siteA, publish, page } = await setup();
  await publish(siteA, A, [P1, P2]);
  const html = await page(ann);
  assert.match(html, /class="sd-kpi__v">60<\/span>/); assert.match(html, /class="sd-kpi__v">1,500<\/span>/); assert.match(html, /class="sd-kpi__v">12\.7<\/span>/);
  assert.match(html, /Up 50%/); assert.match(html, /Improved by 1\.5 positions/); assert.match(html, /▲/);
  assert.equal((html.match(/<svg class="sd-chart"/g) || []).length, 3, "a chart each for clicks, impressions and position");
  assert.match(html, /Entered by Framework/); assert.match(html, /Latest period: Oct 1, 2026 to Oct 31, 2026/i);
  assert.match(html, /not your ranking for one particular search/);
  assert.match(html, /Figures entered by Framework/);
  assert.ok(!/Search figures are not connected yet/.test(html));
});

test("a single period shows the figures and says trends need a second period; a decline is shown in words, not only colour", async () => {
  const one = await setup();
  await one.publish(one.siteA, one.A, [P2]);
  const h1 = await one.page(one.ann);
  assert.match(h1, /No earlier period to compare/); assert.match(h1, /trends appear after the next one/); assert.ok(!/<svg class="sd-chart"/.test(h1));
  const two = await setup();
  await two.publish(two.siteA, two.A, [P2, { ...P1, clicks: 80, position: 9.1 }]);
  const h2 = await two.page(two.ann);
  assert.match(h2, /▼<\/span> Down 25%/); assert.match(h2, /Dropped by 3\.6 positions/); assert.match(h2, /sd-delta--bad/);
});

test("Search Console figures are labelled as such and win over typed ones only when they are the newest", async () => {
  const { ann, w, A, siteA, publish, page } = await setup();
  await publish(siteA, A, [P1]);
  w.db.raw.prepare("INSERT INTO website_seo_metrics (id, organization_id, website_id, period_start, period_end, source, impressions, clicks, avg_position, published, updated_at, updated_by) VALUES (?, ?, ?, '2026-10-01', '2026-10-31', 'search_console', 2000, 90, 8.4, 1, '2026-11-01T00:00:00.000Z', 'import')").run("11111111-1111-4111-8111-111111111111", A, siteA);
  const html = await page(ann);
  assert.match(html, /sd-tag sd-tag--live">Google Search Console/); assert.match(html, /class="sd-kpi__v">90<\/span>/); assert.match(html, /Connected/);
});

test("tracked keywords: only an owner adds or removes; a keyword with no check has NO ranking; recorded checks show the position, the change and who checked", async () => {
  const { ann, mia, admin, A, siteA, page, post, sql } = await setup();
  const before = await page(ann);
  assert.match(before, /You are not tracking any keywords yet/); assert.match(before, /Track a keyword/);
  const add = await post(ann, "/seo/keywords", { keyword: "Fences & decks", location: "Calgary, Alberta", website: siteA });
  assert.equal(add.status, 303); assert.match(add.headers.get("Location"), /flash=kw-added/);
  let html = await page(ann);
  assert.match(html, /Fences &amp; decks/); assert.match(html, /Calgary, Alberta/); assert.match(html, /Not checked yet/); assert.ok(!/class="sd-rank"/.test(html), "no ranking is shown before a check exists");
  // a member sees the list but no form and cannot post
  const mh = await page(mia); assert.match(mh, /Fences &amp; decks/); assert.ok(!/Track a keyword|Stop tracking/.test(mh)); assert.match(mh, /Only an owner/);
  assert.equal((await post(mia, "/seo/keywords", { keyword: "Roofing", website: siteA })).status, 403);
  assert.equal(sql("SELECT count(*) n FROM seo_keywords")[0].n, 1);
  // staff record verified results
  const kid = sql("SELECT id FROM seo_keywords")[0].id;
  const rec = (day, position, extra = {}) => admin(`/clients/${A}/websites/${siteA}/seo/keywords/${kid}/checks`, { method: "POST", json: { checked_on: day, position, ...extra } });
  assert.equal((await rec("2026-10-20", 10)).status, 201);
  assert.equal((await rec("2026-11-02", 7, { url: "https://alpha.example.ca/fences" })).status, 201);
  html = await page(ann);
  assert.match(html, /class="sd-rank">#7<\/span>/); assert.match(html, /Improved by 3 positions/); assert.match(html, /Checked Nov 2, 2026 by Framework/); assert.match(html, /<svg class="sd-chart"[^>]*aria-label="Rank history for Fences &amp; decks/);
  assert.equal((await rec("2026-11-03", null)).status, 201);
  html = await page(ann); assert.match(html, /Not in the results checked/); assert.match(html, /No longer in the results checked/);
  assert.equal((await rec("2026-11-03", 5)).status, 201, "recording the same day again replaces it");
  assert.equal(sql("SELECT count(*) n FROM seo_rank_checks WHERE checked_on = '2026-11-03'")[0].n, 1);
  assert.match(await page(ann), /class="sd-rank">#5<\/span>/);
  // the owner stops tracking: archived, checks kept
  const rm = await post(ann, `/seo/keywords/${kid}/remove`);
  assert.equal(rm.status, 303); assert.ok(!(await page(ann)).includes('sd-kw__k">Fences')); assert.equal(sql("SELECT count(*) n FROM seo_rank_checks")[0].n, 3, "history is kept");
  assert.equal(sql("SELECT count(*) n FROM activity_log WHERE action IN ('seo.keyword.added', 'seo.keyword.archived', 'seo.rank.recorded')")[0].n >= 5, true, "audited");
});

test("keyword validation: bad text, duplicates (case ignored), the cap, other organizations' websites and keywords", async () => {
  const { ann, bob, B, siteA, siteB, page, post, sql } = await setup();
  const bad = async (fields, status, text) => { const r = await post(ann, "/seo/keywords", { website: siteA, ...fields }); assert.equal(r.status, status, JSON.stringify(fields)); assert.match(await r.text(), text); };
  await bad({ keyword: "x" }, 422, /2 to 80 characters/); await bad({ keyword: "ok keyword", location: "y" }, 422, /place of 2 to 80/); await bad({ keyword: "<script>" }, 422, /2 to 80/);
  assert.equal((await post(ann, "/seo/keywords", { keyword: "Deck builder", location: "Calgary", website: siteA })).status, 303);
  await bad({ keyword: "DECK  BUILDER", location: "calgary" }, 409, /already tracking/);
  for (let i = 0; i < 19; i++) assert.equal((await post(ann, "/seo/keywords", { keyword: `Keyword ${i}`, website: siteA })).status, 303);
  await bad({ keyword: "One too many" }, 409, /as many keywords as can be kept/);
  assert.equal(sql("SELECT count(*) n FROM seo_keywords")[0].n, 20);
  // another organization's website is "not found"; its keywords never show here and cannot be removed from here
  assert.equal((await post(ann, "/seo/keywords", { keyword: "Sneaky", website: siteB })).status, 404);
  assert.equal((await post(bob, "/seo/keywords", { keyword: "Beta keyword", website: siteB }, "beta")).status, 303);
  const theirs = sql("SELECT id FROM seo_keywords WHERE organization_id = ?", B)[0].id;
  assert.equal((await post(ann, `/seo/keywords/${theirs}/remove`)).status, 404); assert.equal(sql("SELECT archived_at FROM seo_keywords WHERE id = ?", theirs)[0].archived_at, null);
  assert.ok(!(await page(ann)).includes("Beta keyword")); assert.match(await page(bob, "beta"), /Beta keyword/);
  assert.equal((await post(ann, "/seo/keywords/not-a-uuid/remove")).status, 404);
  const noToken = await ann.send("/portal/o/alpha/seo/keywords", { method: "POST", body: new URLSearchParams({ keyword: "x y z", website: siteA }), headers: { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN, "Content-Type": "application/x-www-form-urlencoded" } });
  assert.equal(noToken.status, 403); assert.equal(sql("SELECT count(*) n FROM seo_keywords WHERE keyword = 'x y z'")[0].n, 0);
});

test("without migration 0021 keyword tracking says it is being set up, shows no form, and the rest of SEO still works", async () => {
  const { ann, A, siteA, publish, page } = await setup({ keywords: false });
  await publish(siteA, A, [P1, P2]);
  const html = await page(ann);
  assert.match(html, /Keyword tracking is being set up/); assert.ok(!/Track a keyword/.test(html)); assert.match(html, /class="sd-kpi__v">60<\/span>/);
});

test("Admin keyword API: list, add, record, delete a check and archive; validated, audited and refused without a token, origin or writes", async () => {
  const { A, siteA, admin, w, sql } = await setup();
  const base = `/clients/${A}/websites/${siteA}/seo/keywords`;
  assert.deepEqual((await admin(base)).json.keywords, []);
  const add = await admin(base, { method: "POST", json: { keyword: "Landscaping", location: "Calgary" } }); assert.equal(add.status, 201);
  assert.equal((await admin(base, { method: "POST", json: { keyword: "Landscaping", location: "calgary" } })).status, 409);
  assert.equal((await admin(base, { method: "POST", json: { keyword: "q" } })).status, 422);
  const id = add.json.id, chk = `${base}/${id}/checks`;
  for (const [body, status] of [[{ checked_on: "2999-01-01", position: 3 }, 422], [{ checked_on: "2026-11-01", position: 0 }, 422], [{ checked_on: "2026-11-01", position: 201 }, 422], [{ checked_on: "2026-11-01", position: 3, url: "http://x.ca" }, 422], [{ checked_on: "2026-11-01", position: 3, extra: 1 }, 400], [{ checked_on: "nope" }, 422]]) assert.equal((await admin(chk, { method: "POST", json: body })).status, status, JSON.stringify(body));
  const ok = await admin(chk, { method: "POST", json: { checked_on: "2026-11-01", position: 4, note: "Looked up in Calgary" } }); assert.equal(ok.status, 201);
  const list = (await admin(base)).json; assert.equal(list.keywords[0].checks[0].position, 4); assert.equal(list.keywords[0].checks[0].source, "manual");
  assert.equal((await admin(`${chk}/${ok.json.id}/delete`, { method: "POST", json: {} })).status, 200); assert.equal(sql("SELECT count(*) n FROM seo_rank_checks")[0].n, 0);
  assert.equal((await admin(`${base}/${id}/archive`, { method: "POST", json: {} })).status, 200); assert.equal((await admin(`${base}/${id}/archive`, { method: "POST", json: {} })).status, 404);
  assert.notEqual((await admin(base, { token: null })).status, 200);
  assert.equal((await admin(base, { method: "POST", json: { keyword: "Anything" }, token: null })).status === 201, false);
  assert.equal((await handleAdmin(new Request(ORIGIN + "/api/admin" + base, { method: "POST", headers: { "Content-Type": "application/json", "X-Framework-Admin": "1", Origin: "https://evil.example", "Cf-Access-Jwt-Assertion": sign(claims()) }, body: JSON.stringify({ keyword: "Anything" }) }), w.env, {})).status, 403);
  assert.equal((await handleAdmin(new Request(ORIGIN + "/api/admin" + base, { method: "POST", headers: { "Content-Type": "application/json", "X-Framework-Admin": "1", Origin: ORIGIN, "Cf-Access-Jwt-Assertion": sign(claims()) }, body: JSON.stringify({ keyword: "Anything" }) }), { ...w.env, PORTAL_ADMIN_WRITES: undefined }, {})).status, 403);
  assert.equal((await admin(`/clients/${A}/websites/${"00000000-0000-4000-8000-000000000000"}/seo/keywords`)).status, 404);
});

test("the new files stay safe: the dashboard builds no inline style or script and the migration only adds", () => {
  const view = strip(read("worker/portal/requests/seo-view.js"));
  assert.ok(!/innerHTML|\bstyle=|<script|eval\(/.test(view));
  const sqlText = read("migrations/portal-proposed/0021_seo_keywords.sql").replace(/--.*$/gm, "");
  assert.ok(!/\b(DROP|ALTER|UPDATE|DELETE FROM)\b/i.test(sqlText), "additive only"); assert.equal((sqlText.match(/CREATE TABLE IF NOT EXISTS/g) || []).length, 2);
  assert.match(read("admin/assets/website-seo.js"), /Keyword rankings/);
});
