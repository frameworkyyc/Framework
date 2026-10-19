// Client portal Stage 2A/2B must stay INERT until the later route integration: nothing wires the new modules into the live Worker,
// and nothing enables the portal. These checks fail loudly if that changes without a deliberate, reviewed edit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const NEW_MODULES = ["config", "crypto", "policy", "http", "log", "claims", "sessions", "workos", "ratelimit", "guard", "pages", "auth", "router"];

test("the live Worker entry point and the Phase 0 probe do not import any Stage 2 module", () => {
  for (const file of ["worker/index.js", "worker/portal/probe.js", "worker/portal/jwt.js"]) {
    const src = read(file);
    for (const m of NEW_MODULES) assert.ok(!new RegExp(`from\\s+["'][^"']*portal/${m}\\.js["']|from\\s+["']\\./${m}\\.js["']`).test(src), `${file} imports ${m}.js`);
    assert.ok(!/repo\/sessions/.test(src), `${file} imports the session repository`);
  }
});
test("only portal modules and tests import the Stage 2 modules", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const p = dir + e.name;
      if (e.isDirectory()) { if (e.name !== "node_modules") walk(p + "/"); continue; }
      if (!/\.(m?js)$/.test(e.name) || p.startsWith("worker/portal/") || p.startsWith("worker/test/")) continue;
      const src = read(p);
      if (/portal\/(config|crypto|policy|http|log|claims|sessions|workos|ratelimit|guard|pages|auth|router)\.js|portal\/repo\/sessions/.test(src)) offenders.push(p);
    }
  };
  walk("worker/");
  assert.deepEqual(offenders, []);
});
test("the portal is not enabled anywhere in configuration", () => {
  const cfg = read("wrangler.jsonc");
  assert.ok(!/PORTAL_ENABLED/.test(cfg), "PORTAL_ENABLED must not appear in wrangler.jsonc");
  assert.ok(!/PORTAL_ALLOW_PRODUCTION/.test(cfg));
  assert.ok(!/PORTAL_RATE_LIMITER|ratelimits|unsafe/.test(cfg), "no rate-limit binding has been added");
});
test("Stage 2 modules do no work at import time and read no environment", async () => {
  for (const m of NEW_MODULES) {
    const src = read(`worker/portal/${m}.js`).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/\bprocess\.env\b|\bglobalThis\.env\b/.test(src), `${m}.js reads process.env`);
    assert.ok(!/\bfetch\s*\(/.test(src), `${m}.js makes network calls`);
    assert.ok(!/^\s*(await\s|[a-zA-Z_.]+\([^)]*\);\s*$)/m.test(src.split("\n").filter((l) => !/^\s/.test(l) && !/^(export|import|const|let|var|function|async|class|\}|\)|\]|$)/.test(l)).join("\n")), `${m}.js runs code at top level`);
    await import(`../portal/${m}.js`);
  }
});
test("the live Worker still routes only the Phase 0 probe paths and does not mention the new router", () => {
  const idx = read("worker/index.js");
  assert.ok(/handlePortalProbe/.test(idx) && /PROBE_PATHS/.test(idx), "the probe is still wired (it is removed in the later, authorized route switch)");
  assert.ok(!/handlePortal\b|portal\/router/.test(idx.replace(/handlePortalProbe/g, "")));
  const cfg = read("wrangler.jsonc");
  assert.match(cfg, /"run_worker_first": \["\/api\/\*", "\/admin", "\/admin\/\*", "\/card", "\/portal\/login", "\/portal\/auth\/callback", "\/portal\/logout"\]/);
});
test("only the reviewed set of Stage 2 modules exists under worker/portal", () => {
  assert.deepEqual(readdirSync(new URL("worker/portal/", root)).filter((f) => f.endsWith(".js")).sort(), ["auth.js", "claims.js", "config.js", "crypto.js", "guard.js", "http.js", "jwt.js", "log.js", "pages.js", "policy.js", "probe.js", "ratelimit.js", "router.js", "sessions.js", "workos.js"]);
});
