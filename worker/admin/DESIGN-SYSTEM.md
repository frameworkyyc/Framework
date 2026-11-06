# Framework Admin design system

One system for every Admin page, in two parts that are both required: **Framework's visual identity** and **the usability standards**. The benchmark for the information design is the Brand Discovery review (`admin/assets/discovery.js`): a page you can read in seconds, with the detail one click away, drawn in Framework's own language. **Every new or changed Admin screen follows this document**, uses the shared kit before inventing markup, and keeps the guard tests green (`worker/test/portal-admin-design-system.test.mjs`).

## Framework identity (required, tested)

The Admin looks like Framework, not like a generic SaaS dashboard.

- **Sharp corners only.** No `border-radius` (a status dot may be a circle; nothing else), no rounded cards, no pill-shaped buttons, chips or filters, no shadows, no gradients, no tinted panels.
- **Lines, not boxes.** One black rule opens a section; hairlines separate rows. A boxed tile (a client dashboard tile, a stat cell) uses a hairline square outline.
- **Type.** Display face (`--font-display`, Switzer) for titles and for the numbers that matter; body face (`--font-body`, General Sans) for everything else; small labels are 12px, uppercase, `letter-spacing: .14em`, in `--slate`.
- **Colour.** Black on white, `--slate` for secondary text, `--hairline` and `--mist` for structure. A status colour appears only as a small square marker, a left edge or a chip with its text, never as a background wash on a whole region.
- **Pictures are the content.** Photos, swatches, lettering samples and sketches sit in square frames with a square outline; likes get an ink outline and a tick, "not for me" is quiet, struck through, with a cross.
- **Do not copy old patterns that break these rules** (some older components were rounded; they have been corrected).

## Usability standards (required)

1. **Hierarchy.** The top of a page is what matters most: a state, a number, what needs a person. Secondary detail is one click away (a fold), never above the main content.
2. **Scannability.** Concise labels, short headings, logical blocks, meaningful icons. Delete a sentence that repeats the heading; keep a sentence that changes a decision.
3. **Show, don't tell.** Prefer a meter, a status marker, a swatch, a picture, a timeline or a simple bar chart to a sentence. Use real numbers; never invent data.
4. **Intuitive interaction.** The common task is the obvious one; management and destructive actions live in a closed "Manage" section or apart from the main action; a long form is grouped into folds with a one-line summary each and its Save stays in view.
5. **Simplify.** No cluttered tables (six columns at most; permissions become badges; on a phone a row becomes a stacked record), no empty sections (one quiet line instead), no scrolling to reach the main content.
6. **Consistency.** The same kind of information is always shown the same way (see the components below), so a new feature is understood without explanation.
7. **Same on a phone.** Single column, 44px touch targets, no sideways scroll at 320px.

## Tokens (`admin/assets/admin.css`, `:root`)

| Token | Use |
| --- | --- |
| `--ink`, `--paper`, `--slate`, `--hairline`, `--mist` | text, surface, secondary text, borders, quiet fill. Never use `--stone` for text (low contrast). |
| `--ok`/`--ok-bg`, `--warn`/`--warn-bg`, `--bad`/`--bad-bg`, `--pend`/`--pend-bg` | the four statuses: done or healthy, needs a look, broken or overdue, informational or in progress |
| `--adm-space-1…6` 8, 12, 16, 24, 32, 48px | the only spacing steps |
| (no radius token) | there is no corner radius in Framework; do not add one |

Page title: `.adm-title` (the large display title, unchanged). Section title: `.adm-section-title h2` or `.rk-card__title`. Labels: 12px uppercase, `letter-spacing: .14em`.

## Components (`admin/assets/kit.js`, styles in `admin.css`)

| Component | Use it for |
| --- | --- |
| `statCard({ label, value, hint, meter, tone })` | one headline figure in the display face, with an optional square meter and a square status marker; lay out in a ruled strip with `.rk-stats` |
| `badge(text, tone)` | a status or count; tones `ok`, `warn`, `bad`, `pending` or none |
| `card(title, body, { id, aside, wide })` | a titled group: a black rule, a heading, the content (not a box) |
| `fold({ title, number, meta, badges, open, body })`, `foldControls(container)` | collapsible sections, with Expand all and Collapse all |
| `barList(rows, { max })` | ranked comparison or a spread (native square `<progress>`, no inline styles) |
| `choiceGroups`, `choice`, `visual` | picture tiles (photo, colour swatches, lettering sample, sketch) with likes and dislikes told apart |
| `attentionList(rows, { limit })` | the few things worth a person's time, rest behind "Show more" |
| `emptyState({ title, body, action })` | "nothing here" for a whole list, with the one action that fixes it |
| `linkCard({ href, title, body, icon })` | a hub entry: a ruled row with an icon, a title, a line and an arrow (Settings) |
| `searchBox({ label, onInput })` | a boxed "find" field that filters rows already on the page |
| `navIcon(name)` | 20px line icons (module ids, `check`, `chevron`) |

Older shared pieces remain the way to do their job: `h`, `api`, `stateBlock`, `errorState`, `confirmDialog`, `fmtDate`, `fmtDateTime` (`ui.js`), the client tiles and section map (`client-dashboard.js`), `.adm-table`, `.adm-tabs`, `.adm-filter`, `.adm-banner`, `.adm-notice`.

## Navigation

The sidebar is grouped in `admin.js` (`NAV_GROUPS`: Inbox, Assessments, People, Setup) and every module has an icon in `kit.js`. A new module is added to `modules.js`, given an icon and placed in a group.

## Page patterns

- **Dashboard** (Overview, a client, an assessment): stat cards, then "needs attention", then sections, then Manage.
- **List** (Clients, Support, Feedback): a toolbar (search, filters), one rounded list, a status chip per row, an empty state.
- **Detail**: header (name, status chip), the stat row, folds for the sections.
- **Hub** (Settings): link cards.
- **Report** (Demo traffic): a one-line caveat, filters (period, one checkbox) beside the prominent export button, stat cards, a fold per visitor whose body (a timestamped timeline, `.dt-timeline`) loads when opened, then a ruled list of items with a copy button (`.dt-link`) and a closed Manage fold for create, revoke and delete. A colour choice is a square SVG swatch (`.dt-swatch`, fill attribute, no inline style). Details: `worker/DEMO-TRAFFIC.md`.
- **Form**: labelled fields in one column, the primary button last, the destructive action apart (`.adm-actions__danger`).

## How each page applies it

| Page | Pattern | What it shows first |
| --- | --- | --- |
| Overview | dashboard | what needs attention, then summary cards, then a two-column board; empty sections are one quiet line; recent feedback as cards |
| Feedback | list | stat cards (responses, satisfaction, recommend, needs attention), filters, a compact table; the share form sits in a closed fold; written feedback comes before ratings on a response |
| Support Requests | list | stat cards, then request rows with status chips; a conversation page is one open request |
| Assessments | list | a delivery-health fold (open only when email is broken), stat cards, search, the requests |
| Brand Discovery | list, detail | stat cards and assessment rows; assigning and retention are folds; the review is the benchmark dashboard |
| Clients | list, dashboard | summary cards, a find box once there are six or more, monogram rows; a client is a card dashboard |
| Invoices, Websites, Branding | client sub-pages | stat cards or rows first; creating something new is a fold; long help text is a fold |
| Approved Emails | list | one compact add row, then address rows; the Cloudflare-setting list is a fold |
| Service Pricing, Additional Services | long forms | one fold per group or service with a one-line summary; the save bar stays in view |
| Settings | hub | link cards |

Patterns worth reusing: **rows** (`.adm-reqlist` with `.adm-reqrow`: client, title, a line of facts, status chips), **long forms as folds** (`fold()` per group, a summary in `meta`, a status in `badges`, open state kept across a save), **stat cards first** (`.rk-stats` with `statCard`), **quiet empties** (`.rk-quiet` for a section with nothing, `emptyState` for a whole list).

## Rules that are tested

- No `border-radius`, `box-shadow` or gradient in the kit layer of `admin.css`, and no radius token.
- No `innerHTML`, `insertAdjacentHTML` or inline `style` in the kit or the review pages; server text is always set as text.
- Status colours come from the four status tokens, paired with an icon or text.
- Secure links and admin controls never appear above the content they manage.
- A change to a pinned test is deliberate and explained in the pull request.

## Adding a page

1. Start from the pattern above and the kit; write no new card, badge or empty-state markup.
2. Use tokens; add a new token here before using a new value.
3. Check 1440, 820, 390 and 320px: no sideways scroll, readable, touch targets 44px.
4. Add the page to the design-system test if it adds a new pattern, and describe it here.
