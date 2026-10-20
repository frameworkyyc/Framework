// Portal feedback (private beta) and the Business Profile privacy notice: submission, storage, isolation, CSRF, limits, admin review, logs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { makeWorld, csrfOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { validateFeedback, submitPortalFeedback, FEEDBACK_PAGES, FEEDBACK_KINDS, HOURLY_LIMIT, MAX_MESSAGE } from "../portal/repo/portal-feedback.js";
import { MAX_FEEDBACK_FORM_BYTES } from "../portal/form.js";
import { PORTAL_CSP } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const form = (o) => new URLSearchParams(o).toString();

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  return { w, alpha, beta, ann, mia, bob };
}
async function send(w, who, slug, fields, { csrf, headers = {}, env = w.env, ip } = {}) {
  const page = await (await who.get(`/portal/o/${slug}/feedback`)).text();
  return handlePortal(new Request(`${ORIGIN}/portal/o/${slug}/feedback`, { method: "POST", body: form({ csrf: csrf ?? csrfOf(page), ...fields }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: ORIGIN, ...(ip ? { "CF-Connecting-IP": ip } : {}), ...headers } }), env, { now: w.clock.now() });
}
const GOOD = { kind: "problem", message: "The save button on the contact step did nothing.", page: "profile-contact" };

/* ------------------------------------------------------------------ entry point and form */

test("a quiet 'Send feedback' link is in the footer of every signed-in page, pre-filled with where the person is; never on the demo or sign-in pages", async () => {
  const { ann } = await setup();
  const pages = { "": "home", "/profile": "profile", "/profile/contact": "profile-contact", "/branding": "branding", "/website": "website", "/marketing": "marketing", "/content": "content", "/files": "files", "/account": "account", "/members": "team", "/progress": "progress", "/projects": "projects", "/activity": "activity", "/documents": "documents" };
  for (const [p, key] of Object.entries(pages)) {
    const html = await (await ann.get("/portal/o/alpha" + p)).text();
    const foot = html.slice(html.indexOf('<footer class="foot">'));
    assert.match(foot, new RegExp(`<a href="/portal/o/alpha/feedback\\?from=${key}">Send feedback</a>`), p || "/");
    const nav = html.slice(html.indexOf('<nav class="primary"'), html.indexOf("</nav>", html.indexOf('<nav class="primary"')));
    assert.ok(!/feedback/i.test(nav), "the approved navigation is untouched");
    assert.ok(!/class="tile" href="[^"]*feedback/.test(html), "feedback is not a workspace block");
  }
  assert.ok(!/Send feedback/.test(await (await ann.get("/portal/login")).text()));
});
test("the form is short: type, message, optional section; nothing the session already knows; mobile-friendly controls", async () => {
  const { ann } = await setup();
  const res = await ann.get("/portal/o/alpha/feedback?from=website");
  assert.equal(res.status, 200); assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP, "no scripts");
  const html = await res.text();
  assert.deepEqual([...html.matchAll(/<input type="radio" name="kind" value="(\w+)"/g)].map((m) => m[1]), ["problem", "suggestion", "other"]);
  assert.match(html, /<textarea id="fb-message" name="message" rows="6" maxlength="2000">/);
  assert.match(html, /<option value="website" selected>Website<\/option>/); assert.match(html, /Not about a specific page/);
  assert.ok(!/name="(email|name|organization|organization_id|user|user_id)"/.test(html), "no identity fields");
  const formHtml = html.slice(html.indexOf('<form method="post" action="/portal/o/alpha/feedback"'), html.indexOf("</form>", html.indexOf('<form method="post" action="/portal/o/alpha/feedback"')));
  assert.equal([...formHtml.matchAll(/<input/g)].length, 4, "csrf + three kinds only"); assert.equal([...html.matchAll(/<textarea/g)].length, 1);
  assert.ok(!/<script|style=/.test(html));
  assert.match(await (await ann.get("/portal/o/alpha/feedback?from=__proto__")).text(), /<option value="">Not about a specific page<\/option>/);
  assert.ok(!/selected>/.test(await (await ann.get("/portal/o/alpha/feedback?from=nonsense")).text().then((t) => t.replace(/<option value="" selected>/, ""))));
});

/* ------------------------------------------------------------------ submission and storage */

test("a signed-in member's feedback is stored against THEIR organization and user, with only validated values, and shows a thank-you", async () => {
  const { w, alpha, mia } = await setup();
  const res = await send(w, mia, "alpha", GOOD);
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/o/alpha/feedback?sent=1");
  const [row] = sql(w.db, "SELECT * FROM portal_feedback");
  const miaId = sql(w.db, "SELECT id FROM portal_users WHERE email = 'mia@alpha.test'")[0].id;
  assert.deepEqual([row.organization_id, row.user_id, row.kind, row.message, row.page], [alpha.id, miaId, "problem", GOOD.message, "profile-contact"]);
  assert.match(row.created_at, /^\d{4}-\d\d-\d\dT/);
  const thanks = await (await mia.get("/portal/o/alpha/feedback?sent=1")).text();
  assert.match(thanks, /Thank you\. Your feedback has been sent to Framework\./); assert.ok(!/<textarea/.test(thanks));
  const log = sql(w.db, "SELECT action, detail, visibility FROM activity_log WHERE action = 'feedback.submitted'");
  assert.equal(log.length, 1); assert.ok(!log[0].detail.includes("save button"), "the audit entry never carries the message"); assert.equal(log[0].visibility, "internal");
  assert.equal((await send(w, mia, "alpha", { kind: "suggestion", message: "Add a dark mode." })).status, 303);
  assert.equal(sql(w.db, "SELECT page FROM portal_feedback WHERE kind='suggestion'")[0].page, null, "the section is optional");
});
test("validation: kind, message and section are checked on the server; nothing is stored for a rejected submission and the input stays on the page", async () => {
  const { w, ann } = await setup();
  const bad = [[{ ...GOOD, kind: "" }, "kind"], [{ ...GOOD, kind: "bug" }, "kind"], [{ ...GOOD, message: "   " }, "message"], [{ ...GOOD, message: "x".repeat(MAX_MESSAGE + 1) }, "message"], [{ ...GOOD, message: "bad\u0007text" }, "message"], [{ ...GOOD, page: "https://evil.example" }, "page"], [{ ...GOOD, page: "__proto__" }, "page"]];
  for (const [fields, key] of bad) {
    const r = await send(w, ann, "alpha", fields);
    assert.equal(r.status, 422, JSON.stringify(fields).slice(0, 60));
    const html = await r.text();
    assert.match(html, new RegExp(`id="fb-${key}-e"`)); assert.match(html, /role="alert"/);
    if (fields.message.trim() && fields.message.length < 500) assert.ok(html.includes(">" + fields.message.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "<") || /\u0007/.test(fields.message), "the message is kept");
  }
  assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
  assert.deepEqual(validateFeedback({ kind: "other", message: "ok", page: "" }).errors, {});
  assert.deepEqual(FEEDBACK_KINDS.map(([k]) => k), ["problem", "suggestion", "other"]);
  assert.ok(FEEDBACK_PAGES.some(([k]) => k === "profile-personality") && FEEDBACK_PAGES.length >= 20);
});
test("a store failure keeps the message on the page and says so; the session stays", async () => {
  const { w, ann } = await setup();
  const real = w.env.PORTAL_DB, env = { ...w.env, PORTAL_DB: { prepare: real.prepare, exec: real.exec, batch: async () => { throw new Error("D1_ERROR secret"); } } };
  const page = await (await ann.get("/portal/o/alpha/feedback")).text();
  const r = await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body: form({ csrf: csrfOf(page), ...GOOD }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN } }), env, { now: w.clock.now() });
  assert.equal(r.status, 503); const html = await r.text();
  assert.match(html, /couldn’t send your feedback just now/); assert.ok(html.includes("The save button on the contact step did nothing.")); assert.ok(!/D1_ERROR|secret/.test(html));
  assert.equal((await ann.get("/portal/o/alpha/profile")).status, 200);
  assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
});

/* ------------------------------------------------------------------ security */

test("authentication is required: anonymous GET and POST never reach the database or store anything", async () => {
  const { w } = await setup();
  const anon = w.browser();
  const g = await anon.get("/portal/o/alpha/feedback"); assert.equal(g.status, 303); assert.match(g.headers.get("Location"), /\/portal\/login/);
  const p = await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body: form(GOOD), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(p.status, 303); assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
});
test("organization isolation: another organization's member gets 404 and cannot write into it; an organization or user id in the form is ignored", async () => {
  const { w, alpha, beta, ann, bob } = await setup();
  for (const m of ["GET"]) assert.equal((await bob.get("/portal/o/alpha/feedback")).status, 404);
  const page = await (await bob.get("/portal/o/beta/feedback")).text();
  const forged = await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body: form({ csrf: csrfOf(page), ...GOOD }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: bob.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(forged.status, 404); assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
  const annId = sql(w.db, "SELECT id FROM portal_users WHERE email = 'ann@alpha.test'")[0].id;
  assert.equal((await send(w, bob, "beta", { ...GOOD, organization_id: alpha.id, org: "alpha", user_id: annId, userId: annId })).status, 303);
  const [row] = sql(w.db, "SELECT organization_id, user_id FROM portal_feedback");
  assert.equal(row.organization_id, beta.id); assert.notEqual(row.user_id, annId);
  assert.equal((await ann.get(`/portal/o/${beta.id}/feedback`)).status, 404);
});
test("a revoked membership can neither open the form nor send, and nothing is stored", async () => {
  const { w, mia } = await setup();
  const page = await (await mia.get("/portal/o/alpha/feedback")).text(), token = csrfOf(page);
  w.db.raw.exec("UPDATE memberships SET status='revoked', revoked_at='2026-03-10T00:00:00.000Z' WHERE user_id IN (SELECT id FROM portal_users WHERE email='mia@alpha.test')");
  assert.equal((await mia.get("/portal/o/alpha/feedback")).status, 404);
  const r = await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body: form({ csrf: token, ...GOOD }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: mia.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(r.status, 404); assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
});
test("CSRF, same-site, content type, size and duplicate-field protections", async () => {
  const { w, ann } = await setup();
  const token = csrfOf(await (await ann.get("/portal/o/alpha/feedback")).text());
  const base = (body, headers = {}) => handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN, ...headers } }), w.env, { now: w.clock.now() });
  assert.equal((await base(form(GOOD))).status, 403, "no token");
  assert.equal((await base(form({ csrf: "wrong", ...GOOD }))).status, 403, "wrong token");
  assert.equal((await base(form({ csrf: token, ...GOOD }), { Origin: "https://evil.example" })).status, 403);
  assert.equal((await base(form({ csrf: token, ...GOOD }), { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await base(JSON.stringify({ csrf: token, ...GOOD }), { "Content-Type": "application/json" })).status, 400);
  assert.equal((await base(form({ csrf: token, ...GOOD, message: "x".repeat(MAX_FEEDBACK_FORM_BYTES + 5) }))).status, 413);
  assert.equal((await base(`csrf=${token}&kind=other&kind=problem&message=a`)).status, 400);
  assert.deepEqual(sql(w.db, "SELECT * FROM portal_feedback"), []);
  assert.equal((await base(form({ csrf: token, ...GOOD }))).status, 303);
  assert.equal((await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "PUT", headers: { Cookie: ann.cookieHeader() } }), w.env, { now: w.clock.now() })).status, 405);
});
test("rate limits: per-network limiter first (no database work when limited), then a per-person hourly cap that resets", async () => {
  const { w, ann, mia } = await setup();
  const counts = {};
  const env = { ...w.env, PORTAL_RATE_LIMITER: { limit: async ({ key }) => ({ success: (counts[key] = (counts[key] || 0) + 1) <= 2 }) } };
  const st = [];
  for (let i = 0; i < 4; i++) st.push((await send(w, ann, "alpha", { ...GOOD, message: "m" + i }, { env, ip: "203.0.113.77" })).status);
  assert.deepEqual(st, [303, 303, 429, 429]);
  assert.equal(sql(w.db, "SELECT count(*) AS n FROM portal_feedback")[0].n, 2);
  assert.match(Object.keys(counts)[0], /^feedback:[0-9a-f]{32}$/);
  const none = { ...w.env, PORTAL_DB: { prepare() { throw new Error("database touched"); }, batch() { throw new Error("database touched"); }, exec() {} }, PORTAL_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const page = await (await mia.get("/portal/o/alpha/feedback")).text();
  const lim = await handlePortal(new Request(`${ORIGIN}/portal/o/alpha/feedback`, { method: "POST", body: form({ csrf: csrfOf(page), ...GOOD }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: mia.cookieHeader(), Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.9" } }), none, { now: w.clock.now() });
  assert.equal(lim.status, 429);
  // the hourly cap, on the repository
  const org = sql(w.db, "SELECT id FROM organizations WHERE slug='beta'")[0].id, uid = sql(w.db, "SELECT id FROM portal_users WHERE email='bob@beta.test'")[0].id;
  const t0 = new Date(w.clock.now());
  for (let i = 0; i < HOURLY_LIMIT; i++) assert.equal((await submitPortalFeedback(w.db, org, uid, { ...GOOD, message: "n" + i }, { now: t0 })).ok, true);
  const over = await submitPortalFeedback(w.db, org, uid, GOOD, { now: t0 }); assert.deepEqual([over.ok, over.error], [false, "too_many"]);
  assert.equal((await submitPortalFeedback(w.db, org, uid, GOOD, { now: new Date(t0.getTime() + 3700000) })).ok, true, "allowed again after an hour");
});
test("logs carry fixed fields only: never the message, the section text or an email", async () => {
  const { w, ann } = await setup();
  const lines = []; const o = console.log; console.log = (l) => lines.push(String(l));
  try { await send(w, ann, "alpha", { kind: "problem", message: "VerySecretMessage about ann@alpha.test", page: "profile" }); await send(w, ann, "alpha", { kind: "", message: "SecondSecretMessage" }); } finally { console.log = o; }
  const text = lines.join("\n");
  assert.match(text, /"evt":"feedback.submit"/);
  for (const s of ["VerySecretMessage", "SecondSecretMessage", "ann@alpha.test"]) assert.ok(!text.includes(s), s);
});

/* ------------------------------------------------------------------ admin review */

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64);
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (c, kp = pair) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), b = b64u(JSON.stringify(c)); return `${h}.${b}.${b64u(createSign("RSA-SHA256").update(h + "." + b).sign(kp.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });
async function adminSetup() {
  resetKeyCacheForTests();
  const s = await setup();
  await send(s.w, s.ann, "alpha", GOOD); await send(s.w, s.bob, "beta", { kind: "suggestion", message: "Please add <b>invoices</b>.", page: "files" });
  const env = { ...s.w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const call = (path, { method = "GET", token = sign(claims()), headers = {}, e = env } = {}) => { const h = { Origin: ORIGIN, "X-Framework-Admin": "1", ...headers }; if (token) h["Cf-Access-Jwt-Assertion"] = token; return handleAdmin(new Request(ORIGIN + path, { method, headers: h }), e, { fetch: async () => { throw new Error("no network"); } }); };
  return { ...s, call, env };
}
test("admin review: admin-only, read-only, organization + type + date + section + message; nothing else about the person", async () => {
  const { call, ann } = await adminSetup();
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  for (const token of [null, "garbage", sign(claims({ email: "intruder@example.com" })), sign(claims(), other), sign(claims({ exp: now() - 3600 })), sign(claims({ aud: ["b".repeat(64)] }))]) {
    const r = await call("/api/admin/portal-feedback", { token }); assert.ok([401, 403].includes(r.status)); assert.ok(!/save button|Alpha Co/.test(await r.text()));
  }
  assert.ok([401, 403].includes((await call("/api/admin/portal-feedback", { token: null, headers: { Cookie: ann.cookieHeader() } })).status), "a client session is not admin access");
  const j = await (await call("/api/admin/portal-feedback")).json();
  assert.equal(j.available, true); assert.equal(j.items.length, 2);
  const a = j.items.find((i) => i.organization.name === "Alpha Co");
  assert.deepEqual([a.kind, a.kind_label, a.page, a.page_label, a.message], ["problem", "Problem", "profile-contact", "Business Profile: Primary contact", GOOD.message]);
  assert.match(a.created_at, /^\d{4}-/);
  assert.deepEqual(Object.keys(a).sort(), ["created_at", "id", "kind", "kind_label", "message", "organization", "page", "page_label"], "no user email or id");
  assert.equal(j.items.find((i) => i.organization.name === "Beta Co").page_label, "Files & Deliverables");
  assert.match((await call("/api/admin/portal-feedback")).headers.get("cache-control"), /no-store/);
  for (const m of ["POST", "PUT", "PATCH", "DELETE"]) assert.equal((await call("/api/admin/portal-feedback", { method: m })).status, 405, m);
});
test("admin review: a deployment without the table reports it plainly; the survey 'Client Feedback' stays a separate entry", async () => {
  const { w, call, env } = await adminSetup();
  w.db.raw.exec("DROP TABLE portal_feedback");
  assert.deepEqual(await (await call("/api/admin/portal-feedback")).json(), { available: false, items: [], truncated: false });
  assert.equal((await call("/api/admin/portal-feedback", { e: { ...env, PORTAL_DB: undefined } })).status, 503);
  const mods = read("admin/assets/modules.js");
  assert.match(mods, /id: "feedback", label: "Client Feedback", path: "\/admin\/feedback"/);
  assert.match(mods, /id: "portal-feedback", label: "Portal Feedback", path: "\/admin\/portal-feedback", enabled: true/);
  const ui = read("admin/assets/portal-feedback.js");
  assert.ok(!/method: "(POST|PUT|PATCH|DELETE)"|<form|"input"|"textarea"|"select"|innerHTML/.test(ui), "read-only and text-only");
  assert.match(ui, /class: "adm-answer", text: r\.message/);
});

/* ------------------------------------------------------------------ privacy notice */

test("Business Profile carries a short plain-language notice, links it from each step, makes no unsupported claims and asks for no consent box", async () => {
  const { ann } = await setup();
  const html = await (await ann.get("/portal/o/alpha/profile")).text();
  const notice = html.slice(html.indexOf('<section class="privacy"'), html.indexOf("</section>", html.indexOf('<section class="privacy"')));
  for (const must of ["private beta", "What we collect", "Why", "Who can see it", "saved against your organization", "authorized Framework staff may review it", "Corrections and deletion", "mailto:hello@frameworkco.ca", "/privacy.html"]) assert.ok(notice.includes(must), must);
  assert.ok(!/encrypt|GDPR|PIPA|PIPEDA|complian|certif|retain|retention|\bdays\b|months|years|data cent|resident|Canada only|stored in|never share|secure(ly)? stored/i.test(notice), "no claims about encryption, retention, compliance or residency");
  assert.ok(!/type="checkbox"/.test(html), "no consent checkbox");
  assert.ok(notice.split(/\s+/).length < 170, "concise");
  const step = await (await ann.get("/portal/o/alpha/profile/business")).text();
  assert.match(step, /href="\/portal\/o\/alpha\/profile#privacy">How we use this information/); assert.match(step, /may be reviewed by authorized Framework staff/);
  assert.ok(!/id="privacy"/.test(step));
});
test("the published privacy policy does not yet cover the portal: the gaps are written down for review, not papered over", () => {
  const policy = read("privacy.html");
  assert.ok(!/Business Profile|client portal/.test(policy), "the website policy says nothing about the portal or Business Profile yet");
  const draft = read("worker/portal/PRIVACY-DRAFT.md");
  assert.match(draft, /Business Profile/); assert.match(draft, /portal feedback/i); assert.match(draft, /\[DECISION\]/);
});
test("the plan for applying migration 0003 without fabricating history is documented, and 0003 is not applied by the code", () => {
  const doc = read("worker/portal/BETA-READINESS.md");
  assert.match(doc, /Applying 0003/); assert.match(doc, /migrations apply/); assert.match(doc, /0002.*no-op|no-op.*0002/s); assert.match(doc, /Do not (hand-)?insert/);
  const sql0003 = read("migrations/portal/0003_portal_feedback.sql");
  assert.equal([...sql0003.matchAll(/CREATE TABLE IF NOT EXISTS/g)].length, 1);
  assert.ok(!/\b(DROP|ALTER|TRUNCATE|UPDATE|INSERT)\b|(?<!ON )\bDELETE\b/i.test(sql0003.replace(/--.*$/gm, "")));
  assert.ok(!/0003/.test(read("wrangler.jsonc")), "no configuration applies it");
});
