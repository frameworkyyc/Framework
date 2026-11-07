// SEO Opportunity Score. Pure and versioned: the finder MEASURES (framework-leadgen src/seo.js snapshot), this module SCORES, so the method can change without re-measuring.
//
// What is verified and what is estimated:
//  - every position, rating, count and on-page fact in a snapshot is a measurement (it carries its source and date);
//  - the score itself is an ESTIMATE of how much room there is to improve, computed from whatever was measured;
//  - a signal that was not measured is "unavailable" and is left OUT of the score (the weights of the measured ones are renormalised), never guessed;
//  - "not in the first N results" is said only when N results were really checked; nothing here ever says a business ranks "last".
export const SEO_SCORE_VERSION = 1;
export const SEO_IMPORT_THRESHOLD = 35; // an assessed lead is worth reviewing from this score up
export const SEO_MIN_COVERAGE = 0.4; // below this share of the weights measured, no score is given

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const pct = (x) => Math.max(0, Math.min(1, x));
export const ordinal = (n) => `${n}${[, "st", "nd", "rd"][(n % 100 - n % 10 === 10) ? 0 : n % 10] || "th"}`;

/** Opportunity (0 = nothing to gain, 1 = the most) for a rank. `absent` means checked and not found within `depth` results. */
function rankGap(position, depth) {
  if (position === null) return depth >= 10 ? 1 : 0.8; // fewer than ten results checked: less certain how far down it is
  if (position <= 3) return 0;
  if (position <= 6) return 0.35;
  if (position <= 10) return 0.6;
  if (position <= 20) return 0.85;
  return 1;
}

function mapsComponent(a) {
  const m = a && a.maps;
  if (!m) return { basis: "unavailable", note: "No Google Maps result positions have been recorded for this search yet." };
  const depth = num(m.resultsChecked) || 0;
  const src = `Google Places text search "${m.query}", ${String(m.checkedAt || "").slice(0, 10)}`;
  if (m.position === null) return { basis: "measured", gap: rankGap(null, depth), finding: `Not among the first ${depth} Google Maps results for "${m.query}"`, source: src };
  return { basis: "measured", gap: rankGap(num(m.position), depth), finding: `${ordinal(num(m.position))} of ${depth} Google Maps results for "${m.query}"`, source: src, position: num(m.position) };
}

function organicComponent(a) {
  const o = a && a.organic;
  if (!o || !Array.isArray(o.queries) || !o.queries.length) return { basis: "unavailable", note: "Google search rankings are not measured yet for this business." };
  const qs = o.queries.filter((q) => q && typeof q.q === "string");
  if (!qs.length) return { basis: "unavailable", note: "Google search rankings are not measured." };
  const gaps = qs.map((q) => rankGap(num(q.position), num(q.depth) || 0));
  const gap = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const found = qs.filter((q) => q.position !== null && q.position !== undefined);
  const depth = Math.min(...qs.map((q) => num(q.depth) || 0));
  const best = found.length ? found.reduce((b, q) => (num(q.position) < num(b.position) ? q : b)) : null;
  const finding = best
    ? `Best Google result #${num(best.position)} for "${best.q}"${found.length < qs.length ? `; not in the top ${depth} for ${qs.length - found.length} of ${qs.length} keywords` : ""}`
    : `Not in the top ${depth} Google results for ${qs.length === 1 ? "its keyword" : `any of ${qs.length} keywords`}`;
  const queries = qs.map((q) => ({ q: q.q, location: q.location || null, position: q.position === undefined ? null : q.position, depth: num(q.depth) || 0, checkedAt: q.checkedAt || null }));
  return { basis: "measured", gap, finding, source: `${o.provider} Google search results, ${String(qs[0].checkedAt || "").slice(0, 10)}`, queries };
}

/** Individual on-page and technical problems, each with a weight, plain wording and a recommendation. Only things actually read from the page. */
export function onPageIssues(a) {
  const out = [];
  const p = a && a.onpage, r = a && a.robots, s = a && a.psi, site = a && a.site;
  if (p) {
    if (!p.title) out.push({ w: 3, text: "The home page has no title tag", fix: "Write a title that names the service and the city" });
    else if (p.mentions && p.mentions.city && !p.mentions.city.title && p.mentions.service && !p.mentions.service.title) out.push({ w: 2, text: "The home page title mentions neither the service nor the city", fix: "Put the main service and the city in the title" });
    if (!p.metaDescription) out.push({ w: 2, text: "No meta description", fix: "Add a description that sells the click" });
    if (!p.h1 || !p.h1.length) out.push({ w: 2, text: "No H1 heading on the home page", fix: "Add one clear H1 that says what you do and where" });
    else if (p.mentions && p.mentions.city && !p.mentions.city.h1 && p.mentions.service && !p.mentions.service.h1) out.push({ w: 1, text: "The H1 does not mention the service or the city", fix: "Name the service and city in the H1" });
    if (p.noindex) out.push({ w: 5, text: "The home page tells search engines not to index it (noindex)", fix: "Remove the noindex directive" });
    if (!p.viewport) out.push({ w: 2, text: "No mobile viewport tag", fix: "Make the site mobile-friendly" });
    if (!p.https) out.push({ w: 2, text: "The site is not served over HTTPS", fix: "Move the site to HTTPS" });
    if (!p.localBusinessSchema) out.push({ w: 2, text: "No local business structured data", fix: "Add LocalBusiness schema markup" });
    if (p.images > 0 && p.imagesMissingAlt / p.images >= 0.5) out.push({ w: 1, text: `${p.imagesMissingAlt} of ${p.images} images have no alt text`, fix: "Add descriptive alt text to images" });
    if (num(p.words) !== null && p.words < 150) out.push({ w: 2, text: `Very little text on the home page (about ${p.words} words)`, fix: "Add copy about services, areas served and experience" });
    if (p.mentions && p.mentions.city && !p.mentions.city.body && !p.mentions.city.title && !p.mentions.city.h1) out.push({ w: 2, text: "The home page never mentions the city it serves", fix: "Add the city and service areas to the page" });
  }
  if (r) {
    if (r.robots === "blocks_all") out.push({ w: 5, text: "robots.txt blocks all search engines", fix: "Fix robots.txt so the site can be crawled" });
    if (r.sitemap === "missing") out.push({ w: 1, text: "No sitemap.xml found", fix: "Publish an XML sitemap" });
  }
  if (s) {
    if (num(s.seo) !== null && s.seo < 90) out.push({ w: s.seo < 70 ? 2 : 1, text: `Google Lighthouse SEO score ${s.seo}/100`, fix: "Fix the Lighthouse SEO audit failures" });
    if (num(s.performance) !== null && s.performance < 50) out.push({ w: 2, text: `Slow on mobile: Lighthouse performance ${s.performance}/100`, fix: "Speed up the site on mobile" });
    else if (num(s.performance) !== null && s.performance < 75) out.push({ w: 1, text: `Mobile speed could be better: Lighthouse performance ${s.performance}/100`, fix: "Speed up the site on mobile" });
  }
  if (site && site.state === "offline") out.push({ w: 5, text: "The website does not load", fix: "Get the website working" });
  return out;
}

function onPageComponent(a, siteNoWebsite) {
  const read = a && (a.onpage || a.robots || a.psi);
  if (!read) {
    if (siteNoWebsite) return { basis: "measured", gap: 1, finding: "No website of its own to rank (no site, or only a social or directory page)", source: "Finder website check" };
    return { basis: "unavailable", note: "The website could not be read (it may block automated visits), so on-page SEO was not measured." };
  }
  const issues = onPageIssues(a);
  const total = issues.reduce((s, i) => s + i.w, 0);
  const gap = pct(total / 12);
  return { basis: "measured", gap, finding: issues.length ? `${issues.length} on-page or technical issue${issues.length === 1 ? "" : "s"} found` : "No significant on-page issues found", source: "Home page read directly; Lighthouse via Google PageSpeed Insights where available", issues };
}

function competitorComponent(a, lead) {
  const c = a && a.competitors;
  const reviews = num(lead.review_count), med = c && num(c.medianReviews);
  if (!c || med === null || reviews === null) return { basis: "unavailable", note: "No local competitor data was recorded for this search." };
  const gap = med > 0 ? pct(1 - reviews / med) : 0;
  const n = num(c.resultsCompared) || 0;
  const finding = reviews >= med ? `${reviews} reviews, at or above the local median of ${med} (${n} competitors compared)` : `${reviews} reviews against a local median of ${med} (${n} competitors compared)`;
  return { basis: "measured", gap, finding, source: "Other businesses in the same Google Places search" };
}

/** The reputation component measures how much there is to build on: a well reviewed business that is hard to find is the clearest opportunity. */
function reputationComponent(lead) {
  const rating = num(lead.rating), reviews = num(lead.review_count);
  if (rating === null || reviews === null || reviews <= 0) return { basis: "unavailable", note: "No review data recorded." };
  const strength = pct((rating - 3.5) / 1.3) * pct(Math.log10(reviews + 1) / Math.log10(51));
  return { basis: "measured", gap: strength, finding: `${rating.toFixed(1)} stars from ${reviews} review${reviews === 1 ? "" : "s"}`, source: "Google Maps listing" };
}

const WEIGHTS = [
  { id: "maps", label: "Google Maps visibility", max: 25, run: (a) => mapsComponent(a) },
  { id: "organic", label: "Google Search rankings", max: 25, run: (a) => organicComponent(a) },
  { id: "onpage", label: "On-page and technical SEO", max: 25, run: (a, lead, noSite) => onPageComponent(a, noSite) },
  { id: "competitors", label: "Competitor gap", max: 15, run: (a, lead) => competitorComponent(a, lead) },
  { id: "reputation", label: "Reputation to build on", max: 10, run: (a, lead) => reputationComponent(lead) },
];

const noWebsite = (lead) => lead.site_status === "none" || lead.site_status === "social_only";

/**
 * Scores one lead from its stored assessment snapshot.
 * @returns { version, score: 0..100 | null, coverage: 0..1, label, components: [{ id, label, max, basis, points|null, finding|note, source? }] }
 */
export function scoreLead(assessment, lead = {}) {
  const a = assessment && typeof assessment === "object" ? assessment : null;
  const noSite = noWebsite(lead);
  const components = WEIGHTS.map((w) => {
    const r = w.run(a, lead, noSite);
    const base = { id: w.id, label: w.label, max: w.max, basis: r.basis };
    if (r.basis !== "measured") return { ...base, points: null, note: r.note };
    return { ...base, points: Math.round(r.gap * w.max * 10) / 10, finding: r.finding, source: r.source, ...(r.issues ? { issues: r.issues } : {}), ...(r.queries ? { queries: r.queries } : {}), ...(r.position !== undefined ? { position: r.position } : {}) };
  });
  const measuredMax = components.filter((c) => c.basis === "measured").reduce((s, c) => s + c.max, 0);
  const coverage = measuredMax / 100;
  if (!a && !noSite) return { version: SEO_SCORE_VERSION, score: null, coverage: 0, label: "Not assessed yet", components };
  if (coverage < SEO_MIN_COVERAGE) return { version: SEO_SCORE_VERSION, score: null, coverage, label: "Not enough measured data to score", components };
  const earned = components.filter((c) => c.basis === "measured").reduce((s, c) => s + c.points, 0);
  const score = Math.round((earned / measuredMax) * 100);
  const label = coverage >= 0.99 ? "Estimated from all signals" : `Estimated from ${components.filter((c) => c.basis === "measured").length} of ${components.length} signals`;
  return { version: SEO_SCORE_VERSION, score, coverage, label, components };
}

export const opportunityLevel = (score) => (score === null || score === undefined ? "unknown" : score >= 65 ? "high" : score >= SEO_IMPORT_THRESHOLD ? "medium" : "low");

/** Parse the JSON the finder stored; anything malformed or from an unknown version is treated as "no assessment". */
export function parseAssessment(raw) {
  let v = raw;
  if (typeof raw === "string") { try { v = JSON.parse(raw); } catch { return null; } }
  return v && typeof v === "object" && v.v === 1 ? v : null;
}
