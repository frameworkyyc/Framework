// Home dashboard: progress bars, completion percentages and "Action required" indicators (worker/portal/module-status.js, guided.js tileStatus, router Home).
// Covers: the percentage is the existing profileProgress() result (single source of truth), required vs optional logic, organization isolation, rendering,
// accessibility (words carry the meaning), and failure handling (unreadable data is never shown as 0%).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import { PROFILE_STEPS, profileProgress } from "../portal/profile-schema.js";
import { MODULE_STATUS, moduleStatuses } from "../portal/module-status.js";
import { home, tileStatus } from "../portal/guided.js";
import { AREAS, LIVE_AREAS } from "../portal/guided-data.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const ALL = PROFILE_STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.id })));
const REQUIRED = ALL.filter((f) => f.required);
const sample = (f) => (f.kind === "multi" ? f.options.slice(0, 2).join(", ") : f.kind === "select" || f.kind === "choice" ? f.options[0] : f.kind === "email" ? "a@b.co" : f.kind === "tel" ? "403-555-0100" : f.kind === "website" ? "example.com" : "Sample");
const answers = (fields) => Object.fromEntries(fields.map((f) => [f.id, sample(f)]));

/* ------------------------------------------------------------------ calculation: one source of truth */

test("module status IS profileProgress: the percentage, steps done and total always equal the existing calculation (no second implementation)", () => {
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cases = [{}, answers(ALL), answers(REQUIRED), ...ALL.map((f) => answers([f])), ...PROFILE_STEPS.map((s) => answers(ALL.filter((f) => f.step === s.id)))];
  for (let i = 0; i < 300; i++) cases.push(answers(ALL.filter(() => rnd() < 0.5)));
  for (const saved of cases) {
    const ref = profileProgress(saved), s = MODULE_STATUS.profile(saved);
    assert.deepEqual([s.state, s.percent, s.done, s.total], ["ready", ref.percent, ref.done, ref.total], JSON.stringify(Object.keys(saved)));
    const missing = REQUIRED.filter((f) => !saved[f.id]).length; // computed here, independently, from the schema's own `required` flags
    assert.equal(s.requiredRemaining, missing);
    assert.equal(s.actionRequired, missing > 0);
    assert.equal(s.complete, ref.percent === 100);
    if (s.complete) assert.equal(missing, 0, "100% can never coexist with a missing required answer");
  }
  const src = strip(read("worker/portal/module-status.js"));
  assert.match(src, /import \{ profileProgress, PROFILE_STEPS \} from "\.\/profile-schema\.js"/);
  assert.ok(!/Math\.(round|floor|ceil|trunc)\(|\*\s*100|\/\s*(total|PROFILE_STEPS|steps\.length)/.test(src), "no percentage arithmetic of its own");
});

test("required vs optional: only missing REQUIRED information raises 'action required'; optional answers neither raise it nor count as required ones", () => {
  const st = (saved) => MODULE_STATUS.profile(saved);
  const fresh = st({});
  assert.deepEqual([fresh.percent, fresh.requiredRemaining, fresh.actionRequired, fresh.complete], [0, REQUIRED.length, true, false], "nothing saved: a real 0%, action required");
  // every required answer saved, the optional-only step (Online presence) untouched: 6 of 7 steps -> 86%, nothing REQUIRED outstanding
  const reqOnly = st(answers(REQUIRED));
  assert.deepEqual([reqOnly.percent, reqOnly.requiredRemaining, reqOnly.actionRequired, reqOnly.complete], [86, 0, false, false]);
  // one optional answer in that step completes it
  const online = ALL.find((f) => f.step === "online" && !f.required);
  assert.deepEqual([st({ ...answers(REQUIRED), [online.id]: "x" }).percent, st({ ...answers(REQUIRED), [online.id]: "x" }).actionRequired], [100, false]);
  // all optional answers given but required ones missing: still action required
  const optionalsOnly = st(answers(ALL.filter((f) => !f.required)));
  assert.equal(optionalsOnly.actionRequired, true);
  assert.equal(optionalsOnly.requiredRemaining, REQUIRED.length, "optional answers do not reduce what is required");
  // everything required and online saved, other optionals blank: complete, no indicator
  const done = st({ ...answers(REQUIRED), [online.id]: "x" });
  assert.deepEqual([done.complete, done.actionRequired, done.requiredRemaining], [true, false, 0]);
  // one required answer removed from an otherwise complete profile
  const gap = { ...answers(ALL) }; delete gap[REQUIRED[0].id];
  assert.deepEqual([st(gap).actionRequired, st(gap).requiredRemaining, st(gap).complete], [true, 1, false]);
  // an empty string is not an answer
  assert.equal(st({ ...answers(REQUIRED), [REQUIRED[0].id]: "" }).actionRequired, true);
});

test("no status is invented: unreadable data is 'unavailable', unregistered or Coming-soon modules get nothing", () => {
  for (const bad of [null, undefined, "x", 5]) assert.deepEqual(MODULE_STATUS.profile(bad), { state: "unavailable" }, String(bad));
  assert.deepEqual(moduleStatuses(["profile"], { profile: null }), { profile: { state: "unavailable" } });
  assert.deepEqual(moduleStatuses(["profile"], {}), { profile: { state: "unavailable" } }, "no data supplied is unavailable, never 0%");
  assert.deepEqual(moduleStatuses(["profile", "branding", "website"], { profile: {}, branding: { x: 1 } }), { profile: MODULE_STATUS.profile({}) }, "only modules with a calculator get a status");
  assert.deepEqual(moduleStatuses(["__proto__", "constructor", "toString"], {}), {}, "prototype names are not modules");
  assert.deepEqual(moduleStatuses(undefined, {}), {});
  assert.deepEqual(LIVE_AREAS, ["profile"], "today only Business Profile is live");
});

/* ------------------------------------------------------------------ rendering (pure) */

const vmFor = (moduleStatus) => ({ base: "/portal/o/x", user: { name: "Ann" }, liveAreas: ["profile"], moduleStatus });
const tiles = (html) => { const ul = /<ul class="tiles">([\s\S]*?)<\/ul>/.exec(html); return ul ? [...ul[1].matchAll(/<li>[\s\S]*?<\/li>/g)].map((m) => m[0]) : []; };

test("tile status markup: the bar is thin and hidden from assistive technology, the words carry the meaning, the red dot is decorative", () => {
  const firstFour = PROFILE_STEPS.slice(0, 4).map((p) => p.id); // business, location, offering, goals: 4 of 7 steps
  const s = MODULE_STATUS.profile(answers(ALL.filter((f) => firstFour.includes(f.step))));
  assert.equal(s.percent, 57);
  const html = tileStatus(s);
  assert.match(html, /<progress class="meter" max="100" value="57" aria-hidden="true">57%<\/progress>/);
  assert.match(html, /<p class="tile__pct">57% complete<\/p>/);
  assert.match(html, /<p class="tile__action"><span class="dot dot--attention" aria-hidden="true"><\/span>\d+ required answers? left<\/p>/);
  assert.ok(!/style=|<script|onclick|color/i.test(html), "no inline style, script or handler: colour comes only from the stylesheet");
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(text, /57% complete/);
  assert.match(text, /\d+ required answers? left/);
});

test("states: complete shows '100% complete' with no indicator; optional-only remaining is quiet; unavailable shows no percentage and no indicator", () => {
  const complete = tileStatus({ state: "ready", percent: 100, done: 7, total: 7, requiredRemaining: 0, actionRequired: false, complete: true });
  assert.match(complete, /100% complete/);
  assert.ok(!/required answers? left|dot|Optional details/.test(complete));
  const optional = tileStatus(MODULE_STATUS.profile(answers(REQUIRED)));
  assert.match(optional, /86% complete/);
  assert.match(optional, /All required answers are complete/);
  assert.ok(!/required answers? left|dot/.test(optional), "missing optional information alone never raises the red indicator");
  const zero = tileStatus(MODULE_STATUS.profile({}));
  assert.match(zero, /0% complete/);
  assert.match(zero, /\d+ required answers? left/);
  const unavailable = tileStatus({ state: "unavailable" });
  assert.match(unavailable, /Progress unavailable right now/);
  assert.ok(!/% complete|<progress|dot|required answers? left/.test(unavailable), "an unreadable value is never 0%");
  for (const bad of [undefined, null, "x", {}, { state: "ready" }, { state: "ready", percent: 101 }, { state: "ready", percent: -1 }, { state: "ready", percent: 50.5 }, { state: "ready", percent: "50% <script>" }, { state: "loading" }]) {
    assert.equal(tileStatus(bad), "", JSON.stringify(bad));
  }
});

/** The names in the quiet "Coming soon" line. */
const soonNames = (frag) => (/<p class="soon-line">[\s\S]*?<\/p>/.exec(frag) || [""])[0].replace(/<[^>]+>/g, "").replace(/^Coming soon\s+/, "").trim().replace(/&amp;/g, "&").split(" · ");

test("signed-in Home: only the live module carries status, the five unavailable ones are a bare text list (even if a status is supplied for them); the demo is unchanged", () => {
  const html = home(vmFor({ profile: MODULE_STATUS.profile({}), branding: MODULE_STATUS.profile(answers(ALL)), website: { state: "ready", percent: 40, actionRequired: true } }));
  const focus = (html.match(/<a class="hub"[\s\S]*?<\/a>/g) || []);
  assert.equal(focus.length, 1);
  assert.match(focus[0], /Business Profile/);
  assert.equal((html.match(/class="tile__status"/g) || []).length, 1, "one status block: the live module's");
  const soon = html.slice(html.indexOf('<p class="soon-line"'));
  assert.deepEqual(soonNames(soon), ["Branding", "Website", "Marketing", "Content & Photography", "Files & Deliverables"]);
  assert.ok(!/<progress|% complete|required answers? left|dot|tile__status|<a /.test(soon), "unavailable modules show no progress and no required action");
  // the demo (no liveAreas, no statuses) renders exactly as before
  const demo = home({ base: "/portal/demo", user: { name: "Sam" } });
  assert.ok(!/tile__status|<progress|Action required/.test(demo));
  assert.equal(tiles(demo).length, 6);
  // a live module with no calculator keeps a plain focus block: nothing is invented
  const plain = home({ base: "/portal/o/x", user: { name: "Ann" }, liveAreas: ["profile", "website"], moduleStatus: { profile: MODULE_STATUS.profile({}) } });
  assert.equal((plain.match(/<a class="hub"/g) || []).length, 2);
  assert.equal((plain.match(/class="tile__status"/g) || []).length, 1, "Website is live but has no status");
});

/* ------------------------------------------------------------------ through the real router: isolation, reality, failure */

async function setup() {
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("bravo", "Bravo Co"), C = await w.org("charlie", "Charlie Co");
  await w.invite(A, "ann@a.test", "owner"); await w.invite(B, "bob@b.test", "owner"); await w.invite(C, "cat@c.test", "owner");
  await w.invite(A, "carol@both.test", "member"); await w.invite(B, "carol@both.test", "member");
  const people = { ann: w.user(1, "ann@a.test"), bob: w.user(2, "bob@b.test"), cat: w.user(3, "cat@c.test"), carol: w.user(4, "carol@both.test") };
  const br = {};
  for (const [n, u] of Object.entries(people)) { br[n] = w.browser(); assert.equal((await br[n].signIn(u)).status, 303); }
  const uid = (email) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(email).id;
  const save = async (org, who, fields) => { for (const step of PROFILE_STEPS) { const input = Object.fromEntries(fields.filter((f) => f.step === step.id).map((f) => [f.id, sample(f)])); if (Object.keys(input).length) assert.ok((await saveProfileStep(w.db, org.id, uid(who), step.id, input)).ok); } };
  return { w, A, B, C, br, save };
}
const homeHtml = async (b, slug) => (await b.get(`/portal/o/${slug}`)).text();
const block = (html) => (/<div class="tile__status">[\s\S]*?<\/div>/.exec(html) || [""])[0];

test("the dashboard shows the signed-in organization's own progress, never another's; a fresh organization is a real 0%; saving elsewhere changes nothing here", async () => {
  const { A, B, br, save } = await setup();
  await save(A, "ann@a.test", ALL.filter((f) => f.required));                  // alpha: every required answer, Online untouched -> 86%, nothing required left
  await save(B, "bob@b.test", ALL.filter((f) => f.step === "business"));         // bravo: one step -> 14%, required answers missing
  const [ha, hb, hc] = [await homeHtml(br.ann, "alpha"), await homeHtml(br.bob, "bravo"), await homeHtml(br.cat, "charlie")];
  assert.match(block(ha), /86% complete/);
  assert.match(block(ha), /All required answers are complete/);
  assert.ok(!/\d+ required answers? left/.test(ha), "alpha has no required information missing");
  assert.match(block(hb), /14% complete/);
  assert.match(block(hb), /\d+ required answers? left/);
  assert.match(block(hc), /0% complete/);
  assert.match(block(hc), /\d+ required answers? left/);
  assert.ok(!/86%|14%/.test(block(hc)) && !/14%|0% complete/.test(block(ha)) && !/86%/.test(block(hb)), "no organization's number appears on another's page");
  // bravo makes progress; alpha's dashboard is byte-for-byte the same progress block
  const before = block(ha);
  await save(B, "bob@b.test", ALL);
  assert.equal(block(await homeHtml(br.ann, "alpha")), before);
  assert.match(block(await homeHtml(br.bob, "bravo")), /100% complete/);
  assert.ok(!/required answers? left|dot/.test(block(await homeHtml(br.bob, "bravo"))), "complete: no indicator");
  // a person in two organizations sees each organization's own progress under its own URL
  assert.match(block(await homeHtml(br.carol, "alpha")), /86% complete/);
  assert.match(block(await homeHtml(br.carol, "bravo")), /100% complete/);
  // another organization's dashboard is not reachable, and says nothing about it
  const denied = await br.ann.get("/portal/o/bravo");
  assert.equal(denied.status, 404);
  assert.ok(!/% complete|required answers? left/.test(await denied.text()));
  const cross = await br.cat.get("/portal/o/alpha");
  assert.equal(cross.status, 404);
});

test("unreadable data never shows 0%: a failing or missing profile table gives 'Progress unavailable', no indicator, and the rest of Home still works", async () => {
  const { w, A, br, save } = await setup();
  await save(A, "ann@a.test", ALL);
  assert.match(block(await homeHtml(br.ann, "alpha")), /100% complete/);
  // the database refuses the profile query (an outage)
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { ...real, prepare: (q) => { if (/business_profile_answers/.test(q)) throw new Error("D1_ERROR: SECRET internals"); return real.prepare(q); }, batch: (s) => real.batch(s) };
  let res = await br.ann.get("/portal/o/alpha");
  let html = await res.text();
  assert.equal(res.status, 200, "Home still renders");
  assert.match(html, /Progress unavailable right now/);
  assert.ok(!/% complete|required answers? left|class="dot|<progress/.test(html), "no percentage, no bar, no red indicator");
  assert.ok(!/SECRET|D1_ERROR/.test(html), "no internals");
  assert.match(html, /<h1 class="h1 h1--home">Welcome/);
  assert.equal(soonNames(html.slice(html.indexOf('<p class="soon-line"'))).length, 5);
  assert.equal((html.match(/<a class="hub"/g) || []).length, 1);
  w.env.PORTAL_DB = real;
  // the profile table does not exist (database without that migration)
  w.db.raw.exec("DROP TABLE business_profile_answers");
  res = await br.ann.get("/portal/o/alpha");
  html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Progress unavailable right now/);
  assert.ok(!/% complete|required answers? left/.test(html));
});

/* ------------------------------------------------------------------ design and accessibility guards */

test("the page carries no script or inline style, the link's accessible text includes the status words, and Home stays six cards", async () => {
  const { A, br, save } = await setup();
  await save(A, "ann@a.test", ALL.filter((f) => f.step === "business"));
  const html = await homeHtml(br.ann, "alpha");
  assert.ok(!/<script|style="/.test(html.replace(/<style[\s\S]*?<\/style>/g, "")));
  const link = /<a class="hub"[\s\S]*?<\/a>/.exec(html)[0];
  const name = link.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
  assert.match(name, /Business Profile/);
  assert.match(name, /14% complete/);
  assert.match(name, /\d+ required answers? left/);
  assert.match(link, /aria-hidden="true"><\/span>\d+ required answers? left/, "the dot is decorative; the words remain");
  assert.equal((html.match(/<a class="hub"/g) || []).length + soonNames(html.slice(html.indexOf('<p class="soon-line"'))).length, 6, "all six areas are still accounted for");
  assert.equal(AREAS.length, 6);
});

test("styling: the red is the portal's one existing 'needs you' token, the bar is the existing thin meter, forced-colors and mobile layouts are covered, nothing else changes", () => {
  const css = read("assets/css/portal.css");
  assert.equal((css.match(/--signal:\s*#B3261E/g) || []).length, 1, "the red is defined once");
  assert.match(css, /\.dot--attention \{ background: var\(--signal\); \}/);
  assert.ok(!/\.dot[^{]*\{[^}]*#[0-9a-fA-F]{3,6}/.test(css.slice(css.indexOf("module progress and required-action"))), "no new hard-coded colour in the new block");
  assert.match(css, /\.tile__status progress\.meter \{ height: 3px; \}/);
  assert.match(css, /@media \(forced-colors: active\) \{ \.dot \{ forced-color-adjust: none; background: Mark; \}/);
  assert.match(css, /\.tile--status \{ grid-template-areas: "n title arrow" "\. desc arrow" "\. status status";/);
  assert.match(css, /\.tiles \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/, "the three-column grid is untouched");
  assert.ok(!/\.tiles\s*\{[^}]*(width|height):\s*\d/.test(css), "no fixed sizes added to the grid");
});

test("organization scoping in the code: Home reads answers only through the signed-in membership's organization, and no authentication, invitation or permission file was touched", () => {
  const router = strip(read("worker/portal/router.js"));
  assert.match(router, /async function readAnswers\(ctx, a\) \{[\s\S]*?getProfileAnswers\(ctx\.db, a\.membership\.organizationId\)/);
  assert.match(router, /moduleStatuses\(pages\.liveAreasFor\(ctx\), \{ profile: answers \}\)/);
  assert.ok(!/ctx\.url\.searchParams[^;]*organization|request\.headers[^;]*organization/i.test(router.slice(router.indexOf("async function readAnswers"), router.indexOf("async function readAnswers") + 600)));
  const src = strip(read("worker/portal/module-status.js"));
  assert.ok(!/\bdb\b|fetch\(|prepare\(|process\.env|request/.test(src), "the calculator is pure: it takes data and returns a status");
});
