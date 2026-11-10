// Homepage testimonials: three client quotes, each backed by a reviewed feedback record that grants
// testimonial permission ("Yes, attributed to my business only") and logo permission ("Yes"), shown with the client's
// logo (no website screenshots), one at a time. Attribution is the business name only, because that is what was granted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const home = read("index.html");
const section = home.slice(home.indexOf('class="section section--mist tm'), home.indexOf('<section class="section section--ink cta">'));
const js = read("assets/js/testimonials.js");

const QUOTES = [
  ["Aurora Surveys", "Easy to communicate with, great ideas, fast turnaround.", "aurora-logo.webp"],
  ["Eagle's Nest Resort", "Framework was on it the minute we requested a new website. I believe they started working on it that day. Ideas came to them very quickly and we loved almost every one. The product we have now is not even on the same planet as the one we had previously.", "eagle-logo.webp"],
  ["Red E Corp.", "Listened carefully to what I wanted, then put it together perfectly. Still some work to do, but that is waiting on my input. I look forward to developing this site as our company grows.", "rede-logo.webp"],
];

test("testimonials: the three permitted quotes appear verbatim, attributed to the business only, in the page itself", () => {
  const slides = [...section.matchAll(/<figure class="tm__slide"[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  assert.equal(slides.length, 3);
  QUOTES.forEach(([name, quote, logo], i) => {
    assert.ok(slides[i].includes(`<p>${quote}</p>`), `${name}: verbatim quote`);
    assert.ok(slides[i].includes(`<strong>${name}</strong>`), `${name}: business attribution`);
    assert.ok(slides[i].includes(`assets/img/clients/${logo}`), `${name}: its own logo`);
    assert.ok(existsSync(new URL(`assets/img/clients/${logo}`, root)), `${name}: logo file exists`);
    assert.match(slides[i], /<img [^>]*alt="[^"]{10,}"[^>]*width="\d+"[^>]*height="\d+"/, `${name}: logo has alt text and dimensions`);
  });
  assert.ok(!/(—|–)\s*(owner|founder|director|president|ceo|manager)/i.test(section), "no personal names or titles were permitted");
});

test("testimonials: website screenshots are gone from the section; project links stay", () => {
  assert.ok(!/assets\/img\/work\//.test(section) && !/class="bw/.test(section) && !/tm__visual|tm__layers/.test(section));
  for (const href of ["/portfolio#au-title", "/portfolio#en-title", "/portfolio#red-e-title"]) assert.ok(section.includes(`href="${href}"`), href);
});

test("testimonials: carousel markup is accessible and degrades to a plain list", () => {
  assert.match(section, /role="region" aria-roledescription="carousel" aria-label="Client testimonials"/);
  assert.equal([...section.matchAll(/aria-roledescription="slide"/g)].length, 3);
  assert.match(section, /class="tm__controls" hidden/, "controls appear only when JavaScript runs");
  assert.match(section, /aria-label="Previous testimonial"/); assert.match(section, /aria-label="Next testimonial"/);
  assert.match(section, /01<\/span> \/ 03/);
  assert.match(section, /class="tm__pause"[^>]*aria-pressed="false"/);
  assert.ok(!/\sstyle="/.test(section), "no inline styles");
  assert.equal([...section.matchAll(/<h2\b/g)].length, 1, "heading hierarchy unchanged");
  assert.match(home, /<script src="assets\/js\/testimonials\.js" defer><\/script>/);
});

test("testimonials: rotates every 8 to 10 seconds, pauses on interaction, never rotates under reduced motion", () => {
  const ms = Number(js.match(/INTERVAL = (\d+)/)[1]);
  assert.ok(ms >= 8000 && ms <= 10000, "interval " + ms);
  assert.match(js, /prefers-reduced-motion: reduce/);
  for (const ev of ["mouseenter", "focusin", "visibilitychange"]) assert.ok(js.includes(ev), ev);
  assert.match(js, /ArrowLeft/); assert.match(js, /ArrowRight/);
  assert.match(js, /setAttribute\("inert"/, "inactive slides are inert");
  assert.ok(!/innerHTML|eval\(|document\.write/.test(js), "no HTML insertion");
  const css = read("assets/css/home.css");
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.tm__carousel\.is-carousel \.tm__slide/);
});
