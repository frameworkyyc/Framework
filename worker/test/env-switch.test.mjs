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

test("client portal on Staging: everyone sees the Staging label; the switch link lives only in the staff preview bubble, never in the bar or the Menu, and a client never gets the bubble", async () => {
  const w = await makeWorld();
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_SERVICES: "1", PORTAL_REQUESTS: "1" });
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member");
  const ann = w.browser(), mia = w.browser(), hello = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(3, "mia@alpha.test")); await hello.signIn(w.user(9, "hello@frameworkco.ca"));
  for (const b of [ann, mia]) {
    const client = await (await b.get("/portal/o/alpha")).text();
    assert.match(client, /<span class="envtag">Staging<\/span>/);
    assert.ok(!/envlink|Switch to|data-staff-preview|Preview controls|class="pv/.test(client), "a client never sees the switch or the preview controls");
  }
  const staff = await (await hello.get("/portal/o/alpha")).text();
  assert.match(staff, /<span class="envtag">Staging<\/span>/, "the Staging badge stays");
  assert.ok(!/class="envlink"|primary__env/.test(staff), "no environment link in the bar or the regular menu for staff");
  const links = [...staff.matchAll(/<a class="pv__link" href="([^"]*)"(?: rel="noopener noreferrer")?>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(links, [["/portal", "Switch client"], ["https://frameworkco.ca/portal", "Switch to Production"]], "one environment link, in the bubble, the fixed entry point");
  assert.ok(!/frameworkco\.ca\/portal[^"]*[?#;]|(session|token|csrf|alpha)[^"]*frameworkco\.ca\/portal/i.test(staff.match(/<a class="pv__link" href="https:[^>]*>/)[0]), "nothing from this visit is carried across");
});

test("Admin: the sidebar footer shows the link under Sign out, and Staging shows its label", () => {
  const src = readFileSync(new URL("../../admin/assets/admin.js", import.meta.url), "utf8");
  assert.ok(src.indexOf('"Sign out"') < src.indexOf("ENV_SWITCH ? h("), "the switch comes after View website and Sign out");
  assert.match(src, /label: "Switch to Production", href: "https:\/\/frameworkco\.ca\/admin"/); assert.match(src, /label: "Switch to Staging", href: "https:\/\/staging\.frameworkco\.ca\/admin"/);
  assert.match(src, /ds-envtag/); assert.ok(!/innerHTML|outerHTML/.test(src.replace(/insertAdjacentHTML\("afterbegin", MARK\)/, "")));
});
