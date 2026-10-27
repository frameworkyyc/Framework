// Phase 6D: the Home dashboard's first-run experience. The greeting only claims a past visit with reliable evidence; one next action comes from the
// same Business Profile logic as the overview; unavailable modules are a quiet text list; status wording matches the Business Profile overview.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { PROFILE_STEPS } from "../portal/profile-schema.js";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import { hasPriorVisit } from "../portal/repo/visits.js";
import { usableFirstName, welcomeText, welcomeFor } from "../portal/welcome.js";
import { NEXT_ACTION, nextActions } from "../portal/module-status.js";
import { PORTAL_CSP } from "../portal/http.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const css = read("assets/css/portal.css");
const ALL = PROFILE_STEPS.flatMap((s) => s.fields.map((f) => ({ ...f, step: s.id })));
const sample = (f) => (f.kind === "multi" ? f.options.slice(0, 2).join(", ") : f.kind === "select" || f.kind === "choice" ? f.options[0] : f.kind === "email" ? "a@b.co" : f.kind === "tel" ? "403-555-0100" : f.kind === "website" ? "example.com" : "Sample");

async function setup({ names = true } = {}) {
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const people = { ann: w.user(1, "ann@alpha.test"), mia: w.user(3, "mia@alpha.test"), bob: w.user(2, "bob@beta.test") };
  if (!names) for (const u of Object.values(people)) { delete u.first_name; delete u.last_name; }
  const br = { ann: w.browser(), mia: w.browser(), bob: w.browser() };
  for (const k of Object.keys(br)) assert.equal((await br[k].signIn(people[k])).status, 303);
  const uid = (email) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(email).id;
  const save = async (org, who, fields) => { for (const step of PROFILE_STEPS) { const input = Object.fromEntries(fields.filter((f) => f.step === step.id).map((f) => [f.id, sample(f)])); if (Object.keys(input).length) assert.ok((await saveProfileStep(w.db, org.id, uid(who), step.id, input)).ok); } };
  const signInAgain = async (key) => { const b = w.browser(); assert.equal((await b.signIn(people[key])).status, 303); return b; };
  return { w, alpha, beta, br, uid, save, signInAgain, people };
}
const home = async (b, slug = "alpha") => (await b.get(`/portal/o/${slug}`)).text();
const h1 = (html) => /<h1[^>]*>([^<]*)<\/h1>/.exec(html)[1];
const action = (html) => (/<p class="home-action">([\s\S]*?)<\/p>/.exec(html) || [])[1] || "";
const text = (html) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const REQUIRED = ALL.filter((f) => f.required);

/* ------------------------------------------------------------------ greeting */

test("usableFirstName: a real first name only; never an email prefix, a number or markup", () => {
  for (const [input, want] of [["Ann Lee", "Ann"], ["  Élodie  Roy ", "Élodie"], ["JJ", "JJ"], ["O'Brien", "O'Brien"], ["R2D2", "R2D2"], ["", ""], ["   ", ""], [null, ""], [undefined, ""], ["12345", ""], ["jj@alpha.test", ""], ["<b>", ""], ["x".repeat(41), ""]]) {
    assert.equal(usableFirstName(input), want, JSON.stringify(input));
  }
});

test("welcomeText: 'Welcome back' only with evidence; a name only when usable; one wording for every combination", () => {
  assert.equal(welcomeText({ name: "Ann Lee", returning: true }), "Welcome back, Ann.");
  assert.equal(welcomeText({ name: "Ann Lee", returning: false }), "Welcome, Ann.");
  assert.equal(welcomeText({ name: "", returning: true }), "Welcome back.");
  assert.equal(welcomeText({ name: "", returning: false }), "Welcome to your portal.");
  assert.equal(welcomeText(), "Welcome to your portal.");
  assert.equal(welcomeText({ name: "jj@alpha.test" }), "Welcome to your portal.");
  assert.equal(welcomeFor({ user: { name: "Alex" }, mode: "demo" }), "Welcome back, Alex.", "the demonstration is a fictional client with history");
  assert.equal(welcomeFor({ user: { name: "Alex" }, mode: "live" }), "Welcome, Alex.", "a signed-in client needs evidence");
  assert.equal(welcomeFor({ user: { name: "Alex" }, mode: "live", returning: true }), "Welcome back, Alex.");
});

/* ------------------------------------------------------------------ the evidence */

test("evidence of a previous visit: an earlier sign-in, the person's own saved answers, or their own activity; nothing else", async () => {
  const { w, alpha, beta, br, uid, save, signInAgain, people } = await setup();
  const sessionOf = (email) => w.db.raw.prepare("SELECT id FROM portal_sessions WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 1").get(uid(email)).id;
  const ask = (email, org = alpha) => hasPriorVisit(w.db, { userId: uid(email), organizationId: org.id, sessionId: sessionOf(email) });
  // being a member, being invited and having a live session are NOT evidence
  assert.equal(await ask("ann@alpha.test"), false);
  assert.equal(await ask("mia@alpha.test"), false);
  // a colleague's answers are not this person's visit
  await save(alpha, "ann@alpha.test", REQUIRED);
  assert.equal(await ask("mia@alpha.test"), false, "a colleague working here is not evidence that THIS person has visited");
  assert.equal(await ask("ann@alpha.test"), true, "her own saved answers");
  // an earlier session of the person
  await signInAgain("mia");
  assert.equal(await ask("mia@alpha.test"), true, "a second sign-in means an earlier one happened");
  // organization scoping: Ann's answers in alpha say nothing about beta for someone else
  assert.equal(await ask("bob@beta.test", beta), false);
  // malformed input never silently reads as 'true'
  await assert.rejects(() => hasPriorVisit(w.db, { userId: uid("bob@beta.test"), organizationId: beta.id, sessionId: "x" }), /invalid_session_id/);
  await assert.rejects(() => hasPriorVisit(w.db, { userId: "nope", organizationId: beta.id, sessionId: sessionOf("bob@beta.test") }), /invalid_user_id/);
  await assert.rejects(() => hasPriorVisit(w.db, { userId: uid("bob@beta.test"), organizationId: "' OR 1=1 --", sessionId: sessionOf("bob@beta.test") }), /invalid_organization_id/);
  assert.ok(people && br);
});

test("the greeting never infers a visit from the active session: reloading, and visiting other pages, keeps 'Welcome, Ann.'", async () => {
  const { br } = await setup();
  for (let i = 0; i < 3; i++) assert.equal(h1(await home(br.ann)), "Welcome, Test.");
  await br.ann.get("/portal/o/alpha/account"); await br.ann.get("/portal/o/alpha/profile");
  assert.equal(h1(await home(br.ann)), "Welcome, Test.", "viewing pages is not activity");
});

test("new client without a usable name: 'Welcome to your portal.'; after a second sign-in: 'Welcome back.'", async () => {
  const { br, signInAgain } = await setup({ names: false });
  assert.equal(h1(await home(br.ann)), "Welcome to your portal.");
  const again = await signInAgain("ann");
  assert.equal(h1(await home(again)), "Welcome back.");
});

test("returning client with a name: 'Welcome back, Test.'; saving your own work also counts, even in the same session", async () => {
  const { br, signInAgain, save, w, alpha } = await setup();
  assert.equal(h1(await home(await signInAgain("ann"))), "Welcome back, Test.");
  assert.equal(h1(await home(br.mia)), "Welcome, Test.");
  await save(alpha, "mia@alpha.test", ALL.filter((f) => f.step === "business"));
  assert.equal(h1(await home(br.mia)), "Welcome back, Test.", "her own saved answers are evidence");
  assert.ok(w);
});

test("when the evidence cannot be read the greeting is neutral, the page still works, and nothing is claimed", async () => {
  const { w, br, signInAgain } = await setup();
  const again = await signInAgain("ann");
  assert.equal(h1(await home(again)), "Welcome back, Test.");
  const real = w.env.PORTAL_DB;
  w.env.PORTAL_DB = { ...real, prepare: (q) => { if (/EXISTS \(SELECT 1 FROM portal_sessions/.test(q)) throw new Error("D1_ERROR: SECRET"); return real.prepare(q); }, batch: (s) => real.batch(s) };
  const res = await again.get("/portal/o/alpha");
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.equal(h1(html), "Welcome, Test.");
  assert.ok(!/SECRET|D1_ERROR/.test(html));
  w.env.PORTAL_DB = real;
  assert.ok(br);
});

test("wording is consistent across portal pages: the legacy progress page greets exactly like Home", async () => {
  const { br, signInAgain } = await setup({ names: false });
  const progress = async (b) => h1(await (await b.get("/portal/o/alpha/progress")).text());
  assert.equal(progress.length, 1);
  assert.equal(await progress(br.ann), h1(await home(br.ann)));
  assert.equal(await progress(br.ann), "Welcome to your portal.");
  const again = await signInAgain("ann");
  assert.equal(await progress(again), "Welcome back.");
  assert.equal(await progress(again), h1(await home(again)));
});

/* ------------------------------------------------------------------ the next action */

test("Home, NEW client: a short greeting under the organization name, one Business Profile card with its progress, and the overview still offers the first step", async () => {
  const { br } = await setup();
  const html = await home(br.ann);
  assert.match(html, /<span class="eyebrow">Alpha Co<\/span><h1 class="h1 h1--home">/, "the organization's name sits above the greeting");
  assert.match(html, /<a class="hub" href="\/portal\/o\/alpha\/profile">/);
  assert.ok(!/btn btn--primary|home-note|class="lead"|20–30|Your progress is saved/.test(html), "no extra button, instructions or lead text");
  assert.match(html, /0% complete/); assert.match(html, /required answers left/);
  const overview = await (await br.ann.get("/portal/o/alpha/profile")).text();
  assert.match(overview, /href="\/portal\/o\/alpha\/profile\/business">Start: Your business/);
});

test("Home, PARTIAL and COMPLETE: only the card's progress changes; the overview points at the first step still missing a required answer", async () => {
  const { alpha, br, save } = await setup();
  await save(alpha, "ann@alpha.test", ALL.filter((f) => f.step === "business"));
  let html = await home(br.ann);
  assert.match(html, /\d+% complete/); assert.ok(!/Pick up where you left off|Continue your/.test(html));
  const overview = await (await br.ann.get("/portal/o/alpha/profile")).text();
  assert.match(overview, /href="\/portal\/o\/alpha\/profile\/location">Continue: /);
  await save(alpha, "ann@alpha.test", REQUIRED);
  html = await home(br.ann);
  assert.match(html, /86% complete/); assert.match(html, /All required answers are complete/);
  assert.ok(!/required answers? left|Your Business Profile is complete|home-note/.test(html));
  await save(alpha, "ann@alpha.test", ALL);
  assert.match(await home(br.ann), /100% complete/);
});

test("Home, unreadable data makes no claim: 'Progress unavailable', no percentage, and the card still links", async () => {
  const { w, br } = await setup();
  w.db.raw.exec("DROP TABLE business_profile_answers");
  const html = await home(br.ann);
  assert.match(html, /Progress unavailable right now/);
  assert.match(html, /class="hub" href="\/portal\/o\/alpha\/profile"/);
  assert.ok(!/required answers? left|% complete/.test(html));
});

test("NEXT_ACTION is pure and uses the existing profile logic: states, targets and counts", () => {
  assert.deepEqual(NEXT_ACTION.profile(null), { state: "unavailable" });
  assert.deepEqual(NEXT_ACTION.profile("x"), { state: "unavailable" });
  const fresh = NEXT_ACTION.profile({});
  assert.deepEqual([fresh.state, fresh.path, fresh.stepTitle, fresh.requiredRemaining], ["start", "/profile/business", "Your business", REQUIRED.length]);
  const part = NEXT_ACTION.profile({ legal: "Acme" });
  assert.deepEqual([part.state, part.path, part.requiredRemaining], ["continue", "/profile/business", REQUIRED.length - 1]);
  const required = Object.fromEntries(REQUIRED.map((f) => [f.id, sample(f)]));
  assert.deepEqual(NEXT_ACTION.profile(required), { state: "complete", optionalRemain: true });
  assert.deepEqual(NEXT_ACTION.profile(Object.fromEntries(ALL.map((f) => [f.id, sample(f)]))), { state: "complete", optionalRemain: false });
  assert.deepEqual(nextActions(["profile", "branding"], { profile: {} }), { profile: fresh }, "modules without a calculator get nothing");
  assert.deepEqual(nextActions(undefined), {});
  const src = read("worker/portal/module-status.js").replace(/^\s*(\/\/|\*|\/\*\*).*$/gm, "");
  assert.ok(!/Math\.(round|floor|ceil)|\*\s*100/.test(src), "no percentage arithmetic of its own");
});

/* ------------------------------------------------------------------ status wording and unavailable modules */

test("Home status says what the Business Profile overview says: the same required-answer count, the same completion wording, the same percentage", async () => {
  const { alpha, br, save } = await setup();
  const leftOnHome = async () => Number(/(\d+) required answers? left/.exec(await home(br.ann))?.[1] ?? 0);
  const leftOnOverview = async () => [...(await (await br.ann.get("/portal/o/alpha/profile")).text()).matchAll(/class="rowstat">(?:In progress · )?(\d+) required answers? left</g)].reduce((n, m) => n + Number(m[1]), 0);
  assert.equal(await leftOnHome(), REQUIRED.length);
  assert.equal(await leftOnHome(), await leftOnOverview());
  await save(alpha, "ann@alpha.test", ALL.filter((f) => f.step === "business" && f.id === "legal"));
  assert.equal(await leftOnHome(), REQUIRED.length - 1);
  assert.equal(await leftOnHome(), await leftOnOverview());
  await save(alpha, "ann@alpha.test", ALL.filter((f) => f.step === "business"));
  assert.equal(await leftOnHome(), await leftOnOverview());
  const pct = (h) => /(\d+)% complete/.exec(h)[1];
  assert.equal(pct(await home(br.ann)), /(\d+)%/.exec(await (await br.ann.get("/portal/o/alpha/profile")).text())[1], "one percentage, one calculation");
  await save(alpha, "ann@alpha.test", REQUIRED);
  assert.match(await home(br.ann), /All required answers are complete/);
  assert.match(await (await br.ann.get("/portal/o/alpha/profile")).text(), /All required answers are complete\./);
  assert.ok(!/required answers? left/.test(await home(br.ann)));
});

test("the red indicator appears only beside real required work and always with words; it is gone when nothing required is left", async () => {
  const { alpha, br, save } = await setup();
  const dots = async () => (await home(br.ann)).match(/class="dot dot--attention"/g)?.length ?? 0;
  assert.equal(await dots(), 1);
  assert.match(await home(br.ann), /<span class="dot dot--attention" aria-hidden="true"><\/span>\d+ required answers? left/);
  await save(alpha, "ann@alpha.test", REQUIRED);
  assert.equal(await dots(), 0);
  assert.ok(!/Action required/.test(await home(br.ann)), "the vague old wording is gone");
});

test("unavailable modules are one quiet line: no link, no focus stop, no card, no badge, no progress; the live module is one whole-card link with a decorative arrow", async () => {
  const { br } = await setup();
  const html = await home(br.ann);
  const line = /<p class="soon-line">[\s\S]*?<\/p>/.exec(html)[0];
  assert.ok(!/<a |href|tabindex|role=|tile|<progress|dot/.test(line));
  assert.equal([...html.matchAll(/<a class="hub"/g)].length, 1, "one module link");
  const card = /<a class="hub"[\s\S]*?<\/a>/.exec(html)[0];
  assert.match(card, /class="hub__title">Business Profile</); assert.match(card, /class="hub__desc">/); assert.match(card, /hub__arrow tile__arrow" aria-hidden="true">→</);
  const body = html.slice(html.indexOf('<main'), html.indexOf("</main>"));
  assert.equal([...body.matchAll(/<a [^>]*href=/g)].length, 1, "the Business Profile card is the only link in the page body");
});

/* ------------------------------------------------------------------ owner / member, isolation, security */

test("Owner and Member see the same dashboard (their own greeting); only the Owner has Team in the navigation; each sees the organization's one next step", async () => {
  const { br } = await setup();
  const [owner, member] = [await home(br.ann), await home(br.mia)];
  const nav = (h) => [...h.slice(h.indexOf('<nav class="primary"'), h.indexOf("</nav>", h.indexOf('<nav class="primary"'))).matchAll(/>([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(nav(owner), ["Home", "Account", "Team"]);
  assert.deepEqual(nav(member), ["Home", "Account"]);
  const main = (h) => h.slice(h.indexOf("<main"), h.indexOf("</main>")).replace(/<form method="post" action="\/portal\/logout"[\s\S]*?<\/form>/, "");
  assert.equal(main(owner), main(member), "same dashboard content");
  assert.equal(h1(member), "Welcome, Test.");
});

test("a member sees the organization's progress and next step, never another organization's", async () => {
  const { alpha, beta, br, save } = await setup();
  await save(alpha, "ann@alpha.test", ALL.filter((f) => f.step === "business"));
  await save(beta, "bob@beta.test", REQUIRED);
  const m = await home(br.mia);
  assert.ok(!/86%/.test(m));
  assert.match(await home(br.bob, "beta"), /86% complete/);
  assert.equal((await br.bob.get("/portal/o/alpha")).status, 404);
  assert.equal((await br.mia.get("/portal/o/beta")).status, 404);
});

test("Home keeps its protections: no script or inline style, the same CSP, no new write route, and the greeting escapes names", async () => {
  const { w, br } = await setup();
  const res = await br.ann.get("/portal/o/alpha");
  assert.equal(res.headers.get("content-security-policy"), PORTAL_CSP);
  const html = await res.text();
  assert.ok(!/<script|style="/.test(html));
  w.db.raw.prepare("UPDATE portal_users SET name = ? WHERE email = 'ann@alpha.test'").run("<img src=x onerror=alert(1)> Evil");
  const evil = await home(br.ann);
  assert.ok(!evil.includes("<img"), "markup in a name is escaped or rejected");
  assert.match(h1(evil), /^Welcome( to your portal)?\.?|^Welcome, /);
  // the portal's home is read-only: a POST is refused
  const post = await (async () => { const { handlePortal } = await import("../portal/router.js"); return handlePortal(new Request("https://staging.frameworkco.ca/portal/o/alpha", { method: "POST", headers: { Cookie: br.ann.cookieHeader(), Origin: "https://staging.frameworkco.ca", "Content-Type": "application/x-www-form-urlencoded" }, body: "x=1" }), w.env, { now: w.clock.now() }); })();
  assert.ok([404, 405].includes(post.status), String(post.status));
  assert.ok(csrfOf);
});

/* ------------------------------------------------------------------ responsive rules (rendering is checked in Chromium) */

test("responsive rules: the next action is full width on phones, every link keeps a 44px target, the focus block has no fixed sizes", () => {
  assert.match(css, /@media \(max-width: 560px\) \{ \.home-action \.btn \{ width: 100%; \}/);
  assert.match(css, /\.home-action \.text-link \{ display: inline-flex; align-items: center; min-height: 44px; \}/);
  assert.match(css, /\.btn \{[^}]*min-height: 48px/);
  assert.match(css, /\.focus \{[^}]*padding: var\(--space-3\) 0/);
  assert.ok(!/\.focus(-list)?[^{]*\{[^}]*(?<![-\w])(width|height):\s*\d/.test(css), "no fixed sizes that could overflow");
  assert.match(css, /\.soon-list ul \{[^}]*repeat\(auto-fill, minmax\(220px, 1fr\)\)/);
});
