// Slide templates: spec fields in, one self-contained HTML document out. Layout lives in slide.css; this file only places content.
// Text markup allowed in any text field: "\n" = deliberate line break, {{text}} = muted (slate on paper, stone on ink), **text** = semibold.
import { pathToFileURL } from "node:url";
import { resolve, isAbsolute } from "node:path";

export const REPO_ROOT = resolve(new URL("../../", import.meta.url).pathname);
export const TEMPLATES = ["cover", "photo", "statement", "point", "list", "compare", "quote", "cta", "reel"];

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

function photo(s, postDir, { cls = "", height } = {}) {
  const src = resolveAsset(s.image, postDir);
  if (!src) return "";
  const treat = s.imageTreatment === "none" ? "" : s.imageTreatment === "muted" ? "muted-photo" : "mono";
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
  // Eyebrow, big headline, one support line. layout "text" (default) or "photo" (photo band above the text).
  cover(s, ctx) {
    const hasPhoto = !!s.image;
    const band = hasPhoto ? photo(s, ctx.postDir, { cls: "bleed", height: s.imageHeight || 600 }) : "";
    return `${chromeTop(s, ctx)}<main class="body end" data-fit-box ${hasPhoto ? 'style="padding-top:0"' : ""}>${band}<div class="spacer"></div><div class="stack">${headline(s, hasPhoto ? 96 : 124)}${support(s)}</div></main>${chromeBottom(s, ctx)}`;
  },
  // Full-bleed photograph with a solid panel carrying the text. No scrims or gradients.
  photo(s, ctx) {
    const src = resolveAsset(s.image, ctx.postDir);
    const treat = s.imageTreatment === "none" ? "" : s.imageTreatment === "muted" ? "muted-photo" : "mono";
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
