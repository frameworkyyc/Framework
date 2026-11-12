# Brand Book (prototype)

Status: **prototype on Staging, for design review. Not on Production.** Nothing about the existing Branding page changed. This document is the design proposal, what was built, and what is deliberately left out.

## What it is
The Branding section re-presented as an interactive brand book: seven large coloured cards stacked at the bottom of the screen. As the page is scrolled, the next card rises from the stack and slides over the current one.

- **Where:** `/portal/o/<organization>/branding/book` (signed-in members of that organization, or Framework master access previewing it; permission `branding.view`, like Branding itself).
- **How to open it as Framework master access:** Client portals directory, the client, **Branding**, then the **Preview Brand Book** button under the heading. The button is shown only to master access and only where the prototype is on; it is an ordinary link inside the same visit, so the client's organization, your master-access session and the Owner/Member preview all carry over, with no separate client sign-in. The numbered bar's "Current Branding page" link comes back.
- **If a direct link lands on the client directory:** a request with no live session (never signed in on that address, or the session ended) is sent to sign-in, and sign-in always finishes on `/portal`, which for master access is the client directory. The portal does not remember the page you asked for (unchanged; it is an authentication behaviour, not a Brand Book one). Sign in again and use the button, or open the link once signed in.
- **Staging only:** the routes answer only where `PORTAL_BRANDING` **and** `PORTAL_DEMO` are on (`bookOn` in `router.js`). `PORTAL_DEMO` is the existing Staging-only switch and stays off on Production, so this is a 404 there even if the code is released. No new flag.
- **Read-only:** it shows the published brand kit and the files Framework placed in it. Every download and preview is the existing permission-checked route (`/branding/files/<id>`). It posts nothing. Requests, uploads, Brand Discovery and pricing offers stay on the Branding page, linked from the cards. No migration, no new data.

## The seven cards (mapped to what Branding already holds)
| Card | Holds | Branding section(s) |
| --- | --- | --- |
| 01 Brand Overview | Brand name, tagline, a contents list with each section's state, progress, last published | 04 Tagline (+ completion of all nine) |
| 02 Logo System | The four logo variations, formats to download | 01 Logo |
| 03 Colour Palette | Swatches with HEX/RGB and copy buttons | 03 Brand Colours |
| 04 Typography | Primary, Secondary and Accent typefaces, the hierarchy, font files | 02 Typography |
| 05 Imagery & Textures | Approved imagery and texture files | 05 Brand Imagery, 07 Textures |
| 06 Layout, Icons & Style | Layout, icon and design-style files | 06 Layout System, 08 Iconography, 09 Design Style |
| 07 Documents & Assets | Guidelines, documents, packages, other files; links to request and upload | "Documents and other files" |

The nine existing sections are all present; they are grouped into seven cards so each card is a real "page" of the book. Cards reuse the existing fragments (logo cards, swatches, type cards, file tiles) unchanged, including the labelled "Example: Framework" content where a section is empty.

## Scroll behaviour
- The **page scrolls natively**. Nothing is captured, snapped or re-timed. A pinned stage holds the deck while the page scrolls through a runway; each card's position is computed from how far the page has scrolled (about one screen of scrolling per card, a short pause on each card, then the next rises over it).
- Card 01 is fully shown on load. Cards 02 to 07 wait at the bottom, each offset so its number and name stay visible. The previous card eases back (slight scale, a dim, its edge still visible) as the next rises. No rotation or 3D; a soft shadow gives depth; easing is a smoothstep.
- **Tall content:** the active card's content scrolls inside the card (focusable, with a fade at the foot while there is more) and hands over to the page at its end.
- **Navigation:** a numbered index in the bar always works (smooth scroll to that card); clicking a waiting card's tab does the same; `#colours`-style links open that card.
- **Mouse wheel, trackpad, touch, keyboard:** all native scrolling. Cards that are not active are `inert` (not focusable, not read out), so keyboard focus cannot land on a hidden card. A polite live region announces "Card 3 of 7: Colour Palette" when the active card changes.
- **Reduced motion, no script, short screens (under about 520px high), no `position: sticky`:** the same cards as a plain vertical stack. Switching the setting takes effect live.

## Visual direction
- Framework's identity: sharp corners, ruled lines, Switzer for display and General Sans for text, large numerals.
- Each card is a **coloured cover** (big numeral, title, description, status) beside a **white sheet** that carries the content, so existing content stays legible on any card colour.
- **Colour:** the client's own published colours (primary, secondary, accent, neutral first) when there are three or more, with black or white text chosen for at least 4.5:1 contrast; otherwise Framework's set (ink, warm paper, vermilion, deep green, mist blue, indigo, saffron). The colours reach the page through a generated stylesheet (`book.css`) of validated `#rrggbb` values only; no inline style anywhere (the portal's CSP is unchanged).

## Verified
Automated tests (`worker/test/portal-branding-book.test.mjs`): the Staging gate, tenant isolation, read-only (no forms), no inline style or script, existing file routes, colour validation and contrast, the script's limits (nothing fetched or stored, no wheel/touch capture), and that the Branding page is untouched. In a real browser (Chromium): desktop, iPad and phone sizes, no console or CSP errors, keyboard focus never entering an inert card, the index, deep links, wheel scrolling inside a card then handing over to the page, reduced motion switched on and off live, and a short window. Not yet tried on physical iOS or Android devices, or with a very large brand (many files).

## Not in the prototype (decisions for review)
1. **Request, upload and Discovery controls inside the cards.** The prototype links to the Branding page for these. A full version would bring the request buttons, design offers and prices, upload and Brand Discovery into the relevant cards.
2. **Admin:** no change; the same data feeds both views.
3. **Whether it replaces the Branding page or sits beside it** (and whether the Branding link on Home should go to it).
4. **Card grouping and names** (seven cards above); **colour source** (client palette versus Framework's fixed set); **pace** (one screen of scrolling per card).
5. **Phones:** the deck works at phone size; an alternative is a plain stack with sticky headers below a width.
