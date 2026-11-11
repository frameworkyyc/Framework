#!/usr/bin/env node
// Framework social engine: deterministic typography, layout, export and checks. No AI calls and no credits are spent here.
//   node social/engine/fw.mjs fonts                      fetch Switzer + General Sans from Fontshare into a local cache (once per machine)
//   node social/engine/fw.mjs validate <batch>           check briefs.json (the strategist's handoff)
//   node social/engine/fw.mjs render <post-dir|batch>    spec.json -> slides/NN.png (1080x1350 default); fails on overflow or missing images
//   node social/engine/fw.mjs reel <post-dir>            clip + reel overlay -> slides/reel.mp4 + slides/reel-cover.png (ffmpeg)
//   node social/engine/fw.mjs sheet <batch>              one contact-sheet PNG of every slide, for review at low token cost
//   node social/engine/fw.mjs check <batch>              completeness, dimensions, caption and brand-voice lint
//   node social/engine/fw.mjs package <batch>            export/ folder + zip of finished posts with captions alongside
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { slideHtml, resolveAsset, TEMPLATES, REPO_ROOT } from "./templates.mjs";

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
  const out = { warnings: [], errors: [] };
  const box = document.querySelector("[data-fit-box]");
  const fits = [...document.querySelectorAll("[data-fit]")];
  const base = fits.map((e) => parseFloat(getComputedStyle(e).fontSize));
  const maxH = box && box.dataset.maxH ? Number(box.dataset.maxH) : null;
  const heads = [...document.querySelectorAll(".h1,.h2")];
  const lineCount = (h) => Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
  const wraps = () => heads.some((h) => lineCount(h) > h.textContent.split("\n").length); // a headline breaking where the writer did not intend
  const over = () => !!box && ((maxH ? box.offsetHeight > maxH : box.scrollHeight > box.clientHeight + 1) || fits.some((e) => e.scrollWidth > e.clientWidth + 1) || wraps());
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
    if (s.image && !existsSync(resolveAsset(s.image, postDir))) throw new Error(`${postDir} slide ${i + 1}: image not found: ${s.image}`);
    const n = i + 1, total = slides.length;
    const ctx = { n, total, isLast: n === total || spec.format !== "carousel", counter: spec.format === "carousel" ? `${String(n).padStart(2, "0")} / ${String(total).padStart(2, "0")}` : "", w, h, postDir: resolve(postDir), fontsCss: FONTS_CSS, slideCss: SLIDE_CSS };
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
const PILLARS = ["educational", "promotional", "portfolio", "brand"];
const FORMATS = ["single", "carousel", "reel"];
function validate(batch) {
  const p = join(batch, "briefs.json");
  if (!existsSync(p)) die(`${p} not found`);
  const b = readJson(p), errs = [], warns = [];
  if (!Array.isArray(b.posts) || !b.posts.length) die("briefs.json has no posts[]");
  const ids = new Set();
  let gens = 0, credits = 0;
  for (const post of b.posts) {
    const at = `post ${post.id ?? "?"}`;
    for (const k of ["id", "slug", "pillar", "format", "objective", "audience", "key_message", "cta", "slides"]) if (post[k] == null || post[k] === "") errs.push(`${at}: missing ${k}`);
    if (ids.has(post.id)) errs.push(`${at}: duplicate id`); ids.add(post.id);
    if (post.slug && !/^[a-z0-9-]+$/.test(post.slug)) errs.push(`${at}: slug must be lowercase-kebab`);
    if (!PILLARS.includes(post.pillar)) errs.push(`${at}: pillar must be one of ${PILLARS.join("/")}`);
    if (!FORMATS.includes(post.format)) errs.push(`${at}: format must be one of ${FORMATS.join("/")}`);
    if (post.needs_confirmation) warns.push(`${at}: needs owner confirmation: ${post.needs_confirmation}`);
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
  const mix = Object.fromEntries(PILLARS.map((k) => [k, b.posts.filter((p) => p.pillar === k).length]));
  if (b.posts.length >= 6 && Object.values(mix).some((n) => n === 0)) warns.push(`pillar mix is unbalanced: ${JSON.stringify(mix)}`);
  console.log(`posts ${b.posts.length} · mix ${JSON.stringify(mix)} · higgsfield generations ${gens}${credits ? ` (~${credits} credits est.)` : ""}`);
  warns.forEach((w) => console.log("WARN " + w));
  errs.forEach((e) => console.log("FAIL " + e));
  if (errs.length) process.exit(1);
  console.log("ok   briefs.json is a valid handoff");
}

// ---------- batch check ----------
const BANNED = ["disrupt", "game-changing", "game changer", "synergy", "world-class", "best-in-class", "unlock your", "next level", "passion", "hustle", "the ultimate", "the best ", "revolutionary", "cutting-edge", "elevate your", "supercharge", "skyrocket"];
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
  if (platform === "instagram") { if (text.length > 2200) issues.push(`over 2,200 characters (${text.length})`); if (tags.length > 8) issues.push(`${tags.length} hashtags (keep to 3-8)`); if (text.split("\n")[0].length > 150) issues.push("first line over 150 characters: the hook gets truncated"); }
  if (platform === "facebook" && tags.length > 3) issues.push(`${tags.length} hashtags on Facebook (keep 0-3)`);
  return issues;
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
  let index = `# ${name}\n\nFinished posts. Each folder: slides in posting order, the Instagram and Facebook captions, and alt text.\n\n| # | Post | Pillar | Format | Slides |\n|---|---|---|---|---|\n`;
  for (const d of postDirs(batch)) {
    const id = basename(d), dest = join(out, id); mkdirSync(dest);
    const files = readdirSync(join(d, "slides")).filter((f) => /^\d+\.png$|^reel\.mp4$|^reel-cover\.png$/.test(f));
    files.forEach((f) => copyFileSync(join(d, "slides", f), join(dest, /^\d+\.png$/.test(f) ? `${id}-${f}` : f)));
    ["caption-instagram.txt", "caption-facebook.txt", "alt-text.txt"].forEach((f) => copyFileSync(join(d, f), join(dest, f)));
    const b = briefs.posts.find((p) => id.startsWith(String(p.id).padStart(2, "0"))) || {};
    index += `| ${b.id ?? ""} | ${id} | ${b.pillar ?? ""} | ${b.format ?? ""} | ${files.filter((f) => f.endsWith(".png")).length} |\n`;
  }
  writeFileSync(join(out, "README.md"), index);
  const zip = join(batch, "export", `${name}.zip`);
  execFileSync("python3", ["-I", "-m", "zipfile", "-c", zip, out]);
  console.log(`ok   ${out}\nok   ${zip}`);
}

// ---------- main ----------
const [cmd, rawArg] = process.argv.slice(2);
const arg = rawArg && rawArg !== "--force" ? resolve(rawArg) : rawArg; // absolute: the renderer loads pages by file:// URL
const need = () => arg || die(`usage: fw.mjs ${cmd} <path>`);
const run = { fonts: () => fonts({ force: arg === "--force" }), validate: () => validate(need()), render: () => render(need()), reel: () => reel(need()), sheet: () => sheet(need()), check: () => check(need()), package: () => pkg(need()) }[cmd];
if (!run) { console.log(readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(1, 10).map((l) => l.replace(/^\/\/ ?/, "")).join("\n")); process.exit(cmd ? 1 : 0); }
await run();
