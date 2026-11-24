# Framework Admin design system

One system for every Admin page. It applies to **Framework Admin only**; the public website, the client portal and the Brand Book keep their own, sharper identity. The Admin is a business tool used all day, so it is allowed to be softer than the marketing site while staying recognisably Framework: monochrome, Switzer and General Sans, restrained, precise.

## Admin identity (required, tested)

A premium, modern administration platform built from cards.

- **Ground and cards.** A soft grey ground (`--ds-ground`) with individual white cards (`--ds-card`); a black card (`ink`) and a darker grey card (`tone`) are used sparingly for contrast and emphasis. No tinted washes over whole regions.
- **Shape and depth.** Gentle corners (`--ds-r-sm` 8px, `--ds-r` 12px, `--ds-r-lg` 18px; pills `--ds-pill` for status, tabs, filters and buttons), a hairline border, and soft depth (`--ds-shadow-1` for resting cards, `--ds-shadow-2` for what floats: drawers, dialogs, search, toasts). Depth and radius come only from the tokens.
- **Type.** Display face (`--font-display`, Switzer) for titles and the numbers that matter; body face (`--font-body`, General Sans) for everything else. Hierarchy comes from size and weight, not decoration.
- **Colour.** Black, white and greys. A status colour (`--ds-ok`, `--ds-warn`, `--ds-bad`, `--ds-info`) appears only as a small dot, a pill or a delta arrow, and **always with words** (never colour alone).
- **Bento layout.** A 12-column grid (`grid`, `span`): cards of different sizes and tones, one clear lead card per page, compact figures (`kpi`), no equal-height tile farms.
- **Motion.** Transitions of 150 to 250 ms (`--ds-dur`, `--ds-ease`) on hover, focus, open and close; one gentle rise when content opens. Everything is switched off under `prefers-reduced-motion`. No animation that delays the person.
- **No decoration for its own sake**: no illustrations, gradients (other than the loading shimmer), glows or stock imagery. Pictures are content (screenshots, swatches).
- **Responsive.** Same content on every size: the grid collapses to one column, a data list becomes stacked records, tabs scroll sideways, the sidebar becomes a menu. 44px touch targets, no sideways page scroll at 320px.

## Usability standards (required)

1. **Hierarchy.** The top of a page is what matters most: a state, a number, what needs a person. Secondary detail is one click away (a fold), never above the main content.
2. **Scannability.** Concise labels, short headings, logical blocks, meaningful icons. Delete a sentence that repeats the heading; keep a sentence that changes a decision.
3. **Show, don't tell.** Prefer a meter, a status marker, a swatch, a picture, a timeline or a simple bar chart to a sentence. Use real numbers; never invent data.
4. **Intuitive interaction.** The common task is the obvious one; management and destructive actions live in a closed "Manage" section or apart from the main action; a long form is grouped into folds with a one-line summary each and its Save stays in view.
5. **Simplify.** No cluttered tables (six columns at most; permissions become badges; on a phone a row becomes a stacked record), no empty sections (one quiet line instead), no scrolling to reach the main content.
6. **Consistency.** The same kind of information is always shown the same way (see the components below), so a new feature is understood without explanation.
7. **Same on a phone.** Single column, 44px touch targets, no sideways scroll at 320px.

## Tokens (`admin/assets/ds.css`, `:root`)

| Token | Use |
| --- | --- |
| `--ds-ground`, `--ds-card`, `--ds-soft`, `--ds-line`, `--ds-line-strong` | page ground, card surface, quiet fill, hairlines |
| `--ds-ink`, `--ds-text`, `--ds-muted` | strongest text and black cards, body text, secondary text (never lighter than `--ds-muted`) |
| `--ds-r-sm`, `--ds-r`, `--ds-r-lg`, `--ds-pill` | corner radii |
| `--ds-shadow-1`, `--ds-shadow-2` | resting depth, floating depth |
| `--ds-ok`, `--ds-warn`, `--ds-bad`, `--ds-info` | the four statuses (dot, pill, delta) |
| `--ds-ease`, `--ds-dur`, `--ds-gap` | motion curve, motion time, grid gap |
| `--ok`/`--warn`/`--bad`/`--pend` and `--adm-space-1…6` (`admin.css`) | the older pages' status colours and spacing steps; still defined |

Add a token here before using a new value.

## Components (`admin/assets/ds.js`; the older `kit.js` pieces remain for the review pages)

| Component | Use it for |
| --- | --- |
| `pageHead({ title, sub, actions, kicker, back })` | the top of a page |
| `grid(...)`, `span(node, cols)` | the 12-column bento grid (spans 3 to 12; one column on a phone) |
| `card({ title, sub, actions, body, foot, tone })` | a titled card; `tone`: white (default), `ink`, `tone` |
| `expander({ title, meta, body })` | a card that opens and closes (native `<details>`), for secondary content |
| `kpi({ label, value, unit, note, delta, tone, spark, href })`, `delta(pct)`, `sparkline(values)` | one compact figure, with an optional change and trend line |
| `pill(text, tone)`, `dot(tone)` | a status: dot plus words |
| `fact(label, value, { edit })`, `facts(rows)` | label and value rows inside a card, with an optional edit button |
| `tabs({ items, current })`, `segmented({ options, value, onChange })`, `crumbs(items)` | section tabs, filters, breadcrumbs |
| `button(label, { tone, icon, href, onClick })`, `switchInput`, `field` | actions and form controls |
| `drawer({ title, body })` | a panel that slides in for editing one thing in context (native `<dialog>`: focus is kept, Escape closes) |
| `toast(message, tone)` | a short, announced confirmation |
| `skeleton()`, `pageSkeleton()`, `empty({ title, body, action })` | loading and empty states |
| `barChart({ data, label, unit })` | an interactive bar chart (hover or arrow keys read a bar; "View as a table"); real data only |
| `dataList({ columns, rows, cls })` | columns on a wide screen, stacked records on a phone |
| `icon(name)` | line icons (the kit's plus websites, analytics, search, edit, close and more) |
| `openSearch()` (`search.js`) | global search over pages, clients and websites (`/` or Ctrl/Cmd+K) |

The older kit (`statCard`, `badge`, `card`, `fold`, `foldControls`, `barList`, `choiceGroups`, `choice`, `visual`, `attentionList`, `emptyState`, `linkCard`, `navIcon`, `searchBox` in `kit.js`) is still used by the review pages and is re-skinned by `ds.css`, so every page shares one look. Prefer the new components for new work.

## Navigation (`admin/assets/nav.js`)

Six sections in the sidebar: **Overview, Clients, Websites, Analytics, Operations, Settings**. Operations and Settings group the older pages; each keeps its own address, and the section's pages share one row of tabs above the content (Operations: Overview, Leads, Enquiries, Brand Discovery, Requests, Support, Feedback; Settings: Overview, Approved emails, Additional services, Service pricing). A section appears only when its module is registered in `modules.js`. The top bar shows breadcrumbs, search and what needs attention. A new page is added to `modules.js` and to the right section in `nav.js`; every existing address keeps working.

## Page patterns (older pages, still in use)

- **Dashboard** (Overview, a client, an assessment): stat cards, then "needs attention", then sections, then Manage.
- **List** (Clients, Support, Feedback): a toolbar (search, filters), one rounded list, a status chip per row, an empty state.
- **Detail**: header (name, status chip), the stat row, folds for the sections.
- **Hub** (Settings): link cards.
- **Report** (Demo traffic): a one-line caveat, filters (period, one checkbox) beside the prominent export button, stat cards, a fold per visitor whose body (a timestamped timeline, `.dt-timeline`) loads when opened, then a ruled list of items with a copy button (`.dt-link`) and a closed Manage fold for create, revoke and delete. A colour choice is a square SVG swatch (`.dt-swatch`, fill attribute, no inline style). Details: `worker/DEMO-TRAFFIC.md`.
- **Leads** (`leads.js`, `lead-panel.js`, `lead-pitch.js`, `lead-review.js`): a **segmented status filter** (`.ld-seg`, counts, scrolls sideways on a phone), ruled lead rows with a tick box, a **sticky bulk bar** (`.ld-bulk`) while anything is selected, a **review screen** (`.ld-mail` blocks, mode banner, one "Send N emails" button; nothing sends without it), and a single-column lead panel: next-action box, status action bar, then folds. Activity is the Demo traffic report (`/admin/leads/activity`).
- **Sales-intelligence detail** (the Lead page, `lead-panel.js`): the answer first, everything else behind a fold. Under the name (trade, city, status, clean host links with an inline icon) sit Approve and Dismiss, then a ruled strip of three figures (`.ld-figs`: the SEO Opportunity Score largest, the Google Maps position, the rating; a figure that was not measured shows a dash, never a guess), a one-line verdict with the three weaknesses that matter, and Outreach (contacts, then the pitch once there is a draft). Scoring breakdown, competitors, findings, Notes, the website check, sources and the timeline are folds (`.ld-folds`). The city is dropped from the business name when it is shown beside it (`shortName`).
- **Call queue** (`lead-call.js`): **Queue Call** is a secondary button in the lead's action bar (becoming **Call made** once queued). It opens one `.adm-dialog` (a date defaulting to tomorrow, optional notes; the same dialog serves one lead, many leads and reschedule). A queued lead shows the kit's `warn` chip **Pending · Call** beside its status chip, a "Call <day>" line, and **Overdue · N days** (`bad`) or **Due today** (`warn`); no new colours. The Call card (`.adm-spec` facts, **Call made**, **Reschedule**, **Remove from queue**) sits in the Outreach section. The list's **Call Queue** button (with its count) sits at the end of the status strip and shows soonest first. A queued call is a reminder and never changes the approval or outreach status.
- **Outreach tracking** (`lead-outreach.js`): **Mark as Contacted** is a secondary button in the lead's action bar, beside Approve and Dismiss. It opens one `.adm-dialog` form (radio choices from `.adm-choice` for Text / Email / Phone / Facebook / Other, notes, an optional follow-up date; the time is recorded automatically). The result is a **Contacted · Phone** chip beside the status chip and an Outreach card (`.adm-spec` facts, a due / overdue chip, one status select with notes). On the list, one outreach `<select>` (`.ld-outsel`, with counts) sits beside search, and a contacted row carries the same chip and its follow-up day. The five contact methods are one radio group of equal 48px tiles (`.ld-oc-methods .ld-method`: a thin hairline border, sharp corners; **hover** darkens the border, **selected** is an ink border on a light fill, **keyboard focus** is a 2px ring outside the tile; the whole tile is the label and the click target; 3 columns, 2 on a phone). Dates without a time (follow-up days) are shown with `dayWord`, never through the time-zone formatter. The approval status is never rewritten by any of this.
- **Simple list** (the Leads list): a title and one Actions menu (`.ld-menu`, a `<details>`), the status filter with counts, search, then ruled rows of name, trade and city, the one deciding number (`.ld-row__score`) and a chevron. No description paragraphs, no badges on rows; the status shows in the All view.
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

**Write-only secret field** (website Analytics panel, `website-analytics.js`): a credential an admin pastes but must never see again is an empty `type="password"` input with `autocomplete="new-password"`, never filled from the server; a placeholder says whether one is saved ("Saved. Leave empty to keep it"), a kit `badge` shows the state and date (`ok`, or `bad` when missing), an empty field keeps the saved value, and removing it goes through `confirmDialog`. Optional fields that depend on a `<select>` are hidden with the `hidden` attribute (scoped `[hidden]` rule), not inline styles.

Patterns worth reusing: **rows** (`.adm-reqlist` with `.adm-reqrow`: client, title, a line of facts, status chips), **long forms as folds** (`fold()` per group, a summary in `meta`, a status in `badges`, open state kept across a save), **stat cards first** (`.rk-stats` with `statCard`), **quiet empties** (`.rk-quiet` for a section with nothing, `emptyState` for a whole list).

## Rules that are tested

- Radius, shadow and motion come only from the `--ds-*` tokens; the design-system layer has a reduced-motion rule and no third-party scripts, fonts or images.
- No `innerHTML`, `insertAdjacentHTML` or inline `style` in the kit or the review pages; server text is always set as text.
- Status colours come from the four status tokens, paired with an icon or text.
- Secure links and admin controls never appear above the content they manage.
- A change to a pinned test is deliberate and explained in the pull request.

## Adding a page

1. Start from the components above (`ds.js`); write no new card, pill or empty-state markup.
2. Use tokens; add a new token here before using a new value.
3. Check 1440, 820, 390 and 320px: no sideways scroll, readable, touch targets 44px.
4. Add the page to the design-system test if it adds a new pattern, and describe it here.

## Analytics (`/admin/analytics`)
The portfolio across every client website: KPI cards (connected counts, last-read totals), a page-views bar chart, a Connections card (what the server is set up to read), a filterable data list and a troubleshooting card. It is built from `GET /api/admin/analytics/summary`, which is read-only and returns only saved settings and the last cached 30-day figures with their read time; nothing is fetched live and nothing is estimated ("Not read yet" otherwise). Each row opens the website's Analytics tab (`/admin/websites/:id/analytics`), the existing multi-account settings panel (site tag, property, the client's own Cloudflare account and write-only token, Test). `/admin/analytics/:id` redirects there.

## Operations Invoices, Settings and the Overview chart
- `/admin/operations/invoices`: every client's invoices (`GET /api/admin/invoices`, read-only; no storage key, note or description). Rows open the client's Billing tab, where invoices are still created and edited.
- `/admin/settings`: grouped cards (people and access, services and pricing, integrations status as booleans, and a "Not tracked yet" card listing what Framework does not store).
- Overview "Weekly activity" card: `GET /api/admin/dashboard/trends` (eight Monday-start weeks of the allow-listed activity events, counts only).

## The client portal
The client portal uses the same visual system (soft grey ground, white cards with gentle corners and soft depth, pill navigation and buttons, status pills with a dot and words, short motion that respects reduced motion) through `assets/css/portal-ds.css`. It is loaded last on every signed-in portal page (`worker/portal/frame.js`), so it only changes appearance: markup, URLs, permissions and APIs are untouched. The dashboard-style pages (Home, Website) lay out their own cards; every other page's content sits in one white card. The portal stays simpler than Admin: clients only see what is theirs. The sign-in and system pages (`body.auth`) and the Brand Book keep their own design. Tokens in `portal-ds.css` mirror `admin/assets/ds.css`; change both together.

## Overview: Needs attention and Client activity
- **Needs attention** is a grid of compact cards (tone icon, what, where to go, X). The X is remembered on the server for every admin: `POST /api/admin/activity/state` with `{ scope: "attention", key, fingerprint, state: "dismissed" }`. Each item has a stable `key` and a `fingerprint` of the issue as it is now (a count and the newest item), so the same issue stays away and a new occurrence comes back. The "notifications not emailed" warning keeps its own confirmed dismissal. Undo is offered inline.
- **Client activity** (`GET /api/admin/activity`) lists what clients did in the portal, built only from events the portal already writes to `activity_log` (support requests and replies, Branding and other requests, brand files, website update decisions and task answers, feedback, profile changes, accepted invitations). It never shows staff actions, page views or sign-ins, shows nothing older than 30 days and invents nothing. A burst of the same event for one client is one entry with a count. Each entry has the client, the action, the time and a link; "Action needed" entries are told apart from "For your information" ones.
- **State without a new table**: read, unread and dismissed are appended to `activity_log` as internal, organization-less admin rows (`admin.activity.read|unread|dismissed`, `admin.attention.dismissed|restored`); the newest mark wins and nothing is deleted. A dedicated table would only be worth adding if the log grows large; it is not needed now.
- **Sidebar**: the account footer is anchored to the bottom of the sidebar (the navigation scrolls above it) and the sidebar is sticky on desktop (`inset` before `top`, or the shorthand resets `top`).


## Website environment cards

Production and Staging are two cards of the same shape (`card` with class `ds-env`): the environment name and a status pill, the address, the screenshot (`.ds-eshot`, 16:10, or a neutral "No screenshot yet" panel; never an invented image), then **Open** and **Edit**. Edit opens that environment's settings drawer: the address form, then the screenshot control (`shotEditor` in `site-blocks.js`: preview, file input, Upload / Replace, Remove). There is no separate Screenshot card.

## Review tab panels

The Review tab's expanded panels (Website updates, Needed from the client; root class `adm-wsr`) follow one rhythm: a 1px bordered, rounded panel with 24px side padding in the summary and body (16px on a phone); a small uppercase section label ("Existing updates", "Add an update") above each group; each existing item as a soft card with 22-24px padding; the Add form as its own white card; fields in a grid (Title and long text full width, selects in equal columns of at least 260px, never stretched edge to edge); inputs, textareas and selects 48px tall with 14px side padding; one action row per item, separated by a hairline, Archive pushed to the right.

## Client workspace: renaming, card padding, actions menu
- **Edit client name** sits beside the client heading (hidden under 600px) and is the first item of the three-dot menu. It posts `POST /api/admin/clients/:id/rename {name}` and only changes `organizations.name`; id, slug, status, people and records are untouched, and an `org.renamed` audit row records the old and new name. A same-name save is a no-op.
- **Disclosure cards** (`.adm-acc--quiet`, `.adm-acc--step`: Organization details, Business Profile sections) use 24px side padding on desktop and 16px under 600px, a hairline under the open summary, and hairline row separators without a trailing one.
- **Actions menu** (`.adm-menu`) is a rounded white card with soft depth, 44px rounded items, a hover/focus tint, and a separated destructive item (`adm-menu__item--sep`, `--danger`). The typed-DELETE confirmation is unchanged.

## Client Portal system pages and Request a change
- `body.auth` pages (the portal's own sign-in step, no access, errors and the master-access client directory) use the portal skin in `portal-ds.css`: grey ground, one white rounded card, pill buttons and fields. The editorial black sign-in (`body.si-body`) is separate. The directory lists clients as `dir__card` tiles (initial, name, arrow) and has a labelled empty state.
- AuthKit (hosted by WorkOS) can only be themed from WorkOS branding: large radius, grey page ground, black pill buttons, rounded card and fields (custom CSS elements). It is set per WorkOS environment; Staging only so far.
- Request a change is one full-width black pill with a plus (`wd-rq__btn`); the form opens in a white card beneath it.

## Environment label and switch link
- On Staging both portals show a small amber "Staging" pill (Admin: top of the sidebar footer and the mobile bar; client portal: beside the logo in the one-row header). Production shows no label.
- Framework staff get "Switch to Production" (on Staging) or "Switch to Staging" (on Production): Admin sidebar footer under Sign out; client portal account bar on desktop and the Menu dropdown on mobile, above Sign out. Client accounts never get it (server-side staff check, `worker/portal/env-switch.js`).
- Links are fixed entry points (`/admin`, `/portal`) on the verified hosts `frameworkco.ca` and `staging.frameworkco.ca`; no session, token, query or client path is carried, and the destination enforces its own sign-in and permissions. Other hosts (workers.dev, localhost) show nothing.

## Client Portal Branding hub
Four link cards (2 x 2 from 641px, four compact rows on a phone; `bh-card`), then a small Brand Discovery link while one is waiting or in progress. Each view uses `viewHeader` (breadcrumb, Back to Branding, title, the action beside the title on desktop and full width below it on a phone). The logo library uses `lg-card` tiles and a bottom sheet (`lg-sheet`) on phones and a centred card elsewhere. Styles: `assets/css/portal-branding-hub.css`.
