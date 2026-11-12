/**
 * The shared HTML frame pieces of the portal: escaping, the document head, the brand mark, the footer and the sign-in / system page frame.
 * No imports, so http.js (error and sign-in pages) and ui.js (the signed-in application shell) can both use it without a cycle.
 * Pages carry no script and no inline style (the portal CSP forbids both); all presentation is in /assets/css/portal.css.
 */
export const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const e = escapeHtml;

export const FONTS = "https://api.fontshare.com/v2/css?f[]=switzer@600,700&f[]=general-sans@400,500,600,700&display=swap";

export const MARK = `<svg class="brand__mark" viewBox="0 0 1092 1092" aria-hidden="true" focusable="false"><rect width="1092" height="1092" fill="#0A0A0A"/><path fill="#FFFFFF" d="M302 245H815V347H411V741L302 851Z"/><path fill="#FFFFFF" d="M435 517L512 440H815V545H534V842H435Z"/></svg>`;

export const head = (title, { script = null, styles = [], cover = false, fx = false } = {}) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1${cover ? ", viewport-fit=cover" : ""}">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${e(title)} | Framework</title>
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="/assets/css/portal.css">${styles.map((h) => `<link rel="stylesheet" href="${e(h)}">`).join("")}${fx ? `<meta name="fw-fx" content="${fx === "app" ? "app" : "page"}"><link rel="stylesheet" href="/assets/css/portal-transition.css"><script src="/assets/js/portal-transition.js"></script>` : ""}${script ? `<script src="${e(script)}" defer></script>` : ""}`;

export const footer = `<footer class="foot"><div class="wrap"><span>Framework · Calgary, Alberta</span><span><a href="/privacy.html">Privacy</a> · <a href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a></span></div></footer>`;

/** The signed-in footer: the same, plus a quiet "Send feedback" link (a path inside the portal, already escaped by the caller). */
export const footerWithFeedback = (feedbackHref) => `<footer class="foot"><div class="wrap"><span>Framework · Calgary, Alberta</span><span><a href="${e(feedbackHref)}">Send feedback</a> · <a href="/privacy.html">Privacy</a> · <a href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a></span></div></footer>`;

/** The full-screen black curtain of the branded transitions: the Framework mark, drawn with the same two outlines as the website's hero drawing (outer F, inner F, then filled). Hidden until the
 *  transition script adds a state class to <html>; decorative (aria-hidden). The status line is a polite live region the script fills only for a real loading delay. Only emitted where PORTAL_TRANSITIONS is on. */
export const CURTAIN = `<div class="fw-curtain" aria-hidden="true"><svg class="fw-curtain__mark" viewBox="200 300 320 374" focusable="false"><path class="fw-f fw-f--1" pathLength="1" d="M215.2 312.1 L512.7 312.1 L512.7 371.3 L278.4 371.3 L278.4 599.8 L215.2 663.6 Z"/><path class="fw-f fw-f--2" pathLength="1" d="M292.3 469.9 L337.0 425.2 L512.7 425.2 L512.7 486.1 L349.7 486.1 L349.7 658.4 L292.3 658.4 Z"/></svg></div><p class="visually-hidden" role="status" data-fw-status></p>`;

/** The sign-in / system page frame: brand, one column of content. `bodyHtml` must already be escaped by the caller; `title` is escaped here. */
export function authFrame({ title, bodyHtml = "", ref = null, fx = false }) {
  const refLine = ref ? `<p class="muted small">Reference: <strong>${e(ref)}</strong></p>` : "";
  return `<!DOCTYPE html>
<html lang="en-CA"><head>${head(title, { fx })}</head>
<body class="auth">${fx ? CURTAIN : ""}<header class="auth__top"><div class="wrap"><a class="brand" href="/portal/login" aria-label="Framework client portal">${MARK}<span class="brand__word">Framework</span></a></div></header>
<main id="main" class="auth__main" tabindex="-1"><div class="wrap"><div class="auth__panel"><span class="eyebrow">Client portal</span><h1 class="h1">${e(title)}</h1>${bodyHtml}${refLine}</div></div></main>${footer}</body></html>`;
}
