# Discovery assessments (Brand Discovery)

A visual, step-by-step assessment that helps a client or prospect show what they like, producing a structured creative brief for Framework. **Brand Discovery** is the first type; **Website Discovery** and **Marketing Discovery** reuse everything here and only add content.

## Status

Live on **Staging only**: migration `0018_discovery.sql` is applied to the Staging database and `PORTAL_DISCOVERY` is `"1"` in `previews.vars`. It is **not** applied to Production and the flag is not set there (`migrations/portal/0018_discovery.sql` is on the Production check list, so the manual Production workflow will apply it after its own approval).

## What a recipient sees

Six steps (about 10 to 15 minutes), saved as they go, back and forward at any time, "Save and finish later":

| Step | Branding sections covered |
| --- | --- |
| 1 Personality & style | 09 Design Style |
| 2 Logo | 01 Logo |
| 3 Typography & tagline | 02 Typography, 04 Tagline |
| 4 Brand colours | 03 Brand Colours |
| 5 Imagery, textures & icons | 05 Brand Imagery, 07 Textures, 08 Iconography |
| 6 Layout & final review | 06 Layout System, a review of every choice, inspiration files, send |

Large selectable cards (SVG sketches of logo forms, design directions, textures, icon styles and layouts; palette strips; type specimens; sample taglines), multiple choice (a tick shows on a chosen card; tap it again to unchoose; no icon on unchosen cards), **I'm not sure**, **Surprise me**. The page no longer offers a "Not for me" control; the server still reads `d:` fields and the brief still shows dislikes saved earlier, an optional comment on every question, and up to ten inspiration files (PNG, JPG, WebP, PDF).

## Ways in

- **Guest link**: `/portal/discover/<token>`. No account. Admin makes the link; the address is shown once and only its SHA-256 is stored. A link expires (1 to 90 days, default 14), can be revoked, and opens exactly one assessment. A wrong, expired, revoked or archived link all return the same plain 404 page. No cookie is set. Writes need a same-origin request. Requests are rate limited (bucket `discovery`) except the pictures.
- **Signed in**: under Branding, `/portal/o/<slug>/branding/discovery[/<assessment>]`, for members of the assessment's organization (policy action `discovery.respond`; viewing uses `branding.view`). The Branding page shows a Brand Discovery card while one is assigned.

Both use the same pages and the same save logic (`discovery/routes.js`). The guest audit entry names the link (`discovery-link:<8 chars>`), never a person.

## Admin

`/admin/discovery` (assign, track Not started / In progress / Submitted / Reviewed), `/admin/discovery/<client>/<assessment>` (links, answers, files, **creative brief**, review/reopen/archive), `/admin/discovery/content` (reword, hide, reorder and add questions and options; attach a real reference picture to any option), and a Brand Discovery section on each client's Branding page. The brief is organised into the nine Branding sections, with **tensions** (liked options that pull against each other, e.g. minimal vs ornate), **contradictions** (a quality liked in one place and disliked in another), and **things to clarify** (unanswered, not sure, comment without a selection, too broad). A plain-text version can be copied.

## Separate from approved branding

Answers are stored in their own tables. Nothing here reads or writes `brand_kits`, `brand_assets` or `brand_requirements`, and tests pin that answering, submitting and reviewing leave them unchanged.

## Data (migration 0018, additive: five new tables)

`discovery_assessments`, `discovery_links` (hashed tokens), `discovery_answers`, `discovery_content` (Admin's changes over the built-in questions; nothing stored for content nobody changed), `discovery_uploads`. Every assessment belongs to **one organization** (a prospect needs a client record first, which keeps their answers and files private to them and reuses the existing storage rules). Files: inspiration uploads in `org/<id>/discovery/` (a new storage area), reference pictures in the reserved catalogue area like Additional Services pictures.

## Security notes

- Content Security Policy unchanged: no inline script or style anywhere; all pictures are SVG presentation attributes or Admin-uploaded PNG/JPG/WebP served by the Worker; the page works without JavaScript (`assets/js/discovery.js` only tidies choices).
- Uploads: type decided from content, size and count limits, never inline, stored as `application/octet-stream`, no key ever returned. SVG is not accepted from a recipient.
- Every client-side read names the organization as well as the assessment id; another organization's id is "not found".
- Answers can be written only while Not started or In progress; the condition is part of the write statement, so a save cannot slip in after a submit.
- The assessments' discovery uploads are kept with the assessment (like invoices and website records) and are not removed by `deleteOrganizationFiles`.

## Before Production

1. A Production release approval, then the manual Production D1 workflow (verify-only first, then apply) with a restore bookmark and before-snapshot. 0018 is additive: five new tables, three indexes, nothing existing touched.
2. `PORTAL_DISCOVERY` stays off in Production until that release is approved (it needs `PORTAL_BRANDING` and the `PORTAL_FILES` binding, both on in Production).
3. Assessments must belong to an existing client organization; there are no standalone prospect records yet.

## Adding another type (for example Website Discovery)

Add an entry to `KINDS` in `discovery/catalogue.js` (stages, questions, options with `tags`) and, if it needs new picture types, a generator in `discovery/visuals.js`; add its section labels and a brief rule set if the nine Branding sections do not fit. No migration, route or Admin change is needed for new content; allow the new kind in `KINDS` only when it is ready.

## Keeping the content inclusive and compatible

- **Any industry.** Questions, descriptions and sample taglines are written for contractors, retail, hospitality, beauty, creative and wellness businesses alike. Creative and holistic directions (holistic, mystical, ethereal, romantic, feminine, bohemian, ornamental) sit beside the modern, minimalist, industrial and corporate ones; nothing in the assessment assumes a trade. A test fails if trade-specific wording returns.
- **Never rename or remove a key.** Saved answers store option keys. `worker/test/fixtures-discovery-legacy-keys.json` lists every question and option key as first released; a test fails if any disappears, and if new options are inserted before existing ones (Admin ordering is stored by position). Add new options at the end of a question.
- **Fonts are the viewer's own.** Type specimens use fonts installed on the device (Apple, Windows and Android each ship real script and handwriting faces), so they can look slightly different between devices. An Admin can attach a real specimen picture to any option.
