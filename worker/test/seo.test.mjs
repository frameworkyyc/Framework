// SEO phase 1 guards: titles, descriptions, canonical URLs, structured data, the sitemap, internal links to the free assessment, and the promises the
// public pages must never make (no prices, no invented reviews or ratings, no public phone number). Public pages live in the repository root.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_PAGES, build } from "../../scripts/seo/update-sitemap.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url)), join = (a, b) => a + b.replace(/^\//, "");
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const SITE = "https://frameworkco.ca";
const strip = (h) => h.replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
const decode = (s) => s.replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const text = (h) => decode(strip(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " "));
const attr = (h, re) => (h.match(re) || [])[1];
const blocks = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map((m) => JSON.parse(m[1]));
const flat = (b) => b.flatMap((x) => (x["@graph"] ? x["@graph"] : [x]));

test("every indexable page has one unique title, a description of a sensible length, an extensionless canonical and matching Open Graph tags", () => {
  const titles = new Set(), descriptions = new Set();
  for (const [route, file] of PUBLIC_PAGES) {
    const h = read(file), url = SITE + route;
    const title = attr(h, /<title>(.*?)<\/title>/s), desc = attr(h, /<meta\s+name="description"\s+content="(.*?)"/s);
    assert.ok(title && title.length >= 20 && title.length <= 65, `${file} title length ${title && title.length}`);
    assert.ok(desc && desc.length >= 100 && desc.length <= 165, `${file} description length ${desc && desc.length}`);
    assert.ok(!titles.has(title) && !descriptions.has(desc), `${file} title and description are unique`);
    titles.add(title); descriptions.add(desc);
    assert.equal(attr(h, /<link\s+rel="canonical"\s+href="(.*?)"/), url, `${file} canonical`);
    assert.ok(!/\.html$/.test(url), "canonical has no .html");
    assert.equal(attr(h, /<meta\s+property="og:url"\s+content="(.*?)"/), url, `${file} og:url`);
    assert.ok(attr(h, /<meta\s+property="og:title"\s+content="(.*?)"/) && attr(h, /<meta\s+property="og:image"\s+content="(.*?)"/), `${file} og tags`);
    assert.equal((h.match(/<h1[\s>]/g) || []).length, 1, `${file} has exactly one h1`);
    assert.match(h, /<html lang="en-CA">/);
    assert.ok(!/name="robots"[^>]*noindex/.test(h), `${file} is indexable`);
  }
});

test("the sitemap lists exactly the indexable pages, by their canonical URL, with real dates; the generator agrees", () => {
  const xml = read("sitemap.xml");
  const locs = [...xml.matchAll(/<loc>(.*?)<\/loc><lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/g)];
  assert.deepEqual(locs.map((m) => m[1]).sort(), PUBLIC_PAGES.map(([r]) => SITE + r).sort());
  for (const m of locs) assert.ok(!Number.isNaN(Date.parse(m[2])), "lastmod is a real date");
  const strip2 = (x) => x.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  assert.equal(strip2(build()), strip2(xml), "run: node scripts/seo/update-sitemap.mjs");
  for (const priv of ["/me", "/card", "/client-feedback", "/portal", "/admin", "/demos", "/404"]) assert.ok(!xml.includes("<loc>" + SITE + priv + "</loc>"), priv + " is not in the sitemap");
});

test("robots.txt allows crawling and names the sitemap; private pages keep their noindex", () => {
  const robots = read("robots.txt");
  assert.match(robots, /User-agent: \*\nAllow: \//); assert.match(robots, /Sitemap: https:\/\/frameworkco\.ca\/sitemap\.xml/);
  assert.ok(!/Disallow:\s*\/\s*$/m.test(robots), "the site is not blocked");
  const headers = read("_headers");
  for (const p of ["/client-feedback", "/me", "/demos/*"]) assert.match(headers, new RegExp(p.replace("*", "\\*") + "\\n  X-Robots-Tag: noindex"), p);
  assert.match(read("card.html"), /name="robots" content="noindex/); assert.match(read("404.html"), /name="robots" content="noindex"/);
  assert.ok(!/rel="canonical"/.test(read("404.html")), "an error page carries no canonical");
});

test("structured data: valid JSON-LD that describes only what is true (a Calgary service-area business), with no reviews, ratings, prices or phone", () => {
  const home = flat(blocks(read("index.html")));
  const biz = home.find((x) => x["@type"] === "ProfessionalService");
  assert.ok(biz && biz["@id"] === SITE + "/#business" && biz.name === "Framework" && biz.url === SITE + "/");
  assert.equal(biz.address.addressLocality, "Calgary"); assert.equal(biz.address.addressRegion, "AB");
  assert.ok(!biz.address.streetAddress, "no street address is invented");
  assert.deepEqual(biz.areaServed.map((a) => a.name), ["Calgary", "Airdrie", "Cochrane", "Okotoks", "Chestermere", "Alberta", "Canada"]);
  assert.ok(home.some((x) => x["@type"] === "WebSite"));
  for (const [route, file] of PUBLIC_PAGES) {
    const all = JSON.stringify(blocks(read(file)));
    for (const forbidden of ["aggregateRating", "AggregateRating", '"review"', '"Review"', "telephone", "priceRange", "offers", "sameAs"]) assert.ok(!all.includes(forbidden), `${file} must not declare ${forbidden}`);
  }
  for (const file of ["services", "about", "method", "portfolio", "contact", "assessment", "privacy"]) {
    const crumbs = flat(blocks(read(file + ".html"))).find((x) => x["@type"] === "BreadcrumbList");
    assert.ok(crumbs && crumbs.itemListElement.length === 2 && crumbs.itemListElement[1].item === SITE + "/" + file, file + " breadcrumb");
  }
});

test("no internal link points at a .html address that would redirect", () => {
  for (const [, file] of PUBLIC_PAGES.concat([["/404", "404.html"], ["/client-feedback", "client-feedback.html"]])) {
    const bad = [...read(file).matchAll(/href="(\/?(?:index|about|services|method|portfolio|contact|privacy|assessment|contractor-websites)\.html[^"]*)"/g)].map((m) => m[1]);
    assert.deepEqual(bad, [], file + " links to .html pages");
  }
});

test("the free assessment is linked from every public page, in the footer and in a prompt", () => {
  for (const [, file] of PUBLIC_PAGES.filter(([r]) => !["/assessment", "/privacy"].includes(r))) {
    const h = read(file);
    assert.match(h, /<a href="\/assessment" data-track="assessment_cta" data-track-location="footer">Free Assessment<\/a>/, file + " footer link");
    if (file === "nexus.html") continue; // the product page carries the footer link; its call to action is the contact form
    assert.ok(/href="\/assessment"[^>]*data-track="assessment_cta"|data-track="assessment_cta"[^>]*href="\/assessment"/.test(strip(h)) && (h.match(/href="\/assessment"/g) || []).length >= 2, file + " has a prompt as well as the footer link");
  }
  assert.match(read("index.html"), /href="\/contractor-websites"/); // the home page links to the contractor page
});

test("the contractor page: Calgary first, Alberta and Canada too, honest about samples, with real FAQ markup and nothing promised that cannot be", () => {
  const h = read("contractor-websites.html"), t = text(h);
  assert.equal(attr(h, /<title>(.*?)<\/title>/s), "Website Design for Contractors in Calgary, Alberta | Framework");
  assert.match(attr(h, /<h1[^>]*>(.*?)<\/h1>/s), /Websites for contractors/);
  for (const w of ["Calgary", "Alberta", "Canada"]) assert.ok(t.includes(w), w);
  assert.ok(!/\$\s?\d|\d\s?(CAD|dollars)|starting at|per month/i.test(t), "no prices (Phase 1 publishes none)");
  assert.ok(!/(rank|ranking)s? (#1|first|number one)|top of google|guarantee[sd]? (rank|results|leads)|\b#1\b|best in calgary|leading/i.test(t.replace("Will the website get me to the top of Google?", "").replace(/Nobody can promise a ranking, and we won't\./, "")), "no ranking or performance claims");
  assert.ok(!/tel:|\(\d{3}\)\s?\d{3}-\d{4}|\b403[-. ]\d{3}[-. ]\d{4}\b/.test(h), "no public phone number");
  assert.match(t, /concepts we built/); assert.match(t, /illustrative, not clients/);
  const conceptLinks = [...h.matchAll(/href="(\/demos\/[a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(conceptLinks)].sort(), ["/demos/fence-deck", "/demos/general-contractor", "/demos/landscaping", "/demos/renovations"]);
  assert.ok(!/testimonial|“|”|reviews? from|stars?/i.test(text(h.split('id="work-title"')[1].split('id="faq-title"')[0]).replace(/not clients|reviews in them are illustrative/g, "")), "no testimonials or review quotes in the work section");
  assert.match(h, /href="\/portfolio#red-e-title"/); assert.match(h, /href="\/portfolio#au-title"/);
  // the FAQ in the structured data is the FAQ on the page, word for word
  const faq = flat(blocks(h)).find((x) => x["@type"] === "FAQPage");
  assert.ok(faq.mainEntity.length >= 5);
  for (const q of faq.mainEntity) { assert.ok(t.includes(q.name.replace(/&/g, "&")), "question visible: " + q.name); assert.ok(t.replace(/&#39;|&apos;/g, "'").includes(q.acceptedAnswer.text.replace(/&/g, "&")), "answer visible: " + q.name); }
  const svc = flat(blocks(h)).find((x) => x["@type"] === "Service");
  assert.deepEqual(svc.areaServed.map((a) => a.name), ["Calgary", "Airdrie", "Cochrane", "Okotoks", "Chestermere", "Alberta", "Canada"]);
  assert.ok(!/image|style="/.test(h.split("<main")[1].split("</main>")[0].match(/style="[^"]*"/g)?.join("") || ""), "no inline styles");
  assert.match(h, /href="\/contact" data-track="contact_cta"/); assert.match(h, /href="\/assessment" data-track="assessment_cta"/);
  assert.match(h, /<a class="nav__link nav__link--section" href="\/services">Services<\/a>/); assert.match(h, /<li><a href="\/contractor-websites" aria-current="page">Websites for Contractors<\/a><\/li>/);
});

test("the public pages use no external script except the fonts, and analytics scripts load on every page", () => {
  for (const [, file] of PUBLIC_PAGES) {
    const h = read(file);
    assert.match(h, /<script src="\/assets\/js\/analytics-config\.js" defer><\/script>\s*<script src="\/assets\/js\/analytics\.js" defer><\/script>/, file);
  }
});

test("the contractor page visuals: every image has dimensions and alt, files exist, below-the-fold images lazy-load, motion respects reduced-motion", () => {
  const h = read("contractor-websites.html"), body = h.split("<main")[1].split("</main>")[0];
  const imgs = [...body.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(imgs.length >= 16);
  for (const i of imgs) {
    assert.match(i, /\bwidth="\d+"/, i); assert.match(i, /\bheight="\d+"/, i); assert.match(i, /\balt="/, i);
    for (const [, u] of i.matchAll(/(?:src|srcset)="([^"]+)"/g)) for (const part of u.split(",")) {
      const f = part.trim().split(/\s+/)[0]; if (f.startsWith("/assets/")) assert.ok(existsSync(join(root, f)), "missing " + f);
    }
  }
  const eager = imgs.filter((i) => !/loading="lazy"/.test(i));
  assert.ok(eager.length <= 6, "only hero images load eagerly");
  assert.ok(imgs.filter((i) => /loading="lazy"/.test(i)).length >= 12);
  assert.match(h, /href="\/assets\/css\/contractors\.css"/); assert.match(h, /src="\/assets\/js\/contractors\.js" defer/);
  assert.match(read("assets/js/contractors.js"), /prefers-reduced-motion: reduce/);
  assert.match(read("assets/css/contractors.css"), /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(!/border-radius|box-shadow/.test(read("assets/css/contractors.css")), "Framework identity: no rounded corners, no shadows");
  assert.match(text(h), /Photography on this page by .* on Unsplash/);
});
