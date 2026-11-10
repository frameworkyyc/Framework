// About page: founder-led story, credentials, major projects and the site-to-system bridge. The head (title, meta, canonical) is
// unchanged for SEO; the credentials and project facts are exactly those the founder supplied; line illustrations are inline and decorative.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const html = readFileSync(new URL("about.html", root), "utf8");
const js = readFileSync(new URL("assets/js/about.js", root), "utf8");
const css = readFileSync(new URL("assets/css/about.css", root), "utf8");
const main = html.slice(html.indexOf("<main"), html.indexOf("</main>"));
const text = main.replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");

test("about: head unchanged (title, description, canonical) and one h1 with a clear heading outline", () => {
  assert.match(html, /<title>About Framework: a Calgary digital solutions company<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/frameworkco\.ca\/about">/);
  assert.match(html, /<meta name="description" content="Framework builds businesses like an architect builds structures: strategy, then design, then execution\. For every industry, specializing in contractors\.">/);
  assert.equal([...main.matchAll(/<h1\b/g)].length, 1);
  const h2s = [...main.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
  for (const h of ["From the job site to the browser.", "Experience, by the numbers.", "Projects I have helped build.", "How building in the field shapes how I build for you."]) assert.ok(h2s.includes(h), h);
  assert.ok(!/<h3[^>]*>[^<]*<\/h3>\s*<h2/.test(main));
});

test("about: the founder story is first person and covers who, where from, why Framework exists and how field experience shapes the work", () => {
  for (const s of ["I'm the founder of Framework", "St. Clair College", "Why Framework exists", "I know what a contractor needs from a website"]) assert.ok(text.includes(s), s);
});

test("about: credentials and major projects are exactly as supplied, and projects are labelled as personal field work", () => {
  for (const s of ["General Carpentry, St. Clair College", "Scaffolder", "NCSO", "Heavy equipment operator", "Structural steel welder", "10,000+", "A decade", "residential, commercial, industrial, oil & gas"]) assert.ok(text.includes(s), s);
  for (const s of ["Keeyask Generating Station", "695 MW hydroelectric facility", "Gordie Howe International Bridge", "Early development support for concrete foundations, then scaffolding platforms",
    "NextStar Energy Battery Plant", "4.23 million sq ft", "Scaffolding platforms, insulated panels, flashing, sheet metal, fireproofing", "REEF: AltaGas, Prince Rupert, BC", "Concrete foundations, project coordination and HSE involvement"]) assert.ok(text.includes(s), s);
  assert.ok(text.includes("These are not Framework client projects."));
  assert.equal([...main.matchAll(/class="ab-proj"/g)].length, 4);
});

test("about: the bridge covers planning, problem solving, coordination, structure, quality and execution", () => {
  for (const h of ["Planning", "Problem solving", "Coordination", "Structure", "Quality", "Execution"]) assert.match(main, new RegExp(`<h3 class="ab-map__h">${h}</h3>`));
});

test("about: illustrations are inline, decorative and animation-safe; no inline styles; reveals skip under reduced motion; page loads only its own css/js plus the standard ones", () => {
  const svgs = [...main.matchAll(/<svg\b[^>]*>/g)].map((m) => m[0]);
  assert.ok(svgs.length >= 9);
  for (const s of svgs) assert.match(s, /aria-hidden="true"/);
  assert.ok(!/\sstyle="/.test(main));
  assert.match(js, /prefers-reduced-motion: reduce[\s\S]*return;[\s\S]*classList\.add\("js"\)/);
  assert.ok(!/innerHTML|eval\(|document\.write/.test(js));
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /<link rel="stylesheet" href="assets\/css\/about\.css">/);
  assert.match(html, /<script src="assets\/js\/about\.js" defer><\/script>/);
  assert.ok(/data-count="10000"/.test(main) && />10,000\+</.test(main), "the count-up element reads 10,000+ without JavaScript");
});

test("about hero: on desktop it is sized from the viewport below the header, nothing is clipped, short screens fall back, and tablet/mobile keep the original sizing", () => {
  const hero = css.slice(css.indexOf(".ab-hero {"), css.indexOf(".ab-hero__facts strong"));
  assert.match(hero, /@media \(min-width: 901px\) \{[\s\S]*min-height: calc\(100svh - var\(--header-h\) - 1px\)/, "viewport-aware, below the header");
  assert.match(hero, /max-height: calc\(100svh - var\(--header-h\)/, "the drawing is sized from the height that is left");
  assert.match(hero, /font-size: clamp\(38px, min\(4\.6vw, 8\.2svh\), 72px\)/, "headline scales with height too");
  assert.match(hero, /@media \(min-width: 901px\) and \(max-height: 520px\) \{[\s\S]*min-height: 0/, "short-screen fallback");
  assert.ok(!/overflow:\s*hidden/.test(hero), "the hero does not hide overflow");
  const base = hero.slice(0, hero.indexOf("@media"));
  assert.match(base, /padding: clamp\(56px, 8vw, 112px\) 0 clamp\(48px, 7vw, 96px\)/, "tablet and mobile keep the original spacing");
  assert.ok(!/svh/.test(base), "no viewport-height sizing below desktop");
});
