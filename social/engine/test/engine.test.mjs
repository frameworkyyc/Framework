// Engine smoke test: renders the sample batch into a temp folder and checks dimensions, fit and the failure paths. Spends no credits.
// Needs Playwright + Chromium and network access to Fontshare on the first run (fonts are cached afterwards).
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FW = new URL("../fw.mjs", import.meta.url).pathname;
const SAMPLE = new URL("../../examples/sample-batch/", import.meta.url).pathname;
const fw = (...args) => spawnSync(process.execPath, [FW, ...args], { encoding: "utf8" });
const png = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("renders the sample batch to 1080x1350 PNGs with no failures", () => {
  const dir = mkdtempSync(join(tmpdir(), "fw-")); cpSync(SAMPLE, dir, { recursive: true });
  const r = fw("render", dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.doesNotMatch(r.stdout, /FAIL/);
  const slides = readdirSync(join(dir, "posts/01-strategy-before-design/slides"));
  assert.equal(slides.length, 6);
  for (const s of slides) assert.deepEqual(png(join(dir, "posts/01-strategy-before-design/slides", s)), [1080, 1350]);
});

test("refuses copy that cannot fit, instead of shipping a broken slide", () => {
  const dir = mkdtempSync(join(tmpdir(), "fw-")); cpSync(SAMPLE, dir, { recursive: true });
  const p = join(dir, "posts/02-drawn-then-built/spec.json"), spec = JSON.parse(readFileSync(p, "utf8"));
  spec.slides[0].support = "This sentence is far too long for a panel. ".repeat(30);
  writeFileSync(p, JSON.stringify(spec));
  const r = fw("render", join(dir, "posts/02-drawn-then-built"));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /does not fit/);
});

test("check fails a batch with missing captions and banned voice", () => {
  const dir = mkdtempSync(join(tmpdir(), "fw-")); cpSync(SAMPLE, dir, { recursive: true });
  fw("render", dir);
  const post = join(dir, "posts/02-drawn-then-built");
  writeFileSync(join(post, "caption-instagram.txt"), "A game-changing plan! 🚀 #yyc");
  const r = fw("check", dir);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing caption-facebook\.txt/);
  assert.match(r.stdout, /exclamation mark/);
  assert.match(r.stdout, /emoji/);
  assert.match(r.stdout, /game-changing/);
});
