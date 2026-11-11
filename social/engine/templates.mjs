// Slide templates: spec fields in, one self-contained HTML document out. Layout lives in slide.css; this file only places content.
// Text markup allowed in any text field: "\n" = deliberate line break, {{text}} = muted (slate on paper, stone on ink), **text** = semibold.
import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";

export const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
export const TEMPLATES = ["canvas", "cover", "type", "minimal", "photo", "plate", "split", "showcase", "diagram", "statement", "point", "list", "compare", "quote", "cta", "reel"];

// Visual categories (feed art direction) and the default category of each layout family. A spec may override with "category".
export const CATEGORIES = ["editorial-typography", "architectural-photography", "portfolio", "conceptual-artwork", "educational-graphic", "minimalist"];
/** Layout family of a slide, e.g. "type:giant", "photo:caption", "plate". Used to keep neighbouring posts from repeating. */
export const familyOf = (s) => s.template + (s.layout ? ":" + s.layout : "");
export function categoryOf(s) {
  if (s.category) return s.category;
  const t = s.template;
  if (t === "canvas") {
    const kinds = (s.layers || []).map((l) => l.type);
    if (kinds.some((k) => ["laptop", "phone", "browser", "swatch"].includes(k))) return "portfolio";
    if (kinds.includes("image")) return "architectural-photography";
    return "editorial-typography";
  }
  if (t === "minimal") return "minimalist";
  if (t === "showcase") return "portfolio";
  if (["diagram", "list", "compare", "point"].includes(t)) return "educational-graphic";
  if (["photo", "plate", "split", "reel"].includes(t) || (t === "cover" && s.image)) return "architectural-photography";
  return "editorial-typography";
}
/** Whether a slide's dominant visual is a photograph or artwork (vs. type and graphics). */
export const isImagery = (s) => ["photo", "plate", "split", "showcase", "reel"].includes(s.template) || (s.template === "cover" && !!s.image) ||
  (s.template === "canvas" && (s.layers || []).some((l) => ["image", "laptop", "phone", "browser"].includes(l.type)));

const MARK = (sq, f) =>
  `<svg viewBox="0 0 1092 1092" aria-hidden="true"><rect width="1092" height="1092" fill="${sq}"/><path fill="${f}" d="M302 245H815V347H411V741L302 851Z"/><path fill="${f}" d="M435 517L512 440H815V545H534V842H435Z"/></svg>`;
const markFor = (theme) => (theme === "ink" ? MARK("#FFFFFF", "#0A0A0A") : MARK("#0A0A0A", "#FFFFFF"));

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Typographer's quotes and apostrophes, so copy never ships with straight ' or ".
const smart = (s) => String(s ?? "").replace(/(^|[\s(\[{—–-])"/g, "$1\u201C").replace(/"/g, "\u201D").replace(/(^|[\s(\[{—–-])'/g, "$1\u2018").replace(/'/g, "\u2019");
export function md(s) {
  return esc(smart(s)).replace(/\{\{(.+?)\}\}/gs, '<span class="muted">$1</span>').replace(/\*\*(.+?)\*\*/gs, "<strong>$1</strong>");
}

/** "@site/assets/img/x.jpg" = repository root; other relative paths = the post folder. */
export function resolveAsset(p, postDir) {
  if (!p) return null;
  if (p.startsWith("@site/")) return resolve(REPO_ROOT, p.slice(6));
  return isAbsolute(p) ? p : resolve(postDir, p);
}
const fileUrl = (p) => pathToFileURL(p).href;

// Photos are black and white by default. Colour ("none" or "muted") is the deliberate exception for client work, photography
// and conceptual artwork when it improves the composition (brand-system.md, social exception). Never for type, graphics or the logo.
const treatment = (s, def = "mono") => { const t = s.imageTreatment || def; return t === "none" ? "" : t === "muted" ? "muted-photo" : "mono"; };
function photo(s, postDir, { cls = "", height, def } = {}) {
  const src = resolveAsset(s.image, postDir);
  if (!src) return "";
  const treat = treatment(s, def);
  const style = [`--fit:${s.imageFit === "contain" ? "contain" : "cover"}`, `--focus:${esc(s.imageFocus || "50% 50%")}`, height ? `height:${height}px` : ""].filter(Boolean).join(";");
  return `<figure class="photo ${treat} ${cls}" style="${style}"><img src="${fileUrl(src)}" alt=""></figure>`;
}

// No automatic slide furniture: no counter (Instagram shows its own), no header rule unless a slide asks for it (header: true),
// and an eyebrow label only where the slide sets one.
function chromeTop(s) {
  if (s.header) return `<header class="top"><span class="eyebrow">${s.eyebrow ? "— " + md(s.eyebrow) : ""}</span></header>`;
  return s.eyebrow ? `<header class="top plain"><span class="eyebrow">— ${md(s.eyebrow)}</span></header>` : "";
}
// No automatic branding. The Framework mark, wordmark or URL never appear as a footer, corner stamp or watermark.
// Branding is an intentional creative element: a slide opts in with brand: { element: "mark" | "lockup", reason: "why it belongs to the concept" },
// rendered large (160px minimum) inside the composition, never in a corner. A brand without a reason is refused.
function brandBlock(s, ctx) {
  if (!s.brand) return "";
  const b = s.brand;
  if (!b.reason || String(b.reason).trim().length < 12) throw new Error('brand needs a "reason" explaining why it belongs to this concept (no automatic logos)');
  const kind = b.element === "lockup" ? "lockup" : "mark", size = Math.max(Number(b.size) || 200, 160);
  const inner = kind === "lockup" ? `${markFor(ctx.theme)}<span class="wordmark">Framework</span>` : markFor(ctx.theme);
  return `<div class="brand-${kind}" data-brand="${kind}" style="--bs:${size}px">${inner}</div>`;
}
/** Citation for a fact on the slide (content, not branding). */
const sourceNote = (s) => (s.source ? `<p class="src-note">${md("Source: " + s.source)}</p>` : "");
const fs = (px) => `style="--fs:${px}px"`;
const headline = (s, def, cls = "h1") => (s.headline ? `<h1 class="${cls}" data-fit ${fs(s.headlineSize || def)}>${md(s.headline)}</h1>` : "");
const support = (s, def = 34) => (s.support ? `<p class="support" data-fit ${fs(s.supportSize || def)}>${md(s.support)}</p>` : "");


// ---------- canvas: free, art-directed composition (TEMPLATES.md, "canvas") ----------
// Layers are placed in canvas pixels (x, y, w, h; numbers or "50%"), may bleed off the edge and overlap (later layers on top).
const px = (v) => (v == null ? "" : typeof v === "number" ? `${v}px` : esc(v));
const pos = (l) => [`left:${px(l.x ?? 0)}`, `top:${px(l.y ?? 0)}`, l.w != null ? `width:${px(l.w)}` : "", l.h != null ? `height:${px(l.h)}` : "", l.rotate ? `transform:rotate(${Number(l.rotate)}deg)` : "", l.opacity != null ? `opacity:${Number(l.opacity)}` : "", l.z != null ? `z-index:${Number(l.z)}` : ""].filter(Boolean).join(";");
const FONTS = { display: "'Switzer'", body: "'General Sans'" };
const MASKS = { circle: "mask-circle", arch: "mask-arch", none: "" };
const cssColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(c || "") ? c : null);
import { readFileSync as readFile } from "node:fs";
const LAYERS = {
  image(l, ctx) {
    const src = resolveAsset(l.src, ctx.postDir);
    // crop: zoom into part of the source ({x, y, w, h} as fractions 0-1) for close-up details.
    const c = l.crop, crop = c ? `width:${100 / c.w}%;height:${100 / c.h}%;left:${(-c.x / c.w) * 100}%;top:${(-c.y / c.h) * 100}%;position:absolute;object-fit:cover` : "";
    const treat = l.treatment === "mono" ? "mono" : l.treatment === "muted" ? "muted-photo" : "";
    return `<div class="layer img ${treat} ${MASKS[l.mask] || ""}" style="${pos(l)};--fit:${l.fit === "contain" ? "contain" : "cover"};--focus:${esc(l.focus || "50% 50%")}"><img src="${src ? fileUrl(src) : ""}" alt="" style="${crop}"></div>`;
  },
  // Real device frames from the website (assets/img/device-*.png); the screenshot sits in the screen opening. scroll: 0-1 down a tall capture.
  laptop: (l, ctx) => device("laptop", l, ctx),
  phone: (l, ctx) => device("phone", l, ctx),
  browser(l, ctx) {
    const src = resolveAsset(l.src, ctx.postDir);
    return `<div class="layer browser${l.shadow ? " shadow" : ""}" style="${pos(l)}"><div class="bar"><i></i><i></i><i></i><span>${md(l.url || "")}</span></div><div class="page"><img src="${src ? fileUrl(src) : ""}" alt="" style="object-position:50% ${Math.round((l.scroll || 0) * 100)}%"></div></div>`;
  },
  text(l) {
    const display = (l.font || "display") === "display";
    const fam = FONTS[l.font || "display"] || `'${esc(l.font).replace(/'/g, "")}'`;
    const style = [pos(l), `font-family:${fam}`, `font-size:${Number(l.size || (display ? 96 : 32))}px`, `font-weight:${Number(l.weight || (display ? 700 : 400))}`,
      `line-height:${Number(l.leading || (display ? 0.98 : 1.45))}`, `letter-spacing:${l.tracking != null ? Number(l.tracking) + "em" : display ? "-0.02em" : "0"}`,
      cssColor(l.color) ? `color:${l.color}` : "", l.align ? `text-align:${esc(l.align)}` : "", l.uppercase ? "text-transform:uppercase" : ""].filter(Boolean).join(";");
    return `<div class="layer ct${display ? " ct-head" : ""}" data-fit${l.h != null ? " data-fit-box" : ""}${l.bleed ? " data-bleed" : ""} style="${style}">${md(l.text)}</div>`;
  },
  rect: (l) => `<div class="layer" style="${pos(l)};${cssColor(l.fill) ? `background:${l.fill};` : ""}${cssColor(l.stroke) ? `outline:1px solid ${l.stroke};outline-offset:-1px;` : ""}"></div>`,
  swatch(l) {
    const c = cssColor(l.color) || "#000000", lum = parseInt(c.slice(1, 3), 16) * 0.299 + parseInt(c.slice(3, 5), 16) * 0.587 + parseInt(c.slice(5, 7), 16) * 0.114;
    return `<div class="layer swatch" style="${pos(l)};background:${c};color:${lum > 150 ? "#0A0A0A" : "#FFFFFF"}"><span>${md(l.name || "")}</span><span>${md(l.label ?? c.toUpperCase())}</span></div>`;
  },
  svg(l, ctx) {
    const src = resolveAsset(l.src, ctx.postDir);
    const raw = src ? readFile(src, "utf8").replace(/<\?xml[^>]*>/, "").replace(/<svg/, '<svg preserveAspectRatio="xMidYMid meet" width="100%" height="100%"') : "";
    return `<div class="layer svg" style="${pos(l)}">${raw}</div>`;
  },
  brand(l, ctx) { return `<div class="layer" style="${pos(l)}">${brandBlock({ brand: { element: l.element, size: l.size, reason: l.reason } }, ctx)}</div>`; },
};
function device(kind, l, ctx) {
  const src = resolveAsset(l.src, ctx.postDir), frame = resolve(REPO_ROOT, `assets/img/device-${kind === "laptop" ? "macbook" : "iphone"}.png`);
  const tilt = l.tilt ? `transform:perspective(2400px) rotateX(${Number(l.tilt.x || 0)}deg) rotateY(${Number(l.tilt.y || 0)}deg) rotateZ(${Number(l.tilt.z || 0)}deg);` : "";
  // A soft contact shadow is allowed on physical-object mockups only (devices, print), never on Framework type or graphics.
  return `<div class="layer device ${kind}${l.shadow === false ? "" : " shadow"}" style="${pos({ ...l, h: undefined })};${tilt}"><div class="screen"><img src="${src ? fileUrl(src) : ""}" alt="" data-scroll="${Number(l.scroll || 0)}" style="object-position:50% ${Math.round((l.scroll || 0) * 100)}%"></div><img class="frame" src="${fileUrl(frame)}" alt=""></div>`;
}

const T = {
  // Free composition: full-bleed imagery, devices, layered type. Name the composition in "layout" (it is the layout family).
  canvas(s, ctx) {
    const bg = cssColor(s.background) || (s.theme === "ink" ? "#0A0A0A" : s.theme === "mist" ? "#F5F5F5" : "#FFFFFF");
    return `<div class="canvas" style="background:${bg}">${(s.layers || []).map((l) => { const f = LAYERS[l.type]; if (!f) throw new Error(`unknown canvas layer type "${l.type}"`); return f(l, ctx); }).join("")}</div>`;
  },
  // Editorial typography poster. layout: "bottom" (default) | "top" | "giant" (one oversized word, optional bleed) | "split" (headline top-left, headline2 bottom-right).
  type(s, ctx) {
    const L = s.layout || "bottom", right = s.align === "right" ? " align-right" : "";
    let inner;
    if (L === "giant") inner = `<div class="giant-word${s.bleed ? " bleed" : ""}" style="--fs:${s.giantSize || 400}px">${md(s.giant || "")}</div><div class="spacer"></div><div class="stack${right}">${headline(s, 72, "h2")}${support(s)}</div>`;
    else if (L === "top") inner = `<div class="stack${right}">${headline(s, 132)}</div><div class="spacer"></div><div class="stack${right}">${support(s)}</div>`;
    else if (L === "split") inner = `<div class="split-a">${headline(s, 112)}</div><div class="spacer"></div><div class="split-b"><h2 class="h1" data-fit ${fs(s.headlineSize || 112)}>${md(s.headline2 || "")}</h2>${s.support ? `<div style="height:32px"></div>${support(s)}` : ""}</div>`;
    else inner = `<div class="spacer"></div><div class="stack${right}">${headline(s, 132)}${support(s)}</div>`;
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${brandBlock(s, ctx)}${inner}${sourceNote(s)}</main>`;
  },
  // Minimalist composition: one short line in a large field. position: "center" (default) | "top-left" | "bottom-left" | "bottom-right".
  minimal(s, ctx) {
    const pos = s.position || "center";
    return `${chromeTop({ ...s, eyebrow: s.eyebrow || "" }, ctx)}<main class="body pos-${pos}" data-fit-box>${brandBlock(s, ctx)}<div>${s.rule === false ? "" : '<div class="min-rule"></div>'}<p class="min-text" data-fit ${fs(s.headlineSize || 52)}>${md(s.headline)}</p></div></main>`;
  },
  // Architecture-monograph page: photograph framed by paper, figure caption below.
  plate(s, ctx) {
    const fig = s.figure || `Fig. ${String(ctx.n).padStart(2, "0")}`;
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${photo(s, ctx.postDir, { height: s.imageHeight || 600 })}<div class="spacer" style="min-height:40px"></div><div class="plate-caption"><span class="fig">${md(fig)}</span><div>${headline(s, 52, "h2")}${support(s, 28)}</div></div></main>`;
  },
  // Asymmetric split: photograph full height on one side, text column on the other. side: "left" (default) | "right"; cols e.g. "1.15fr 1fr".
  split(s, ctx) {
    return `<div class="split-wrap${s.side === "right" ? " right" : ""}" style="--cols:${esc(s.cols || "1fr 1fr")}">${photo(s, ctx.postDir)}<div class="split-text"><div class="top-row"><span class="eyebrow">${s.eyebrow ? "— " + md(s.eyebrow) : ""}</span></div><main class="body end" data-fit-box><div class="stack">${headline(s, 76, "h2")}${support(s, 30)}</div></main></div></div>`;
  },
  // Portfolio: real client work on a quiet stage (theme mist or ink suits it). image = desktop view; image2 = optional phone view (image2Side "right" default | "left"); tags = disciplines.
  showcase(s, ctx) {
    const main = resolveAsset(s.image, ctx.postDir), second = resolveAsset(s.image2, ctx.postDir);
    const treat = treatment(s, "none");
    const stage = `<div class="stage ${treat}" style="height:${s.imageHeight || 640}px;--fit:${s.imageFit === "contain" ? "contain" : "cover"};--focus:${esc(s.imageFocus || "50% 0%")}"><div class="main" style="height:${s.imageHeight || 640}px"><img src="${main ? fileUrl(main) : ""}" alt=""></div>${second ? `<div class="second${s.image2Side === "left" ? " left" : ""}"><img src="${fileUrl(second)}" alt=""></div>` : ""}</div>`;
    const tags = (s.tags || []).length ? `<div class="tags">${s.tags.map((t) => `<span>${md(t)}</span>`).join("")}</div>` : "";
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${stage}<div class="spacer" style="min-height:${second ? 104 : 48}px"></div><div class="stack">${headline(s, 72, "h2")}${support(s, 30)}${tags}</div></main>`;
  },
  // Educational graphic. kind "flow": steps on a vertical line (items [{title, desc}], active: index to fill). kind "bars": items [{label, value, display}] (real, sourced numbers only) + source.
  diagram(s, ctx) {
    const items = s.items || [];
    let g = "";
    if ((s.kind || "flow") === "flow") g = `<ol class="flow" data-fit ${fs(s.itemsSize || 44)}>${items.map((it, i) => `<li class="${s.active === i + 1 ? "on" : ""}"><span class="i">${String(i + 1).padStart(2, "0")}</span><span class="t">${md(it.title)}</span>${it.desc ? `<span class="d">${md(it.desc)}</span>` : ""}</li>`).join("")}</ol>`;
    else { const max = Math.max(...items.map((it) => Number(it.value) || 0), 1); g = `<ol class="bars" data-fit ${fs(s.itemsSize || 34)}>${items.map((it) => `<li><span class="l">${md(it.label)}</span><span class="v">${md(it.display ?? it.value)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round((Number(it.value) / max) * 100)}%"></span></span></li>`).join("")}</ol>${s.source ? `<p class="src-note">${md("Source: " + s.source)}</p>` : ""}`; }
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:56px"></div>${g}</main>`;
  },
  // Eyebrow, big headline, one support line. layout "text" (default) or "photo" (photo band above the text).
  cover(s, ctx) {
    const hasPhoto = !!s.image;
    const band = hasPhoto ? photo(s, ctx.postDir, { cls: "bleed", height: s.imageHeight || 600 }) : "";
    return `${chromeTop(s, ctx)}<main class="body end" data-fit-box ${hasPhoto ? 'style="padding-top:0"' : ""}>${band}<div class="spacer"></div><div class="stack">${headline(s, hasPhoto ? 96 : 124)}${support(s)}</div></main>`;
  },
  // Full-bleed photograph with a solid panel carrying the text. No scrims or gradients.
  photo(s, ctx) {
    const src = resolveAsset(s.image, ctx.postDir);
    const treat = treatment(s);
    if (s.layout === "caption") return `<div class="full-photo ${treat}" style="--focus:${esc(s.imageFocus || "50% 50%")}"><img src="${src ? fileUrl(src) : ""}" alt=""></div>
      <section class="label-block" data-fit-box data-max-h="${Math.round(ctx.h * 0.42)}">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 56, "h2")}${support(s, 26)}</section>`;
    return `<div class="full-photo ${treat}" style="--focus:${esc(s.imageFocus || "50% 50%")}"><img src="${src ? fileUrl(src) : ""}" alt=""></div>
      <section class="panel" data-fit-box data-max-h="${Math.round(ctx.h * 0.5)}"><div class="panel-body">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 80, "h2")}${support(s, 30)}</div></section>`;
  },
  // One large statement. Pairs well with grid:true and theme ink as punctuation.
  statement(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body ${s.align === "end" ? "end" : "center"}" data-fit-box>${brandBlock(s, ctx)}<div class="stack">${headline(s, 104)}${support(s)}${sourceNote(s)}</div></main>`;
  },
  // Carousel inner slide: big grey index, title, body, optional photo band.
  point(s, ctx) {
    const idx = s.index || "";
    const band = s.image ? photo(s, ctx.postDir, { height: s.imageHeight || 420 }) : "";
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${idx ? `<div class="index-big">${md(idx)}</div>` : ""}<div class="spacer"></div>${band ? band + '<div style="height:48px;flex:none"></div>' : ""}<div class="stack">${headline(s, 72, "h2")}${s.body ? `<p class="body-text" data-fit ${fs(s.bodySize || 34)}>${md(s.body)}</p>` : ""}${sourceNote(s)}</div></main>`;
  },
  // Title plus numbered rows separated by hairlines. items: [{title, desc?}] or strings.
  list(s, ctx) {
    const items = (s.items || []).map((it, i) => (typeof it === "string" ? { title: it } : it));
    const rows = items.map((it, i) => `<li><span class="i">${String(i + 1).padStart(2, "0")}</span><span><span class="t">${md(it.title)}</span>${it.desc ? `<span class="d">${md(it.desc)}</span>` : ""}</span></li>`).join("");
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:48px"></div><ol class="rows" data-fit ${fs(s.itemsSize || 38)}>${rows}</ol>${sourceNote(s)}</main>`;
  },
  // Two columns, e.g. "Instead of / Do this". rows: [[left, right], ...].
  compare(s, ctx) {
    const cells = (s.rows || []).map(([l, r]) => `<div class="cell l">${md(l)}</div><div class="cell r">${md(r)}</div>`).join("");
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:48px"></div><div class="compare" data-fit ${fs(s.rowsSize || 36)}><div class="head l">${md(s.leftLabel || "Instead of")}</div><div class="head r">${md(s.rightLabel || "Do this")}</div>${cells}</div>${sourceNote(s)}</main>`;
  },
  // Verbatim quotation (real, attributed sources only: see social/brand/facts.md).
  quote(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body end" data-fit-box><blockquote class="quote" data-fit ${fs(s.quoteSize || 56)}>“${md(s.quote)}”</blockquote><div style="height:56px;flex:none"></div><div class="attrib"><span class="who">${md(s.name)}</span>${s.role ? `<span class="role">${md(s.role)}</span>` : ""}</div>${sourceNote(s)}</main>`;
  },
  // Closing slide. Ink by default (the one inverted section). No logo unless the concept calls for one (brand).
  cta(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${brandBlock(s, ctx)}<div class="spacer"></div><div class="stack">${headline(s, 96)}${support(s)}${s.button ? `<span class="btn">${md(s.button)} <span>→</span></span>` : ""}</div></main>`;
  },
  // Reel overlay (1080x1920, transparent): composited over a desaturated clip by `fw reel`.
  reel(s, ctx) {
    return `<section class="panel" data-fit-box data-max-h="${Math.round(ctx.h * 0.55)}"><div class="panel-body">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 88, "h2")}${support(s, 32)}</div></section>`;
  },
};

export function slideHtml(slide, ctx) {
  const tpl = T[slide.template];
  if (!tpl) throw new Error(`unknown template "${slide.template}" (use one of: ${TEMPLATES.join(", ")})`);
  const theme = slide.theme || (slide.template === "cta" ? "ink" : "paper");
  const full = { ...ctx, theme };
  const cls = ["slide", theme, slide.grid ? "grid" : "", slide.template === "reel" ? "reel" : ""].join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(ctx.fontsCss)}"><link rel="stylesheet" href="${fileUrl(ctx.slideCss)}">
<style>:root{--w:${ctx.w}px;--h:${ctx.h}px}${ctx.fontFaces || ""}</style></head><body><div class="${cls}">${tpl(slide, full)}</div></body></html>`;
}
