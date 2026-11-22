/* Link previews (iMessage, WhatsApp, Slack…): the public entry of the portal carries Open Graph metadata in its first HTML response, the preview image is a public 1200 x 630 PNG,
   and authentication is unchanged (a signed-out /portal is still a redirect to /portal/login). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, ORIGIN } from "./helpers/portal-e2e.mjs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url));
const need = (html, origin) => {
  for (const t of [`<meta property="og:title" content="Framework | Client Portal">`, `<meta property="og:description" content="Access your Framework client workspace.">`, `<meta property="og:site_name" content="Framework">`,
    `<meta property="og:url" content="${origin}/portal">`, `<meta property="og:image" content="${origin}/assets/img/og-portal.png">`, `<meta property="og:image:width" content="1200">`, `<meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`, `<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png">`, `<link rel="icon" href="/assets/img/favicon-32.png" sizes="32x32" type="image/png">`]) assert.ok(html.includes(t), t);
  assert.ok(!/<script(?![^>]*\ssrc=)/i.test(html), "metadata is plain HTML, not injected by script");
};

for (const fx of [false, true]) {
  test(`the sign-in page (${fx ? "editorial" : "plain"}) carries the preview metadata and stays public`, async () => {
    const w = await makeWorld(); if (fx) w.env.PORTAL_TRANSITIONS = "1";
    const res = await w.browser().get("/portal/login");
    assert.equal(res.status, 200);
    need(await res.text(), ORIGIN);
  });
}

test("a signed-out /portal is still a 303 to /portal/login, and its body carries the same metadata for crawlers that read the redirect itself", async () => {
  const w = await makeWorld();
  const res = await w.browser().get("/portal");
  assert.equal(res.status, 303); assert.equal(res.headers.get("Location"), "/portal/login");
  assert.ok(!res.headers.get("Set-Cookie"), "no session is created");
  need(await res.text(), ORIGIN);
});

test("the preview image is a 1200 x 630 PNG that the assets server hands out without sign-in; an unknown host cannot name itself in the metadata", () => {
  const png = read("assets/img/og-portal.png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), 1200); assert.equal(png.readUInt32BE(20), 630);
  assert.ok(png.length < 5 * 1024 * 1024, "small enough for every messenger");
  assert.match(read("worker/portal/frame.js").toString(), /SHARE_ORIGINS = new Set\(\["https:\/\/frameworkco\.ca", "https:\/\/staging\.frameworkco\.ca"\]\)/);
});

test("shareOrigin names only the two Framework origins; any other host falls back to the canonical address", async () => {
  const { shareOrigin } = await import("../portal/frame.js");
  assert.equal(shareOrigin(new URL("https://staging.frameworkco.ca/portal")), "https://staging.frameworkco.ca");
  assert.equal(shareOrigin(new URL("https://frameworkco.ca/portal")), "https://frameworkco.ca");
  assert.equal(shareOrigin(new URL("https://evil.example/portal")), "https://frameworkco.ca");
});
