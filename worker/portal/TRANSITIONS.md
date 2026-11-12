# Branded transitions, loading states and the editorial sign-in

Status: **on Staging only** (`PORTAL_TRANSITIONS`). Production is unchanged and keeps the script-free CSP until this is approved there.

## What it is
One full-screen black curtain with the Framework mark, used four ways. The mark is the website hero's drawing (the same two outlines, outer F then inner F, then filled; same `pathLength` stroke technique and easing), so the portal and the website share one animation rather than two.

| State | When | What the person sees |
| --- | --- | --- |
| **Intro** | The first signed-in page after a sign-in | Black at first paint, the mark is drawn and filled, then the curtain lifts to reveal the portal (about 2.2 s, once per sign-in) |
| **Enter / leave** | Moving to another **major section** (Home, Account, Branding, Website, ... or another client) | The old page eases into black as the browser navigates (0.2 s), the next page is already black at first paint and clears in about 0.4 s |
| **Loading** | A navigation or a form that is **genuinely** slow (over about 0.65 s / 0.5 s) | The mark draws in a loop instead of a spinner, and a polite "Loading" status is announced |
| **Nothing** | Direct links, refresh, Back/Forward, moves inside a section (for example Branding to the Brand Book), anchors, downloads, new tabs, modified clicks | An ordinary instant navigation |

The **editorial sign-in** (`signInPage` in `transition.js`, `portal-signin.css`) replaces the plain card on Staging: black, full bleed, an oversized "Client Portal" title, one hairline drawing of the mark, one white Continue button. Minimal copy: one instruction ("Enter your email to receive a one-time sign-in code."), Continue, a discreet "Need help?" link to hello@frameworkco.ca and Privacy in the footer. The demo link, the "access is by invitation" line and the footer address are gone; the "session has ended" notice stays, and sign-in errors and restrictions are shown by the same error pages as before. 56 px touch target, safe-area aware, fits a 360×640 phone without scrolling, one column below 900 px.

## Decorative versus real
Decoration never waits for anything and never blocks anything:
- The browser navigates at the moment of the click; the animation runs alongside it. Nothing is delayed to "finish" an animation.
- The curtain takes no pointer events, so the page underneath is always usable. **Escape** clears it. Everything clears itself after 9 seconds if the page is still here (a download, a stalled request).
- A loader appears **only** after a real wait. A quick navigation shows only the short dip.
- Error pages, the no-access page and the callback's error page carry no curtain and no script: messages are shown at once. A validation failure never reaches the loader (the browser blocks the submit first).
- Reduced motion: no intro, no dip, no arrival animation. A real wait still shows the mark, **still** (fading in, never moving).

## How it works (and why Back/refresh are safe)
- `assets/js/portal-transition.js` is loaded **synchronously in `<head>`**, after `portal-transition.css`, only on pages that opt in. It runs before the first paint, so an arriving page is black from the very first frame (no flash) and there is no flash of unstyled content.
- It only toggles classes on `<html>` (`fw-intro`, `fw-enter`, `fw-leave`, `fw-loading`); the stylesheet does all the drawing. Without the script the curtain stays hidden and the pages behave exactly as before.
- On a qualifying click it stores one short-lived hint in `sessionStorage` (`fw.tr`, valid 10 s; a sign-in hint 20 min). The next page consumes it. Direct links, refresh and Back/Forward carry no hint, so they show nothing; stale hints are ignored; a page restored from the back/forward cache clears any curtain (`pageshow`, `persisted`).
- It never calls `preventDefault`, assigns `location`, fetches, or stores anything else.
- **Sign-in:** the Continue link records the hint. WorkOS, the state cookie, the callback, sessions and every redirect are untouched; nothing in `auth.js` changed except passing the flag to the page renderer. The intro plays on the first portal page after the person returns signed in (the organization home, the organization picker or the staff directory).
- **Major section** = the organization plus the first path segment under it. Navigating inside a section is not a transition.

## The flag, the CSP and Production
`PORTAL_TRANSITIONS` is exactly `"1"` on Staging (`previews.vars`, `staging-expected.json`) and absent at the top level. Off, every page is byte-for-byte what it was, with the strict CSP that forbids scripts.

On, the pages that use it (the sign-in and the signed-in application pages) add **one same-origin script** and the matching `script-src 'self'` in their CSP. Nothing else is widened: no inline script or style, no `unsafe-*`, no third-party script. Pages that stay script-free keep the strict CSP. **This is a security-posture change that Production does not get until it is explicitly approved**; the alternative for Production is the CSS-only part (cross-document view transitions) without the loading state.

## Files
`worker/portal/transition.js` (editorial sign-in), `frame.js` (`CURTAIN`, head assets), `ui.js` / `pages.js` / `http.js` (opt-in `fx`), `config.js` (`transitionsOn`), `assets/css/portal-transition.css`, `assets/css/portal-signin.css`, `assets/js/portal-transition.js`, tests in `worker/test/portal-transition.test.mjs`.

## Decisions for review
1. Whether Production gets the script (CSP `script-src 'self'` on portal pages) or a CSS-only subset.
2. Intro length (about 2.2 s) and whether it should play on every sign-in or only the first of a day.
3. Which moves count as a "major section" (currently the first path segment).
4. Whether the demo portal and the Admin should adopt the same curtain.
