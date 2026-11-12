# Brand Book (prototype)

Status: **prototype on Staging, for design review. Not on Production.** The existing Branding page is unchanged. This document is the structure, the design direction, what was built, and what is deliberately left out.

## What it is
The client's brand as an editorial, full-screen brand kit rather than portal content: **twenty pages in three chapters** (01 Logo, 02 Typography, 03 Colours), shown as a deck. The first page fills the screen on load and the tops of the next four wait stacked along the bottom edge. Scrolling brings the next page up over the current one; the page behind eases back.

- **Where:** `/portal/o/<organization>/branding/book` (signed-in members of that organization, or Framework master access previewing it; permission `branding.view`, like Branding itself).
- **How to open it as Framework master access:** Client portals directory, the client, **Branding**, then the **Preview Brand Book** button under the heading. It is an ordinary link inside the same visit, so the client's organization, your master-access session and the Owner/Member preview carry over, with no separate client sign-in. A direct link with no live session is sent to sign-in, which always ends on `/portal` (the directory); the portal does not remember the page you asked for (unchanged authentication behaviour). Sign in again and use the button.
- **Staging only:** the routes answer only where `PORTAL_BRANDING` **and** `PORTAL_DEMO` are on (`bookOn` in `router.js`). `PORTAL_DEMO` is the Staging-only switch and stays off on Production, so it is a 404 there even if the code is released. No new flag, no migration, no new data.
- **Read-only:** it shows the published brand kit and the files Framework placed in it. Every download is the existing permission-checked route (`/branding/files/<id>`). It posts nothing. Requests, uploads, Brand Discovery and pricing stay on the Branding page, linked from every page's footer.

## Structure
| Pages | Chapter | Content |
| --- | --- | --- |
| Cover | | Brand name, tagline, the three chapters as a large index |
| Logo · Variations · Clear space & size · Placement · Misuse · In application | 01 Logo | The client's own logo files at poster scale; the four variations; the rules shown on their logo |
| Typography · Primary typeface · Secondary & accent · Weights · Hierarchy · In use | 02 Typography | The client's typefaces (loaded from their font files) as oversized specimens, weights, a hierarchy, a composition |
| Colours · Primary palette · Supporting colours · Combinations & contrast · Balance, light & dark · In application | 03 Colours | Large colour fields with names and values (copy buttons), computed contrast, suggested balance |
| Files | | Logos, fonts, documents and other files, as downloads |

Imagery, layout, icons and style files are listed on the Files page rather than given their own chapters (a deliberate simplification).

## What is real and what is illustrative
Logos, typefaces, colours, names, taglines and files are the client's published brand. Clear space, misuse, placement, balance and the application mock-ups are **Framework default guidelines drawn on the client's own logo and palette**, labelled as such on the page; none is presented as an approved rule. Contrast ratios are computed (WCAG) from the palette, and text on any colour is chosen for at least 4.5:1. Where a brand has nothing published yet, pages show Framework's labelled examples.

## Design direction
Black and white foundations with strong colour moments; oversized display type; large negative space; asymmetrical grid layouts; minimal chrome (a thin header with the chapter links, a folio at the foot). No cards-in-cards, tabs, accordions or dashboard styling. Framework's own identity: sharp corners, ruled lines, Switzer display and General Sans text. Colours come from the client's palette when it has three or more (otherwise Framework's set) through a generated stylesheet of validated `#rrggbb` values (`book.css`); no inline styles anywhere (the portal CSP is unchanged).

## Layout: edge to edge
The portal wraps every page in `<main class="wrap page">` (centred, `max-width`, side gutters, top and bottom padding). The Brand Book page alone opts out (`bleed` in `appPage`: `<main class="page page--bleed">`, no max-width, gutters or padding), so the deck spans the full viewport width beneath the unchanged portal header and the stage fills the height from the header to the bottom of the screen. Editorial padding lives inside each page. The stage height follows `dvh` (a phone's collapsing address bar), the page opts in to `viewport-fit=cover`, and page padding uses `env(safe-area-inset-*)`. No other page is affected.

## Scroll behaviour
- The **page scrolls natively**: wheel, trackpad, touch and keyboard. Nothing is captured, snapped or re-timed. A pinned stage holds the deck while the page scrolls through a runway; each page's position is computed from the scroll offset (a short pause on each page, then the next rises with a soft shadow and a smoothstep ease; no rotation or 3D).
- **Tall content** scrolls inside its page and hands over to the page at its end.
- **Navigation:** chapter links in every page's header, clicking a waiting page's tab, and `#logo-misuse`-style links all work.
- **Accessibility:** pages that are not showing are `inert` (not focusable, not read out); a polite live region announces "Page 8 of 20: Typography".
- **Reduced motion, no script, short screens (under 520px high), no `position: sticky`:** the same pages as a plain vertical stack of full-height pages; switching takes effect live.
- **Tablet and phone:** the same deck with a stacked layout (cover and openers reflow to a single column, oversized type scales down).

## Verified
Automated tests (`worker/test/portal-branding-book.test.mjs`): the Staging gate, tenant isolation, master-access flow (button, Owner/Member preview, revoked or unbound grants, Production 404), read-only (no forms), no inline style or script, existing file routes, colour validation and contrast, and the script's limits (nothing fetched or stored, no wheel/touch capture). In Chromium: all twenty pages at desktop, tablet and phone sizes, no console or CSP errors, keyboard focus never entering an inert page, chapter links, deep links, tab clicks, reduced motion and a short window switched live. Not yet tried on physical iOS or Android devices, or with a very large brand.

## Decisions for review
1. **The page set** (twenty pages, three chapters; imagery and layout only on the Files page).
2. **Colour source:** the client's palette versus Framework's fixed set.
3. **Framework default guidelines** (clear space, misuse, balance) versus per-client rules edited in Admin.
4. **Request, upload and Discovery controls inside the book**, or keep them on the Branding page.
5. **Whether it replaces the Branding page or sits beside it.**
6. **Phones:** the deck at phone size, or a plain stack below a width. **Pace:** about one screen of scrolling per page.
7. **Optional:** remember the destination across sign-in (an authentication change, not made here).
