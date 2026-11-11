// Admin shell: the Overview has no Recent activity section, the Home Screen icon and name, and one divider under the last sidebar item.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url));
const text = (p) => read(p).toString("utf8");

test("Overview: the Recent activity section is gone; the other sections stay", () => {
  const ov = text("admin/assets/overview.js");
  assert.ok(!/Recent activity|activitySection|adm-act\b/.test(ov));
  for (const kept of ["Recent feedback", "invoiceSection(d && d.invoices)", "clientSection(d && d.clients)", "Support requests", "requestsSection"]) assert.ok(ov.includes(kept), kept);
});

test("Home Screen: the Admin page names the app Framework Admin and uses the same Framework logo as the digital business card", () => {
  const html = text("admin/index.html"), card = text("card.html");
  assert.match(html, /<title>Framework Admin<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Framework Admin">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/img\/apple-touch-icon\.png">/, "an absolute path, so it works from every /admin/... page");
  assert.match(card, /<link rel="apple-touch-icon" href="assets\/img\/apple-touch-icon\.png">/, "the card uses the very same file");
  const png = read("assets/img/apple-touch-icon.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 180); assert.equal(png.readUInt32BE(20), 180);
});

test("Sidebar: no empty trailing nav group, and the footer adds no second divider under the last item", () => {
  const js = text("admin/assets/admin.js"), css = text("admin/assets/admin.css");
  assert.match(js, /rest\.length \? h\("div", \{ class: "adm-nav__group" \}, h\("ul", null, rest\.map\(navItem\)\)\) : null/);
  const foot = css.match(/^\.adm-side__foot \{([^}]*)\}/m)[1];
  assert.ok(!/border/.test(foot) && !/padding-top/.test(foot), "the last nav row's rule is the one divider");
  assert.match(css, /^\.adm-nav__link \{[^}]*border-bottom: 1px solid var\(--hairline\)/m, "every nav row, the last included, ends in the same rule");
});
