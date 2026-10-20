// Business Profile optimistic concurrency: a form carries the step's REVISION (the newest `profile.updated` audit entry for that step); a save is applied
// only if the revision is still current, atomically with the write. Regression for the pre-launch audit finding: a stale form silently deleted answers
// that another session had saved. No migration: the revision comes from the existing activity_log.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, revOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { saveProfileStep, getStepRevision } from "../portal/repo/business-profile.js";
import { PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const form = (o) => new URLSearchParams(o).toString();
const BASE = "/portal/o/alpha/profile";
const ANN = { legal: "Acme Co. Ltd.", operating: "", industry: "Retail", about: "We sell things." };

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), ann2 = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await ann2.signIn(w.user(1, "ann@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const uid = (email) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(email).id;
  return { w, alpha, beta, ann, mia, ann2, bob, uid };
}
/** What a real browser does: GET the step, then POST the form back with exactly the hidden fields it carries. */
const open = async (who, step = "business", slug = "alpha") => { const html = await (await who.get(`/portal/o/${slug}/profile/${step}`)).text(); return { html, csrf: csrfOf(html), rev: revOf(html) }; };
const submit = (w, who, loaded, fields, { step = "business", slug = "alpha", over = {} } = {}) =>
  handlePortal(new Request(ORIGIN + `/portal/o/${slug}/profile/${step}`, { method: "POST", body: form({ csrf: loaded.csrf, rev: loaded.rev, ...fields, ...over }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
const answers = (w, orgId) => Object.fromEntries(sql(w.db, "SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?", orgId).map((r) => [r.field_id, r.value]));
const audits = (w, orgId) => sql(w.db, "SELECT id FROM activity_log WHERE organization_id = ? AND action = 'profile.updated'", orgId).length;
const loc = (r) => r.headers.get("Location");

/* ------------------------------------------------------------------ the original data-loss scenario */

test("REGRESSION: two sessions open the same empty step; one saves several answers; the other's stale form is refused and NOTHING saved is lost", async () => {
  const { w, alpha, ann, mia } = await setup();
  const forAnn = await open(ann), forMia = await open(mia);
  assert.equal(forAnn.rev, "", "an unsaved step has the empty revision");
  assert.equal(forMia.rev, "");
  const saved = await submit(w, ann, forAnn, ANN);
  assert.equal(saved.status, 303);
  const before = answers(w, alpha.id), auditBefore = audits(w, alpha.id);
  assert.deepEqual(before, { legal: "Acme Co. Ltd.", industry: "Retail", about: "We sell things." });
  // Mia's page is stale: she only types an operating name (the other fields are still empty in her form), then saves
  const res = await submit(w, mia, forMia, { legal: "", operating: "Acme", industry: "", about: "" });
  assert.equal(res.status, 409);
  assert.equal(loc(res), null, "no redirect: she stays on the page");
  assert.deepEqual(answers(w, alpha.id), before, "no previously saved answer was lost, and her answer was not half-applied");
  assert.equal(audits(w, alpha.id), auditBefore, "a refused save leaves no audit entry");
  const html = await res.text();
  // clear, accessible conflict message
  assert.match(html, /<div class="error-summary" role="alert" tabindex="-1" data-error-summary aria-labelledby="error-summary-title">/);
  assert.match(html, /This section changed while you were editing\. Nothing was saved\./);
  assert.match(html, /Someone else, or another window or device, saved changes to this section after you opened it\./);
  assert.match(html, /Reload the latest saved answers \(discard my changes\)/);
  assert.match(html, /<script src="\/assets\/js\/portal-profile\.js" defer><\/script>/, "the focus script moves keyboard focus to the notice");
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT);
  // what is saved now is listed, with links to the fields
  assert.match(html, /<a href="#p-business-legal">Legal business name: currently saved as “Acme Co\. Ltd\.”<\/a>/);
  assert.match(html, /<a href="#p-business-about">What does your business do\?: currently saved as “We sell things\.”<\/a>/);
  assert.match(html, /<a href="#p-business-operating">Operating name: currently empty<\/a>/, "the notice is truthful about every answer that differs from what she typed, including her own new one");
  // her input is preserved
  assert.match(html, /<input id="p-business-operating" name="operating" type="text" value="Acme"/);
  // the form now carries the LATEST revision, so saving again is a deliberate choice, not a loop
  assert.notEqual(revOf(html), forMia.rev);
  assert.equal(revOf(html), await getStepRevision(w.db, alpha.id, "business"));
});

test("after the conflict the person decides: saving again with the latest revision succeeds, and reloading shows exactly what is saved", async () => {
  const { w, alpha, ann, mia } = await setup();
  const forAnn = await open(ann), forMia = await open(mia);
  await submit(w, ann, forAnn, ANN);
  const conflict = await submit(w, mia, forMia, { legal: "Acme Co. Ltd.", operating: "Acme", industry: "Retail", about: "We sell things." });
  assert.equal(conflict.status, 409, "even a form that restores the same values is stale once the section has changed... unless nothing differs");
  const latest = { csrf: forMia.csrf, rev: revOf(await conflict.text()) };
  const again = await submit(w, mia, latest, { legal: "Acme Co. Ltd.", operating: "Acme", industry: "Retail", about: "We sell things." });
  assert.equal(again.status, 303);
  assert.equal(answers(w, alpha.id).operating, "Acme");
  const reload = await open(mia);
  assert.match(reload.html, /value="Acme"/);
  assert.equal(audits(w, alpha.id), 2);
});

test("it works across devices of the SAME person and across members of the organization", async () => {
  const { w, alpha, ann, ann2, mia } = await setup();
  const phone = await open(ann2), laptop = await open(ann), colleague = await open(mia);
  assert.equal((await submit(w, ann, laptop, ANN)).status, 303);
  const [a, b] = [await submit(w, ann2, phone, { legal: "", operating: "Phone", industry: "", about: "" }), await submit(w, mia, colleague, { legal: "", operating: "", industry: "", about: "Mia" })];
  assert.deepEqual([a.status, b.status], [409, 409]);
  assert.deepEqual(answers(w, alpha.id), { legal: "Acme Co. Ltd.", industry: "Retail", about: "We sell things." });
});

/* ------------------------------------------------------------------ simultaneous submissions */

test("SIMULTANEOUS submissions against the same revision: exactly one succeeds, the other is refused, and the result is one whole submission (never a mix)", async () => {
  for (let round = 0; round < 8; round++) {
    const { w, alpha, ann, mia, ann2 } = await setup();
    const loaded = [await open(ann), await open(mia), await open(ann2)];
    const people = [ann, mia, ann2];
    const bodies = ["A", "B", "C"].map((x) => ({ legal: "Legal " + x, operating: "Op " + x, industry: "Retail", about: "About " + x }));
    const results = await Promise.all(people.map((who, i) => submit(w, who, loaded[i], bodies[i])));
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [303, 409, 409], `round ${round}`);
    const winner = results.findIndex((r) => r.status === 303);
    const stored = answers(w, alpha.id);
    assert.equal(stored.legal, bodies[winner].legal);
    assert.equal(stored.operating, bodies[winner].operating);
    assert.equal(stored.about, bodies[winner].about, "every answer comes from the same submission");
    assert.equal(audits(w, alpha.id), 1, "one successful write, one audit entry");
  }
});

test("repository level: many concurrent saves from one revision write at most once", async () => {
  const { w, alpha, uid } = await setup();
  const rev = await getStepRevision(w.db, alpha.id, "business");
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => saveProfileStep(w.db, alpha.id, uid("ann@alpha.test"), "business", { legal: "L" + i, about: "A" + i }, { now: w.clock.now(), expectedRevision: rev })));
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual([...new Set(results.filter((r) => !r.ok).map((r) => r.error))], ["conflict"]);
  assert.equal(audits(w, alpha.id), 1);
});

test("ATOMIC at the database: a competing save that lands between our read and our batch makes our batch write nothing", async () => {
  const { w, alpha, uid } = await setup();
  const ann = uid("ann@alpha.test"), mia = uid("mia@alpha.test");
  const rev = await getStepRevision(w.db, alpha.id, "business");
  const real = w.db;
  let injected = false;
  const racing = new Proxy(real, { get(target, prop) {
    if (prop === "batch") return async (statements) => {
      if (!injected) { injected = true; await saveProfileStep(real, alpha.id, mia, "business", { legal: "Mia was first", about: "Mia" }, { now: w.clock.now(), expectedRevision: rev }); }
      return real.batch(statements);
    };
    const v = target[prop]; return typeof v === "function" ? v.bind(target) : v;
  } });
  const mine = await saveProfileStep(racing, alpha.id, ann, "business", { legal: "Ann", operating: "Ann Op", about: "Ann" }, { now: w.clock.now(), expectedRevision: rev });
  assert.equal(mine.ok, false); assert.equal(mine.error, "conflict");
  assert.deepEqual(answers(w, alpha.id), { legal: "Mia was first", about: "Mia" }, "none of Ann's statements wrote anything");
  assert.equal(audits(w, alpha.id), 1);
  assert.deepEqual(mine.currentValues, { legal: "Mia was first", operating: "", industry: "", about: "Mia" }, "the refusal reports the latest saved values");
  assert.equal(mine.revision, await getStepRevision(w.db, alpha.id, "business"));
});

test("the guard is in the SQL itself: every write statement and the audit entry carry the revision condition, and the audit entry is last", () => {
  const src = read("worker/portal/repo/business-profile.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const save = src.slice(src.indexOf("export async function saveProfileStep"));
  assert.match(save, /DELETE FROM business_profile_answers WHERE organization_id = \? AND field_id = \? AND \$\{guard\}/);
  assert.match(save, /SELECT \?, \?, \?, \?, \?, \? WHERE \$\{guard\} /);
  assert.match(save, /SELECT \?, \?, 'client', \?, 'profile\.updated', 'profile', \?, \?, 'internal', \? WHERE \$\{guard\}/);
  assert.ok(save.indexOf("statements.push(") < save.indexOf("await db.batch(statements)"), "the audit statement is appended after the answer statements");
  assert.match(save, /results\[results\.length - 1\]\.meta\.changes !== 1/);
  assert.match(src, /ORDER BY rowid DESC LIMIT 1/);
});

/* ------------------------------------------------------------------ revision semantics */

test("the revision moves exactly when a step's saved answers change: not for no-ops or other steps, yes for edits and for clearing an answer", async () => {
  const { w, alpha, ann } = await setup();
  const rev = (step = "business") => getStepRevision(w.db, alpha.id, step);
  const r0 = await rev();
  assert.equal(r0, "");
  const first = await open(ann); await submit(w, ann, first, ANN);
  const r1 = await rev();
  assert.notEqual(r1, r0);
  const noop = await open(ann); assert.equal(noop.rev, r1, "the form carries the current revision");
  assert.equal(loc(await submit(w, ann, noop, ANN, { over: { intent: "save" } })), `${BASE}/business?saved=0`);
  assert.equal(await rev(), r1, "an unchanged save does not move it");
  const other = await open(ann, "location"); await submit(w, ann, other, { city: "Calgary", size: "2 to 10 people" }, { step: "location" });
  assert.equal(await rev(), r1, "saving ANOTHER step does not invalidate this one");
  assert.notEqual(await rev("location"), "");
  const edit = await open(ann); assert.equal(loc(await submit(w, ann, edit, { ...ANN, about: "" })), `${BASE}/business?saved=1`);
  const r2 = await rev(); assert.notEqual(r2, r1, "clearing an answer is a change");
  assert.equal(answers(w, alpha.id).about, undefined);
  // another organization's saves never touch this organization's revision
  assert.equal(await getStepRevision(w.db, w.db.raw.prepare("SELECT id FROM organizations WHERE slug='beta'").get().id, "business"), "");
});

test("an unchanged (identical) submission from a stale form is a harmless no-op, not a conflict; a stale form that would change anything is refused", async () => {
  const { w, alpha, ann, mia } = await setup();
  const forMia = await open(mia);
  await submit(w, ann, await open(ann), ANN);
  const same = await submit(w, mia, forMia, { ...ANN, intent: "continue" });
  assert.equal(same.status, 303, "the values equal what is saved: nothing to protect");
  assert.equal(loc(same), `${BASE}/location`);
  assert.equal(audits(w, alpha.id), 1);
  const differs = await submit(w, mia, forMia, { ...ANN, legal: "Different" });
  assert.equal(differs.status, 409);
  assert.equal(answers(w, alpha.id).legal, "Acme Co. Ltd.");
});

test("a missing, empty-when-not-empty or malformed revision is never trusted: the save is refused and nothing is written", async () => {
  const { w, alpha, ann } = await setup();
  await submit(w, ann, await open(ann), ANN);
  const snapshot = JSON.stringify(sql(w.db, "SELECT * FROM business_profile_answers ORDER BY field_id")), auditBefore = audits(w, alpha.id);
  const loaded = await open(ann);
  const noRev = await handlePortal(new Request(ORIGIN + `${BASE}/business`, { method: "POST", body: form({ csrf: loaded.csrf, ...ANN, legal: "Changed" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: ann.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(noRev.status, 409, "an old cached page without the field cannot overwrite");
  for (const bad of ["", "x", "not-a-uuid", "' OR 1=1 --", "0".repeat(36), loaded.rev.toUpperCase(), loaded.rev + "0", "<script>"]) {
    const r = await submit(w, ann, loaded, { ...ANN, legal: "Changed" }, { over: { rev: bad } });
    assert.equal(r.status, 409, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify(sql(w.db, "SELECT * FROM business_profile_answers ORDER BY field_id")), snapshot);
  assert.equal(audits(w, alpha.id), auditBefore);
  assert.equal((await submit(w, ann, loaded, { ...ANN, legal: "Changed" })).status, 303, "the genuine revision works");
});

test("losing the newest audit entry can only cause a refusal, never an unnoticed overwrite", async () => {
  const { w, alpha, ann } = await setup();
  await submit(w, ann, await open(ann), ANN);
  const loaded = await open(ann);
  w.db.raw.prepare("DELETE FROM activity_log WHERE organization_id = ? AND action = 'profile.updated'").run(alpha.id);
  const r = await submit(w, ann, loaded, { ...ANN, legal: "After log loss" });
  assert.equal(r.status, 409);
  assert.equal(answers(w, alpha.id).legal, "Acme Co. Ltd.");
});

/* ------------------------------------------------------------------ the other protections still come first / still hold */

test("Save and continue, Save changes, Previous and validation keep working with the revision", async () => {
  const { w, alpha, ann } = await setup();
  const a = await open(ann);
  assert.equal(loc(await submit(w, ann, a, ANN, { over: { intent: "continue" } })), `${BASE}/location`);
  const b = await open(ann);
  assert.match(b.html, /name="rev" value="[0-9a-f-]{36}"/, "a saved step carries a real revision");
  assert.equal(loc(await submit(w, ann, b, { ...ANN, about: "More" }, { over: { intent: "save" } })), `${BASE}/business?saved=1`);
  assert.match(b.html, /href="\/portal\/o\/alpha\/profile\/location"|All steps|Previous/);
  // invalid input (422) keeps the SAME revision in the page, so a conflict is still detected on the retry
  const c = await open(ann);
  const invalid = await submit(w, ann, c, { ...ANN, about: "x".repeat(2001) });
  assert.equal(invalid.status, 422);
  assert.equal(revOf(await invalid.text()), c.rev);
  assert.ok(alpha);
});

test("CSRF is checked before anything else (no conflict details leak), a removed member and another organization's member get nothing", async () => {
  const { w, alpha, ann, mia, bob } = await setup();
  const stale = await open(mia);
  await submit(w, ann, await open(ann), ANN);
  const forged = await submit(w, mia, { ...stale, csrf: "forged" }, { legal: "x" });
  assert.equal(forged.status, 403);
  const body = await forged.text();
  assert.ok(!/currently saved|This section changed|Acme/.test(body), "a forged request learns nothing about the saved answers");
  const crossOrg = await handlePortal(new Request(ORIGIN + `${BASE}/business`, { method: "POST", body: form({ csrf: csrfOf(await (await bob.get("/portal/o/beta/profile/business")).text()), rev: stale.rev, legal: "Hijack" }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: bob.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
  assert.equal(crossOrg.status, 404);
  w.db.raw.prepare("UPDATE memberships SET status = 'revoked', revoked_at = ? WHERE user_id = (SELECT id FROM portal_users WHERE email = 'mia@alpha.test') AND organization_id = ?").run(new Date().toISOString(), alpha.id);
  const removed = await submit(w, mia, stale, { legal: "x" });
  assert.equal(removed.status, 404);
  assert.deepEqual(answers(w, alpha.id), { legal: "Acme Co. Ltd.", industry: "Retail", about: "We sell things." });
});

test("the conflict page escapes saved answers and never echoes markup", async () => {
  const { w, ann, mia, uid, alpha } = await setup();
  const stale = await open(mia);
  await saveProfileStep(w.db, alpha.id, uid("ann@alpha.test"), "business", { legal: "<img src=x onerror=alert(1)>", about: "\"quoted\" & <b>bold</b>" }, { now: w.clock.now() });
  const res = await submit(w, mia, stale, { legal: "<script>alert(2)</script>", operating: "", industry: "", about: "" });
  assert.equal(res.status, 409);
  const html = await res.text();
  assert.ok(!/<img src=x|<script>alert|<b>bold/.test(html));
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /value="&lt;script&gt;alert\(2\)&lt;\/script&gt;"/, "her own typed input is kept, escaped");
  assert.ok(ann);
});

test("a long saved answer is shortened in the notice only; nothing else about the page changes for a normal (non-conflict) load", async () => {
  const { w, ann, mia, uid, alpha } = await setup();
  const stale = await open(mia);
  await saveProfileStep(w.db, alpha.id, uid("ann@alpha.test"), "business", { about: "w".repeat(1500) }, { now: w.clock.now() });
  const html = await (await submit(w, mia, stale, { about: "mine" })).text();
  assert.match(html, /currently saved as “w{160}…”/);
  const normal = await (await ann.get(`${BASE}/business`)).text();
  assert.ok(!/data-error-summary|This section changed/.test(normal));
  assert.match(normal, /name="rev"/);
});
