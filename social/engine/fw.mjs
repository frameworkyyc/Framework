#!/usr/bin/env node
// Framework social engine: deterministic typography, layout, export and checks. No AI calls and no credits are spent here.
//   node social/engine/fw.mjs fonts                      fetch Switzer + General Sans from Fontshare into a local cache (once per machine)
//   node social/engine/fw.mjs validate <batch>           check briefs.json (the strategist's handoff)
//   node social/engine/fw.mjs render <post-dir|batch>    spec.json -> slides/NN.png (1080x1350 default); panoramas -> one composition cut into slides;
//                                                        reels with "motion" -> frame-by-frame slides/reel.mp4 + reel-cover.png + storyboard.png
//   node social/engine/fw.mjs reel <post-dir>            clip + reel overlay -> slides/reel.mp4 + slides/reel-cover.png (ffmpeg)
//   node social/engine/fw.mjs sheet <batch>              one contact-sheet PNG of every slide, for review at low token cost
//   node social/engine/fw.mjs check <batch>              completeness, dimensions, caption and brand-voice lint
//   node social/engine/fw.mjs grid <batch>               Instagram profile preview (3:4 grid crops, newest first, after published history) + feed checks
//   node social/engine/fw.mjs package <batch>            export/ folder + zip of finished posts with captions alongside
//   node social/engine/fw.mjs capture <url> <out.jpg> [desktop|mobile] [full]   authentic client-site screenshot at 2x/3x for mockups
//   node social/engine/fw.mjs history add <batch> | archive <batch> [why] | recent [n] | report    content history (social/history/posts.csv) and performance summary
//   node social/engine/fw.mjs figma manifest|upload|layout <batch> [urls]  push finished slides to the Figma feed board (see SKILL.md)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { slideHtml, resolveAsset, TEMPLATES, REPO_ROOT, CATEGORIES, familyOf, categoryOf, isImagery } from "./templates.mjs";

const ENGINE = dirname(new URL(import.meta.url).pathname);
const FONT_DIR = join(ENGINE, ".fonts");
const FONTS_CSS = join(FONT_DIR, "fonts.css");
const SLIDE_CSS = join(ENGINE, "slide.css");
const FONTSHARE = "https://api.fontshare.com/v2/css?f[]=switzer@600,700&f[]=general-sans@400,500,600&display=block";
const require = createRequire(import.meta.url);

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const die = (msg) => { console.error("ERROR " + msg); process.exit(1); };
const sizeOf = (spec) => { const [w, h] = (spec.size || (spec.format === "reel" ? "1080x1920" : "1080x1350")).split("x").map(Number); return { w, h }; };
const postDirs = (batch) => { const p = join(batch, "posts"); return existsSync(p) ? readdirSync(p).filter((d) => statSync(join(p, d)).isDirectory()).sort().map((d) => join(p, d)) : []; };
const pngSize = (file) => { const b = readFileSync(file); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; };

// ---------- fonts ----------
async function fonts({ force = false } = {}) {
  if (existsSync(FONTS_CSS) && !force) return FONTS_CSS;
  mkdirSync(FONT_DIR, { recursive: true });
  // curl, not fetch: curl honours HTTPS_PROXY everywhere (cloud sessions route outbound traffic through a proxy).
  const get = (url) => execFileSync("curl", ["-fsSL", "--max-time", "60", url], { maxBuffer: 1 << 26 });
  const css = get(FONTSHARE).toString();
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map((m) => m[1]);
  if (faces.length < 5) die("Fontshare returned no fonts. Is api.fontshare.com / cdn.fontshare.com allowed by the network policy?");
  let out = "";
  for (const f of faces) {
    const family = /font-family:\s*'([^']+)'/.exec(f)[1], weight = /font-weight:\s*(\d+)/.exec(f)[1];
    const url = "https:" + /url\('([^']+\.woff2)'\)/.exec(f)[1];
    const file = `${family.replace(/\s+/g, "")}-${weight}.woff2`;
    writeFileSync(join(FONT_DIR, file), get(url));
    out += `@font-face{font-family:"${family}";src:url("./${file}") format("woff2");font-weight:${weight};font-style:normal;font-display:block}\n`;
  }
  writeFileSync(FONTS_CSS, out);
  console.log(`fonts: cached ${faces.length} faces in ${FONT_DIR}`);
  return FONTS_CSS;
}

// ---------- render ----------
const FIT_SCRIPT = async () => {
  // Load every brand face before measuring: text metrics (and so the fit) depend on them.
  const faces = ['700 100px "Switzer"', '600 100px "Switzer"', '400 30px "General Sans"', '500 30px "General Sans"', '600 30px "General Sans"'];
  await Promise.all(faces.map((f) => document.fonts.load(f)));
  // Device screens: a capture wider than the screen opening fills the width and scrolls vertically (never cropped at the sides).
  for (const img of document.querySelectorAll(".device .screen img")) {
    const sc = img.parentElement.getBoundingClientRect(), ratio = img.naturalWidth / img.naturalHeight;
    if (ratio > sc.width / sc.height) {
      const h = sc.width / ratio, scroll = Number(img.dataset.scroll || 0);
      Object.assign(img.style, { position: "absolute", left: "0", width: "100%", height: h + "px", objectFit: "fill", top: (h > sc.height ? -scroll * (h - sc.height) : 0) + "px" });
    }
  }
  const out = { warnings: [], errors: [] };
  const boxes = [...document.querySelectorAll("[data-fit-box]")], box = boxes[0];
  const fits = [...document.querySelectorAll("[data-fit]")];
  const base = fits.map((e) => parseFloat(getComputedStyle(e).fontSize));
  const maxH = box && box.dataset.maxH ? Number(box.dataset.maxH) : null;
  const heads = [...document.querySelectorAll(".h1,.h2,.ct-head")];
  const lineCount = (h) => Math.round(h.offsetHeight / parseFloat(getComputedStyle(h).lineHeight)); // layout height: a rotated or tilted headline is not counted as extra lines
  const wraps = () => heads.some((h) => lineCount(h) > h.textContent.split("\n").length); // a headline breaking where the writer did not intend
  const over = () => (boxes.slice(1).some((b) => b.scrollHeight > b.clientHeight + 1)) || !!box && ((maxH ? box.offsetHeight > maxH : box.scrollHeight > box.clientHeight + 1) || fits.some((e) => e.scrollWidth > e.clientWidth + 1) || wraps());
  let scale = 1;
  while (over() && scale > 0.72) { scale = +(scale - 0.03).toFixed(2); fits.forEach((e, i) => (e.style.fontSize = base[i] * scale + "px")); }
  out.scale = scale;
  if (over()) out.errors.push("text does not fit even at 72% size: shorten the copy or split the slide");
  else if (scale < 1) out.warnings.push(`text auto-scaled to ${Math.round(scale * 100)}% to fit`);
  for (const h of heads) {
    const lines = lineCount(h), manual = h.textContent.split("\n").length;
    if (lines > manual) out.errors.push(`headline wraps to ${lines} lines but has ${manual} written line(s): shorten the lines or break them deliberately`);
    if (lines > 5) out.errors.push(`headline is ${lines} lines: brand allows 2-4 (5 at most on a cover)`);
  }
  for (const img of document.images) {
    if (!img.complete || img.naturalWidth === 0) { out.errors.push("image failed to load: " + decodeURIComponent(img.src)); continue; }
    const r = img.getBoundingClientRect();
    const need = Math.max(r.width, getComputedStyle(img).objectFit === "cover" ? r.height * (img.naturalWidth / img.naturalHeight) : 0);
    if (img.naturalWidth < need * 0.8) out.warnings.push(`low-resolution image: ${img.naturalWidth}px wide shown at ~${Math.round(need)}px (${decodeURIComponent(img.src).split("/").pop()})`);
  }
  if (!faces.every((f) => document.fonts.check(f))) out.errors.push("brand fonts did not load");
  // Legibility on a phone: a 1080px slide shows at about a third of its size, so slide text under 24px is too small to read.
  const small = new Set();
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = tw.nextNode()); ) {
    const el = n.parentElement;
    if (!n.textContent.trim() || el.closest(".browser .bar, .src-note, [data-brand]")) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 24 && el.getBoundingClientRect().width > 0) small.add(`${Math.round(fs)}px "${n.textContent.trim().slice(0, 30)}"`);
  }
  if (small.size) out.warnings.push(`text under 24px is hard to read on a phone: ${[...small].slice(0, 4).join("; ")}`);
  for (const t of document.querySelectorAll(".layer.ct:not([data-bleed])")) {
    const r = t.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.errors.push(`text runs off the canvas: "${t.textContent.trim().slice(0, 40)}" (set bleed: true if intended)`);
  }
  // Panoramic carousels: one composition split into slides. Text must sit wholly inside one slide, clear of every seam.
  const panel = Number(document.body.dataset.panel || 0);
  const inked = (t) => { const g = document.createRange(); g.selectNodeContents(t); return g.getBoundingClientRect(); }; // the text itself, not its box
  if (panel) for (const t of document.querySelectorAll(".layer.ct")) {
    const r = inked(t);
    for (let x = panel; x < innerWidth; x += panel) if (r.left < x + 64 && r.right > x - 64) out.errors.push(`text crosses or touches the seam between slides ${x / panel} and ${x / panel + 1}: "${t.textContent.trim().slice(0, 40)}" (keep 64px clear)`);
  }
  // Reels (9:16): Instagram's buttons and caption cover the bottom and right edge, and the profile grid shows only the middle 3:4 of the cover.
  if (innerHeight === 1920) for (const t of document.querySelectorAll(".layer.ct")) {
    const r = inked(t), txt = t.textContent.trim().slice(0, 40);
    if (r.bottom > 1600 || r.top < 120 || r.right > 960) out.warnings.push(`reel text outside the safe area (Instagram's buttons and caption cover the bottom and right): "${txt}"`);
  }
  // Branding audit for fw check: every brand element and every piece of text naming Framework or its URL, with its position.
  const rect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  out.brand = [...document.querySelectorAll("[data-brand]")].map((e) => ({ kind: e.dataset.brand, ...rect(e.getBoundingClientRect()) }));
  out.marks = [...document.querySelectorAll("svg")].filter((e) => !e.closest("[data-brand], [data-ill]")).map((e) => ({ kind: "svg", ...rect(e.getBoundingClientRect()) }));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  out.names = [];
  for (let n; (n = walker.nextNode()); ) {
    const t = n.textContent;
    if (!/frameworkco\.ca|\bframework\b/i.test(t) || n.parentElement.closest("[data-brand], .btn")) continue; // a CTA button naming the site is content, not a watermark
    const r = document.createRange(); r.selectNodeContents(n);
    out.names.push({ text: t.trim().slice(0, 60), ...rect(r.getBoundingClientRect()) });
  }
  return out;
};

async function withBrowser(fn) {
  const { chromium } = require("playwright");
  const browser = await chromium.launch();
  try { return await fn(browser); } finally { await browser.close(); }
}

// Motion: turn every [data-anim] layer's keyframes ([{t, opacity, x, y, scale, rotate, blur, clip, ease}]) into paused Web Animations,
// so each video frame is an exact, repeatable render at a given time (no real-time playback, no dropped frames).
const MOTION_SCRIPT = (duration) => {
  const REST = { opacity: 1, x: 0, y: 0, scale: 1, rotate: 0, blur: 0, clip: "inset(0% 0% 0% 0%)" };
  window.__fwAnims = [];
  for (const el of document.querySelectorAll("[data-anim]")) {
    const steps = JSON.parse(el.dataset.anim).map((k) => ({ ...k, t: Math.min(Math.max(Number(k.t) || 0, 0), duration) })).sort((p, q) => p.t - q.t);
    const props = Object.keys(REST).filter((k) => steps.some((st) => st[k] != null));
    const at = (i, k) => { for (let j = i; j >= 0; j--) if (steps[j][k] != null) return steps[j][k]; for (let j = i; j < steps.length; j++) if (steps[j][k] != null) return steps[j][k]; return REST[k]; };
    const full = steps.map((st, i) => Object.fromEntries([["t", st.t], ["ease", st.ease], ...Object.keys(REST).map((k) => [k, props.includes(k) ? at(i, k) : REST[k]])]));
    if (full[0].t > 0) full.unshift({ ...full[0], t: 0 });
    if (full.at(-1).t < duration) full.push({ ...full.at(-1), t: duration, ease: undefined });
    // Display type is set with tight leading, so its box is shorter than its glyphs: a reveal mask on text gets 0.3em of room above
    // and below (except a side that is fully closed), so descenders and accents are never cut off.
    const isText = el.classList.contains("ct");
    const padClip = (c) => {
      const m = /^inset\(([^)]*)\)$/.exec(String(c).trim()); if (!m) return c;
      const [t, r = t, b = t, l = r] = m[1].trim().split(/\s+/), pct = (x) => (/^-?[\d.]+%$/.test(x) ? parseFloat(x) : 0);
      // A closed mask (top + bottom, or left + right, reach 100%) must hide everything, overhang included: never pad it.
      if (pct(t) + pct(b) >= 100 || pct(l) + pct(r) >= 100) return `inset(${t} ${r} ${b} ${l})`;
      return `inset(calc(${t} - 0.3em) ${r} calc(${b} - 0.3em) ${l})`;
    };
    const frames = full.map((v) => {
      const f = { offset: v.t / duration, easing: v.ease || "cubic-bezier(.2,.7,.1,1)" }, has = (k) => props.includes(k);
      if (has("opacity")) f.opacity = v.opacity;
      if (has("x") || has("y")) f.translate = `${v.x}px ${v.y}px`;
      if (has("scale")) f.scale = String(v.scale);
      if (has("rotate")) f.rotate = `${v.rotate}deg`;
      if (has("blur")) f.filter = `blur(${v.blur}px)`;
      if (has("clip")) f.clipPath = isText ? padClip(v.clip) : v.clip;
      return f;
    });
    const anim = el.animate(frames, { duration: duration * 1000, fill: "both" });
    anim.pause(); window.__fwAnims.push(anim);
  }
  window.__fwSeek = (t) => { for (const a of window.__fwAnims) a.currentTime = t * 1000; };
  return window.__fwAnims.length;
};

// ---------- video QC (every motion reel, every frame) ----------
// In the page, per frame: every text layer's opacity and the part of its ink that its reveal mask leaves visible.
const VIDEO_PROBE = () => {
  const px = (v, size) => { let sum = 0; String(v).replace(/([+-]?)\s*(\d*\.?\d+)(%|px)/g, (m, sign, n, u) => { const x = (u === "%" ? (Number(n) * size) / 100 : Number(n)) * (sign === "-" ? -1 : 1); sum += x; return m; }); return sum; };
  return [...document.querySelectorAll(".layer.ct")].map((el) => {
    const cs = getComputedStyle(el), op = Number(cs.opacity), box = el.getBoundingClientRect(), g = document.createRange(); g.selectNodeContents(el);
    const ink = g.getBoundingClientRect(); let vis = { l: ink.left, t: ink.top, r: ink.right, b: ink.bottom };
    const m = /^inset\((.*)\)$/.exec(cs.clipPath || "");
    if (m) {
      const parts = m[1].match(/calc\([^)]*\)|[^\s]+/g) || [], [t, r = t, b = t, l = r] = parts, H = el.offsetHeight || box.height, W = el.offsetWidth || box.width;
      vis = { l: Math.max(vis.l, box.left + px(l, W)), t: Math.max(vis.t, box.top + px(t, H)), r: Math.min(vis.r, box.right - px(r, W)), b: Math.min(vis.b, box.bottom - px(b, H)) };
    }
    const vw = vis.r - vis.l, vh = vis.b - vis.t, area = vw >= 1 && vh >= 1 ? vw * vh : 0; // under a pixel is closed (rounding), and is then pixel-tested
    const inkArea = Math.max(1, (ink.right - ink.left) * (ink.bottom - ink.top));
    return { i: Number(el.closest("[data-li]")?.dataset.li ?? -1), text: el.textContent.trim().slice(0, 28), op, area, frac: area / inkArea, vis, ink: { l: ink.left, t: ink.top, r: ink.right, b: ink.bottom }, overlapOk: !!el.closest("[data-overlap]"), partialOk: !!el.closest("[data-partial]") };
  });
};
// On the rendered frames: hard cuts, single-frame flicker and blank frames.
const FRAME_QC_PY = [
  "import sys,json,os", "import numpy as np", "from PIL import Image",
  "d=sys.argv[1]; fs=sorted(f for f in os.listdir(d) if f.endswith('.png'))",
  "A=[np.asarray(Image.open(os.path.join(d,f)).convert('L').resize((270,480)),dtype=np.int16) for f in fs]",
  "B=[np.asarray(Image.open(os.path.join(d,f)).convert('L').resize((54,96),Image.BOX),dtype=np.int16) for f in fs]",
  "diff=[0.0]+[float(np.abs(A[i]-A[i-1]).mean()) for i in range(1,len(A))]",
  "blip=[0]*len(A)",
  "# flicker: a 20 px block that jumps and jumps back within one frame, with no similar content within 40 px in the frames",
  "# either side (moving content always has a neighbour there; a real flicker does not)",
  "def nb(x,f):",
  "  out=x.copy()",
  "  for dy in (-2,-1,0,1,2):",
  "    for dx in (-2,-1,0,1,2): out=f(out,np.roll(np.roll(x,dy,0),dx,1))",
  "  return out",
  "for i in range(1,len(B)-1):",
  "  a,b,c=B[i-1],B[i],B[i+1]; m=(np.abs(b-a)>25)&(np.abs(c-b)>25)&(np.abs(c-a)<8)",
  "  if not m.any(): continue",
  "  dark=(b<a)&(np.minimum(nb(a,np.minimum),nb(c,np.minimum))>b+12); light=(b>a)&(np.maximum(nb(a,np.maximum),nb(c,np.maximum))<b-12)",
  "  blip[i]=int((m&(dark|light)).sum())",
  "std=[float(x.std()) for x in A]",
  "print(json.dumps({'n':len(A),'diff':diff,'blip':blip,'std':std}))"].join("\n");

async function renderPost(browser, postDir) {
  const specPath = join(postDir, "spec.json");
  if (!existsSync(specPath)) throw new Error(`${postDir}: no spec.json`);
  const spec = readJson(specPath);
  const { w, h } = sizeOf(spec);
  const panels = spec.format === "panorama" ? Number(spec.panels) : 0, motion = spec.format === "reel" && spec.motion ? spec.motion : null;
  if (spec.format === "panorama" && !(panels >= 2 && panels <= 10)) throw new Error(`${postDir}: a panorama needs "panels" (2-10)`);
  const slides = (spec.slides || []).filter((s) => spec.format === "reel" || s.template !== "reel");
  if (!slides.length) throw new Error(`${postDir}: spec has no slides`);
  if ((panels || motion) && (slides.length !== 1 || slides[0].template !== "canvas")) throw new Error(`${postDir}: a ${panels ? "panorama" : "motion reel"} is one "canvas" slide (the whole composition)`);
  const outDir = join(postDir, "slides"), build = join(postDir, ".build");
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); rmSync(build, { recursive: true, force: true }); mkdirSync(build, { recursive: true });
  const cw = panels ? w * panels : w;
  const page = await browser.newPage({ viewport: { width: cw, height: h }, deviceScaleFactor: 1 });
  const report = [];
  for (const [i, s] of slides.entries()) {
    if (!TEMPLATES.includes(s.template)) throw new Error(`${postDir} slide ${i + 1}: unknown template "${s.template}"`);
    if ("footer" in s) throw new Error(`${postDir} slide ${i + 1}: "footer" no longer exists (no branded footers); put a citation in "source"`);
    if (s.image && !existsSync(resolveAsset(s.image, postDir))) throw new Error(`${postDir} slide ${i + 1}: image not found: ${s.image}`);
    const n = i + 1, total = slides.length;
    const fontFaces = (spec.fonts || []).map((f) => `@font-face{font-family:"${f.family}";src:url("${pathToFileURL(resolveAsset(f.src, postDir)).href}");font-weight:${f.weight || 400}}`).join("");
    const ctx = { fontFaces, n, total, isLast: n === total || spec.format !== "carousel", counter: "", w: cw, h, panel: panels ? w : 0, postDir: resolve(postDir), fontsCss: FONTS_CSS, slideCss: SLIDE_CSS };
    const html = join(build, `slide-${String(n).padStart(2, "0")}.html`);
    writeFileSync(html, slideHtml(s, ctx));
    await page.goto("file://" + html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(FIT_SCRIPT);
    if (panels) {
      // One composition, cut into slides: every slide is an exact crop, so neighbours line up to the pixel.
      await page.screenshot({ path: join(outDir, "panorama.png"), clip: { x: 0, y: 0, width: cw, height: h } });
      for (let k = 0; k < panels; k++) {
        const name = `${String(k + 1).padStart(2, "0")}.png`, inPanel = (b) => b.x + b.w / 2 >= k * w && b.x + b.w / 2 < (k + 1) * w, shift = (b) => ({ ...b, x: b.x - k * w });
        await page.screenshot({ path: join(outDir, name), clip: { x: k * w, y: 0, width: w, height: h } });
        report.push({ slide: k + 1, file: name, errors: k ? [] : r.errors, warnings: k ? [] : r.warnings, brand: r.brand.filter(inPanel).map(shift), marks: r.marks.filter(inPanel).map(shift), names: r.names.filter(inPanel).map(shift) });
      }
      continue;
    }
    if (motion) {
      const fps = Number(motion.fps || 30), dur = Number(motion.duration);
      if (!(dur >= 3 && dur <= 90)) throw new Error(`${postDir}: motion.duration must be 3-90 seconds`);
      await page.evaluate(MOTION_SCRIPT, dur);
      const frames = join(build, "frames"); mkdirSync(frames);
      const total = Math.round(dur * fps), transparent = !!spec.video;
      const qc = { errors: [], warnings: [], overlaps: [], leaks: [], slivers: [] }, at = (f) => `${(f / fps).toFixed(2)}s`, sliverRun = new Map();
      for (let f = 0; f < total; f++) {
        await page.evaluate((t) => window.__fwSeek(t), f / fps);
        await page.screenshot({ path: join(frames, `f${String(f).padStart(5, "0")}.png`), omitBackground: transparent });
        const layers = await page.evaluate(VIDEO_PROBE);
        if (process.env.FW_QC_DEBUG) (qc.debug ||= []).push({ f, layers });
        // Ghosting: two different text layers visibly on top of each other (a cross-fade or a slide that lands on another line).
        const shown = layers.filter((x) => x.op > 0.06 && x.area > 0); // even a faint ghost over solid text reads as garbled
        for (let a = 0; a < shown.length; a++) for (let b = a + 1; b < shown.length; b++) {
          const A = shown[a], B = shown[b]; if (A.overlapOk || B.overlapOk) continue;
          const ix = Math.max(0, Math.min(A.vis.r, B.vis.r) - Math.max(A.vis.l, B.vis.l)) * Math.max(0, Math.min(A.vis.b, B.vis.b) - Math.max(A.vis.t, B.vis.t));
          if (ix > 0.1 * Math.min(A.area, B.area)) qc.overlaps.push({ f, a: A.text, b: B.text });
        }
        // Stray fragments: text whose mask rests on a small part of it for longer than a transition shows loose pieces
        // (descenders, a full stop). Reveals and exits pass through this state for a few frames only. partial: true allows a deliberate crop.
        for (const x of layers) {
          const sliver = !x.partialOk && x.op > 0.05 && x.area > 0 && x.frac < 0.25, run = sliver ? (sliverRun.get(x.i) || 0) + 1 : 0;
          sliverRun.set(x.i, run);
          if (run > Math.round(fps * 0.3)) qc.slivers.push({ f, text: x.text });
        }
        // Mask leaks: a layer its mask should hide completely must not paint a single pixel (descenders, accents, overhang).
        if (f % 6 === 0) for (const x of layers.filter((y) => y.op > 0.02 && y.area === 0)) {
          const pad = 40, clip = { x: Math.max(0, x.ink.l - pad), y: Math.max(0, x.ink.t - pad) }; clip.width = Math.min(w, x.ink.r + pad) - clip.x; clip.height = Math.min(h, x.ink.b + pad) - clip.y;
          if (clip.width < 2 || clip.height < 2) continue;
          const shot = () => page.screenshot({ clip, omitBackground: transparent });
          const withIt = await shot();
          await page.evaluate((i) => (document.querySelector(`[data-li="${i}"]`).style.visibility = "hidden"), x.i);
          const without = await shot();
          await page.evaluate((i) => (document.querySelector(`[data-li="${i}"]`).style.visibility = ""), x.i);
          if (!withIt.equals(without)) qc.leaks.push({ f, text: x.text });
        }
      }
      const once = (list, key) => { const seen = new Map(); for (const e of list) { const k = key(e); if (!seen.has(k)) seen.set(k, { ...e, from: e.f, to: e.f }); else seen.get(k).to = e.f; } return [...seen.values()]; };
      for (const o of once(qc.overlaps, (e) => `${e.a}|${e.b}`)) qc.errors.push(`text overlap ${at(o.from)}-${at(o.to)}: "${o.a}" and "${o.b}" are visible on top of each other (ghosting); sequence the transition or set overlap: true if intended`);
      for (const k of once(qc.slivers, (e) => e.text)) qc.errors.push(`stray fragment ${at(k.from)}-${at(k.to)}: only a small part of "${k.text}" stays visible (a mask left almost closed shows descenders or punctuation; partial: true if it is a deliberate crop)`);
      for (const k of once(qc.leaks, (e) => e.text)) qc.errors.push(`hidden text still paints ${at(k.from)}-${at(k.to)}: "${k.text}" is masked but pixels of it show (stray fragments)`);
      const fq = JSON.parse(execFileSync("python3", ["-I", "-c", FRAME_QC_PY, frames], { maxBuffer: 1 << 26 }).toString());
      if (fq.n !== total) qc.errors.push(`${fq.n} frames rendered, expected ${total}`);
      fq.blip.forEach((n, f) => { if (n >= 4) qc.errors.push(`single-frame flicker at ${at(f)}: ${n} areas change for one frame and change back`); });
      fq.diff.forEach((d, f) => { if (d > 14 && !(motion.cuts || []).some((t) => Math.abs(t - f / fps) < 1.5 / fps)) qc.warnings.push(`hard cut at ${at(f)} (mean change ${d.toFixed(1)}): ease the transition or list the time in motion.cuts`); });
      fq.std.forEach((sd, f) => { if (sd < 1.5 && f > 0 && f < fq.n - 1 && fq.std[f - 1] > 8 && fq.std[f + 1] > 8) qc.errors.push(`dropped frame at ${at(f)}: one blank frame between two full ones`); });
      const mp4 = join(outDir, "reel.mp4"), seq = join(frames, "f%05d.png"), enc = ["-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an"];
      if (spec.video) {
        const clip = resolveAsset(spec.video, postDir);
        if (!existsSync(clip)) throw new Error(`${postDir}: clip not found: ${spec.video}`);
        const mono = spec.videoTreatment === "mono" ? ",hue=s=0" : "";
        execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-stream_loop", "-1", "-i", clip, "-framerate", String(fps), "-i", seq, "-filter_complex", `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=${fps}${mono},setpts=PTS-STARTPTS[v];[v][1:v]overlay=0:0:shortest=1,format=yuv420p`, "-t", String(dur), ...enc, mp4]);
      } else execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(fps), "-i", seq, ...enc, mp4]);
      const coverAt = Math.min(Number(motion.coverAt ?? dur / 2), dur - 1 / fps);
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(coverAt), "-i", mp4, "-frames:v", "1", join(outDir, "reel-cover.png")]);
      // Storyboard for review: six evenly spaced frames in one strip (contact sheet, QC).
      execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", mp4, "-vf", `fps=6/${dur},scale=270:480,tile=6x1`, "-frames:v", "1", join(postDir, "storyboard.png")]);
      const probe = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", mp4]).toString().trim();
      if (Number(probe) !== total) qc.errors.push(`reel.mp4 has ${probe} frames, expected ${total}`);
      if (!spec.video) {
        const ps = spawnSync("ffmpeg", ["-hide_banner", "-i", mp4, "-framerate", String(fps), "-i", seq, "-lavfi", "[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]psnr", "-f", "null", "-"], { encoding: "utf8" }).stderr || ""; // ffmpeg reports PSNR on stderr
        const avg = Number((/average:([\d.]+|inf)/.exec(ps) || [])[1]);
        if (avg && avg < 32) qc.warnings.push(`encoding loses detail (PSNR ${avg.toFixed(1)} dB against the rendered frames)`);
        qc.psnr = avg || null;
      }
      if (qc.debug) writeFileSync(join(build, "..", "video-probe.json"), JSON.stringify(qc.debug));
      writeFileSync(join(outDir, "video-qc.json"), JSON.stringify({ frames: total, fps, errors: qc.errors, warnings: qc.warnings, psnr: qc.psnr ?? null, maxChange: Math.max(...fq.diff).toFixed(2) }, null, 1));
      r.errors.push(...qc.errors.map((e) => "video QC: " + e)); r.warnings.push(...qc.warnings.map((e) => "video QC: " + e));
      report.push({ slide: 1, file: "reel-cover.png", ...r });
      continue;
    }
    const name = s.template === "reel" ? "reel-overlay.png" : `${String(n).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(outDir, name), omitBackground: s.template === "reel", clip: { x: 0, y: 0, width: w, height: h } });
    report.push({ slide: n, file: name, ...r });
  }
  await page.close();
  rmSync(build, { recursive: true, force: true });
  writeFileSync(join(outDir, "render.json"), JSON.stringify({ size: [w, h], slides: report.map(({ slide, file, brand, marks, names }) => ({ slide, file, brand, marks, names })) }, null, 1));
  return { post: basename(postDir), size: `${w}x${h}`, slides: report };
}

async function render(target) {
  await fonts();
  const dirs = existsSync(join(target, "spec.json")) ? [target] : postDirs(target);
  if (!dirs.length) die(`nothing to render in ${target}`);
  let failed = false;
  await withBrowser(async (browser) => {
    for (const d of dirs) {
      try {
        const r = await renderPost(browser, d);
        for (const s of r.slides) {
          const flag = s.errors.length ? "FAIL" : s.warnings.length ? "WARN" : "ok  ";
          console.log(`${flag} ${r.post}/slides/${s.file} ${r.size}${[...s.errors, ...s.warnings].map((m) => "\n       - " + m).join("")}`);
          if (s.errors.length) failed = true;
        }
      } catch (e) { console.log(`FAIL ${basename(d)}: ${e.message}`); failed = true; }
    }
  });
  if (failed) process.exit(1);
}

// ---------- reel (video) ----------
async function reel(postDir) {
  const spec = readJson(join(postDir, "spec.json"));
  if (spec.format !== "reel" || !spec.video) die("reel needs spec.format \"reel\" and spec.video (path to the clip)");
  await render(postDir);
  const clip = resolveAsset(spec.video, postDir), overlay = join(postDir, "slides", "reel-overlay.png");
  if (!existsSync(clip)) die(`clip not found: ${clip}`);
  const { w, h } = sizeOf(spec);
  const vf = `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},hue=s=0,eq=contrast=1.06[v];[v][1:v]overlay=0:0,format=yuv420p`;
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", clip, "-i", overlay, "-filter_complex", vf, "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-movflags", "+faststart", "-c:a", "copy", join(postDir, "slides", "reel.mp4")]);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", String(spec.coverAt ?? 0.5), "-i", join(postDir, "slides", "reel.mp4"), "-frames:v", "1", join(postDir, "slides", "reel-cover.png")]);
  console.log(`ok   ${basename(postDir)}/slides/reel.mp4 and reel-cover.png`);
}

// ---------- contact sheet ----------
async function sheet(batch) {
  // Panoramas sit edge to edge (seams visible as they will swipe); Reels show their cover and a six-frame storyboard.
  const posts = postDirs(batch).map((d) => ({ d, pano: existsSync(join(d, "slides", "panorama.png")), board: existsSync(join(d, "storyboard.png")) ? join(d, "storyboard.png") : null, files: existsSync(join(d, "slides")) ? readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel-cover\.png$/.test(f)).sort() : [] }));
  const rows = posts.map(({ d, files, pano, board }) => `<section><h2>${basename(d)}${pano ? " · panorama" : board ? " · reel" : ""}</h2><div class="row${pano ? " pano" : ""}">${files.map((f) => `<figure><img src="file://${resolve(d, "slides", f)}"><figcaption>${f}</figcaption></figure>`).join("") || "<p>NOT RENDERED</p>"}${board ? `<figure><img class="board" src="file://${resolve(board)}"><figcaption>storyboard</figcaption></figure>` : ""}</div></section>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#F5F5F5;font:13px/1.3 sans-serif;width:1832px}section{margin-bottom:20px}h2{font-size:15px;margin:0 0 8px}.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0}img{width:216px;display:block;border:1px solid #E0E0E0;background:#fff}.pano{gap:0}.pano img{border-width:1px 0}img.board{width:auto;height:384px}figcaption{color:#5C5C5C;padding-top:3px}p{color:#c00;font-weight:600}</style>${rows}`;
  const file = join(batch, ".sheet.html"), out = join(batch, "contact-sheet.png");
  writeFileSync(file, html);
  await withBrowser(async (b) => { const p = await b.newPage({ viewport: { width: 1880, height: 800 } }); await p.goto("file://" + resolve(file)); await p.waitForLoadState("load"); await p.screenshot({ path: out, fullPage: true }); });
  rmSync(file);
  console.log(`ok   ${out}`);
}

// ---------- briefs validation ----------
// Strategy (SKILL.md / content-strategist.md): every batch is exactly one 3x3 Instagram grid block of 9 posts, about 5 attract (educational),
// 3 trust (credibility/portfolio) and 1 convert; every post passes six questions.
const BATCH_SIZE = 9;
const GOALS = ["attract", "trust", "convert"];
const FORMATS = ["single", "carousel", "panorama", "reel"];
// Owner direction (2026-11-11): about 3 carousels, 2 seamless panoramas, 2 singles and 2 Reels per batch, mixed through the grid.
const FORMAT_TARGET = { carousel: 3, panorama: 2, single: 2, reel: 2 };
const PRESENCE = ["vibrant", "muted", "mono"];
// Owner direction (2026-11-11): real client showcases are paused until the showcase workflow is rebuilt. Set to false to resume.
const CLIENT_SHOWCASES_PAUSED = true;
const CLIENT_WORK = /aurora surveys|\baurora\b|red e corp|\bred e\b|redecorp|red-e|eagle['’]?s nest|eagles-nest|social\/assets\/clients\//i;
// A fictional concept must say so in its captions and never read as delivered client work.
const CLIENT_CLAIM = /\bour client\b|\bclient project\b|\bfor (?:a|our) client\b|\bwe (?:built|designed|delivered) (?:this )?for\b/i;
const CTA_TYPES = ["save", "engage", "explore", "credibility", "lead", "none"];
// Aesthetic standard (owner rule, 2026-11-12): editorial, architectural, industrial, premium (social/brand/art-direction.md, references in
// social/brand/references/aesthetic/). Plans and image prompts may not ask for the treatments the owner ruled out.
const OFF_AESTHETIC = /\bcoz(?:y|ier)\b|\bcosy\b|cheerful|playful|whimsical|\bcute\b|cartoon|smiling|happy (?:family|families|customers|people|couple)|bright and airy|warm and inviting|\bsuburban\b|stock[- ]photo|homey|friendly neighbou?rhood|lifestyle stock|candid family/i;
// Physical plausibility (owner rule, 2026-11-12): compositions the owner rejected outright, in concepts, art direction and prompts.
const IMPLAUSIBLE = /concrete (?:i-|h-)?beams?|\blone (?:figure|person|worker|man|woman)\b|tiny figure for scale|(?:single|one) (?:long |huge |giant |oversized )*(?:steel )?(?:i-|h-)?beam (?:lying|resting|on|in)|(?:empty|vast|bare|giant|huge) (?:poured )?(?:concrete )?(?:pads?|slabs?)\b/i;
// Exclusions ("no cozy staging", "without a stock-photo look") are the prompt grammar's own closing line: ignore negated phrases.
const offAesthetic = (text) => String(text || "").replace(/\b(?:no|not|never|without|avoid(?:ing)?)\b[^.;:\n"]*/gi, " ").match(OFF_AESTHETIC);
const CHECKS = ["interesting", "value", "save_share_follow", "credibility", "role", "different"];
function validate(batch) {
  const p = join(batch, "briefs.json");
  if (!existsSync(p)) die(`${p} not found`);
  const b = readJson(p), errs = [], warns = [];
  if (!Array.isArray(b.posts) || !b.posts.length) die("briefs.json has no posts[]");
  const ids = new Set();
  let gens = 0, credits = 0;
  for (const post of b.posts) {
    const at = `post ${post.id ?? "?"}`;
    for (const k of ["id", "slug", "goal", "format", "visual_category", "objective", "audience", "key_message", "cta_type", "slides", "checks"]) if (post[k] == null || post[k] === "") errs.push(`${at}: missing ${k}`);
    if (ids.has(post.id)) errs.push(`${at}: duplicate id`); ids.add(post.id);
    if (post.slug && !/^[a-z0-9-]+$/.test(post.slug)) errs.push(`${at}: slug must be lowercase-kebab`);
    if (!GOALS.includes(post.goal)) errs.push(`${at}: goal must be one of ${GOALS.join("/")}`);
    if (!FORMATS.includes(post.format)) errs.push(`${at}: format must be one of ${FORMATS.join("/")}`);
    if (!CATEGORIES.includes(post.visual_category)) errs.push(`${at}: visual_category must be one of ${CATEGORIES.join("/")}`);
    if (!CTA_TYPES.includes(post.cta_type)) errs.push(`${at}: cta_type must be one of ${CTA_TYPES.join("/")}`);
    if (post.cta_type !== "none" && !post.cta) errs.push(`${at}: cta text missing (or set cta_type "none")`);
    for (const c of CHECKS) if (!post.checks || !String(post.checks[c] || "").trim()) errs.push(`${at}: checks.${c} unanswered (a post that fails a question is revised, not shipped)`);
    { const m2 = String(JSON.stringify([post.concept, post.angle, ...(post.slides || []).flatMap((sl) => [sl.art_direction, sl.visual?.prompt, sl.visual?.direction])])).replace(/\b(?:no|not|never|without|avoid(?:ing)?)\b[^.;:\n"]*/gi, " ").match(IMPLAUSIBLE); if (m2) errs.push(`${at}: "${m2[0]}" is a composition the owner rejected as physically implausible (art-direction.md, "Physical plausibility")`); }
    { const m = offAesthetic(JSON.stringify([post.concept, post.angle, ...(post.slides || []).flatMap((sl) => [sl.art_direction, sl.visual?.prompt, sl.visual?.direction])])); if (m) errs.push(`${at}: "${m[0]}" is outside Framework's aesthetic (editorial, architectural, industrial, premium; art-direction.md)`); }
    if (post.needs_confirmation) warns.push(`${at}: needs owner confirmation: ${post.needs_confirmation}`);
    if (CLIENT_SHOWCASES_PAUSED) { const m = JSON.stringify(post).match(CLIENT_WORK); if (m) errs.push(`${at}: mentions real client work ("${m[0]}"): client showcases are paused (owner, 2026-11-11)`); }
    if (post.fictional && !(post.fictional.brand && String(post.fictional.disclosure || "").length >= 10)) errs.push(`${at}: fictional needs {brand, disclosure} (how the captions say it is a concept)`);
    const cc = post.cover_colour;
    if (!cc || !PRESENCE.includes(cc.presence) || !Array.isArray(cc.hex) || !cc.hex.length) errs.push(`${at}: cover_colour {presence: ${PRESENCE.join("|")}, hex: [main colours], tone} missing (plan the grid's colour before the post)`);
    if (post.format === "panorama" && !(Number(post.panels) >= 2 && Number(post.panels) <= 10 && (post.slides || []).length === Number(post.panels))) errs.push(`${at}: a panorama needs "panels" (2-10) and one slides[] entry per panel`);
    if (post.format === "reel" && !(post.motion && Number(post.motion.duration) >= 3 && Number(post.motion.duration) <= 90 && post.motion.cover)) errs.push(`${at}: a reel needs motion {duration: 3-90 s, cover: what the grid tile shows}`);
    if (!post.concept) warns.push(`${at}: no "concept" (the visual idea; see art-direction.md)`);
    for (const [k, sl] of (post.slides || []).entries()) for (const [re, alt] of JARGON) { const m = slideText(sl).match(re); if (m) warns.push(`${at} slide ${k + 1}: specialist term "${m[0]}" planned on a slide: ${alt}`); }
    const slides = post.slides || [];
    if (post.format === "carousel" && (slides.length < 3 || slides.length > 10)) errs.push(`${at}: carousels need 3-10 slides`);
    if (post.format === "reel" && (slides.length < 1 || slides.length > 8)) errs.push(`${at}: describe a reel's scenes as 1-8 slides[] entries`);
    if (post.format === "single" && slides.length !== 1) errs.push(`${at}: single posts have exactly 1 slide`);
    for (const [i, s] of slides.entries()) {
      if (!TEMPLATES.includes(s.template)) errs.push(`${at} slide ${i + 1}: unknown template "${s.template}"`);
      const v = s.visual || {};
      if (v.source === "higgsfield") {
        gens += 1; credits += Number(v.est_credits || 0);
        if (!v.prompt || v.prompt.length < 80) errs.push(`${at} slide ${i + 1}: higgsfield visual needs a full prompt`);
        else if (!/light|shadow/i.test(v.prompt)) errs.push(`${at} slide ${i + 1}: the image prompt must direct the light (aesthetic standard: dramatic, directional, cinematic)`);
      }
      if (v.source === "site" && !(v.ref && existsSync(resolve(REPO_ROOT, v.ref.replace(/^@site\//, ""))))) errs.push(`${at} slide ${i + 1}: site image not found: ${v.ref}`);
    }
  }
  // Feed plan: neighbours in publishing order must not share a cover family; tones should alternate; categories should vary.
  const covers = b.posts.map((p) => ({ id: p.id, fam: familyOf(p.slides?.[0] || {}), tone: (p.slides?.[0]?.theme || "paper") === "ink" ? "dark" : "light", cat: p.visual_category }));
  for (let i = 1; i < covers.length; i++) if (covers[i].fam === covers[i - 1].fam) errs.push(`posts ${covers[i - 1].id} and ${covers[i].id}: consecutive covers use the same layout family (${covers[i].fam})`);
  for (let i = 2; i < covers.length; i++) if (covers[i].tone === "dark" && covers[i - 1].tone === "dark" && covers[i - 2].tone === "dark") warns.push(`posts ${covers[i - 2].id}-${covers[i].id}: three dark covers in a row`);
  const n = b.posts.length, count = (k, v) => b.posts.filter((p) => p[k] === v).length;
  const mix = Object.fromEntries(GOALS.map((g) => [g, count("goal", g)]));
  if (n !== BATCH_SIZE) errs.push(`a batch is exactly ${BATCH_SIZE} posts (one complete 3x3 grid block); this one has ${n}`);
  const target = { attract: 5, trust: 3, convert: 1 };
  for (const g of GOALS) if (Math.abs(mix[g] - (target[g] * n) / BATCH_SIZE) > 1) warns.push(`goal mix ${JSON.stringify(mix)} drifts from about 5 attract / 3 trust / 1 convert (fine if deliberate: say why in plan.md)`);
  const formats = new Set(b.posts.map((p) => p.format));
  if (n >= 6 && formats.size < 2) warns.push(`every post is a ${[...formats][0]}: mix carousels with single-image posts`);
  const fmix = Object.fromEntries(FORMATS.map((f) => [f, count("format", f)]));
  // Owner rule (2026-11-12): Framework's isometric technical illustration (the frameworkco.ca linework) is a core style: 1-2 posts per batch, or a prominent part of a carousel or Reel.
  const iso = b.posts.filter((p) => p.visual_category === "technical-illustration" || (p.slides || []).some((sl) => sl.category === "technical-illustration"));
  if (n === BATCH_SIZE && !iso.length) errs.push(`no post uses Framework's technical illustration style: plan 1-2 (visual_category "technical-illustration", or slides with category "technical-illustration" in a carousel or Reel)`);
  if (iso.length > 3) warns.push(`${iso.length} posts use the technical illustration style: 1-2 keeps it special`);
  if (n === BATCH_SIZE && FORMATS.some((f) => fmix[f] !== FORMAT_TARGET[f])) warns.push(`format mix ${JSON.stringify(fmix)} differs from the target ${JSON.stringify(FORMAT_TARGET)} (only when another format clearly improves a post: say why in plan.md)`);
  for (let i = 1; i < n; i++) if (b.posts[i].format === b.posts[i - 1].format) errs.push(`posts ${b.posts[i - 1].id} and ${b.posts[i].id}: two ${b.posts[i].format} posts back to back (mix formats through the publishing order)`);
  // Colour: a grid-wide plan first, then each cover's place in it. Display order: the last post published sits top-left.
  if (!b.colour_plan || !Array.isArray(b.colour_plan.palette) || b.colour_plan.palette.length < 3) errs.push(`colour_plan {palette: [{name, hex, role}], distribution} missing: plan the 3x3 colour composition before the posts`);
  const pres = b.posts.map((p) => p.cover_colour?.presence);
  const coloured = pres.filter((x) => x === "vibrant" || x === "muted").length;
  if (n === BATCH_SIZE && coloured < 4) warns.push(`${coloured} covers carry colour: aim for 4-5 (black and white is an option, not the default)`);
  if (n === BATCH_SIZE) {
    const cell = (i) => { const k = n - 1 - i; return { r: Math.floor(k / 3), c: k % 3 }; };
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const a = cell(i), c = cell(j), ca = b.posts[i].cover_colour, cb = b.posts[j].cover_colour;
      const near = (a.r === c.r && Math.abs(a.c - c.c) === 1) || (a.c === c.c && Math.abs(a.r - c.r) === 1);
      if (near && ca && cb && ca.presence !== "mono" && ca.presence === cb.presence && String(ca.hex?.[0]).toLowerCase() === String(cb.hex?.[0]).toLowerCase()) warns.push(`posts ${b.posts[i].id} and ${b.posts[j].id} are grid neighbours with the same lead colour ${ca.hex[0]}: vary them`);
    }
    for (let r = 0; r < 3; r++) { const row = [0, 1, 2].map((c) => b.posts[n - 1 - (r * 3 + c)]?.cover_colour?.presence); if (row.every((x) => x === "mono")) warns.push(`grid row ${r + 1} has no colour`); if (row.every((x) => x && x !== "mono")) warns.push(`grid row ${r + 1} is all colour: spread colour through the block`); }
  }
  const cats = new Set(b.posts.map((p) => p.visual_category));
  if (n >= 6 && cats.size < 4) warns.push(`only ${cats.size} visual categories across ${n} posts: aim for 4 or more`);
  for (const c of cats) if (n >= 5 && count("visual_category", c) / n > 0.4) warns.push(`${c} is over 40% of the batch`);
  console.log(`posts ${n} · goals ${JSON.stringify(mix)} · formats ${JSON.stringify(fmix)} · colour covers ${coloured} · categories ${cats.size} · higgsfield generations ${gens}${credits ? ` (~${credits} credits est.)` : ""}`);
  warns.forEach((w) => console.log("WARN " + w));
  errs.forEach((e) => console.log("FAIL " + e));
  if (errs.length) process.exit(1);
  console.log("ok   briefs.json is a valid handoff");
}

// ---------- batch check ----------
const BANNED = ["disrupt", "game-changing", "game changer", "synergy", "world-class", "best-in-class", "unlock your", "next level", "passion", "hustle", "the ultimate", "the best ", "revolutionary", "cutting-edge", "elevate your", "supercharge", "skyrocket", "in today's", "in today’s", "let's dive", "let’s dive", "dive into", "here's the thing", "here’s the thing"];
const EMOJI = /\p{Extended_Pictographic}/u;
function lintCaption(text, platform) {
  const issues = [], lower = text.toLowerCase();
  if (!text.trim()) return ["empty"];
  if (/TODO|TBD|\[.*?\]|lorem/i.test(text)) issues.push("placeholder text");
  if (text.includes("!")) issues.push("exclamation mark");
  if (EMOJI.test(text)) issues.push("emoji");
  for (const w of BANNED) if (lower.includes(w)) issues.push(`avoided phrase "${w.trim()}"`);
  const tags = text.match(/#[\p{L}\d_]+/gu) || [];
  const body = text.replace(/(\s*#[\p{L}\d_]+)+\s*$/u, "");
  if (/#[\p{L}\d_]+/u.test(body)) issues.push("hashtag inside body copy (brand: hashtags only at the end)");
  if (platform === "instagram") { if (text.length > 2200) issues.push(`over 2,200 characters (${text.length})`); if (tags.length > 5) issues.push(`${tags.length} hashtags (0-5, only where they help discovery)`); if (text.split("\n")[0].length > 150) issues.push("first line over 150 characters: the hook gets truncated"); }
  if (platform === "facebook" && tags.length > 2) issues.push(`${tags.length} hashtags on Facebook (keep 0-2)`);
  return issues;
}
// Branding QC (owner rule, 2026-11-11): no automatic logos, wordmarks, URLs or branded footers. Framework branding appears only
// where the concept calls for it (spec brand.reason), large and inside the composition, never as a corner stamp or footer strip.
function brandingIssues(d, spec, w, h) {
  const out = [], rp = join(d, "slides", "render.json");
  spec.slides.forEach((s, i) => {
    if ("footer" in s) out.push(`slide ${i + 1}: "footer" field (branded footers are retired; use "source" for citations)`);
    if (s.brand && !(s.brand.reason && String(s.brand.reason).trim().length >= 12)) out.push(`slide ${i + 1}: brand without a reason (branding must be an intentional part of the concept)`);
  });
  if (!existsSync(rp)) return [...out, "no branding audit (slides/render.json): re-render with the current engine"];
  const r = readJson(rp);
  const corner = (b) => (b.y + b.h > h * 0.82 || b.y < h * 0.12) && (b.x < w * 0.3 || b.x + b.w > w * 0.7);
  for (const sl of r.slides) {
    const at = `slide ${sl.slide}`;
    for (const b of [...(sl.brand || []), ...(sl.marks || [])]) {
      if (b.kind === "svg") out.push(`${at}: logo graphic outside an intentional brand element`);
      else if (Math.max(b.w, b.h) < 160) out.push(`${at}: ${b.kind} is ${Math.max(b.w, b.h)}px: too small to be a deliberate brand moment (looks like a watermark)`);
      else if (corner(b) && Math.max(b.w, b.h) < w * 0.25) out.push(`${at}: ${b.kind} sits in a corner like a watermark`);
    }
    for (const t of sl.names || []) if (t.y + t.h > h * 0.88 && t.h < 60) out.push(`${at}: "${t.text}" along the bottom edge reads as a branded footer or URL watermark`);
  }
  const branded = r.slides.filter((sl) => (sl.brand || []).length).length;
  if (branded > 1) out.push(`brand element on ${branded} slides: an intentional brand moment appears once per post at most`);
  return out;
}
// Plain language (owner rule): slides speak to everyday business owners. Jargon and specialist terms belong in captions,
// explained, not on slides. Each entry: [pattern, plain alternative].
const JARGON = [[/largest contentful paint|\bLCP\b/i, "say how fast the page appears"], [/percentile/i, "say 'most visits'"], [/\bWCAG\b|level a{1,3}\b/i, "say 'easy to read' or 'accessible'"],
  [/\bCTA\b|call[- ]to[- ]action/i, "say 'next step' or the button's words"], [/\bUX\b|\bUI\b/i, "say 'easy to use'"], [/\bCMS\b/i, "say 'the system you edit your site in'"], [/\bKPIs?\b/i, "say what you measure"],
  [/structured data|schema markup|metadata|\bmeta (?:title|description)/i, "say what it does for the customer"], [/viewport|responsive breakpoint/i, "say 'on a phone'"], [/canonical|crawl(?:er|ing)?|\bSERPs?\b|backlinks?/i, "say what Google does or shows"],
  [/bounce rate/i, "say 'people leave right away'"], [/\b(?:DNS|SSL|API|HTML|CSS)\b/, "describe the outcome, not the technology"], [/\b\d+\s?px\b|\bpixels?\b/i, "describe the size people experience (e.g. 'big enough for a thumb')"], [/contrast ratio|\d(?:\.\d)?\s?:\s?1\b/i, "say 'text people can read'"]];
const slideText = (s) => [s.eyebrow, s.headline, s.headline2, s.support, s.body, s.giant, s.quote, ...(s.items || []).flatMap((i) => (typeof i === "string" ? [i] : [i.title, i.desc, i.label])), ...(s.rows || []).flat(), ...(s.layers || []).filter((l) => l.type === "text").map((l) => l.text)].filter(Boolean).join(" \n ").replace(/\{\{|\}\}|\*\*/g, "");
// Framework's palette, plus the website's dark surfaces (theme.css, home.css) used behind its technical illustrations.
const BRAND_HEX = ["#0a0a0a", "#ffffff", "#5c5c5c", "#a3a3a3", "#e0e0e0", "#f5f5f5", "#fff", "#000000", "#141414", "#101010"];
function creativeIssues(d, spec, w, h, palette = []) {
  const out = [], say = (lvl, m) => out.push([lvl, m]);
  // A panorama is one canvas cut into slides: judge its words per slide (panel), by where each text layer sits.
  // A motion reel shows its words over time: judge the busiest moment (layers whose opacity is above 5% at the same time), not the whole timeline.
  const opacityAt = (l, t) => {
    const ks = (l.anim || []).filter((k) => k.opacity != null).sort((a, b) => a.t - b.t), base = l.opacity ?? 1;
    if (!ks.length) return base;
    if (t <= ks[0].t) return ks[0].opacity;
    for (let i = 1; i < ks.length; i++) if (t <= ks[i].t) return ks[i - 1].opacity + ((ks[i].opacity - ks[i - 1].opacity) * (t - ks[i - 1].t)) / ((ks[i].t - ks[i - 1].t) || 1);
    return ks.at(-1).opacity;
  };
  const busiest = (sl) => {
    let best = { ...sl, layers: [] }, most = -1;
    for (let t = 0; t <= Number(spec.motion.duration); t += 0.25) {
      const clipped = (l) => { const ks = (l.anim || []).filter((k) => k.clip).sort((a, b) => a.t - b.t); if (!ks.length) return false; const k = [...ks].reverse().find((x) => x.t <= t) || ks[0]; return /100%/.test(k.clip); }; // a fully closed reveal mask hides the text
      const layers = (sl.layers || []).filter((l) => l.type !== "text" || (opacityAt(l, t) > 0.05 && !clipped(l))), n = slideText({ layers }).split(/\s+/).filter((x) => /\w/.test(x)).length;
      if (n > most) { most = n; best = { ...sl, layers }; }
    }
    return best;
  };
  const units = spec.format === "reel" && spec.motion ? spec.slides.map(busiest) : spec.format === "panorama" ? Array.from({ length: Number(spec.panels) }, (_, k) => ({ ...spec.slides[0], layers: (spec.slides[0].layers || []).filter((l) => l.type !== "text" || Math.floor((Number(l.x) || 0) / w) === k) })) : spec.slides;
  const allowed = new Set([...BRAND_HEX, ...palette.map((x) => String(x).toLowerCase())]);
  units.forEach((s, i) => {
    const at = `slide ${i + 1}`, text = slideText(s);
    for (const [re, alt] of JARGON) { const m = text.match(re); if (m && !s.plainLanguageOk) say("FAIL", `${at}: specialist term "${m[0]}" on the slide: ${alt}; put the technical detail and source in the caption`); }
    const words = text.split(/\s+/).filter((x) => /\w/.test(x)).length;
    if (words > 45) say("FAIL", `${at}: ${words} words on one slide (45 max; let the image or a second slide carry it)`);
    else if (words > 32) say("WARN", `${at}: ${words} words: a slide should read in a few seconds`);
    const hexes = JSON.stringify(s).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
    const off = [...new Set(hexes.map((x) => x.toLowerCase()))].filter((x) => !allowed.has(x));
    if (off.length && !s.clientColour && !s.colourReason) say("FAIL", `${at}: colours ${off.join(", ")} are in neither Framework's palette nor the batch colour_plan: add them to the plan, or give "colourReason"`);
  });
  const withEyebrow = spec.slides.filter((s) => s.eyebrow).length;
  if (spec.slides.length >= 3 && withEyebrow / spec.slides.length > 0.5) say("WARN", `${withEyebrow} of ${spec.slides.length} slides carry an eyebrow label: use labels only where they help`);
  if (spec.slides.filter((s) => s.header).length > 1) say("WARN", "ruled headers on several slides read as template furniture");
  // Mostly-empty canvas: a slide that is almost all background with no image reads as an unfinished template.
  const pngs = spec.format === "reel" ? [] : units.map((s, i) => ({ s, f: join(d, "slides", `${String(i + 1).padStart(2, "0")}.png`) })).filter(({ s, f }) => existsSync(f) && !isImagery(s) && s.template !== "minimal" && !s.intentionalSpace);
  if (pngs.length) {
    const py = "import sys,json\nfrom PIL import Image\nout=[]\nfor p in sys.argv[1:]:\n  im=Image.open(p).convert('L').resize((108,135)); px=list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata()); bg=max(set(px),key=px.count); out.append(sum(1 for v in px if abs(v-bg)<=6)/len(px))\nprint(json.dumps(out))";
    const fr = JSON.parse(execFileSync("python3", ["-I", "-c", py, ...pngs.map((p) => p.f)]).toString());
    fr.forEach((v, k) => { if (v > 0.9) say("WARN", `slide ${units.indexOf(pngs[k].s) + 1}: ${Math.round(v * 100)}% empty background: use the canvas (scale, image, composition) or set intentionalSpace with a reason`); });
  }
  return out;
}
// Mockup realism (owner hard rule, 2026-11-12): a branded object must look like a real, finished product photographed in the world,
// with the artwork physically part of it. A design laid over a photograph afterwards fails, however neat. Two layers of defence:
// 1. the renderer refuses the compositing signatures (a mark, graphic or blended/tilted layer placed on top of a photograph);
// 2. every slide marked "mockup" needs the Director's full-size verdict "pass" in <batch>/mockups.json.
const isPhoto = (l) => l.type === "image" && !/\.svg$/i.test(l.src || "");
function compositeIssues(spec) {
  const out = [];
  spec.slides.forEach((s, i) => {
    const L = s.layers || [], first = L.findIndex(isPhoto);
    if (first < 0) return;
    const found = new Set();
    for (const l of L.slice(first + 1)) {
      const what = l.type === "image" && !isPhoto(l) ? "vector graphic" : ["svg", "brand", "swatch"].includes(l.type) ? `${l.type} layer` : (l.blend || l.tilt) && !["laptop", "phone", "browser"].includes(l.type) ? `${l.type} with ${l.blend ? "blend" : "tilt"}` : null;
      if (what) found.add(what);
    }
    if (found.size) out.push(`slide ${i + 1}: design laid over a photograph (${[...found].join(", ")}): branding on an object must be part of the photograph itself (generated or edited into the image), never composited on top`);
  });
  return out;
}
function check(batch) {
  let fail = 0, warn = 0;
  const say = (lvl, m) => { console.log(`${lvl} ${m}`); lvl === "FAIL" ? fail++ : lvl === "WARN" ? warn++ : 0; };
  const briefs = existsSync(join(batch, "briefs.json")) ? readJson(join(batch, "briefs.json")) : null;
  const dirs = postDirs(batch);
  const mockReview = existsSync(join(batch, "mockups.json")) ? readJson(join(batch, "mockups.json")) : [];
  const palette = briefs ? [...(briefs.colour_plan?.palette || []).map((c) => c.hex), ...briefs.posts.flatMap((p) => p.cover_colour?.hex || [])].filter(Boolean) : [];
  if (briefs && dirs.length !== briefs.posts.length) say("FAIL", `briefs has ${briefs.posts.length} posts, posts/ has ${dirs.length}`);
  for (const d of dirs) {
    const id = basename(d);
    if (!existsSync(join(d, "spec.json"))) { say("FAIL", `${id}: no spec.json`); continue; }
    const spec = readJson(join(d, "spec.json")), { w, h } = sizeOf(spec);
    const pngs = existsSync(join(d, "slides")) ? readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$/.test(f)) : [];
    const brief = briefs?.posts.find((p) => id.startsWith(String(p.id).padStart(2, "0")));
    const expected = spec.format === "panorama" ? Number(spec.panels) : spec.slides.length;
    if (spec.format === "reel") {
      const mp4 = join(d, "slides", "reel.mp4"), cover = join(d, "slides", "reel-cover.png");
      if (!existsSync(mp4)) say("FAIL", `${id}: reel.mp4 not composed`);
      else {
        const [vw, vh, dur] = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "csv=p=0:s=,", mp4]).toString().split(/[\n,]/).filter(Boolean).map(Number);
        if (vw !== w || vh !== h) say("FAIL", `${id}/reel.mp4: ${vw}x${vh}, expected ${w}x${h}`);
        if (!(dur >= 3 && dur <= 90)) say("FAIL", `${id}/reel.mp4: ${dur}s (3-90 s)`);
      }
      if (!existsSync(cover)) say("FAIL", `${id}: no reel-cover.png (every Reel needs a cover for the grid)`);
      if (spec.motion) {
        const vq = join(d, "slides", "video-qc.json");
        if (!existsSync(vq)) say("FAIL", `${id}: no video QC (slides/video-qc.json): re-render with the current engine`);
        else { const q = readJson(vq); for (const e of q.errors) say("FAIL", `${id}: video QC: ${e}`); for (const e of q.warnings) say("WARN", `${id}: video QC: ${e}`); }
      }
    } else if (pngs.length !== expected) say("FAIL", `${id}: ${pngs.length} PNGs for ${expected} slides (run render)`);
    if (CLIENT_SHOWCASES_PAUSED) { const all = JSON.stringify(spec) + ["caption-instagram.txt", "caption-facebook.txt"].map((f) => (existsSync(join(d, f)) ? readFileSync(join(d, f), "utf8") : "")).join(" "); const m = all.match(CLIENT_WORK); if (m) say("FAIL", `${id}: real client work ("${m[0]}") while client showcases are paused`); }
    if (brief?.fictional) for (const f of ["caption-instagram.txt", "caption-facebook.txt"]) {
      const t = existsSync(join(d, f)) ? readFileSync(join(d, f), "utf8") : "";
      if (!/\bconcept\b|fictional|imagined|invented/i.test(t)) say("FAIL", `${id}/${f}: ${brief.fictional.brand} is a fictional concept: the caption must say so`);
      const m = t.match(CLIENT_CLAIM); if (m) say("FAIL", `${id}/${f}: "${m[0]}" presents a concept as client work`);
    }
    for (const f of pngs) { const s = pngSize(join(d, "slides", f)); if (s.w !== w || s.h !== h) say("FAIL", `${id}/${f}: ${s.w}x${s.h}, expected ${w}x${h}`); }
    if (spec.slides.some((s) => s.image && /^https?:/.test(s.image))) say("FAIL", `${id}: remote image URL in spec (download it into images/ first)`);
    for (const m of brandingIssues(d, spec, w, h)) say("FAIL", `${id}: ${m}`);
    for (const m of compositeIssues(spec)) say("FAIL", `${id}: mockup realism: ${m}`);
    spec.slides.forEach((s, i) => {
      if (!s.mockup) return;
      const v = mockReview.find((r) => id.startsWith(String(r.post).padStart(2, "0")) && Number(r.slide) === i + 1);
      if (!v || v.verdict !== "pass") say("FAIL", `${id}: slide ${i + 1} (${s.mockup}) mockup realism ${v ? `failed: ${v.note || "see mockups.json"}` : "not yet reviewed: the Director records a full-size verdict in mockups.json"}`);
    });
    for (const [lvl, m] of creativeIssues(d, spec, w, h, palette)) say(lvl, `${id}: ${m}`);
    for (const [file, platform] of [["caption-instagram.txt", "instagram"], ["caption-facebook.txt", "facebook"], ["alt-text.txt", "alt"]]) {
      const p = join(d, file);
      if (!existsSync(p)) { say("FAIL", `${id}: missing ${file}`); continue; }
      if (platform === "alt") { if (!readFileSync(p, "utf8").trim()) say("FAIL", `${id}: empty alt-text.txt`); continue; }
      for (const i of lintCaption(readFileSync(p, "utf8"), platform)) say(/placeholder|empty|exclamation|emoji|avoided|2,200/.test(i) ? "FAIL" : "WARN", `${id}/${file}: ${i}`);
    }
  }
  // Physical plausibility: every generated image in use carries the Director's full-size verdict (materials, scale, site logic, structure,
  // textures, AI artifacts). Images replaced later are marked "rejected": true in assets.json.
  const imagery = existsSync(join(batch, "imagery.json")) ? readJson(join(batch, "imagery.json")) : [];
  for (const d of dirs) {
    const a = join(d, "assets.json"); if (!existsSync(a)) continue;
    const doc = readJson(a), list = Array.isArray(doc) ? doc : doc.images || [];
    for (const im of list.filter((x) => x && x.source === "higgsfield" && !x.rejected && x.file)) {
      const id = basename(d), v = imagery.find((r) => id.startsWith(String(r.post).padStart(2, "0")) && basename(String(r.file)) === basename(im.file));
      if (!v || v.verdict !== "pass") say("FAIL", `${id}/${im.file}: physical plausibility ${v ? `failed: ${v.note || "see imagery.json"}` : "not yet judged: the Director checks materials, scale, site logic, structure, textures and AI artifacts at full size and records a verdict in imagery.json"}`);
    }
  }
  // Aesthetic standard: every post of a batch carries the Director's verdict against the reference set (hard QC rule).
  if (dirs.length === BATCH_SIZE) {
    const verdicts = existsSync(join(batch, "aesthetic.json")) ? readJson(join(batch, "aesthetic.json")) : [];
    for (const d of dirs) {
      const id = basename(d), v = verdicts.find((r) => id.startsWith(String(r.post).padStart(2, "0")));
      if (!v || v.verdict !== "pass") say("FAIL", `${id}: aesthetic standard ${v ? `failed: ${v.note || "see aesthetic.json"}` : "not yet judged: the Director compares the post with social/brand/references/aesthetic/ and records a verdict in aesthetic.json"}`);
    }
  }
  for (const d of dirs) {
    const a = join(d, "assets.json"), m = existsSync(a) ? offAesthetic(readFileSync(a, "utf8")) : null;
    if (m) say("FAIL", `${basename(d)}/assets.json: an image prompt asks for "${m[0]}", outside Framework's aesthetic`);
  }
  const drawn = dirs.filter((d) => existsSync(join(d, "spec.json")) && JSON.stringify(readJson(join(d, "spec.json"))).includes('"type":"iso"'));
  if (dirs.length === BATCH_SIZE && !drawn.length) say("FAIL", `no post draws Framework's technical illustration style with an "iso" layer (owner rule: 1-2 per batch, drawn in the website's linework, never generated)`);
  console.log(`check: ${dirs.length} posts, ${fail} fail, ${warn} warn`);
  if (fail) process.exit(1);
}

// ---------- package ----------
function pkg(batch) {
  check(batch);
  const name = basename(resolve(batch)), out = join(batch, "export", name);
  rmSync(join(batch, "export"), { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const briefs = existsSync(join(batch, "briefs.json")) ? readJson(join(batch, "briefs.json")) : { posts: [] };
  let index = `# ${name}\n\nFinished posts, numbered in publishing order: publish 01 first and 09 last (Instagram shows the newest post top-left).\nEach folder: the slides in swipe order, the Instagram and Facebook captions, and alt text.\n- Panorama: upload every slide in numeric order without cropping; preview-full-panorama.png is for review only.\n- Reel: upload reel.mp4 and choose reel-cover.png as the cover.\n\n| # | Post | Goal | Category | Format | Slides |\n|---|---|---|---|---|---|\n`;
  for (const d of postDirs(batch)) {
    const id = basename(d), dest = join(out, id); mkdirSync(dest);
    const files = readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel\.mp4$|^reel-cover\.png$|^panorama\.png$/.test(f));
    files.forEach((f) => copyFileSync(join(d, "slides", f), join(dest, /^\d+\.png$/.test(f) ? `${id}-${f}` : f === "panorama.png" ? "preview-full-panorama.png" : f)));
    ["caption-instagram.txt", "caption-facebook.txt", "alt-text.txt"].forEach((f) => copyFileSync(join(d, f), join(dest, f)));
    const b = briefs.posts.find((p) => id.startsWith(String(p.id).padStart(2, "0"))) || {};
    index += `| ${b.id ?? ""} | ${id} | ${b.goal ?? ""} | ${b.visual_category ?? ""} | ${b.format ?? ""} | ${files.filter((f) => /^\d+\.png$/.test(f)).length || (files.includes("reel.mp4") ? "video" : 0)} |\n`;
  }
  writeFileSync(join(out, "README.md"), index);
  const zip = join(batch, "export", `${name}.zip`);
  execFileSync("python3", ["-I", "-m", "zipfile", "-c", zip, out]);
  console.log(`ok   ${out}\nok   ${zip}`);
}

// ---------- feed: covers, tone, history ----------
const HISTORY_DIR = process.env.FW_HISTORY_DIR ? resolve(process.env.FW_HISTORY_DIR) : join(REPO_ROOT, "social", "history"); // override for tests
const HISTORY_CSV = join(HISTORY_DIR, "posts.csv");
const HISTORY_COLS = ["date_produced", "date_published", "batch", "id", "slug", "goal", "category", "family", "tone", "format", "topic", "headline", "cta_type", "cover", "reach", "non_follower_reach", "saves", "shares", "profile_visits", "follows", "website_clicks", "inquiries", "notes"];
const METRICS = ["reach", "non_follower_reach", "saves", "shares", "profile_visits", "follows", "website_clicks", "inquiries"];

function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); if (row.some((x) => x !== "")) rows.push(row); }
  const [head, ...body] = rows;
  return (body || []).map((r) => Object.fromEntries((head || []).map((h, i) => [h, r[i] ?? ""])));
}
const csvCell = (v) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
const readHistory = () => (existsSync(HISTORY_CSV) ? parseCsv(readFileSync(HISTORY_CSV, "utf8")) : []);
const writeHistory = (rows) => { mkdirSync(HISTORY_DIR, { recursive: true }); writeFileSync(HISTORY_CSV, [HISTORY_COLS.join(","), ...rows.map((r) => HISTORY_COLS.map((c) => csvCell(r[c])).join(","))].join("\n") + "\n"); };

/** Per image, on the 3:4 middle crop the profile grid shows: mean luminance (0-255), contrast, colourfulness (Hasler-Süsstrunk M; under ~20 reads as black and white)
 *  and the dominant hue (degrees) of its saturated pixels. */
function imageStats(paths) {
  if (!paths.length) return [];
  const py = [
    "import sys,json,colorsys", "from PIL import Image, ImageStat", "out=[]", "for p in sys.argv[1:]:",
    "  im=Image.open(p).convert('RGB'); W,H=im.size; ch=min(H,round(W*4/3)); im=im.crop((0,(H-ch)//2,W,(H-ch)//2+ch)); im.thumbnail((108,144))",
    "  st=ImageStat.Stat(im.convert('L')); px=list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata())",
    "  rg=[r-g for r,g,b in px]; yb=[(r+g)/2-b for r,g,b in px]; n=len(px)",
    "  m=lambda v:sum(v)/n; sd=lambda v:(sum((x-m(v))**2 for x in v)/n)**.5",
    "  M=(sd(rg)**2+sd(yb)**2)**.5+.3*(m(rg)**2+m(yb)**2)**.5",
    "  bins=[0]*12", "  for r,g,b in px:", "    h,sat,v=colorsys.rgb_to_hsv(r/255,g/255,b/255)", "    if sat>.25 and v>.15: bins[int(h*12)%12]+=1",
    "  out.append({'mean':round(st.mean[0],1),'std':round(st.stddev[0],1),'colour':round(M,1),'hue':(bins.index(max(bins))*30+15) if max(bins)>n*.05 else None})",
    "print(json.dumps(out))"].join("\n");
  return JSON.parse(execFileSync("python3", ["-I", "-c", py, ...paths]).toString());
}
const toneOf = (mean) => (mean < 100 ? "dark" : mean > 170 ? "light" : "mid");
const presenceOf = (m) => (m >= 45 ? "vibrant" : m >= 20 ? "muted" : "mono");
const archived = (r) => /^archived/i.test(r.notes || "");

/** The batch's posts in publishing order (id order), with their cover file and feed attributes. */
function batchCovers(batch) {
  const posts = postDirs(batch).map((d) => {
    const spec = readJson(join(d, "spec.json")), s0 = spec.slides[0] || {};
    const cover = ["01.png", "reel-cover.png"].map((f) => join(d, "slides", f)).find(existsSync);
    const head = String([s0.giant, s0.headline || s0.quote, s0.headline2].filter(Boolean).join(" ") || (s0.layers || []).filter((l) => l.type === "text").map((l) => l.text).join(" ")).replace(/\{\{|\}\}|\*\*/g, "").replace(/\s*\n\s*/g, " ").trim();
    return { id: basename(d), dir: d, cover, family: familyOf(s0), category: categoryOf(s0), imagery: isImagery(s0), format: spec.format, headline: head };
  });
  const stats = imageStats(posts.filter((p) => p.cover).map((p) => p.cover));
  let k = 0;
  for (const p of posts) if (p.cover) { Object.assign(p, stats[k++]); p.tone = toneOf(p.mean); p.presence = presenceOf(p.colour); }
  return posts;
}

async function grid(batch) {
  const name = basename(resolve(batch));
  const posts = batchCovers(batch);
  const missing = posts.filter((p) => !p.cover);
  if (missing.length) die(`not rendered yet: ${missing.map((p) => p.id).join(", ")}`);
  const past = readHistory().filter((r) => r.batch !== name && !archived(r) && r.cover && existsSync(join(HISTORY_DIR, r.cover))).map((r) => ({ id: `${r.batch} ${r.id}`, cover: join(HISTORY_DIR, r.cover), family: r.family, category: r.category, tone: r.tone, past: true }));
  // Profile order: newest first. The batch publishes in id order on top of everything already in the history.
  const profile = [...posts].reverse().concat([...past].reverse()).slice(0, 15);
  const issues = [], say = (lvl, m) => issues.push({ lvl, m });
  const at = (i) => profile[i];
  for (let i = 0; i < profile.length; i++) {
    const right = i % 3 < 2 ? i + 1 : -1, below = i + 3;
    for (const j of [right, below]) {
      if (j < 0 || j >= profile.length) continue;
      const a = at(i), b = at(j);
      if (a.past && b.past) continue;
      if (a.family === b.family) say("FAIL", `${a.id} and ${b.id} sit next to each other in the grid with the same layout family (${a.family})`);
      else if (a.category === b.category && a.tone === b.tone) say("WARN", `${a.id} and ${b.id} are neighbours with the same category and tone (${a.category}, ${a.tone})`);
    }
  }
  // Colour across the block: 4-5 covers with real colour, spread out, and neighbours that do not look alike.
  const hueGap = (a, b) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));
  const block = profile.slice(0, 9).map((p, i) => ({ p, r: Math.floor(i / 3), c: i % 3, col: !p.past && p.presence !== "mono" }));
  for (const a of block) for (const b of block) {
    if (b.r * 3 + b.c <= a.r * 3 + a.c || !a.col || !b.col || Math.abs(a.r - b.r) + Math.abs(a.c - b.c) !== 1) continue;
    if (a.p.hue != null && b.p.hue != null && hueGap(a.p.hue, b.p.hue) < 25 && a.p.tone === b.p.tone) say("WARN", `${a.p.id} and ${b.p.id} are neighbours in the same colour and tone: they will read as one tile`);
  }
  for (let k = 0; k < 3; k++) for (const line of [block.filter((x) => x.r === k), block.filter((x) => x.c === k)]) if (line.length === 3 && line.every((x) => x.col)) say("WARN", `a full ${line[0].r === line[1].r ? "row" : "column"} of colour covers: spread colour through the block`);
  for (let r = 0; r * 3 < Math.min(profile.length, 12); r++) {
    const row = profile.slice(r * 3, r * 3 + 3);
    if (row.length === 3 && row.some((p) => !p.past) && row.every((p) => p.tone === row[0].tone)) say("WARN", `grid row ${r + 1} is all ${row[0].tone}: alternate light and dark`);
  }
  const n = posts.length, share = (f) => posts.filter(f).length / n;
  const dark = share((p) => p.tone === "dark"), light = share((p) => p.tone === "light"), imagery = share((p) => p.imagery);
  if (n >= 6 && (dark < 0.2 || dark > 0.6)) say("WARN", `${Math.round(dark * 100)}% of covers are dark: aim for 20-60%`);
  if (n >= 6 && light > 0.7) say("WARN", `${Math.round(light * 100)}% of covers are light: add dark or mid-tone covers`);
  if (n >= 6 && (imagery < 0.3 || imagery > 0.7)) say("WARN", `${Math.round(imagery * 100)}% of covers are photography or artwork: aim for 30-70% against typography and graphics`);
  const colourCovers = posts.filter((p) => p.presence !== "mono").length;
  if (n === 9 && colourCovers < 4) say("WARN", `${colourCovers} covers carry visible colour: aim for 4-5`);
  if (n === 9 && colourCovers > 7) say("WARN", `${colourCovers} covers carry colour: keep some black, white or quiet tiles so colour has room`);
  const fams = {}; posts.forEach((p) => (fams[p.family] = (fams[p.family] || 0) + 1));
  for (const [f, c] of Object.entries(fams)) if (c > 2) say("WARN", `layout family ${f} is used for ${c} covers: develop another composition`);
  if (n !== 9) say("WARN", `${n} posts: a batch should fill exactly one 3x3 grid block (9 posts)`);
  const cats = new Set(posts.map((p) => p.category));
  if (n >= 6 && cats.size < 4) say("WARN", `only ${cats.size} visual categories on the covers`);
  for (let i = 1; i < n; i++) if (posts[i].family === posts[i - 1].family) say("FAIL", `${posts[i - 1].id} and ${posts[i].id} publish back to back with the same layout family`);

  // Preview: realistic profile grid (3 columns, 3:4 tiles cropped from 4:5 like Instagram's profile view) + publishing-order strip.
  const tile = (p, i) => `<div class="t${p.past ? " past" : ""}"><img src="file://${p.cover}"><span class="n">${p.past ? "" : p.id.slice(0, 2)}</span></div>${i === 8 ? '<div class="fold">first screen: the newest nine</div>' : ""}`;
  const strip = posts.map((p) => `<figure><img src="file://${p.cover}"><figcaption><b>${p.id}</b><br>${p.format} · ${p.family}<br>${p.category}<br>${p.tone} · ${p.presence}${p.imagery ? " · image" : " · type"}</figcaption></figure>`).join("");
  const list = issues.map((x) => `<li class="${x.lvl}">${x.lvl} ${x.m}</li>`).join("") || "<li>No feed issues found.</li>";
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:32px;background:#fff;font:14px/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#0A0A0A;width:1736px;display:grid;grid-template-columns:600px 1fr;gap:48px}
h2{font-size:15px;margin:0 0 12px;letter-spacing:.04em;text-transform:uppercase}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:3px;position:relative}
.t{position:relative;aspect-ratio:3/4;overflow:hidden;background:#F5F5F5}.t img{width:100%;height:100%;object-fit:cover}.t.past img{opacity:.55}.t .n{position:absolute;right:6px;bottom:6px;background:#0A0A0A;color:#fff;font-size:11px;padding:2px 5px}
.t .n:empty{display:none}.fold{grid-column:1/-1;border-top:2px dashed #A3A3A3;color:#5C5C5C;font-size:12px;padding:4px 0}
.s{display:flex;flex-wrap:wrap;gap:12px}figure{margin:0;width:150px}figure img{width:150px;display:block;border:1px solid #E0E0E0}figcaption{font-size:12px;color:#5C5C5C;padding-top:4px}
ul{padding-left:18px}li.FAIL{color:#a00;font-weight:600}li.WARN{color:#5C5C5C}</style>
<div><h2>Profile preview · ${name}</h2><div class="g">${profile.map(tile).join("")}</div><p style="color:#5C5C5C;font-size:12px">Newest top-left. Faded tiles were published before this batch. Tiles are cropped to 3:4 as on the profile grid.</p></div>
<div><h2>Publishing order</h2><div class="s">${strip}</div><h2 style="margin-top:28px">Feed checks</h2><ul>${list}</ul></div>`;
  const file = join(batch, ".grid.html"), out = join(batch, "grid-preview.png");
  writeFileSync(file, html);
  await withBrowser(async (b) => { const pg = await b.newPage({ viewport: { width: 1800, height: 900 } }); await pg.goto("file://" + resolve(file)); await pg.waitForLoadState("load"); await pg.screenshot({ path: out, fullPage: true }); });
  rmSync(file);
  const md = `# Grid report: ${name}\n\n| Order | Post | Format | Family | Category | Tone | Colour | Imagery |\n|---|---|---|---|---|---|---|---|\n${posts.map((p, i) => `| ${i + 1} | ${p.id} | ${p.format} | ${p.family} | ${p.category} | ${p.tone} (${p.mean}) | ${p.presence} (${p.colour}${p.hue != null ? `, hue ${p.hue}°` : ""}) | ${p.imagery ? "yes" : "no"} |`).join("\n")}\n\nDark ${Math.round(dark * 100)}% · light ${Math.round(light * 100)}% · colour covers ${colourCovers} · imagery ${Math.round(imagery * 100)}% · categories ${cats.size} · history tiles ${past.length}\n\n${issues.map((x) => `- ${x.lvl} ${x.m}`).join("\n") || "- No feed issues found."}\n`;
  writeFileSync(join(batch, "grid-report.md"), md);
  issues.forEach((x) => console.log(`${x.lvl} ${x.m}`));
  console.log(`ok   ${out}\nok   ${join(batch, "grid-report.md")}`);
  if (issues.some((x) => x.lvl === "FAIL")) process.exit(1);
}

function historyCmd(sub, arg2) {
  const rows = readHistory();
  if (sub === "add") {
    const batch = resolve(arg2 || die("usage: fw.mjs history add <batch>")), name = basename(batch);
    const briefs = existsSync(join(batch, "briefs.json")) ? readJson(join(batch, "briefs.json")).posts : [];
    mkdirSync(join(HISTORY_DIR, "covers"), { recursive: true });
    const posts = batchCovers(batch), today = new Date().toISOString().slice(0, 10);
    const py = "import sys\nfrom PIL import Image\nim=Image.open(sys.argv[1]).convert('RGB'); im.thumbnail((540,675)); im.save(sys.argv[2],'JPEG',quality=80)";
    for (const p of posts) {
      const b = briefs.find((x) => p.id.startsWith(String(x.id).padStart(2, "0"))) || {};
      const cover = `covers/${name}--${p.id}.jpg`;
      if (p.cover) execFileSync("python3", ["-I", "-c", py, p.cover, join(HISTORY_DIR, cover)]);
      const prev = rows.find((r) => r.batch === name && r.id === p.id);
      const notes = prev?.notes || (b.fictional ? `fictional concept: ${b.fictional.brand}` : "");
      const row = { ...(prev || {}), date_produced: prev?.date_produced || today, batch: name, id: p.id, slug: b.slug || p.id.slice(3), goal: b.goal || "", category: b.visual_category || p.category, family: p.family, tone: [p.tone, p.presence].filter(Boolean).join(" "), format: p.format, topic: b.key_message || "", headline: p.headline, cta_type: b.cta_type || "", cover: p.cover ? cover : "", notes };
      if (prev) Object.assign(prev, row); else rows.push(row);
    }
    writeHistory(rows);
    console.log(`ok   ${posts.length} posts recorded in ${HISTORY_CSV}`);
  } else if (sub === "archive") {
    // A produced batch the owner set aside: kept for reference, never published, and left out of the grid preview.
    const name = basename(resolve(arg2 || die("usage: fw.mjs history archive <batch> [reason]"))), why = process.argv.slice(5).join(" ") || "set aside by the owner";
    const hit = rows.filter((r) => r.batch === name);
    if (!hit.length) die(`no rows for ${name} in the history`);
    for (const r of hit) { if (r.date_published) die(`${name} ${r.id} was published: published posts cannot be archived`); r.notes = `archived ${new Date().toISOString().slice(0, 10)}: ${why}`; }
    writeHistory(rows);
    console.log(`ok   ${hit.length} posts of ${name} archived (kept for reference, left out of the grid)`);
  } else if (sub === "recent") {
    const n = Number(arg2 || 20);
    for (const r of rows.slice(-n)) console.log([archived(r) ? "ARCHIVED (never published)" : r.date_published || "unpublished", r.batch, r.id, r.goal, r.format, r.category, r.family, r.tone, r.cta_type, r.headline, r.notes].join(" | "));
    if (!rows.length) console.log("history is empty");
  } else if (sub === "report") {
    const withData = rows.filter((r) => METRICS.some((m) => r[m] !== ""));
    console.log(`${rows.length} posts in history, ${withData.length} with performance data.`);
    if (withData.length < 3) { console.log("Not enough performance data to compare yet (need 3+ posts with metrics). Nothing is proven; keep following the plan."); return; }
    const med = (xs) => { const v = xs.filter((x) => x !== "" && !isNaN(x)).map(Number).sort((a, b) => a - b); return v.length ? v[Math.floor((v.length - 1) / 2)] : "–"; };
    for (const key of ["goal", "category", "family", "cta_type"]) {
      console.log(`\nby ${key} (medians; n = posts with data)`);
      console.log(["value", "n", ...METRICS].join(" | "));
      const groups = [...new Set(withData.map((r) => r[key]))];
      for (const g of groups) { const rs = withData.filter((r) => r[key] === g); console.log([g || "(blank)", rs.length + (rs.length < 3 ? " (too few)" : ""), ...METRICS.map((m) => med(rs.map((r) => r[m])))].join(" | ")); }
    }
  } else die("usage: fw.mjs history add <batch> | archive <batch> [reason] | recent [n] | report");
}

// ---------- Figma feed board ----------
// Figma cannot render the brand fonts in automated runs and limits exports on the current plan, so it holds the finished
// slides for review, arrangement and comments; the engine stays the renderer. Flow: manifest -> upload_assets(count) -> upload -> layout -> use_figma.
const FIGMA_CFG = join(REPO_ROOT, "social", "figma.json");
// FW_POST=03 limits manifest/upload to one post (re-publishing a corrected post); its nodes replace that post's entries in figma.json.
function figmaFiles(batch) {
  return postDirs(batch).filter((d) => !process.env.FW_POST || basename(d).startsWith(process.env.FW_POST)).flatMap((d) => (existsSync(join(d, "slides")) ? readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel-cover\.png$/.test(f)).sort().map((f) => ({ post: basename(d), slide: f.replace(".png", ""), file: join(d, "slides", f) })) : []));
}
function figmaCmd(sub, batchArg, urlsArg) {
  const batch = resolve(batchArg || die("usage: fw.mjs figma manifest|upload|layout <batch> [urls-file]")), name = basename(batch);
  const cfg = existsSync(FIGMA_CFG) ? readJson(FIGMA_CFG) : die(`${FIGMA_CFG} missing: run the Figma setup in SKILL.md`);
  const files = figmaFiles(batch);
  if (sub === "manifest") {
    console.log(JSON.stringify({ fileKey: cfg.fileKey, currentPageId: cfg.pageId, count: files.length, note: "call Figma upload_assets with this fileKey, currentPageId and count (max 60 per call); save the returned submitUrl values, one per line, to <batch>/.figma-urls.txt" }, null, 1));
  } else if (sub === "upload") {
    const urls = readFileSync(urlsArg ? resolve(urlsArg) : join(batch, ".figma-urls.txt"), "utf8").match(/https:\/\/\S+?\/submit\S*/g) || [];
    if (urls.length < files.length) die(`${urls.length} upload URLs for ${files.length} slides`);
    const nodes = files.map((f, i) => {
      const res = JSON.parse(execFileSync("curl", ["-fsS", "--max-time", "120", "-F", `file=@${f.file};type=image/png;filename=${name}--${f.post}--${f.slide}.png`, urls[i].replace(/[",]+$/, "")]).toString());
      if (!res.success) die(`upload failed for ${f.post}/${f.slide}: ${JSON.stringify(res)}`);
      return { post: f.post, slide: f.slide, nodeId: res.placedOnNodeId };
    });
    const prev = process.env.FW_POST && existsSync(join(batch, "figma.json")) ? readJson(join(batch, "figma.json")) : null;
    const merged = prev ? { ...prev, nodes: [...(prev.nodes || []).filter((n) => !nodes.some((m) => m.post === n.post)), ...nodes].sort((a, b) => (a.post + a.slide).localeCompare(b.post + b.slide)), replaced: (prev.nodes || []).filter((n) => nodes.some((m) => m.post === n.post)) } : { batch: name, fileKey: cfg.fileKey, nodes };
    writeFileSync(join(batch, "figma.json"), JSON.stringify(merged, null, 1));
    console.log(`ok   ${nodes.length} slides uploaded to ${cfg.url}`);
  } else if (sub === "layout") {
    const f = readJson(join(batch, "figma.json"));
    const posts = [...new Set(f.nodes.map((n) => n.post))];
    const covers = posts.map((p) => f.nodes.find((n) => n.post === p).nodeId);
    // One section per batch: the profile grid of covers (newest first) on the left, then one column of slides per post, each at 1080x1350.
    console.log(`// use_figma script for fileKey ${f.fileKey} (skillNames "resource:figma-use"). Returns the section id.
const page = await figma.getNodeByIdAsync(${JSON.stringify(cfg.pageId)}); await figma.setCurrentPageAsync(page);
await figma.loadFontAsync({ family: "Inter", style: "Semi Bold" });
// Re-publishing a batch replaces its earlier section in place.
const old = page.children.find((n) => n.type === "SECTION" && n.name === ${JSON.stringify("Batch " + name)}); const oldY = old ? old.y : null; if (old) old.remove();
const G = 60, W = 1080, H = 1350, posts = ${JSON.stringify(posts)}, nodes = ${JSON.stringify(f.nodes)}, covers = ${JSON.stringify(covers)};
const bottom = page.children.reduce((m, n) => Math.max(m, n.type === "SECTION" ? n.y + n.height : 0), 0);
const label = (t, x, y, size) => { const n = figma.createText(); n.fontName = { family: "Inter", style: "Semi Bold" }; n.characters = t; n.fontSize = size; n.x = x; n.y = y; return n; };
const sec = figma.createSection(); sec.name = ${JSON.stringify("Batch " + name)}; page.appendChild(sec);
const kids = [label(${JSON.stringify(name + " · profile preview (newest first)")}, G, G, 64)];
let y = G + 140;
for (const [i, id] of [...covers].reverse().entries()) { const src = await figma.getNodeByIdAsync(id); const c = src.clone(); c.name = "grid · " + src.name; if (c.height !== H) c.resize(W, H); /* reel covers: the grid shows their middle */ c.x = G + (i % 3) * (W + 12); c.y = y + Math.floor(i / 3) * (H + 12); kids.push(c); }
// Posts as columns to the right of the grid: label on top, slides stacked in order.
let x = G + 3 * (W + 12) + 300; const top = G + 140; let maxY = top + Math.ceil(covers.length / 3) * (H + 12);
for (const p of posts) {
  kids.push(label(p, x, top - 100, 48));
  let yy = top;
  for (const n of nodes.filter((n) => n.post === p)) { const node = await figma.getNodeByIdAsync(n.nodeId); node.x = x; node.y = yy; kids.push(node); yy += node.height + G; }
  maxY = Math.max(maxY, yy); x += W + 120;
}
y = maxY + G;
for (const k of kids) sec.appendChild(k);
const width = Math.max(...kids.map((k) => k.x + k.width)) + G;
sec.resizeWithoutConstraints(width, y); sec.x = 0; sec.y = oldY ?? bottom + 400;
return { sectionId: sec.id, posts: posts.length, slides: nodes.length };`);
  } else if (sub === "replace") {
    // After FW_POST=NN figma upload: swap that post's old slides (and its grid tile) in the batch section for the new uploads, matched by layer name.
    const post = process.env.FW_POST || die("set FW_POST=NN to name the post to replace");
    console.log(`// use_figma script for fileKey ${cfg.fileKey} (skillNames "resource:figma-use"): replace post ${post} in section "Batch ${name}".
const page = await figma.getNodeByIdAsync(${JSON.stringify(cfg.pageId)}); await figma.setCurrentPageAsync(page);
const sec = page.children.find((n) => n.type === "SECTION" && n.name === ${JSON.stringify("Batch " + name)});
if (!sec) throw new Error("batch section not found");
const key = (n) => n.name.replace(/[.]png$/, "").replace(/^grid · /, "");
const want = ${JSON.stringify(name + "--")};
const isPost = (n) => key(n).startsWith(want) && key(n).slice(want.length).startsWith(${JSON.stringify(post)});
const fresh = page.children.filter((n) => n.type !== "SECTION" && isPost(n));
const old = sec.children.filter((n) => isPost(n));
if (!fresh.length) throw new Error("no new uploads for this post on the page");
const swapped = [];
for (const n of fresh) {
  // The post's column sits right of the profile grid, so of two same-named nodes the left one is the grid tile.
  const same = old.filter((x) => !x.removed && key(x) === key(n)).sort((a, b) => a.x - b.x);
  const o = same[same.length - 1];
  if (!o) continue;
  const g = same.length > 1 ? same[0] : null;
  sec.appendChild(n); n.x = o.x; n.y = o.y; swapped.push([o.id, n.id]); o.remove();
  if (g && key(n).endsWith("--01")) { const c = n.clone(); c.name = "grid · " + n.name; sec.appendChild(c); c.x = g.x; c.y = g.y; swapped.push([g.id, c.id]); g.remove(); }
}
return { swapped, unmatched: fresh.filter((n) => !swapped.some((s) => s[1] === n.id)).map((n) => n.name) };`);
  } else die("usage: fw.mjs figma manifest|upload|layout|replace <batch> [urls-file]");
}

// ---------- capture: authentic, high-resolution screenshots of a live client website ----------
// desktop: 1440x900 viewport at 2x (2880px wide); mobile: 390x844 at 3x (1170px wide). "full" captures the whole page.
async function capture(url, out, mode = "desktop", full = "") {
  if (!url || !out) die("usage: fw.mjs capture <url> <out.jpg> [desktop|mobile] [full]");
  const mobile = mode === "mobile";
  mkdirSync(dirname(resolve(out)), { recursive: true });
  await withBrowser(async (b) => {
    const page = await b.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: mobile ? 3 : 2, isMobile: mobile, hasTouch: mobile });
    await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
    await page.waitForTimeout(2500); // let entrance animations settle
    if (full) { await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); }); await page.waitForTimeout(800); }
    await page.screenshot({ path: resolve(out), type: "jpeg", quality: 88, fullPage: !!full });
  });
  console.log(`ok   ${out}`);
}

// ---------- main ----------
const [cmd, rawArg, rawArg2, rawArg3] = process.argv.slice(2);
const arg = rawArg && rawArg !== "--force" && !["history", "figma", "capture"].includes(cmd) ? resolve(rawArg) : rawArg; // absolute: the renderer loads pages by file:// URL
const need = () => arg || die(`usage: fw.mjs ${cmd} <path>`);
const run = { fonts: () => fonts({ force: arg === "--force" }), validate: () => validate(need()), render: () => render(need()), reel: () => reel(need()), sheet: () => sheet(need()), grid: () => grid(need()), check: () => check(need()), package: () => pkg(need()), history: () => historyCmd(rawArg, rawArg2), capture: () => capture(rawArg, rawArg2, rawArg3, process.argv[6]), figma: () => figmaCmd(rawArg, rawArg2, rawArg3) }[cmd];
if (!run) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 13).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
await run();
