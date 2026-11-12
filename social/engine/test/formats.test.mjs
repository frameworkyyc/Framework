// Panoramic carousels, motion Reels, the grid colour plan, the client-showcase pause and archived batches. No credits; temp folders only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const FW = new URL("../fw.mjs", import.meta.url).pathname;
const fw = (args, env = {}) => spawnSync(process.execPath, [FW, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
const tmp = () => mkdtempSync(join(tmpdir(), "fw-formats-"));
const post = (d, id, spec, caption = "A useful first line.\n\nOne short paragraph.") => {
  const p = join(d, "posts", id); mkdirSync(p, { recursive: true });
  writeFileSync(join(p, "spec.json"), JSON.stringify(spec));
  writeFileSync(join(p, "caption-instagram.txt"), caption); writeFileSync(join(p, "caption-facebook.txt"), caption);
  writeFileSync(join(p, "alt-text.txt"), "Slide 1: a slide.");
  return p;
};
const pngSize = (f) => { const b = readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test("a panorama is one composition cut into exact 1080x1350 slides, and text may not cross a seam", () => {
  const d = tmp();
  const p = post(d, "01-pano", { format: "panorama", panels: 3, slides: [{ template: "canvas", layout: "panorama", background: "#1F3A5F", colourReason: "test palette", layers: [
    { type: "rect", x: 300, y: 300, w: 2600, h: 600, fill: "#E8B04A" }, { type: "text", x: 96, y: 120, w: 800, text: "One idea,\nthree slides.", size: 80, color: "#FFFFFF" }] }] });
  const r = fw(["render", d]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  for (const f of ["01.png", "02.png", "03.png"]) assert.deepEqual(pngSize(join(p, "slides", f)), [1080, 1350]);
  assert.deepEqual(pngSize(join(p, "slides", "panorama.png")), [3240, 1350]);
  assert.equal(fw(["check", d]).status, 0, fw(["check", d]).stdout);
  const bad = tmp();
  post(bad, "01-pano", { format: "panorama", panels: 2, slides: [{ template: "canvas", layout: "panorama", layers: [{ type: "text", x: 900, y: 400, w: 400, text: "Across the seam", size: 60 }] }] });
  const rb = fw(["render", bad]);
  assert.equal(rb.status, 1);
  assert.match(rb.stdout, /crosses or touches the seam between slides 1 and 2/);
});

test("a motion reel renders frame by frame to a 1080x1920 MP4 with a grid cover and a storyboard", () => {
  const d = tmp();
  const p = post(d, "01-reel", { format: "reel", motion: { duration: 3, fps: 12, coverAt: 2 }, slides: [{ template: "canvas", layout: "kinetic", background: "#C84B31", colourReason: "test palette", layers: [
    { type: "text", x: 96, y: 700, w: 800, text: "Say less.", size: 140, color: "#FFFFFF", anim: [{ t: 0, opacity: 0, y: 60 }, { t: 0.8, opacity: 1, y: 0 }] }] }] });
  const r = fw(["render", d]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(join(p, "slides", "reel.mp4")) && existsSync(join(p, "storyboard.png")));
  assert.deepEqual(pngSize(join(p, "slides", "reel-cover.png")), [1080, 1920]);
  const c = fw(["check", d]);
  assert.equal(c.status, 0, c.stdout);
});

test("validation: format mix, no back-to-back formats, a colour plan, the client pause and honest fictional concepts", () => {
  const d = tmp();
  const checks = { interesting: "x", value: "x", save_share_follow: "x", credibility: "x", role: "x", different: "x" };
  const p = (id, format, extra = {}) => ({ id, slug: "p" + id, goal: "attract", visual_category: "editorial-typography", format, objective: "o", audience: "a", key_message: "k", cta_type: "none", checks,
    slides: format === "carousel" ? [{ template: "canvas", layout: "a" + id }, { template: "canvas" }, { template: "canvas" }] : [{ template: "canvas", layout: "a" + id }], cover_colour: { presence: "mono", hex: ["#0A0A0A"] }, ...extra });
  writeFileSync(join(d, "briefs.json"), JSON.stringify({ posts: [p("01", "single"), p("02", "single", { key_message: "Aurora Surveys case study" }), p("03", "reel"), p("04", "panorama")] }));
  const r = fw(["validate", d]);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /two single posts back to back/);
  assert.match(r.stdout, /client showcases are paused/);
  assert.match(r.stdout, /colour_plan .* missing/);
  assert.match(r.stdout, /a reel needs motion/);
  assert.match(r.stdout, /a panorama needs "panels"/);

  const b = tmp();
  writeFileSync(join(b, "briefs.json"), JSON.stringify({ posts: [{ id: "01", fictional: { brand: "Northwind Bakery", disclosure: "Captions call it a concept" } }] }));
  post(b, "01-concept", { format: "single", slides: [{ template: "canvas", layout: "x", layers: [{ type: "text", x: 96, y: 96, w: 800, text: "Bread, better.", size: 96 }] }] }, "We designed this for our client Northwind.\n\nA new identity.");
  assert.equal(fw(["render", b]).status, 0);
  const c = fw(["check", b]);
  assert.match(c.stdout, /fictional concept: the caption must say so/);
  assert.match(c.stdout, /presents a concept as client work/);
});

test("an archived batch stays in the history but leaves the grid preview", () => {
  const h = join(tmp(), "history"), env = { FW_HISTORY_DIR: h };
  const old = tmp(), oldName = old.split("/").pop();
  post(old, "01-old", { format: "single", slides: [{ template: "type", headline: "Old." }] });
  assert.equal(fw(["render", old]).status, 0);
  assert.equal(fw(["history", "add", old], env).status, 0);
  const a = fw(["history", "archive", old, "superseded"], env);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(readFileSync(join(h, "posts.csv"), "utf8"), /archived \d{4}-\d\d-\d\d: superseded/);
  assert.match(fw(["history", "recent", "5"], env).stdout, /ARCHIVED/);
  const now = tmp();
  post(now, "01-new", { format: "single", slides: [{ template: "type", headline: "New." }] });
  assert.equal(fw(["render", now]).status, 0);
  const g = fw(["grid", now], env);
  assert.match(readFileSync(join(now, "grid-report.md"), "utf8"), /history tiles 0/, g.stdout + oldName);
});

test("Framework's technical illustration: the iso layer draws the website's linework, and a batch must include it", () => {
  const d = tmp();
  const p = post(d, "01-iso", { format: "single", slides: [{ template: "canvas", layout: "iso-exploded", background: "#0A0A0A", layers: [
    { type: "iso", x: 0, y: 200, w: 1080, h: 1000, unit: 60, items: [{ kind: "grid", x: -1, y: -1, w: 8, d: 6 }, { kind: "plate", x: 0, y: 0, z: 0.4, w: 6, d: 4 }, { kind: "plate", x: 0, y: 0, z: 2.4, w: 6, d: 4, hl: true },
      { kind: "box", x: 6.5, y: 3, z: 1, w: 0.8, d: 0.8, h: 0.8 }, { kind: "ring", x: 3, y: 2, r: 1.2, dim: true }, { kind: "drop", x: 0, y: 0, z: 3.5 }, { kind: "line", points: [[0.5, 1, 2.52], [5, 1, 2.52]], dim: true }] },
    { type: "iso", src: "@site/assets/img/ill/website-dark.svg", x: 600, y: 900, w: 400, h: 300 },
    { type: "text", x: 96, y: 96, w: 880, text: "Three layers.", size: 88, color: "#FFFFFF" }] }] });
  const r = fw(["render", d]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const c = fw(["check", d]);
  assert.equal(c.status, 0, c.stdout); // linework is not mistaken for a logo or watermark
  const html = JSON.parse(readFileSync(join(p, "slides", "render.json"), "utf8"));
  assert.equal(html.slides[0].marks.length, 0);
  // A full batch without the style fails validation.
  const b = tmp(), checks = { interesting: "x", value: "x", save_share_follow: "x", credibility: "x", role: "x", different: "x" };
  const nine = Array.from({ length: 9 }, (_, i) => ({ id: String(i + 1).padStart(2, "0"), slug: "p" + i, goal: "attract", visual_category: "editorial-typography", format: i % 2 ? "carousel" : "single", objective: "o", audience: "a", key_message: "k", cta_type: "none", checks,
    slides: i % 2 ? [{ template: "canvas", layout: "c" + i }, { template: "canvas" }, { template: "canvas" }] : [{ template: "canvas", layout: "c" + i }], cover_colour: { presence: "mono", hex: ["#0A0A0A"] } }));
  writeFileSync(join(b, "briefs.json"), JSON.stringify({ colour_plan: { palette: [{ hex: "#0A0A0A" }, { hex: "#FFFFFF" }, { hex: "#C84B31" }] }, posts: nine }));
  assert.match(fw(["validate", b]).stdout, /no post uses Framework's technical illustration style/);
});

test("mockup realism: a design composited over a photograph fails, and every mockup needs the Director's full-size pass", () => {
  const d = tmp();
  post(d, "01-book", { format: "single", slides: [{ template: "canvas", layout: "book", mockup: "book", layers: [
    { type: "image", src: "@site/assets/img/drafting.jpg", x: 0, y: 0, w: 1080, h: 1350 },
    { type: "rect", x: 200, y: 300, w: 400, h: 600, fill: "#0A0A0A", blend: "multiply", tilt: { x: 10 } },
    { type: "text", x: 96, y: 1100, w: 800, text: "Drawn,\nthen built.", size: 80, color: "#FFFFFF" }] }] });
  assert.equal(fw(["render", d]).status, 0);
  let c = fw(["check", d]);
  assert.match(c.stdout, /mockup realism: slide 1: design laid over a photograph \(rect with blend\)/);
  assert.match(c.stdout, /\(book\) mockup realism not yet reviewed/);
  // An integrated photograph (the artwork is part of the image) with the post's own headline beside it passes once the Director signs it off.
  const ok = tmp();
  post(ok, "01-book", { format: "single", slides: [{ template: "canvas", layout: "book", mockup: "book", layers: [
    { type: "image", src: "@site/assets/img/drafting.jpg", x: 0, y: 0, w: 1080, h: 1350 },
    { type: "text", x: 96, y: 1100, w: 800, text: "Drawn,\nthen built.", size: 80, color: "#FFFFFF" }] }] });
  assert.equal(fw(["render", ok]).status, 0);
  writeFileSync(join(ok, "mockups.json"), JSON.stringify([{ post: "01", slide: 1, object: "book", verdict: "pass", note: "print follows the page curve and light" }]));
  c = fw(["check", ok]);
  assert.equal(c.status, 0, c.stdout);
});

test("aesthetic standard: off-aesthetic plans and prompts fail, and a batch needs the Director's verdict per post", () => {
  const d = tmp(), checks = { interesting: "x", value: "x", save_share_follow: "x", credibility: "x", role: "x", different: "x" };
  writeFileSync(join(d, "briefs.json"), JSON.stringify({ posts: [{ id: "01", slug: "p", goal: "attract", visual_category: "editorial-typography", format: "single", objective: "o", audience: "a", key_message: "k", cta_type: "none", checks,
    concept: "A cozy kitchen with a cheerful owner", slides: [{ template: "canvas", layout: "x", visual: { source: "higgsfield", prompt: "A bakery storefront on a quiet street with bread in the window and a sign above the door, photographed for a social media post." } }] }] }));
  const v = fw(["validate", d]);
  assert.match(v.stdout, /"cozy" is outside Framework's aesthetic/);
  assert.match(v.stdout, /prompt must direct the light/);
  // The prompt grammar's closing exclusions are negated and must not trip the check.
  const n = tmp();
  writeFileSync(join(n, "briefs.json"), JSON.stringify({ posts: [{ id: "01", concept: "A steel beam from directly above", slides: [{ visual: { source: "higgsfield", prompt: "A steel beam from directly above, hard low sun with crisp shadows, no people posing, no cozy or lifestyle staging, no stock-photo look, without a bright and airy feel." } }] }] }));
  assert.doesNotMatch(fw(["validate", n]).stdout, /outside Framework's aesthetic|direct the light/);
  const b = tmp();
  for (let i = 1; i <= 9; i++) post(b, `0${i}-p`, { format: "single", slides: [{ template: "type", headline: `Post ${i}.` }] });
  assert.equal(fw(["render", b]).status, 0);
  writeFileSync(join(b, "posts", "01-p", "assets.json"), JSON.stringify([{ slide: 1, prompt: "bright and airy suburban kitchen" }]));
  let c = fw(["check", b]);
  assert.match(c.stdout, /09-p: aesthetic standard not yet judged/);
  assert.match(c.stdout, /asks for "bright and airy"/);
  writeFileSync(join(b, "aesthetic.json"), JSON.stringify(Array.from({ length: 9 }, (_, i) => ({ post: `0${i + 1}`, verdict: "pass" }))));
  c = fw(["check", b]);
  assert.doesNotMatch(c.stdout, /aesthetic standard/);
});

test("a motion reel's word count is the busiest moment, not the whole timeline", () => {
  const d = tmp();
  const scene = (i) => ({ type: "text", font: "body", x: 96, y: 400 + i * 10, w: 800, size: 34, color: "#FFFFFF", text: "One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.",
    anim: [{ t: i * 2, opacity: 0 }, { t: i * 2 + 0.3, opacity: 1 }, { t: i * 2 + 1.7, opacity: 1 }, { t: i * 2 + 2, opacity: 0 }] });
  post(d, "01-reel", { format: "reel", motion: { duration: 6, fps: 6, coverAt: 1 }, slides: [{ template: "canvas", layout: "kinetic", background: "#0A0A0A", layers: [scene(0), scene(1), scene(2)] }] });
  assert.equal(fw(["render", d]).status, 0);
  assert.doesNotMatch(fw(["check", d]).stdout, /words on one slide/); // 60 words in total, never more than 20 at once
});
