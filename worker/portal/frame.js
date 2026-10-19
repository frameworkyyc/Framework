/**
 * The shared HTML frame pieces of the portal: escaping, the document head, the brand mark, the footer and the sign-in / system page frame.
 * No imports, so http.js (error and sign-in pages) and ui.js (the signed-in application shell) can both use it without a cycle.
 * Pages carry no script and no inline style (the portal CSP forbids both); all presentation is in /assets/css/portal.css.
 */
export const escapeHtml = (value) => String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const e = escapeHtml;

export const FONTS = "https://api.fontshare.com/v2/css?f[]=switzer@600,700&f[]=general-sans@400,500,600,700&display=swap";

export const MARK = `<svg class="brand__mark" viewBox="0 0 1092 1092" aria-hidden="true" focusable="false"><rect width="1092" height="1092" fill="#0A0A0A"/><path fill="#FFFFFF" d="M302 245H815V347H411V741L302 851Z"/><path fill="#FFFFFF" d="M435 517L512 440H815V545H534V842H435Z"/></svg>`;

export const head = (title) => `<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><meta name="referrer" content="no-referrer"><meta name="color-scheme" content="light"><title>${e(title)} | Framework</title>
<link rel="icon" href="/assets/img/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${FONTS}"><link rel="stylesheet" href="/assets/css/portal.css">`;

export const footer = `<footer class="foot"><div class="wrap"><span>Framework · Calgary, Alberta</span><span><a href="/privacy.html">Privacy</a> · <a href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a></span></div></footer>`;

/** The sign-in / system page frame: brand, one column of content. `bodyHtml` must already be escaped by the caller; `title` is escaped here. */
export function authFrame({ title, bodyHtml = "", ref = null }) {
  const refLine = ref ? `<p class="muted small">Reference: <strong>${e(ref)}</strong></p>` : "";
  return `<!DOCTYPE html>
<html lang="en-CA"><head>${head(title)}</head>
<body class="auth"><div class="auth__top"><div class="wrap"><a class="brand" href="/portal/login" aria-label="Framework client portal">${MARK}<span class="brand__word">Framework</span></a></div></div>
<main id="main" class="auth__main"><div class="wrap"><div class="auth__panel"><span class="eyebrow">Client portal</span><h1 class="h1">${e(title)}</h1>${bodyHtml}${refLine}</div></div></main>${footer}</body></html>`;
}
