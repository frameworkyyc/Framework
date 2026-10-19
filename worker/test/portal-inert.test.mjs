// Client portal Stage 2A/2B must stay INERT until the later route integration: nothing wires the new modules into the live Worker,
// and nothing enables the portal. These checks fail loudly if that changes without a deliberate, reviewed edit.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const NEW_MODULES = ["config", "crypto", "policy", "http", "log", "claims", "sessions"];

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
      if (/portal\/(config|crypto|policy|http|log|claims|sessions)\.js|portal\/repo\/sessions/.test(src)) offenders.push(p);
    }
  };
  walk("worker/");
  assert.deepEqual(offenders, []);
});
test("the portal is not enabled anywhere in configuration", () => {
  const cfg = read("wrangler.jsonc");
  assert.ok(!/PORTAL_ENABLED/.test(cfg), "PORTAL_ENABLED must not appear in wrangler.jsonc");
  assert.ok(!/PORTAL_ALLOW_PRODUCTION/.test(cfg));
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
test("only the reviewed set of Stage 2 modules exists under worker/portal", () => {
  assert.deepEqual(readdirSync(new URL("worker/portal/", root)).filter((f) => f.endsWith(".js")).sort(), ["claims.js", "config.js", "crypto.js", "http.js", "jwt.js", "log.js", "policy.js", "probe.js", "sessions.js"]);
});
