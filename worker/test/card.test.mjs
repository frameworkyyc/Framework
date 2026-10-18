// Digital business card (/card): contact file format, published-data hygiene and page metadata.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const vcard = require("../../assets/js/vcard.js");
const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("card.html");
const configSrc = read("assets/js/card-config.js");

const sandbox = { window: {} };
vm.runInNewContext(configSrc, sandbox);
const cfg = sandbox.window.FRAMEWORK_CARD;

const full = { name: "Alex Q. Rivera", company: "Framework", role: "Founder, Strategy & Design", phone: "+1 (403) 555-0123", email: "hello@frameworkco.ca", websiteUrl: "https://frameworkco.ca/" };

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
  assert.equal(vcard.fileName(full), "alex-q-rivera.vcf");
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
  assert.match(html, /<title>Framework \| Digital Business Card<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/frameworkco\.ca\/card">/);
  assert.match(html, /property="og:url" content="https:\/\/frameworkco\.ca\/card"/);
  assert.match(html, /property="og:image" content="https:\/\/frameworkco\.ca\/assets\/img\/og-image\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /viewport-fit=cover/);
  assert.ok(!/<nav|site-header|site-footer/.test(html));
  assert.ok(read("assets/img/og-image.png").length > 0);
});

test("page: every control the card promises is present and labelled", () => {
  for (const id of ["save-contact", "act-call", "act-text", "act-email", "act-web", "act-portfolio", "act-assessment", "share-card", "toggle-qr", "qr-panel", "social"]) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(html, /aria-controls="qr-panel"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /<title id="card-dw-title">Framework logo/);
  for (const id of ["act-call", "act-text", "act-email"]) assert.match(html, new RegExp(`id="${id}" href="#" hidden`), id + " is hidden until configured");
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
  // order: Visit Website, View Portfolio, Get a Free Assessment
  const order = ["act-web", "act-portfolio", "act-assessment"].map((id) => html.indexOf(`id="${id}"`));
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(html, /id="act-portfolio" href="portfolio\.html"/);
  assert.match(html, /id="act-assessment" href="assessment"/);
  assert.ok(read("portfolio.html").length && read("assessment.html").length, "destinations exist");
  assert.ok(read("sitemap.xml").includes("https://frameworkco.ca/assessment</loc>"), "assessment URL matches the site's canonical route");
});
