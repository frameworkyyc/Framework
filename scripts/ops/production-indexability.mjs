#!/usr/bin/env node
// Read-only check that the LIVE Production site is indexable after a release (run it after every Production release):
//   NODE_USE_ENV_PROXY=1 node scripts/ops/production-indexability.mjs [--base https://frameworkco.ca]
// For every page in the live sitemap it requires: HTTP 200, HTML, no noindex/none/nofollow-all in the X-Robots-Tag header or the robots meta tag,
// a canonical that is the page's own address, and a title. It also requires robots.txt to allow crawling and the sitemap to list live-site addresses only,
// and confirms the private pages (/me, /client-feedback, /demos/) are still noindex. Exit code 1 on any failure. Staging's noindex rules are host-specific
// (_headers) and must never appear here; this script is the proof.
const BLOCKING = /(^|[\s,])(noindex|none)(\s*,|\s|$)/i;

export function checkPage({ url, status, headers = {}, html = "" }) {
  const problems = [];
  const h = (k) => headers[k] ?? headers[k.toLowerCase()] ?? "";
  if (status !== 200) problems.push(`HTTP ${status}, expected 200`);
  if (!/text\/html/i.test(h("content-type"))) problems.push("not an HTML page");
  const xrt = h("x-robots-tag");
  if (xrt && BLOCKING.test(xrt)) problems.push(`X-Robots-Tag blocks indexing: ${xrt}`);
  const meta = (html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1];
  if (meta && BLOCKING.test(meta)) problems.push(`robots meta tag blocks indexing: ${meta}`);
  const canonical = (html.match(/<link\s+rel="canonical"\s+href="([^"]*)"/i) || [])[1];
  const own = url.replace(/\/$/, "") || url;
  if (!canonical) problems.push("no canonical link");
  else if (canonical.replace(/\/$/, "") !== own) problems.push(`canonical is ${canonical}, expected ${url}`);
  if (!/<title>[^<]+<\/title>/i.test(html)) problems.push("no title");
  return problems;
}

export function checkPrivate({ url, status, headers = {}, html = "" }) {
  const xrt = headers["x-robots-tag"] || "";
  const meta = (html.match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1] || "";
  return BLOCKING.test(xrt) || BLOCKING.test(meta) ? [] : [`${url} is no longer noindex`];
}

export function checkRobots(text, base) {
  const problems = [];
  if (/^\s*Disallow:\s*\/\s*$/im.test(text)) problems.push("robots.txt disallows the whole site");
  if (!/^\s*Allow:\s*\/\s*$/im.test(text) && /^\s*Disallow:/im.test(text)) problems.push("robots.txt has Disallow rules");
  const sitemaps = text.match(/^Sitemap:\s*(\S+)/gim) || [];
  if (sitemaps.length !== 1 || !sitemaps[0].includes(base)) problems.push("robots.txt must have exactly one Sitemap line for the live site");
  return problems;
}

export function sitemapUrls(xml) { return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]); }

export async function run({ base = "https://frameworkco.ca", fetchImpl = fetch, log = console.log } = {}) {
  const rows = []; let failed = 0;
  const add = (name, problems) => { rows.push([problems.length ? "FAIL" : "PASS", name, problems.join("; ")]); if (problems.length) failed++; };
  const get = async (u) => { const r = await fetchImpl(u, { redirect: "manual", headers: { "user-agent": "framework-indexability-check" } }); return { url: u, status: r.status, headers: Object.fromEntries([...r.headers.entries()].map(([k, v]) => [k.toLowerCase(), v])), html: await r.text() }; };
  const robots = await get(base + "/robots.txt"); add("robots.txt", robots.status === 200 ? checkRobots(robots.html, base) : [`HTTP ${robots.status}`]);
  const map = await get(base + "/sitemap.xml"); const urls = map.status === 200 ? sitemapUrls(map.html) : [];
  add("sitemap.xml", urls.length < 9 ? ["fewer than 9 pages listed"] : urls.filter((u) => !u.startsWith(base + "/") && u !== base).map((u) => "not a live-site address: " + u));
  for (const u of urls) add(u, checkPage(await get(u)));
  const www = base.replace("https://", "https://www.");
  add(www + "/", checkPage({ ...(await get(www + "/")), url: base + "/" }));
  for (const p of ["/me", "/client-feedback", "/demos/"]) add(base + p + " (private)", checkPrivate(await get(base + p)));
  for (const [s, n, p] of rows) log(`${s}  ${n}${p ? "  <- " + p : ""}`);
  log(`\n${rows.length - failed} passed, ${failed} failed (${base})`);
  return { failed, rows };
}

import { fileURLToPath } from "node:url";
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const i = process.argv.indexOf("--base");
  run({ base: i > 0 ? process.argv[i + 1] : undefined }).then((r) => { process.exitCode = r.failed ? 1 : 0; }, (e) => { console.error("Could not run the check:", e.message); process.exitCode = 2; });
}
