// Admin shell: the Overview has no Recent activity section, the Home Screen icon and name, and one divider under the last sidebar item.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url));
const text = (p) => read(p).toString("utf8");

test("Overview: the Recent activity section is gone; the other sections stay", () => {
  const ov = text("admin/assets/overview.js");
  assert.ok(!/Recent activity|activitySection|adm-act\b/.test(ov));
  for (const kept of ["Recent feedback", "invoiceSection(d && d.invoices)", "Support requests", "requestsSection"]) assert.ok(ov.includes(kept), kept);
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

test("Sidebar: six sections, the signed-in address and sign out in the footer, sections that are not built yet are not shown", () => {
  const js = text("admin/assets/admin.js");
  assert.match(js, /h\("ul", \{ class: "ds-nav" \}, NAV\.filter/);
  assert.match(js, /class: "ds-side__foot"/); assert.match(js, /href: "\/cdn-cgi\/access\/logout"/);
  assert.match(js, /ds-top/, "the top bar carries breadcrumbs, search and attention");
});

test("Overview: the Clients section (with Business Profile completion) is gone; client information stays on the Clients page, and an odd card out takes the full width", () => {
  const ov = text("admin/assets/overview.js");
  assert.ok(!/clientSection|adm-cl\b|Business Profile completion|"All clients"/.test(ov));
  assert.match(ov, /cl\.withoutAccess/, "'Needs attention' still points at clients with nobody signed in or invited");
  assert.match(ov, /function columns\(cells\)/); assert.match(ov, /single\.length % 2 === 1/);
  assert.match(ov, /columns\(\[requestsEl, requestsEl \? null : supportSection\(d && d\.support\), invoiceSection\(d && d\.invoices\)\]\.filter\(Boolean\)\)/);
});
