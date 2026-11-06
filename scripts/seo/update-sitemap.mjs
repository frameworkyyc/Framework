#!/usr/bin/env node
// Rebuilds sitemap.xml from the list of public pages below, using each page's canonical route and its last-changed date.
//   node scripts/seo/update-sitemap.mjs          write sitemap.xml
//   node scripts/seo/update-sitemap.mjs --check  exit 1 if the sitemap would change (the dates are ignored)
// lastmod = the date of the last commit that touched the page's file, or today when the file has uncommitted changes. Only pages that should
// appear in search belong here; private pages (/me, /card, /client-feedback, /portal, /admin, /demos) and 404 are never listed.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

export const PUBLIC_PAGES = [
  ["/", "index.html"], ["/about", "about.html"], ["/services", "services.html"], ["/contractor-websites", "contractor-websites.html"], ["/method", "method.html"],
  ["/portfolio", "portfolio.html"], ["/contact", "contact.html"], ["/assessment", "assessment.html"], ["/privacy", "privacy.html"],
];
const SITE = "https://frameworkco.ca";
const root = new URL("../../", import.meta.url);

const git = (...args) => { try { return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } };
const today = () => new Date().toISOString().slice(0, 10);

function lastmod(file, previous) {
  if (git("status", "--porcelain", "--", file)) return today();
  return git("log", "-1", "--format=%cs", "--", file) || previous || today();
}

export function build() {
  let old = "";
  try { old = readFileSync(new URL("sitemap.xml", root), "utf8"); } catch { /* first run */ }
  const prev = (loc) => { const m = old.match(new RegExp("<loc>" + loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "</loc><lastmod>([^<]+)</lastmod>")); return m ? m[1] : ""; };
  const rows = PUBLIC_PAGES.map(([route, file]) => { const loc = SITE + route; return `  <url><loc>${loc}</loc><lastmod>${lastmod(file, prev(loc))}</lastmod></url>`; });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${rows.join("\n")}\n</urlset>\n`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const next = build();
  if (process.argv.includes("--check")) {
    const strip = (x) => x.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
    process.exit(strip(next) === strip(readFileSync(new URL("sitemap.xml", root), "utf8")) ? 0 : 1);
  }
  writeFileSync(new URL("sitemap.xml", root), next);
  console.log("sitemap.xml written (" + PUBLIC_PAGES.length + " pages)");
}
