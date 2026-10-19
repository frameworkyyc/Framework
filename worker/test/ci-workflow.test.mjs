// Guards the CI workflow against accidental drift: it must stay a read-only, secret-free test runner with pinned actions and
// the stable job name "Node tests" (the branch ruleset's required-check name). Plain-text checks: no YAML parser is needed or installed.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const root = new URL("../../", import.meta.url);
const raw = readFileSync(new URL(".github/workflows/ci.yml", root), "utf8");
const code = raw.replace(/^\s*#.*$/gm, "").replace(/\s+#\s.*$/gm, ""); // comments removed (full-line and trailing)
const lines = code.split("\n");

test("CI plus the one reviewed manual Production D1 migration workflow exist, and .node-version pins Node 22", () => {
  assert.deepEqual(readdirSync(new URL(".github/workflows/", root)).sort(), ["ci.yml", "portal-production-d1-migration.yml"], "a new workflow must be reviewed on purpose (update this test with it)");
  assert.equal(readFileSync(new URL(".node-version", root), "utf8").trim(), "22");
  assert.match(code, /node-version-file: \.node-version/);
  assert.ok(!/^\s*node-version:/m.test(code), "one source of truth for the Node version");
});
test("triggers are limited to push and pull_request on Staging and main, plus manual dispatch", () => {
  const on = code.slice(code.indexOf("\non:"), code.indexOf("\npermissions:"));
  assert.deepEqual([...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]).sort(), ["pull_request", "push", "workflow_dispatch"]);
  assert.equal([...on.matchAll(/branches: \[Staging, main\]/g)].length, 2);
  assert.ok(!/pull_request_target|workflow_run|issue_comment|repository_dispatch|schedule|release|pull_request_review|\bcheck_run\b|\bcheck_suite\b/.test(code));
  assert.ok(!/\bpaths(-ignore)?:|branches-ignore:|tags(-ignore)?:/.test(code), "path/branch filters could leave the required check pending forever");
});
test("permissions are read-only: contents: read at the top level, nothing wider anywhere", () => {
  const blocks = [...code.matchAll(/^(\s*)permissions:\s*(.*)$/gm)];
  assert.equal(blocks.length, 1, "a single top-level permissions block");
  assert.match(code, /^permissions:\n  contents: read\n/m);
  assert.ok(!/write|read-all|write-all|id-token|actions:|packages:|pull-requests:|statuses:|checks:|deployments:/.test(code.slice(code.indexOf("\npermissions:"), code.indexOf("\nconcurrency:"))));
});
test("no secrets, tokens, deployment, database or publishing commands", () => {
  assert.ok(!/secrets\./i.test(code) && !/\bGITHUB_TOKEN\b|\btoken:/i.test(code));
  assert.ok(!/\b(wrangler|deploy|publish|release|migrat\w*|d1|r2|workers?\.dev|cloudflare|workos|curl|wget|npm|npx|pnpm|yarn|docker|ssh|scp|rsync)\b/i.test(code.replace(/^name: CI$/m, "")), "tests only");
  assert.ok(!/PORTAL_|PRIVACY_PUBLISH|CLOUDFLARE_|WRANGLER_/.test(code), "no portal, publish or Cloudflare variables");
  assert.ok(!/^\s*env:/m.test(code), "no environment variables are injected");
});
test("every third-party action is on the allow-list and pinned to a full 40-character commit SHA", () => {
  const uses = [...code.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gm)].map((m) => m[1]);
  assert.equal(uses.length, 2);
  for (const u of uses) assert.match(u, /^actions\/(checkout|setup-node)@[0-9a-f]{40}$/, u);
  assert.ok([...raw.matchAll(/uses: \S+ # v\d+\.\d+\.\d+/g)].length === 2, "each pin carries its upstream version in a comment");
  assert.match(code, /persist-credentials: false/);
});
test("the job keeps its required-check name, runs on Ubuntu 24.04 with a timeout, and cannot be skipped", () => {
  assert.match(code, /^jobs:\n  test:\n    name: Node tests\n/m);
  assert.match(code, /runs-on: ubuntu-24\.04\n/);
  assert.match(code, /timeout-minutes: \d+/);
  assert.equal([...code.matchAll(/^\s*name:\s*Node tests\s*$/gm)].length, 1);
  assert.ok(!/^\s*if:/m.test(code) && !/continue-on-error|needs:|matrix:|strategy:/.test(code), "a skipped or soft-failing job would break the gate");
});
test("the workflow runs exactly the repository's test command", () => {
  const runs = lines.filter((l) => /^\s*run:/.test(l)).map((l) => l.replace(/^\s*run:\s*/, ""));
  assert.equal(runs.length, 2);
  assert.ok(runs.includes("node --test worker/test/*.test.mjs"));
  assert.ok(runs.some((r) => /process\.versions\.node/.test(r)), "the Node-version guard step");
});
