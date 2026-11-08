// SEO phase 1: permanent redirects (_redirects), the branded 404 page, and the guarantee that neither can loop or hide a real page.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PUBLIC_PAGES } from "../../scripts/seo/update-sitemap.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (p) => readFileSync(root + p, "utf8");
const rules = read("_redirects").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => { const [from, to, code] = l.split(/\s+/); return { from, to, code, line: l }; });
const jsonc = (p) => JSON.parse(read(p).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, ""));

test("_redirects: every rule is a permanent 301 from one exact address to one exact address (no wildcards, no query rewriting)", () => {
  assert.ok(rules.length >= 10);
  for (const r of rules) {
    assert.equal(r.code, "301", r.line);
    assert.match(r.from, /^\/[\w\-./]*$/, r.line); assert.match(r.to, /^\/[\w\-./]*$/, r.line);
    assert.ok(!/[*:]/.test(r.line.split("#")[0]), "no splats or placeholders: " + r.line);
  }
  assert.equal(new Set(rules.map((r) => r.from)).size, rules.length, "no address is redirected twice");
});

test("_redirects: no loops and no chains (a target is never itself redirected, and never points back)", () => {
  const sources = new Set(rules.map((r) => r.from));
  for (const r of rules) {
    assert.notEqual(r.from, r.to, r.line);
    assert.ok(!sources.has(r.to), "chain or loop: " + r.line);
  }
});

test("_redirects: every target is a real page (or the home page), and no rule hides a real page or a directory", () => {
  for (const r of rules) {
    const file = r.to === "/" ? "index.html" : r.to.slice(1) + ".html";
    assert.ok(existsSync(root + file), `${r.line}: ${file} does not exist`);
    assert.ok(!r.from.endsWith("/") || r.from.length > 1, r.line);
    // a source that is a real directory (for example /demos/) would loop with the platform's own trailing-slash handling
    if (r.from.endsWith("/")) assert.ok(!existsSync(root + r.from.slice(1, -1)) || !statSync(root + r.from.slice(1, -1)).isDirectory(), "directory: " + r.line);
    // an extensionless source must not also be a real file's own address
    if (!r.from.endsWith("/") && !r.from.endsWith(".html")) assert.fail("unexpected source " + r.line);
  }
  assert.ok(!existsSync(root + "demos.html"));
});

test("_redirects: the sitemap's canonical addresses are never redirected, and every public page has its .html address redirected to the clean one", () => {
  const sources = new Set(rules.map((r) => r.from));
  for (const p of PUBLIC_PAGES) {
    const canonical = typeof p === "string" ? p : p.path || p.url || p.loc;
    if (!canonical) continue;
    assert.ok(!sources.has(canonical), "canonical address redirected: " + canonical);
  }
  for (const page of readdirSync(root).filter((f) => /^(about|assessment|contact|contractor-websites|method|portfolio|privacy|services)\.html$/.test(f))) {
    const clean = "/" + page.replace(/\.html$/, "");
    assert.ok(rules.some((r) => r.from === "/" + page && r.to === clean), page + " lacks its 301");
    assert.ok(rules.some((r) => r.from === clean + "/" && r.to === clean), clean + "/ lacks its 301");
  }
  assert.ok(rules.some((r) => r.from === "/index.html" && r.to === "/"));
  assert.ok(rules.some((r) => r.from === "/card.html" && r.to === "/card"));
});

test("internal links never point at a redirected address (no hops for visitors or crawlers)", () => {
  const sources = new Set(rules.map((r) => r.from));
  for (const f of readdirSync(root).filter((f) => f.endsWith(".html") && f !== "404.html")) {
    for (const m of read(f).matchAll(/<a\b[^>]*href="(\/[^"#?]*)/g)) assert.ok(!sources.has(m[1]), `${f} links to redirected ${m[1]}`);
  }
});

test("404: the platform serves the designed 404.html (status 404) for any missing page, and the page is safe on any depth", () => {
  const w = jsonc("wrangler.jsonc");
  assert.equal(w.assets.not_found_handling, "404-page");
  assert.equal(w.assets.html_handling, undefined, "html handling stays at the platform default (no loop risk from a custom mode)");
  const html = read("404.html");
  assert.match(html, /<meta name="robots" content="noindex">/);
  assert.match(html, /<base href="\/">/, "relative assets load from deep missing paths");
  assert.match(html, /<title>Page not found — Framework<\/title>/);
  assert.match(html, /<h1[^>]*>/);
  assert.ok(/href="\/"|href="\/contact"|href="\/services"/.test(html), "offers a way back");
  // the Worker routes are unchanged by this phase
  assert.deepEqual(w.assets.run_worker_first.includes("/api/*") && w.assets.run_worker_first.includes("/card"), true);
});

test("404 handling and redirects add no duplicate-content risk: the 404 page is not in the sitemap", () => {
  assert.ok(!read("sitemap.xml").includes("404"));
  assert.ok(!read("robots.txt").includes("Disallow: /404"));
});
