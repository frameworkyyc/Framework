// Personal quick-access page (/me): exact destinations, Production portal disabled, private-page metadata, home-screen tags, and the public card left alone.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const html = read("me.html");
const section = (id) => new RegExp(`<section[^>]*aria-labelledby="${id}">([\\s\\S]*?)</section>`).exec(html)[1];
const hrefs = (s) => [...s.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

test("Production: Website and Admin link to the live site; the Client Portal is plain 'Coming soon' text, not a link", () => {
  const prod = section("env-production");
  assert.deepEqual(hrefs(prod), ["https://frameworkco.ca/", "https://frameworkco.ca/admin/clients"]);
  assert.match(prod, /Client Portal<\/span><\/span><span class="me-link__soon">Coming soon<\/span>/);
  assert.ok(!/\/portal/.test(prod), "no Production portal URL anywhere on the page");
});

test("Staging: Website, Admin and Client Portal all link to staging.frameworkco.ca, in that order", () => {
  assert.deepEqual(hrefs(section("env-staging")), ["https://staging.frameworkco.ca/", "https://staging.frameworkco.ca/admin/clients", "https://staging.frameworkco.ca/portal"]);
});

test("every link is one of the five approved destinations; nothing else (no secrets, tokens or emails) is on the page", () => {
  assert.equal(hrefs(html).filter((h) => !/^(https:\/\/(staging\.)?frameworkco\.ca\/(admin\/clients|portal)?)$/.test(h) && !/^https:\/\/frameworkco\.ca\/$/.test(h)).length, hrefs(html).filter((h) => /^assets\//.test(h)).length);
  assert.equal(hrefs(html).length, 5);
  assert.ok(!/<script/i.test(html), "no scripts, no service worker");
  assert.ok(!/@|token|secret|password|key=/i.test(html.replace(/<link[^>]*>/g, "").replace(/<svg[\s\S]*?<\/svg>/g, "")), "nothing sensitive in the markup");
});

test("private page: noindex/nofollow, no referrer, not in navigation, sitemap or robots; served with no-index headers", () => {
  assert.match(html, /<meta name="robots" content="noindex, nofollow">/);
  for (const f of ["index.html", "about.html", "services.html", "method.html", "portfolio.html", "contact.html", "card.html", "sitemap.xml", "robots.txt", "privacy.html"]) assert.ok(!/\/me\b|me\.html/.test(read(f).replace(/frameworkco\.ca\/[^"\s]*/g, "")), `${f} does not point to /me`);
  const headers = read("_headers");
  for (const p of ["/me", "/me.html"]) {
    const block = new RegExp(`^${p.replace(".", "\\.")}\\n((?:  .+\\n)+)`, "m").exec(headers);
    assert.ok(block, p);
    assert.match(block[1], /X-Robots-Tag: noindex, nofollow/); assert.match(block[1], /Referrer-Policy: no-referrer/); assert.match(block[1], /Cache-Control: no-cache/);
  }
});

test("home-screen support: title, apple touch icon (an existing brand asset), standalone metadata, safe-area viewport, no manifest or service worker", () => {
  assert.match(html, /<title>Framework<\/title>/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Framework">/);
  assert.match(html, /<link rel="apple-touch-icon" href="assets\/img\/apple-touch-icon\.png">/);
  assert.ok(existsSync(new URL("../../assets/img/apple-touch-icon.png", import.meta.url)));
  assert.ok(!/manifest|serviceWorker/i.test(html));
  assert.match(read("assets/css/card.css"), /safe-area-inset-top/, "the shared page frame handles the notch and home bar");
});

test("the public card is untouched: /card still ships its own files and no card file was edited for /me", () => {
  const changed = execFileSync("git", ["diff", "--name-only", "origin/Staging", "--", "card.html", "assets/css/card.css", "assets/js/card.js", "assets/js/card-config.js", "assets/js/vcard.js", "worker/card.js"], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
  assert.equal(changed.trim(), "");
});

test("/me is served as a static page: the Worker does not intercept it, and no new route, binding or setting was added", () => {
  const w = read("wrangler.jsonc");
  assert.ok(!/"\/me"/.test(w));
  assert.ok(!/\/me\b/.test(read("worker/index.js")));
});
