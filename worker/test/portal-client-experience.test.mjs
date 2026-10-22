// Final Beta 1.0 client experience: the dashboard's first-run and completion messaging, the four optional "what you want from Framework" questions in the
// Goals step (they never change completion), and the navigation clean-up (no dead links, no obsolete destinations, owner-only items hidden from members).
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, csrfOf, revOf } from "./helpers/portal-e2e.mjs";
import { PROFILE_STEPS, profileProgress, validateStep, validateAnswer, fieldDef, SERVICES, START_WINDOWS, BUDGETS, BRAND_MATERIALS, MULTI_SEP } from "../portal/profile-schema.js";
import { validPageKey, pageLabel, feedbackPageChoices, FEEDBACK_PAGES } from "../portal/repo/portal-feedback.js";
import { can } from "../portal/policy.js";

const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const text = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const ALL = PROFILE_STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.id })));
const NEW_IDS = ["services", "timeline", "budget", "assets", "assetsnote"];
const LEGACY_IDS = ALL.map((f) => f.id).filter((id) => !NEW_IDS.includes(id));
const REQUIRED = ALL.filter((f) => f.required);
const sample = (f) => (f.kind === "multi" ? f.options.slice(0, 2).join(MULTI_SEP) : f.kind === "select" || f.kind === "choice" ? f.options[0] : f.kind === "email" ? "a@b.co" : f.kind === "tel" ? "403-555-0100" : f.kind === "website" ? "example.com" : "Sample answer");

async function setup({ orgName = "Alpha Co" } = {}) {
  const w = await makeWorld();
  const alpha = await w.org("alpha", orgName), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  for (const [b, u] of [[ann, w.user(1, "ann@alpha.test")], [mia, w.user(3, "mia@alpha.test")], [bob, w.user(2, "bob@beta.test")]]) assert.equal((await b.signIn(u)).status, 303);
  const get = async (b, path) => (await b.get(path)).text();
  // save a step the way a client does: the real form, with its CSRF token and revision; `fields` maps field names (checkbox names included) to values
  const save = async (b, slug, step, fields, intent = "save") => {
    const page = await get(b, `/portal/o/${slug}/profile/${step}`);
    return b.post(`/portal/o/${slug}/profile/${step}`, { csrf: csrfOf(page), rev: revOf(page), intent, ...fields });
  };
  const saveFields = async (b, slug, defs) => { for (const s of PROFILE_STEPS) { const input = Object.fromEntries(defs.filter((f) => f.step === s.id).map((f) => [f.id, sample(f)])); if (Object.keys(input).length) { const r = await save(b, slug, s.id, formFields(s, input)); assert.equal(r.status, 303, s.id); } } };
  return { w, alpha, beta, ann, mia, bob, get, save, saveFields, answers: (org) => Object.fromEntries(sql(w.db, "SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?", org.id).map((r) => [r.field_id, r.value])) };
}
/** answers by question id -> the names the form submits (a multiple-choice answer becomes one named checkbox per chosen option) */
function formFields(step, input) {
  const out = {};
  for (const d of step.fields) {
    if (!(d.id in input)) continue;
    if (d.kind === "multi") String(input[d.id]).split(MULTI_SEP).filter(Boolean).forEach((o) => { out[`${d.id}__${d.options.indexOf(o)}`] = o; });
    else out[d.id] = input[d.id];
  }
  return out;
}
const goals = PROFILE_STEPS.find((s) => s.id === "goals");

/* ------------------------------------------------------------------ 1. dashboard messaging */

test("dashboard, brand-new client: organization name, welcome, one prominent action, ~20-30 minutes, progress is saved, what happens next", async () => {
  const s = await setup();
  const html = await s.get(s.ann, "/portal/o/alpha");
  assert.match(html, /<span class="eyebrow">Alpha Co<\/span><h1 class="h1 h1--home">/);
  assert.match(html, /Start your Business Profile/);
  assert.equal([...html.matchAll(/class="btn btn--primary"/g)].length, 1);
  const note = (/<p class="home-note">([^<]*)<\/p>/.exec(html) || [])[1];
  assert.equal(note, "It takes about 20–30 minutes. Your progress is saved as you go, so you can stop and come back whenever you like. When you finish, the Framework team will review your answers and follow up with you.");
  assert.match(html, /0% complete/);
  assert.match(html, /12 required answers left/, "the existing progress indicator is unchanged");
  assert.match(html, /<h2 id="h-soon"[^>]*>Coming soon<\/h2>/, "the other modules stay a plain Coming soon list");
});

test("dashboard, in progress: resume wording, progress is saved, what happens next; no time estimate on a return visit", async () => {
  const s = await setup();
  await s.saveFields(s.ann, "alpha", ALL.filter((f) => f.step === "business"));
  const html = await s.get(s.ann, "/portal/o/alpha");
  assert.match(html, /Pick up where you left off\./);
  assert.match(html, /Continue your Business Profile/);
  assert.match(html, /<p class="home-note">Your progress is saved, so you can finish later\. When you finish, the Framework team will review your answers and follow up with you\.<\/p>/);
  assert.ok(!/20–30/.test(html));
});

test("dashboard, complete: the approved acknowledgement, the review link stays, editing stays possible; the same for 'required done, optional left'", async () => {
  const s = await setup();
  await s.saveFields(s.ann, "alpha", REQUIRED);
  let html = await s.get(s.ann, "/portal/o/alpha");
  const MSG = "Your Business Profile is complete. The Framework team will review your information and follow up with you about the next steps.";
  assert.ok(text(html).includes(MSG));
  assert.match(html, /<a class="text-link" href="\/portal\/o\/alpha\/profile">Review your Business Profile/);
  assert.match(html, /<p class="home-note">Optional details can be added any time, and you can change your answers whenever you like\.<\/p>/);
  assert.ok(!/btn btn--primary/.test(html), "nothing is demanded once the required answers are in");
  await s.saveFields(s.ann, "alpha", ALL);
  html = await s.get(s.ann, "/portal/o/alpha");
  assert.ok(text(html).includes(MSG));
  assert.match(html, /<p class="home-note">You can change your answers any time\.<\/p>/);
  assert.match(html, /100% complete/);
  const overview = await s.get(s.ann, "/portal/o/alpha/profile");
  assert.match(overview, /href="\/portal\/o\/alpha\/profile\/business"/, "every step remains reachable and editable");
});

test("dashboard: the organization name is escaped, and a member sees the same Home as an owner", async () => {
  const s = await setup({ orgName: `<img src=x onerror=alert(1)> & Co` });
  const html = await s.get(s.mia, "/portal/o/alpha");
  assert.ok(!html.includes("<img src=x"), "no markup from the name");
  assert.match(html, /<span class="eyebrow">&lt;img src=x onerror=alert\(1\)&gt; &amp; Co<\/span>/);
  assert.match(html, /Start your Business Profile/);
});

/* ------------------------------------------------------------------ 2. the four optional questions */

test("Goals step: the four optional questions (and the details field) exist with the approved options, in the approved kinds, all optional", () => {
  const ids = goals.fields.map((f) => f.id);
  assert.deepEqual(ids, ["goals", "competitors", "services", "timeline", "budget", "assets", "assetsnote"], "the seven-step structure is unchanged; only the Goals step grew");
  assert.equal(PROFILE_STEPS.length, 7);
  const d = (id) => fieldDef(id);
  assert.deepEqual([d("services").label, d("services").kind, [...d("services").options]], ["What services are you interested in?", "multi", ["Branding", "Website Design & Development", "Marketing", "Content & Photography", "Not sure yet"]]);
  assert.deepEqual([d("timeline").label, d("timeline").kind, [...d("timeline").options]], ["When are you hoping to get started?", "select", ["As soon as possible", "Within 1 month", "Within 1–3 months", "Just exploring"]]);
  assert.deepEqual([d("budget").label, d("budget").kind], ["Do you have a budget in mind?", "select"]);
  assert.ok(d("budget").options.includes("Not sure yet") && d("budget").options.includes("Prefer not to say"), "budget disclosure is never forced");
  assert.deepEqual([d("assets").label, d("assets").kind, [...d("assets").options]], ["Do you have existing brand materials or a website?", "select", ["Yes", "No", "Some"]]);
  assert.equal(d("assetsnote").kind, "textarea");
  for (const id of NEW_IDS) assert.equal(d(id).required, false, id + " is optional");
  assert.deepEqual([SERVICES.length, START_WINDOWS.length, BUDGETS.length, BRAND_MATERIALS.length], [5, 4, 7, 3]);
});

test("Goals step page: labels, one checkbox per service (each with its own name), selects for the others, Optional markers, nothing required but the original goals question", async () => {
  const s = await setup();
  const html = await s.get(s.ann, "/portal/o/alpha/profile/goals");
  for (const f of goals.fields) assert.ok(html.includes(f.label.replace(/&/g, "&amp;")), f.label);
  assert.equal([...html.matchAll(/<input type="checkbox" name="services__\d" value="/g)].length, 5);
  assert.match(html, /<option>Within 1–3 months<\/option>/);
  assert.match(html, /<option>Prefer not to say<\/option>/);
  assert.equal([...html.matchAll(/aria-required="true"/g)].length, 1, "only the original goals question is required");
  assert.equal([...html.matchAll(/class="field__opt">Optional</g)].length, 6, "every other question is marked Optional");
  assert.match(html, /<span class="field__hint" id="p-goals-services-h">Choose all that apply\.<\/span>/);
});

test("saving, reloading and editing the new answers; clearing them; the audit entry carries the step id only", async () => {
  const s = await setup();
  const r = await s.save(s.ann, "alpha", "goals", { goals: "Grow", services__0: "Branding", services__2: "Marketing", timeline: "Within 1 month", budget: "$10,000–$25,000", assets: "Some", assetsnote: "A logo and a 2019 site at example.ca" });
  assert.equal(r.status, 303);
  assert.deepEqual(s.answers(s.alpha), { goals: "Grow", services: "Branding, Marketing", timeline: "Within 1 month", budget: "$10,000–$25,000", assets: "Some", assetsnote: "A logo and a 2019 site at example.ca" });
  let html = await s.get(s.ann, "/portal/o/alpha/profile/goals");
  assert.match(html, /name="services__0" value="Branding" checked/);
  assert.match(html, /name="services__2" value="Marketing" checked/);
  assert.ok(!/name="services__1" value="Website Design &amp; Development" checked/.test(html));
  assert.match(html, /<option selected>Within 1 month<\/option>/);
  assert.match(html, /<option selected>\$10,000–\$25,000<\/option>/);
  assert.match(html, /<option selected>Some<\/option>/);
  assert.match(html, />A logo and a 2019 site at example\.ca<\/textarea>/);
  // edit: change one, add one, clear one
  assert.equal((await s.save(s.ann, "alpha", "goals", { goals: "Grow", services__1: "Website Design & Development", services__4: "Not sure yet", timeline: "Just exploring", budget: "Prefer not to say", assets: "No" })).status, 303);
  assert.deepEqual(s.answers(s.alpha), { goals: "Grow", services: "Website Design & Development, Not sure yet", timeline: "Just exploring", budget: "Prefer not to say", assets: "No" });
  // clear every optional answer: they become unanswered (no empty rows), the required answer stays
  assert.equal((await s.save(s.ann, "alpha", "goals", { goals: "Grow" })).status, 303);
  assert.deepEqual(s.answers(s.alpha), { goals: "Grow" });
  const audit = sql(s.w.db, "SELECT detail FROM activity_log WHERE action = 'profile.updated'").map((x) => JSON.parse(x.detail));
  assert.ok(audit.every((d) => JSON.stringify(Object.keys(d).sort()) === '["step","v"]' && d.step === "goals"), "no answer text in the audit trail");
  assert.ok(!JSON.stringify(sql(s.w.db, "SELECT * FROM activity_log")).includes("2019 site"));
});

test("the new questions validate: tampered options, duplicates and over-long text are refused and nothing is saved; a stale second window is a conflict", async () => {
  const s = await setup();
  const bad = await s.save(s.ann, "alpha", "goals", { goals: "Grow", services__0: "Pirate radio", timeline: "Yesterday", budget: "Free", assets: "Maybe", assetsnote: "x".repeat(2001) });
  assert.equal(bad.status, 303 === bad.status ? bad.status : 422);
  assert.equal(bad.status, 422);
  const page = await bad.text();
  assert.match(page, /Some answers need attention\. Nothing was saved\./);
  assert.deepEqual(s.answers(s.alpha), {}, "nothing was saved, not even the valid answer");
  // the server never trusts the checkbox value: a name with a value that is not that option is ignored, so no tampered service can be stored
  assert.equal((await s.save(s.ann, "alpha", "goals", { goals: "Grow", services__0: "Branding", services__1: "Branding" })).status, 303);
  assert.equal(s.answers(s.alpha).services, "Branding");
  assert.deepEqual(validateAnswer(fieldDef("services"), "Marketing, Branding, Branding"), { value: "Branding, Marketing" }, "duplicates collapse; the options' own order is kept");
  assert.ok(validateAnswer(fieldDef("services"), "Branding,Marketing").error, "only the exact separator is accepted");
  assert.equal(validateStep(goals, {}).values.services, "", "unanswered");
  // two windows: the second save, made from a stale form, is a conflict and overwrites nothing
  const a = await s.get(s.ann, "/portal/o/alpha/profile/goals"), b = await s.get(s.mia, "/portal/o/alpha/profile/goals");
  assert.equal((await s.ann.post("/portal/o/alpha/profile/goals", { csrf: csrfOf(a), rev: revOf(a), intent: "save", goals: "Grow", timeline: "As soon as possible" })).status, 303);
  const stale = await s.mia.post("/portal/o/alpha/profile/goals", { csrf: csrfOf(b), rev: revOf(b), intent: "save", goals: "Grow", timeline: "Just exploring" });
  assert.equal(stale.status, 409);
  assert.equal(s.answers(s.alpha).timeline, "As soon as possible");
});

/* ------------------------------------------------------------------ 3. completion is unchanged */

test("completion and the required count are exactly what they were: the same 12 required questions, and the new answers can never move a percentage", () => {
  assert.deepEqual(REQUIRED.map((f) => f.id), ["legal", "industry", "about", "city", "size", "offer", "customers", "goals", "cname", "cemail", "words", "tone"]);
  // reference implementation of the ORIGINAL rule over the ORIGINAL 20 questions
  const OLD = { business: ["legal", "operating", "industry", "about"], location: ["city", "area", "size"], offering: ["offer", "customers"], goals: ["goals", "competitors"], online: ["site", "social"], contact: ["cname", "crole", "cemail", "cphone"], personality: ["words", "tone", "position"] };
  const OLD_REQ = { business: ["legal", "industry", "about"], location: ["city", "size"], offering: ["offer", "customers"], goals: ["goals"], online: [], contact: ["cname", "cemail"], personality: ["words", "tone"] };
  const reference = (saved) => { const has = (id) => saved[id] !== undefined; const done = Object.keys(OLD).filter((st) => (OLD_REQ[st].length ? OLD_REQ[st].every(has) : OLD[st].some(has))).length; return { done, percent: Math.round((done / 7) * 100) }; };
  assert.equal(LEGACY_IDS.length, 20);
  let seed = 7; const rnd = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  for (let i = 0; i < 400; i++) {
    const saved = {}; for (const id of LEGACY_IDS) if (rnd() < (i % 3 ? 0.7 : 0.3)) saved[id] = "x";
    const p = profileProgress(saved), ref = reference(saved);
    assert.deepEqual([p.done, p.percent], [ref.done, ref.percent], JSON.stringify(Object.keys(saved)));
    // adding ANY of the new optional answers changes neither the percentage, the done steps nor the missing required answers
    const withNew = { ...saved }; for (const id of NEW_IDS) if (rnd() < 0.6) withNew[id] = "x";
    const q = profileProgress(withNew);
    assert.deepEqual([q.done, q.percent], [p.done, p.percent]);
    assert.deepEqual(q.steps.map((x) => x.missingRequired), p.steps.map((x) => x.missingRequired));
  }
  assert.deepEqual([profileProgress({}).percent, profileProgress(Object.fromEntries(REQUIRED.map((f) => [f.id, "x"]))).percent], [0, 86], "the numbers a client already sees");
  assert.deepEqual(NEW_IDS.map((id) => profileProgress({ [id]: "x" }).percent), [0, 0, 0, 0, 0], "answering only the new questions leaves a profile at 0%");
});

test("existing saved profiles are untouched: answers saved before this change load, show their completion, and can still be edited", async () => {
  const s = await setup();
  await s.saveFields(s.ann, "alpha", ALL.filter((f) => !NEW_IDS.includes(f.id))); // exactly what every existing client has: the original 20 questions
  const before = s.answers(s.alpha);
  assert.equal(Object.keys(before).length, 20);
  const home = await s.get(s.ann, "/portal/o/alpha");
  assert.match(home, /100% complete/);
  const html = await s.get(s.ann, "/portal/o/alpha/profile/goals");
  assert.ok(!/name="services__\d" value="[^"]*" checked/.test(html), "new questions start unanswered");
  assert.match(html, />Sample answer<\/textarea>/, "the existing goals answer is shown");
  assert.equal((await s.save(s.ann, "alpha", "goals", { goals: "Sample answer", competitors: "Sample answer", services__3: "Content & Photography" })).status, 303);
  assert.deepEqual(s.answers(s.alpha), { ...before, services: "Content & Photography" }, "only the new answer was added; nothing else changed");
});

/* ------------------------------------------------------------------ 4. organization isolation */

test("isolation: another organization's new answers never appear, and another organization's person cannot read or write them", async () => {
  const s = await setup();
  assert.equal((await s.save(s.ann, "alpha", "goals", { goals: "Grow", services__0: "Branding", budget: "$50,000 or more", assetsnote: "ALPHA-ONLY-NOTE" })).status, 303);
  const bobGoals = await s.get(s.bob, "/portal/o/beta/profile/goals");
  assert.ok(!/ALPHA-ONLY-NOTE|Branding" checked|selected>\$50,000/.test(bobGoals));
  const probe = await s.bob.get("/portal/o/alpha/profile/goals");
  assert.equal(probe.status, 404);
  const own = await s.get(s.bob, "/portal/o/beta/profile/goals");
  const w = await s.bob.post("/portal/o/alpha/profile/goals", { csrf: csrfOf(own), rev: revOf(own), intent: "save", goals: "HIJACK", services__2: "Marketing" });
  assert.equal(w.status, 404);
  assert.deepEqual(s.answers(s.alpha), { goals: "Grow", services: "Branding", budget: "$50,000 or more", assetsnote: "ALPHA-ONLY-NOTE" });
  assert.deepEqual(s.answers(s.beta), {});
});

/* ------------------------------------------------------------------ 5. navigation clean-up */

const hrefs = (html) => [...new Set([...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, "&")))];

test("navigation: no live page links to the demo, and every internal link on every client page is a working destination (owner and member)", async () => {
  const s = await setup();
  await s.saveFields(s.ann, "alpha", ALL.filter((f) => f.step === "business"));
  const pages = ["", "/profile", ...PROFILE_STEPS.map((p) => `/profile/${p.id}`), "/account", "/members", "/feedback", "/branding", "/website", "/marketing", "/content", "/files", "/progress", "/projects", "/activity", "/documents"];
  for (const [who, b] of [["owner", s.ann], ["member", s.mia]]) {
    const seen = new Set();
    for (const p of pages) {
      const res = await b.get(`/portal/o/alpha${p}`);
      if (res.status === 403) { assert.equal(p, "/members", "only the owner-only Team page is refused for a member"); continue; }
      assert.equal(res.status, 200, `${who} ${p}`);
      for (const h of hrefs(await res.text())) if (h.startsWith("/portal")) seen.add(h);
    }
    assert.ok([...seen].every((h) => !h.startsWith("/portal/demo")), `${who}: no link to the demonstration`);
    for (const h of seen) { const r = await b.get(h); assert.ok([200, 303].includes(r.status) || (who === "member" && h.endsWith("/members") && r.status === 403), `${who} link ${h} -> ${r.status}`); }
    if (who === "member") assert.ok(![...seen].some((h) => h.endsWith("/members")), "the owner-only Team page is not offered to a member");
    else assert.ok([...seen].some((h) => h.endsWith("/members")), "the owner is offered Team");
  }
  // nothing in the navigation or on Home points at the four early pages
  const home = await s.get(s.ann, "/portal/o/alpha");
  for (const gone of ["/progress", "/projects", "/activity", "/documents"]) assert.ok(!hrefs(home).some((h) => h.endsWith(gone)), gone + " is not linked from Home");
});

test("navigation: old bookmarks keep working (the four early routes still answer), but the Documents page no longer sends anyone to the demo", async () => {
  const s = await setup();
  for (const p of ["progress", "projects", "activity", "documents"]) for (const b of [s.ann, s.mia]) assert.equal((await b.get(`/portal/o/alpha/${p}`)).status, 200, p);
  const docs = await s.get(s.ann, "/portal/o/alpha/documents");
  assert.ok(!docs.includes("/portal/demo") && !/in the demo/.test(docs));
  assert.match(docs, /Sharing files through the portal isn’t switched on yet/, "the page still says plainly what it is");
  assert.equal((await s.bob.get("/portal/o/alpha/documents")).status, 404, "still protected");
});

test("feedback 'About' menu: only destinations a person can open; Team only for owners; old stored feedback still validates and keeps its label", async () => {
  const s = await setup();
  const options = (html) => [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]);
  const owner = options(await s.get(s.ann, "/portal/o/alpha/feedback")), member = options(await s.get(s.mia, "/portal/o/alpha/feedback"));
  for (const gone of ["progress", "projects", "activity", "documents"]) { assert.ok(!owner.includes(gone) && !member.includes(gone), gone); }
  assert.ok(owner.includes("team") && !member.includes("team"), "Team is owner-only");
  for (const keep of ["home", "profile", "profile-goals", "branding", "website", "marketing", "content", "files", "account"]) assert.ok(owner.includes(keep) && member.includes(keep), keep);
  // compatibility: the stored keys and labels are unchanged, and a form from before the change can still be submitted
  for (const k of ["progress", "projects", "activity", "documents"]) assert.ok(validPageKey(k) && pageLabel(k), k);
  assert.equal(FEEDBACK_PAGES.length, 20);
  assert.deepEqual(feedbackPageChoices("owner", can).map(([k]) => k), owner.filter(Boolean));
  const page = await s.get(s.mia, "/portal/o/alpha/feedback");
  const old = await s.mia.post("/portal/o/alpha/feedback", { csrf: csrfOf(page), kind: "suggestion", message: "From an old bookmarked form", page: "documents" });
  assert.equal(old.status, 303);
  assert.equal(sql(s.w.db, "SELECT page FROM portal_feedback")[0].page, "documents");
});
