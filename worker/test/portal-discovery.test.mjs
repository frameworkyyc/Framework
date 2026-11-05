// Discovery assessments (Brand Discovery): content, visuals, brief, repository rules, routes, Admin and the Branding integration. Migration 0018 is applied to Staging
// (migrations/portal/0018_discovery.sql); the "before the migration" test leaves it out.
import { test } from "node:test";
import assert from "node:assert/strict";
import { openPortalDb, rows } from "./helpers/portal-db.mjs";
import { KINDS, SECTION_ORDER, SECTIONS, TENSIONS } from "../portal/discovery/catalogue.js";
import { visualFor, VISUAL_TYPES } from "../portal/discovery/visuals.js";
import { effectiveKind, stageQuestions, normalizePicks, readStageFields, cleanText, answerState } from "../portal/discovery/model.js";
import { buildBrief, briefToMarkdown } from "../portal/discovery/brief.js";
import * as repo from "../portal/repo/discovery.js";
import { REQUIREMENT_ITEMS } from "../../admin/assets/brand-requirement-items.js";
import { sha256b64url } from "../portal/crypto.js";
import { backupPurge, restorableKeys } from "../portal/backup-purge.js";
import { fakeR2 } from "./helpers/fake-r2.mjs";

const P = []; // 0018 is now a normal applied migration (it was proposed while this was built)
const ORG_A = "11111111-1111-4111-8111-111111111111", ORG_B = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-11-03T12:00:00.000Z");
const days = (n) => new Date(T0.getTime() + n * 86400000);

function world() {
  const db = openPortalDb({ proposed: P });
  for (const [id, slug] of [[ORG_A, "alpha"], [ORG_B, "beta"]]) db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, ?, ?)").run(id, slug, slug.toUpperCase());
  return db;
}
const eff = effectiveKind("brand", []);
const A = "admin@framework.example";

test("retired logo choices remain in saved answers but cannot be selected or re-enabled", () => {
  const content = effectiveKind("brand", [{ item_key: "logo.type", option_key: "spiritual", enabled: 1 }]);
  const questions = stageQuestions(content, content.stages[1]);
  const logo = questions.find((q) => q.key === "logo.type");
  assert.equal(logo.options.length, 12);
  assert.deepEqual(logo.retiredOptions.map((o) => o.key), ["spiritual", "expressive"]);
  const fields = new URLSearchParams({ "l:logo.type:wordmark": "1", "l:logo.type:spiritual": "1", "l:logo.type:expressive": "1" });
  assert.deepEqual(readStageFields(fields, questions)["logo.type"].picks.like, ["wordmark"]);
  const previous = new Map([["logo.type", { picks: { mode: "picks", like: ["spiritual"], dislike: ["expressive"] } }]]);
  assert.deepEqual(readStageFields(fields, questions, previous)["logo.type"].picks, { mode: "picks", like: ["wordmark", "spiritual"], dislike: ["expressive"] });
});

test("the brand assessment covers all nine Branding sections, in six stages, using Branding's own keys", () => {
  const def = KINDS.brand;
  assert.equal(def.stages.length, 6);
  assert.deepEqual(def.stages.map((s) => s.n), [1, 2, 3, 4, 5, 6]);
  const sectionKeys = REQUIREMENT_ITEMS.filter((i) => i.group === "section").map((i) => i.key).sort();
  assert.deepEqual([...SECTION_ORDER].sort(), sectionKeys, "the nine sections are exactly Branding's nine");
  assert.deepEqual(Object.keys(SECTIONS).sort(), sectionKeys);
  for (const key of sectionKeys) assert.ok(def.questions.some((q) => q.section === key), `${key} has at least one question`);
  assert.deepEqual(def.stages.flatMap((s) => s.sections).sort(), sectionKeys, "every section sits in exactly one stage");
  assert.ok(def.stages[5].review, "the last stage carries the review");
  for (const q of def.questions) { assert.ok(VISUAL_TYPES.includes(q.visual)); assert.ok(q.options.length >= 7, q.key); assert.equal(new Set(q.options.map((o) => o.key)).size, q.options.length); }
  for (const [a, b] of TENSIONS.map((t) => [t[0], t[1]])) assert.notEqual(a, b);
});

test("every picture is drawn as safe inline SVG: no style attributes, scripts, event handlers or external references", () => {
  let n = 0;
  for (const q of KINDS.brand.questions) for (const o of q.options) {
    if (q.key === "style.direction" && ["rustic", "futuristic", "gothic", "architectural", "dark"].includes(o.key)) continue; // Bundled image only.
    if (q.key === "textures.surface" && ["mosaic", "steel", "rust", "blank"].includes(o.key)) continue; // Bundled image only.
    const s = visualFor(q.visual, o, q.key);
    if (["word", "font", "tagline"].includes(q.visual)) { assert.equal(s, "", `${q.key}/${o.key} is a text card`); continue; }
    assert.match(s, /^<svg class="dv" viewBox="0 0 240 150"/, `${q.key}/${o.key}`);
    assert.ok(!/\sstyle=|<script|\son[a-z]+=|href=|xlink|url\(http|javascript:|<image|<foreignObject/i.test(s), `${q.key}/${o.key} is clean`);
    assert.ok(/aria-label="[^"<>]+"/.test(s)); n++;
  }
  assert.ok(n >= 60, `${n} drawn cards`);
  assert.equal(visualFor("palette", { label: "x", colours: ["#112233", "javascript:1", "#ABCDEF"] }).match(/<rect/g).length, 2, "only valid hex colours are drawn");
  const ids = KINDS.brand.questions.flatMap((q) => q.options.map((o) => visualFor(q.visual, o, q.key))).join("").match(/id="[^"]+"/g) || [];
  assert.equal(new Set(ids).size, ids.length, "no duplicate SVG ids on a page");
});

test("answers are normalised: unknown keys dropped, dislike beats like, not-sure keeps nothing, surprise keeps only dislikes", () => {
  const q = stageQuestions(eff, eff.stages[0])[0];
  const [k1, k2, k3] = q.options.map((o) => o.key);
  assert.deepEqual(normalizePicks(q, { like: [k1, k2, "nonsense", k1], dislike: [k2] }), { mode: "picks", like: [k1], dislike: [k2] });
  assert.equal(normalizePicks(q, { like: ["nonsense"], dislike: [] }), null, "nothing valid means no answer");
  assert.deepEqual(normalizePicks(q, { like: [k1], dislike: [k3], mode: "not_sure" }), { mode: "not_sure", like: [], dislike: [] });
  assert.deepEqual(normalizePicks(q, { like: [k1], dislike: [k3], mode: "surprise" }), { mode: "surprise", like: [], dislike: [k3] });
  assert.deepEqual(normalizePicks(q, { like: [k1], mode: "<script>" }), { mode: "picks", like: [k1], dislike: [] }, "an unknown mode is ignored");
  const fields = new Map([[`l:${q.key}:${k1}`, "1"], [`d:${q.key}:${k2}`, "1"], [`c:${q.key}`, "  nice\u0000 words  "], [`l:${q.key}:evil`, "1"]]);
  assert.deepEqual(readStageFields(fields, [q])[q.key], { picks: { mode: "picks", like: [k1], dislike: [k2] }, comment: "nice words" });
  assert.equal(cleanText("x".repeat(900), 500).length, 500); assert.equal(cleanText(42, 5), "");
  assert.equal(answerState(null), "none"); assert.equal(answerState({ picks: { mode: "surprise", like: [], dislike: [] }, comment: "" }), "surprise");
});

test("Admin edits are laid over the built-in content: reworded, hidden, reordered, added; nothing stored means the standard wording", () => {
  const q = eff.questions.find((x) => x.key === "logo.type");
  assert.equal(q.options.find((o) => o.key === "mascot").label, "Mascot");
  const rows = [
    { item_key: "logo.type", option_key: "", label: "Which logo shapes do you like?", description: null, enabled: 1 },
    { item_key: "logo.type", option_key: "mascot", label: "Character", description: "Friendly face", enabled: 1 },
    { item_key: "logo.type", option_key: "crest", label: "x", description: null, enabled: 0 },
    { item_key: "logo.type", option_key: "x-0a1b2c3d", label: "Hand lettering", description: "Custom", enabled: 1, is_custom: 1, image_id: "00000000-0000-4000-8000-000000000001", sort_order: 5 },
  ];
  const e2 = effectiveKind("brand", rows), q2 = e2.questions.find((x) => x.key === "logo.type");
  assert.equal(q2.prompt, "Which logo shapes do you like?"); assert.equal(q2.help, q.help, "help text stays when only the prompt changed");
  assert.equal(q2.options.find((o) => o.key === "mascot").label, "Character");
  assert.equal(stageQuestions(e2, e2.stages[1])[0].options.some((o) => o.key === "crest"), false, "a hidden option is not shown");
  assert.equal(stageQuestions(e2, e2.stages[1])[0].options[0].key, "x-0a1b2c3d", "sort order 5 puts the added option first");
  assert.equal(q2.options.find((o) => o.key === "crest").enabled, false);
  assert.equal(effectiveKind("website", []), null, "kinds that do not exist yet are refused");
});

test("the brief organises answers into the nine sections, finds tensions and contradictions, and lists what to clarify", () => {
  const ans = {
    "style.personality": { picks: { mode: "picks", like: ["luxurious", "minimal", "playful", "authoritative"], dislike: ["industrial"] }, comment: "quiet class" },
    "style.direction": { picks: { mode: "picks", like: ["luxury", "minimalist", "playful"], dislike: ["bold"] }, comment: "" },
    "colours.palettes": { picks: { mode: "not_sure", like: [], dislike: [] }, comment: "" },
    "logo.type": { picks: { mode: "picks", like: ["crest", "wordmark"], dislike: [] }, comment: "" },
    "layout.system": { picks: { mode: "surprise", like: [], dislike: ["dense"] }, comment: "" },
    "tagline.tone": { picks: null, comment: "Plain speaking please" },
  };
  const b = buildBrief(eff, ans, { uploads: 2, overallComment: "Thanks" });
  assert.deepEqual(b.sections.map((s) => s.key), SECTION_ORDER, "in Branding order");
  assert.equal(b.sections.length, 9);
  assert.equal(b.sections.find((s) => s.key === "colours").status, "not_sure");
  assert.equal(b.sections.find((s) => s.key === "textures").status, "unanswered");
  assert.equal(b.sections.find((s) => s.key === "style").status, "answered");
  const titles = b.conflicts.map((c) => c.title).join("|");
  assert.match(titles, /Minimal and ornate/); assert.match(titles, /Playful and serious/); assert.match(titles, /Luxury and approachable/);
  assert.ok(b.conflicts.some((c) => c.type === "tension" && c.severity === "strong"));
  assert.ok(b.clarify.some((c) => c.section === "Textures"), "an unanswered section is listed");
  assert.ok(b.clarify.some((c) => c.section === "Brand Colours" && /not sure/i.test(c.reason)));
  assert.ok(b.clarify.some((c) => /comment but no selection/.test(c.reason)), "a comment without a selection is flagged");
  assert.ok(b.clarify.some((c) => /Surprise me/.test(c.reason)));
  assert.equal(b.uploads, 2); assert.ok(b.themes.length && b.themes[0].count >= 1);
  const md = briefToMarkdown(b, { client: "Alpha" });
  for (const s of b.sections) assert.match(md, new RegExp(`## ${s.number} ${s.label}`));
  assert.match(md, /Tensions and contradictions/); assert.match(md, /To clarify/); assert.match(md, /Overall comment/);

  const cont = buildBrief(eff, { "style.personality": { picks: { mode: "picks", like: ["bold"], dislike: [] }, comment: "" }, "style.direction": { picks: { mode: "picks", like: ["minimalist"], dislike: ["bold"] }, comment: "" } });
  assert.ok(cont.conflicts.some((c) => c.type === "contradiction" && /Bold is disliked/.test(c.title)), "liking a quality in one place and disliking it in another");
  assert.equal(buildBrief(eff, {}).conflicts.length, 0); assert.equal(buildBrief(eff, {}).clarify.length, 9, "an empty assessment lists every section");
});

test("repository: an assessment belongs to one organization, statuses move one way, and another organization's id is simply not found", async () => {
  const db = world();
  const made = await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "Brand Discovery", recipientName: "Sam", actor: A }, { now: T0 });
  assert.equal(made.ok, true);
  assert.equal((await repo.createAssessment(db, { organizationId: ORG_A, kind: "website", title: "x", actor: A })).error, "invalid_kind");
  assert.equal((await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "  ", actor: A })).error, "invalid_title");
  assert.equal((await repo.createAssessment(db, { organizationId: "33333333-3333-4333-8333-333333333333", kind: "brand", title: "x", actor: A })).error, "not_found");
  const a = await repo.getAssessment(db, ORG_A, made.id);
  assert.deepEqual([a.status, a.stage, a.organizationId], ["not_started", 1, ORG_A]);
  assert.equal(await repo.getAssessment(db, ORG_B, made.id), null, "wrong organization");
  assert.deepEqual((await repo.listClientAssessments(db, ORG_B)), []);
  assert.equal((await repo.listClientAssessments(db, ORG_A)).length, 1);
  assert.equal((await repo.reviewAssessment(db, ORG_A, made.id, A, "n", { now: T0 })).error, "not_submitted", "cannot review what was not submitted");
  assert.equal((await repo.submitAssessment(db, a, { type: "client", ref: "link:x" }, { now: T0 })).error, "nothing_to_submit", "an empty assessment cannot be submitted");

  const q = stageQuestions(eff, eff.stages[0])[0];
  const first = await repo.saveAnswers(db, a, { [q.key]: { picks: { mode: "picks", like: [q.options[0].key], dislike: [] }, comment: "hello" } }, { nextStage: 2, by: { type: "client", ref: "link:abc" }, now: T0 });
  assert.equal(first.ok, true);
  const b = await repo.getAssessment(db, ORG_A, made.id);
  assert.deepEqual([b.status, b.stage, b.startedAt], ["in_progress", 2, T0.toISOString()]);
  await repo.saveAnswers(db, b, { [q.key]: { picks: { mode: "picks", like: [q.options[1].key], dislike: [] }, comment: "" } }, { nextStage: 2, by: { type: "client", ref: "link:abc" }, now: T0 });
  assert.equal(rows(db, "SELECT action FROM activity_log WHERE action = 'discovery.started'").length, 1, "started is audited once");
  const saved = await repo.getAnswers(db, made.id);
  assert.deepEqual(saved.get(q.key), { picks: { mode: "picks", like: [q.options[1].key], dislike: [] }, comment: "" });
  await repo.saveAnswers(db, b, { [q.key]: { picks: null, comment: "" } }, { nextStage: 2, by: { type: "client", ref: "link:abc" }, now: T0 });
  assert.equal((await repo.getAnswers(db, made.id)).size, 0, "an emptied answer is removed");
  await repo.saveAnswers(db, b, { [q.key]: { picks: { mode: "picks", like: [q.options[0].key], dislike: [] }, comment: "" } }, { nextStage: 6, by: { type: "client", ref: "link:abc" }, now: T0 });

  assert.equal((await repo.submitAssessment(db, b, { type: "client", ref: "link:abc" }, { now: T0 })).ok, true);
  const s = await repo.getAssessment(db, ORG_A, made.id);
  assert.deepEqual([s.status, s.submittedAt], ["submitted", T0.toISOString()]);
  assert.equal((await repo.saveAnswers(db, s, { [q.key]: { picks: { mode: "picks", like: [q.options[2].key], dislike: [] }, comment: "" } }, { nextStage: 1, by: { type: "client", ref: "link:abc" }, now: T0 })).error, "closed", "no change after a submit");
  assert.deepEqual((await repo.getAnswers(db, made.id)).get(q.key).picks.like, [q.options[0].key]);
  assert.equal((await repo.saveOverallComment(db, s, "late")).error, "closed");
  assert.equal((await repo.reviewAssessment(db, ORG_B, made.id, A, "x", { now: T0 })).error, "not_submitted", "another organization cannot review it");
  assert.equal((await repo.reviewAssessment(db, ORG_A, made.id, A, "Good brief", { now: T0 })).ok, true);
  assert.equal((await repo.getAssessment(db, ORG_A, made.id)).reviewNote, "Good brief");
  assert.equal((await repo.reopenAssessment(db, ORG_A, made.id, A, { now: T0 })).ok, true);
  const r = await repo.getAssessment(db, ORG_A, made.id);
  assert.deepEqual([r.status, r.submittedAt, r.reviewedAt], ["in_progress", null, null]);
  assert.equal((await repo.archiveAssessment(db, ORG_A, made.id, A, { now: T0 })).ok, true);
  assert.equal((await repo.listClientAssessments(db, ORG_A)).length, 0, "an archived assessment disappears from the client");
  const actions = rows(db, "SELECT action, visibility, organization_id FROM activity_log WHERE action LIKE 'discovery.%' ORDER BY created_at, rowid").map((x) => x.action);
  for (const want of ["discovery.created", "discovery.started", "discovery.submitted", "discovery.reviewed", "discovery.reopened", "discovery.archived"]) assert.ok(actions.includes(want), want);
  assert.ok(rows(db, "SELECT visibility FROM activity_log WHERE action LIKE 'discovery.%'").every((x) => x.visibility === "internal"), "never shown in the client's activity feed");
});

test("links: only the hash is stored, links expire and can be revoked, and a token resolves only its own assessment", async () => {
  const db = world();
  const a1 = (await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "One", actor: A }, { now: T0 })).id;
  const a2 = (await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "Two", actor: A }, { now: T0 })).id;
  const tok1 = "t".repeat(43), tok2 = "u".repeat(43);
  const h1 = await sha256b64url(tok1), h2 = await sha256b64url(tok2);
  assert.equal(h1.length, 43);
  const l1 = await repo.createLink(db, ORG_A, a1, { tokenHash: h1, label: "For Sam", days: 7 }, A, { now: T0 });
  await repo.createLink(db, ORG_A, a2, { tokenHash: h2 }, A, { now: T0 });
  assert.equal(l1.expiresAt, days(7).toISOString());
  assert.equal(JSON.stringify(rows(db, "SELECT * FROM discovery_links")).includes(tok1), false, "the token itself is never stored");
  assert.equal((await repo.createLink(db, ORG_B, a1, { tokenHash: await sha256b64url("z".repeat(43)) }, A, { now: T0 })).error, "not_found", "another organization cannot mint a link for it");
  assert.equal((await repo.createLink(db, ORG_A, a1, { tokenHash: "short" }, A)).error, "invalid_token");
  for (const bad of [0, 91, 1.5, "x"]) assert.equal((await repo.createLink(db, ORG_A, a1, { tokenHash: await sha256b64url("q" + bad), days: bad }, A)).error, "invalid_days");

  assert.equal((await repo.resolveLink(db, h1, { now: days(1) })).assessment.id, a1);
  assert.equal((await repo.resolveLink(db, h2, { now: days(1) })).assessment.id, a2, "each token grants only its own assessment");
  assert.equal(await repo.resolveLink(db, await sha256b64url("nope".repeat(11)), { now: days(1) }), null);
  assert.equal(await repo.resolveLink(db, tok1, { now: days(1) }), null, "the raw token is not a lookup key");
  assert.equal(await repo.resolveLink(db, h1, { now: days(8) }), null, "expired");
  assert.equal((await repo.listLinks(db, ORG_A, a1, { now: days(8) }))[0].state, "expired");
  assert.equal((await repo.listLinks(db, ORG_B, a1)).length, 0);
  assert.equal((await repo.revokeLink(db, ORG_B, a1, l1.id, A)).error, "not_found");
  assert.equal((await repo.revokeLink(db, ORG_A, a1, l1.id, A, { now: days(2) })).ok, true);
  assert.equal(await repo.resolveLink(db, h1, { now: days(2) }), null, "revoked");
  assert.equal((await repo.revokeLink(db, ORG_A, a1, l1.id, A)).error, "not_found", "already revoked");
  assert.equal((await repo.archiveAssessment(db, ORG_A, a2, A, { now: days(2) })).ok, true);
  assert.equal(await repo.resolveLink(db, h2, { now: days(2) }), null, "archiving ends its links");
  assert.equal((await repo.resolveLink(await openPortalDb({ migrate: true }), h1)), null, "a database without the migration simply finds nothing");
});

/* ====================================================================== routes: guest links and the signed-in way in */
import { makeWorld as makePortal, ORIGIN, csrfOf } from "./helpers/portal-e2e.mjs";
import * as S from "./helpers/sample-files.mjs";
import { randomToken } from "../portal/crypto.js";

const SAME = { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN };

async function portal({ discovery = true, branding = true, relationships = false } = {}) {
  const w = await makePortal({ proposed: relationships ? [...P, "0019_client_relationship.sql"] : P });
  w.env.PORTAL_FILES = fakeR2(); w.env.PORTAL_FILES_BACKUP = fakeR2();
  if (discovery) w.env.PORTAL_DISCOVERY = "1";
  if (branding) w.env.PORTAL_BRANDING = "1";
  const orgA = await w.org("alpha", "Alpha Co"), orgB = await w.org("beta", "Beta Co");
  await w.invite(orgA, "ann@alpha.test", "owner"); await w.invite(orgA, "mia@alpha.test", "member"); await w.invite(orgB, "bob@beta.test", "owner");
  const [ann, mia, bob, anon] = [w.browser(), w.browser(), w.browser(), w.browser()];
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const make = async (org, title = "Brand Discovery", recipient = "Sam") => {
    const id = (await repo.createAssessment(w.db, { organizationId: org.id, kind: "brand", title, recipientName: recipient, actor: A }, { now: w.clock.now() })).id;
    const token = randomToken();
    await repo.createLink(w.db, org.id, id, { tokenHash: await sha256b64url(token), days: 14 }, A, { now: w.clock.now() });
    return { id, token, org };
  };
  const q = (sql, ...p) => w.db.raw.prepare(sql).all(...p).map((r) => ({ ...r }));
  return { w, orgA, orgB, ann, mia, bob, anon, make, q };
}
const text = (r) => r.text();
const loc = (r) => r.headers.get("Location");
const guestPost = (b, token, n, fields, extra = {}) => b.send(`/portal/discover/${token}/${n}`, { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", ...SAME, ...extra } });
const guestMulti = (b, token, n, fields, files = [], extra = {}) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.set(k, v); for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name); return b.send(`/portal/discover/${token}/${n}`, { method: "POST", body: fd, headers: { ...SAME, ...extra } }); };

test("guest link: no account needed; welcome, six steps with real cards, saved as you go, sent at the end", async () => {
  const { w, anon, make, q, orgA } = await portal();
  const { id, token } = await make(orgA);
  const base = `/portal/discover/${token}`;
  const home = await anon.get(base);
  assert.equal(home.status, 200);
  const hh = await text(home);
  assert.match(hh, /Hello Sam/); assert.match(hh, /Start/);
  assert.equal(home.headers.getSetCookie().length, 0, "a guest link sets no cookie");
  assert.equal(home.headers.get("Cache-Control"), "no-store"); assert.equal(home.headers.get("Referrer-Policy"), "no-referrer"); assert.match(home.headers.get("X-Robots-Tag"), /noindex/);
  const csp = home.headers.get("Content-Security-Policy"); assert.match(csp, /script-src 'self'/); assert.match(csp, /default-src 'none'/);
  assert.ok(!/\sstyle=/.test(hh) && !/<script(?![^>]*\bsrc=)/.test(hh), "no inline style or inline script");
  assert.match(hh, /\/assets\/css\/discovery\.css/); assert.match(hh, /\/assets\/js\/discovery\.js/);

  assert.equal(loc(await anon.get(`${base}/3`)), `${base}/1`, "cannot skip ahead");
  const s1 = await text(await anon.get(`${base}/1`));
  assert.match(s1, /Step 1 of 6/); assert.equal((s1.match(/class="dsc__step[ "]/g) || []).length, 6);
  for (const word of ["Modern", "Luxurious", "Playful", "Rugged"]) assert.match(s1, new RegExp(`>${word}<`));
  assert.equal((s1.match(/class="dc dc--style"/g) || []).length, 20);
  const images = [...s1.matchAll(/src="\/assets\/img\/discovery-directions\/([a-z]+)\.jpg"/g)].map((m) => m[1]);
  assert.deepEqual(images.sort(), ["architectural", "bohemian", "bold", "dark", "editorial", "feminine", "futuristic", "gothic", "holistic", "industrial", "luxury", "minimalist", "modern", "mystical", "organic", "playful", "retro", "romantic", "rustic", "traditional"]);
  for (const key of images) assert.equal(readFileSync(new URL(`../../assets/img/discovery-directions/${key}.jpg`, import.meta.url)).readUInt16BE(), 0xffd8);
  assert.doesNotMatch(s1, /name="l:style\.direction:(ethereal|ornamental)"/);
  assert.match(s1, /name="l:style\.personality:modern"/); assert.doesNotMatch(s1, /name="d:/); assert.doesNotMatch(s1, /dc__no"|Not for me|✕/); assert.match(s1, /name="m:style\.personality" value="not_sure"/); assert.match(s1, /name="m:style\.personality" value="surprise"/);
  assert.match(s1, /Save and finish later/);
  assert.ok(!/name="csrf"/.test(s1), "a guest form has no session token");

  // step 1: likes + a dislike + a comment
  const r1 = await guestPost(anon, token, 1, { "l:style.personality:modern": "1", "l:style.personality:minimal": "1", "d:style.personality:rugged": "1", "c:style.personality": "Calm and clear", "l:style.direction:minimalist": "1", go: "next" });
  assert.equal(r1.status, 303); assert.equal(loc(r1), `${base}/2`);
  let a = (await repo.getAssessment(w.db, orgA.id, id));
  assert.deepEqual([a.status, a.stage], ["in_progress", 2]);
  const s2 = await text(await anon.get(`${base}/2`));
  const logoImages = [...s2.matchAll(/src="\/assets\/img\/discovery-logos\/([a-z]+)\.png"/g)].map((m) => m[1]);
  assert.deepEqual(logoImages.sort(), ["abstract", "botanical", "celestial", "combination", "crest", "emblem", "lettermark", "mascot", "ornamental", "pictorial", "script", "wordmark"]);
  for (const key of logoImages) {
    const png = readFileSync(new URL(`../../assets/img/discovery-logos/${key}.png`, import.meta.url));
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 2688);
    assert.equal(png.readUInt32BE(20), 1536);
  }
  assert.doesNotMatch(s2, /name="l:logo\.type:(spiritual|expressive)"/);
  assert.match(s2, /Framework is the example name/);
  const saved = await repo.getAnswers(w.db, id);
  assert.deepEqual(saved.get("style.personality"), { picks: { mode: "picks", like: ["modern", "minimal"], dislike: ["rugged"] }, comment: "Calm and clear" });
  const again = await text(await anon.get(`${base}/1`));
  assert.match(again, /name="l:style\.personality:modern" value="1" checked/); assert.match(again, />Calm and clear</);
  assert.equal(loc(await guestPost(anon, token, 2, { "l:logo.type:wordmark": "1", go: "back" })), `${base}/1`, "Back saves and goes back");
  assert.equal(loc(await guestPost(anon, token, 2, { "l:logo.type:wordmark": "1", go: "save" })), `${base}?n=saved`);
  assert.match(await text(await anon.get(`${base}?n=saved`)), /Saved\. You can come back/);
  assert.match(await text(await anon.get(base)), /Continue at step 2/);

  for (const [n, f] of [[2, { "l:logo.type:wordmark": "1" }], [3, { "l:typography.fonts:slab": "1", "l:tagline.tone:friendly": "1" }], [4, { "l:colours.palettes:earthy": "1" }], [5, { "l:imagery.style:flat": "1", "l:textures.surface:paper": "1", "l:iconography.icons:line": "1" }]]) {
    const r = await guestPost(anon, token, n, { ...f, go: "next" });
    assert.equal(loc(r), `${base}/${n + 1}`, `step ${n}`);
  }
  const s6 = await text(await anon.get(`${base}/6`));
  assert.match(s6, /Step 6 of 6/); assert.match(s6, /enctype="multipart\/form-data"/); assert.match(s6, /Review your answers/); assert.match(s6, /Submit Brand Discovery/); assert.doesNotMatch(s6, /Send to Framework|send them to us/);
  for (const sec of ["01 Logo", "02 Typography", "03 Brand Colours", "04 Tagline", "05 Brand Imagery", "06 Layout System", "07 Textures", "08 Iconography", "09 Design Style"]) assert.match(s6, new RegExp(sec), `${sec} appears in the review`);
  assert.match(s6, /not answered/, "unanswered questions are shown plainly");

  const png = S.png(), bad = S.text("MZ\u0090 not an image");
  const up = await guestMulti(anon, token, 6, { "l:layout.system:airy": "1", overall: "Thanks!", go: "save" }, [["mood.png", png], ["notes.exe", bad]]);
  assert.equal(up.status, 303);
  assert.match(loc(up), /e=invalid_name|e=type_not_allowed/, "the executable is refused and the page says so");
  assert.equal(q("SELECT count(*) AS n FROM discovery_uploads WHERE deleted_at IS NULL")[0].n, 1, "the valid file was added, the exe refused");
  const key = q("SELECT storage_key FROM discovery_uploads")[0].storage_key;
  assert.match(key, new RegExp(`^org/${orgA.id}/discovery/[0-9a-f-]{36}$`)); assert.ok(w.env.PORTAL_FILES.store.has(key));
  assert.equal(w.env.PORTAL_FILES.store.get(key).httpMetadata.contentType, "application/octet-stream");
  const s6b = await text(await anon.get(`${base}/6`));
  assert.match(s6b, /mood\.png/); assert.match(s6b, />Thanks!</);

  const sent = await guestMulti(anon, token, 6, { go: "submit", overall: "Thanks!" });
  assert.equal(sent.status, 303); assert.equal(loc(sent), base);
  a = await repo.getAssessment(w.db, orgA.id, id);
  assert.deepEqual([a.status, a.overallComment], ["submitted", "Thanks!"]);
  const done = await text(await anon.get(base));
  assert.match(done, /Thank you, Sam/);
  assert.equal(loc(await guestPost(anon, token, 1, { "l:style.personality:bold": "1", go: "next" })), base, "no change after sending");
  assert.ok(!(await repo.getAnswers(w.db, id)).get("style.personality").picks.like.includes("bold"));
  const actors = q("SELECT DISTINCT actor_type, actor_ref FROM activity_log WHERE action IN ('discovery.started','discovery.submitted','discovery.upload.added')");
  assert.ok(actors.every((x) => x.actor_type === "client" && /^discovery-link:[0-9a-f]{8}$/.test(x.actor_ref)), "a guest is recorded as the link, never as a person");
  assert.ok(!JSON.stringify(q("SELECT * FROM activity_log")).includes(token), "the token is never logged");
  assert.equal(q("SELECT count(*) AS n FROM brand_kits")[0].n + q("SELECT count(*) AS n FROM brand_assets")[0].n, 0, "nothing in approved branding changed");
});

test("guest link: a wrong, expired, revoked, archived or foreign link all look identical; one link opens only its own assessment; the feature can be off", async () => {
  const { w, anon, make, q, orgA, orgB } = await portal();
  const one = await make(orgA, "One", "Ann"), two = await make(orgB, "Two", "Bea");
  const h1 = await text(await anon.get(`/portal/discover/${one.token}`)), h2 = await text(await anon.get(`/portal/discover/${two.token}`));
  assert.match(h1, /Hello Ann/); assert.match(h2, /Hello Bea/); assert.ok(!h1.includes("Bea") && !h2.includes("Ann"));
  // each link writes only its own assessment, whatever the page says
  await guestPost(anon, one.token, 1, { "l:style.personality:bold": "1", go: "next" });
  assert.equal(q("SELECT count(*) AS n FROM discovery_answers WHERE assessment_id = ?", two.id)[0].n, 0);

  const closed = await anon.get(`/portal/discover/${"x".repeat(43)}`);
  assert.equal(closed.status, 404); const closedBody = await text(closed);
  assert.match(closedBody, /This link isn’t active/);
  assert.equal(await text(await anon.get("/portal/discover/short")), closedBody, "a malformed token looks the same");
  assert.equal(await text(await anon.get(`/portal/discover/${one.token}x`)), closedBody);
  w.clock.advance(15 * 86400);
  const expired = await anon.get(`/portal/discover/${one.token}`);
  assert.equal(expired.status, 404); assert.equal(await text(expired), closedBody, "expired looks the same");
  const three = await make(orgA, "Three"); // minted after the clock moved
  assert.equal((await anon.get(`/portal/discover/${three.token}`)).status, 200);
  const link = (await repo.listLinks(w.db, orgA.id, three.id, { now: w.clock.now() }))[0];
  await repo.revokeLink(w.db, orgA.id, three.id, link.id, A, { now: w.clock.now() });
  assert.equal(await text(await anon.get(`/portal/discover/${three.token}`)), closedBody, "revoked looks the same");
  const four = await make(orgA, "Four"); await repo.archiveAssessment(w.db, orgA.id, four.id, A, { now: w.clock.now() });
  assert.equal(await text(await anon.get(`/portal/discover/${four.token}`)), closedBody, "archived looks the same");

  const off = await portal({ discovery: false });
  const o = await off.make(off.orgA);
  assert.equal((await off.anon.get(`/portal/discover/${o.token}`)).status, 404, "the feature is off unless PORTAL_DISCOVERY is exactly 1");
  assert.equal((await off.ann.get(`/portal/o/alpha/branding/discovery`)).status, 404);
});

test("guest link: writes must be same-origin, bounded in size, and well-formed; answers are validated on the server", async () => {
  const { w, anon, make, q, orgA } = await portal();
  const { id, token } = await make(orgA);
  const base = `/portal/discover/${token}`;
  const evil = await anon.send(`${base}/1`, { method: "POST", body: new URLSearchParams({ "l:style.personality:modern": "1", go: "next" }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" } });
  assert.equal(evil.status, 403); assert.equal(q("SELECT count(*) AS n FROM discovery_answers")[0].n, 0);
  const big = await anon.send(`${base}/1`, { method: "POST", body: "x=1", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "999999", ...SAME } });
  assert.equal(big.status, 413);
  assert.equal((await anon.send(`${base}/1`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json", ...SAME } })).status, 400);
  assert.equal((await anon.send(`${base}/1`, { method: "POST", body: "a=1&a=2", headers: { "Content-Type": "application/x-www-form-urlencoded", ...SAME } })).status, 400, "a repeated field is refused");
  assert.equal((await anon.get(`${base}/7`)).status, 404); assert.equal((await anon.get(`${base}/0`)).status, 404); assert.equal((await anon.get(`${base}/abc`)).status, 404);
  assert.equal((await anon.send(base, { method: "PUT", headers: SAME })).status, 405);
  assert.equal((await guestMulti(anon, token, 1, { go: "save" }, [["a.png", S.png()]])).status, 400, "files are accepted only at the final step");

  // forged keys, overlong comments, dislike beats like, not-sure clears
  await guestPost(anon, token, 1, { "l:style.personality:modern": "1", "d:style.personality:modern": "1", "l:style.personality:bold": "1", "l:style.personality:../../etc": "1", "c:style.personality": "x".repeat(900), "m:style.direction": "not_sure", "l:style.direction:modern": "1", "d:style.direction:bold": "1", go: "save" });
  const ans = await repo.getAnswers(w.db, id);
  assert.deepEqual(ans.get("style.personality").picks, { mode: "picks", like: ["bold"], dislike: ["modern"] });
  assert.equal(ans.get("style.personality").comment.length, 500);
  assert.deepEqual(ans.get("style.direction").picks, { mode: "not_sure", like: [], dislike: [] });
  assert.ok(!JSON.stringify([...ans]).includes("etc"));
  // an answer from another stage's question cannot be written through this stage
  await guestPost(anon, token, 1, { "l:logo.type:wordmark": "1", go: "save" });
  assert.equal((await repo.getAnswers(w.db, id)).has("logo.type"), false);
  // nothing answered cannot be sent
  const empty = await make(orgA, "Empty"); 
  const r = await guestMulti(anon, empty.token, 6, { go: "submit" });
  assert.match(loc(r), /e=nothing_to_submit/);
  assert.match(await text(await anon.get(`/portal/discover/${empty.token}/1`)), /Step 1/);
});

test("guest uploads: pictures and PDFs only, checked by content, limited in number and size, removable, stored privately in the organization's own area", async () => {
  const { w, anon, make, q, orgA, orgB } = await portal();
  const { id, token } = await make(orgA);
  await guestPost(anon, token, 1, { "l:style.personality:modern": "1", go: "next" });
  for (const n of [2, 3, 4, 5]) await guestPost(anon, token, n, { go: "next" });
  const add = (files) => guestMulti(anon, token, 6, { go: "save" }, files);
  assert.match(loc(await add([["x.svg", S.svg()]])), /e=type_not_allowed/, "SVG can carry script: not accepted from a client");
  assert.match(loc(await add([["x.zip", S.zip([{ name: "a.txt", data: S.text("a") }])]])), /e=type_not_allowed/);
  assert.match(loc(await add([["fake.png", S.text("not really a png at all")]])), /e=content_mismatch|e=invalid_name|e=type_not_allowed/);
  assert.match(loc(await add([["../../evil.png", S.png()]])), /n=added|e=invalid_name/);
  assert.match(loc(await add([["doc.pdf", S.pdf()], ["pic.jpg", S.jpeg()], ["w.webp", S.webp()], ["extra.png", S.png()]])), /e=too_many/, "three at a time");
  const n0 = q("SELECT count(*) AS n FROM discovery_uploads WHERE deleted_at IS NULL")[0].n;
  assert.ok(n0 >= 1 && n0 <= 3);
  for (const u of q("SELECT * FROM discovery_uploads")) assert.match(u.storage_key, new RegExp(`^org/${orgA.id}/discovery/`)), assert.ok(!u.storage_key.includes(orgB.id));
  const first = q("SELECT id, storage_key FROM discovery_uploads WHERE deleted_at IS NULL")[0];
  const rm = await guestMulti(anon, token, 6, { go: "save", remove: first.id });
  assert.match(loc(rm), /n=removed/);
  assert.equal(q("SELECT count(*) AS n FROM discovery_uploads WHERE deleted_at IS NULL")[0].n, n0 - 1);
  assert.equal(w.env.PORTAL_FILES.store.has(first.storage_key), false, "the object is deleted with its row");
  // fill to the limit
  for (let i = 0; i < 6; i++) await add([[`p${i}.png`, S.png(8 + i, 8)], [`q${i}.png`, S.png(9 + i, 8)], [`r${i}.png`, S.png(10 + i, 8)]]);
  assert.ok(q("SELECT count(*) AS n FROM discovery_uploads WHERE deleted_at IS NULL")[0].n <= 10, "at most ten files");
  assert.match(loc(await add([["one-more.png", S.png(30, 30)]])), /e=file_limit/);
  assert.equal((await repo.getAssessment(w.db, orgA.id, id)).status, "in_progress");
});

test("signed in: the assessment is under Branding for the organization's own members; another organization cannot reach it; writes need the portal's CSRF token", async () => {
  const { w, ann, mia, bob, make, q, orgA } = await portal();
  const { id } = await make(orgA, "Brand Discovery");
  const list = await ann.get("/portal/o/alpha/branding/discovery");
  assert.equal(list.status, 200); const lh = await text(list);
  assert.match(lh, /Brand Discovery/); assert.match(lh, new RegExp(`/portal/o/alpha/branding/discovery/${id}`)); assert.match(lh, /Start/);
  assert.equal((await bob.get("/portal/o/alpha/branding/discovery")).status, 404, "another organization's member gets the same \"not found\" as a missing page");
  assert.equal((await bob.get(`/portal/o/alpha/branding/discovery/${id}`)).status, 404);
  assert.equal((await bob.get(`/portal/o/beta/branding/discovery/${id}`)).status, 404, "the id means nothing in another organization");
  assert.match(await text(await bob.get("/portal/o/beta/branding/discovery")), /nothing to complete/);

  const page = await ann.get(`/portal/o/alpha/branding/discovery/${id}`);
  assert.match(await text(page), /Start/);
  const s1 = await text(await ann.get(`/portal/o/alpha/branding/discovery/${id}/1`));
  const csrf = csrfOf(s1); assert.ok(csrf, "member forms carry the CSRF token");
  const post = (b, fields, extra = {}) => b.send(`/portal/o/alpha/branding/discovery/${id}/1`, { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", ...SAME, ...extra } });
  assert.equal((await post(ann, { "l:style.personality:modern": "1", go: "next" })).status, 403, "no CSRF token, no write");
  assert.equal((await post(ann, { csrf: "forged", "l:style.personality:modern": "1", go: "next" })).status, 403);
  const ok = await post(ann, { csrf, "l:style.personality:modern": "1", go: "next" });
  assert.equal(ok.status, 303); assert.equal(loc(ok), `/portal/o/alpha/branding/discovery/${id}/2`);
  assert.equal((await repo.getAnswers(w.db, id)).get("style.personality").picks.like[0], "modern");
  const miaCsrf = csrfOf(await text(await mia.get(`/portal/o/alpha/branding/discovery/${id}/1`)));
  assert.equal((await post(mia, { csrf: miaCsrf, "l:style.direction:bold": "1", go: "save" })).status, 303, "any member of the organization may answer");
  assert.equal((await post(bob, { csrf, "l:style.direction:modern": "1", go: "next" })).status, 404);
  assert.equal(q("SELECT actor_type FROM activity_log WHERE action = 'discovery.started'")[0].actor_type, "client");
  for (const n of [2, 3, 4, 5]) await post(ann, { csrf }, {}), void n;
  const doneAfter = await ann.get("/portal/o/alpha/branding/discovery");
  assert.match(await text(doneAfter), /Continue/);
  assert.equal((await ann.get(`/portal/o/alpha/branding/discovery/${id}/9`)).status, 404);
  assert.equal((await ann.get(`/portal/o/alpha/branding/discovery/not-an-id`)).status, 404);
});

test("Branding shows a Brand Discovery card only when Framework has assigned one and the feature is on; approved branding is untouched by answering", async () => {
  const { w, ann, make, q, orgA, orgB, bob } = await portal();
  const none = await text(await ann.get("/portal/o/alpha/branding"));
  assert.ok(!/Brand Discovery/.test(none), "no card until an assessment is assigned");
  const { id } = await make(orgA);
  const card = await text(await ann.get("/portal/o/alpha/branding"));
  assert.match(card, /Brand Discovery/); assert.match(card, new RegExp(`/portal/o/alpha/branding/discovery/${id}"[^>]*>Start`));
  assert.ok(!/Brand Discovery/.test(await text(await bob.get("/portal/o/beta/branding"))), "another organization sees nothing");
  const off = await portal({ discovery: false });
  await off.make(off.orgA);
  assert.ok(!/Brand Discovery/.test(await text(await off.ann.get("/portal/o/alpha/branding"))), "feature off: no card");

  const snap = () => JSON.stringify(["brand_kits", "brand_assets", "brand_requirements", "brand_uploads", "service_requests"].map((t) => q(`SELECT * FROM ${t}`)));
  const before = snap();
  const html1 = await text(await ann.get(`/portal/o/alpha/branding/discovery/${id}/1`));
  const csrf = csrfOf(html1);
  await ann.send(`/portal/o/alpha/branding/discovery/${id}/1`, { method: "POST", body: new URLSearchParams({ csrf, "l:style.personality:modern": "1", go: "save" }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", ...SAME } });
  assert.equal(snap(), before, "answering never writes to brand kits, assets, requirements, uploads or requests");
  assert.match(await text(await ann.get("/portal/o/alpha/branding")), />Continue Brand Discovery</);
});

/* ====================================================================== Admin API */
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ADMIN_ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };

async function adminWorld(over = {}) {
  resetKeyCacheForTests();
  const p = await portal(over);
  Object.assign(p.w.env, { PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const call = async (path, { method = "GET", json, form, origin = ADMIN_ORIGIN, noHeader = false } = {}) => {
    const h = { Origin: origin, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(method !== "GET" && !noHeader ? { "X-Framework-Admin": "1" } : {}) };
    let body;
    if (form) { const packed = new Response(form); const buf = new Uint8Array(await packed.arrayBuffer()); h["Content-Type"] = packed.headers.get("Content-Type"); h["Content-Length"] = String(buf.length); body = buf; }
    else if (json !== undefined) { h["Content-Type"] = "application/json"; body = JSON.stringify(json); }
    const res = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method, headers: h, body }), p.w.env, { now: p.w.clock.now() });
    const type = res.headers.get("Content-Type") || "";
    return { status: res.status, headers: res.headers, res, json: type.includes("json") ? await res.json() : null };
  };
  return { ...p, call };
}

test("Admin: create and assign an assessment, mint a secret link (shown once, hash stored), the recipient completes it with no account, Admin sees status and the brief", async () => {
  const { w, call, anon, q, orgA, orgB } = await adminWorld();
  assert.equal((await call("/clients/" + orgA.id + "/discovery", { method: "POST", json: { kind: "brand", title: "Brand Discovery", recipient_name: "Sam" }, noHeader: true })).status, 403, "writes need the Admin header");
  assert.equal((await call("/clients/" + orgA.id + "/discovery", { method: "POST", json: { kind: "brand", title: "x" }, origin: "https://evil.example" })).status, 403, "cross-site writes are refused");
  assert.equal((await call("/clients/" + orgA.id + "/discovery", { method: "POST", json: { kind: "website", title: "x" } })).status, 422, "only built kinds");
  assert.equal((await call("/clients/" + orgA.id + "/discovery", { method: "POST", json: { kind: "brand", title: "   " } })).status, 422);
  assert.equal((await call("/clients/33333333-3333-4333-8333-333333333333/discovery", { method: "POST", json: { kind: "brand", title: "x" } })).status, 404);
  const made = await call("/clients/" + orgA.id + "/discovery", { method: "POST", json: { kind: "brand", title: "Brand Discovery", recipient_name: "Sam" } });
  assert.equal(made.status, 201); const id = made.json.id;
  const list = await call("/discovery");
  assert.equal(list.json.available, true); assert.equal(list.json.assessments.length, 1);
  assert.deepEqual([list.json.assessments[0].status, list.json.assessments[0].organizationName, list.json.assessments[0].answered, list.json.assessments[0].activeLinks], ["not_started", "Alpha Co", 0, 0]);
  assert.equal((await call("/clients/" + orgB.id + "/discovery")).json.assessments.length, 0, "scoped to the client");
  assert.equal((await call(`/clients/${orgB.id}/discovery/${id}`)).status, 404, "another client's path does not reach it");

  const link = await call(`/clients/${orgA.id}/discovery/${id}/links`, { method: "POST", json: { label: "For Sam", days: 7 } });
  assert.equal(link.status, 201); assert.match(link.json.url, new RegExp(`^${ORIGIN}/portal/discover/[A-Za-z0-9_-]{43}$`));
  const token = link.json.url.split("/").pop();
  assert.equal(JSON.stringify(q("SELECT * FROM discovery_links")).includes(token), false);
  assert.equal(JSON.stringify((await call(`/clients/${orgA.id}/discovery/${id}`)).json).includes(token), false, "the link is never shown again");
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/links`, { method: "POST", json: { days: 400 } })).status, 422);
  const one = (await call(`/clients/${orgA.id}/discovery/${id}`)).json;
  assert.equal(one.links.length, 1); assert.equal(one.links[0].state, "active"); assert.equal(one.links[0].label, "For Sam");

  // the recipient answers (no account)
  const base = `/portal/discover/${token}`;
  await guestPost(anon, token, 1, { "l:style.personality:luxurious": "1", "l:style.personality:minimal": "1", "l:style.personality:playful": "1", "l:style.personality:authoritative": "1", "d:style.personality:industrial": "1", "c:style.personality": "quiet class", "l:style.direction:luxury": "1", "l:style.direction:minimalist": "1", go: "next" });
  await guestPost(anon, token, 2, { "l:logo.type:crest": "1", "l:logo.type:wordmark": "1", go: "next" });
  await guestPost(anon, token, 4, { "m:colours.palettes": "not_sure", go: "save" });
  await guestMulti(anon, token, 6, { "l:layout.system:airy": "1", overall: "Please be bold but calm", go: "save" }, [["mood.png", S.png()], ["menu.pdf", S.pdf()]]);
  let d = (await call(`/clients/${orgA.id}/discovery/${id}`)).json;
  assert.equal(d.assessment.status, "in_progress"); assert.equal(d.uploads.length, 2);
  assert.equal(d.brief.sections.length, 9);
  assert.ok(d.brief.conflicts.some((c) => /Minimal and ornate/.test(c.title)));
  assert.ok(d.brief.clarify.some((c) => c.section === "Typography"));
  assert.match(d.markdown, /## 01 Logo/); assert.match(d.markdown, /Heritage crest/); assert.match(d.markdown, /Please be bold but calm/);
  await guestMulti(anon, token, 6, { go: "submit", overall: "Please be bold but calm" });
  d = (await call(`/clients/${orgA.id}/discovery/${id}`)).json;
  assert.equal(d.assessment.status, "submitted");
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/links`, { method: "POST", json: {} })).status, 404, "no new link once it is sent");

  // an inspiration file is a download, never inline
  const file = d.uploads.find((u) => u.format === "png");
  const dl = await call(`/clients/${orgA.id}/discovery/${id}/files/${file.id}`);
  assert.equal(dl.status, 200); assert.match(dl.headers.get("Content-Disposition"), /^attachment/); assert.equal(dl.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal((await call(`/clients/${orgB.id}/discovery/${id}/files/${file.id}`)).status, 404);

  // review, reopen, archive: all audited, internal only
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/review`, { method: "POST", json: { note: "Strong direction" } })).status, 200);
  d = (await call(`/clients/${orgA.id}/discovery/${id}`)).json;
  assert.deepEqual([d.assessment.status, d.assessment.reviewNote, d.assessment.reviewedBy], ["reviewed", "Strong direction", ADMIN]);
  assert.match(await text(await anon.get(base)), /read your answers/);
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/update`, { method: "POST", json: { title: "Renamed" } })).status, 200);
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/reopen`, { method: "POST", json: {} })).status, 200);
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/reopen`, { method: "POST", json: {} })).status, 409);
  const revoke = await call(`/clients/${orgA.id}/discovery/${id}/links/${one.links[0].id}/revoke`, { method: "POST", json: {} });
  assert.equal(revoke.status, 200);
  assert.equal((await anon.get(base)).status, 404, "a revoked link stops working at once");
  assert.equal((await call(`/clients/${orgA.id}/discovery/${id}/archive`, { method: "POST", json: {} })).status, 200);
  assert.equal((await call(`/clients/${orgA.id}`+"/discovery")).json.assessments.length, 0);
  const actions = q("SELECT DISTINCT action FROM activity_log WHERE action LIKE 'discovery.%'").map((x) => x.action);
  for (const want of ["discovery.created", "discovery.link.created", "discovery.link.revoked", "discovery.started", "discovery.submitted", "discovery.reviewed", "discovery.reopened", "discovery.archived", "discovery.upload.added"]) assert.ok(actions.includes(want), want);
  assert.ok(q("SELECT visibility FROM activity_log WHERE action LIKE 'discovery.%'").every((x) => x.visibility === "internal"));
  assert.equal(q("SELECT count(*) AS n FROM brand_kits")[0].n + q("SELECT count(*) AS n FROM brand_requirements")[0].n + q("SELECT count(*) AS n FROM brand_assets")[0].n, 0, "approved branding is never touched");
});

test("Admin: customise the questions and options, add a reference picture, and the recipient's pages follow; reset returns the standard wording", async () => {
  const { w, call, anon, make, orgA } = await adminWorld();
  const { token } = await make(orgA);
  const base = `/portal/discover/${token}`;
  const ed = await call("/discovery/content?kind=brand");
  assert.equal(ed.json.available, true); assert.equal(ed.json.questions.length, 11);
  assert.deepEqual([...new Set(ed.json.questions.map((x) => x.section))].sort(), [...SECTION_ORDER].sort());
  const edit = (json) => call("/discovery/content", { method: "POST", json });
  assert.equal((await edit({ kind: "brand", item: "logo.type", label: "Which logo shapes do you like?" })).status, 200);
  assert.equal((await edit({ kind: "brand", item: "logo.type", option: "mascot", label: "Character", description: "A friendly face" })).status, 200);
  assert.equal((await edit({ kind: "brand", item: "logo.type", option: "crest", enabled: false })).status, 200);
  let page = await text(await anon.get(`${base}/1`)); void page;
  await guestPost(anon, token, 1, { go: "next" });
  page = await text(await anon.get(`${base}/2`));
  assert.match(page, /Which logo shapes do you like\?/); assert.match(page, />Character</); assert.match(page, /A friendly face/); assert.ok(!/Heritage crest/.test(page), "a hidden option is not shown");
  const added = await edit({ kind: "brand", item: "logo.type", add: { label: "Hand lettering", description: "Drawn by hand" } });
  assert.equal(added.status, 201); assert.match(added.json.key, /^x-[0-9a-f]{8}$/);
  page = await text(await anon.get(`${base}/2`));
  assert.match(page, /Hand lettering/); assert.ok(page.indexOf("Hand lettering") > page.indexOf("Signature"), "added options come last");
  await guestPost(anon, token, 2, { [`l:logo.type:${added.json.key}`]: "1", go: "save" });
  assert.deepEqual((await repo.getAnswers(w.db, (await repo.listClientAssessments(w.db, orgA.id))[0].id)).get("logo.type").picks.like, [added.json.key], "a custom option can be chosen");
  assert.equal((await edit({ kind: "brand", item: "logo.type", option: "wordmark", move: "down" })).status, 200);
  const order = (await call("/discovery/content?kind=brand")).json.questions.find((x) => x.key === "logo.type").options.map((o) => o.key);
  assert.deepEqual(order.slice(0, 2), ["lettermark", "wordmark"]);
  for (const bad of [{ kind: "nope", item: "logo.type" }, { kind: "brand", item: "nope" }, { kind: "brand", item: "logo.type", option: "nope", label: "x" }, { kind: "brand", item: "logo.type", option: "mascot", label: "" }, { kind: "brand", item: "logo.type", option: "mascot", enabled: "yes" }, { kind: "brand", item: "logo.type", option: "mascot", move: "sideways" }, { kind: "brand", item: "logo.type" }]) assert.equal((await edit(bad)).status, 422, JSON.stringify(bad));

  // a reference picture for an option
  const fd = new FormData(); fd.set("meta", JSON.stringify({ kind: "brand", item: "logo.type", option: "pictorial", alt: "A mountain mark" })); fd.append("file", new Blob([S.png()]), "ref.png");
  const up = await call("/discovery/content/image", { method: "POST", form: fd });
  assert.equal(up.status, 201);
  const bad = new FormData(); bad.set("meta", JSON.stringify({ kind: "brand", item: "logo.type", option: "pictorial" })); bad.append("file", new Blob([S.svg()]), "ref.svg");
  assert.equal((await call("/discovery/content/image", { method: "POST", form: bad })).status, 415, "only png, jpg and webp");
  page = await text(await anon.get(`${base}/2`));
  const img = /<img class="dv dv--photo" src="([^"]+)"/.exec(page); assert.ok(img, "the recipient sees the picture");
  assert.ok(img[1].startsWith(`${base}/media/`));
  const media = await anon.get(img[1]);
  assert.equal(media.status, 200); assert.equal(media.headers.get("Content-Type"), "image/png"); assert.equal(media.headers.get("X-Content-Type-Options"), "nosniff");
  const stored = w.env.PORTAL_FILES.store; const keys = [...stored.keys()].filter((k) => k.includes("/catalogue/")); assert.equal(keys.length, 1);
  assert.equal((await anon.get(`${base}/media/00000000-0000-4000-8000-000000000000`)).status, 404, "an id that is not a discovery picture is not served");
  assert.equal((await anon.get(`/portal/discover/${"z".repeat(43)}/media/${img[1].split("/").pop()}`)).status, 404, "pictures need a valid link");
  assert.equal((await call(`/discovery/media/${img[1].split("/").pop()}`)).status, 200, "Admin can view it");
  const cid = (await call("/discovery/content?kind=brand")).json.questions.find((x) => x.key === "logo.type").options.find((o) => o.key === "pictorial").contentId;
  assert.equal((await call(`/discovery/content/${cid}/image/delete`, { method: "POST", json: {} })).status, 200);
  assert.equal([...stored.keys()].filter((k) => k.includes("/catalogue/")).length, 0, "the picture is deleted from storage");
  assert.ok(!/<img class="dv dv--photo"/.test(await text(await anon.get(`${base}/2`))));

  // reset
  assert.equal((await edit({ kind: "brand", item: "logo.type", reset: true })).status, 200);
  assert.equal((await edit({ kind: "brand", item: "logo.type", option: "crest", reset: true })).status, 200);
  assert.equal((await edit({ kind: "brand", item: "logo.type", option: "mascot", reset: true })).status, 200);
  page = await text(await anon.get(`${base}/2`));
  assert.match(page, /Which kinds of logo do you like\?/); assert.match(page, /Heritage crest/); assert.match(page, />Mascot</);
});

test("Admin: before migration 0018 the screens say so plainly and nothing breaks", async () => {
  resetKeyCacheForTests();
  const w = await makePortal({ skip: ["0018_discovery.sql"] });
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_DISCOVERY: "1", PORTAL_BRANDING: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const org = await w.org("alpha", "Alpha Co");
  await w.invite(org, "ann@alpha.test", "owner"); const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const call = async (path, o = {}) => { const h = { Origin: ADMIN_ORIGIN, "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }), ...(o.method === "POST" ? { "X-Framework-Admin": "1", "Content-Type": "application/json" } : {}) }; const r = await handleAdmin(new Request(ADMIN_ORIGIN + "/api/admin" + path, { method: o.method || "GET", headers: h, body: o.json ? JSON.stringify(o.json) : undefined }), w.env, {}); return { status: r.status, json: (r.headers.get("Content-Type") || "").includes("json") ? await r.json() : null }; };
  const l = await call("/discovery"); assert.equal(l.status, 200); assert.equal(l.json.available, false);
  assert.equal((await call("/discovery/content?kind=brand")).json.available, false);
  assert.equal((await call("/discovery/content", { method: "POST", json: { kind: "brand", item: "logo.type", label: "x" } })).status, 409);
  const made = await call(`/clients/${org.id}/discovery`, { method: "POST", json: { kind: "brand", title: "x" } });
  assert.equal(made.status, 409, "creating before the migration says so plainly");
  assert.equal((await ann.get("/portal/o/alpha/branding/discovery")).status, 200, "the member page shows its empty state");
  assert.equal((await ann.get("/portal/o/alpha/branding")).status, 200, "Branding is unaffected");
  assert.equal((await ann.get(`/portal/discover/${"q".repeat(43)}`)).status, 404);
});

/* ====================================================================== inclusive content (any industry) */
import { readFileSync } from "node:fs";
import * as brandRepo from "../portal/repo/brand.js";
const LEGACY = JSON.parse(readFileSync(new URL("./fixtures-discovery-legacy-keys.json", import.meta.url), "utf8")); // every question and option key as first released

test("existing assessments stay compatible: every original question and option key still exists, answers using them still read and make a brief", () => {
  const def = KINDS.brand;
  for (const [qk, keys] of Object.entries(LEGACY)) {
    const q = def.questions.find((x) => x.key === qk);
    assert.ok(q, `question ${qk} still exists`);
    for (const k of keys) assert.ok(q.options.some((o) => o.key === k), `${qk}/${k} still exists (saved answers refer to it)`);
  }
  const answers = {};
  for (const q of eff.questions) answers[q.key] = { picks: { mode: "picks", like: LEGACY[q.key].slice(0, 3), dislike: LEGACY[q.key].slice(3, 4) }, comment: "kept" };
  const brief = buildBrief(eff, answers);
  assert.equal(brief.sections.length, 9);
  for (const s of brief.sections) assert.ok(["answered", "partial"].includes(s.status), `${s.key} still reads as answered`);
  for (const q of eff.questions) { const n = normalizePicks(q, { like: LEGACY[q.key], dislike: [] }); assert.deepEqual(n.like, LEGACY[q.key], `${q.key}: every original key is still accepted`); }
  assert.equal(JSON.stringify(def.questions.map((q) => q.options.slice(0, LEGACY[q.key].length).map((o) => o.key))), JSON.stringify(def.questions.map((q) => LEGACY[q.key])), "new options were only added at the end, so any Admin ordering keeps its meaning");
});

test("the assessment suits any industry: new creative directions, logo forms, type styles, taglines, textures and the two new palettes", () => {
  const q = (k) => KINDS.brand.questions.find((x) => x.key === k);
  const keys = (k) => q(k).options.map((o) => o.key);
  for (const k of ["holistic", "mystical", "ethereal", "romantic", "feminine", "bohemian", "ornamental"]) assert.ok(keys("style.direction").includes(k), `direction ${k}`);
  for (const k of ["modern", "industrial", "minimalist", "traditional", "luxury", "bold"]) assert.ok(keys("style.direction").includes(k), `the original direction ${k} is kept`);
  for (const k of ["celestial", "botanical", "ornamental", "spiritual", "expressive"]) assert.ok(keys("logo.type").includes(k), `logo ${k}`);
  for (const k of ["elegant-italic", "calligraphic", "handwritten", "deco", "old-style"]) assert.ok(keys("typography.fonts").includes(k), `type ${k}`);
  for (const k of ["healing", "balance", "connection", "transformation", "growth", "inspiring"]) assert.ok(keys("tagline.style").includes(k), `tagline ${k}`);
  for (const k of ["watercolour", "floral", "gilded", "starfield"]) assert.ok(keys("textures.surface").includes(k), `texture ${k}`);
  const pal = Object.fromEntries(q("colours.palettes").options.map((o) => [o.key, o]));
  assert.deepEqual([pal["velvet-ritual"].label, pal["velvet-ritual"].colours], ["Velvet & Ritual", ["#291329", "#5C253F", "#913E54", "#C49A65", "#E9D6C7"]]);
  assert.deepEqual([pal["moonlit-amethyst"].label, pal["moonlit-amethyst"].colours], ["Moonlit Amethyst", ["#211B3D", "#493267", "#765A9D", "#B8A4D2", "#F2E9DD"]]);
  for (const k of ["velvet-ritual", "moonlit-amethyst"]) { const svg = visualFor("palette", pal[k], "colours.palettes"); assert.equal((svg.match(/<rect/g) || []).length, 5, `${k} is drawn like the other palettes: five swatches`); }
  // no contractor-only wording anywhere in what a recipient reads
  const words = JSON.stringify([KINDS.brand.intro, KINDS.brand.stages, KINDS.brand.questions.map((x) => [x.prompt, x.help, x.options.map((o) => [o.label, o.note, o.sample])])]);
  assert.ok(!/roof|contractor|tradesp|job ?site|working-site|\bvan\b|Calgary|Alberta|plumb|renovat/i.test(words), "no trade-specific wording or examples");
  // the wellness-leaning options are additions, not the whole assessment
  const wellness = ["holistic", "mystical", "ethereal"].length + ["healing", "balance", "connection", "transformation", "growth"].length;
  assert.ok(wellness < KINDS.brand.questions.flatMap((x) => x.options).length / 6, "creative and wellness options are a small share of all options");
});

test("drawings: the heritage crest keeps its text inside the ribbon and clear of the border; badge icons are centred and evenly sized", () => {
  const crest = visualFor("logo", { key: "crest", label: "Heritage crest" }, "logo.type");
  const ribbon = /<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)" fill="#0A0A0A"\/>/.exec(crest);
  assert.ok(ribbon, "the date sits on a ribbon below the shield");
  const [rx, ry, rw, rh] = ribbon.slice(1).map(Number);
  const dateText = /<text x="(\d+)" y="(\d+)"[^>]*font-size="(\d+)"[^>]*letter-spacing="(\d+)"[^>]*>EST\. 1987</.exec(crest);
  const [tx, ty, size, spacing] = dateText.slice(1).map(Number);
  const width = 9 * (size * 0.62 + spacing); // generous estimate: nine characters
  assert.ok(tx - width / 2 > rx && tx + width / 2 < rx + rw, `the date (${Math.round(width)}px wide) fits inside the ribbon (${rw}px)`);
  assert.ok(ty > ry && ty < ry + rh, "and sits vertically within it");
  // the shield's lowest point is above the ribbon text, so no text can touch the decorative border
  assert.ok(Math.max(...[...crest.matchAll(/<text x="\d+" y="(\d+)"[^>]*>YB</g)].map((m) => Number(m[1]))) < 80, "the initials sit in the wide upper part of the shield");

  const centres = [[12, 12], [12, 13], [12, 11.65], [12, 11.5]]; // measured centres of the four glyphs (see visuals.js)
  for (const key of ["line", "solid", "duotone", "rounded", "sharp", "hand", "badge"]) {
    const svg = visualFor("icons", { key, label: key }, "iconography.icons");
    const groups = [...svg.matchAll(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([\d.]+)\)">/g)];
    assert.equal(groups.length, 4, `${key}: four symbols`);
    const sizes = new Set(groups.map((g) => g[3])); assert.equal(sizes.size, 1, `${key}: one consistent size`);
    const cxs = groups.map((g, i) => Number(g[1]) + centres[i][0] * Number(g[3])), cys = groups.map((g, i) => Number(g[2]) + centres[i][1] * Number(g[3]));
    cys.forEach((cy) => assert.ok(Math.abs(cy - 75) < 0.05, `${key}: every symbol is centred vertically on the tile`));
    assert.ok(Math.abs((cxs[0] + cxs[3]) / 2 - 120) < 0.05, `${key}: the row is centred on the tile`);
    const gaps = cxs.slice(1).map((x, i) => +(x - cxs[i]).toFixed(2)); assert.equal(new Set(gaps).size, 1, `${key}: even spacing`);
    if (key === "badge") {
      const circles = [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)];
      assert.equal(circles.length, 4);
      circles.forEach((c, i) => { assert.ok(Math.abs(Number(c[1]) - cxs[i]) < 0.05 && Math.abs(Number(c[2]) - cys[i]) < 0.05, `badge ${i + 1}: the symbol is centred in its circle`); assert.ok(18 * Number(groups[i][3]) <= Number(c[3]) * 2 * 0.7, "the symbol fills no more than 70% of the circle"); });
    }
  }
});


/* ---- privacy and retention ---- */
test("privacy: the guest welcome page carries the notice (guests only), and privacy.html covers Brand Discovery with the same promises", async () => {
  const { anon, ann, make, orgA } = await portal();
  const { id, token } = await make(orgA);
  const guest = await (await anon.get(`/portal/discover/${token}`)).text();
  assert.match(guest, /<h2 class="dsc__privacy-h" id="dsc-privacy">Your privacy<\/h2>/);
  for (const fact of [/only to prepare your brand brief/, /private backup copy/, /anyone who has it can open this form until it expires/, /90 days after that/, /hello@frameworkco\.ca/, /href="\/privacy\.html#discovery"/]) assert.match(guest, fact);
  assert.doesNotMatch(guest, /<script[^>]*>[^<]/, "no inline script");
  const member = await (await ann.get(`/portal/o/alpha/branding/discovery/${id}`)).text();
  assert.doesNotMatch(member, /dsc-privacy/, "a signed-in client is covered by the portal section, so the guest notice is not repeated");
  const policy = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8");
  const sec = policy.slice(policy.indexOf('<h2 id="discovery">'), policy.indexOf('<h2 id="marketing">'));
  assert.ok(sec.length > 1500, "a Brand Discovery section exists");
  for (const fact of [/no account and no sign-in/, /scrambled version of the link/, /PNG, JPG, WebP or PDF/, /second, private backup copy/, /90 days after that relationship ends/, /within 90 days after the removal/, /hello@frameworkco\.ca/, /within 30 days/, /14 days/, /backup copies of those files, at the same time/]) assert.match(sec, fact);
  assert.doesNotMatch(policy, /scheduled process/, "the policy does not claim an automated backup purge, which is a switch that is off in the repository");
  assert.match(policy, /Brand Discovery answers, comments and inspiration files:<\/strong> kept while we work with the organization and for 90 days/, "the retention list names it");
});

test("retention: removing a Discovery upload keeps only its type and size (name and hash scrubbed), and its backup copy follows the 90-day rule", async () => {
  const db = openPortalDb({ proposed: P });
  db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, 'alpha', 'Alpha Co')").run(ORG_A);
  const made = await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "Brand Discovery", recipientName: "Sam", actor: "a@b.c" }, { now: T0 });
  const assessment = { id: made.id, organizationId: ORG_A };
  const key = (n) => `org/${ORG_A}/discovery/00000000-0000-4000-8000-00000000000${n}`;
  const add = (n) => repo.addUpload(db, assessment, { name: "Sam Private Name.png", ext: "png", contentType: "image/png", size: 10, sha256: "ab".repeat(32), key: key(n) }, { type: "client", ref: "guest" }, { now: T0 });
  const one = await add(1), two = await add(2);
  assert.equal((await repo.removeUpload(db, assessment, one.id, { type: "client", ref: "guest" }, { now: T0 })).ok, true);
  const gone = db.raw.prepare("SELECT original_name, sha256, deleted_at FROM discovery_uploads WHERE id = ?").get(one.id);
  assert.equal(gone.original_name, "deleted"); assert.equal(gone.sha256, "0".repeat(64)); assert.ok(gone.deleted_at);
  assert.equal(db.raw.prepare("SELECT original_name FROM discovery_uploads WHERE id = ?").get(two.id).original_name, "Sam Private Name.png", "a kept file is untouched");
  const primary = fakeR2(), backup = fakeR2();
  await backup.put(key(1), new Uint8Array([1])); await backup.put(key(2), new Uint8Array([2])); // both objects missing from the main bucket: one deleted, one live
  assert.deepEqual([...(await restorableKeys(db, [key(1), key(2)]))], [key(2)], "a deliberately removed file is never restored; a live one is");
  const early = await backupPurge({ db, primary, backup, now: days(89), dryRun: false });
  assert.deepEqual([early.deleted, early.waiting, early.protected], [0, 1, 1], "inside the 90 days the removed file waits; the live file is protected");
  const late = await backupPurge({ db, primary, backup, now: days(91), dryRun: false });
  assert.deepEqual([late.deleted, late.protected], [1, 1]);
  assert.equal(backup.store.has(key(1)), false, "the removed file's backup copy is gone"); assert.equal(backup.store.has(key(2)), true, "the live file's backup copy stays");
});


/* ---- permanent deletion and the 90-day retention job ---- */
const DAY = 86400000;
async function withFiles(w, org, make, n = 2) {
  const { id, token } = await make(org);
  const a = { id, organizationId: org.id };
  const keys = [];
  for (let i = 0; i < n; i++) {
    const key = `org/${org.id}/discovery/00000000-0000-4000-8000-00000000010${i}`;
    await w.env.PORTAL_FILES.put(key, new Uint8Array([i])); await w.env.PORTAL_FILES_BACKUP.put(key, new Uint8Array([i])); keys.push(key);
    await repo.addUpload(w.db, a, { name: `f${i}.png`, ext: "png", contentType: "image/png", size: 10, sha256: "ab".repeat(32), key }, { type: "client", ref: "guest" }, { now: w.clock.now() });
  }
  const saved = await repo.saveAnswers(w.db, a, { "style.personality": { picks: { like: ["modern"], dislike: [], mode: "picks" }, comment: "Sam wrote this" } }, { nextStage: 1, by: { type: "client", ref: "guest" }, now: w.clock.now() });
  assert.equal(saved.ok, true);
  return { id, token, keys };
}

test("Admin: Delete permanently removes the assessment, its answers, links, upload records, files and backup copies, leaves a counts-only audit entry, and touches nothing else", async () => {
  const { w, call, make, q, orgA, orgB, anon } = await adminWorld();
  const mine = await withFiles(w, orgA, make), other = await withFiles(w, orgB, make, 1);
  const url = `/clients/${orgA.id}/discovery/${mine.id}/delete`;
  assert.equal((await call(url, { method: "POST", json: { confirm: "DELETE" }, noHeader: true })).status, 403, "writes need the Admin header");
  assert.equal((await call(url, { method: "POST", json: {} })).status, 422, "the word DELETE is required");
  assert.equal((await call(`/clients/${orgB.id}/discovery/${mine.id}/delete`, { method: "POST", json: { confirm: "DELETE" } })).status, 404, "another client's path does not reach it");
  assert.equal(w.env.PORTAL_FILES.store.size, 3);
  const done = await call(url, { method: "POST", json: { confirm: "DELETE" } });
  assert.equal(done.status, 200); assert.equal(done.json.files, 2);
  for (const k of mine.keys) { assert.equal(w.env.PORTAL_FILES.store.has(k), false); assert.equal(w.env.PORTAL_FILES_BACKUP.store.has(k), false, "the backup copy goes too"); }
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE id = ?", mine.id)[0].n, 0);
  for (const t of ["discovery_uploads", "discovery_answers", "discovery_links"]) assert.equal(q(`SELECT count(*) AS n FROM ${t} WHERE assessment_id = ?`, mine.id)[0].n, 0, t);
  assert.equal(w.env.PORTAL_FILES.store.has(other.keys[0]), true, "another organization's file is untouched");
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE id = ?", other.id)[0].n, 1);
  const log = q("SELECT detail, actor_ref FROM activity_log WHERE action = 'discovery.erased'");
  assert.equal(log.length, 1); assert.deepEqual(JSON.parse(log[0].detail), { files: 2, via: "admin" }); assert.equal(JSON.stringify(log).includes("Sam"), false);
  assert.equal((await anon.get(`/portal/discover/${mine.token}`)).status, 404, "the guest link no longer works");
  assert.equal((await call(url, { method: "POST", json: { confirm: "DELETE" } })).status, 404, "a second delete finds nothing");
});

test("Admin: if a file cannot be deleted nothing in the database changes, and the same request can be repeated", async () => {
  const { w, call, make, q, orgA } = await adminWorld();
  const mine = await withFiles(w, orgA, make);
  const realDelete = w.env.PORTAL_FILES.delete.bind(w.env.PORTAL_FILES);
  w.env.PORTAL_FILES.delete = async () => { throw new Error("locked"); };
  const bad = await call(`/clients/${orgA.id}/discovery/${mine.id}/delete`, { method: "POST", json: { confirm: "DELETE" } });
  assert.equal(bad.status, 502);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE id = ?", mine.id)[0].n, 1); assert.equal(q("SELECT count(*) AS n FROM discovery_uploads WHERE assessment_id = ?", mine.id)[0].n, 2);
  w.env.PORTAL_FILES.delete = realDelete;
  assert.equal((await call(`/clients/${orgA.id}/discovery/${mine.id}/delete`, { method: "POST", json: { confirm: "DELETE" } })).status, 200);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 0);
});

test("relationship end date: Admin records, changes and clears it (not in the future, audited); before migration 0019 it is simply unavailable", async () => {
  const { w, call, orgA, orgB, q } = await adminWorld({ relationships: true });
  const url = `/clients/${orgA.id}/relationship`, today = w.clock.now().toISOString().slice(0, 10);
  assert.equal((await call(url, { method: "POST", json: { ended_on: "2026-01-31" }, noHeader: true })).status, 403);
  for (const bad of ["tomorrow", "2026-13-01", "2026-02-30", "1999-01-01", new Date(w.clock.now().getTime() + 2 * DAY).toISOString().slice(0, 10)]) assert.equal((await call(url, { method: "POST", json: { ended_on: bad } })).status, 422, String(bad));
  assert.equal((await call("/clients/33333333-3333-4333-8333-333333333333/relationship", { method: "POST", json: { ended_on: today } })).status, 404);
  assert.equal((await call(url, { method: "POST", json: { ended_on: "2026-01-31" } })).status, 200);
  assert.equal((await call(url, { method: "POST", json: { ended_on: "2026-02-15" } })).status, 200);
  assert.deepEqual(q("SELECT organization_id, ended_on, set_by FROM client_relationships"), [{ organization_id: orgA.id, ended_on: "2026-02-15", set_by: ADMIN }]);
  const view = (await call("/discovery/retention")).json;
  assert.equal(view.available, true); assert.equal(view.days, 90); assert.equal(view.capabilities.retentionEnabled, false); assert.equal(view.relationships.length, 1); assert.equal(view.relationships[0].organizationName, "Alpha Co");
  assert.equal((await call(url, { method: "POST", json: { ended_on: null } })).status, 200);
  assert.equal(q("SELECT count(*) AS n FROM client_relationships")[0].n, 0);
  assert.equal((await call(`/clients/${orgB.id}/relationship`, { method: "POST", json: { ended_on: null } })).status, 404, "nothing to clear");
  assert.deepEqual(q("SELECT action FROM activity_log WHERE action LIKE 'relationship.%' ORDER BY created_at, action").map((r) => r.action).sort(), ["relationship.ended", "relationship.ended", "relationship.resumed"]);
  const before = await adminWorld();
  assert.equal((await before.call("/discovery/retention")).json.available, false);
  assert.equal((await before.call(`/clients/${before.orgA.id}/relationship`, { method: "POST", json: { ended_on: "2026-01-31" } })).status, 409);
});

test("retention job: OFF by default (a dry run only counts), real only with the switch AND an explicit end date 90+ days old, bounded, and it never touches the others", async () => {
  const { w, call, make, q, orgA, orgB } = await adminWorld({ relationships: true });
  const a = await withFiles(w, orgA, make), b = await withFiles(w, orgB, make, 1);
  const today = (n) => new Date(w.clock.now().getTime() - n * DAY).toISOString().slice(0, 10);
  const run = (body) => call("/discovery/retention/run", { method: "POST", json: { confirm: "RETENTION", ...body } });
  assert.equal((await call("/discovery/retention/run", { method: "POST", json: { dry_run: false } })).status, 422, "typed confirmation required");
  // archived and old, but NO end date recorded: never touched
  await repo.archiveAssessment(w.db, orgA.id, a.id, A, { now: w.clock.now() });
  let r = (await run({ dry_run: false })).json;
  assert.deepEqual([r.due, r.erased, r.dryRun, r.enabled], [0, 0, true, false]);
  await call(`/clients/${orgA.id}/relationship`, { method: "POST", json: { ended_on: today(89) } });
  r = (await run({ dry_run: false })).json; assert.deepEqual([r.due, r.erased], [0, 0], "89 days is not yet due");
  await call(`/clients/${orgA.id}/relationship`, { method: "POST", json: { ended_on: today(91) } });
  r = (await run({})).json; assert.deepEqual([r.due, r.erased, r.dryRun], [1, 0, true], "a dry run reports what is due");
  r = (await run({ dry_run: false })).json; assert.deepEqual([r.due, r.erased, r.dryRun, r.enabled], [1, 0, true, false], "asking for a real run while the switch is off is still a dry run");
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 2); assert.equal(w.env.PORTAL_FILES.store.size, 3);
  w.env.PORTAL_DISCOVERY_RETENTION = "1";
  assert.equal((await run({})).json.dryRun, true, "dry run is still the default with the switch on");
  r = (await run({ dry_run: false })).json; assert.deepEqual([r.ok, r.due, r.erased, r.dryRun, r.enabled], [true, 1, 1, false, true]);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE id = ?", a.id)[0].n, 0); assert.equal(w.env.PORTAL_FILES.store.has(a.keys[0]), false); assert.equal(w.env.PORTAL_FILES_BACKUP.store.has(a.keys[1]), false);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE id = ?", b.id)[0].n, 1, "an organization with no end date is untouched"); assert.equal(w.env.PORTAL_FILES.store.has(b.keys[0]), true);
  assert.deepEqual(JSON.parse(q("SELECT detail FROM activity_log WHERE action = 'discovery.erased'")[0].detail), { files: 2, via: "retention" });
  // a few per run: five due assessments take two runs of three... (limit 3)
  const many = []; for (let i = 0; i < 5; i++) many.push((await make(orgB, "More " + i)).id);
  await call(`/clients/${orgB.id}/relationship`, { method: "POST", json: { ended_on: today(200) } });
  const first = (await run({ dry_run: false })).json; assert.deepEqual([first.erased, first.remaining], [3, 3]);
  const second = (await run({ dry_run: false })).json; assert.deepEqual([second.erased, second.remaining], [3, 0]);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments WHERE organization_id = ?", orgB.id)[0].n, 0);
});

test("retention job: clearing the date cancels it, a date changed after the plan stops the delete, an unreadable database or missing storage deletes nothing, and the cron only runs it when switched on", async () => {
  const { w, make, q, orgA } = await adminWorld({ relationships: true });
  const { eraseAssessment, runRetention, cutoffFor } = await import("../portal/discovery/retention.js");
  const { runScheduled } = await import("../portal/scheduled.js");
  const a = await withFiles(w, orgA, make);
  const now = w.clock.now(), cutoff = cutoffFor(now);
  assert.equal(cutoff, new Date(now.getTime() - 90 * DAY).toISOString().slice(0, 10));
  const deps = { db: w.db, bucket: w.env.PORTAL_FILES, backup: w.env.PORTAL_FILES_BACKUP };
  w.db.raw.prepare("INSERT INTO client_relationships (organization_id, ended_on, set_at, set_by) VALUES (?, ?, ?, 'x')").run(orgA.id, cutoff, now.toISOString());
  w.db.raw.prepare("UPDATE client_relationships SET ended_on = ? WHERE organization_id = ?").run(new Date(now.getTime() - 10 * DAY).toISOString().slice(0, 10), orgA.id); // re-engaged after the plan
  assert.equal((await eraseAssessment(deps, { organizationId: orgA.id, assessmentId: a.id, actor: "retention", now, endedBefore: cutoff })).error, "not_due");
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 1); assert.equal(w.env.PORTAL_FILES.store.size, 2, "files untouched when the date no longer qualifies");
  w.db.raw.prepare("UPDATE client_relationships SET ended_on = ? WHERE organization_id = ?").run(cutoff, orgA.id);
  const env = { PORTAL_DB: w.db, PORTAL_FILES: w.env.PORTAL_FILES, PORTAL_FILES_BACKUP: w.env.PORTAL_FILES_BACKUP, PORTAL_DISCOVERY_RETENTION: "1" };
  assert.equal((await runRetention({ ...env, PORTAL_FILES: undefined }, { now, dryRun: false })).skipped, "storage_unavailable");
  const broken = { prepare: () => { throw new Error("db down"); } };
  const dead = await runRetention({ ...env, PORTAL_DB: broken }, { now, dryRun: false });
  assert.deepEqual([dead.ok, dead.skipped, dead.erased], [false, "database_unreadable", 0]);
  assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 1);
  const off = await runScheduled({ PORTAL_DB: w.db, PORTAL_FILES: w.env.PORTAL_FILES, PORTAL_FILES_BACKUP: w.env.PORTAL_FILES_BACKUP }, { now });
  assert.equal(off.retention, undefined); assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 1, "the cron does nothing about retention while it is switched off");
  const on = await runScheduled(env, { now });
  assert.equal(on.retention.erased, 1); assert.equal(q("SELECT count(*) AS n FROM discovery_assessments")[0].n, 0);
});

test("retention: the migration is additive, proposed only, and the code never reads archiving or status to decide a deletion", () => {
  const sql = readFileSync(new URL("../../migrations/portal-proposed/0019_client_relationship.sql", import.meta.url), "utf8");
  assert.match(sql, /CREATE TABLE IF NOT EXISTS client_relationships/); assert.doesNotMatch(sql.replace(/--.*$/gm, "").replace(/ON DELETE RESTRICT/g, ""), /\b(DROP|DELETE|UPDATE|ALTER|INSERT)\b/i);
  const code = readFileSync(new URL("../portal/discovery/retention.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /archived_at|organizations\b.*status/, "no inference from archiving or status");
  assert.match(code, /FROM discovery_assessments a JOIN client_relationships r/, "only organizations with an explicit end date are ever planned");
});


/* ---- client feedback round: final submit, dashboard flag, Branding card and intro, image progress, four new picture styles ---- */
test("final step: no confusing instruction, a big Submit panel that says what it does, a plain Submit in the sticky bar, and nothing like it on the other steps", async () => {
  const { anon, make, orgA } = await portal();
  const { token } = await make(orgA);
  for (const f of [{ "l:style.personality:modern": "1" }, { "l:logo.type:wordmark": "1" }, { "l:typography.fonts:serif-modern": "1" }, { "l:colours.palettes:luxury": "1" }, { "l:imagery.style:detail": "1" }]) { const n = [{ "l:style.personality:modern": 1 }, { "l:logo.type:wordmark": 2 }, { "l:typography.fonts:serif-modern": 3 }, { "l:colours.palettes:luxury": 4 }, { "l:imagery.style:detail": 5 }].find((x) => Object.keys(x)[0] === Object.keys(f)[0]); await guestPost(anon, token, Object.values(n)[0], { ...f, go: "next" }); }
  const s6 = await text(await anon.get(`/portal/discover/${token}/6`));
  assert.doesNotMatch(s6, /send them to us|check your choices and send/i);
  assert.match(s6, /This is the last step: check your answers, then press Submit at the bottom/);
  const panel = /<section class="dsubmit"[\s\S]*?<\/section>/.exec(s6)[0];
  assert.match(panel, /Ready to submit\?/); assert.match(panel, /Press <strong>Submit<\/strong> to send your answers to Framework\. That completes your Brand Discovery/);
  assert.match(panel, /<button class="btn btn--primary btn--lg dsubmit__btn" type="submit" name="go" value="submit">Submit Brand Discovery<\/button>/);
  assert.match(s6, /<nav class="dsc__nav"[\s\S]*name="go" value="submit">Submit<\/button>/, "the sticky bar keeps a plain Submit, so it is reachable on a phone without scrolling");
  assert.ok(s6.indexOf('class="dsubmit"') > s6.indexOf('id="q-overall"') && s6.indexOf('class="dsubmit"') < s6.indexOf('class="dsc__nav"'), "the panel comes after everything to fill in and before the nav");
  assert.doesNotMatch(await text(await anon.get(`/portal/discover/${token}/3`)), /dsubmit/, "only the last step has a submit panel");
  const sent = await guestMulti(anon, token, 6, { go: "submit", overall: "ok" }); assert.equal(sent.status, 303);
  assert.match(await text(await anon.get(`/portal/discover/${token}`)), /Your Brand Discovery has been submitted/);
});

test("portal home: the Branding card carries a red dot and 'New Brand Discovery available' while one is not started, 'in progress' while under way, a quiet note once sent; a published brand never hides it", async () => {
  const { w, ann, make, orgA, q } = await portal();
  const home = async () => text(await ann.get("/portal/o/alpha"));
  const card = (html) => /<a class="hub" href="[^"]*\/branding"[\s\S]*?<\/a>/.exec(html)[0];
  assert.doesNotMatch(card(await home()), /Brand Discovery|hub__flag/, "nothing assigned: nothing shown");
  const { id } = await make(orgA);
  let c = card(await home());
  assert.match(c, /<p class="tile__action"><span class="dot dot--attention" aria-hidden="true"><\/span>New Brand Discovery available<\/p>/); assert.match(c, /class="hub__flag"[\s\S]*Needs your attention/); assert.match(c, /Not published yet/);
  assert.ok(brandRepo && (await brandRepo.saveBrandKit(w.db, orgA.id, { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a", note: "" }], typography: [] }, A)).ok);
  assert.ok((await brandRepo.setBrandKitStatus(w.db, orgA.id, "published", A)).ok);
  c = card(await home());
  assert.match(c, /Brand system published/, "the brand's own status is still there"); assert.match(c, /New Brand Discovery available/, "and it does not hide the new assessment");
  assert.ok(c.indexOf("New Brand Discovery available") < c.indexOf("Brand system published"), "the assessment is listed first");
  q("UPDATE discovery_assessments SET status = 'in_progress', started_at = ? WHERE id = ?", w.clock.now().toISOString(), id);
  c = card(await home()); assert.match(c, /Brand Discovery in progress\. Continue where you left off/); assert.doesNotMatch(c, /New Brand Discovery available/); assert.match(c, /hub__flag/);
  q("UPDATE discovery_assessments SET status = 'submitted', submitted_at = ? WHERE id = ?", w.clock.now().toISOString(), id);
  c = card(await home()); assert.match(c, /Brand Discovery sent\. Thank you/); assert.doesNotMatch(c, /hub__flag|dot--attention/, "the red dot goes once it is sent");
  q("UPDATE discovery_assessments SET status = 'reviewed', reviewed_at = ?, reviewed_by = 'a@b.c' WHERE id = ?", w.clock.now().toISOString(), id);
  assert.doesNotMatch(card(await home()), /hub__flag/);
  const { id: id2 } = await make(orgA, "Second");
  assert.match(card(await home()), /New Brand Discovery available/, "a second assessment brings the flag back");
  const off = await portal({ discovery: false }); await off.make(off.orgA).catch(() => null);
  assert.doesNotMatch(card(await text(await off.ann.get("/portal/o/alpha"))), /Brand Discovery|hub__flag/, "feature off: nothing shown");
});

test("Branding page: a black 'ready' card with a contrasting Start/Continue button while waiting, a quiet one once sent, and an introduction that matches the branding stage", async () => {
  const { w, ann, make, orgA, q } = await portal();
  const page = async () => text(await ann.get("/portal/o/alpha/branding"));
  const lead = (html) => /<p class="lead">([\s\S]*?)<\/p>/.exec(html)[1];
  assert.match(lead(await page()), /Your brand kit in nine parts/, "no assessment, no brand: the plain introduction");
  const { id } = await make(orgA);
  let html = await page(); let c = /<section class="bk-discovery[^"]*"[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(c, /bk-discovery--action/); assert.match(c, /<h2 class="h3" id="h-discovery">Your Brand Discovery is ready<\/h2>/); assert.doesNotMatch(c, /Not sure what you want/);
  assert.match(c, /<a class="btn btn--on-dark btn--lg" href="[^"]*\/branding\/discovery\/[^"]+">Start Brand Discovery<\/a>/);
  assert.match(lead(html), /Start with your Brand Discovery below/); assert.doesNotMatch(lead(html), /approved .* brand|Download what you need/);
  assert.ok(html.indexOf("bk-discovery--action") < html.indexOf('class="bk-nav"'), "the card comes before the nine sections");
  q("UPDATE discovery_assessments SET status = 'in_progress', started_at = ? WHERE id = ?", w.clock.now().toISOString(), id);
  html = await page(); c = /<section class="bk-discovery[^"]*"[\s\S]*?<\/section>/.exec(html)[0];
  assert.match(c, /waiting for you/); assert.match(c, />Continue Brand Discovery<\/a>/); assert.match(lead(html), /part-way through your Brand Discovery/);
  assert.ok((await brandRepo.saveBrandKit(w.db, orgA.id, { colours: [{ name: "Ink", role: "primary", hex: "#0a0a0a", note: "" }], typography: [] }, A)).ok); assert.ok((await brandRepo.setBrandKitStatus(w.db, orgA.id, "published", A)).ok);
  html = await page(); assert.match(lead(html), /is below\. Finish your Brand Discovery when you can/, "a published brand and an unfinished discovery: both are said, discovery first");
  q("UPDATE discovery_assessments SET status = 'submitted', submitted_at = ? WHERE id = ?", w.clock.now().toISOString(), id);
  html = await page(); c = /<section class="bk-discovery[^"]*"[\s\S]*?<\/section>/.exec(html)[0];
  assert.doesNotMatch(c, /bk-discovery--action/, "once sent the card is quiet"); assert.match(c, /Brand Discovery sent/); assert.match(c, /View Brand Discovery/);
  assert.match(lead(html), /logos, typography, colours and more/, "sent and published: the ordinary approved-brand introduction");
  brandRepo.setBrandKitStatus(w.db, orgA.id, "draft", A); html = await page();
  assert.match(lead(html), /Thank you for completing your Brand Discovery\. Framework is working from your answers/, "sent but not yet published: says what happens next");
});

test("picture questions: progress, a clear 'all reviewed' end with one way on, 'None of these' that finishes on the last set, and the four new styles", async () => {
  const { anon, make, orgA } = await portal();
  const { token } = await make(orgA);
  await guestPost(anon, token, 1, { go: "next" }); await guestPost(anon, token, 2, { go: "next" }); await guestPost(anon, token, 3, { go: "next" }); await guestPost(anon, token, 4, { go: "next" });
  const s5 = await text(await anon.get(`/portal/discover/${token}/5`));
  const imagery = /<section class="dq"[^>]*data-visual-pages[^>]*aria-labelledby="q-imagery-style"[\s\S]*?<\/section>/.exec(s5);
  assert.ok(imagery, "the imagery question is paged"); assert.equal((imagery[0].match(/class="dc dc--imagery"/g) || []).length, 16, "16 picture styles");
  for (const [k, label] of [["earthy", "Earthy"], ["woody", "Woody"], ["holistic", "Holistic"], ["mystical", "Ethereal"]]) void k, label;
  for (const k of ["earthy", "woody", "holistic", "ethereal"]) { assert.match(imagery[0], new RegExp(`name="l:imagery\\.style:${k}"`)); assert.match(imagery[0], new RegExp(`/assets/img/discovery-imagery/${k}\\.jpg`)); }
  const js = readFileSync(new URL("../../assets/js/discovery.js", import.meta.url), "utf8");
  for (const must of ["Reviewed \" + seen + \" of \"", "Showing images ", "That\\u2019s every image", "Continue to next section", "Review images again", "None of these, finish", "None of these, show more", "I\\u2019ve seen them all"]) assert.ok(js.includes(must.replace(/\\\\/g, "\\")), "js says: " + must);
  const css = readFileSync(new URL("../../assets/css/discovery.css", import.meta.url), "utf8");
  assert.match(css, /\.dq__grid\[hidden\], \.dq__paging\[hidden\], \.dq__done\[hidden\] \{ display: none; \}/, "hidden really hides grid, buttons and panel");
  for (const k of ["earthy", "woody", "holistic", "ethereal"]) assert.ok(readFileSync(new URL(`../../assets/img/discovery-imagery/${k}.jpg`, import.meta.url)).length > 20000, k + " photo exists");
});

test("compatibility: the four new picture styles are appended, every original key is still there, and saved answers keep their meaning", async () => {
  const q = KINDS.brand.questions.find((x) => x.key === "imagery.style");
  const keys = q.options.map((o) => o.key);
  assert.deepEqual(keys.slice(-4), ["earthy", "woody", "holistic", "ethereal"]);
  const legacy = JSON.parse(readFileSync(new URL("./fixtures-discovery-legacy-keys.json", import.meta.url), "utf8"));
  const was = legacy["imagery.style"]; for (const k of was) assert.ok(keys.includes(k), "still present: " + k);
  assert.equal(new Set(keys).size, keys.length, "no duplicate keys");
});
