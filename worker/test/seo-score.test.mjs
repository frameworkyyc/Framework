import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreLead, onPageIssues, opportunityLevel, parseAssessment, SEO_IMPORT_THRESHOLD } from "../seo-score.js";

const page = (o = {}) => ({ title: "Fences | Acme", titleLength: 13, metaDescription: "x", h1: ["Fences in Calgary"], viewport: true, https: true, localBusinessSchema: true, noindex: false, images: 4, imagesMissingAlt: 0, words: 400, mentions: { city: { title: true, h1: true, body: true }, service: { title: true, h1: true, body: true } }, ...o });
const maps = (position, n = 12) => ({ query: "fence contractor in Calgary, AB", checkedAt: "2026-11-06T10:00:00.000Z", position, resultsChecked: n, source: "Google Places API text search order" });
const comp = (median) => ({ sample: [], medianReviews: median, medianRating: 4.6, resultsCompared: 10 });
const lead = { rating: 4.8, review_count: 40, site_status: "online" };
const comps = (r, id) => r.components.find((c) => c.id === id);

test("a business absent from the results, with a weak site, scores high; one at the top with a clean site scores low", () => {
  const weak = scoreLead({ v: 1, maps: maps(null), competitors: comp(150), onpage: page({ title: null, metaDescription: null, h1: [], localBusinessSchema: false }), robots: { robots: "missing", sitemap: "missing" }, psi: { seo: 70, performance: 40 }, organic: null }, lead);
  const strong = scoreLead({ v: 1, maps: maps(2), competitors: comp(30), onpage: page(), robots: { robots: "ok", sitemap: "ok" }, psi: { seo: 100, performance: 95 }, organic: null }, lead);
  assert.ok(weak.score >= 65 && strong.score <= 25 && weak.score > strong.score, `${weak.score} vs ${strong.score}`);
});

test("signals that were not measured are unavailable and left out, not guessed", () => {
  const r = scoreLead({ v: 1, maps: maps(8), competitors: comp(100), onpage: null, robots: null, psi: null, organic: null }, lead);
  assert.equal(comps(r, "organic").basis, "unavailable"); assert.equal(comps(r, "organic").points, null);
  assert.equal(comps(r, "onpage").basis, "unavailable");
  assert.match(r.label, /^Estimated from 3 of 5 signals$/);
  assert.equal(r.coverage, 0.5);
});

test("too little measured data gives no score at all; no assessment gives 'Not assessed yet'", () => {
  const thin = scoreLead({ v: 1, maps: null, competitors: null, onpage: null, organic: null }, lead);
  assert.equal(thin.score, null); assert.match(thin.label, /Not enough/);
  assert.deepEqual([scoreLead(null, lead).score, scoreLead(null, lead).label], [null, "Not assessed yet"]);
});

test("a missing Maps position says 'not among the first N', never that it ranks last, and fewer than ten results is less certain", () => {
  const r = scoreLead({ v: 1, maps: maps(null, 12) }, lead);
  assert.equal(comps(r, "maps").finding, 'Not among the first 12 Google Maps results for "fence contractor in Calgary, AB"');
  assert.ok(!/last|worst|bottom/i.test(JSON.stringify(r)));
  assert.ok(comps(scoreLead({ v: 1, maps: maps(null, 5) }, lead), "maps").points < comps(r, "maps").points);
  assert.equal(comps(scoreLead({ v: 1, maps: maps(1) }, lead), "maps").finding.startsWith("1st of 12"), true);
  assert.equal(comps(scoreLead({ v: 1, maps: maps(12) }, lead), "maps").finding.startsWith("12th of 12"), true);
  assert.equal(comps(scoreLead({ v: 1, maps: maps(3) }, lead), "maps").finding.startsWith("3rd of 12"), true);
});

test("organic rank only counts when a provider measured it", () => {
  const org = { provider: "serper", queries: [{ q: "fence contractor calgary", position: null, depth: 10, checkedAt: "2026-11-06T10:00:00.000Z", topDomains: [] }] };
  const r = scoreLead({ v: 1, maps: maps(5), organic: org, onpage: page() }, lead);
  assert.equal(comps(r, "organic").basis, "measured"); assert.equal(comps(r, "organic").points, 25);
  assert.match(comps(r, "organic").finding, /not in the first 10 for "fence contractor calgary"/);
});

test("no website of its own is itself the on-page finding; an unreadable website is not", () => {
  assert.equal(comps(scoreLead({ v: 1, maps: maps(9), competitors: comp(60) }, { ...lead, site_status: "none" }), "onpage").points, 25);
  assert.equal(comps(scoreLead({ v: 1, maps: maps(9), competitors: comp(60), onpage: null }, lead), "onpage").basis, "unavailable");
});

test("on-page issues cite only what was read, with a fix", () => {
  const issues = onPageIssues({ onpage: page({ title: null, noindex: true, https: false }), robots: { robots: "blocks_all", sitemap: "missing" }, psi: { seo: 60, performance: 30 } });
  assert.ok(issues.every((i) => i.text && i.fix && i.w > 0));
  assert.ok(issues.some((i) => /noindex/.test(i.text)) && issues.some((i) => /robots\.txt blocks/.test(i.text)));
  assert.deepEqual(onPageIssues({}), []);
});

test("reviews above the local median leave no competitor gap; a strong record raises the reputation signal", () => {
  assert.equal(comps(scoreLead({ v: 1, maps: maps(5), competitors: comp(20) }, lead), "competitors").points, 0);
  assert.ok(comps(scoreLead({ v: 1, maps: maps(5), competitors: comp(200) }, lead), "competitors").points > 10);
  const hi = comps(scoreLead({ v: 1, maps: maps(5) }, { rating: 4.9, review_count: 80 }), "reputation").points, lo = comps(scoreLead({ v: 1, maps: maps(5) }, { rating: 3.6, review_count: 3 }), "reputation").points;
  assert.ok(hi > lo);
});

test("levels, threshold and parsing", () => {
  assert.deepEqual([opportunityLevel(80), opportunityLevel(SEO_IMPORT_THRESHOLD), opportunityLevel(10), opportunityLevel(null)], ["high", "medium", "low", "unknown"]);
  assert.equal(parseAssessment("{bad"), null); assert.equal(parseAssessment({ v: 2 }), null); assert.equal(parseAssessment('{"v":1}').v, 1);
});
