// Branding rule (owner, 2026-11-11): no automatic logo, wordmark, URL or branded footer on any slide. Branding appears only as an
// intentional creative element (spec brand with a reason), large and inside the composition. No credits; temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FW = new URL("../fw.mjs", import.meta.url).pathname;
const FAMILIES = new URL("../../examples/layout-families/", import.meta.url).pathname;
const fw = (...args) => spawnSync(process.execPath, [FW, ...args], { encoding: "utf8" });
const captions = (post) => {
  writeFileSync(join(post, "caption-instagram.txt"), "A useful first line.\n\nOne short paragraph.");
  writeFileSync(join(post, "caption-facebook.txt"), "A useful first line. One short paragraph.");
  writeFileSync(join(post, "alt-text.txt"), "Slide 1: a slide.");
};
const single = (dir, slide) => {
  const post = join(dir, "posts", "01-test");
  cpSync(join(FAMILIES, "posts", "04-minimal"), post, { recursive: true });
  writeFileSync(join(post, "spec.json"), JSON.stringify({ id: "01", slug: "test", format: "single", slides: [slide] }));
  return post;
};

test("no template stamps a logo, wordmark or URL by default", () => {
  const dir = mkdtempSync(join(tmpdir(), "fw-brand-")); cpSync(FAMILIES, dir, { recursive: true });
  const r = fw("render", dir);
  assert.equal(r.status, 0, r.stdout);
  for (const p of ["01-giant", "03-showcase", "06-caption", "07-split", "08-top"]) {
    const audit = JSON.parse(readFileSync(join(dir, "posts", p, "slides", "render.json"), "utf8"));
    for (const s of audit.slides) {
      assert.deepEqual(s.brand, [], `${p}: brand element`);
      assert.deepEqual(s.marks, [], `${p}: logo graphic`);
      assert.ok(!s.names.some((n) => /frameworkco\.ca|^framework$/i.test(n.text)), `${p}: name or URL stamped: ${JSON.stringify(s.names)}`);
    }
  }
});

test("a retired footer and a brand without a reason are refused", () => {
  const a = mkdtempSync(join(tmpdir(), "fw-brand-"));
  single(a, { template: "minimal", headline: "A line.", footer: "frameworkco.ca" });
  assert.match(fw("render", a).stdout, /"footer" no longer exists/);
  const b = mkdtempSync(join(tmpdir(), "fw-brand-"));
  single(b, { template: "statement", headline: "A line.", brand: { element: "mark" } });
  assert.match(fw("render", b).stdout, /brand needs a "reason"/);
});

test("an intentional brand element renders large and passes QC", () => {
  const d = mkdtempSync(join(tmpdir(), "fw-brand-"));
  const post = single(d, { template: "statement", theme: "ink", headline: "The mark,\nexplained.", brand: { element: "mark", size: 240, reason: "A post about the construction of Framework's own monogram" } });
  assert.equal(fw("render", d).status, 0);
  const audit = JSON.parse(readFileSync(join(post, "slides", "render.json"), "utf8"));
  assert.equal(audit.slides[0].brand.length, 1);
  assert.ok(audit.slides[0].brand[0].w >= 160);
  captions(post);
  const r = fw("check", d);
  assert.equal(r.status, 0, r.stdout);
});

test("QC fails a small corner mark (watermark) and a URL along the bottom edge", () => {
  const d = mkdtempSync(join(tmpdir(), "fw-brand-"));
  const post = single(d, { template: "minimal", headline: "A line." });
  fw("render", d); captions(post);
  const rp = join(post, "slides", "render.json"), audit = JSON.parse(readFileSync(rp, "utf8"));
  audit.slides[0].brand = [{ kind: "mark", x: 88, y: 1250, w: 40, h: 40 }];
  audit.slides[0].names = [{ text: "frameworkco.ca", x: 800, y: 1280, w: 190, h: 22 }];
  writeFileSync(rp, JSON.stringify(audit));
  const r = fw("check", d);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /too small to be a deliberate brand moment/);
  assert.match(r.stdout, /branded footer or URL watermark/);
});
