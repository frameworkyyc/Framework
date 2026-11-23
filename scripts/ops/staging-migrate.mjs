#!/usr/bin/env node
// Staging D1 migrations without a manual step: verify (read-only) or apply, with every safety check of the "Portal Staging D1 migration" workflow.
//   NODE_USE_ENV_PROXY=1 node scripts/ops/staging-migrate.mjs verify    read-only: database, pending list, additive SQL, tables, recovery bookmark
//   NODE_USE_ENV_PROXY=1 node scripts/ops/staging-migrate.mjs apply     the same, then applies ONLY the pending reviewed migrations and verifies the result
// Credentials: none in this repository. In the Claude Code cloud environment the Cloudflare token is injected by the network proxy (the process only sees a placeholder); on another machine
// set CLOUDFLARE_API_TOKEN yourself. The account id is discovered from the token (exactly one account must be visible), as scripts/ops/staging-health.mjs does. Nothing secret is printed.
// SAFETY (all fail closed, nothing is applied unless every check passed): the config must name framework-portal-staging by name AND id; the remote database must be that one (the Production
// databases are refused outright); the pending list may only contain migrations on the reviewed list; their SQL must be additive only; every expected table must exist; a Time Travel
// bookmark must be obtained BEFORE apply; after apply nothing may be pending, the tables must be exactly what the migrations declare, new columns must exist, and the screenshot fingerprint must be unchanged.
// Production is never reachable from here: every Wrangler call uses the Staging migration config.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as C from "../../.github/scripts/portal-staging-d1-check.mjs";
import { pendingMigrations, parseBookmark } from "../../.github/scripts/portal-d1-check.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const WRANGLER_VERSION = "4.147.0";
export const CONFIG = "migrations/portal/wrangler.migrate.staging.jsonc";
const FINGERPRINT_SQL = "SELECT count(*) AS websites, count(screenshot_key) AS with_screenshot, COALESCE(sum(screenshot_size), 0) AS bytes, COALESCE(group_concat(screenshot_sha256, ','), '') AS hashes FROM (SELECT screenshot_key, screenshot_size, screenshot_sha256 FROM websites ORDER BY id)";
const TABLES_SQL = "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name";
const COLUMNS_SQL = "SELECT name FROM pragma_table_info('websites') ORDER BY name";

/** Runs the whole sequence. `wr(args)` runs Wrangler with the Staging config and returns stdout; `read(path)` reads a repository file. Returns { ok, lines, bookmark?, applied? }. */
export async function run({ mode, wr, read = (p) => readFileSync(join(ROOT, p), "utf8") }) {
  if (mode !== "verify" && mode !== "apply") throw new Error("mode must be verify or apply");
  const lines = []; let step = "start";
  const pass = (label, detail) => lines.push(`PASS ${label}: ${detail}`);
  const exec = (sql) => wr(["d1", "execute", "PORTAL_DB", "--remote", "-c", CONFIG, "--json", "--command", sql]);
  try {
    step = "config"; pass(step, C.checkConfig(read(CONFIG)));
    step = "remote database"; pass(step, C.checkInfo(wr(["d1", "info", "PORTAL_DB", "--json", "-c", CONFIG])));
    step = "pending migrations"; const pendingText = wr(["d1", "migrations", "list", "PORTAL_DB", "--remote", "-c", CONFIG]);
    pass(step, C.checkPendingBefore(pendingText, mode));
    const names = pendingMigrations(pendingText);
    step = "migration SQL"; for (const n of names) C.lintMigration(n, read("migrations/portal/" + n)); pass(step, "additive only: " + (names.join(", ") || "nothing pending"));
    step = "tables"; const tablesBefore = exec(TABLES_SQL); pass(step, C.checkTablesBefore(tablesBefore));
    step = "screenshot data fingerprint"; const fpBefore = C.fingerprint(exec(FINGERPRINT_SQL)); pass(step, fpBefore);
    step = "recovery bookmark"; const bookmark = parseBookmark(wr(["d1", "time-travel", "info", "PORTAL_DB", "--json", "-c", CONFIG])); pass(step, bookmark);
    if (mode === "verify") return { ok: true, lines, bookmark, pending: names };
    step = "apply"; wr(["d1", "migrations", "apply", "PORTAL_DB", "--remote", "-c", CONFIG]); pass(step, "applied " + names.join(", "));
    step = "pending after"; pass(step, C.checkPendingAfter(wr(["d1", "migrations", "list", "PORTAL_DB", "--remote", "-c", CONFIG])));
    step = "tables after"; pass(step, C.checkTablesAfter(exec(TABLES_SQL), tablesBefore, names));
    step = "columns after"; pass(step, C.checkColumnsAfter(exec(COLUMNS_SQL), names));
    step = "screenshot data after"; pass(step, C.compareFingerprints(fpBefore, C.fingerprint(exec(FINGERPRINT_SQL))));
    return { ok: true, lines, bookmark, applied: names };
  } catch (e) {
    lines.push(`FAIL ${step}: ${e.message}`);
    lines.push(step === "apply" || /after/.test(step)
      ? "NEXT: the migration may be partly applied. Do not re-run blindly: check the tables, then restore from the bookmark above only with the owner's approval."
      : "NEXT: nothing was changed. Fix the reported problem, then run verify again.");
    return { ok: false, lines };
  }
}

/** Where Wrangler lives: WRANGLER_BIN, else a pinned copy installed once into the temp folder (install scripts disabled). */
function wranglerBin() {
  if (process.env.WRANGLER_BIN) return process.env.WRANGLER_BIN;
  const dir = join(tmpdir(), "framework-wrangler-" + WRANGLER_VERSION), bin = join(dir, "node_modules/.bin/wrangler");
  if (!existsSync(bin)) { mkdtempSync(join(tmpdir(), "fw-")); execFileSync("npm", ["install", "--prefix", dir, "--ignore-scripts", "--no-audit", "--no-fund", "--no-save", "wrangler@" + WRANGLER_VERSION], { stdio: "ignore" }); }
  return bin;
}
async function accountId() {
  if (process.env.CLOUDFLARE_ACCOUNT_ID) return process.env.CLOUDFLARE_ACCOUNT_ID;
  // The account id is an identifier, not a secret: wrangler.jsonc already carries it (CF_ANALYTICS_ACCOUNT_ID, "already in this repository and in every dashboard link"). Use it, so no API call is needed.
  const m = /"CF_ANALYTICS_ACCOUNT_ID":\s*"([0-9a-f]{32})"/.exec(readFileSync(join(ROOT, "wrangler.jsonc"), "utf8"));
  if (m) return m[1];
  let last = "no answer";
  for (let i = 0; i < 4; i++) { // Cloudflare occasionally throttles (code 971); a short backoff is enough
    if (i) await new Promise((r) => setTimeout(r, 4000 * i));
    const res = await fetch("https://api.cloudflare.com/client/v4/accounts", { headers: { Authorization: "Bearer " + (process.env.CLOUDFLARE_API_TOKEN || "proxy-injected") } }).catch(() => null);
    const j = res ? await res.json().catch(() => ({})) : {};
    if (j.success && Array.isArray(j.result) && j.result.length === 1) return j.result[0].id;
    last = j.errors && j.errors[0] ? `Cloudflare said: ${j.errors[0].message}` : "unexpected answer";
  }
  throw new Error("could not discover exactly one Cloudflare account from the token (" + last + ")");
}

if (import.meta.url === "file://" + process.argv[1]) {
  const mode = process.argv[2] || "verify";
  try {
    const bin = wranglerBin(), account = await accountId();
    const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN || "proxy-injected", WRANGLER_SEND_METRICS: "false", CI: "1" };
    // Cloudflare throttles bursts (code 971 with a Retry-After): wait the stated time (at most 170 s) and try the SAME call again, at most twice. Anything else fails at once.
    const wr = (args) => { for (let i = 0; ; i++) { try { return execFileSync(bin, args, { cwd: ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 180000 }); } catch (e) { const t = String((e.stdout || "") + (e.stderr || "") + e.message); const wait = /code: 971/.test(t) && i < 2 ? Math.min(170, Number((/wait (\d+) second/.exec(t) || [])[1] || 30)) : 0; if (!wait) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, (wait + 2) * 1000); } } };
    const r = await run({ mode, wr });
    console.log(r.lines.join("\n"));
    process.exit(r.ok ? 0 : 1);
  } catch (e) { console.log("FAIL start: " + (e && e.message ? String(e.message).split("\n")[0] : "unknown error") + "\nNEXT: nothing was changed. Check the network proxy and Cloudflare access, then run verify again."); process.exit(1); }
}
