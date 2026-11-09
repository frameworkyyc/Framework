// SEO phase 2: the three service pages (/website-design, /local-seo, /branding), the homepage and hub changes, internal linking and structured data.
// These guards keep the pages honest: only claims the owner confirmed, no prices, timelines, ratings or phone numbers, the approved service area, and no filler.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_PAGES } from "../../scripts/seo/update-sitemap.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => readFileSync(root + f, "utf8");
const SITE = "https://frameworkco.ca";
const decode = (s) => s.replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const strip = (h) => h.replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, "");
const text = (h) => decode(strip(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
const attr = (h, re) => decode((h.match(re) || [])[1] || "");
const graph = (h) => [...h.matchAll(/<script type="application\/ld\+json">\s*([\s\S]*?)\s*<\/script>/g)].map((m) => JSON.parse(m[1])).flatMap((b) => (b["@graph"] ? b["@graph"] : [b]));
const PAGES = { "website-design": "website-design.html", "local-seo": "local-seo.html", "branding": "branding.html" };
const CITIES = ["Calgary", "Airdrie", "Cochrane", "Okotoks", "Chestermere"];
const html = Object.fromEntries(Object.entries(PAGES).map(([k, f]) => [k, read(f)]));

test("service pages: unique title (<=60) and description (120-160), extensionless canonical, matching social tags, one H1 with the main phrase", () => {
  const titles = new Set();
  const expect = { "website-design": ["Website Design & Development in Calgary | Framework", /website design and development/i], "local-seo": ["Local SEO for Calgary Contractors and Trades | Framework", /local seo/i], branding: ["Branding & Identity in Calgary | Framework", /branding/i] };
  for (const [slug, h] of Object.entries(html)) {
    const title = attr(h, /<title>([^<]*)<\/title>/), desc = attr(h, /<meta name="description" content="([^"]*)"/);
    assert.equal(title, expect[slug][0]); assert.ok(title.length <= 60, slug + " title length " + title.length);
    assert.ok(desc.length >= 120 && desc.length <= 160, slug + " description length " + desc.length);
    assert.ok(!titles.has(title)); titles.add(title);
    assert.equal(attr(h, /<link rel="canonical" href="([^"]*)"/), `${SITE}/${slug}`);
    assert.equal(attr(h, /<meta property="og:url" content="([^"]*)"/), `${SITE}/${slug}`);
    assert.equal(attr(h, /<meta property="og:title" content="([^"]*)"/), title); assert.equal(attr(h, /<meta property="og:description" content="([^"]*)"/), desc);
    assert.ok(!/noindex/i.test(h), slug + " is indexable");
    const h1s = [...h.matchAll(/<h1[\s>]/g)]; assert.equal(h1s.length, 1);
    assert.match(text(attr(h, /<h1[^>]*>([\s\S]*?)<\/h1>/)), expect[slug][1]);
    assert.match(h, /<html lang="en-CA">/);
  }
});

test("service pages: every page names the primary action (assessment) and the secondary (start a project), tracked, and Calgary in the first screen", () => {
  for (const [slug, h] of Object.entries(html)) {
    const head = h.slice(h.indexOf('<section class="page-head">'), h.indexOf("</section>", h.indexOf('<section class="page-head">')));
    assert.match(head, /href="\/assessment"[^>]*data-track="assessment_cta"[^>]*>Get a free online presence assessment</);
    assert.match(head, /href="\/contact"[^>]*data-track="contact_cta"[^>]*>Start a project</);
    assert.match(text(head), /Calgary/, slug);
    assert.match(h.slice(h.indexOf('<section class="section section--ink cta">')), /Ready to build your foundation\?/);
  }
});

test("service pages: the approved service area is stated (Calgary, Airdrie, Cochrane, Okotoks, Chestermere) and wider Alberta/Canada appears only in the area band and FAQ, never in titles or headings", () => {
  for (const [slug, h] of Object.entries(html)) {
    const band = h.slice(h.indexOf('class="section section--ink cx-where"'), h.indexOf('class="section section--ink cta"'));
    assert.deepEqual([...band.matchAll(/<li>([^<]+)<\/li>/g)].map((m) => m[1]), CITIES, `${slug} band lists exactly the approved communities, nothing else`);
    assert.ok(!/<strong>|Served from/.test(band), "no filler rows in the area band");
    assert.match(band, /elsewhere in Alberta and across Canada/);
    const heads = [...h.matchAll(/<(title|h1|h2)[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => decode(m[2]));
    for (const t of heads) assert.ok(!/Alberta|Canada/.test(t), `${slug} heading mentions the wider area: ${t}`);
    const svc = graph(h).find((n) => n["@type"] === "Service");
    assert.deepEqual(svc.areaServed.map((a) => a.name), [...CITIES, "Alberta", "Canada"]);
  }
});

test("service pages: structured data is Service + FAQPage + BreadcrumbList, the FAQ equals the visible FAQ, and there are no prices, offers, ratings or reviews", () => {
  for (const [slug, h] of Object.entries(html)) {
    const g = graph(h);
    assert.deepEqual(g.map((n) => n["@type"]).sort(), ["BreadcrumbList", "FAQPage", "Service"]);
    const svc = g.find((n) => n["@type"] === "Service");
    assert.equal(svc["@id"], `${SITE}/${slug}#service`); assert.equal(svc.provider["@id"], `${SITE}/#business`); assert.equal(svc.url, `${SITE}/${slug}`);
    const faq = g.find((n) => n["@type"] === "FAQPage").mainEntity;
    const visible = [...h.matchAll(/<details><summary>([\s\S]*?)<\/summary><p>([\s\S]*?)<\/p><\/details>/g)].map((m) => [text(m[1]), text(m[2])]);
    assert.ok(visible.length >= 5);
    assert.deepEqual(faq.map((q) => [q.name, q.acceptedAnswer.text]), visible, slug + " FAQ markup repeats the visible FAQ");
    const crumbs = g.find((n) => n["@type"] === "BreadcrumbList").itemListElement;
    assert.deepEqual(crumbs.map((c) => c.item), [`${SITE}/`, `${SITE}/services`, `${SITE}/${slug}`]);
    const json = JSON.stringify(g);
    assert.ok(!/"(offers?|price|priceRange|aggregateRating|review|reviewRating|telephone|sameAs)"/i.test(json), slug + " schema has no offers, prices, ratings, reviews, phone or profiles");
  }
});

test("service pages: only confirmed claims: no prices, timelines, rankings, phone numbers, addresses, Google Ads management, recurring reports or guarantees", () => {
  const banned = [
    [/\$\s?\d|\bCAD\b|\bfrom \d/i, "a price"], [/\b\d+\s*(?:-|to)?\s*\d*\s*(?:business\s+)?(?:days?|weeks?|months?)\b/i, "a timeline"],
    [/\(?\b\d{3}\)?[ -.]\d{3}[ -.]\d{4}\b/, "a phone number"], [/\b\d{1,5}\s+[A-Za-z]+(?:\s+[A-Za-z]+)?\s+(?:street|avenue|ave|road|rd|drive|dr|boulevard|blvd|trail|way|nw|sw|ne|se)\b|\b(?:suite|unit)\s*#?\d+|\bT[0-9][A-Z]\s?[0-9][A-Z][0-9]\b/i, "a street address or postal code"],
    [/google ads|adwords|ppc\b|pay-per-click|paid (?:search|ads)\b/i, "Google Ads management"], [/monthly report|weekly report|reporting package|retainer/i, "a recurring reporting package"],
    [/guarantee[ds]?\b(?! rankings)|top of google|#1|first page of google|page one|rank (?:#?1|first)/i, "a ranking promise"],
    [/award|certified|certification|years of experience|\d+\+? (?:clients|projects|websites)/i, "an unconfirmed credential or count"],
    [/(?:five|5)-star|testimonial|rated\b|reviews? (?:from|by) our/i, "a review or rating claim"],
    [/elevate|unlock|dominate|cutting-edge|world-class|game-chang|supercharge|next level|take your business|skyrocket|seamless|robust|leverage|synerg|revolution|holistic/i, "filler marketing language"],
  ];
  for (const [slug, h] of Object.entries(html)) {
    const body = text(h.slice(h.indexOf("<main"), h.indexOf("</main>")));
    for (const [re, what] of banned) {
      const m = body.match(re);
      // the Local SEO page may say what it will NOT promise
      if (m && /^(a ranking promise)$/.test(what) && /(won't|will not|not for anyone looking for|nobody can promise)/i.test(body.slice(Math.max(0, m.index - 80), m.index + 60))) continue;
      assert.ok(!m, `${slug} must not contain ${what}: "${m && m[0]}"`);
    }
  }
  const ls = text(html["local-seo"]);
  assert.match(ls, /It is not paid advertising/);
  assert.match(ls, /where your business is eligible/);
  assert.match(ls, /verification is required/);
  const wd = text(html["website-design"]);
  assert.match(wd, /where it suits the project, we host and deploy your website on Cloudflare/i);
  assert.match(wd, /Ownership of your domain and website is set out in your client agreement/);
  assert.match(wd, /we don't publish a standard turnaround/);
  const br = text(html.branding);
  assert.match(br, /Logo design and refinement/); assert.match(br, /Visual identity/); assert.match(br, /Brand guidelines and design systems/); assert.match(br, /determined by the scope of the project/);
});

test("service pages: proof only from real work (Aurora Surveys, Red E Corp., Eagle's Nest) and concept sites labelled as concepts", () => {
  const wd = text(html["website-design"]);
  for (const name of ["Aurora Surveys", "Red E Corp.", "Eagle's Nest Resort"]) assert.ok(wd.includes(name), name);
  assert.match(wd, /clearly labelled as concepts/);
  assert.match(text(html.branding), /Red E 4 Anything/);
});

test("internal linking: every link on the new pages resolves, each page links to the other two, the contractor page, the method and the assessment, and the hub, home, footers and contractor page link in", () => {
  const exists = (href) => {
    const path = href.replace(/#.*$/, "").replace(/\?.*$/, "");
    if (path === "/" || path === "") return true;
    return existsSync(root + path.slice(1) + ".html") || existsSync(root + path.slice(1));
  };
  for (const [slug, h] of Object.entries(html)) {
    for (const m of h.matchAll(/<a\b[^>]*href="(\/[^"]*)"/g)) {
      if (m[1].startsWith("/portal") || m[1].startsWith("/assets/")) continue;
      assert.ok(exists(m[1]), `${slug} links to a missing page ${m[1]}`);
    }
    const body = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const needs = { "website-design": ["/local-seo", "/branding", "/contractor-websites", "/method", "/assessment", "/portfolio#au-title", "/portfolio#red-e-title"], "local-seo": ["/website-design", "/contractor-websites", "/assessment"], branding: ["/website-design", "/method", "/assessment", "/portfolio#red-e-title"] }[slug];
    for (const must of needs) assert.ok(body.includes(`href="${must}"`), `${slug} links to ${must}`);
  }
  const home = read("index.html"), services = read("services.html"), contractor = read("contractor-websites.html");
  for (const slug of Object.keys(PAGES)) {
    assert.ok(home.includes(`href="/${slug}"`), "home links to " + slug);
    assert.ok(services.includes(`href="/${slug}"`), "services hub links to " + slug);
    assert.ok(contractor.includes(`href="/${slug}"`), "contractor page links to " + slug);
    for (const f of readdirSync(root).filter((n) => n.endsWith(".html") && !["card.html", "me.html"].includes(n))) {
      assert.ok(read(f).includes(`<li><a href="/${slug}">`), `${f} footer links to ${slug}`);
    }
  }
  assert.ok(html["local-seo"].includes('href="/assessment"'), "local SEO leads with the assessment");
});

test("homepage: title leads with Calgary website design and keeps the contractor specialization; services named; no 'logo shop' line; schema carries the approved area", () => {
  const h = read("index.html");
  const title = attr(h, /<title>([^<]*)<\/title>/);
  assert.equal(title, "Calgary Website Design, SEO & Branding | Framework"); assert.ok(title.length <= 60);
  const desc = attr(h, /<meta name="description" content="([^"]*)"/);
  assert.match(desc, /Calgary digital solutions company/); assert.match(desc, /websites, brands, SEO and business systems/); assert.match(desc, /contractors and trades/); assert.ok(desc.length >= 120 && desc.length <= 160);
  assert.equal(attr(h, /<meta property="og:title" content="([^"]*)"/), title);
  const hero = text(h.slice(h.indexOf('<p class="lead">'), h.indexOf('<div class="btn-row">'))).replace(/ ([,.?])/g, "$1");
  assert.match(hero, /Framework is a Calgary digital solutions company/); assert.match(hero, /websites, brands and digital systems for growing businesses in every industry/);
  assert.match(hero, /specializing in contractors and trades/);
  assert.ok(!/logo shop|marketing agency/i.test(text(h)), "the homepage no longer undercuts the services");
  const biz = graph(h).find((n) => n["@type"] === "ProfessionalService");
  assert.deepEqual(biz.areaServed.map((a) => a.name), [...CITIES, "Alberta", "Canada"]);
  assert.ok(biz.knowsAbout.includes("Local SEO") && biz.knowsAbout.includes("Website design and development"));
  assert.ok(!/telephone|sameAs|aggregateRating|review/i.test(JSON.stringify(graph(h))));
});

test("services hub: four approved offerings, each with the problem and what you get, linking to its page; Strategy and Growth are no longer services", () => {
  const h = read("services.html");
  assert.equal(attr(h, /<title>([^<]*)<\/title>/), "Services: Websites, SEO, Branding & Systems | Framework");
  for (const id of ["website", "seo", "branding", "systems"]) assert.ok(h.includes(`id="${id}"`), id);
  for (const id of ["strategy", "digital-presence", "automation", "growth"]) assert.ok(!h.includes(`id="${id}"`), id + " is no longer a service");
  for (const href of ["/website-design", "/local-seo", "/branding", "/business-systems", "/contractor-websites", "/method", "/assessment"]) assert.ok(h.includes(`href="${href}"`), href);
  assert.equal((h.match(/class="service__label">The problem</g) || []).length, 4); assert.equal((h.match(/class="service__label">What you get</g) || []).length, 4);
  assert.ok(!/Seven categories|AI Automation|Performance reporting/.test(h));
});

test("sitemap: lists the three new pages by canonical address; they are public pages", () => {
  const routes = PUBLIC_PAGES.map(([r]) => r);
  for (const slug of Object.keys(PAGES)) assert.ok(routes.includes("/" + slug));
  const map = read("sitemap.xml");
  for (const slug of Object.keys(PAGES)) assert.ok(map.includes(`<loc>${SITE}/${slug}</loc>`));
  assert.equal([...map.matchAll(/<loc>/g)].length, PUBLIC_PAGES.length);
});

test("design system: the new pages reuse the site's own components and add no styles, inline styling or scripts of their own", () => {
  for (const [slug, h] of Object.entries(html)) {
    assert.ok(!/<style[\s>]/.test(h) && !/\sstyle="/.test(h), slug + " has no inline styling");
    assert.ok(!/<img\b/.test(strip(h.slice(h.indexOf("<main"), h.indexOf("</main>")))) || true);
    const sheets = [...h.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(sheets.filter((s) => !s.startsWith("https://")), ["assets/css/styles.css", "/assets/css/contractors.css"]);
    for (const cls of ["page-head", "display", "lead", "split", "service", "cells", "cx-faq", "cx-area", "section--ink"]) assert.ok(h.includes(cls), `${slug} uses ${cls}`);
    assert.ok(!/<script(?![^>]*type="application\/ld\+json")[^>]*src="[^"]*"/.test(h.replace(/<script src="(?:assets|\/assets)\/js\/(?:main|analytics-config|analytics)\.js" defer><\/script>/g, "")), slug + " loads only the site's standard scripts");
  }
});

test("service pages: portfolio imagery is real, accurate and light: existing assets only, sized, lazy, described; branding is claimed only for Red E Corp.", () => {
  for (const [slug, h] of Object.entries(html)) {
    const main = h.slice(h.indexOf("<main"), h.indexOf("</main>"));
    const imgs = [...main.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
    for (const img of imgs) {
      const src = attr(img, /src="([^"]+)"/);
      assert.ok(existsSync(root + src.replace(/^\//, "")), `${slug}: ${src} exists`);
      assert.match(src, /^\/assets\/img\/(aurora-hero\.jpg|red-e-site-home\.jpg)$/, `${slug}: only the approved project screenshots`);
      assert.match(img, /\swidth="\d+"/); assert.match(img, /\sheight="\d+"/); assert.match(img, /loading="lazy"/); assert.match(img, /decoding="async"/);
      assert.ok(attr(img, /alt="([^"]*)"/).length > 15, `${slug}: ${src} has real alt text`);
    }
    const size = imgs.reduce((n, i) => n + readFileSync(root + attr(i, /src="([^"]+)"/).replace(/^\//, "")).length, 0);
    assert.ok(size < 300 * 1024, `${slug}: page imagery stays light (${size} bytes)`);
  }
  assert.equal([...html["local-seo"].matchAll(/<img\b/g)].length, 0, "local SEO shows no imagery: there are no search results to show, and none are implied");
  const wd = html["website-design"], br = html.branding;
  assert.ok(wd.includes("/assets/img/aurora-hero.jpg") && wd.includes("/assets/img/red-e-site-home.jpg"));
  assert.ok(br.includes("/assets/img/red-e-site-home.jpg") && !/aurora|Aurora Surveys\b[^.]*\b(brand|identity)/.test(br.slice(br.indexOf("<main"), br.indexOf("</main>")).replace(/For Aurora Surveys we built around the notes[^<]*/, "")), "branding page does not suggest Framework branded Aurora Surveys");
  assert.match(text(wd), /Aurora Surveys supplied its own identity/, "the website page says Aurora brought its own identity");
  assert.match(br, /Brand system and website for an industrial, commercial and institutional project management company/);
});
