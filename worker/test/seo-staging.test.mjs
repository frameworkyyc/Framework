// Staging and preview copies must never be indexed, and Production must stay completely unaffected.
// Static pages are served by Workers static assets, which apply _headers rules; a rule whose first line is a full URL only matches that host.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => readFileSync(root + f, "utf8");

// Minimal model of Cloudflare's matching: a placeholder (:name) matches one host label or path segment, a splat (*) matches the rest of the path.
function blocks(text) {
  const out = []; let cur = null;
  for (const raw of text.split("\n")) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    if (/^\S/.test(raw)) { cur = { url: raw.trim(), headers: [] }; out.push(cur); }
    else cur.headers.push(raw.trim());
  }
  return out;
}
function matches(rule, url) {
  const u = new URL(url);
  let pattern = rule.url;
  if (pattern.startsWith("https://")) {
    const m = pattern.match(/^https:\/\/([^/]+)(\/.*)$/);
    const host = m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/:[A-Za-z]\w*/g, "[^./]+");
    const path = m[2].replace(/\*/g, ".*");
    return new RegExp(`^${host}$`).test(u.host) && new RegExp(`^${path}$`).test(u.pathname);
  }
  return new RegExp("^" + pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$").test(u.pathname);
}
const robotsFor = (url) => blocks(read("_headers")).filter((b) => matches(b, url)).flatMap((b) => b.headers).filter((h) => /^x-robots-tag:/i.test(h)).map((h) => h.replace(/^x-robots-tag:\s*/i, ""));

test("staging and preview hosts send X-Robots-Tag: noindex on every page, including robots.txt and the sitemap", () => {
  for (const host of ["staging.frameworkco.ca", "claude-attribution-fix-staging.frameworkco.ca", "claude-seo-phase-2.frameworkco.ca"]) {
    for (const path of ["/", "/about", "/website-design", "/local-seo", "/branding", "/contractor-websites", "/robots.txt", "/sitemap.xml", "/assets/css/styles.css"]) {
      assert.ok(robotsFor(`https://${host}${path}`).includes("noindex"), `${host}${path} must be noindex`);
    }
  }
});

test("Production is unaffected: no rule adds a robots header to frameworkco.ca or www.frameworkco.ca public pages", () => {
  for (const host of ["frameworkco.ca", "www.frameworkco.ca"]) {
    for (const path of ["/", "/about", "/services", "/website-design", "/local-seo", "/branding", "/contractor-websites", "/method", "/portfolio", "/contact", "/assessment", "/privacy", "/robots.txt", "/sitemap.xml"]) {
      assert.deepEqual(robotsFor(`https://${host}${path}`), [], `${host}${path} must carry no X-Robots-Tag`);
    }
  }
  // the private pages that were already noindex stay noindex everywhere
  for (const path of ["/client-feedback", "/me", "/demos/index.html"]) assert.ok(robotsFor(`https://frameworkco.ca${path}`).length > 0, path);
});

test("the staging rules are host-specific blocks, and no path-only rule marks the whole site noindex", () => {
  const all = blocks(read("_headers"));
  const hostRules = all.filter((b) => b.url.startsWith("https://"));
  assert.deepEqual(hostRules.map((b) => b.url), ["https://staging.frameworkco.ca/*", "https://claude-:branch.frameworkco.ca/*"]);
  for (const b of hostRules) assert.deepEqual(b.headers, ["X-Robots-Tag: noindex"]);
  for (const b of all.filter((b) => !b.url.startsWith("https://") && /^\/\*?$|^\/\*$/.test(b.url))) assert.ok(!b.headers.some((h) => /x-robots-tag/i.test(h)), "a site-wide rule must not set X-Robots-Tag: " + b.url);
  // never a bare wildcard host that would also match www.frameworkco.ca
  for (const b of hostRules) assert.ok(!/^https:\/\/(:\w+|\*)\.frameworkco\.ca/.test(b.url), b.url);
});

test("robots.txt stays crawlable (so Google can read the noindex header) and is the Production file: no Disallow, one Sitemap line for the live site", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^User-agent: \*\nAllow: \/\n/m);
  assert.ok(!/^\s*Disallow:\s*\S/im.test(robots), "no Disallow rule");
  assert.deepEqual(robots.match(/^Sitemap:.*$/gm), ["Sitemap: https://frameworkco.ca/sitemap.xml"]);
});

test("the sitemap lists only live-site addresses: Staging never advertises its own URLs", () => {
  const locs = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.ok(locs.length >= 12);
  for (const l of locs) assert.match(l, /^https:\/\/frameworkco\.ca(\/|$)/, l);
  assert.ok(!/staging|workers\.dev|claude-/.test(read("sitemap.xml")));
  // and every page's canonical points at the live site, so a copy on Staging never claims to be the original
  for (const f of ["index.html", "about.html", "services.html", "website-design.html", "local-seo.html", "branding.html", "contractor-websites.html", "method.html", "portfolio.html", "contact.html", "assessment.html", "privacy.html"]) {
    assert.match(read(f), /<link rel="canonical" href="https:\/\/frameworkco\.ca\//, f);
  }
});
