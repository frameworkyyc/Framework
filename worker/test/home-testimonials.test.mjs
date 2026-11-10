// Homepage testimonials: a compact banner of three client quotes, each backed by a reviewed feedback record that grants
// testimonial permission ("Yes, attributed to my business only") and logo permission ("Yes"). Attribution is the business
// name only, because that is what was granted. Excerpts are verbatim sentences; the full original stays one click away.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const home = read("index.html");
const start = home.indexOf('<section class="tm ruled"');
const section = home.slice(start, home.indexOf("</section>", start));
const js = read("assets/js/testimonials.js");
const css = read("assets/css/home.css");

const QUOTES = [
  ["Aurora Surveys", "Easy to communicate with, great ideas, fast turnaround.", "/portfolio#au-title"],
  ["Eagle's Nest Resort", "Framework was on it the minute we requested a new website. I believe they started working on it that day. Ideas came to them very quickly and we loved almost every one. The product we have now is not even on the same planet as the one we had previously.", "/portfolio#en-title"],
  ["Red E Corp.", "Listened carefully to what I wanted, then put it together perfectly. Still some work to do, but that is waiting on my input. I look forward to developing this site as our company grows.", "/portfolio#red-e-title"],
];
const text = (h) => h.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

test("testimonials: sits directly after Selected Work, before Nexus", () => {
  const order = [...home.matchAll(/<section class="([^"]*)"[^>]*aria-labelledby="([^"]+)"/g)].map((m) => m[2]);
  const i = order.indexOf("work-title");
  assert.equal(order[i + 1], "testimonial-title");
  assert.equal(order[i + 2], "nexus-title");
});

test("testimonials: each excerpt is a verbatim part of the approved quote, the full quote is kept, attribution is the business only", () => {
  const slides = [...section.matchAll(/<figure class="tm__slide"[\s\S]*?<\/figure>/g)].map((m) => m[0]);
  assert.equal(slides.length, 3);
  QUOTES.forEach(([name, full, href], i) => {
    const excerpt = text(slides[i].match(/<blockquote[\s\S]*?<\/blockquote>/)[0]);
    assert.ok(excerpt.length > 20 && full.includes(excerpt), `${name}: excerpt is verbatim`);
    assert.ok(excerpt.length <= 100, `${name}: excerpt is short`);
    const details = slides[i].match(/<details class="tm__full"><summary>Read the full testimonial<\/summary><p>([\s\S]*?)<\/p><\/details>/);
    if (excerpt === full) assert.ok(!details, `${name}: the excerpt is already the whole quote`);
    else assert.equal(text(details[1]), full, `${name}: full original testimonial kept verbatim`);
    assert.ok(slides[i].includes(`<strong>${name}</strong>`), `${name}: business attribution`);
    assert.ok(slides[i].includes(`href="${href}"`), `${name}: project link`);
  });
  assert.ok(!/(—|–)\s*(owner|founder|director|president|ceo|manager)/i.test(section), "no personal names or titles were permitted");
});

test("testimonials: no client logos or screenshots in the banner, and the logo files are gone", () => {
  assert.ok(!/<img\b/.test(section) && !/assets\/img\//.test(section) && !/tm__logo|tm__visual|class="bw/.test(section));
  assert.ok(!existsSync(new URL("assets/img/clients/", root)));
  assert.ok(!/\.tm__logo/.test(css));
});

test("testimonials: carousel markup is accessible and degrades to a plain list", () => {
  assert.match(section, /role="region" aria-roledescription="carousel" aria-label="Client testimonials"/);
  assert.equal([...section.matchAll(/aria-roledescription="slide"/g)].length, 3);
  assert.match(section, /class="tm__controls" hidden/, "controls appear only when JavaScript runs");
  assert.match(section, /aria-label="Previous testimonial"/); assert.match(section, /aria-label="Next testimonial"/);
  assert.match(section, /01<\/span> \/ 03/);
  assert.match(section, /class="tm__pause"[^>]*aria-pressed="false"/);
  assert.ok(!/\sstyle="/.test(section), "no inline styles");
  assert.equal([...section.matchAll(/<h2\b/g)].length, 1, "one h2, hierarchy unchanged");
  assert.match(home, /<script src="assets\/js\/testimonials\.js" defer><\/script>/);
});

test("testimonials: rotates every 8 to 10 seconds, pauses on interaction and when a quote is expanded, never rotates under reduced motion", () => {
  const ms = Number(js.match(/INTERVAL = (\d+)/)[1]);
  assert.ok(ms >= 8000 && ms <= 10000, "interval " + ms);
  assert.match(js, /prefers-reduced-motion: reduce/);
  for (const ev of ["mouseenter", "focusin", "visibilitychange", "toggle"]) assert.ok(js.includes(ev), ev);
  assert.match(js, /ArrowLeft/); assert.match(js, /ArrowRight/);
  assert.match(js, /setAttribute\("inert"/, "inactive slides are inert");
  assert.ok(!/innerHTML|eval\(|document\.write/.test(js), "no HTML insertion");
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.tm__carousel\.is-carousel \.tm__slide/);
});
