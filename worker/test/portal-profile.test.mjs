// The connected Business Profile (Staging first): schema validation, completion, tenant isolation, authorization, CSRF, limits, failure handling,
// Coming Soon pages and the absence of demonstration data for signed-in clients.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, revOf, ORIGIN } from "./helpers/portal-e2e.mjs";
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
    method: "POST", body: form({ csrf: token, rev: revOf(page), ...fields }),
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: "https://staging.frameworkco.ca", ...headers },
  }), world.env, { now: world.clock.now() });
}

/* ------------------------------------------------------------------ schema */

test("schema: seven steps, versioned, every question defined once with a kind and limits; no sample answers", () => {
  assert.equal(PROFILE_SCHEMA_VERSION, 1);
  assert.deepEqual(PROFILE_STEPS.map((s) => s.id), ["business", "location", "offering", "goals", "online", "contact", "personality"]);
  const ids = PROFILE_STEPS.flatMap((s) => s.fields.map((f) => f.id));
  assert.equal(new Set(ids).size, ids.length);
  for (const s of PROFILE_STEPS) for (const f of s.fields) { assert.ok(["text", "textarea", "select", "choice", "multi", "email", "tel", "website"].includes(f.kind)); assert.ok(!("value" in f), "no values in the schema"); if (f.kind === "select" || f.kind === "choice" || f.kind === "multi") assert.ok(f.options.length > 1); }
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
  assert.equal(validateAnswer(def("site"), "https://acme.example").value, "https://acme.example");
  assert.equal(validateAnswer(def("site"), "acme.example").value, "https://acme.example");
  for (const bad of ["javascript:alert(1)", "https://user:pw@acme.example", "ftp://acme.example"]) assert.ok(validateAnswer(def("site"), bad).error, bad);
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

test("signed-in Home: Business Profile is the one link and the clear focus; the five unavailable sections are a quiet, non-interactive 'Coming soon' list", async () => {
  const { ann } = await setup();
  const res = await ann.get("/portal/o/alpha");
  assert.equal(res.status, 200);
  const html = await res.text();
  const focus = html.slice(html.indexOf('<ul class="hubs">'), html.indexOf("</ul>", html.indexOf('<ul class="hubs">')));
  assert.deepEqual([...focus.matchAll(/<span class="hub__title">([^<]+)</g)].map((m) => m[1]), ["Business Profile"], "only the available module is a card");
  assert.deepEqual([...focus.matchAll(/<a class="hub" href="([^"]+)"/g)].map((m) => m[1]), ["/portal/o/alpha/profile"]);
  const soon = /<p class="soon-line">[\s\S]*?<\/p>/.exec(html)[0];
  assert.deepEqual(soon.replace(/<[^>]+>/g, "").replace(/^Coming soon\s+/, "").replace(/&amp;/g, "&").split(" · "), ["Branding", "Website", "Marketing", "Content & Photography", "Files & Deliverables"], "same five, same order");
  assert.equal([...soon.matchAll(/Coming soon/g)].length, 1, "one quiet label, not a badge on every item");
  assert.ok(!/<a |href=|tabindex|role="link"|role="button"|onclick|tile__arrow|<progress|dot/.test(soon), "no link, no focus stop, no arrow, no status");
  assert.ok(!/class="tile\b/.test(html), "no card grid on the signed-in Home");
  for (const fake of ["Harbour", "Brand identity", "Launch photography", "Sam Rivera", "Fictional", "DEMO MODE"]) assert.ok(!html.includes(fake), fake);
  const nav = html.slice(html.indexOf('<nav class="primary"'), html.indexOf("</nav>", html.indexOf('<nav class="primary"')));
  assert.deepEqual([...nav.matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]), ["Home", "Account", "Team"], "owner: Home, Account, Team");
});
test("availability is one list: activating a section turns its block into a link; the Coming Soon route list is derived from the same list; the demo links everything", async () => {
  const d = await import("../portal/guided-data.js");
  const g = await import("../portal/guided.js");
  assert.deepEqual([...d.LIVE_AREAS], ["profile"]);
  assert.deepEqual(d.comingSoonKeys(), ["branding", "website", "marketing", "content", "files"]);
  assert.deepEqual(d.comingSoonKeys(["profile", "website"]), ["branding", "marketing", "content", "files"]);
  const vm = (liveAreas) => ({ base: "/portal/o/x", org: { name: "X Co" }, user: { name: "Ann" }, ...(liveAreas ? { liveAreas } : {}) });
  const links = (h) => [...h.matchAll(/class="(?:tile(?: tile--status)?|hub)" href="([^"]+)"/g)].map((m) => m[1].split("/").pop());
  assert.deepEqual(links(g.home(vm(["profile"]))), ["profile"]);
  assert.deepEqual(links(g.home(vm(["profile", "website"]))), ["profile", "website"], "one more section released: nothing else changes");
  assert.equal(/<p class="soon-line">[\s\S]*?<\/p>/.exec(g.home(vm(["profile", "website"])))[0].split(" · ").length, 4);
  assert.deepEqual(links(g.home(vm(null))), ["profile", "branding", "website", "marketing", "content", "files"], "the demo is unaffected");
  assert.ok(!/Coming soon/.test(g.home(vm(null))));
  assert.match(read("worker/portal/router.js"), /const SOON = comingSoonKeys\(\)\.join\("\|"\);/);
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
  assert.match(html0, /0 of 7 steps complete/); assert.equal([...html0.matchAll(/class="rowstat">/g)].length, 6, "six steps have required answers outstanding; Online presence has none");
  assert.ok(!/class="rowstat">(Complete|In progress)/.test(html0));
  for (const fake of ["Harbour", "Grow wholesale", "Harbour & Pine"]) assert.ok(!html0.includes(fake), fake);
  let res = await save(w, ann, "alpha", "business", ANSWERS.business);
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/o/alpha/profile/business?saved=1");
  const html1 = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(html1, /1 of 7 steps complete/); assert.match(html1, /class="rowstat">Complete</);
  await save(w, ann, "alpha", "location", { city: "Calgary", size: "" });
  const html2 = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(html2, /1 of 7 steps complete/, "a partly answered step does not count"); assert.match(html2, /class="rowstat">In progress · 1 required answer left</);
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
  const res = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/offering", { method: "POST", body: form({ csrf: csrfOf(page), rev: revOf(page), offer: "Widgets", customers: "Everyone" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), { ...w.env, PORTAL_DB: failing }, { now: w.clock.now() });
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
  const forged = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body: form({ csrf: csrfOf(page), rev: revOf(page), legal: "HACKED", industry: "Retail", about: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: bob.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), w.env, { now: w.clock.now() });
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
  assert.equal((await base(form({ csrf: token, rev: revOf(page), ...good }), { Origin: "https://evil.example" })).status, 403, "foreign origin");
  assert.equal((await base(form({ csrf: token, rev: revOf(page), ...good }), { "Sec-Fetch-Site": "cross-site" })).status, 403, "cross-site");
  assert.equal((await base(JSON.stringify({ csrf: token, ...good }), { "Content-Type": "application/json" })).status, 400, "only urlencoded forms");
  assert.equal((await base(form({ csrf: token, rev: revOf(page), legal: "x".repeat(MAX_PROFILE_FORM_BYTES + 10) }))).status, 413, "oversized body");
  assert.equal((await base(`csrf=${token}&legal=a&legal=b`)).status, 400, "duplicate field names");
  assert.equal((await base(form({ csrf: token, rev: revOf(page), ...good }), { "Content-Length": "abc" })).status, 400);
  const otherSessionToken = csrfOf(await (await (await setup()).ann.get("/portal/o/alpha/profile/business")).text());
  assert.equal((await base(form({ csrf: otherSessionToken, ...good }))).status, 403, "a token from another session is useless");
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
  assert.equal((await base(form({ csrf: token, rev: revOf(page), ...good }))).status, 303, "the genuine request still works");
  for (const m of ["PUT", "PATCH", "DELETE"]) assert.equal((await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: m, headers: { Cookie: ann.cookieHeader() } }), w.env, { now: w.clock.now() })).status, 405, m);
  assert.equal((await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/website", { method: "POST", body: "x", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca" } }), w.env, { now: w.clock.now() })).status, 405, "only the profile step accepts POST");
});
test("rate limiting applies to saves and a limited request does no database work", async () => {
  const { w, ann } = await setup();
  const page = await (await ann.get("/portal/o/alpha/profile/business")).text();
  const env = { ...w.env, PORTAL_RATE_LIMITER: { limit: async () => ({ success: false }) }, PORTAL_DB: { prepare() { throw new Error("database touched"); }, batch() { throw new Error("database touched"); }, exec() {} } };
  const r = await handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha/profile/business", { method: "POST", body: form({ csrf: csrfOf(page), rev: revOf(page), legal: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: "https://staging.frameworkco.ca", "CF-Connecting-IP": "203.0.113.9" } }), env, { now: w.clock.now() });
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

/* ------------------------------------------------------------------ Step 398: end-to-end verification (integration level) */

test("answers persist across sign-out and a brand-new sign-in; the ended session no longer works; progress is recomputed from the saved rows", async () => {
  const { w, ann } = await setup();
  assert.equal((await save(w, ann, "alpha", "business", ANSWERS.business)).status, 303);
  await save(w, ann, "alpha", "location", { city: "Calgary", size: "" });
  const pageBefore = await (await ann.get("/portal/o/alpha/profile")).text();
  assert.match(pageBefore, /1 of 7 steps complete/);
  const out = await handlePortal(new Request(ORIGIN + "/portal/logout", { method: "POST", body: form({ csrf: csrfOf(pageBefore) }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now(), fetch: w.workos.fetch });
  assert.equal(out.status, 303);
  const stale = await ann.get("/portal/o/alpha/profile"); // the old cookie
  assert.equal(stale.status, 303); assert.match(stale.headers.get("Location"), /\/portal\/login/);
  const again = w.browser();
  await again.signIn(w.user(1, "ann@alpha.test"));
  const overview = await (await again.get("/portal/o/alpha/profile")).text();
  assert.match(overview, /1 of 7 steps complete/); assert.match(overview, /class="rowstat">In progress · \d required answers? left</);
  const step = await (await again.get("/portal/o/alpha/profile/business")).text();
  for (const v of ["Acme Co. Ltd.", "Acme", "We sell things."]) assert.ok(step.includes(`>${v}<`) || step.includes(`value="${v}"`), v);
  assert.match(step, /<option selected>Retail<\/option>/);
  assert.match(await (await again.get("/portal/o/alpha/profile/location")).text(), /value="Calgary"/);
  // editing and saving again replaces the answer
  await save(w, again, "alpha", "business", { ...ANSWERS.business, legal: "Acme Renamed Ltd." });
  assert.match(await (await again.get("/portal/o/alpha/profile/business")).text(), /value="Acme Renamed Ltd\."/);
  assert.equal(sql(w.db, "SELECT count(*) AS n FROM business_profile_answers WHERE field_id = 'legal'")[0].n, 1, "an edit updates the row, it never adds one");
});
test("every question renders with the right input, its Optional marker only where optional, and the saved-state flags", async () => {
  const { ann } = await setup();
  for (const step of PROFILE_STEPS) {
    const html = await (await ann.get(`/portal/o/alpha/profile/${step.id}`)).text();
    for (const f of step.fields) {
      assert.ok(html.includes(f.label.replace(/&/g, "&amp;")), `${step.id}/${f.id} label`);
      const tag = f.kind === "textarea" ? `<textarea id="p-${step.id}-${f.id}" name="${f.id}"` : f.kind === "select" ? `<select id="p-${step.id}-${f.id}" name="${f.id}"` : f.kind === "choice" ? `name="${f.id}" value=` : f.kind === "multi" ? `name="${f.id}__0" value=` : f.kind === "website" ? `<input id="p-${step.id}-${f.id}" name="${f.id}" type="text" inputmode="url"` : `<input id="p-${step.id}-${f.id}" name="${f.id}" type="${f.kind}"`;
      assert.ok(html.includes(tag), `${step.id}/${f.id} control`);
    }
    const optionals = step.fields.filter((f) => !f.required).length;
    assert.equal([...html.matchAll(/class="field__opt">Optional</g)].length, optionals, step.id + " optional markers");
  }
});
test("revoked membership: read and write are refused at once and nothing is written", async () => {
  const { w, mia } = await setup();
  assert.equal((await save(w, mia, "alpha", "location", { city: "Calgary", size: "Just me" })).status, 303);
  const page = await (await mia.get("/portal/o/alpha/profile/location")).text();
  const token = csrfOf(page);
  w.db.raw.exec("UPDATE memberships SET status='revoked', revoked_at='2026-03-10T00:00:00.000Z' WHERE user_id IN (SELECT id FROM portal_users WHERE email='mia@alpha.test')");
  const before = sql(w.db, "SELECT field_id, value, updated_at FROM business_profile_answers ORDER BY field_id");
  const write = await handlePortal(new Request(ORIGIN + "/portal/o/alpha/profile/location", { method: "POST", body: form({ csrf: token, rev: revOf(page), city: "HACKED", size: "Just me" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: mia.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(write.status, 404);
  for (const p of ["profile", "profile/location", ""]) assert.equal((await mia.get(`/portal/o/alpha/${p}`)).status, 404, p);
  assert.deepEqual(sql(w.db, "SELECT field_id, value, updated_at FROM business_profile_answers ORDER BY field_id"), before);
});
test("forged organization identifiers grant nothing: another organization's id or slug in the path, query or form", async () => {
  const { w, ann, bob, beta, alpha } = await setup();
  await save(w, bob, "beta", "business", { ...ANSWERS.business, legal: "Beta Secret Ltd" });
  for (const p of [`/portal/o/${beta.id}/profile`, `/portal/o/${beta.id}/profile/business`, "/portal/o/beta/profile", "/portal/o/BETA/profile", "/portal/o/beta%2Fx/profile", "/portal/o/alpha/../beta/profile", "/portal/o/alpha/profile/business?organization_id=" + beta.id + "&org=beta"]) {
    const r = await ann.get(p);
    const text = r.status === 200 ? await r.text() : "";
    assert.ok(r.status !== 200 || !text.includes("Beta Secret"), p + " " + r.status);
    if (!p.includes("?organization_id")) assert.ok([404, 400].includes(r.status), p + " " + r.status);
  }
  const page = await (await ann.get("/portal/o/alpha/profile/business")).text();
  const r = await handlePortal(new Request(ORIGIN + "/portal/o/alpha/profile/business", { method: "POST", body: form({ csrf: csrfOf(page), rev: revOf(page), legal: "Alpha Ltd", industry: "Retail", about: "x", organization_id: beta.id, organizationId: beta.id, slug: "beta" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(r.status, 303);
  assert.deepEqual(sql(w.db, "SELECT organization_id AS o, value FROM business_profile_answers WHERE field_id='legal' ORDER BY value").map((x) => ({ ...x })), [{ o: alpha.id, value: "Alpha Ltd" }, { o: beta.id, value: "Beta Secret Ltd" }]);
});
test("server-side validation cannot be bypassed by crafting the request", async () => {
  const { w, ann } = await setup();
  const attempts = [
    ["personality", { words: "x", tone: "Made up tone" }, "tone"],
    ["business", { legal: "A", industry: "Spaceships", about: "x" }, "industry"],
    ["business", { legal: "A".repeat(201), industry: "Retail", about: "x" }, "legal"],
    ["business", { legal: "A", industry: "Retail", about: "x".repeat(2001) }, "about"],
    ["contact", { cname: "A", cemail: "a@b" }, "cemail"],
    ["online", { site: "javascript:alert(1)" }, "site"],
    ["online", { site: "ftp://files.example.com" }, "site"],
    ["business", { legal: "A\u0000B", industry: "Retail", about: "x" }, "legal"],
  ];
  for (const [step, fields, bad] of attempts) {
    const res = await save(w, ann, "alpha", step, fields);
    assert.equal(res.status, 422, `${step}/${bad}`);
    assert.match(await res.text(), /class="field__error"/, bad + " has a visible message");
  }
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), [], "nothing from a rejected request was stored");
  // unknown or array-style field names are ignored, never stored
  const ok = await save(w, ann, "alpha", "business", { ...ANSWERS.business, "legal[]": "x", __proto__x: "y", extra: "z" });
  assert.equal(ok.status, 303);
  assert.deepEqual(sql(w.db, "SELECT field_id FROM business_profile_answers ORDER BY field_id").map((r) => r.field_id), ["about", "industry", "legal", "operating"]);
  assert.equal((await handlePortal(new Request(ORIGIN + "/portal/o/alpha/profile/__proto__", { method: "POST", body: form({ csrf: "x" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() })).status, 404);
});
test("save rate limit: after the allowance is used, further saves are refused with 429 and write nothing", async () => {
  const { w, ann } = await setup();
  const counts = {};
  const env = { ...w.env, PORTAL_RATE_LIMITER: { limit: async ({ key }) => ({ success: (counts[key] = (counts[key] || 0) + 1) <= 3 }) } };
  const page = await (await ann.get("/portal/o/alpha/profile/offering")).text();
  const token = csrfOf(page), statuses = [];
  for (let i = 0; i < 6; i++) statuses.push((await handlePortal(new Request(ORIGIN + "/portal/o/alpha/profile/offering", { method: "POST", body: form({ csrf: token, rev: revOf(await (await ann.get("/portal/o/alpha/profile/offering")).text()), offer: "o" + i, customers: "c" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN, "CF-Connecting-IP": "203.0.113.50" } }), env, { now: w.clock.now() })).status);
  assert.deepEqual(statuses, [303, 303, 303, 429, 429, 429]);
  assert.equal(sql(w.db, "SELECT value FROM business_profile_answers WHERE field_id='offer'")[0].value, "o2", "limited saves never reached the database");
  const keys = Object.keys(counts); assert.equal(keys.length, 1); assert.match(keys[0], /^profile:[0-9a-f]{32}$/, "a hashed per-network key, never the address");
});
test("the DDL applied to the Staging database is exactly migration 0002 (whitespace aside), and is non-destructive", () => {
  const applied = "CREATE TABLE IF NOT EXISTS business_profile_answers (organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE RESTRICT, field_id TEXT NOT NULL CHECK (length(field_id) BETWEEN 1 AND 40 AND field_id NOT GLOB '*[^a-z0-9_]*'), value TEXT NOT NULL CHECK (length(value) BETWEEN 1 AND 2000), schema_version INTEGER NOT NULL DEFAULT 1 CHECK (schema_version >= 1), updated_by TEXT NOT NULL REFERENCES portal_users (id) ON DELETE RESTRICT, updated_at TEXT NOT NULL, PRIMARY KEY (organization_id, field_id)) WITHOUT ROWID";
  const file = readFileSync(new URL("../../migrations/portal/0002_business_profile.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  const norm = (x) => x.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1").replace(/;\s*$/, "").trim();
  assert.equal(norm(file), norm(applied));
  assert.ok(!/\b(DROP|ALTER|TRUNCATE|UPDATE|INSERT)\b|(?<!ON )\bDELETE\b/i.test(file), "creates one table and nothing else");
  assert.equal([...file.matchAll(/CREATE TABLE/g)].length, 1);
});

/* ------------------------------------------------------------------ website address field */

import { normalizeWebsite, withProtocol } from "../portal/profile-schema.js";
import vm from "node:vm";
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

const ACCEPTED = [
  ["frameworkco.ca", "https://frameworkco.ca"],
  ["www.frameworkco.ca", "https://www.frameworkco.ca"],
  ["  frameworkco.ca  ", "https://frameworkco.ca"],
  ["\tframeworkco.ca\n", "https://frameworkco.ca"],
  ["https://frameworkco.ca", "https://frameworkco.ca"],
  ["http://frameworkco.ca", "http://frameworkco.ca"],
  ["HTTPS://FrameworkCo.ca", "https://FrameworkCo.ca"],
  ["Http://frameworkco.ca/About", "http://frameworkco.ca/About"],
  ["shop.frameworkco.ca", "https://shop.frameworkco.ca"],
  ["a.b.c.example.co.uk", "https://a.b.c.example.co.uk"],
  ["frameworkco.ca/", "https://frameworkco.ca/"],
  ["frameworkco.ca/about/team", "https://frameworkco.ca/about/team"],
  ["frameworkco.ca/search?q=bread&page=2", "https://frameworkco.ca/search?q=bread&page=2"],
  ["www.frameworkco.ca/menu#lunch", "https://www.frameworkco.ca/menu#lunch"],
  ["https://frameworkco.ca/a%20b?x=1", "https://frameworkco.ca/a%20b?x=1"],
  ["frameworkco.ca:8080/app", "https://frameworkco.ca:8080/app"],
  ["my-business.ca", "https://my-business.ca"],
  ["123bakery.ca", "https://123bakery.ca"],
  ["café.ca", "https://café.ca"],
  ["xn--caf-dma.ca", "https://xn--caf-dma.ca"],
  ["frameworkco.photography", "https://frameworkco.photography"],
  ["", ""], ["   ", ""],
];
const REJECTED = ["frameworkco", "localhost", "http://localhost:3000", "192.168.1.1", "http://10.0.0.1/admin", "https://[::1]/", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "mailto:me@frameworkco.ca", "ftp://frameworkco.ca", "file:///etc/passwd", "//frameworkco.ca", "frameworkco ca", "frameworkco.ca, other.ca", "my business.ca", "https://", "https:// frameworkco.ca", "http://http://frameworkco.ca", "user:pass@frameworkco.ca", "https://user@frameworkco.ca", ".ca", "frameworkco.", "-bad.ca", "bad-.ca", "bad..ca", "bad_name.ca", "frameworkco.c", "frameworkco.123", "<script>.ca", "frameworkco.ca\u0000", "fra\nmeworkco.ca", "frameworkco.ca/<x>", 'frameworkco.ca/"q"', "x".repeat(70) + ".ca", ("a".repeat(60) + ".").repeat(5) + "ca", "frameworkco.ca/" + "p".repeat(300)];

test("website address: accepted formats are normalised the same way (protocol added only when missing, trimmed, path/query kept)", () => {
  for (const [typed, stored] of ACCEPTED) assert.deepEqual(normalizeWebsite(typed), { value: stored }, JSON.stringify(typed));
  assert.equal(normalizeWebsite("frameworkco.ca/?q=a b").error !== undefined, true, "a space inside is still refused");
});
test("website address: invalid input is refused with a helpful message and is never rewritten into something valid", () => {
  for (const bad of REJECTED) { const r = normalizeWebsite(bad); assert.ok(r.error, JSON.stringify(bad).slice(0, 60)); assert.ok(!("value" in r)); }
  assert.match(normalizeWebsite("frameworkco").error, /such as yourbusiness\.ca/);
  assert.match(normalizeWebsite("frameworkco.ca/" + "p".repeat(300)).error, /under 300/);
  assert.equal(normalizeWebsite(undefined).value, ""); assert.equal(normalizeWebsite(null).value, "");
});
test("website address: the browser helper and the server rule agree on every accepted input (the server is still authoritative)", () => {
  const sandbox = { window: {}, document: { querySelector: () => null } };
  vm.runInNewContext(read("assets/js/portal-profile.js"), sandbox);
  const front = sandbox.window.FrameworkWebsite.withProtocol;
  assert.equal(typeof front, "function");
  for (const [typed] of ACCEPTED) assert.equal(front(typed), withProtocol(typed), JSON.stringify(typed));
  for (const [typed, stored] of ACCEPTED) if (stored) assert.equal(front(typed), stored, "what the browser shows is exactly what the server stores: " + JSON.stringify(typed));
  for (const bad of ["frameworkco", "ftp://x.ca", "javascript:alert(1)"]) assert.equal(front(bad), withProtocol(bad), "same rewrite even for input the server will refuse");
  const js = read("assets/js/portal-profile.js");
  assert.match(js, /input\[data-website\]/); assert.ok(!/fetch\(|XMLHttpRequest|eval\(|innerHTML/.test(js));
});
test("website field markup: a text box with URL keyboard hints and the new placeholder, no native URL validation; layout classes unchanged", async () => {
  const { ann } = await setup();
  const html = await (await ann.get("/portal/o/alpha/profile/online")).text();
  const input = html.match(/<input id="p-online-site"[^>]*>/)[0];
  assert.match(input, /type="text"/); assert.ok(!/type="url"/.test(input));
  for (const attr of ['inputmode="url"', 'autocapitalize="none"', 'autocorrect="off"', 'spellcheck="false"', 'placeholder="yourbusiness.ca"', 'maxlength="300"', 'autocomplete="url"', "data-website"]) assert.ok(input.includes(attr), attr);
  assert.ok(!html.includes('placeholder="https://"'));
  assert.match(html, /<div class="field"><label for="p-online-site">Existing website <span class="field__opt">Optional<\/span><\/label>/);
  assert.equal([...html.matchAll(/type="url"/g)].length, 0, "no native URL inputs anywhere in the Business Profile");
  for (const step of PROFILE_STEPS) assert.ok(!(await (await ann.get(`/portal/o/alpha/profile/${step.id}`)).text()).includes('type="url"'), step.id);
  assert.deepEqual(PROFILE_STEPS.flatMap((s) => s.fields).filter((f) => f.kind === "website").map((f) => f.id), ["site"], "site is the only website-address question (social platforms stay free text)");
});
test("website address: typed without a protocol it is saved with https://, reloads exactly so, survives sign-out, and edits normalise again", async () => {
  const { w, ann } = await setup();
  assert.equal((await save(w, ann, "alpha", "online", { site: "  www.acme.example/menu?lang=en  ", social: "@acme" })).status, 303);
  assert.equal(sql(w.db, "SELECT value FROM business_profile_answers WHERE field_id='site'")[0].value, "https://www.acme.example/menu?lang=en");
  const page = await (await ann.get("/portal/o/alpha/profile/online?saved=1")).text();
  assert.ok(page.includes('value="https://www.acme.example/menu?lang=en"')); assert.match(page, /Saved\. This step is complete\./);
  assert.match(await (await ann.get("/portal/o/alpha/profile")).text(), /1 of 7 steps complete/);
  await save(w, ann, "alpha", "online", { site: "http://old.acme.example", social: "@acme" });
  assert.equal(sql(w.db, "SELECT value FROM business_profile_answers WHERE field_id='site'")[0].value, "http://old.acme.example", "an explicit http:// is preserved");
  await save(w, ann, "alpha", "online", { site: "acme.example", social: "" });
  assert.equal(sql(w.db, "SELECT value FROM business_profile_answers WHERE field_id='site'")[0].value, "https://acme.example");
  const again = w.browser(); await again.signIn(w.user(1, "ann@alpha.test"));
  assert.ok((await (await again.get("/portal/o/alpha/profile/online")).text()).includes('value="https://acme.example"'));
  await save(w, ann, "alpha", "online", { site: "", social: "x" });
  assert.ok(!sql(w.db, "SELECT field_id FROM business_profile_answers").some((r) => r.field_id === "site"), "clearing it removes the answer");
});
test("website address: a bad address is refused with a clear message, the typed text stays in the box, and nothing is saved", async () => {
  const { w, ann } = await setup();
  for (const bad of ["frameworkco", "javascript:alert(1)", "my business.ca", "ftp://acme.example", "192.168.0.1"]) {
    const r = await save(w, ann, "alpha", "online", { site: bad, social: "@acme" });
    assert.equal(r.status, 422, bad);
    const html = await r.text();
    assert.match(html, /Enter a website address such as yourbusiness\.ca/); assert.match(html, /aria-invalid="true"/);
    assert.ok(html.includes(`value="${bad}"`), "the typed text is kept");
  }
  assert.deepEqual(sql(w.db, "SELECT * FROM business_profile_answers"), []);
});
test("existing saved website answers keep working: old values (with the trailing slash the earlier rule produced) display, re-save unchanged and still count", async () => {
  const { w, alpha, ann } = await setup();
  const uid = sql(w.db, "SELECT id FROM portal_users LIMIT 1")[0].id;
  for (const old of ["https://acme.example/", "https://www.acme.example/path?q=1", "http://legacy.example/"]) {
    w.db.raw.prepare("INSERT OR REPLACE INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, 'site', ?, ?, 't')").run(alpha.id, old, uid);
    assert.ok((await (await ann.get("/portal/o/alpha/profile/online")).text()).includes(`value="${old}"`), old);
    assert.equal((await save(w, ann, "alpha", "online", { site: old, social: "" })).status, 303, "re-saving the stored value is accepted");
    assert.equal(sql(w.db, "SELECT value FROM business_profile_answers WHERE field_id='site'")[0].value, old, "and unchanged");
    assert.match(await (await ann.get("/portal/o/alpha/profile")).text(), /1 of 7 steps complete/);
  }
  assert.equal(normalizeWebsite("https://acme.example/").value, "https://acme.example/");
});
test("the fictional demo's website box uses the same text input and placeholder", async () => {
  const env = { ...(await makeWorld()).env, PORTAL_DEMO: "1" };
  const html = await (await handlePortal(new Request(ORIGIN + "/portal/demo/profile/online"), env, { now: new Date() })).text();
  const input = html.match(/<input id="p-online-site"[^>]*>/)[0];
  assert.ok(input.includes('type="text"') && input.includes('inputmode="url"') && input.includes('placeholder="yourbusiness.ca"') && !input.includes('type="url"'));
});
