// Homepage Nexus showcase: flat, Linear-style. Headline and messaging, CTA and the development disclaimer are kept;
// the interface is real Nexus captures shown flat (no angled, floating or 3D mockups).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const home = readFileSync(new URL("index.html", root), "utf8");
const css = readFileSync(new URL("assets/css/home.css", root), "utf8");
const start = home.indexOf('id="nexus-feature"');
const section = home.slice(home.lastIndexOf("<section", start), home.indexOf("</section>", start));
const nxCss = css.split("\n").filter((l) => /^\s*(\.nx|\.js \.nx|@media[^\n]*\{\s*\.nx)/.test(l) || /^\s+\.nx/.test(l)).join("\n");

test("nexus section: messaging, CTA and development disclaimer are kept", () => {
  assert.match(section, /<h2 class="nx__title" id="nexus-title"[^>]*>Project management\. Reimagined\.<\/h2>/);
  assert.ok(section.includes("Meet Nexus. A new way to bring construction projects, people and progress together."));
  assert.match(section, /<a class="btn btn--primary" href="\/nexus">Discover Nexus /);
  assert.ok(section.includes("Nexus is under development. Public availability has not been announced."));
  assert.ok(section.includes("A Framework Product · In Development"));
});

test("nexus section: headline left, text and CTA right, then a large flat interface built from real captures", () => {
  assert.match(section, /class="nx__body">\s*<h2[\s\S]*?<\/h2>\s*<div class="nx__copy"/);
  const imgs = [...section.matchAll(/<img [^>]*src="(assets\/img\/nexus\/[a-z-]+\.webp)"[^>]*alt="([^"]+)"[^>]*width="\d+" height="\d+"[^>]*loading="lazy"/g)];
  assert.ok(imgs.length >= 4);
  for (const [, src, alt] of imgs) { assert.ok(existsSync(new URL(src, root)), src); assert.ok(alt.length > 20 && /demonstration data/.test(alt) || /dashboard|view/.test(alt), src + " alt"); }
  assert.match(section, /<source media="\(max-width: 700px\)" srcset="assets\/img\/nexus\/m-overview\.webp"/, "the phone capture is used on small screens");
  assert.ok(section.includes("Nexus interface, in development. Demonstration data."));
});

test("nexus section: no angled, floating or 3D treatment; reveals are subtle and honour reduced motion", () => {
  assert.ok(!/rotate|perspective|skew|preserve-3d|\.nx__shot|\.nx__stage/.test(nxCss), "no 3D or angled rules");
  assert.ok(!/box-shadow/.test(nxCss), "no floating shadows");
  assert.equal([...section.matchAll(/data-reveal/g)].length >= 5, true);
  assert.ok(!/\sstyle="/.test(section));
  const homeJs = readFileSync(new URL("assets/js/home.js", root), "utf8");
  assert.match(homeJs, /prefers-reduced-motion: reduce[\s\S]*return;[\s\S]*classList\.add\("js"\)/, "under reduced motion the reveal classes are never added, so everything is simply visible");
});
