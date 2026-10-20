// The connected Business Profile (Staging first): schema validation, completion, tenant isolation, authorization, CSRF, limits, failure handling,
// Coming Soon pages and the absence of demonstration data for signed-in clients.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { PROFILE_STEPS, PROFILE_SCHEMA_VERSION, validateAnswer, validateStep, stepStatus, profileProgress, stepById, FIELD_IDS } from "../portal/profile-schema.js";
import { getProfileAnswers, saveProfileStep } from "../portal/repo/business-profile.js";
import { PROFILE_STEPS as DEMO_STEPS } from "../portal/guided-data.js";
import { PORTAL_CSP, PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";
import { MAX_PROFILE_FORM_BYTES } from "../portal/form.js";

const sql = (db, q, ...p) => db.raw.prepare(q).all(...p);
const ANSWERS = {
  business: { legal: "Acme Co. Ltd.", operating: "Acme", industry: "Retail", about: "We sell things." },
  location: { city: "Calgary, Alberta", area: "", size: "2 to 10 people" },
  offering: { offer: "Widgets", customers: "People who need widgets" },
  goals: { goals: "Grow", competitors: "" },
  online: { site: "", social: "" },
  contact: { cname: "Ann Owner", crole: "", cemail: "Ann@Acme.example", cphone: "" },
  personality: { words: "warm, honest, crafted", tone: "Friendly and relaxed", position: "" },
};

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner");
  await w.invite(beta, "bob@beta.test", "owner");
  await w.invite(alpha, "mia@alpha.test", "member");
  const ann = w.browser(), bob = w.browser(), mia = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test"));
  await bob.signIn(w.user(2, "bob@beta.test"));
  await mia.signIn(w.user(3, "mia@alpha.test"));
  return { w, alpha, beta, ann, bob, mia };
}
const form = (obj) => new URLSearchParams(obj).toString();
async function save(world, who, slug, step, fields, { csrf, headers = {} } = {}) {
  const page = await (await who.get(`/portal/o/${slug}/profile/${step}`)).text();
  const token = csrf ?? csrfOf(page);
  return handlePortal(new Request(`https://staging.frameworkco.ca/portal/o/${slug}/profile/${step}`, {
    method: "POST", body: form({ csrf: token, ...fields }),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: "https://staging.frameworkco.ca", ...headers },
  }), world.env, { now: world.clock.now() });
}

/* ------------------------------------------------------------------ schema */

test("schema: seven steps, versioned, every question defined once with a kind and limits; no sample answers", () => {
  assert.equal(PROFILE_SCHEMA_VERSION, 1);
  assert.deepEqual(PROFILE_STEPS.map((s) => s.id), ["business", "location", "offering", "goals", "online", "contact", "personality"]);
  const ids = PROFILE_STEPS.flatMap((s) => s.fields.map((f) => f.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const s of PROFILE_STEPS) for (const f of s.fields) { assert.ok(["text", "textarea", "select", "choice", "email", "tel", "url"].includes(f.kind)); assert.ok(!("value" in f), "no values in the schema"); if (f.kind === "select" || f.kind === "choice") assert.ok(f.options.length > 1); }
});
test("the fictional demo's questionnaire structure matches the real schema (ids, labels, kinds, options) so the two cannot drift apart", () => {
  assert.deepEqual(DEMO_STEPS.map((s) => [s.id, s.title]), PROFILE_STEPS.map((s) => [s.id, s.title]));
  for (const [i, s] of PROFILE_STEPS.entries()) assert.deepEqual(DEMO_STEPS[i].fields.map((f) => [f.id, f.label, f.kind, f.options || null]), s.fields.map((f) => [f.id, f.label, f.kind, f.options || null]), s.id);
});
test("validation: types, limits, options, control characters; empty means unanswered", () => {
  const def = (id) => PROFILE_STEPS.flatMap((s) => s.fields).find((f) => f.id === id);
  assert.deepEqual(validateAnswer(def("legal"), "  Acme  "), { value: "Acme" });
  assert.deepEqual(validateAnswer(def("legal"), "   "), { value: "" });
  assert.ok(validateAnswer(def("legal"), "x".repeat(201)).error);
  assert.ok(validateAnswer(def("legal"), "a\nb").error, "single-line text refuses line breaks");
  assert.ok(validateAnswer(def("legal"), "a\u0000b").error);
  assert.deepEqual(validateAnswer(def("about"), "line1\r\nline2"), { value: "line1\nline2" });
  assert.ok(validateAnswer(def("about"), "x".repeat(2001)).error);
  assert.ok(validateAnswer(def("about"), "bad\u0007").error);
  assert.deepEqual(validateAnswer(def("cemail"), " Ann@Acme.EXAMPLE "), { value: "ann@acme.example" });
  for (const bad of ["nope", "a@b", "a b@c.d", "@x.y"]) assert.ok(validateAnswer(def("cemail"), bad).error, bad);
  assert.deepEqual(validateAnswer(def("cphone"), "+1 (403) 555-0100"), { value: "+1 (403) 555-0100" });
  for (const bad of ["abc", "12", "<script>"]) assert.ok(validateAnswer(def("cphone"), bad).error, bad);
  assert.equal(validateAnswer(def("site"), "https://acme.example").value, "https://acme.example/");
  for (const bad of ["http://acme.example", "javascript:alert(1)", "acme.example", "https://user:pw@acme.example"]) assert.ok(validateAnswer(def("site"), bad).error, bad);
  assert.deepEqual(validateAnswer(def("industry"), "Retail"), { value: "Retail" });
  assert.ok(validateAnswer(def("industry"), "Spaceships").error);
  assert.ok(validateAnswer(def("tone"), "made up").error);
  assert.ok(validateAnswer(def("legal"), ["a"]).error, "arrays are refused");
  const r = validateStep(stepById("contact"), { cname: "A", cemail: "bad", unknown: "x", __proto__: "y" });
  assert.deepEqual(Object.keys(r.errors), ["cemail"]);
  assert.deepEqual(Object.keys(r.values).sort(), ["cemail", "cname", "cphone", "crole"], "only this step's questions are read");
});
test("completion rule: a step is done when its required answers exist; progress counts steps only", () => {
  const first = stepById("business");
  assert.equal(stepStatus(first, {}).state, "todo");
  assert.equal(stepStatus(first, { legal: "A" }).state, "current");
  assert.deepEqual(stepStatus(first, { legal: "A" }).missingRequired, ["industry", "about"]);
  assert.equal(stepStatus(first, { legal: "A", industry: "Retail", about: "x" }).state, "done");
  assert.equal(stepStatus(first, { operating: "only optional" }).state, "current", "optional answers alone do not complete a step that has required ones");
  const online = stepById("online"); // no required questions: done once anything is answered
  assert.equal(stepStatus(online, {}).state, "todo"); assert.equal(stepStatus(online, { social: "x" }).state, "done");
  assert.deepEqual(profileProgress({}), { steps: profileProgress({}).steps, done: 0, total: 7, percent: 0 });
  const all = Object.assign({}, ...Object.values(ANSWERS).map((v) => Object.fromEntries(Object.entries(v).filter(([, x]) => x)))); all.site = "https://a.example/";
  assert.equal(profileProgress(all).done, 7); assert.equal(profileProgress(all).percent, 100);
  assert.equal(profileProgress({ legal: "A", industry: "Retail", about: "x", city: "C", size: "Just me", offer: "o", customers: "c" }).done, 3);
});

/* ------------------------------------------------------------------ repository */

test("repository: save, update, clear and read back; invalid answers save nothing; the audit entry carries no answers", async () => {
  const { w, alpha } = await setup();
  const [row] = sql(w.db, "SELECT id FROM portal_users LIMIT 1");
  const org = alpha.id, uid = row.id;
  assert.deepEqual(await getProfileAnswers(w.db, org), {});
  const r = await saveProfileStep(w.db, org, uid, "business", { legal: "Acme", industry: "Retail", about: "" });
  assert.equal(r.ok, true); assert.deepEqual(r.missingRequired, ["about"]);
  assert.deepEqual(await getProfileAnswers(w.db, org), { legal: "Acme", industry: "Retail" });
  await saveProfileStep(w.db, org, uid, "business", { legal: "Acme 2", industry: "Retail", about: "text", operating: "Op" });
  assert.deepEqual(await getProfileAnswers(w.db, org), { legal: "Acme 2", industry: "Retail", about: "text", operating: "Op" });
  await saveProfileStep(w.db, org, uid, "business", { legal: "Acme 2", industry: "Retail", about: "text", operating: "" });
  assert.ok(!("operating" in (await getProfileAnswers(w.db, org))), "clearing an optional answer removes it");
  const bad = await saveProfileStep(w.db, org, uid, "contact", { cname: "A", cemail: "bad" });
  assert.equal(bad.ok, false); assert.ok(bad.errors.cemail);
  assert.ok(!("cname" in (await getProfileAnswers(w.db, org))), "nothing from a rejected step was saved");
  assert.equal((await saveProfileStep(w.db, org, uid, "nope", {})).error, "unknown_step");
  const log = sql(w.db, "SELECT action, entity_type, entity_id, detail, visibility, actor_type FROM activity_log WHERE action = 'profile.updated'");
  assert.equal(log.length, 3); assert.ok(log.every((x) => x.visibility === "internal" && x.actor_type === "client" && x.entity_id === "business"));
  assert.ok(!log.some((x) => /Acme|Retail|text/.test(x.detail)), "no answers in the audit log");
  const stored = sql(w.db, "SELECT schema_version, updated_by FROM business_profile_answers");
  assert.ok(stored.every((x) => x.schema_version === 1 && x.updated_by === uid));
});
test("repository: a failure part-way through a step rolls the whole step back (atomic batch)", async () => {
  const { w, alpha } = await setup();
  const [row] = sql(w.db, "SELECT id FROM portal_users LIMIT 1");
  await saveProfileStep(w.db, alpha.id, row.id, "business", { legal: "Before", industry: "Retail", about: "x" });
  // a user id that does not exist violates the foreign key on the second statement: nothing from the step may remain
  await assert.rejects(() => saveProfileStep(w.db, alpha.id, "11111111-1111-4111-8111-111111111111", "business", { legal: "After", industry: "Retail", about: "y" }));
  assert.equal((await getProfileAnswers(w.db, alpha.id)).legal, "Before");
  assert.equal(sql(w.db, "SELECT count(*) AS n FROM activity_log WHERE action = 'profile.updated'")[0].n, 1);
});
test("repository: organization ids must be real UUIDs and every query is scoped by it", async () => {
  const { w, alpha, beta } = await setup();
  const [row] = sql(w.db, "SELECT id FROM portal_users LIMIT 1");
  await saveProfileStep(w.db, alpha.id, row.id, "location", { city: "Calgary", size: "Just me" });
  assert.deepEqual(await getProfileAnswers(w.db, beta.id), {}, "another organization sees none of it");
  await assert.rejects(() => getProfileAnswers(w.db, "x' OR '1'='1"), /invalid_organization_id/);
  await assert.rejects(() => saveProfileStep(w.db, "", row.id, "location", {}), /invalid_organization_id/);
  const src = readFileSync(new URL("../portal/repo/business-profile.js", import.meta.url), "utf8");
  for (const q of src.match(/"(?:SELECT|INSERT|DELETE)[^"]*"/g)) assert.match(q, /organization_id/, q);
  assert.ok(!/\+ ?(organizationId|userId|input)/.test(src), "values are bound, never concatenated");
});

/* ------------------------------------------------------------------ routes: home, overview, steps */

test("signed-in Home shows the six approved blocks and nothing from the demonstration", async () => {
  const { ann } = await setup();
  const res = await ann.get("/portal/o/alpha");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.deepEqual([...html.matchAll(/class="tile" href="([^"]+)"/g)].map((m) => m[1]), ["profile", "branding", "website", "marketing", "content", "files"].map((x) => "/portal/o/alpha/" + x));
  assert.match(html, /What would you like to work on\?/);
  for (const fake of ["Harbour", "Brand identity", "Launch photography", "Sam Rivera", "Fictional", "DEMO MODE"]) assert.ok(!html.includes(fake), fake);
  const nav = html.slice(html.indexOf('<nav class="primary"'), html.indexOf("</nav>", html.indexOf('<nav class="primary"')));
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ["Home", "Account", "Team"], "owner: Home, Account, Team");
});
test("the five other sections are clean Coming Soon pages with no demonstration content, fake progress or controls", async () => {
  const { ann } = await setup();
  for (const key of ["branding", "website", "marketing", "content", "files"]) {
    const res = await ann.get(`/portal/o/alpha/${key}`);
    assert.equal(res.status, 200, key);
    const html = await res.text();
    assert.match(html, /Coming soon/); assert.match(html, new RegExp(`href="/portal/o/alpha/profile"`));
    assert.ok(!/<progress|<input|<textarea|<select|<form[^>]*method="post"[^>]*>(?!.*signout)|class="upload|class="proj|Harbour|Fictional|DEMO/.test(html.replace(/<form method="post" action="\/portal\/logout"[\s\S]*?<\/form>/, "")), key);
  }
  assert.equal((await ann.get("/portal/o/alpha/website/pages")).status, 404, "no demo sub-pages for real clients");
  assert.equal((await ann.get("/portal/o/alpha/requests/new-logo")).status, 404);
});
test("Business Profile overview starts empty and is calculated from saved answers only", async () => {
  const { w, ann } = await setup();
  const html0 = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(html0, /0 of 7 steps complete/); assert.equal([...html0.matchAll(/class="rowstat">/g)].length, 0);
  for (const fake of ["Harbour", "Grow wholesale", "Harbour & Pine"]) assert.ok(!html0.includes(fake), fake);
  let res = await save(w, ann, "alpha", "business", ANSWERS.business);
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/o/alpha/profile/business?saved=1");
  const html1 = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(html1, /1 of 7 steps complete/); assert.match(html1, /class="rowstat">Complete</);
  await save(w, ann, "alpha", "location", { city: "Calgary", size: "" });
  const html2 = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(html2, /1 of 7 steps complete/, "a partly answered step does not count"); assert.match(html2, /class="rowstat">In progress</);
  for (const s of ["location", "offering", "goals", "online", "contact", "personality"]) await save(w, ann, "alpha", s, { ...ANSWERS[s], ...(s === "online" ? { social: "@acme" } : {}), ...(s === "location" ? { size: "2 to 10 people" } : {}) });
  assert.match(await (await ann.get("/portal/o/alpha/profile")).text(), /7 of 7 steps complete/);
});
test("a step shows saved answers to resume or reopen, with the saved note and honest required-answer count", async () => {
  const { w, ann } = await setup();
  await save(w, ann, "alpha", "business", { legal: "Acme Co. Ltd.", industry: "Retail", about: "" });
  const html = await (await ann.get("/portal/o/alpha/profile/business?saved=1")).text();
  assert.match(html, /value="Acme Co\. Ltd\."/); assert.match(html, /<option selected>Retail<\/option>/);
  assert.match(html, /Saved\. 1 required answer is still needed to complete this step\./);
  assert.match(html, /What does your business do\?/); assert.match(html, /<span class="field__opt">Optional<\/span>/);
  assert.match(html, /data-guard/); assert.match(html, /name="csrf"/); assert.match(html, /<script src="\/assets\/js\/portal-profile\.js" defer><\/script>/);
  await save(w, ann, "alpha", "business", ANSWERS.business);
  assert.match(await (await ann.get("/portal/o/alpha/profile/business?saved=1")).text(), /Saved\. This step is complete\./);
  assert.ok(!(await (await ann.get("/portal/o/alpha/profile/business")).text()).includes("Saved."), "no saved note without the flag");
  assert.equal((await ann.get("/portal/o/alpha/profile/nope")).status, 404);
});
test("rejected answers: 422, nothing saved, the person's input and field messages stay on the page", async () => {
  const { w, ann } = await setup();
  const res = await save(w, ann, "alpha", "contact", { cname: "Ann", cemail: "not-an-email", cphone: "abc" });
  assert.equal(res.status, 422);
  const html = await res.text();
  assert.match(html, /role="alert"/); assert.match(html, /Enter a valid email address\./); assert.match(html, /Enter a valid phone number\./);
  assert.match(html, /value="Ann"/); assert.match(html, /value="not-an-email"/); assert.match(html, /aria-invalid="true"/);
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
});
test("a store failure on save is reported on the page with the answers kept; the session is not ended", async () => {
  const { w, ann } = await setup();
  const real = w.env.PORTAL_DB, failing = { ...real, prepare: real.prepare, exec: real.exec, batch: async () => { throw new Error("D1_ERROR secret detail"); } };
  const page = await (await ann.get("/portal/o/alpha/profile/offering")).text();
  const res = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/offering", { method: "POST", body: form({ csrf: csrfOf(page), offer: "Widgets", customers: "Everyone" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), { ...w.env, PORTAL_DB: failing }, { now: w.clock.now() });
  assert.equal(res.status, 503);
  const html = await res.text();
  assert.match(html, /couldn’t save your answers just now/); assert.match(html, />Widgets</); assert.ok(!/secret detail|D1_ERROR/.test(html));
  assert.equal((await ann.get("/portal/o/alpha/profile")).status, 200, "still signed in");
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
});

/* ------------------------------------------------------------------ tenant isolation and authorization */

test("tenant isolation: another organization's member gets 404 for every profile read and write, and can never write into it", async () => {
  const { w, ann, bob } = await setup();
  await save(w, ann, "alpha", "business", ANSWERS.business);
  for (const p of ["profile", "profile/business", "branding", ""]) assert.equal((await bob.get(`/portal/o/alpha/${p}`)).status, 404, p);
  // bob signs in to beta; he forges a POST to alpha's step with his own valid session and CSRF token
  const page = await (await bob.get("/portal/o/beta/profile/business")).text();
  const forged = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body: form({ csrf: csrfOf(page), legal: "HACKED", industry: "Retail", about: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: bob.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), w.env, { now: w.clock.now() });
  assert.equal(forged.status, 404);
  assert.equal((await getProfileAnswers(w.db, (await w.db.prepare("SELECT id FROM organizations WHERE slug='alpha'").first()).id)).legal, "Acme Co. Ltd.");
  // an organization id supplied in the form is ignored: the write goes to the membership's organization
  const own = await save(w, bob, "beta", "business", { ...ANSWERS.business, legal: "Beta Ltd", organization_id: "alpha", organizationId: "alpha", org: "alpha" });
  assert.equal(own.status, 303);
  const rows = sql(w.db, "SELECT o.slug, a.value FROM business_profile_answers a JOIN organizations o ON o.id = a.organization_id WHERE a.field_id = 'legal' ORDER BY o.slug").map((r) => ({ ...r }));
  assert.deepEqual(rows, [{ slug: "alpha", value: "Acme Co. Ltd." }, { slug: "beta", value: "Beta Ltd" }]);
  assert.ok(!(await (await bob.get("/portal/o/beta/profile/business")).text()).includes("Acme Co. Ltd."));
});
test("authentication is required for every route, and a signed-out request never reaches the database", async () => {
  const { w } = await setup();
  const anon = w.browser();
  for (const p of ["", "/profile", "/profile/business", "/website"]) { const r = await anon.get(`/portal/o/alpha${p}`); assert.equal(r.status, 303, p); assert.match(r.headers.get("Location"), /\/portal\/login/); }
  const r = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body: form({ legal: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: "https://staging.frameworkco.ca" } }), w.env, { now: w.clock.now() });
  assert.equal(r.status, 303); assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
});
test("members of the organization may read and edit; a revoked member loses access at once", async () => {
  const { w, mia } = await setup();
  assert.equal((await save(w, mia, "alpha", "location", { city: "Calgary", size: "Just me" })).status, 303);
  const nav = (await (await mia.get("/portal/o/alpha")).text());
  assert.ok(!/>Team</.test(nav.slice(nav.indexOf('<nav class="primary"'), nav.indexOf("</nav>", nav.indexOf('<nav class="primary"')))), "members do not see Team");
  w.db.raw.exec("UPDATE memberships SET status='revoked', revoked_at='2026-03-10T00:00:00.000Z' WHERE user_id IN (SELECT id FROM portal_users WHERE email='mia@alpha.test')");
  assert.equal((await mia.get("/portal/o/alpha/profile")).status, 404);
  assert.equal((await save(w, mia, "alpha", "location", { city: "X", size: "Just me" }).catch(() => ({ status: 404 }))).status, 404);
});
test("CSRF, same-site, content type, size and duplicate-field protections on every save", async () => {
  const { w, ann } = await setup();
  const page = await (await ann.get("/portal/o/alpha/profile/business")).text();
  const token = csrfOf(page);
  const base = (body, headers = {}) => handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca", ...headers } }), w.env, { now: w.clock.now() });
  const good = { legal: "A", industry: "Retail", about: "x" };
  assert.equal((await base(form({ ...good }))).status, 403, "no token");
  assert.equal((await base(form({ csrf: "wrong", ...good }))).status, 403, "wrong token");
  assert.equal((await base(form({ csrf: token.slice(0, -2) + "xx", ...good }))).status, 403, "tampered token");
  assert.equal((await base(form({ csrf: token, ...good }), { Origin: "https://evil.example" })).status, 403, "foreign origin");
  assert.equal((await base(form({ csrf: token, ...good }), { "Sec-Fetch-Site": "cross-site" })).status, 403, "cross-site");
  assert.equal((await base(JSON.stringify({ csrf: token, ...good }), { "Content-Type": "application/json" })).status, 400, "only urlencoded forms");
  assert.equal((await base(form({ csrf: token, legal: "x".repeat(MAX_PROFILE_FORM_BYTES + 10) }))).status, 413, "oversized body");
  assert.equal((await base(`csrf=${token}&legal=a&legal=b`)).status, 400, "duplicate field names");
  assert.equal((await base(form({ csrf: token, ...good }), { "Content-Length": "abc" })).status, 400);
  const otherSessionToken = csrfOf(await (await (await setup()).ann.get("/portal/o/alpha/profile/business")).text());
  assert.equal((await base(form({ csrf: otherSessionToken, ...good }))).status, 403, "a token from another session is useless");
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
  assert.equal((await base(form({ csrf: token, ...good }))).status, 303, "the genuine request still works");
  for (const m of ["PUT", "PATCH", "DELETE"]) assert.equal((await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: m, headers: { Cookie: ann.cookieHeader() } }), w.env, { now: w.clock.now() })).status, 405, m);
  assert.equal((await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/website", { method: "POST", body: "x", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), w.env, { now: w.clock.now() })).status, 405, "only the profile step accepts POST");
});
test("rate limiting applies to saves and a limited request does no database work", async () => {
  const { w, ann } = await setup();
  const page = await (await ann.get("/portal/o/alpha/profile/business")).text();
  const env = { ...w.env, PORTAL_RATE_LIMITER: { limit: async () => ({ success: false }) }, PORTAL_DB: { prepare() { throw new Error("database touched"); }, batch() { throw new Error("database touched"); }, exec() {} } };
  const r = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body: form({ csrf: csrfOf(page), legal: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca", "CF-Connecting-IP": "203.0.113.9" } }), env, { now: w.clock.now() });
  assert.equal(r.status, 429); assert.equal(r.headers.get("Retry-After"), "60");
});

/* ------------------------------------------------------------------ headers, logs, privacy */

test("profile pages allow only same-site scripts; every other portal page keeps the no-script policy", async () => {
  const { ann } = await setup();
  assert.equal(PORTAL_CSP_WITH_SCRIPT, PORTAL_CSP.replace("default-src 'none'; ", "default-src 'none'; script-src 'self'; "));
  assert.ok(!/unsafe-inline|unsafe-eval|https?:\/\/[^ ]*script/.test(PORTAL_CSP_WITH_SCRIPT.split(";").find((x) => x.includes("script-src"))));
  assert.equal((await ann.get("/portal/o/alpha/profile/business")).headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT);
  for (const p of ["", "/profile", "/website", "/account", "/progress"]) { const r = await ann.get("/portal/o/alpha" + p); assert.equal(r.headers.get("content-security-policy"), PORTAL_CSP, p); assert.ok(!/<script/i.test(await r.text()), p); }
  const html = await (await ann.get("/portal/o/alpha/profile/business")).text();
  assert.equal([...html.matchAll(/<script/g)].length, 1); assert.ok(!/\son[a-z]+=|\sstyle=|javascript:/i.test(html));
  assert.match((await ann.get("/portal/o/alpha/profile/business")).headers.get("cache-control"), /no-store/);
  const js = readFileSync(new URL("../../assets/js/portal-profile.js", import.meta.url), "utf8");
  assert.match(js, /beforeunload/); assert.ok(!/fetch\(|XMLHttpRequest|eval\(|innerHTML|document\.write/.test(js), "the script only guards navigation and shows a Saving state");
});
test("logs carry fixed fields only: never an answer, an email or a field value", async () => {
  const { w, ann } = await setup();
  const lines = [];
  const orig = console.log; console.log = (l) => lines.push(String(l));
  try { await save(w, ann, "alpha", "contact", { cname: "SecretName", cemail: "secret@private.example", cphone: "403-555-0199" }); await save(w, ann, "alpha", "contact", { cname: "SecretName2", cemail: "bad" }); } finally { console.log = orig; }
  const text = lines.join("\n");
  assert.match(text, /"evt":"profile.save"/);
  for (const secret of ["SecretName", "secret@private", "403-555", "Acme"]) assert.ok(!text.includes(secret), secret);
});
test("database: the answers table has one row per answered question per organization and rejects bad rows", async () => {
  const { w, alpha } = await setup();
  const [row] = sql(w.db, "SELECT id FROM portal_users LIMIT 1");
  const ins = (org, field, value) => w.db.raw.prepare("INSERT INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, ?, ?, ?, 't')").run(org, field, value, row.id);
  ins(alpha.id, "legal", "A");
  assert.throws(() => ins(alpha.id, "legal", "B"), /constraint failed/i, "one row per question");
  assert.throws(() => ins(alpha.id, "legal2", ""), /constraint failed/i, "no empty rows");
  assert.throws(() => ins(alpha.id, "Bad Field!", "x"), /constraint failed/i);
  assert.throws(() => ins(alpha.id, "legal3", "x".repeat(2001)), /constraint failed/i);
  assert.throws(() => ins("00000000-0000-4000-8000-000000000000", "legal", "x"), /constraint failed/i, "must belong to a real organization");
  assert.ok(FIELD_IDS.has("legal"));
});
