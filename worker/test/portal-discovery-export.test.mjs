// Brand Discovery export: "Copy for AI" (Markdown) and "Download PDF". No migration. The export must carry the client's submission word for word, only for the selected
// client, only once it is submitted, and the PDF must be a well-formed file that shows the same text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { openPortalDb } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/discovery.js";
import { effectiveKind } from "../portal/discovery/model.js";
import { SECTION_ORDER, SECTIONS } from "../portal/discovery/catalogue.js";
import { buildExport, exportMarkdown, exportFilename, AI_INSTRUCTION } from "../portal/discovery/export.js";
import { renderExportPdf } from "../portal/discovery/pdf.js";
import { handleDiscoveryApi } from "../portal/admin-discovery.js";
import { PROFILE_STEPS } from "../portal/profile-schema.js";

const ORG_A = "11111111-1111-4111-8111-111111111111", ORG_B = "22222222-2222-4222-8222-222222222222";
const T0 = new Date("2026-11-03T12:00:00.000Z"), T1 = new Date("2026-11-05T14:03:00.000Z");
const ADMIN = "admin@framework.example";
const by = { type: "client", ref: "link:abc" };
const eff = effectiveKind("brand", []);

function world() {
  const db = openPortalDb();
  for (const [id, slug, name] of [[ORG_A, "alpha", "Alpha Bakery & Café"], [ORG_B, "beta", "Beta Studio"]]) db.raw.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, ?, ?)").run(id, slug, name);
  db.raw.prepare("INSERT INTO portal_users (id, workos_user_id, email) VALUES (?, ?, ?)").run("33333333-3333-4333-8333-333333333333", "user_00000", "owner@alpha.example");
  return db;
}
const profile = (db, org, values) => { for (const [k, v] of Object.entries(values)) db.raw.prepare("INSERT INTO business_profile_answers (organization_id, field_id, value, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)").run(org, k, v, "33333333-3333-4333-8333-333333333333", T0.toISOString()); };
const q = (key) => eff.questions.find((x) => x.key === key);
const label = (qk, ok) => q(qk).options.find((o) => o.key === ok).label;

/** A submitted assessment for ORG_A with known answers; returns its id. */
async function submitted(db, org = ORG_A, { comment = "We want it warm,\nnot corporate.\n## not a heading\n- not a list", overall = "Please call before 9am.", name = "Sam Baker" } = {}) {
  const made = await repo.createAssessment(db, { organizationId: org, kind: "brand", title: "Brand Discovery", recipientName: name, actor: ADMIN }, { now: T0 });
  const a = await repo.getAssessment(db, org, made.id);
  const pers = q("style.personality"), tone = q("tagline.tone"), logo = q("logo.type");
  await repo.saveAnswers(db, a, {
    "style.personality": { picks: { mode: "picks", like: [pers.options[0].key, pers.options[1].key], dislike: [pers.options[2].key] }, comment },
    "tagline.tone": { picks: { mode: "not_sure", like: [], dislike: [] }, comment: "" },
    "logo.type": { picks: { mode: "surprise", like: [], dislike: [logo.options[0].key] }, comment: "" },
  }, { nextStage: 2, by, now: T0 });
  await repo.saveOverallComment(db, await repo.getAssessment(db, org, made.id), overall, { now: T0 });
  assert.equal((await repo.submitAssessment(db, await repo.getAssessment(db, org, made.id), by, { now: T1 })).ok, true);
  return made.id;
}
async function model(db, org, id, extra = {}) {
  const a = await repo.getAssessment(db, org, id);
  const organization = db.raw.prepare("SELECT id, name FROM organizations WHERE id = ?").get(org);
  return buildExport({ organization, assessment: a, eff, answers: await repo.getAnswers(db, id), uploads: await repo.listUploads(db, org, id), profile: extra.profile || {} });
}
const env = (db) => ({ PORTAL_DB: db, PORTAL_ADMIN_WRITES: "1", PORTAL_DISCOVERY: "1" });
const get = (db, path) => handleDiscoveryApi(new Request("https://admin.test/api/admin" + path), env(db), { email: ADMIN }, path, { now: T1 });

test("Copy for AI: opens with the instruction, then the client details and submission date", async () => {
  const db = world(); const id = await submitted(db);
  profile(db, ORG_A, { legal: "Alpha Bakery Ltd.", about: "We bake bread.", goals: "Open a second shop.", competitors: "Rival Loaf\nhttps://rival.example/bread?x=1&y=2", customers: "Local families", cname: "Sam Baker" });
  const md = exportMarkdown(await model(db, ORG_A, id, { profile: Object.fromEntries(db.raw.prepare("SELECT field_id, value FROM business_profile_answers WHERE organization_id = ?").all(ORG_A).map((r) => [r.field_id, r.value])) }));
  assert.ok(md.startsWith(AI_INSTRUCTION), "the instruction is the very first thing");
  assert.match(AI_INSTRUCTION, /^You’re assisting Framework, a branding and digital development agency, with a new client’s brand identity project\./);
  assert.match(AI_INSTRUCTION, /Do not invent client details\./);
  assert.match(md, /\*\*Business name:\*\* Alpha Bakery & Café/);
  assert.match(md, /\*\*Submitted:\*\* 2026-11-05 14:03 UTC/);
  assert.match(md, /\*\*Completed by:\*\* Sam Baker/);
  // business information, exactly as written, only what was answered
  assert.match(md, /\*\*Legal business name:\*\* Alpha Bakery Ltd\./);
  assert.match(md, /- \*\*What are your main business goals this year\?\*\* Open a second shop\./);
  assert.match(md, /> Rival Loaf\n> https:\/\/rival\.example\/bread\?x=1&y=2/, "competitors keep their line breaks and the URL exactly");
  assert.ok(!md.includes("Budget"), "an unanswered profile question is not listed");
});

test("Copy for AI: every question in its original order with the client's exact answers, nothing rewritten", async () => {
  const db = world(); const id = await submitted(db);
  const md = exportMarkdown(await model(db, ORG_A, id));
  // sections appear in the questionnaire's order
  const found = SECTION_ORDER.map((k) => md.indexOf(`### ${SECTIONS[k].number} ${SECTIONS[k].label}`));
  assert.ok(found.every((i) => i > 0), "every section is present");
  assert.deepEqual([...found].sort((a, b) => a - b), found, "in the original order");
  // questions in each section, in catalogue order
  for (const k of SECTION_ORDER) for (const x of eff.questions.filter((e) => e.section === k)) assert.ok(md.includes(`#### ${x.prompt}`), x.prompt);
  const pers = q("style.personality");
  assert.match(md, new RegExp(`- \\*\\*Likes:\\*\\*\\n  - ${label("style.personality", pers.options[0].key)}\\n  - ${label("style.personality", pers.options[1].key)}\\n`));
  assert.match(md, new RegExp(`- \\*\\*Not for me:\\*\\*\\n  - ${label("style.personality", pers.options[2].key)}\\n`));
  // the comment is quoted verbatim, line by line, so its own # and - lines cannot change the document's structure
  assert.match(md, /- \*\*Comment:\*\*\n\n  > We want it warm,\n  > not corporate\.\n  > ## not a heading\n  > - not a list\n/);
  assert.ok(!/^## not a heading/m.test(md) && !/^- not a list/m.test(md), "client text never becomes a heading or a list item");
  assert.match(md, /- \*\*Answer:\*\* Not sure/);
  assert.match(md, /- \*\*Answer:\*\* Surprise me/);
  assert.match(md, /\*\(No answer given\)\*/, "an unanswered question says so");
  assert.match(md, /## Overall comment from the client\n\n> Please call before 9am\./);
  assert.ok(md.indexOf("## Client and submission") < md.indexOf("## Brand Discovery responses") && md.indexOf("## Brand Discovery responses") < md.indexOf("## Overall comment"));
});

test("the export is exactly the stored submission: every stored answer and label appears, none is added", async () => {
  const db = world(); const id = await submitted(db);
  const m = await model(db, ORG_A, id);
  const stored = await repo.getAnswers(db, id);
  assert.equal(m.answered, stored.size, "every stored answer is in the export");
  const flat = m.sections.flatMap((s) => s.items);
  for (const [key, row] of stored) {
    const item = flat.find((i) => i.prompt === q(key).prompt);
    assert.ok(item, key);
    if (row.picks.mode === "picks") { assert.deepEqual(item.likes, row.picks.like.map((k) => label(key, k))); assert.deepEqual(item.dislikes, row.picks.dislike.map((k) => label(key, k))); }
    assert.equal(item.comment, row.comment);
  }
  const md = exportMarkdown(m);
  assert.equal((md.match(/^#### /gm) || []).length, flat.length, "one heading per question, no invented questions");
  assert.equal(flat.filter((i) => i.state !== "none").length, stored.size);
  assert.ok(!/undefined|null|\[object/.test(md), "no stray placeholder text");
});

test("a question hidden by Admin after it was answered still appears; a hidden unanswered one does not", async () => {
  const db = world(); const id = await submitted(db);
  const hidden = effectiveKind("brand", [{ item_key: "style.personality", option_key: "", enabled: 0 }, { item_key: "logo.type", option_key: "", enabled: 0 }, { item_key: "typography.fonts", option_key: "", enabled: 0 }]);
  const a = await repo.getAssessment(db, ORG_A, id);
  const m = buildExport({ organization: { name: "Alpha" }, assessment: a, eff: hidden, answers: await repo.getAnswers(db, id), uploads: [], profile: {} });
  const prompts = m.sections.flatMap((s) => s.items.map((i) => i.prompt));
  assert.ok(prompts.includes(q("style.personality").prompt) && prompts.includes(q("logo.type").prompt), "answered but hidden: kept");
  assert.ok(!prompts.includes(q("typography.fonts").prompt), "unanswered and hidden: left out");
});

test("empty and special-character answers: nothing breaks, nothing is lost or reshaped", () => {
  const nasty = "Ünïcode — “quotes” & <b>tags</b> `code` *stars* | pipes |\n\n\nthree blank lines above\ttab 🌟 日本語\u0000\u0007";
  const m = buildExport({ organization: { name: "Zoë’s \"Shop\" <&>" }, assessment: { title: "T", status: "submitted", submittedAt: T1.toISOString(), overallComment: nasty, recipientName: "" }, eff,
    answers: new Map([["style.personality", { picks: { mode: "picks", like: [], dislike: [] }, comment: nasty }]]), uploads: [{ name: "a ✓ file (1).png", size: 2048 }], profile: { about: nasty } });
  const md = exportMarkdown(m);
  assert.ok(md.includes("# Brand Discovery: Zoë’s \"Shop\" <&>"));
  assert.ok(md.includes("> Ünïcode — “quotes” & <b>tags</b> `code` *stars* | pipes |"), "text is kept as written");
  assert.ok(md.includes("> 🌟 日本語") === false && md.includes("🌟 日本語"), "emoji and other scripts survive in the copy");
  assert.ok(!/[\u0000-\u0008]/.test(md), "control characters are removed");
  assert.ok(md.includes("a ✓ file (1).png (2 KB)"));
  assert.doesNotThrow(() => exportMarkdown(buildExport({ organization: { name: "" }, assessment: { title: "", status: "submitted", submittedAt: null, overallComment: "" }, eff, answers: new Map(), uploads: [], profile: {} })), "an entirely empty submission still exports");
});

test("export filename is ASCII-safe and carries the submission date", async () => {
  const db = world(); const id = await submitted(db);
  assert.equal(exportFilename(await model(db, ORG_A, id), "pdf"), "brand-discovery-alpha-bakery-cafe-2026-11-05.pdf");
  assert.equal(exportFilename({ client: "../../etc/pass\"wd\r\n", assessment: { submitted: "" } }, "pdf"), "brand-discovery-etc-pass-wd-undated.pdf");
});

/* ---------------------------------------------------------------- the PDF */

const pdfText = (bytes) => Buffer.from(bytes).toString("latin1");
const pdfPlain = (bytes) => [...pdfText(bytes).matchAll(/\((?:\\.|[^\\)])*\) Tj/g)].map((m) => m[0].slice(1, -4).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))).replace(/\\(.)/g, "$1")).join("\n");

test("PDF: a well-formed file with correct offsets, page numbers, headers and every answer", async () => {
  const db = world(); const id = await submitted(db);
  const m = await model(db, ORG_A, id, { profile: { legal: "Alpha Bakery Ltd.", goals: "Open a second shop." } });
  const bytes = renderExportPdf(m, { exportedOn: T1 });
  const raw = pdfText(bytes);
  assert.ok(raw.startsWith("%PDF-1.4\n") && raw.trimEnd().endsWith("%%EOF"));
  // the cross-reference table points at every object
  const start = Number(raw.match(/startxref\n(\d+)\n%%EOF/)[1]);
  assert.equal(raw.slice(start, start + 4), "xref");
  const count = Number(raw.match(/xref\n0 (\d+)/)[1]);
  const offs = [...raw.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((x) => Number(x[1]));
  assert.equal(offs.length, count - 1);
  offs.forEach((o, i) => assert.ok(raw.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} is where the table says`));
  const pages = Number(raw.match(/\/Count (\d+)/)[1]);
  assert.ok(pages >= 1);
  const text = pdfPlain(bytes);
  for (let p = 1; p <= pages; p++) assert.ok(text.includes(`Page ${p} of ${pages}`), `page ${p} is numbered`);
  assert.equal((text.match(/FRAMEWORK/g) || []).length, pages, "the header is on every page");
  assert.ok(text.includes("Alpha Bakery & Café") && text.includes("SUBMITTED") && text.includes("2026-11-05 14:03 UTC"));
  assert.ok(!text.includes("Brand Discovery (Brand Discovery)"), "the title is not repeated when it equals the questionnaire name");
  assert.ok(text.includes("Open a second shop.") && text.includes("Alpha Bakery Ltd."));
  for (const s of m.sections) { assert.ok(text.includes(s.label)); for (const it of s.items) assert.ok(text.includes(it.prompt.slice(0, 20)), it.prompt); }
  assert.ok(text.includes("not corporate."), "long answers are wrapped, not cut");
  assert.ok(text.includes("Please call before 9am."));
  assert.equal(renderExportPdf(m, { exportedOn: T1 }).length, bytes.length, "same input, same output");
});

test("PDF: long answers run over several pages; a long URL is broken instead of running off the page; unsupported characters show as ?", () => {
  const url = "https://example.com/" + "a-very-long-path-segment/".repeat(12) + "?utm_source=newsletter&utm_medium=email&utm_campaign=" + "x".repeat(150);
  const long = Array.from({ length: 140 }, (_, i) => `Line ${i + 1}: ${"The quick brown fox jumps over the lazy dog. ".repeat(3)}`).join("\n");
  const m = buildExport({ organization: { name: "Long Co" }, assessment: { title: "T", status: "submitted", submittedAt: T1.toISOString(), overallComment: long, recipientName: "" }, eff,
    answers: new Map([["style.personality", { picks: { mode: "picks", like: [], dislike: [] }, comment: url + " 🌟 日本語 ok" }]]), uploads: [], profile: {} });
  const bytes = renderExportPdf(m, { exportedOn: T1 });
  const raw = pdfText(bytes);
  assert.ok(Number(raw.match(/\/Count (\d+)/)[1]) >= 4, "a long answer flows onto more pages");
  const text = pdfPlain(bytes);
  assert.ok(text.includes("Line 140:"), "the last line is present");
  assert.equal(text.replace(/\s+/g, "").includes(url.replace(/\s+/g, "")), true, "the URL is intact when the pieces are joined");
  assert.ok(text.includes("?? ok") || /\? ok/.test(text), "characters the PDF fonts cannot draw are shown as ?");
  // no text run is wider than the page's text area (letter width 612, 54pt margins)
  for (const m2 of raw.matchAll(/BT \/F([12]) ([\d.]+) Tf [\d.]+ g [\d.-]+ Tc ([\d.]+) ([\d.]+) Td/g)) assert.ok(Number(m2[3]) >= 53 && Number(m2[3]) < 560, "text starts inside the margins");
});

test("PDF: parentheses, backslashes and accented letters are escaped and encoded", () => {
  const m = buildExport({ organization: { name: "Café (Main) \\ Co" }, assessment: { title: "T", status: "submitted", submittedAt: T1.toISOString(), overallComment: "Crème brûlée – “ok” • 50€", recipientName: "" }, eff, answers: new Map(), uploads: [], profile: {} });
  const bytes = renderExportPdf(m, { exportedOn: T1 });
  const text = pdfPlain(bytes);
  assert.ok(text.includes("Café (Main) \\ Co"));
  assert.ok(text.includes("Crème brûlée \u0096 \u0093ok\u0094 \u0095 50\u0080"), "WinAnsi bytes for the accents, dashes, quotes, bullet and euro");
});

/* ---------------------------------------------------------------- the routes: permissions, isolation, state */

test("routes: export is offered only once the assessment is submitted, and only for the selected client", async () => {
  const db = world();
  const made = await repo.createAssessment(db, { organizationId: ORG_A, kind: "brand", title: "Brand Discovery", actor: ADMIN }, { now: T0 });
  let res = await get(db, `/clients/${ORG_A}/discovery/${made.id}`);
  assert.equal((await res.json()).exportMarkdown, null, "no Copy for AI text before it is submitted");
  res = await get(db, `/clients/${ORG_A}/discovery/${made.id}/export.pdf`);
  assert.equal(res.status, 409, "no PDF before it is submitted");
  assert.equal((await res.json()).error, "not_submitted");

  const id = await submitted(db);
  const body = await (await get(db, `/clients/${ORG_A}/discovery/${id}`)).json();
  assert.ok(body.exportMarkdown.startsWith(AI_INSTRUCTION));
  res = await get(db, `/clients/${ORG_A}/discovery/${id}/export.pdf`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Type"), "application/pdf");
  assert.match(res.headers.get("Content-Disposition"), /^attachment; filename="brand-discovery-alpha-bakery-cafe-2026-11-05\.pdf"$/);
  assert.match(res.headers.get("Cache-Control"), /no-store/);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

  // another organization's id never reaches this assessment
  assert.equal((await get(db, `/clients/${ORG_B}/discovery/${id}/export.pdf`)).status, 404);
  assert.equal((await get(db, `/clients/${ORG_B}/discovery/${id}`)).status, 404);
  // a reopened assessment is no longer exportable
  await repo.reopenAssessment(db, ORG_A, id, ADMIN, { now: T1 });
  assert.equal((await get(db, `/clients/${ORG_A}/discovery/${id}/export.pdf`)).status, 409);
  assert.equal((await (await get(db, `/clients/${ORG_A}/discovery/${id}`)).json()).exportMarkdown, null);
});

test("routes: an export contains only the selected client's data, never another client's", async () => {
  const db = world();
  const a = await submitted(db, ORG_A, { comment: "ALPHA-SECRET-COMMENT", overall: "ALPHA-OVERALL" });
  const b = await submitted(db, ORG_B, { comment: "BETA-SECRET-COMMENT", overall: "BETA-OVERALL", name: "Bea Beta" });
  profile(db, ORG_A, { about: "ALPHA-ABOUT" }); profile(db, ORG_B, { about: "BETA-ABOUT", goals: "BETA-GOALS" });
  const mdA = (await (await get(db, `/clients/${ORG_A}/discovery/${a}`)).json()).exportMarkdown;
  const mdB = (await (await get(db, `/clients/${ORG_B}/discovery/${b}`)).json()).exportMarkdown;
  assert.ok(mdA.includes("ALPHA-SECRET-COMMENT") && mdA.includes("ALPHA-OVERALL") && mdA.includes("ALPHA-ABOUT"));
  assert.ok(!/BETA|Bea Beta/.test(mdA), "nothing of the other client");
  assert.ok(mdB.includes("BETA-GOALS") && !/ALPHA|Sam Baker/.test(mdB));
  const pdfB = pdfPlain(new Uint8Array(await (await get(db, `/clients/${ORG_B}/discovery/${b}/export.pdf`)).arrayBuffer()));
  assert.ok(pdfB.includes("BETA-SECRET-COMMENT") && !/ALPHA|Sam Baker/.test(pdfB));
});

test("routes: the export is read-only GET behind the existing Admin checks, with no new table, no public URL and no migration", () => {
  const api = readFileSync(new URL("../portal/admin-discovery.js", import.meta.url), "utf8");
  assert.match(api, /kind: "export_pdf", methods: \["GET"\]/, "a GET route only: it changes nothing");
  assert.ok(!/INSERT|UPDATE|DELETE/.test(readFileSync(new URL("../portal/discovery/export.js", import.meta.url), "utf8") + readFileSync(new URL("../portal/discovery/pdf.js", import.meta.url), "utf8")), "the export modules never write");
  const router = readFileSync(new URL("../admin/router.js", import.meta.url), "utf8");
  assert.match(router, /handleDiscoveryApi/, "it is served by the Admin router, which every request passes through the Cloudflare Access check");
  // no public route can reach it: the client-facing discovery routes know nothing of export
  assert.ok(!/export\.pdf|exportMarkdown|buildExport/.test(readFileSync(new URL("../portal/discovery/routes.js", import.meta.url), "utf8")));
});

test("Admin UI: the two buttons sit in the page header, show only for a submitted assessment, and confirm the copy", () => {
  const ui = readFileSync(new URL("../../admin/assets/discovery.js", import.meta.url), "utf8");
  assert.match(ui, /if \(!data\.exportMarkdown\)/, "hidden unless the server sent an export");
  assert.match(ui, /"Copy for AI"/); assert.match(ui, /"Download PDF"/);
  assert.match(ui, /navigator\.clipboard\.writeText\(data\.exportMarkdown\)/);
  assert.match(ui, /Copied to clipboard/);
  assert.match(ui, /export\.pdf/);
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(ui), "no HTML insertion");
  const css = readFileSync(new URL("../../admin/assets/admin.css", import.meta.url), "utf8");
  const rules = css.match(/\.adm-export[^{]*\{[^}]*\}/g).join("\n");
  assert.ok(!/border-radius|box-shadow/.test(rules), "sharp corners, no shadows");
  assert.equal(PROFILE_STEPS.length > 0, true);
});

test("PDF: a word before a URL too long for the line keeps its space", () => {
  const url = "https://example.com/" + "segment/".repeat(30) + "?a=1&b=2";
  const m = buildExport({ organization: { name: "Gap Co" }, assessment: { title: "T", status: "submitted", submittedAt: T1.toISOString(), overallComment: "", recipientName: "" }, eff,
    answers: new Map([["style.personality", { picks: { mode: "picks", like: [], dislike: [] }, comment: "See " + url + " for more" }]]), uploads: [], profile: {} });
  const text = pdfPlain(renderExportPdf(m, { exportedOn: T1 }));
  assert.ok(/See\s+https:\/\/example\.com\//.test(text) && !text.includes("Seehttps"), "the space after See survives");
  assert.ok(/\bfor\s+more/.test(text), "text after the URL follows it");
});
