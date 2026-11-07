// The Lead details page (admin/assets/lead-panel.js): five sections in a fixed order, numbers before sentences, measured vs not measured always shown, and the Admin design rules.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (f) => readFileSync(new URL("../../admin/assets/" + f, import.meta.url), "utf8");
const panel = src("lead-panel.js"), css = src("admin.css"), common = src("leads-common.js");

test("the page has the five sections in order: overview, SEO performance, opportunity analysis, next actions, additional details", () => {
  const paint = panel.slice(panel.indexOf("function paint()"));
  const order = ["overview(bar)", "seoPerformance()", "analysis()", "nextActions(bar)", "details()"].map((t) => paint.indexOf(t));
  assert.ok(order.every((i) => i > 0) && [...order].sort((a, b) => a - b).join() === order.join(), "sections are drawn in the specified order");
  for (const t of ["SEO performance", "Opportunity analysis", "Next actions", "Additional details"]) assert.ok(panel.includes(`section("${t}"`), t);
});

test("website diagnostics, sources and the timeline are collapsed folds under Additional details; the oversized action box is gone", () => {
  const d = panel.slice(panel.indexOf("function details()"), panel.indexOf("function details()") + 300);
  assert.match(d, /sources\(\), siteCheck\(\), history\(\)/);
  assert.ok(!/class: "ld-next"|ld-actionbar|ld-why|"Why they/.test(panel));
  assert.ok(!/\.ld-next \{|\.ld-actionbar/.test(css));
});

test("measured and not-measured figures are labelled; the score is the focal point; links are clean hosts with icons on the same line", () => {
  assert.match(panel, /"Measured" : "Not measured"/);
  assert.match(panel, /class: "ld-score__n"/);
  assert.match(css, /\.ld-score__n \{[^}]*font-size: clamp\(72px/);
  assert.match(panel, /siteHost\(l\.website\)/);
  assert.match(common, /cls \+ " ld-ico"/);
  assert.match(css, /\.ld-ico \{[^}]*white-space: nowrap/);
});

test("report actions reuse the existing report routes: Copy SEO assessment and Generate report (PDF)", () => {
  assert.match(panel, /Copy SEO assessment/); assert.match(panel, /Generate report \(PDF\)/);
  assert.match(panel, /\/seo-report`\)/); assert.match(panel, /\/seo-report\.pdf/);
});

test("every existing lead action is still reachable from the page", () => {
  for (const t of ['"Approve"', '"Dismiss"', '"Approve email"', '"Review & send"', '"Mark replied"', '"Draft follow-up"', '"Opt-out"', '"Mark won"', '"Reopen"', "pitchSection(", "contacts()", "notes()", "demo()", "Mark as Working", "Check website again"]) assert.ok(panel.includes(t), t);
});

test("Admin design rules hold for the new styles: no rounded corners, shadows, gradients or inline styles; no emoji or symbol characters in the Leads UI", () => {
  const block = css.slice(css.indexOf("/* Lead details: five ruled sections"), css.indexOf("/* Segmented status filter"));
  assert.ok(block.length > 2000);
  assert.ok(!/border-radius|box-shadow|gradient/.test(block));
  assert.ok(!/\.style\b|innerHTML|insertAdjacentHTML|style:/.test(panel));
  for (const f of ["lead-panel.js", "leads.js", "leads-common.js", "lead-pitch.js", "lead-review.js"]) assert.ok(!/[←-⇿☀-➿⬀-⯿\u{1F000}-\u{1FAFF}]/u.test(src(f)), f);
});

test("responsive: single column on a phone, hero and metrics side by side from 900px, two analysis columns from 820px", () => {
  assert.match(css, /@media \(min-width: 900px\) \{ \.ld-hero \{ grid-template-columns: 300px/);
  assert.match(css, /@media \(min-width: 820px\) \{ \.ld-cols/);
  assert.match(css, /\.ld-hero \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(css, /\.ld-panel \{ max-width: 1040px/);
});
