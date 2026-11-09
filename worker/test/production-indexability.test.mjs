// The post-release Production indexability check (scripts/ops/production-indexability.mjs) and the repository-side gates that keep Staging's noindex away from Production.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkPage, checkPrivate, checkRobots, sitemapUrls, run } from "../../scripts/ops/production-indexability.mjs";
import { PUBLIC_PAGES } from "../../scripts/seo/update-sitemap.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => readFileSync(root + f, "utf8");
const page = (url, over = {}) => ({ url, status: 200, headers: { "content-type": "text/html" }, html: `<title>T</title><link rel="canonical" href="${url}">`, ...over });

test("check: a normal public page passes; every way of blocking or breaking indexing is caught", () => {
  const u = "https://frameworkco.ca/about";
  assert.deepEqual(checkPage(page(u)), []);
  assert.deepEqual(checkPage(page("https://frameworkco.ca/")), []);
  const bad = (over, re) => assert.match(checkPage(page(u, over)).join("|"), re);
  bad({ headers: { "content-type": "text/html", "x-robots-tag": "noindex" } }, /X-Robots-Tag blocks indexing/);
  bad({ headers: { "content-type": "text/html", "x-robots-tag": "noindex, nofollow" } }, /X-Robots-Tag/);
  bad({ headers: { "content-type": "text/html", "x-robots-tag": "none" } }, /X-Robots-Tag/);
  bad({ html: `<meta name="robots" content="noindex, follow"><title>T</title><link rel="canonical" href="${u}">` }, /robots meta tag/);
  bad({ status: 404 }, /HTTP 404/); bad({ status: 307 }, /HTTP 307/); bad({ headers: { "content-type": "application/json" } }, /not an HTML page/);
  bad({ html: `<title>T</title><link rel="canonical" href="https://staging.frameworkco.ca/about">` }, /canonical is/);
  bad({ html: "<title>T</title>" }, /no canonical/); bad({ html: `<link rel="canonical" href="${u}">` }, /no title/);
  assert.deepEqual(checkPage(page(u, { headers: { "content-type": "text/html", "x-robots-tag": "max-snippet:-1" } })), [], "harmless robots directives are fine");
});

test("check: robots.txt, sitemap and private pages", () => {
  assert.deepEqual(checkRobots("User-agent: *\nAllow: /\n\nSitemap: https://frameworkco.ca/sitemap.xml\n", "https://frameworkco.ca"), []);
  assert.match(checkRobots("User-agent: *\nDisallow: /\nSitemap: https://frameworkco.ca/sitemap.xml\n", "https://frameworkco.ca").join(), /disallows the whole site/);
  assert.match(checkRobots("User-agent: *\nAllow: /\n", "https://frameworkco.ca").join(), /Sitemap line/);
  assert.match(checkRobots("User-agent: *\nAllow: /\nSitemap: https://staging.frameworkco.ca/sitemap.xml\n", "https://frameworkco.ca").join(), /Sitemap line/);
  assert.deepEqual(sitemapUrls("<loc>https://a/</loc><loc>https://a/b</loc>"), ["https://a/", "https://a/b"]);
  assert.deepEqual(checkPrivate({ url: "x", headers: { "x-robots-tag": "noindex, nofollow" }, html: "" }), []);
  assert.deepEqual(checkPrivate({ url: "x", headers: {}, html: '<meta name="robots" content="noindex, nofollow">' }), []);
  assert.match(checkPrivate({ url: "x", headers: {}, html: "" }).join(), /no longer noindex/);
});

// A fake live site built from the repository's own files, served the way Production would serve them (no host-specific noindex rule applies).
function fakeSite({ stagingLeak = false, brokenPage = "" } = {}) {
  const base = "https://frameworkco.ca";
  const files = new Map(PUBLIC_PAGES.map(([route, file]) => [base + route, read(file)]));
  return async (url) => {
    const u = String(url).replace(/^https:\/\/www\./, "https://");
    const headers = new Headers({ "content-type": "text/html" });
    if (u === base + "/robots.txt") return new Response(read("robots.txt"), { status: 200, headers: { "content-type": "text/plain" } });
    if (u === base + "/sitemap.xml") return new Response(read("sitemap.xml"), { status: 200, headers: { "content-type": "application/xml" } });
    if (["/me", "/client-feedback", "/demos/"].some((p) => u === base + p)) { headers.set("x-robots-tag", "noindex, nofollow"); return new Response("<title>private</title>", { status: 200, headers }); }
    if (stagingLeak) headers.set("x-robots-tag", "noindex");
    if (u === base + brokenPage) return new Response("", { status: 404, headers });
    const body = files.get(u) ?? files.get(u + "/");
    return body === undefined ? new Response("", { status: 404, headers }) : new Response(body, { status: 200, headers });
  };
}

test("the repository's own pages pass the Production check as the live site would serve them", async () => {
  const out = [];
  const r = await run({ fetchImpl: fakeSite(), log: (l) => out.push(l) });
  assert.equal(r.failed, 0, out.join("\n"));
  assert.ok(r.rows.length >= PUBLIC_PAGES.length + 5);
  for (const [route] of PUBLIC_PAGES) assert.ok(out.some((l) => l.includes("frameworkco.ca" + route) && l.startsWith("PASS")), route);
});

test("the Production check fails loudly if Staging's noindex ever leaks, or a page disappears", async () => {
  const leak = await run({ fetchImpl: fakeSite({ stagingLeak: true }), log: () => {} });
  assert.ok(leak.failed >= PUBLIC_PAGES.length, "every public page is reported");
  const gone = await run({ fetchImpl: fakeSite({ brokenPage: "/local-seo" }), log: () => {} });
  assert.equal(gone.failed, 1);
});

test("no public page, meta tag or header rule makes Production noindex: the repository gate", () => {
  for (const [route, file] of PUBLIC_PAGES) {
    const html = read(file);
    assert.ok(!/<meta\s+name="robots"[^>]*(noindex|none)/i.test(html), `${file} must not carry a robots meta tag that blocks indexing`);
    assert.ok(/<link rel="canonical" href="https:\/\/frameworkco\.ca/.test(html), file);
  }
  // header rules: only host-specific blocks for staging/preview hosts, or the private paths, may set X-Robots-Tag
  let url = ""; const allowedPaths = new Set(["/client-feedback", "/client-feedback.html", "/me", "/me.html", "/demos/*"]);
  for (const line of read("_headers").split("\n")) {
    if (/^\S/.test(line) && !line.startsWith("#")) url = line.trim();
    if (/^\s+x-robots-tag:/i.test(line)) assert.ok(allowedPaths.has(url) || url === "https://staging.frameworkco.ca/*" || url === "https://claude-:branch.frameworkco.ca/*", "X-Robots-Tag rule outside the allowed list: " + url);
  }
  assert.ok(!/(noindex|Disallow)/i.test(read("robots.txt")));
  // no Worker code adds noindex to a public page for the live hostname
  for (const f of readdirSync(root + "worker").filter((n) => n.endsWith(".js"))) {
    const src = read("worker/" + f);
    for (const m of src.matchAll(/noindex/g)) {
      const around = src.slice(Math.max(0, m.index - 400), m.index + 100);
      if (f === "card.js") assert.ok(/PRODUCTION_HOSTS/.test(src), "card.js only sets noindex off the production hosts");
      if (/handle.*Page|publicPage/i.test(around) && f !== "card.js") assert.fail(f + " adds noindex near a public page handler");
    }
  }
});

test("the release runbook names the post-release check", () => {
  assert.match(read("worker/SEO.md"), /production-indexability\.mjs/);
});
