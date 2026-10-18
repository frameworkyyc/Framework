// Digital business card (/card): contact file format, published-data hygiene and page metadata.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleCardPage, rewriteCardHtml, PRODUCTION_HOSTS } from "../card.js";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vcard = require("../../assets/js/vcard.js");
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("card.html");
const DESCRIPTION = "Business strategy, branding, websites, and systems—for businesses starting out or ready to grow.";
const configSrc = read("assets/js/card-config.js");

const sandbox = { window: {} };
vm.runInNewContext(configSrc, sandbox);
const cfg = sandbox.window.FRAMEWORK_CARD;

const full = { name: "Alex Q. Rivera", company: "Framework", role: "Founder, Strategy & Design", phone: "+1 (403) 555-0123", email: "hello@frameworkco.ca", websiteUrl: "https://frameworkco.ca/", cardUrl: "https://frameworkco.ca/card" };

test("vCard: valid 3.0 structure with CRLF endings and every required field", () => {
  const v = vcard.build(full);
  assert.ok(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n"));
  assert.ok(v.endsWith("END:VCARD\r\n"));
  assert.ok(!/[^\r]\n/.test(v), "every line ends in CRLF");
  const lines = v.split("\r\n").filter(Boolean);
  assert.deepEqual(lines.filter((l) => /^(BEGIN|END):/.test(l)), ["BEGIN:VCARD", "END:VCARD"]);
  assert.ok(lines.includes("FN:Alex Q. Rivera"));
  assert.ok(lines.includes("N:Rivera;Alex Q.;;;"));
  assert.ok(lines.includes("ORG:Framework"));
  assert.ok(lines.includes("TITLE:Founder\\, Strategy & Design"), "commas are escaped");
  assert.ok(lines.includes("TEL;TYPE=CELL,VOICE:+14035550123"), "phone is digits and +");
  assert.ok(lines.includes("EMAIL;TYPE=INTERNET,WORK:hello@frameworkco.ca"));
  assert.ok(lines.includes("URL:https://frameworkco.ca/"));
  assert.ok(lines.includes("item1.URL:https://frameworkco.ca/card") && lines.includes("item1.X-ABLabel:Digital Business Card"));
});

test("vCard: escapes special characters, folds long lines and never injects extra properties", () => {
  const v = vcard.build({ ...full, role: "Owner; Lead\r\nEMAIL:evil@example.com", name: "Zoë O'Neil" });
  assert.ok(!/^EMAIL:evil/m.test(v), "a newline in a value cannot add a property");
  assert.ok(v.includes("TITLE:Owner\; Lead\\nEMAIL:evil@example.com"));
  const long = vcard.build({ ...full, role: "x".repeat(200) });
  for (const line of long.split("\r\n")) assert.ok(line.length <= 75, "line within 75 characters: " + line.length);
  const unfolded = long.replace(/\r\n /g, "");
  assert.ok(unfolded.includes("TITLE:" + "x".repeat(200)));
});

test("vCard: works with only the company (no personal name or phone yet) and names the file sensibly", () => {
  const v = vcard.build({ company: "Framework", email: "hello@frameworkco.ca", websiteUrl: "https://frameworkco.ca/" });
  assert.match(v, /FN:Framework\r\n/);
  assert.ok(!/TEL/.test(v) && !/TITLE/.test(v));
  assert.equal(vcard.fileName(full), "alex-q-rivera-framework.vcf");
  assert.equal(vcard.fileName({ company: "Framework" }), "framework.vcf");
});

test("config: URLs come from one place, are https, and the QR/share URL is the /card route", () => {
  assert.equal(cfg.cardUrl, "https://frameworkco.ca/card");
  assert.match(cfg.websiteUrl, /^https:\/\/frameworkco\.ca\/$/);
  assert.equal(cfg.email, "hello@frameworkco.ca");
  for (const [k, v] of Object.entries(cfg.social)) assert.ok(v === "" || /^https:\/\//.test(v), k);
});

test("config: no placeholder or invented values are published", () => {
  assert.ok(!/example\.com|555|lorem|your name|first last|TODO|TBD|@yourdomain/i.test(configSrc.replace(/e\.g\. [^\n]*/g, "")), "no placeholder values outside the comments");
  assert.ok(cfg.phone === "" || /^\+\d{7,15}$/.test(cfg.phone), "phone empty or international format");
});

test("page: branded metadata, canonical /card, preview image and no site navigation", () => {
  assert.match(html, /<title>JJ Brick \| Framework<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/frameworkco\.ca\/card">/);
  assert.match(html, /property="og:url" content="https:\/\/frameworkco\.ca\/card"/);
  assert.match(html, /property="og:image" content="https:\/\/frameworkco\.ca\/assets\/img\/og-card\.png"/);
  assert.match(html, /property="og:title" content="JJ Brick \| Framework"/);
  assert.match(html, /name="twitter:image" content="https:\/\/frameworkco\.ca\/assets\/img\/og-card\.png"/);
  assert.ok(html.includes(DESCRIPTION) && (html.match(new RegExp(DESCRIPTION, "g")) || []).length >= 4, "description in the page, meta, og and twitter");
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /viewport-fit=cover/);
  assert.ok(!/<nav|site-header|site-footer/.test(html));
  const png = readFileSync(new URL("../../assets/img/og-card.png", import.meta.url));
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
});

test("page: every control the card promises is present and labelled", () => {
  for (const id of ["save-contact", "act-call", "act-text", "act-email", "act-web", "act-portfolio", "act-assessment", "share-card", "toggle-qr", "qr-dialog", "qr-close", "social"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /<dialog class="card__qr" id="qr-dialog" aria-labelledby="qr-title">/);
  assert.match(html, /id="qr-close" aria-label="Close QR code"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<title id="card-dw-title">Framework logo/);
});

test("page: not listed for search engines, no analytics or trackers, no data collection", () => {
  assert.match(html, /name="robots" content="noindex, follow"/);
  assert.ok(!read("sitemap.xml").includes("/card"));
  const js = read("assets/js/card.js");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie/.test(js));
});

test("page: the logo is the landing-page animation (same paths and classes) and the new links use real destinations", () => {
  const home = read("index.html");
  const pick = (src, cls) => src.match(new RegExp(`<path class="dw-shape ${cls}"[^>]*>`))[0];
  for (const cls of ["dw-shape--1", "dw-shape--2"]) assert.equal(pick(html, cls), pick(home, cls));
  assert.ok(html.includes('<rect class="dw-square"') && html.includes('<g class="dw-grid">') && html.includes('<g class="dw-reg">'));
  assert.match(read("assets/css/styles.css"), /prefers-reduced-motion: reduce\) \{\s*\.dw-build/);
  // order: Save Contact, Call/Text/Email, Get a Free Assessment, View Portfolio, Visit Website, Instagram
  const order = ["save-contact", "act-call", "act-text", "act-email", "act-assessment", "act-portfolio", "act-web", "social"].map((id) => html.indexOf(`id="${id}"`));
  assert.ok(order.every((n) => n > 0));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /id="act-portfolio" href="portfolio\.html"/);
  assert.match(html, /id="act-assessment" href="assessment"/);
  assert.ok(read("portfolio.html").length && read("assessment.html").length, "destinations exist");
  assert.ok(read("sitemap.xml").includes("https://frameworkco.ca/assessment</loc>"), "assessment URL matches the site's canonical route");
});

test("identity: the visible name, title line and no-JavaScript links match the config exactly", () => {
  assert.equal(cfg.name, "JJ Brick");
  assert.equal(cfg.title, "Founder");
  assert.equal(cfg.company, "Framework");
  assert.match(html, /<h1 class="card__name" id="card-name">JJ Brick<\/h1>/);
  assert.match(html, /<p class="card__role" id="card-role">Founder, Framework<\/p>/);
  // the page must work if the script never runs, so the static markup carries the verified values
  assert.ok(html.includes(`id="act-call" href="tel:${cfg.phone}"`));
  assert.ok(html.includes(`id="act-text" href="sms:${cfg.phone}"`));
  assert.ok(html.includes(`id="act-email" href="mailto:${cfg.email}"`));
  assert.ok(html.includes(`id="act-web" href="${cfg.websiteUrl}"`));
  assert.ok(html.includes(`href="${cfg.social.instagram}"`));
  assert.ok(/id="save-contact"[^>]*hidden/.test(html) && /id="utility" hidden/.test(html), "JS-only controls stay hidden without JS");
  assert.ok(html.includes("Find out how easily potential customers can find your business online."));
});

test("contact file: JJ Brick as the person, Framework as company, Founder as title, file named jj-brick-framework.vcf", () => {
  const data = { name: cfg.name, company: cfg.company, role: cfg.title, phone: cfg.phone, email: cfg.email, websiteUrl: cfg.websiteUrl, cardUrl: cfg.cardUrl };
  const lines = vcard.build(data).split("\r\n");
  for (const l of ["N:Brick;JJ;;;", "FN:JJ Brick", "ORG:Framework", "TITLE:Founder", `TEL;TYPE=CELL,VOICE:${cfg.phone}`, `EMAIL;TYPE=INTERNET,WORK:${cfg.email}`, `URL:${cfg.websiteUrl}`, `item1.URL:${cfg.cardUrl}`]) assert.ok(lines.includes(l), l);
  assert.equal(vcard.fileName(data), "jj-brick-framework.vcf");
});

test("script: only neutral wording after the download, one-shot animation rule, environment-aware address", () => {
  const js = read("assets/js/card.js");
  assert.match(js, /Open the contact file to save my details\./);
  assert.ok(!/downloaded|saved to your contacts|added to your contacts/i.test(js), "no claim the contact was saved or imported");
  const css = read("assets/css/card.css");
  assert.match(css, /\.card__mark \.dw-build \{ animation: none; \}/);
  assert.match(css, /animation-iteration-count: 1; animation-fill-mode: forwards/);
  assert.match(read("assets/css/styles.css"), /\.dw-build \{ animation: dw-cycle 9s linear infinite; \}/, "the landing-page loop is unchanged");
  assert.match(js, /resolveCardUrl/);
});

/* ---------------------------------------------------------------- environment-aware preview metadata (worker/card.js) */

const assets = (body = html, type = "text/html; charset=utf-8", status = 200) => ({ fetch: async () => new Response(body, { status, headers: { "Content-Type": type, ETag: '"x"' } }) });
const get = (host, env, method = "GET") => handleCardPage(new Request(`https://${host}/card`, { method }), env);

test("card worker: production hosts get the stored page untouched", async () => {
  assert.deepEqual(PRODUCTION_HOSTS, ["frameworkco.ca", "www.frameworkco.ca"]);
  for (const host of PRODUCTION_HOSTS) {
    const res = await get(host, { ASSETS: assets() });
    assert.equal(await res.text(), html);
    assert.equal(res.headers.get("X-Robots-Tag"), null);
  }
});

test("card worker: Staging gets its own address in canonical, og:url and both images, and is told not to be indexed", async () => {
  const res = await get("staging.example.workers.dev", { ASSETS: assets() });
  const out = await res.text();
  const origin = "https://staging.example.workers.dev";
  assert.match(out, new RegExp(`<link rel="canonical" href="${origin}/card">`));
  assert.match(out, new RegExp(`property="og:url" content="${origin}/card"`));
  assert.match(out, new RegExp(`property="og:image" content="${origin}/assets/img/og-card\\.png"`));
  assert.match(out, new RegExp(`name="twitter:image" content="${origin}/assets/img/og-card\\.png"`));
  assert.ok(!/<(link|meta)[^>]*(canonical|og:url|og:image|twitter:image)[^>]*https:\/\/frameworkco\.ca/.test(out), "no production URL left in the preview tags");
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex, nofollow");
  assert.match(out, /name="robots" content="noindex, follow"/);
  assert.ok(out.includes('<a class="card-btn" id="act-web" href="https://frameworkco.ca/">') || out.includes('id="act-web" href="https://frameworkco.ca/"'), "page links themselves are untouched");
  assert.equal(res.headers.get("ETag"), null);
});

test("card worker: never breaks the page (non-HTML, errors and other methods pass through)", async () => {
  assert.equal((await get("x.example", { ASSETS: assets("nope", "text/plain") })).headers.get("X-Robots-Tag"), null);
  assert.equal((await get("x.example", { ASSETS: assets("gone", "text/html", 404) })).status, 404);
  const head = await get("x.example", { ASSETS: assets() }, "HEAD");
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  assert.equal(rewriteCardHtml("<p>https://frameworkco.ca/ stays</p>", "https://s.example"), "<p>https://frameworkco.ca/ stays</p>");
});

test("card worker: /card is routed to it and the config lists it", () => {
  assert.ok(/"run_worker_first": \[[^\]]*"\/card"/.test(readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8")));
  assert.match(read("worker/index.js"), /path === "\/card"\) return handleCardPage\(request, env\)/);
});
