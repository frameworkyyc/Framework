// The environment switch: staff-only link to the other environment's fixed entry point, and the "Staging" label. Hostnames come from a fixed list; nothing from the request is ever put in the link.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { envOf, switchLink, envTag } from "../portal/env-switch.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";

test("hostnames: only the verified Framework hosts count; everything else shows nothing", () => {
  assert.equal(envOf("frameworkco.ca"), "production"); assert.equal(envOf("WWW.frameworkco.ca"), "production"); assert.equal(envOf("staging.frameworkco.ca"), "staging");
  for (const h of ["", null, undefined, "localhost", "framework.workers.dev", "evil-frameworkco.ca", "frameworkco.ca.evil.example", "staging.frameworkco.ca.evil.example", "preview.staging.frameworkco.ca"]) {
    assert.equal(envOf(h), null, String(h)); assert.equal(switchLink(h, "portal"), null); assert.equal(switchLink(h, "admin"), null); assert.equal(envTag(h), "");
  }
});

test("links go to the other environment's fixed entry point, with nothing carried over", () => {
  assert.deepEqual(switchLink("frameworkco.ca", "portal"), { label: "Switch to Staging", href: "https://staging.frameworkco.ca/portal" });
  assert.deepEqual(switchLink("www.frameworkco.ca", "admin"), { label: "Switch to Staging", href: "https://staging.frameworkco.ca/admin" });
  assert.deepEqual(switchLink("staging.frameworkco.ca", "portal"), { label: "Switch to Production", href: "https://frameworkco.ca/portal" });
  assert.deepEqual(switchLink("staging.frameworkco.ca", "admin"), { label: "Switch to Production", href: "https://frameworkco.ca/admin" });
  assert.equal(envTag("staging.frameworkco.ca"), "Staging"); assert.equal(envTag("frameworkco.ca"), "");
  assert.ok(!/[?#]/.test(switchLink("staging.frameworkco.ca", "portal").href), "no query or fragment");
});

test("client portal on Staging: everyone sees the Staging label; the switch link is for Framework staff only, in the bar and in the mobile menu, above Sign out", async () => {
  const w = await makeWorld();
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_SERVICES: "1", PORTAL_REQUESTS: "1" });
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@alpha.test", "owner");
  const ann = w.browser(), hello = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await hello.signIn(w.user(9, "hello@frameworkco.ca"));
  const client = await (await ann.get("/portal/o/alpha")).text();
  assert.match(client, /<span class="envtag">Staging<\/span>/);
  assert.ok(!/envlink|Switch to/.test(client), "a client never sees the switch");
  const staff = await (await hello.get("/portal/o/alpha")).text();
  assert.match(staff, /<span class="envtag">Staging<\/span>/);
  const links = [...staff.matchAll(/<a class="envlink" href="([^"]*)" rel="noopener noreferrer">([^<]*)<\/a>/g)];
  assert.equal(links.length, 2, "once in the account bar and once in the menu");
  for (const [, href, label] of links) { assert.equal(href, "https://frameworkco.ca/portal"); assert.equal(label, "Switch to Production"); }
  assert.ok(staff.indexOf('<li class="primary__env">') < staff.indexOf('<li class="primary__out">'), "Sign out stays last in the menu");
  assert.ok(!/(session|token|csrf)[^"]*frameworkco\.ca\/portal/i.test(staff.match(/<a class="envlink"[^>]*>/)[0]));
});

test("Admin: the sidebar footer shows the link under Sign out, and Staging shows its label", () => {
  const src = readFileSync(new URL("../../admin/assets/admin.js", import.meta.url), "utf8");
  assert.ok(src.indexOf('"Sign out"') < src.indexOf("ENV_SWITCH ? h("), "the switch comes after View website and Sign out");
  assert.match(src, /label: "Switch to Production", href: "https:\/\/frameworkco\.ca\/admin"/); assert.match(src, /label: "Switch to Staging", href: "https:\/\/staging\.frameworkco\.ca\/admin"/);
  assert.match(src, /ds-envtag/); assert.ok(!/innerHTML|outerHTML/.test(src.replace(/insertAdjacentHTML\("afterbegin", MARK\)/, "")));
});
