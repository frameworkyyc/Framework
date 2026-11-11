#!/usr/bin/env node
// Framework social engine: deterministic typography, layout, export and checks. No AI calls and no credits are spent here.
//   node social/engine/fw.mjs fonts                      fetch Switzer + General Sans from Fontshare into a local cache (once per machine)
//   node social/engine/fw.mjs validate <batch>           check briefs.json (the strategist's handoff)
//   node social/engine/fw.mjs render <post-dir|batch>    spec.json -> slides/NN.png (1080x1350 default); fails on overflow or missing images
//   node social/engine/fw.mjs reel <post-dir>            clip + reel overlay -> slides/reel.mp4 + slides/reel-cover.png (ffmpeg)
//   node social/engine/fw.mjs sheet <batch>              one contact-sheet PNG of every slide, for review at low token cost
//   node social/engine/fw.mjs check <batch>              completeness, dimensions, caption and brand-voice lint
//   node social/engine/fw.mjs grid <batch>               Instagram profile preview (3:4 grid crops, newest first, after published history) + feed checks
//   node social/engine/fw.mjs package <batch>            export/ folder + zip of finished posts with captions alongside
//   node social/engine/fw.mjs capture <url> <out.jpg> [desktop|mobile] [full]   authentic client-site screenshot at 2x/3x for mockups
//   node social/engine/fw.mjs history add <batch> | recent [n] | report    content history (social/history/posts.csv) and performance summary
//   node social/engine/fw.mjs figma manifest|upload|layout <batch> [urls]  push finished slides to the Figma feed board (see SKILL.md)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
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
  const lineCount = (h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
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
  for (const t of document.querySelectorAll(".layer.ct:not([data-bleed])")) {
    const r = t.getBoundingClientRect();
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) out.errors.push(`text runs off the canvas: "${t.textContent.trim().slice(0, 40)}" (set bleed: true if intended)`);
  }
  // Branding audit for fw check: every brand element and every piece of text naming Framework or its URL, with its position.
  const rect = (r) => ({ x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
  out.brand = [...document.querySelectorAll("[data-brand]")].map((e) => ({ kind: e.dataset.brand, ...rect(e.getBoundingClientRect()) }));
  out.marks = [...document.querySelectorAll("svg")].filter((e) => !e.closest("[data-brand]")).map((e) => ({ kind: "svg", ...rect(e.getBoundingClientRect()) }));
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

async function renderPost(browser, postDir) {
  const specPath = join(postDir, "spec.json");
  if (!existsSync(specPath)) throw new Error(`${postDir}: no spec.json`);
  const spec = readJson(specPath);
  const { w, h } = sizeOf(spec);
  const slides = (spec.slides || []).filter((s) => spec.format === "reel" || s.template !== "reel");
  if (!slides.length) throw new Error(`${postDir}: spec has no slides`);
  const outDir = join(postDir, "slides"), build = join(postDir, ".build");
  rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true }); mkdirSync(build, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const report = [];
  for (const [i, s] of slides.entries()) {
    if (!TEMPLATES.includes(s.template)) throw new Error(`${postDir} slide ${i + 1}: unknown template "${s.template}"`);
    if ("footer" in s) throw new Error(`${postDir} slide ${i + 1}: "footer" no longer exists (no branded footers); put a citation in "source"`);
    if (s.image && !existsSync(resolveAsset(s.image, postDir))) throw new Error(`${postDir} slide ${i + 1}: image not found: ${s.image}`);
    const n = i + 1, total = slides.length;
    const fontFaces = (spec.fonts || []).map((f) => `@font-face{font-family:"${f.family}";src:url("${pathToFileURL(resolveAsset(f.src, postDir)).href}");font-weight:${f.weight || 400}}`).join("");
    const ctx = { fontFaces, n, total, isLast: n === total || spec.format !== "carousel", counter: spec.format === "carousel" ? `${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "", w, h, postDir: resolve(postDir), fontsCss: FONTS_CSS, slideCss: SLIDE_CSS };
    const html = join(build, `slide-${String(n).padStart(2, "0")}.html`);
    writeFileSync(html, slideHtml(s, ctx));
    await page.goto("file://" + html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const r = await page.evaluate(FIT_SCRIPT);
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
  const posts = postDirs(batch).map((d) => ({ d, files: existsSync(join(d, "slides")) ? readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel-cover\.png$/.test(f)).sort() : [] }));
  const rows = posts.map(({ d, files }) => `<section><h2>${basename(d)}</h2><div class="row">${files.map((f) => `<figure><img src="file://${resolve(d, "slides", f)}"><figcaption>${f}</figcaption></figure>`).join("") || "<p>NOT RENDERED</p>"}</div></section>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:24px;background:#F5F5F5;font:13px/1.3 sans-serif;width:1832px}section{margin-bottom:20px}h2{font-size:15px;margin:0 0 8px}.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0}img{width:216px;display:block;border:1px solid #E0E0E0;background:#fff}figcaption{color:#5C5C5C;padding-top:3px}p{color:#c00;font-weight:600}</style>${rows}`;
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
const FORMATS = ["single", "carousel", "reel"];
const CTA_TYPES = ["save", "engage", "explore", "credibility", "lead", "none"];
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
    if (post.needs_confirmation) warns.push(`${at}: needs owner confirmation: ${post.needs_confirmation}`);
    if (!post.concept) warns.push(`${at}: no "concept" (the visual idea; see art-direction.md)`);
    for (const [k, sl] of (post.slides || []).entries()) for (const [re, alt] of JARGON) { const m = slideText(sl).match(re); if (m) warns.push(`${at} slide ${k + 1}: specialist term "${m[0]}" planned on a slide: ${alt}`); }
    const slides = post.slides || [];
    if (post.format === "carousel" && (slides.length < 3 || slides.length > 10)) errs.push(`${at}: carousels need 3-10 slides`);
    if (post.format === "single" && slides.length !== 1) errs.push(`${at}: single posts have exactly 1 slide`);
    for (const [i, s] of slides.entries()) {
      if (!TEMPLATES.includes(s.template)) errs.push(`${at} slide ${i + 1}: unknown template "${s.template}"`);
      const v = s.visual || {};
      if (v.source === "higgsfield") {
        gens += 1; credits += Number(v.est_credits || 0);
        if (!v.prompt || v.prompt.length < 80) errs.push(`${at} slide ${i + 1}: higgsfield visual needs a full prompt`);
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
  const cats = new Set(b.posts.map((p) => p.visual_category));
  if (n >= 6 && cats.size < 4) warns.push(`only ${cats.size} visual categories across ${n} posts: aim for 4 or more`);
  for (const c of cats) if (n >= 5 && count("visual_category", c) / n > 0.4) warns.push(`${c} is over 40% of the batch`);
  console.log(`posts ${n} · goals ${JSON.stringify(mix)} · categories ${cats.size} · higgsfield generations ${gens}${credits ? ` (~${credits} credits est.)` : ""}`);
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
const BRAND_HEX = ["#0a0a0a", "#ffffff", "#5c5c5c", "#a3a3a3", "#e0e0e0", "#f5f5f5", "#fff", "#000000"];
function creativeIssues(d, spec, w, h) {
  const out = [], say = (lvl, m) => out.push([lvl, m]);
  spec.slides.forEach((s, i) => {
    const at = `slide ${i + 1}`, text = slideText(s);
    for (const [re, alt] of JARGON) { const m = text.match(re); if (m && !s.plainLanguageOk) say("FAIL", `${at}: specialist term "${m[0]}" on the slide: ${alt}; put the technical detail and source in the caption`); }
    const words = text.split(/\s+/).filter((x) => /\w/.test(x)).length;
    if (words > 45) say("FAIL", `${at}: ${words} words on one slide (45 max; let the image or a second slide carry it)`);
    else if (words > 32) say("WARN", `${at}: ${words} words: a slide should read in a few seconds`);
    const hexes = JSON.stringify(s).match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) || [];
    const off = [...new Set(hexes.map((x) => x.toLowerCase()))].filter((x) => !BRAND_HEX.includes(x));
    if (off.length && !s.clientColour) say("FAIL", `${at}: colours ${off.join(", ")} outside Framework's palette without "clientColour" (colour belongs to client work, photography or concept art)`);
  });
  const withEyebrow = spec.slides.filter((s) => s.eyebrow).length;
  if (spec.slides.length >= 3 && withEyebrow / spec.slides.length > 0.5) say("WARN", `${withEyebrow} of ${spec.slides.length} slides carry an eyebrow label: use labels only where they help`);
  if (spec.slides.filter((s) => s.header).length > 1) say("WARN", "ruled headers on several slides read as template furniture");
  // Mostly-empty canvas: a slide that is almost all background with no image reads as an unfinished template.
  const pngs = spec.slides.map((s, i) => ({ s, f: join(d, "slides", `${String(i + 1).padStart(2, "0")}.png`) })).filter(({ s, f }) => existsSync(f) && !isImagery(s) && s.template !== "minimal" && !s.intentionalSpace);
  if (pngs.length) {
    const py = "import sys,json\nfrom PIL import Image\nout=[]\nfor p in sys.argv[1:]:\n  im=Image.open(p).convert('L').resize((108,135)); px=list(im.get_flattened_data() if hasattr(im,'get_flattened_data') else im.getdata()); bg=max(set(px),key=px.count); out.append(sum(1 for v in px if abs(v-bg)<=6)/len(px))\nprint(json.dumps(out))";
    const fr = JSON.parse(execFileSync("python3", ["-I", "-c", py, ...pngs.map((p) => p.f)]).toString());
    fr.forEach((v, k) => { if (v > 0.9) say("WARN", `slide ${spec.slides.indexOf(pngs[k].s) + 1}: ${Math.round(v * 100)}% empty background: use the canvas (scale, image, composition) or set intentionalSpace with a reason`); });
  }
  return out;
}
function check(batch) {
  let fail = 0, warn = 0;
  const say = (lvl, m) => { console.log(`${lvl} ${m}`); lvl === "FAIL" ? fail++ : lvl === "WARN" ? warn++ : 0; };
  const briefs = existsSync(join(batch, "briefs.json")) ? readJson(join(batch, "briefs.json")) : null;
  const dirs = postDirs(batch);
  if (briefs && dirs.length !== briefs.posts.length) say("FAIL", `briefs has ${briefs.posts.length} posts, posts/ has ${dirs.length}`);
  for (const d of dirs) {
    const id = basename(d);
    if (!existsSync(join(d, "spec.json"))) { say("FAIL", `${id}: no spec.json`); continue; }
    const spec = readJson(join(d, "spec.json")), { w, h } = sizeOf(spec);
    const pngs = existsSync(join(d, "slides")) ? readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$/.test(f)) : [];
    if (spec.format === "reel") { if (!existsSync(join(d, "slides", "reel.mp4"))) say("FAIL", `${id}: reel.mp4 not composed`); }
    else if (pngs.length !== spec.slides.length) say("FAIL", `${id}: ${pngs.length} PNGs for ${spec.slides.length} slides (run render)`);
    for (const f of pngs) { const s = pngSize(join(d, "slides", f)); if (s.w !== w || s.h !== h) say("FAIL", `${id}/${f}: ${s.w}x${s.h}, expected ${w}x${h}`); }
    if (spec.slides.some((s) => s.image && /^https?:/.test(s.image))) say("FAIL", `${id}: remote image URL in spec (download it into images/ first)`);
    for (const m of brandingIssues(d, spec, w, h)) say("FAIL", `${id}: ${m}`);
    for (const [lvl, m] of creativeIssues(d, spec, w, h)) say(lvl, `${id}: ${m}`);
    for (const [file, platform] of [["caption-instagram.txt", "instagram"], ["caption-facebook.txt", "facebook"], ["alt-text.txt", "alt"]]) {
      const p = join(d, file);
      if (!existsSync(p)) { say("FAIL", `${id}: missing ${file}`); continue; }
      if (platform === "alt") { if (!readFileSync(p, "utf8").trim()) say("FAIL", `${id}: empty alt-text.txt`); continue; }
      for (const i of lintCaption(readFileSync(p, "utf8"), platform)) say(/placeholder|empty|exclamation|emoji|avoided|2,200/.test(i) ? "FAIL" : "WARN", `${id}/${file}: ${i}`);
    }
  }
  console.log(`check: ${dirs.length} posts, ${fail} fail, ${warn} warn`);
  if (fail) process.exit(1);
}

// ---------- package ----------
function pkg(batch) {
  check(batch);
  const name = basename(resolve(batch)), out = join(batch, "export", name);
  rmSync(join(batch, "export"), { recursive: true, force: true }); mkdirSync(out, { recursive: true });
  const briefs = existsSync(join(batch, "briefs.json")) ? readJson(join(batch, "briefs.json")) : { posts: [] };
  let index = `# ${name}\n\nFinished posts. Each folder: slides in posting order, the Instagram and Facebook captions, and alt text.\n\n| # | Post | Goal | Category | Format | Slides |\n|---|---|---|---|---|---|\n`;
  for (const d of postDirs(batch)) {
    const id = basename(d), dest = join(out, id); mkdirSync(dest);
    const files = readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel\.mp4$|^reel-cover\.png$/.test(f));
    files.forEach((f) => copyFileSync(join(d, "slides", f), join(dest, /^\d+\.png$/.test(f) ? `${id}-${f}` : f)));
    ["caption-instagram.txt", "caption-facebook.txt", "alt-text.txt"].forEach((f) => copyFileSync(join(d, f), join(dest, f)));
    const b = briefs.posts.find((p) => id.startsWith(String(p.id).padStart(2, "0"))) || {};
    index += `| ${b.id ?? ""} | ${id} | ${b.goal ?? ""} | ${b.visual_category ?? ""} | ${b.format ?? ""} | ${files.filter((f) => f.endsWith(".png")).length} |\n`;
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

/** Mean luminance (0-255) and contrast of each image, measured on a small greyscale copy. */
function imageStats(paths) {
  if (!paths.length) return [];
  const py = "import sys,json\nfrom PIL import Image, ImageStat\nout=[]\nfor p in sys.argv[1:]:\n  im=Image.open(p).convert('L'); im.thumbnail((108,135)); st=ImageStat.Stat(im); out.append({'mean':round(st.mean[0],1),'std':round(st.stddev[0],1)})\nprint(json.dumps(out))";
  return JSON.parse(execFileSync("python3", ["-I", "-c", py, ...paths]).toString());
}
const toneOf = (mean) => (mean < 100 ? "dark" : mean > 170 ? "light" : "mid");

/** The batch's posts in publishing order (id order), with their cover file and feed attributes. */
function batchCovers(batch) {
  const posts = postDirs(batch).map((d) => {
    const spec = readJson(join(d, "spec.json")), s0 = spec.slides[0] || {};
    const cover = ["01.png", "reel-cover.png"].map((f) => join(d, "slides", f)).find(existsSync);
    const head = String([s0.giant, s0.headline || s0.quote, s0.headline2].filter(Boolean).join(" ")).replace(/\{\{|\}\}|\*\*/g, "").replace(/\s*\n\s*/g, " ").trim();
    return { id: basename(d), dir: d, cover, family: familyOf(s0), category: categoryOf(s0), imagery: isImagery(s0), format: spec.format, headline: head };
  });
  const stats = imageStats(posts.filter((p) => p.cover).map((p) => p.cover));
  let k = 0;
  for (const p of posts) if (p.cover) { Object.assign(p, stats[k++]); p.tone = toneOf(p.mean); }
  return posts;
}

async function grid(batch) {
  const name = basename(resolve(batch));
  const posts = batchCovers(batch);
  const missing = posts.filter((p) => !p.cover);
  if (missing.length) die(`not rendered yet: ${missing.map((p) => p.id).join(", ")}`);
  const past = readHistory().filter((r) => r.batch !== name && r.cover && existsSync(join(HISTORY_DIR, r.cover))).map((r) => ({ id: `${r.batch} ${r.id}`, cover: join(HISTORY_DIR, r.cover), family: r.family, category: r.category, tone: r.tone, past: true }));
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
  for (let r = 0; r * 3 < Math.min(profile.length, 12); r++) {
    const row = profile.slice(r * 3, r * 3 + 3);
    if (row.length === 3 && row.some((p) => !p.past) && row.every((p) => p.tone === row[0].tone)) say("WARN", `grid row ${r + 1} is all ${row[0].tone}: alternate light and dark`);
  }
  const n = posts.length, share = (f) => posts.filter(f).length / n;
  const dark = share((p) => p.tone === "dark"), light = share((p) => p.tone === "light"), imagery = share((p) => p.imagery);
  if (n >= 6 && (dark < 0.2 || dark > 0.6)) say("WARN", `${Math.round(dark * 100)}% of covers are dark: aim for 20-60%`);
  if (n >= 6 && light > 0.7) say("WARN", `${Math.round(light * 100)}% of covers are light: add dark or mid-tone covers`);
  if (n >= 6 && (imagery < 0.3 || imagery > 0.7)) say("WARN", `${Math.round(imagery * 100)}% of covers are photography or artwork: aim for 30-70% against typography and graphics`);
  const fams = {}; posts.forEach((p) => (fams[p.family] = (fams[p.family] || 0) + 1));
  for (const [f, c] of Object.entries(fams)) if (c > 2) say("WARN", `layout family ${f} is used for ${c} covers: develop another composition`);
  if (n !== 9) say("WARN", `${n} posts: a batch should fill exactly one 3x3 grid block (9 posts)`);
  const cats = new Set(posts.map((p) => p.category));
  if (n >= 6 && cats.size < 4) say("WARN", `only ${cats.size} visual categories on the covers`);
  for (let i = 1; i < n; i++) if (posts[i].family === posts[i - 1].family) say("FAIL", `${posts[i - 1].id} and ${posts[i].id} publish back to back with the same layout family`);

  // Preview: realistic profile grid (3 columns, 3:4 tiles cropped from 4:5 like Instagram's profile view) + publishing-order strip.
  const tile = (p, i) => `<div class="t${p.past ? " past" : ""}"><img src="file://${p.cover}"><span class="n">${p.past ? "" : p.id.slice(0, 2)}</span></div>${i === 8 ? '<div class="fold">first screen: the newest nine</div>' : ""}`;
  const strip = posts.map((p) => `<figure><img src="file://${p.cover}"><figcaption><b>${p.id}</b><br>${p.family}<br>${p.category}<br>${p.tone}${p.imagery ? " · image" : " · type"}</figcaption></figure>`).join("");
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
  const md = `# Grid report: ${name}\n\n| Order | Post | Family | Category | Tone | Imagery |\n|---|---|---|---|---|---|\n${posts.map((p, i) => `| ${i + 1} | ${p.id} | ${p.family} | ${p.category} | ${p.tone} (${p.mean}) | ${p.imagery ? "yes" : "no"} |`).join("\n")}\n\nDark ${Math.round(dark * 100)}% · light ${Math.round(light * 100)}% · imagery ${Math.round(imagery * 100)}% · categories ${cats.size} · history tiles ${past.length}\n\n${issues.map((x) => `- ${x.lvl} ${x.m}`).join("\n") || "- No feed issues found."}\n`;
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
      const row = { ...(prev || {}), date_produced: prev?.date_produced || today, batch: name, id: p.id, slug: b.slug || p.id.slice(3), goal: b.goal || "", category: b.visual_category || p.category, family: p.family, tone: p.tone || "", format: p.format, topic: b.key_message || "", headline: p.headline, cta_type: b.cta_type || "", cover: p.cover ? cover : "" };
      if (prev) Object.assign(prev, row); else rows.push(row);
    }
    writeHistory(rows);
    console.log(`ok   ${posts.length} posts recorded in ${HISTORY_CSV}`);
  } else if (sub === "recent") {
    const n = Number(arg2 || 20);
    for (const r of rows.slice(-n)) console.log([r.date_published || "unpublished", r.batch, r.id, r.goal, r.category, r.family, r.tone, r.cta_type, r.headline].join(" | "));
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
  } else die("usage: fw.mjs history add <batch> | recent [n] | report");
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
for (const [i, id] of [...covers].reverse().entries()) { const src = await figma.getNodeByIdAsync(id); const c = src.clone(); c.name = "grid · " + src.name; c.x = G + (i % 3) * (W + 12); c.y = y + Math.floor(i / 3) * (H + 12); kids.push(c); }
// Posts as columns to the right of the grid: label on top, slides stacked in order.
let x = G + 3 * (W + 12) + 300; const top = G + 140; let maxY = top + Math.ceil(covers.length / 3) * (H + 12);
for (const p of posts) {
  kids.push(label(p, x, top - 100, 48));
  let yy = top;
  for (const n of nodes.filter((n) => n.post === p)) { const node = await figma.getNodeByIdAsync(n.nodeId); node.x = x; node.y = yy; kids.push(node); yy += H + G; }
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
