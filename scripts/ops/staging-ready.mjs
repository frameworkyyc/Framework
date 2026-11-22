#!/usr/bin/env node
// Waits until a Staging deployment is ready for visual review, then prints one short verdict. Replaces the manual "run the health check until the deployed commit matches" loop.
//   NODE_USE_ENV_PROXY=1 node scripts/ops/staging-ready.mjs [--minutes 12]
// READY means: scripts/ops/staging-health.mjs reports no FAIL and "deployed code ... is the Staging head" (so the Workers build for the newest Staging commit is live). Anything else exits 1 with the
// failing rows and a plain next step. Read-only; no credential is read or printed here (staging-health.mjs handles its own access).
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HEALTH = fileURLToPath(new URL("./staging-health.mjs", import.meta.url));

/** Turns the text of one health run into { ready, fails, builds, summary }. Pure, so it is tested. */
export function readHealth(text) {
  const rows = text.split("\n").filter((l) => l.startsWith("|"));
  const cells = (l) => l.split("|").map((c) => c.trim()).filter(Boolean);
  const fails = rows.map(cells).filter((c) => c[0] === "FAIL").map((c) => `${c[1]}: ${c[2]}`);
  const deploy = rows.map(cells).find((c) => c[1] === "deploy.commit");
  const build = rows.map(cells).find((c) => c[1] === "github.check.workers-builds-framework");
  const summary = (text.match(/^PASS \d+ \| WARN \d+ \| FAIL \d+/m) || [""])[0];
  return { ready: Boolean(deploy && deploy[0] === "PASS") && fails.length === 0, fails, deploy: deploy ? deploy.slice(2).join(" ") : "no deploy.commit row", build: build ? `${build[0]}: ${build.slice(2).join(" ")}` : "", summary };
}

if (import.meta.url === "file://" + process.argv[1]) {
  const minutes = Number((process.argv[process.argv.indexOf("--minutes") + 1]) || 12);
  const end = Date.now() + minutes * 60000; let last = null;
  while (true) {
    let text = "";
    try { text = execFileSync("node", [HEALTH], { encoding: "utf8", env: { ...process.env, NODE_USE_ENV_PROXY: "1" }, timeout: 120000 }); } catch (e) { text = String(e.stdout || "") + String(e.stderr || ""); }
    last = readHealth(text);
    if (last.fails.length) { console.log(`NOT READY: ${last.summary}\n${last.fails.join("\n")}\nNEXT: fix the failing check above (nothing was changed by this script), then run it again.`); process.exit(1); }
    if (last.ready) { console.log(`READY: ${last.summary}; ${last.deploy}`); process.exit(0); }
    if (/failure|failed/i.test(last.build)) { console.log(`NOT READY: the Staging build failed (${last.build}).\nNEXT: open the Workers Builds log for the Staging commit, fix the build error, push the fix.`); process.exit(1); }
    if (Date.now() > end) { console.log(`NOT READY after ${minutes} min: ${last.deploy}${last.build ? "; " + last.build : ""}\nNEXT: the build is still running or stuck; check Workers Builds for the Staging commit.`); process.exit(1); }
    await new Promise((r) => setTimeout(r, 30000));
  }
}
