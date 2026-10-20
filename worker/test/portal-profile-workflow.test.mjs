// Phase 6C: the Business Profile workflow. "Save and continue" / "Save changes", truthful confirmations (nothing is written, and nothing is claimed,
// when nothing changed), the overview's Continue action and required-answer counts, button order, and that CSRF, tenant isolation and CSP are unchanged.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf, revOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { handlePortal } from "../portal/router.js";
import { PROFILE_STEPS } from "../portal/profile-schema.js";
import { PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const form = (o) => new URLSearchParams(o).toString();
const BASE = "/portal/o/alpha/profile";
const BUSINESS = { legal: "Acme Co. Ltd.", operating: "", industry: "Retail", about: "We sell things." };

async function setup() {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  return { w, alpha, beta, ann, mia, bob };
}
async function post(w, who, slug, step, fields, { csrf } = {}) {
  const path = `/portal/o/${slug}/profile/${step}`;
  const page = await (await who.get(path)).text();
  return handlePortal(new Request(ORIGIN + path, { method: "POST", body: form({ csrf: csrf ?? csrfOf(page), rev: revOf(page), ...fields }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: who.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
}
const answers = (w, orgId) => Object.fromEntries(sql(w.db, "SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?", orgId).map((r) => [r.field_id, r.value]));
const audits = (w, orgId) => sql(w.db, "SELECT detail FROM activity_log WHERE organization_id = ? AND action = 'profile.updated'", orgId).length;
const loc = (res) => res.headers.get("Location");
const strip = (html) => html.replace(/<form method="post" action="\/portal\/logout"[\s\S]*?<\/form>/, "");

/* ------------------------------------------------------------------ Save and continue */

test("Save and continue saves, then goes to the NEXT step; every step leads to its successor and the last one returns to the overview", async () => {
  const { w, alpha, ann } = await setup();
  const res = await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "continue" });
  assert.equal(res.status, 303);
  assert.equal(loc(res), `${BASE}/location`);
  assert.deepEqual(answers(w, alpha.id), { legal: "Acme Co. Ltd.", industry: "Retail", about: "We sell things." });
  for (const [i, s] of PROFILE_STEPS.entries()) {
    const r = await post(w, ann, "alpha", s.id, { intent: "continue" });
    assert.equal(r.status, 303, s.id);
    assert.equal(loc(r), PROFILE_STEPS[i + 1] ? `${BASE}/${PROFILE_STEPS[i + 1].id}` : BASE, `${s.id} continues to ${PROFILE_STEPS[i + 1]?.id || "the overview"}`);
  }
});

test("final step: Save and finish saves, returns to the overview, and the overview reflects the saved answers", async () => {
  const { w, alpha, ann } = await setup();
  const res = await post(w, ann, "alpha", "personality", { words: "warm, honest, crafted", tone: "Friendly and relaxed", position: "", intent: "continue" });
  assert.equal(loc(res), BASE);
  assert.equal(answers(w, alpha.id).words, "warm, honest, crafted");
  const html = await (await ann.get(BASE)).text();
  assert.match(html, /1 of 7 steps complete/);
  const last = await (await ann.get(`${BASE}/personality`)).text();
  assert.match(last, />Save and finish<\/button>/);
  assert.ok(!/>Save and continue</.test(last));
  assert.match(await (await ann.get(`${BASE}/goals`)).text(), />Save and continue<\/button>/);
});

test("partial answers are saved and the person still continues (required questions never block)", async () => {
  const { w, alpha, ann } = await setup();
  const res = await post(w, ann, "alpha", "business", { legal: "Acme", operating: "", industry: "", about: "", intent: "continue" });
  assert.equal(loc(res), `${BASE}/location`);
  assert.deepEqual(answers(w, alpha.id), { legal: "Acme" });
});

/* ------------------------------------------------------------------ Save changes */

test("Save changes stays on the step, keeps the values, and confirms accurately", async () => {
  const { w, alpha, ann } = await setup();
  const res = await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" });
  assert.equal(res.status, 303);
  assert.equal(loc(res), `${BASE}/business?saved=1`);
  const html = await (await ann.get(loc(res))).text();
  assert.match(html, /<p class="form-banner" role="status">Saved\. This step is complete\.<\/p>/);
  assert.match(html, /value="Acme Co\. Ltd\."/);
  assert.equal(answers(w, alpha.id).legal, "Acme Co. Ltd.");
  const partial = await post(w, ann, "alpha", "location", { city: "Calgary", area: "", size: "", intent: "save" });
  assert.equal(loc(partial), `${BASE}/location?saved=1`);
  assert.match(await (await ann.get(loc(partial))).text(), /Saved\. 1 required answer is still needed to complete this step\./);
});

test("a missing or unknown intent behaves like Save changes (it never navigates away)", async () => {
  const { w, ann } = await setup();
  for (const intent of [undefined, "", "continue ", "CONTINUE", "next", "../../account", "save"]) {
    const r = await post(w, ann, "alpha", "business", intent === undefined ? BUSINESS : { ...BUSINESS, intent });
    assert.equal(r.status, 303);
    assert.match(loc(r), /^\/portal\/o\/alpha\/profile\/business\?saved=[01]$/, JSON.stringify(intent));
  }
});

test("an unchanged submission writes nothing and says so: no rows, no audit entry, no 'Saved.'", async () => {
  const { w, alpha, ann } = await setup();
  assert.equal(loc(await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" })), `${BASE}/business?saved=1`);
  const rowsBefore = sql(w.db, "SELECT field_id, value, updated_at, updated_by FROM business_profile_answers ORDER BY field_id");
  const auditBefore = audits(w, alpha.id);
  w.clock.advance(60);
  const again = await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" });
  assert.equal(loc(again), `${BASE}/business?saved=0`);
  assert.deepEqual(sql(w.db, "SELECT field_id, value, updated_at, updated_by FROM business_profile_answers ORDER BY field_id"), rowsBefore, "nothing rewritten");
  assert.equal(audits(w, alpha.id), auditBefore, "no audit entry for a no-op");
  const html = await (await ann.get(loc(again))).text();
  assert.match(html, /No changes to save\. Your answers on this step are already up to date\. This step is complete\./);
  assert.ok(!/Saved\./.test(html));
  // whitespace-only differences normalise to the same stored value, so they are unchanged too
  const spaced = await post(w, ann, "alpha", "business", { ...BUSINESS, legal: "  Acme Co. Ltd.  ", intent: "save" });
  assert.equal(loc(spaced), `${BASE}/business?saved=0`);
});

test("saving an untouched empty step is also 'no changes' and creates nothing; changing or clearing one answer writes only that answer", async () => {
  const { w, alpha, ann } = await setup();
  const empty = await post(w, ann, "alpha", "goals", { goals: "", competitors: "", intent: "save" });
  assert.equal(loc(empty), `${BASE}/goals?saved=0`);
  assert.equal(sql(w.db, "SELECT 1 FROM business_profile_answers").length, 0);
  assert.equal(audits(w, alpha.id), 0);
  await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" });
  const before = Object.fromEntries(sql(w.db, "SELECT field_id, updated_at FROM business_profile_answers").map((r) => [r.field_id, r.updated_at]));
  w.clock.advance(120);
  const edit = await post(w, ann, "alpha", "business", { ...BUSINESS, about: "", intent: "save" });
  assert.equal(loc(edit), `${BASE}/business?saved=1`, "clearing an answer is a change");
  assert.equal(answers(w, alpha.id).about, undefined);
  const after = Object.fromEntries(sql(w.db, "SELECT field_id, updated_at FROM business_profile_answers").map((r) => [r.field_id, r.updated_at]));
  assert.deepEqual(after, Object.fromEntries(Object.entries(before).filter(([k]) => k !== "about")), "the untouched answers were not rewritten");
  assert.equal(audits(w, alpha.id), 2);
});

test("a repeated submission (double click) is harmless: the second one changes nothing and adds no audit entry", async () => {
  const { w, alpha, ann } = await setup();
  const page = await (await ann.get(`${BASE}/business`)).text();
  const csrf = csrfOf(page);
  const a = await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "continue" }, { csrf });
  const b = await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "continue" }, { csrf });
  assert.equal(loc(a), `${BASE}/location`); assert.equal(loc(b), `${BASE}/location`);
  assert.equal(audits(w, alpha.id), 1);
  assert.equal(sql(w.db, "SELECT 1 FROM business_profile_answers").length, 3);
});

/* ------------------------------------------------------------------ invalid, CSRF, isolation */

test("an invalid submission stays on the step with the Phase 6B summary, keeps every typed value, saves nothing and does not advance", async () => {
  const { w, alpha, ann } = await setup();
  for (const intent of ["continue", "save"]) {
    const res = await post(w, ann, "alpha", "contact", { cname: "Ann <b>", crole: "Owner", cemail: "not-an-email", cphone: "12", intent });
    assert.equal(res.status, 422, intent);
    assert.equal(res.headers.get("Location"), null);
    const html = await res.text();
    assert.match(html, /data-error-summary/);
    assert.deepEqual([...html.matchAll(/<a href="#(p-contact-[a-z]+)">/g)].map((m) => m[1]), ["p-contact-cemail", "p-contact-cphone"]);
    assert.match(html, /value="Ann &lt;b&gt;"/); assert.match(html, /value="not-an-email"/); assert.match(html, /value="12"/); assert.match(html, /value="Owner"/);
    assert.ok(!html.includes("form-banner\" role=\"status\""), "no success message on a refusal");
    assert.match(html, /name="intent" value="continue"/, "the buttons are still there to try again");
    assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP_WITH_SCRIPT);
  }
  assert.equal(sql(w.db, "SELECT 1 FROM business_profile_answers").length, 0);
  assert.equal(audits(w, alpha.id), 0);
});

test("CSRF: a missing, forged or wrong-session token is refused for both buttons and nothing is saved", async () => {
  const { w, alpha, ann, mia } = await setup();
  const miaToken = csrfOf(await (await mia.get(`${BASE}/business`)).text());
  for (const intent of ["continue", "save"]) {
    for (const csrf of ["", "forged", miaToken]) {
      const r = await post(w, ann, "alpha", "business", { ...BUSINESS, intent }, { csrf });
      assert.equal(r.status, 403, `${intent} / ${JSON.stringify(csrf).slice(0, 12)}`);
      assert.equal(r.headers.get("Location"), null);
    }
  }
  assert.equal(sql(w.db, "SELECT 1 FROM business_profile_answers").length, 0);
  assert.equal(audits(w, alpha.id), 0);
});

test("organization isolation: another organization's member cannot save into or continue through alpha's profile; their own save lands in their own organization only", async () => {
  const { w, alpha, beta, ann, bob } = await setup();
  await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" });
  const snapshot = JSON.stringify(sql(w.db, "SELECT * FROM business_profile_answers ORDER BY organization_id, field_id"));
  const token = csrfOf(await (await bob.get("/portal/o/beta/profile/business")).text());
  for (const intent of ["continue", "save"]) {
    const r = await handlePortal(new Request(ORIGIN + `${BASE}/business`, { method: "POST", body: form({ csrf: token, ...BUSINESS, legal: "Hijacked", intent }), headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: bob.cookieHeader(), Origin: ORIGIN } }), w.env, { now: w.clock.now() });
    assert.equal(r.status, 404, intent);
  }
  assert.equal(JSON.stringify(sql(w.db, "SELECT * FROM business_profile_answers ORDER BY organization_id, field_id")), snapshot);
  const own = await post(w, bob, "beta", "business", { legal: "Beta Ltd", intent: "continue" });
  assert.equal(loc(own), "/portal/o/beta/profile/location");
  assert.equal(answers(w, beta.id).legal, "Beta Ltd");
  assert.equal(answers(w, alpha.id).legal, "Acme Co. Ltd.");
  assert.equal((await bob.get(`${BASE}/business?saved=1`)).status, 404);
});

test("only ?saved=1 and ?saved=0 produce a note, and the note never contains anything from the URL", async () => {
  const { ann } = await setup();
  const get = async (q) => strip(await (await ann.get(`${BASE}/business${q}`)).text());
  assert.match(await get("?saved=1"), /role="status">Saved\./);
  assert.match(await get("?saved=0"), /No changes to save/);
  for (const q of ["", "?saved=2", "?saved=true", "?saved=<script>", "?saved=1&saved=0x"]) {
    const html = await get(q);
    if (q === "?saved=1&saved=0x") continue;
    assert.ok(!/form-banner/.test(html), q);
    assert.ok(!html.includes("<script>"), q);
  }
});

/* ------------------------------------------------------------------ markup, order, unsaved-changes guard */

test("action order is Save and continue, Save changes, then Previous as a text link (and All steps on the first step); no Next link, no native required", async () => {
  const { ann } = await setup();
  for (const [i, s] of PROFILE_STEPS.entries()) {
    const html = await (await ann.get(`${BASE}/${s.id}`)).text();
    const nav = html.match(/<div class="step-nav">[\s\S]*?<\/div><\/form>/)[0];
    const order = [...nav.matchAll(/<(button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, "").trim());
    assert.deepEqual(order, [i === PROFILE_STEPS.length - 1 ? "Save and finish" : "Save and continue", "Save changes", i === 0 ? "← All steps" : "← Previous"], s.id);
    assert.match(nav, /^<div class="step-nav"><button class="btn btn--primary" type="submit" name="intent" value="continue" data-save>/, "the primary button is first, so Enter in a text box means Save and continue");
    assert.match(nav, /<button class="btn" type="submit" name="intent" value="save" data-save>Save changes<\/button>/);
    assert.match(nav, /<a class="step-nav__back text-link" href="\/portal\/o\/alpha\/profile(\/[a-z]+)?">/);
    assert.ok(!/>Next/.test(nav) && !/btn btn--primary" type="submit" data-save>Save</.test(nav));
    assert.ok(!/<(input|textarea|select)\b[^>]*\srequired(\s|=|>)/.test(html));
    assert.equal([...nav.matchAll(/type="submit"/g)].length, 2);
    assert.match(html, /<form method="post"[^>]*data-guard novalidate>/);
  }
  const first = await (await ann.get(`${BASE}/business`)).text();
  assert.match(first, /href="\/portal\/o\/alpha\/profile"><span aria-hidden="true">←<\/span> All steps/);
  assert.match(await (await ann.get(`${BASE}/location`)).text(), /href="\/portal\/o\/alpha\/profile\/business"><span aria-hidden="true">←<\/span> Previous/);
});

test("Previous is a plain link: it never submits or saves, and the unsaved-changes warning still guards it", () => {
  const js = read("assets/js/portal-profile.js");
  assert.match(js, /addEventListener\("beforeunload"/);
  assert.match(js, /if \(dirty && !submitting\)/);
  assert.match(js, /event\.preventDefault\(\);\s*event\.returnValue = ""/);
  assert.match(js, /addEventListener\("input"/);
  assert.ok(!/step-nav__back|addEventListener\("click"/.test(js), "no script on the Previous link: it navigates, it does not save");
});

test("duplicate submissions are blocked in the page and the submitting button says so", () => {
  const js = read("assets/js/portal-profile.js");
  assert.match(js, /if \(submitting\) \{ event\.preventDefault\(\); return; \}/);
  assert.match(js, /event\.submitter/);
  assert.match(js, /pageshow/);
  assert.match(js, /data-busy/);
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|eval\(|innerHTML/.test(js));
});

/* ------------------------------------------------------------------ overview */

test("overview: a Start/Continue action points at the first step that still lacks a REQUIRED answer, and incomplete steps say how many are left", async () => {
  const { w, ann } = await setup();
  const fresh = await (await ann.get(BASE)).text();
  assert.match(fresh, /<p class="progress-next"><a class="btn btn--primary" href="\/portal\/o\/alpha\/profile\/business">Start: Your business <span aria-hidden="true">→<\/span><\/a><\/p>/);
  assert.match(fresh, /class="rowstat">3 required answers left</);
  assert.match(fresh, /class="rowstat">1 required answer left</, "goals has one required question");
  await post(w, ann, "alpha", "business", { ...BUSINESS, intent: "save" });
  await post(w, ann, "alpha", "location", { city: "Calgary", area: "", size: "", intent: "save" });
  const mid = await (await ann.get(BASE)).text();
  assert.match(mid, /href="\/portal\/o\/alpha\/profile\/location">Continue: Location and size /);
  assert.match(mid, /class="rowstat">In progress · 1 required answer left</);
  assert.match(mid, /class="rowstat">Complete</);
  assert.equal([...mid.matchAll(/progress-next"><a/g)].length, 1, "exactly one Continue action");
  // skip past a complete first step: the action moves on
  await post(w, ann, "alpha", "location", { city: "Calgary", area: "", size: "2 to 10 people", intent: "save" });
  assert.match(await (await ann.get(BASE)).text(), /Continue: Products, services and customers/);
});

test("overview: once every REQUIRED answer is in there is no Continue action, and optional steps are not presented as mandatory", async () => {
  const { w, ann } = await setup();
  const ALL = {
    business: BUSINESS, location: { city: "Calgary", area: "", size: "2 to 10 people" }, offering: { offer: "Widgets", customers: "People" }, goals: { goals: "Grow", competitors: "" },
    contact: { cname: "Ann", crole: "", cemail: "ann@acme.example", cphone: "" }, personality: { words: "warm, honest, crafted", tone: "Friendly and relaxed", position: "" },
  };
  for (const [step, fields] of Object.entries(ALL)) await post(w, ann, "alpha", step, { ...fields, intent: "save" });
  const html = await (await ann.get(BASE)).text();
  assert.match(html, /6 of 7 steps complete/);
  assert.ok(!/progress-next"><a/.test(html), "no Continue action");
  assert.match(html, /All required answers are complete\. The remaining steps are optional: add to them whenever it helps\./);
  assert.ok(!/required answers? left/.test(html), "the optional Online presence step is not flagged");
  await post(w, ann, "alpha", "online", { site: "acme.example", social: "", intent: "save" });
  const done = await (await ann.get(BASE)).text();
  assert.match(done, /7 of 7 steps complete/);
  assert.match(done, /All required answers are complete\.<\/p>/);
  assert.ok(!done.includes("remaining steps are optional"));
});

/* ------------------------------------------------------------------ mobile layout (rules; the rendering is checked in Chromium) */

test("narrow screens: the actions stack full width in reading order, Previous is a quiet 44px text link, nothing can overflow", () => {
  const css = read("assets/css/portal.css");
  const mobile = css.match(/@media \(max-width: 560px\) \{\s*\.step-nav \.btn \{ flex: 1 1 100%; \}[\s\S]*?\n\}/)[0];
  assert.match(mobile, /\.step-nav__back \{[^}]*flex: 1 1 100%;[^}]*justify-content: center/);
  assert.match(mobile, /\.step-nav \.btn\[data-busy\] \{ order: 0; \}/, "the saving state does not reorder the buttons");
  assert.match(css, /\.step-nav__back \{[^}]*min-height: 44px/);
  assert.match(css, /\.btn \{[^}]*min-height: 48px/);
  assert.ok(!/\.step-nav[^{]*\{[^}]*order:\s*-/.test(css), "no visual reordering away from the tab order");
  assert.match(css, /\.step-nav \{ display: flex; flex-wrap: wrap;/);
});
