// Slide templates: spec fields in, one self-contained HTML document out. Layout lives in slide.css; this file only places content.
// Text markup allowed in any text field: "\n" = deliberate line break, {{text}} = muted (slate on paper, stone on ink), **text** = semibold.
import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";

export const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
export const TEMPLATES = ["cover", "type", "minimal", "photo", "plate", "split", "showcase", "diagram", "statement", "point", "list", "compare", "quote", "cta", "reel"];

// Visual categories (feed art direction) and the default category of each layout family. A spec may override with "category".
export const CATEGORIES = ["editorial-typography", "architectural-photography", "portfolio", "conceptual-artwork", "educational-graphic", "minimalist"];
/** Layout family of a slide, e.g. "type:giant", "photo:caption", "plate". Used to keep neighbouring posts from repeating. */
export const familyOf = (s) => s.template + (s.layout ? ":" + s.layout : "");
export function categoryOf(s) {
  if (s.category) return s.category;
  const t = s.template;
  if (t === "minimal") return "minimalist";
  if (t === "showcase") return "portfolio";
  if (["diagram", "list", "compare", "point"].includes(t)) return "educational-graphic";
  if (["photo", "plate", "split", "reel"].includes(t) || (t === "cover" && s.image)) return "architectural-photography";
  return "editorial-typography";
}
/** Whether a slide's dominant visual is a photograph or artwork (vs. type and graphics). */
export const isImagery = (s) => ["photo", "plate", "split", "showcase", "reel"].includes(s.template) || (s.template === "cover" && !!s.image);

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

function chromeTop(s, ctx) {
  return `<header class="top"><span class="eyebrow">${s.eyebrow ? "— " + md(s.eyebrow) : ""}</span><span class="counter">${ctx.counter}</span></header>`;
}
function chromeBottom(s, ctx) {
  const right = s.footer ?? (ctx.isLast ? "frameworkco.ca" : "→");
  return `<footer class="bottom"><span class="lockup">${markFor(ctx.theme)}<span class="wordmark">Framework</span></span><span class="foot-right${right === "→" ? " arrow" : ""}">${md(right)}</span></footer>`;
}
const fs = (px) => `style="--fs:${px}px"`;
const headline = (s, def, cls = "h1") => (s.headline ? `<h1 class="${cls}" data-fit ${fs(s.headlineSize || def)}>${md(s.headline)}</h1>` : "");
const support = (s, def = 34) => (s.support ? `<p class="support" data-fit ${fs(s.supportSize || def)}>${md(s.support)}</p>` : "");

const T = {
  // Editorial typography poster. layout: "bottom" (default) | "top" | "giant" (one oversized word, optional bleed) | "split" (headline top-left, headline2 bottom-right).
  type(s, ctx) {
    const L = s.layout || "bottom", right = s.align === "right" ? " align-right" : "";
    let inner;
    if (L === "giant") inner = `<div class="giant-word${s.bleed ? " bleed" : ""}" style="--fs:${s.giantSize || 400}px">${md(s.giant || "")}</div><div class="spacer"></div><div class="stack${right}">${headline(s, 72, "h2")}${support(s)}</div>`;
    else if (L === "top") inner = `<div class="stack${right}">${headline(s, 132)}</div><div class="spacer"></div><div class="stack${right}">${support(s)}</div>`;
    else if (L === "split") inner = `<div class="split-a">${headline(s, 112)}</div><div class="spacer"></div><div class="split-b"><h2 class="h1" data-fit ${fs(s.headlineSize || 112)}>${md(s.headline2 || "")}</h2>${s.support ? `<div style="height:32px"></div>${support(s)}` : ""}</div>`;
    else inner = `<div class="spacer"></div><div class="stack${right}">${headline(s, 132)}${support(s)}</div>`;
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${inner}</main>${chromeBottom(s, ctx)}`;
  },
  // Minimalist composition: one short line in a large field. position: "center" (default) | "top-left" | "bottom-left" | "bottom-right".
  minimal(s, ctx) {
    const pos = s.position || "center";
    return `${chromeTop({ ...s, eyebrow: s.eyebrow || "" }, ctx)}<main class="body pos-${pos}" data-fit-box><div>${s.rule === false ? "" : '<div class="min-rule"></div>'}<p class="min-text" data-fit ${fs(s.headlineSize || 52)}>${md(s.headline)}</p></div></main>${chromeBottom(s, ctx)}`;
  },
  // Architecture-monograph page: photograph framed by paper, figure caption below.
  plate(s, ctx) {
    const fig = s.figure || `Fig. ${String(ctx.n).padStart(2, "0")}`;
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${photo(s, ctx.postDir, { height: s.imageHeight || 600 })}<div class="spacer" style="min-height:40px"></div><div class="plate-caption"><span class="fig">${md(fig)}</span><div>${headline(s, 52, "h2")}${support(s, 28)}</div></div></main>${chromeBottom(s, ctx)}`;
  },
  // Asymmetric split: photograph full height on one side, text column on the other. side: "left" (default) | "right"; cols e.g. "1.15fr 1fr".
  split(s, ctx) {
    return `<div class="split-wrap${s.side === "right" ? " right" : ""}" style="--cols:${esc(s.cols || "1fr 1fr")}">${photo(s, ctx.postDir)}<div class="split-text"><div class="top-row"><span class="eyebrow">${s.eyebrow ? "— " + md(s.eyebrow) : ""}</span><span class="counter">${ctx.counter}</span></div><main class="body end" data-fit-box><div class="stack">${headline(s, 76, "h2")}${support(s, 30)}</div></main><div style="height:40px;flex:none"></div><span class="lockup">${markFor(ctx.theme)}<span class="wordmark">Framework</span></span></div></div>`;
  },
  // Portfolio: real client work on a quiet stage (theme mist or ink suits it). image = desktop view; image2 = optional phone view; tags = disciplines.
  showcase(s, ctx) {
    const main = resolveAsset(s.image, ctx.postDir), second = resolveAsset(s.image2, ctx.postDir);
    const treat = treatment(s, "none");
    const stage = `<div class="stage ${treat}" style="height:${s.imageHeight || 640}px;--fit:${s.imageFit === "contain" ? "contain" : "cover"};--focus:${esc(s.imageFocus || "50% 0%")}"><div class="main" style="height:${s.imageHeight || 640}px"><img src="${main ? fileUrl(main) : ""}" alt=""></div>${second ? `<div class="second"><img src="${fileUrl(second)}" alt=""></div>` : ""}</div>`;
    const tags = (s.tags || []).length ? `<div class="tags">${s.tags.map((t) => `<span>${md(t)}</span>`).join("")}</div>` : "";
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box>${stage}<div class="spacer" style="min-height:${second ? 104 : 48}px"></div><div class="stack">${headline(s, 72, "h2")}${support(s, 30)}${tags}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Educational graphic. kind "flow": steps on a vertical line (items [{title, desc}], active: index to fill). kind "bars": items [{label, value, display}] (real, sourced numbers only) + source.
  diagram(s, ctx) {
    const items = s.items || [];
    let g = "";
    if ((s.kind || "flow") === "flow") g = `<ol class="flow" data-fit ${fs(s.itemsSize || 44)}>${items.map((it, i) => `<li class="${s.active === i + 1 ? "on" : ""}"><span class="i">${String(i + 1).padStart(2, "0")}</span><span class="t">${md(it.title)}</span>${it.desc ? `<span class="d">${md(it.desc)}</span>` : ""}</li>`).join("")}</ol>`;
    else { const max = Math.max(...items.map((it) => Number(it.value) || 0), 1); g = `<ol class="bars" data-fit ${fs(s.itemsSize || 34)}>${items.map((it) => `<li><span class="l">${md(it.label)}</span><span class="v">${md(it.display ?? it.value)}</span><span class="track"><span class="fill" style="display:block;width:${Math.round((Number(it.value) / max) * 100)}%"></span></span></li>`).join("")}</ol>${s.source ? `<p class="src-note">${md("Source: " + s.source)}</p>` : ""}`; }
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:56px"></div>${g}</main>${chromeBottom(s, ctx)}`;
  },
  // Eyebrow, big headline, one support line. layout "text" (default) or "photo" (photo band above the text).
  cover(s, ctx) {
    const hasPhoto = !!s.image;
    const band = hasPhoto ? photo(s, ctx.postDir, { cls: "bleed", height: s.imageHeight || 600 }) : "";
    return `${chromeTop(s, ctx)}<main class="body end" data-fit-box ${hasPhoto ? 'style="padding-top:0"' : ""}>${band}<div class="spacer"></div><div class="stack">${headline(s, hasPhoto ? 96 : 124)}${support(s)}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Full-bleed photograph with a solid panel carrying the text. No scrims or gradients.
  photo(s, ctx) {
    const src = resolveAsset(s.image, ctx.postDir);
    const treat = treatment(s);
    if (s.layout === "caption") return `<div class="full-photo ${treat}" style="--focus:${esc(s.imageFocus || "50% 50%")}"><img src="${src ? fileUrl(src) : ""}" alt=""></div>
      ${ctx.counter ? `<div class="tag"><span class="counter">${ctx.counter}</span></div>` : ""}
      <section class="label-block" data-fit-box data-max-h="${Math.round(ctx.h * 0.42)}">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 56, "h2")}${support(s, 26)}<span class="lockup">${markFor(ctx.theme)}<span class="wordmark">Framework</span></span></section>`;
    return `<div class="full-photo ${treat}" style="--focus:${esc(s.imageFocus || "50% 50%")}"><img src="${src ? fileUrl(src) : ""}" alt=""></div>
      ${ctx.counter ? `<div class="tag"><span class="counter">${ctx.counter}</span></div>` : ""}
      <section class="panel" data-fit-box data-max-h="${Math.round(ctx.h * 0.5)}"><div class="panel-body">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 80, "h2")}${support(s, 30)}</div>${chromeBottom(s, ctx)}</section>`;
  },
  // One large statement. Pairs well with grid:true and theme ink as punctuation.
  statement(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body ${s.align === "end" ? "end" : "center"}" data-fit-box><div class="stack">${headline(s, 104)}${support(s)}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Carousel inner slide: big grey index, title, body, optional photo band.
  point(s, ctx) {
    const idx = s.index ?? String(ctx.n).padStart(2, "0");
    const band = s.image ? photo(s, ctx.postDir, { height: s.imageHeight || 420 }) : "";
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="index-big">${md(idx)}</div><div class="spacer"></div>${band ? band + '<div style="height:48px;flex:none"></div>' : ""}<div class="stack">${headline(s, 72, "h2")}${s.body ? `<p class="body-text" data-fit ${fs(s.bodySize || 34)}>${md(s.body)}</p>` : ""}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Title plus numbered rows separated by hairlines. items: [{title, desc?}] or strings.
  list(s, ctx) {
    const items = (s.items || []).map((it, i) => (typeof it === "string" ? { title: it } : it));
    const rows = items.map((it, i) => `<li><span class="i">${String(i + 1).padStart(2, "0")}</span><span><span class="t">${md(it.title)}</span>${it.desc ? `<span class="d">${md(it.desc)}</span>` : ""}</span></li>`).join("");
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:48px"></div><ol class="rows" data-fit ${fs(s.itemsSize || 38)}>${rows}</ol></main>${chromeBottom(s, ctx)}`;
  },
  // Two columns, e.g. "Instead of / Do this". rows: [[left, right], ...].
  compare(s, ctx) {
    const cells = (s.rows || []).map(([l, r]) => `<div class="cell l">${md(l)}</div><div class="cell r">${md(r)}</div>`).join("");
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="stack">${headline(s, 64, "h2")}${support(s, 30)}</div><div class="spacer" style="min-height:48px"></div><div class="compare" data-fit ${fs(s.rowsSize || 36)}><div class="head l">${md(s.leftLabel || "Instead of")}</div><div class="head r">${md(s.rightLabel || "Do this")}</div>${cells}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Verbatim quotation (real, attributed sources only: see social/brand/facts.md).
  quote(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body end" data-fit-box><blockquote class="quote" data-fit ${fs(s.quoteSize || 56)}>“${md(s.quote)}”</blockquote><div style="height:56px;flex:none"></div><div class="attrib"><span class="who">${md(s.name)}</span>${s.role ? `<span class="role">${md(s.role)}</span>` : ""}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Closing slide. Ink by default (the one inverted section).
  cta(s, ctx) {
    return `${chromeTop(s, ctx)}<main class="body" data-fit-box><div class="mark-big">${markFor(ctx.theme)}</div><div class="spacer"></div><div class="stack">${headline(s, 96)}${support(s)}${s.button ? `<span class="btn">${md(s.button)} <span>→</span></span>` : ""}</div></main>${chromeBottom({ ...s, footer: s.footer ?? "frameworkco.ca" }, ctx)}`;
  },
  // Reel overlay (1080x1920, transparent): composited over a desaturated clip by `fw reel`.
  reel(s, ctx) {
    return `<div class="tag-left"><span class="lockup">${markFor(ctx.theme)}<span class="wordmark">Framework</span></span></div>
      <section class="panel" data-fit-box data-max-h="${Math.round(ctx.h * 0.55)}"><div class="panel-body">${s.eyebrow ? `<div class="eyebrow">— ${md(s.eyebrow)}</div>` : ""}${headline(s, 88, "h2")}${support(s, 32)}</div></section>`;
  },
};

export function slideHtml(slide, ctx) {
  const tpl = T[slide.template];
  if (!tpl) throw new Error(`unknown template "${slide.template}" (use one of: ${TEMPLATES.join(", ")})`);
  const theme = slide.theme || (slide.template === "cta" ? "ink" : "paper");
  const full = { ...ctx, theme };
  const cls = ["slide", theme, slide.grid ? "grid" : "", slide.template === "reel" ? "reel" : ""].join(" ");
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fileUrl(ctx.fontsCss)}"><link rel="stylesheet" href="${fileUrl(ctx.slideCss)}">
<style>:root{--w:${ctx.w}px;--h:${ctx.h}px}</style></head><body><div class="${cls}">${tpl(slide, full)}</div></body></html>`;
}
