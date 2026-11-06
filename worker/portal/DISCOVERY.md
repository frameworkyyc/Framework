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
- The assessments' discovery uploads are kept with the assessment (like invoices and website records) and are not removed by `deleteOrganizationFiles`. Retention (answers and uploads: while the relationship continues and 90 days after) is a manual review today; the procedure, the guest deletion route and the known limits are in `PRIVACY-OPERATIONS.md` section 7. A removed upload keeps only its type and size (name and hash are scrubbed), and the backup purge sees `discovery_uploads`.

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

## Client-feedback round (November 2026)
- **Final step:** the intro no longer says "send them to us". The last step ends in a large **Ready to submit?** panel (black, with a white **Submit Brand Discovery** button that says it completes the assessment), and the sticky bar on a phone keeps a plain **Submit**.
- **Portal home:** the Branding card shows a small red dot and "New Brand Discovery available" while an assessment is not started, "Brand Discovery in progress" while under way, and a quiet "Brand Discovery sent" once submitted. It is listed before, and never hidden by, the brand's own status ("Brand system published").
- **Branding page:** while an assessment waits, a black card ("Your Brand Discovery is ready", button **Start** or **Continue Brand Discovery**) sits above the nine sections; once sent it becomes a quiet card. The introduction changes with the stage (not started, in progress, sent, published).
- **Picture questions (four at a time):** progress ("Showing images 5 to 8 of 16 · Reviewed 8 of 16 · 8 left"), "None of these, finish" and "I've seen them all" on the last set, then a plain **That's every image** panel with **Continue to next section** and **Review images again**. Choices stay ticked throughout. Without JavaScript every card is shown.
- **Brand Imagery:** four options appended (never reordered): Earthy, Woody, Holistic, Ethereal & mystical, with Unsplash photos (`assets/img/discovery-imagery/`) and generated sketches as the fallback.

## Admin review page (November 2026)

`/admin/discovery/<client>/<assessment>` is now a dashboard first and a record second: overview cards (status, sections answered, questions answered, files), the strongest preferences, personality words and tone of voice, then "Worth a conversation" (conflicting preferences and things to clarify, the first few shown with the rest behind "Show more"), then "What they chose" as nine collapsible sections with the actual pictures (logo, direction, imagery and texture photos, colour swatches, lettering samples, layout and icon sketches). Likes and "not for me" are separate groups with a tick or cross. Secure links, review, reopen, archive, delete and the plain-text brief sit in a closed "Manage this assessment" section at the bottom.

- Nothing about the answers or scoring changed: the brief only gained a `thumb` description on each choice (`discovery/thumbs.js`, shared with the client pages), so the page and the client saw the same picture.
- Reusable pieces live in `admin/assets/kit.js` (stat card, badge, card, fold, bar list, choice tiles, attention list); a future assessment type passes its own data to them.
- No inline styles and no markup insertion: bars are `<progress>`, swatches are SVG `fill` attributes, sketches are shown as `<img>`.

## Export for AI and PDF (November 2026)
On a **Submitted or Reviewed** assessment (Admin → Discovery → the assessment), the page header offers **Copy for AI** and **Download PDF**. Neither is shown for an assessment that is still in progress, and the PDF route answers 409 `not_submitted` for one. No table, no migration, nothing stored: each export is built on request from the assessment, its answers, its uploads' names and the same organization's Business Profile.
- **Copy for AI** (`worker/portal/discovery/export.js`): Markdown that opens with the instruction ("You’re assisting Framework…"), then client and submission details, the Business Profile answers (goals, audience, competitors, online presence, contact; blank questions are not listed), every Brand Discovery question in the questionnaire's order with the options the client liked and disliked **by name**, their comments quoted word for word (each line prefixed `> ` so client text can never become a heading or list), "Not sure" / "Surprise me", "No answer given" for an empty question, the overall comment and the names of any uploaded files. Nothing is summarised or invented. A question hidden by Admin after it was answered is still included. It is sent with the assessment (`exportMarkdown` in `GET /clients/:org/discovery/:id`) so the copy happens inside the click.
- **Download PDF** (`GET /clients/:org/discovery/:id/export.pdf`, `worker/portal/discovery/pdf.js`): a dependency-free PDF writer (US Letter, built-in Helvetica, black on white with ruled lines): details block, Business Profile, each section and question with full answers, a header and "Page n of N" on every page, long answers flowing over pages and long URLs broken after `/ ? & =`. Served as an attachment with `Cache-Control: private, no-store`. The built-in fonts draw Latin letters, accents, curly quotes, dashes, bullets and the euro sign; any other character (other scripts, emoji) prints as `?` in the PDF. Copy for AI keeps every character.
- **Who can reach it:** the same Cloudflare Access + `ADMIN_EMAILS` check as every Admin route, and the organization id in the path must own the assessment (another client's id is "not found"). There is no public or shareable URL.

## Business Profile export and the complete client brief (November 2026)
On **Admin → Clients → (client) → Business Profile** the header offers three actions, built on the same export system (`discovery/export.js`, `discovery/pdf.js`; no migration, nothing stored, GET only):
- **Copy for AI**: the client's whole Business Profile as Markdown, opening with an instruction. Every question of the questionnaire is listed in order with the client's answer word for word (long or multi-line answers are quoted line by line); a question left blank says *(Not answered)*; each section shows its status; client details (name, website on file, client since, completion, last saved) come first.
- **Download PDF** (`GET /clients/:org/profile-export.pdf`): the same content in the Admin look, a header and "Page n of N" on every page.
- **Copy Complete Client Brief**: Part 1 the Business Profile, Part 2 Brand Discovery, one document. A **Brand Discovery status** block comes first and states plainly: COMPLETE (submitted date), INCOMPLETE (started but not submitted: "N of M questions have an answer saved… may still change"; or not started), or NOT STARTED (no questionnaire assigned). What was saved so far is included and marked incomplete. The brief uses the newest Submitted or Reviewed Brand Discovery assessment, else the newest open one; archived ones are ignored.
- The page fetches the text once (`GET /clients/:org/profile-export`) so the copy happens inside the click, and notes under the buttons when Brand Discovery is not complete. Same Cloudflare Access + `ADMIN_EMAILS` check as every Admin route; only the path's organization's rows are read; a deployment without the Business Profile table answers 409 `unavailable`.
