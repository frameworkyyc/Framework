// Business Profile export: Copy for AI, Download PDF and Copy Complete Client Brief (Business Profile + Brand Discovery). Built on the Brand Discovery export; no migration.
// The export must carry every client answer word for word, list every question (a gap says so), say plainly when Brand Discovery is missing or unfinished, and never
// mix in another client's data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/discovery.js";
import { effectiveKind } from "../portal/discovery/model.js";
import { buildProfileExport, profileMarkdown, briefMarkdown, discoveryStatus, buildExport, PROFILE_INSTRUCTION, BRIEF_INSTRUCTION } from "../portal/discovery/export.js";
import { renderProfilePdf } from "../portal/discovery/pdf.js";
import { handleDiscoveryApi } from "../portal/admin-discovery.js";
import { PROFILE_STEPS } from "../portal/profile-schema.js";

const ORG_A = "11111111-1111-4111-8111-111111111111", ORG_B = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-11-03T12:00:00.000Z"), T1 = new Date("2026-11-05T14:03:00.000Z");
const ADMIN = "admin@framework.example", USER = "33333333-3333-4333-8333-333333333333";
const by = { type: "client", ref: "link:abc" };
const eff = effectiveKind("brand", []);
const q = (k) => eff.questions.find((x) => x.key === k);

function world() {
  const db = openPortalDb();
  for (const [id, slug, name, site] of [[ORG_A, "alpha", "Alpha Bakery & Café", "https://alpha.example/"], [ORG_B, "beta", "Beta Studio", "https://beta.example/"]]) db.raw.prepare("INSERT INTO organizations (id, slug, name, website_url, created_at) VALUES (?, ?, ?, ?, ?)").run(id, slug, name, site, "2026-10-20T09:00:00.000Z");
  db.raw.prepare("INSERT INTO portal_users (id, workos_user_id, email) VALUES (?, ?, ?)").run(USER, "user_00000", "owner@alpha.example");
  return db;
}
const save = (db, org, values, at = T0) => { for (const [k, v] of Object.entries(values)) db.raw.prepare("INSERT INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)").run(org, k, v, USER, at.toISOString()); };
const env = (db) => ({ PORTAL_DB: db, PORTAL_ADMIN_WRITES: "1" });
const get = (db, path) => handleDiscoveryApi(new Request("https://admin.test/api/admin" + path), env(db), { email: ADMIN }, path, { now: T1 });
const PROFILE_A = { legal: "Alpha Bakery Ltd.", operating: "Alpha", industry: "Hospitality and food", about: "We bake bread.\nSourdough, mostly.\n## not a heading", city: "Calgary", size: "2 to 10 people", offer: "Bread, pastries & cakes", customers: "Local families — “regulars”",
  goals: "Open a second shop.", competitors: "Rival Loaf\nhttps://rival.example/bread?x=1&y=2", services: "Branding, Marketing", site: "https://alpha.example/", cname: "Sam Baker", cemail: "sam@alpha.example" };
const orgRow = (db, id) => db.raw.prepare("SELECT * FROM organizations WHERE id = ?").get(id);
const model = (db, org, values) => buildProfileExport({ organization: orgRow(db, org), profile: values, lastSaved: T0.toISOString() });

async function assessment(db, org, { submit = true, answer = true, name = "Sam Baker", comment = "Warm, not corporate." } = {}) {
  const made = await repo.createAssessment(db, { organizationId: org, kind: "brand", title: "Brand Discovery", recipientName: name, actor: ADMIN }, { now: T0 });
  const a = await repo.getAssessment(db, org, made.id);
  const pers = q("style.personality");
  if (answer) await repo.saveAnswers(db, a, { "style.personality": { picks: { mode: "picks", like: [pers.options[0].key], dislike: [pers.options[1].key] }, comment } }, { nextStage: 2, by, now: T0 });
  if (submit) assert.equal((await repo.submitAssessment(db, await repo.getAssessment(db, org, made.id), by, { now: T1 })).ok, true);
  return made.id;
}
const exportOf = async (db, org) => (await get(db, `/clients/${org}/profile-export`)).json();

test("Copy for AI (Business Profile): the instruction first, client details, then EVERY question in order with the client's exact words", () => {
  const db = world(); save(db, ORG_A, PROFILE_A);
  const p = model(db, ORG_A, PROFILE_A), md = profileMarkdown(p);
  assert.ok(md.startsWith(PROFILE_INSTRUCTION)); assert.match(PROFILE_INSTRUCTION, /Do not invent client details\./);
  assert.match(md, /- \*\*Business name:\*\* Alpha Bakery & Café/); assert.match(md, /- \*\*Website on file:\*\* https:\/\/alpha\.example\//); assert.match(md, /- \*\*Client since:\*\* 2026-10-20/);
  assert.match(md, /- \*\*Business Profile:\*\* 14 of \d+ questions answered; \d of 7 sections complete/);
  assert.match(md, /- \*\*Profile last saved:\*\* 2026-11-03 12:00 UTC/);
  // every question of every step, in the questionnaire's order
  let at = 0;
  for (const step of PROFILE_STEPS) {
    const i = md.indexOf(`### ${step.title}`, at); assert.ok(i >= at, step.title); at = i;
    for (const f of step.fields) { const j = md.indexOf(f.label, at); assert.ok(j >= at, f.label); at = j; }
  }
  // answers word for word; a multi-line answer is quoted line by line so it cannot become a heading
  assert.match(md, /\*\*What does your business do\?\*\*\n\n> We bake bread\.\n> Sourdough, mostly\.\n> ## not a heading/);
  assert.ok(!/^## not a heading/m.test(md));
  assert.match(md, /> Rival Loaf\n> https:\/\/rival\.example\/bread\?x=1&y=2/);
  assert.match(md, /Local families — “regulars”/); assert.match(md, /- \*\*Calgary|Where are you based\?\*\* Calgary/);
  assert.match(md, /Branding, Marketing/, "a multiple-choice answer is kept as stored");
  // every stored answer appears exactly as stored
  for (const v of Object.values(PROFILE_A)) for (const line of v.split("\n")) assert.ok(md.includes(line), line);
  assert.match(md, /\*Section status: Complete\*|\*Section status: Partly answered\*/);
});

test("a question with no answer is listed and marked (Not answered); nothing is invented for it", () => {
  const db = world(); save(db, ORG_A, { legal: "Alpha Bakery Ltd." });
  const md = profileMarkdown(model(db, ORG_A, { legal: "Alpha Bakery Ltd." }));
  assert.match(md, /- \*\*Legal business name:\*\* Alpha Bakery Ltd\./);
  assert.match(md, /- \*\*Operating name:\*\* \*\(Not answered\)\*/);
  const all = PROFILE_STEPS.flatMap((s) => s.fields);
  assert.equal((md.match(/\*\(Not answered\)\*/g) || []).length, all.length - 1, "every other question says so");
  assert.match(md, /\*Section status: Not started\*/);
  assert.match(md, /1 of \d+ questions answered; 0 of 7 sections complete/);
  const empty = profileMarkdown(model(db, ORG_B, {}));
  assert.equal((empty.match(/\*\(Not answered\)\*/g) || []).length, all.length, "an empty profile still exports");
  assert.ok(!/undefined|null|\[object/.test(empty));
});

test("Complete Client Brief: Business Profile then Brand Discovery, both exact, and Brand Discovery shown as COMPLETE", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A); await assessment(db, ORG_A);
  const b = (await exportOf(db, ORG_A)).briefMarkdown;
  assert.ok(b.startsWith(BRIEF_INSTRUCTION)); assert.match(BRIEF_INSTRUCTION, /Business Profile, followed by their Brand Discovery/); assert.match(BRIEF_INSTRUCTION, /Do not invent client details\./);
  assert.match(b, /> \*\*COMPLETE: submitted by the client on 2026-11-05 14:03 UTC\.\*\*/);
  const i1 = b.indexOf("## Part 1: Business Profile"), i2 = b.indexOf("## Part 2: Brand Discovery");
  assert.ok(i1 > 0 && i2 > i1, "Part 1 before Part 2");
  assert.ok(b.indexOf("## Brand Discovery status") < i1, "the status comes before both parts");
  assert.ok(b.includes("Open a second shop.") && b.includes("Warm, not corporate."));
  assert.ok(b.indexOf("Open a second shop.") < i2 && b.indexOf("Warm, not corporate.") > i2, "each answer is in its own part");
  assert.match(b, /- \*\*Brand Discovery submitted:\*\* 2026-11-05 14:03 UTC/);
  assert.ok(b.includes("## Overall comment from the client") && b.includes("## Inspiration files"));
  assert.ok(!/INCOMPLETE/.test(b), "nothing about incompleteness when it is complete");
  assert.equal((b.match(/^## Part /gm) || []).length, 2);
});

test("Complete Client Brief: Brand Discovery in progress is clearly marked INCOMPLETE, with what was saved so far", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A); await assessment(db, ORG_A, { submit: false });
  const res = await exportOf(db, ORG_A), b = res.briefMarkdown;
  assert.deepEqual([res.discovery.state, res.discovery.complete], ["in_progress", false]);
  assert.match(b, /> \*\*INCOMPLETE: the client has started Brand Discovery but has not submitted it\.\*\*/);
  assert.match(b, /> 1 of 11 questions have an answer saved\. The responses below are what was saved so far and may still change/);
  assert.match(b, /\*\*INCOMPLETE\.\*\* 1 of 11 questions/, "marked again at the start of Part 2");
  assert.ok(b.includes("Warm, not corporate."), "what exists is included");
  assert.ok(b.includes("*(No answer given)*"), "the unanswered questions say so");
  assert.ok(!/COMPLETE: submitted/.test(b));
});

test("Complete Client Brief: not started, and no questionnaire assigned, are both stated plainly", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A);
  let res = await exportOf(db, ORG_A);
  assert.deepEqual([res.discovery.state, res.discovery.complete], ["none", false]);
  assert.match(res.briefMarkdown, /> \*\*NOT STARTED: no Brand Discovery questionnaire has been assigned to this client\.\*\*/);
  assert.match(res.briefMarkdown, /## Part 2: Brand Discovery\n\n\*NOT STARTED: no Brand Discovery questionnaire has been assigned/);
  assert.ok(res.briefMarkdown.includes("Open a second shop."), "the Business Profile is still complete");
  await assessment(db, ORG_A, { submit: false, answer: false });
  res = await exportOf(db, ORG_A);
  assert.equal(res.discovery.state, "not_started");
  assert.match(res.briefMarkdown, /INCOMPLETE: the client has not started Brand Discovery\./);
  assert.match(res.briefMarkdown, /Do not draw conclusions about their visual preferences\./);
  assert.equal(discoveryStatus(null).state, "none");
});

test("the brief speaks for the newest submitted assessment, ignores archived ones, and falls back to the newest open one", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A);
  const open = await assessment(db, ORG_A, { submit: false, comment: "OPEN-COMMENT" });
  assert.match((await exportOf(db, ORG_A)).briefMarkdown, /OPEN-COMMENT/);
  const done = await assessment(db, ORG_A, { comment: "DONE-COMMENT" });
  let b = (await exportOf(db, ORG_A)).briefMarkdown;
  assert.ok(b.includes("DONE-COMMENT") && !b.includes("OPEN-COMMENT"), "a submitted one wins over an open one");
  await repo.archiveAssessment(db, ORG_A, done, ADMIN, { now: T1 });
  b = (await exportOf(db, ORG_A)).briefMarkdown;
  assert.ok(b.includes("OPEN-COMMENT") && !b.includes("DONE-COMMENT") && /INCOMPLETE/.test(b), "an archived one is ignored");
  assert.ok(open);
});

test("each export holds only the selected client's data", async () => {
  const db = world();
  save(db, ORG_A, { legal: "ALPHA-LEGAL", goals: "ALPHA-GOALS" }); save(db, ORG_B, { legal: "BETA-LEGAL", goals: "BETA-GOALS" });
  await assessment(db, ORG_A, { comment: "ALPHA-DISCOVERY", name: "Sam Baker" }); await assessment(db, ORG_B, { comment: "BETA-DISCOVERY", name: "Bea Beta" });
  const a = await exportOf(db, ORG_A), b = await exportOf(db, ORG_B);
  for (const text of [a.profileMarkdown, a.briefMarkdown]) { assert.ok(text.includes("ALPHA-LEGAL")); assert.ok(!/BETA|Bea Beta|beta\.example/.test(text), "nothing of the other client"); }
  assert.ok(a.briefMarkdown.includes("ALPHA-DISCOVERY") && b.briefMarkdown.includes("BETA-DISCOVERY") && !/ALPHA|Sam Baker|alpha\.example/.test(b.briefMarkdown));
  const pdfB = Buffer.from(await (await get(db, `/clients/${ORG_B}/profile-export.pdf`)).arrayBuffer()).toString("latin1");
  assert.ok(pdfB.includes("BETA-LEGAL") && !/ALPHA/.test(pdfB));
  assert.equal((await get(db, `/clients/11111111-1111-4111-8111-999999999999/profile-export`)).status, 404, "an unknown client is not found");
  assert.equal((await get(db, "/clients/not-a-uuid/profile-export")).status, 404);
});

/* ---------------------------------------------------------------- the PDF */

const pdfPlain = (bytes) => [...Buffer.from(bytes).toString("latin1").matchAll(/\((?:\\.|[^\\)])*\) Tj/g)].map((m) => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, "$1")).join("\n");

test("Business Profile PDF: well-formed, numbered, every question and answer present, gaps marked", () => {
  const db = world(); const values = { ...PROFILE_A, about: "We bake bread.\n" + "Sourdough, mostly. ".repeat(60) };
  const p = model(db, ORG_A, values);
  const bytes = renderProfilePdf(p, { exportedOn: T1 }), raw = Buffer.from(bytes).toString("latin1");
  assert.ok(raw.startsWith("%PDF-1.4\n") && raw.trimEnd().endsWith("%%EOF"));
  const start = Number(raw.match(/startxref\n(\d+)\n%%EOF/)[1]);
  const offs = [...raw.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((x) => Number(x[1]));
  offs.forEach((o, i) => assert.ok(raw.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} is where the table says`));
  const pages = Number(raw.match(/\/Count (\d+)/)[1]);
  const text = pdfPlain(bytes);
  for (let n = 1; n <= pages; n++) assert.ok(text.includes(`Page ${n} of ${pages}`));
  assert.equal((text.match(/FRAMEWORK/g) || []).length, pages);
  assert.ok(text.includes("BUSINESS PROFILE") && text.includes("Alpha Bakery & Café") && text.includes("Business Profile"));
  for (const step of PROFILE_STEPS) { assert.ok(text.includes(step.title), step.title); for (const f of step.fields) assert.ok(text.includes(f.label.slice(0, 24)), f.label); }
  assert.ok(text.includes("Open a second shop.") && text.includes("Rival Loaf") && text.includes("https://rival.example/bread?x=1&y=2"));
  assert.ok(text.includes("Not answered"), "an unanswered question says so");
  assert.ok(text.includes("14 of") && text.includes("sections complete"));
  assert.ok(text.includes("COMPLETE") || text.includes("PARTLY ANSWERED") || text.includes("NOT STARTED"), "each section shows its status");
  assert.equal(renderProfilePdf(p, { exportedOn: T1 }).length, bytes.length, "deterministic");
});

test("routes: the profile PDF is an attachment, no-store, and a GET only", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A);
  const res = await get(db, `/clients/${ORG_A}/profile-export.pdf`);
  assert.equal(res.status, 200); assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.match(res.headers.get("Content-Disposition"), /^attachment; filename="business-profile-alpha-bakery-cafe-2026-11-05\.pdf"$/);
  assert.match(res.headers.get("Cache-Control"), /no-store/); assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");
  const post = await handleDiscoveryApi(new Request("https://admin.test/api/admin/clients/" + ORG_A + "/profile-export", { method: "POST", headers: { "X-Framework-Admin": "1", Origin: "https://admin.test" }, body: "{}" }), env(db), { email: ADMIN }, `/clients/${ORG_A}/profile-export`, { now: T1 });
  assert.equal(post.status, 405, "read-only");
});

test("routes: a deployment without the Business Profile table answers 409, never a broken export", async () => {
  const db = world(); db.raw.exec("DROP TABLE business_profile_answers");
  const res = await get(db, `/clients/${ORG_A}/profile-export`);
  assert.equal(res.status, 409); assert.equal((await res.json()).error, "unavailable");
  assert.equal((await get(db, `/clients/${ORG_A}/profile-export.pdf`)).status, 409);
});

test("the Discovery export is unchanged by this feature", async () => {
  const db = world(); save(db, ORG_A, PROFILE_A);
  const id = await assessment(db, ORG_A);
  const one = await (await get(db, `/clients/${ORG_A}/discovery/${id}`)).json();
  assert.ok(one.exportMarkdown.startsWith("You’re assisting Framework"));
  assert.ok(!/Part 1: Business Profile|\(Not answered\)/.test(one.exportMarkdown), "the Discovery copy still lists only answered Business Profile questions");
  assert.ok(buildExport && one.exportMarkdown.includes("## Business information"));
});

/* ---------------------------------------------------------------- the page */

test("Admin UI: three actions in the Business Profile header, fetched with the page, with the incomplete-Discovery note, no HTML insertion", () => {
  const ui = readFileSync(new URL("../../admin/assets/clients.js", import.meta.url), "utf8");
  assert.match(ui, /\/profile-export"\)/); assert.match(ui, /profile-export\.pdf/);
  assert.match(ui, /"Copy for AI"/); assert.match(ui, /"Download PDF"/); assert.match(ui, /"Copy Complete Client Brief"/);
  assert.match(ui, /navigator\.clipboard\.writeText\(text\)/); assert.match(ui, /Copied to clipboard/);
  assert.match(ui, /exp\.briefMarkdown/); assert.match(ui, /exp\.profileMarkdown/);
  assert.match(ui, /has been started but not submitted/); assert.match(ui, /The client brief says so/);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(ui));
  const css = readFileSync(new URL("../../admin/assets/admin.css", import.meta.url), "utf8");
  const rules = css.match(/\.adm-export(wrap)?[^{]*\{[^}]*\}/g).join("\n");
  assert.ok(!/border-radius|box-shadow/.test(rules), "sharp corners, no shadows");
  assert.match(css, /@media \(max-width: 640px\) \{ \.adm-exportwrap \{[^}]*width: 100%/, "the actions fill the width on a phone");
});

test("no public route reaches the profile export, and the modules never write", () => {
  assert.ok(!/profile-export|profileMarkdown|briefMarkdown/.test(readFileSync(new URL("../portal/discovery/routes.js", import.meta.url), "utf8")));
  assert.ok(!/profile-export/.test(readFileSync(new URL("../portal/router.js", import.meta.url), "utf8")), "the client portal router knows nothing of it");
  const api = readFileSync(new URL("../portal/admin-discovery.js", import.meta.url), "utf8");
  assert.match(api, /kind: "profile_export", methods: \["GET"\]/); assert.match(api, /kind: "profile_export_pdf", methods: \["GET"\]/);
  assert.ok(!/INSERT|UPDATE|DELETE/.test(readFileSync(new URL("../portal/discovery/export.js", import.meta.url), "utf8") + readFileSync(new URL("../portal/discovery/pdf.js", import.meta.url), "utf8")));
});
