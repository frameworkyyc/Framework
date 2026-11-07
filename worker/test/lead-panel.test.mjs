// The Leads list and the Lead details page (admin/assets/leads.js, lead-panel.js): minimal, answer first, details behind folds, and the Admin design rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shortName } from "../../admin/assets/leads-common.js";

const src = (f) => readFileSync(new URL("../../admin/assets/" + f, import.meta.url), "utf8");
const panel = src("lead-panel.js"), list = src("leads.js"), css = src("admin.css"), common = src("leads-common.js");
const rows = list.slice(list.indexOf("function leadRow"), list.indexOf("/* ---------- List"));

test("shortName drops a trailing city that is shown beside the name, never the whole name or a leading city", () => {
  const t = (n, c) => shortName(n, c);
  assert.equal(t("Vallarta Fence Calgary", "Calgary"), "Vallarta Fence");
  assert.equal(t("Millennium Fence and Deck - Calgary", "Calgary"), "Millennium Fence and Deck");
  assert.equal(t("Divine Fencing (Calgary)", "Calgary"), "Divine Fencing");
  assert.equal(t("Deck Pros in Calgary", "Calgary"), "Deck Pros");
  assert.equal(t("Calgary Decks", "Calgary"), "Calgary Decks");
  assert.equal(t("Calgary", "Calgary"), "Calgary");
  assert.equal(t("Calgarys Best", "Calgary"), "Calgarys Best");
  assert.equal(t("Total Fencing Solutions Inc.", "Calgary"), "Total Fencing Solutions Inc.");
  assert.equal(t("Acme Fence Calgary", null), "Acme Fence Calgary");
});

test("a list row is name, industry and city, the score and a chevron: no reason, rating, badges or next-action text", () => {
  assert.match(rows, /shortName\(l\.name, l\.city\)/);
  assert.match(rows, /ld-row__score/); assert.match(rows, /navIcon\("chevron"\)/);
  for (const gone of ["l.reason", "rating", "review_count", "badge(", "next_action", "opportunityChip", "SITE_WORDS"]) assert.ok(!rows.includes(gone), gone);
  assert.match(rows, /showStatus \? statusWord\(l\.status\)/, "status shows in the All view; the filter strip carries it elsewhere");
  assert.match(list, /showStatus: status === "all"/);
});

test("the list header is a title and one Actions menu holding Find new candidates and Check websites; no description paragraph", () => {
  assert.match(list, /h\("h1", \{ class: "adm-title", tabindex: "-1" \}, "Leads"\), menu/);
  assert.match(list, /"Find new candidates"/); assert.match(list, /"Check websites"/);
  assert.match(list, /h\("details", \{ class: "ld-menu" \}/);
  assert.ok(!/Local businesses with the most to gain|eyebrow/.test(list));
  assert.match(list, /title: "Setup needed"/);
  assert.match(list, /sort=opportunity/, "best opportunity first");
});

test("search, status filter with counts and bulk selection are all still there", () => {
  for (const t of ["Search name, trade or city", "ld-seg", "Approve selected", "Dismiss selected", "Review & send", "ld-selall"]) assert.ok(list.includes(t), t);
});

test("details: three figures (score, Maps position, rating), a verdict, outreach, then folds; no Next Step box or Measured labels", () => {
  const paint = panel.slice(panel.indexOf("function paint()"));
  const order = ["overview(bar), figs", "opportunity()", 'section("Outreach"', "seoDetails(), notes(), siteCheck(), sources(), history()"].map((t) => paint.indexOf(t));
  assert.ok(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join(), "in this order");
  assert.ok(panel.includes("figures()")); for (const t of ['"SEO opportunity"', '"Google Maps"', '"Rating"']) assert.ok(panel.includes(`label: ${t}`), t);
  assert.ok(!/ld-tag|ld-step|Next step|"Why they|"Measured"/.test(panel), "no per-figure Measured tags; unmeasured items just show a dash, with the reason inside SEO details");
  assert.ok(!/\.ld-tag|\.ld-step/.test(css));
});

test("scoring breakdown, competitors, technical findings and diagnostics live in folds (SEO details, Website check, Sources, Timeline)", () => {
  assert.match(panel, /fold\(\{ title: "SEO details"/);
  assert.match(panel, /Score components/); assert.match(panel, /Local competitors/); assert.match(panel, /"Findings"/);
  assert.match(panel, /Website check \(technical\)/); assert.match(panel, /fold\(\{ title: "Sources"/); assert.match(panel, /fold\(\{ title: "Timeline"/);
  assert.match(panel, /fold\(\{ title: "Notes"/);
  assert.match(panel, /Lighthouse SEO/); assert.match(panel, /psi_error/);
});

test("approve and dismiss sit under the name; the business name does not repeat the city; links are clean hosts with icons on the line", () => {
  const ov = panel.slice(panel.indexOf("function overview"), panel.indexOf("function figures"));
  assert.match(ov, /text: shortName\(l\.name, l\.city\)/); assert.match(ov, /bar\.primary, bar\.secondary/);
  assert.match(panel, /siteHost\(l\.website\)/); assert.match(common, /cls \+ " ld-ico"/);
  assert.match(css, /\.ld-ico \{[^}]*white-space: nowrap/);
});

test("report actions reuse the existing report routes: Copy SEO assessment and Generate report (PDF)", () => {
  assert.match(panel, /Copy SEO assessment/); assert.match(panel, /Generate report \(PDF\)/);
  assert.match(panel, /\/seo-report`\)/); assert.match(panel, /\/seo-report\.pdf/);
});

test("every existing lead action is still reachable from the page", () => {
  for (const t of ['"Approve"', '"Dismiss"', '"Approve email"', '"Review & send"', '"Mark replied"', '"Draft follow-up"', '"Opt-out"', '"Mark won"', '"Reopen"', "pitchSection(", "contacts()", "notes()", "demo()", "Mark as Working", "Check website again", "next_action_note"]) assert.ok(panel.includes(t), t);
});

test("Admin design rules hold: no rounded corners, shadows, gradients or inline styles; no emoji or symbol characters in the Leads UI", () => {
  const block = css.slice(css.indexOf("/* Lead details: the answer first"), css.indexOf("/* Segmented status filter"));
  assert.ok(block.length > 3000);
  assert.ok(!/border-radius:\s*[1-9]|box-shadow|gradient/.test(block));
  assert.ok(!/\.style\b|innerHTML|insertAdjacentHTML|style:/.test(panel + list));
  for (const f of ["lead-panel.js", "leads.js", "leads-common.js", "lead-pitch.js", "lead-review.js"]) assert.ok(!/[←-⇿☀-➿⬀-⯿\u{1F000}-\u{1FAFF}]/u.test(src(f)), f);
});

test("responsive: the figures stay three across with fluid type; the competitor and score rows stack on a phone; the menu is a ruled box", () => {
  assert.match(css, /\.ld-figs \{ display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /clamp\(44px, 9vw, 88px\)/);
  assert.match(css, /@media \(min-width: 700px\) \{ \.ld-bk/);
  assert.match(css, /\.ld-menu__list \{[^}]*border: 1px solid var\(--ink\)/);
  assert.match(css, /\.ld-panel \{ max-width: 1040px/);
});

test("organic rankings: a Google Search line under the figures and every tracked keyword with its real position (or 'Not in top N') in SEO details", () => {
  assert.match(panel, /class: "ld-gsearch"/); assert.match(panel, /Google Search by keyword/);
  assert.match(panel, /Not in top \$\{q\.depth\}/); assert.match(panel, /Not checked yet/);
  assert.match(panel, /`#\$\{q\.position\}`/);
  assert.ok(!/ld-kw[^"]*"[^)]*Measured/.test(panel));
});
