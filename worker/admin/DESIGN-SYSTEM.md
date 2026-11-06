# Framework Admin design system

One system for every Admin page. The benchmark is the Brand Discovery review (`admin/assets/discovery.js`): a page you can read in seconds, with the detail one click away. **Every new or changed Admin screen follows this document**, uses the shared kit before inventing markup, and keeps the guard tests green (`worker/test/portal-admin-design-system.test.mjs`).

## Principles

1. **Answer first.** The top of a page says what state things are in (a status, a number, what needs a person). Detail sits below, collapsed when it is long.
2. **One job per page, one primary action.** Management and rarely used controls (links, archive, delete, settings) live in a closed "Manage" section at the bottom, never above the content.
3. **Show the thing, not a description of it.** Pictures, swatches, status chips and meters beat sentences. Words are for what a picture cannot say.
4. **Quiet by default.** Hairline borders, rounded surfaces, no heavy black rules, no shadows. Colour is only for status (ok, warn, bad, pending) and always comes with text or an icon.
5. **Do not put everything in a card.** A card is for a summary, a group that belongs together, or a thing you can act on. Plain lists with hairlines stay plain.
6. **Same on a phone.** Single column, 44px touch targets, no sideways scroll at 320px; tables become stacked records.

## Tokens (`admin/assets/admin.css`, `:root`)

| Token | Use |
| --- | --- |
| `--ink`, `--paper`, `--slate`, `--hairline`, `--mist` | text, surface, secondary text, borders, quiet fill. Never use `--stone` for text (low contrast). |
| `--ok`/`--ok-bg`, `--warn`/`--warn-bg`, `--bad`/`--bad-bg`, `--pend`/`--pend-bg` | the four statuses: done or healthy, needs a look, broken or overdue, informational or in progress |
| `--adm-radius` 12px, `--adm-radius-sm` 8px | cards and groups, rows and small controls |
| `--adm-card-pad` 20px, `--adm-card-border` | card padding and the hairline border |
| `--adm-space-1…6` 8, 12, 16, 24, 32, 48px | the only spacing steps |

Page title: `.adm-title` (28 to 40px). Section title: `.adm-section-title h2` or `.adm-h2` (18px). Small caps labels: 12px, `letter-spacing: .06em`.

## Components (`admin/assets/kit.js`, styles in `admin.css`)

| Component | Use it for |
| --- | --- |
| `statCard({ label, value, hint, meter, tone })` | one headline number or state, with an optional meter; lay out with `.rk-stats` |
| `badge(text, tone)` | a status or count; tones `ok`, `warn`, `bad`, `pending` or none |
| `card(title, body, { id, aside, wide })` | a titled summary group |
| `fold({ title, number, meta, badges, open, body })`, `foldControls(container)` | collapsible sections, with Expand all and Collapse all |
| `barList(rows)` | ranked comparison (native `<progress>`, no inline styles) |
| `choiceGroups`, `choice`, `visual` | picture tiles (photo, colour swatches, lettering sample, sketch) with likes and dislikes told apart |
| `attentionList(rows, { limit })` | the few things worth a person's time, rest behind "Show more" |
| `emptyState({ title, body, action })` | "nothing here" with the one action that fixes it |
| `linkCard({ href, title, body, icon })` | a hub entry that opens a page (Settings) |
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

- No `innerHTML`, `insertAdjacentHTML` or inline `style` in the kit or the review pages; server text is always set as text.
- Status colours come from the four status tokens, paired with an icon or text.
- Secure links and admin controls never appear above the content they manage.
- A change to a pinned test is deliberate and explained in the pull request.

## Adding a page

1. Start from the pattern above and the kit; write no new card, badge or empty-state markup.
2. Use tokens; add a new token here before using a new value.
3. Check 1440, 820, 390 and 320px: no sideways scroll, readable, touch targets 44px.
4. Add the page to the design-system test if it adds a new pattern, and describe it here.
