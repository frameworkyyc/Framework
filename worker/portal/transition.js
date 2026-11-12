/**
 * The editorial sign-in page of the branded-transition system (worker/portal/TRANSITIONS.md). Only used where PORTAL_TRANSITIONS is on (Staging): loginPage() in pages.js hands over to
 * signInPage() and everywhere else the plain sign-in is unchanged. It is a presentation change only: the same Continue link (built by auth.js), the same notices and the same copy, and
 * nothing here touches WorkOS, the state cookie, sessions or any redirect. Pure string building; every dynamic value is escaped. The one same-origin script and the stylesheets are
 * served from /assets (no inline script or style), which is why this page carries the script-allowing CSP (see securityHeaders).
 */
import { securityHeaders } from "./http.js";
import { escapeHtml as e, MARK, CURTAIN, head } from "./frame.js";

/** The large outline of the mark (the website hero's outer and inner F) that is drawn once, slowly, behind the sign-in. Decorative. */
const OUTLINE = `<svg class="si__art" viewBox="200 300 320 374" aria-hidden="true" focusable="false"><path class="si__line si__line--1" pathLength="1" d="M215.2 312.1 L512.7 312.1 L512.7 371.3 L278.4 371.3 L278.4 599.8 L215.2 663.6 Z"/><path class="si__line si__line--2" pathLength="1" d="M292.3 469.9 L337.0 425.2 L512.7 425.2 L512.7 486.1 L349.7 486.1 L349.7 658.4 L292.3 658.4 Z"/></svg>`;
const ARROW = `<svg class="si__arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12h16M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;

export function signInPage({ continueHref, ended = false, demoHref = null, status = 200 }) {
  const notice = ended ? `<p class="si__notice" role="status">Your previous session has ended. Please sign in again.</p>` : "";
  const demo = demoHref ? `<p class="si__small">Not signed in yet? <a class="si__link" href="${e(demoHref)}">See a demonstration of the portal</a>. It uses sample data for a fictional client.</p>` : "";
  const html = `<!DOCTYPE html>
<html lang="en-CA" class="fx-signin"><head>${head("Sign in", { fx: "page", styles: ["/assets/css/portal-signin.css"] })}</head>
<body class="si-body"><a class="skip-link" href="#main">Skip to content</a>${CURTAIN}
<div class="si">
<header class="si__top"><a class="si__brand" href="/portal/login" aria-label="Framework client portal">${MARK}<span class="si__word">Framework</span></a><span class="si__label">Client portal</span></header>
<main id="main" class="si__main" tabindex="-1">${OUTLINE}
<h1 class="si__title"><span>Client</span><span>Portal</span></h1>
<div class="si__panel"><p class="si__eyebrow">Sign in</p>${notice}<p class="si__lead">Use the email address your Framework invitation was sent to. We’ll email you a one-time code.</p><p class="si__cta"><a class="si__btn" data-fw-signin href="${e(continueHref)}"><span>Continue</span>${ARROW}</a></p><p class="si__small">Access is by invitation. Questions? <a class="si__link" href="mailto:hello@frameworkco.ca">hello@frameworkco.ca</a></p>${demo}</div>
</main>
<footer class="si__foot"><span>Framework · Calgary, Alberta</span><span><a class="si__link" href="/privacy.html">Privacy</a></span></footer>
</div></body></html>`;
  return new Response(html, { status, headers: securityHeaders({ "Content-Type": "text/html; charset=utf-8" }, { scripts: true }) });
}
