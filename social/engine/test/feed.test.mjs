// Feed tooling: layout families render, the grid check refuses neighbouring look-alikes, briefs validation enforces the strategy
// fields, and the history records a batch. No credits, no Figma calls. Writes only to temp folders.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FW = new URL("../fw.mjs", import.meta.url).pathname;
const FAMILIES = new URL("../../examples/layout-families/", import.meta.url).pathname;
const tmp = () => mkdtempSync(join(tmpdir(), "fw-feed-"));
const fw = (args, env = {}) => spawnSync(process.execPath, [FW, ...args], { encoding: "utf8", env: { ...process.env, FW_HISTORY_DIR: join(tmp(), "history"), ...env } });

const dir = tmp();
cpSync(FAMILIES, dir, { recursive: true });
const rendered = fw(["render", dir]);

test("every layout family renders without failures", () => {
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
  assert.equal(readdirSync(join(dir, "posts")).length, 10);
});

test("grid preview passes for a varied batch and writes the preview and report", () => {
  const r = fw(["grid", dir]);
  assert.equal(r.status, 0, r.stdout);
  assert.ok(existsSync(join(dir, "grid-preview.png")) && existsSync(join(dir, "grid-report.md")));
});

test("grid check fails when neighbouring covers share a layout family", () => {
  const d = tmp(); cpSync(dir, d, { recursive: true });
  // Post 02 becomes a second type:giant right after post 01.
  const p = join(d, "posts/02-plate/spec.json");
  writeFileSync(p, readFileSync(join(d, "posts/01-giant/spec.json")));
  cpSync(join(d, "posts/01-giant/slides"), join(d, "posts/02-plate/slides"), { recursive: true });
  const r = fw(["grid", d]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /same layout family/);
});

test("briefs validation requires goals, categories, CTA types and the six checks", () => {
  const d = tmp();
  const post = (id, extra = {}) => ({ id, slug: "post-" + id, goal: "attract", visual_category: "editorial-typography", format: "single", objective: "o", audience: "a", key_message: "k", cta_type: "save", cta: "Save this.",
    checks: { interesting: "x", value: "x", save_share_follow: "x", credibility: "x", role: "x", different: "x" }, slides: [{ template: "type", layout: "giant", headline: "H" }], ...extra });
  // A valid batch: exactly 9 posts (one 3x3 grid block), 5 attract / 3 trust / 1 convert, covers alternating between two families.
  const nine = Array.from({ length: 9 }, (_, i) => post(String(i + 1).padStart(2, "0"), {
    goal: i < 5 ? "attract" : i < 8 ? "trust" : "convert", format: i % 2 ? "carousel" : "single",
    ...(i % 2 ? { slides: [{ template: "minimal", headline: "H" }, { template: "point", headline: "P" }, { template: "cta", headline: "C" }], visual_category: "minimalist" } : {}) }));
  writeFileSync(join(d, "briefs.json"), JSON.stringify({ posts: nine }));
  const ok = fw(["validate", d]);
  assert.equal(ok.status, 0, ok.stdout);
  writeFileSync(join(d, "briefs.json"), JSON.stringify({ posts: [post("01"), post("02", { checks: { interesting: "x" }, goal: "promo" })] }));
  const bad = fw(["validate", d]);
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /checks\.value unanswered/);
  assert.match(bad.stdout, /goal must be one of/);
  assert.match(bad.stdout, /same layout family/);
  assert.match(bad.stdout, /exactly 9 posts/);
});

test("history records a batch with cover thumbnails and reports no conclusions without data", () => {
  const h = join(tmp(), "history");
  assert.equal(fw(["history", "add", dir], { FW_HISTORY_DIR: h }).status, 0);
  const csv = readFileSync(join(h, "posts.csv"), "utf8").trim().split("\n");
  assert.equal(csv.length, 11);
  assert.equal(readdirSync(join(h, "covers")).length, 10);
  assert.match(fw(["history", "report"], { FW_HISTORY_DIR: h }).stdout, /Not enough performance data/);
});
