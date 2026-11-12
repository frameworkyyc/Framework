// Canvas compositions, furniture defaults and creative checks. No credits; temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FW = new URL("../fw.mjs", import.meta.url).pathname;
const fw = (...args) => spawnSync(process.execPath, [FW, ...args], { encoding: "utf8" });
const post = (slides, format = "carousel") => {
  const d = mkdtempSync(join(tmpdir(), "fw-canvas-")), p = join(d, "posts", "01-test");
  mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "spec.json"), JSON.stringify({ id: "01", slug: "test", format, slides }));
  writeFileSync(join(p, "caption-instagram.txt"), "A useful first line.\n\nOne short paragraph.");
  writeFileSync(join(p, "caption-facebook.txt"), "A useful first line. One short paragraph.");
  writeFileSync(join(p, "alt-text.txt"), "Slide 1: a slide.");
  return { d, p };
};

test("canvas renders full-bleed images, real device mockups, swatches and free type without failures", () => {
  const { d, p } = post([
    { template: "canvas", layout: "device-pair", background: "#0F2D3D", clientColour: "client palette (test)", layers: [
      { type: "image", src: "@site/assets/img/drafting.jpg", x: 0, y: 0, w: 1080, h: 1350, treatment: "mono" },
      { type: "laptop", src: "@site/assets/img/arch-courtyard.jpg", x: -60, y: 300, w: 1000 },
      { type: "phone", src: "@site/assets/img/steel-erection.jpg", x: 700, y: 520, w: 300 },
      { type: "text", text: "Every project,\nplotted.", x: 88, y: 110, w: 900, size: 72, color: "#FFFFFF" } ] },
    { template: "canvas", layout: "colour-system", clientColour: "client palette (test)", layers: [
      { type: "swatch", x: 0, y: 0, w: 1080, h: 675, color: "#8A2E2A", name: "Oxide Red" },
      { type: "swatch", x: 0, y: 675, w: 1080, h: 675, color: "#F5F1EA", name: "Bone" } ] },
    { template: "canvas", layout: "statement", theme: "ink", layers: [{ type: "text", text: "Drawn,\nthen built.", x: 88, y: 500, w: 900, size: 160, color: "#FFFFFF" }] },
  ]);
  const r = fw("render", d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fw("check", d).status, 0);
});

test("no automatic furniture: no slide counter or header rule unless asked", () => {
  const { d, p } = post([{ template: "point", headline: "One idea.", body: "Why it matters." }, { template: "point", headline: "Two.", body: "B." }, { template: "cta", headline: "Next." }]);
  assert.equal(fw("render", d).status, 0);
  const audit = JSON.parse(readFileSync(join(p, "slides", "render.json"), "utf8"));
  assert.ok(!audit.slides.some((s) => (s.names || []).some((n) => /\d+\s*\/\s*\d+/.test(n.text))));
});

test("plain language: specialist terms and walls of text fail; client colour needs a reason; text may not run off the canvas", () => {
  const { d } = post([
    { template: "statement", headline: "Hit 2.5 s LCP\nat the 75th percentile." },
    { template: "statement", headline: "Words.", support: "word ".repeat(50) },
    { template: "canvas", layout: "x", background: "#8A2E2A", layers: [{ type: "text", text: "Red.", x: 88, y: 88, w: 400, size: 60 }] },
  ]);
  fw("render", d);
  const r = fw("check", d);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /specialist term "LCP"/);
  assert.match(r.stdout, /percentile/);
  assert.match(r.stdout, /words on one slide/);
  assert.match(r.stdout, /in neither Framework.s palette nor the batch colour_plan/);
  const off = post([{ template: "canvas", layout: "x", layers: [{ type: "text", text: "Off the edge", x: 900, y: 88, w: 600, size: 80 }] }], "single");
  assert.match(fw("render", off.d).stdout, /text runs off the canvas/);
});

test("a rotated headline is measured by its own lines, not its rotated box", () => {
  const { d } = post([{ template: "canvas", layout: "rotated", layers: [{ type: "text", text: "Pick one colour.\nUse it everywhere.", x: 140, y: 500, w: 820, size: 72, rotate: -22 }] }], "single");
  const r = fw("render", d);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a canvas with background transparent leaves the whole slide clear, so a motion reel's video shows through", async () => {
  const { slideHtml } = await import("../templates.mjs");
  const ctx = { w: 1080, h: 1920, fontsCss: "/tmp/f.css", slideCss: "/tmp/s.css", postDir: "/tmp" };
  const clear = slideHtml({ template: "canvas", theme: "paper", background: "transparent", layers: [] }, ctx);
  assert.match(clear, /class="slide paper\s+reel"/, "the slide wrapper must not paint the theme background behind a transparent canvas");
  const solid = slideHtml({ template: "canvas", theme: "paper", background: "#D2552A", layers: [] }, ctx);
  assert.doesNotMatch(solid, /class="[^"]*\breel\b/);
});
