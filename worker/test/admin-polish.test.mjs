/* Admin polish: shared button spacing, a findable Additional Services editor with ordering, kept apart from Service Pricing. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { handleServicesApi } from "../portal/admin-services.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

test("one spacing token drives every action group, and destructive actions sit apart on the end", () => {
  const css = read("admin/assets/admin.css");
  assert.match(css, /--adm-gap-actions:\s*12px/);
  assert.match(css, /\.adm-actions\s*\{[^}]*gap:\s*var\(--adm-gap-actions\)/);
  assert.match(css, /\.adm-actions__danger\s*\{[^}]*margin-inline-start:\s*auto/);
  const ws = read("admin/assets/websites.js");
  for (const label of ["Remove file", "Remove screenshot", "Archive"]) assert.match(ws, new RegExp(`adm-actions__danger[^\\n]*${label}|${label}[^\\n]*adm-actions__danger`), label);
});

test("Additional Services and Service Pricing are separate, directly reachable Admin entries", () => {
  const mods = read("admin/assets/modules.js");
  assert.match(mods, /id: "additional-services"[^}]*path: "\/admin\/settings\/additional-services"/);
  assert.match(mods, /id: "service-pricing"[^}]*path: "\/admin\/settings\/service-pricing"/);
  assert.ok(mods.indexOf('id: "additional-services"') < mods.indexOf('id: "settings"'), "listed before the Settings hub so the longer path matches first");
  assert.match(read("admin/assets/websites.js"), /additional-services/);
});

test("the editor reorders services one place at a time and shows each price read-only", async () => {
  const w = await makeWorld();
  const env = { PORTAL_DB: w.db, PORTAL_ADMIN_WRITES: "1" };
  const call = (json, method = "POST") => handleServicesApi(new Request("https://staging.frameworkco.ca/api/admin/additional-services", { method, headers: { "Content-Type": "application/json", Origin: "https://staging.frameworkco.ca", "X-Framework-Admin": "1" }, body: method === "GET" ? undefined : JSON.stringify(json) }), env, { email: "owner@frameworkco.ca" }, "/additional-services", { now: w.clock.now() });
  const keys = async () => (await (await call(null, "GET")).json()).services.map((s) => s.key);
  const before = await keys();
  assert.equal(before.length, 4);
  assert.equal((await call({ key: before[1], move: "up" })).status, 200);
  assert.deepEqual((await keys()).slice(0, 2), [before[1], before[0]]);
  assert.equal((await call({ key: before[0], move: "sideways" })).status, 422);
  const first = (await (await call(null, "GET")).json()).services[0];
  assert.ok("price" in first);
});
