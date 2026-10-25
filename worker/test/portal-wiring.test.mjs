// Client portal wiring. The router is connected to the Worker and the Phase 0 probe is gone. The portal is enabled for STAGING only
// (PORTAL_ENABLED in previews.vars); everywhere else every /portal path answers an explicit 404.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const MODULES = ["config", "crypto", "policy", "http", "log", "claims", "sessions", "workos", "ratelimit", "guard", "pages", "auth", "router"];

test("worker/index.js imports only the portal router, and routes /portal and /portal/* to it with an explicit 404 fallback", () => {
  const idx = code("worker/index.js");
  assert.match(idx, /import \{ handlePortal, portalNotFound \} from "\.\/portal\/router\.js";/);
  assert.equal([...idx.matchAll(/from "\.\/portal\//g)].length, 1, "one portal import");
  assert.match(idx, /if \(path === "\/portal" \|\| path\.startsWith\("\/portal\/"\)\) \{\s*return \(await handlePortal\(request, env\)\) \|\| portalNotFound\(\);\s*\}/);
  assert.ok(!/probe/i.test(idx));
});
test("the Phase 0 probe is gone everywhere in code and config (jwt.js stays: the new WorkOS client uses it)", () => {
  assert.ok(!existsSync(new URL("worker/portal/probe.js", root)));
  assert.ok(!existsSync(new URL("worker/test/portal-probe.test.mjs", root)));
  assert.ok(existsSync(new URL("worker/portal/jwt.js", root)));
  for (const f of ["worker/index.js", "wrangler.jsonc", ...readdirSync(new URL("worker/portal/", root)).filter((n) => n.endsWith(".js")).map((n) => "worker/portal/" + n)]) assert.ok(!/PROBE|probe/.test(code(f)), f);
});
test("only the Worker entry point and portal modules import the portal modules", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const p = dir + e.name;
      if (e.isDirectory()) { walk(p + "/"); continue; }
      if (!/\.(m?js)$/.test(e.name) || p.startsWith("worker/portal/") || p.startsWith("worker/test/") || p === "worker/index.js") continue;
      if (p === "worker/admin/router.js") { assert.deepEqual([...read(p).matchAll(/from "\.\.\/portal\/([^"]+)"/g)].map((m) => m[1]), ["admin-clients.js", "admin-access.js", "admin-feedback.js"], "the admin router imports exactly the two reviewed admin read modules"); continue; }
      if (/portal\//.test(read(p))) offenders.push(p);
    }
  };
  walk("worker/");
  assert.deepEqual(offenders, []);
});
test("configuration: PORTAL_ENABLED once per environment (Production launch vars and previews.vars), PORTAL_ALLOW_PRODUCTION only in Production's vars, no probe flag, one limiter binding per environment", () => {
  const cfg = code("wrangler.jsonc");
  assert.equal([...cfg.matchAll(/PORTAL_ENABLED/g)].length, 2, "Production (top level) and Staging (previews)");
  assert.ok(cfg.indexOf("PORTAL_ENABLED") < cfg.indexOf('"previews"') && cfg.lastIndexOf("PORTAL_ENABLED") > cfg.indexOf('"previews"'));
  assert.equal([...cfg.matchAll(/PORTAL_ALLOW_PRODUCTION/g)].length, 1, "the production override exists once, in Production's vars");
  assert.ok(cfg.indexOf("PORTAL_ALLOW_PRODUCTION") < cfg.indexOf('"previews"'), "and never in the Staging block");
  assert.ok(!/PORTAL_PROBE/.test(cfg), "no probe flag");
  assert.ok(!/\bunsafe\b/.test(cfg));
  assert.equal([...cfg.matchAll(/"ratelimits"/g)].length, 2, "one in Production's top level and one in previews");
  assert.equal([...cfg.matchAll(/PORTAL_RATE_LIMITER/g)].length, 2);
  assert.match(cfg, /"run_worker_first": \["\/api\/\*", "\/admin", "\/admin\/\*", "\/card", "\/portal", "\/portal\/\*"\]/);
});
test("portal modules do no work at import time, read no environment, and make no network calls except the WorkOS client", async () => {
  for (const m of MODULES) {
    const src = code(`worker/portal/${m}.js`);
    assert.ok(!/\bprocess\.env\b|\bglobalThis\.env\b/.test(src), `${m}.js reads process.env`);
    if (m !== "workos") assert.ok(!/\bfetch\s*\(/.test(src) || m === "router" || m === "auth", `${m}.js makes network calls`);
    await import(`../portal/${m}.js`);
  }
});
test("only the reviewed set of modules exists under worker/portal", () => {
  assert.deepEqual(readdirSync(new URL("worker/portal/", root)).filter((f) => f.endsWith(".js")).sort(), ["admin-access.js", "admin-clients.js", "admin-feedback.js", "auth.js", "brand-files.js", "brand-services.js", "claims.js", "config.js", "crypto.js", "demo-data.js", "demo.js", "filters.js", "form.js", "frame.js", "guard.js", "guided-data.js", "guided.js", "http.js", "invite-delivery.js", "invite-recipients.js", "jwt.js", "log.js", "module-status.js", "pages.js", "policy.js", "profile-live.js", "profile-schema.js", "ratelimit.js", "router.js", "sessions.js", "ui.js", "views.js", "welcome.js", "workos-admin.js", "workos.js"]);
});
