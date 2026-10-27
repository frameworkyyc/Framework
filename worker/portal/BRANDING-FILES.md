# Branding and private files: Phase 1 (infrastructure) design

Status: **Phase 1 (infrastructure) and Phase 2 (Admin interface) are on Staging. Migration 0005 is applied to the Staging database only; Production has no bucket, no migration and no Branding.** The client-facing pages (Phase 3) are not built.

## What exists

| Piece | Where | Notes |
|---|---|---|
| Migration (proposed) | `migrations/portal-proposed/0005_branding.sql` | Four additive tables. Outside `migrations/portal` on purpose, like 0004 was, so nothing can apply it until it is moved after approval. |
| Private storage | `worker/portal/files/storage.js` | R2 binding `PORTAL_FILES` (exists on Staging; **no Production bucket or binding**). |
| Validation | `files/sniff.js`, `files/zip.js`, `files/names.js`, `files/limits.js` | Allowlist, content checks, filename cleaning, limits. |
| Responses | `files/response.js` | The only way a file leaves the portal. |
| Data layer | `repo/brand.js` | Kit, deliverables, client uploads, service requests, audit. |
| Service layer | `brand-files.js` | Permissions + validation + storage + database, with write ordering and cleanup. |
| Permissions | `policy.js` | `branding.view`, `branding.upload` (owner, member); `branding.delete_upload`, `branding.request` (owner). |
| Services catalogue | `brand-services.js` | Business Card Design, Professional Email Signature Design. Code, not a table. |

## Schema (migration 0005, proposed)

* `brand_kits(organization_id PK, status draft|published, colours_json, typography_json, published_at/by, updated_at/by)` one per organization. Colours and typography are small validated JSON arrays (HEX `#RRGGBB`, roles, weights 100..900, https-only source links).
* `brand_assets` Framework deliverables: kind (logo, guideline, document, font, package, other), title, variant key, logo role (primary/simplified/icon), orientation, tone (light/dark/colour/mono), transparent, usage note, `downloadable` + `license_note` (fonts), format, server-decided content type, size, SHA-256, `storage_key` (unique), sanitised original name, `published`, sort order, `deleted_at` tombstone.
* `brand_uploads` client submissions: category (logo, fonts, colours, guidelines, stationery, signature, other), the same file metadata, `uploaded_by`, `font_rights_ack` (a CHECK requires it for the fonts category), `status available|held`, `admin_seen_at`, `deleted_at/by`.
* `service_requests` generic "Request a quote": `service_key`, status new/contacted/closed/declined, note, requester, handled by/at, admin note. A partial unique index allows **one open request per organization and service**.
* Every table has `organization_id NOT NULL REFERENCES organizations ON DELETE RESTRICT`; ids are checked as UUIDs; CHECK constraints are the backstop for everything the code validates first. Nothing existing is altered.
* File **content is never in the database**; audit uses the existing `activity_log` (no new table).

## Visibility rules

* A client sees a deliverable only when **the kit is published AND the asset is published AND it is not deleted**. A draft kit looks exactly like no kit (`{ published: false }`); unpublished assets are never listed, and never downloadable, even by id.
* Fonts are listed with their licence note but are downloadable only when Admin sets `downloadable` **and** records a licence note (enforced in code).
* Client uploads and deliverables are different tables and different functions. There is no path that turns an upload into a deliverable, and no client function writes a deliverable.
* `held` uploads cannot be downloaded by anyone (client or Admin) until released; Admin can release or delete them.

## File handling

**Storage.** Private R2, reached only through the Worker binding (no public bucket, no custom domain, no presigned URLs). Key: `org/<organization uuid>/<brand-assets|brand-uploads|files>/<random uuid>`: the organization is in the key, the name is random, no client text is ever in a key. Objects are stored as `application/octet-stream` (the validated type lives in the database), tagged with the organization, and written with their SHA-256 so R2 rejects corrupted bytes. Every read re-checks the key's organization **and** the organization on the object.

**Upload pipeline** (clients and Admin): size check (client 25 MB default, Admin 50 MB; configurable) -> filename cleaning -> extension allowlist -> content check by type -> SHA-256 -> store -> insert (quota and membership enforced inside the one insert statement) -> if the insert is refused, the stored object is deleted. The server decides the recorded type; the browser's Content-Type is never read.

**Allowed types:** png, jpg, webp, svg, pdf, ai (PDF-compatible only), eps, ttf, otf, woff, woff2, txt, docx, xlsx, pptx, zip (download-only). Refused: executables and scripts, HTML, macro-enabled Office files, old binary Office (doc/xls/ppt), other archive formats, GIF, and anything whose extension and content disagree.

**Content checks.** PNG/JPEG/WebP signatures (PNG dimensions bounded); fonts by signature and table count; **SVG**: no scripts, event handlers, `foreignObject`, iframes/objects, DOCTYPE/entities, external or `data:` references (only `#fragment` references), `@import`; numeric-entity tricks are decoded first; **PDF/AI**: refuses JavaScript, Launch, embedded files, auto-open and additional actions, XFA, RichMedia, and encryption (also when the name is hex-escaped); **EPS**: refuses PostScript file/pipe/device operators; **Office (docx/xlsx/pptx)**: must be a valid package with its expected parts and no macros, ActiveX or embedded objects; **TXT**: valid UTF-8, no NUL.

**ZIP (download-only, never extracted, never previewed).** Only the central directory is read; nothing is decompressed. Refused: encryption, ZIP64, unusual compression, more than 2000 entries, path traversal / absolute / drive / backslash names, symlinks, executable and script entries, nested archives, a directory that disagrees with the file's own headers, and bomb-shaped size claims (over 1 GB declared, or a ratio over 100).

**Downloads.** Always `Content-Disposition: attachment` with a sanitised, RFC 5987-encoded name, `Content-Type: application/octet-stream`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`, a sandboxing `Content-Security-Policy`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer`. The **only** inline case is a Framework-published logo image (png/jpg/webp/svg) for an `<img>`; client files are never inline and never previewed.

**Replacement and deletion.** Replace: store new object -> swap the key on the row -> delete the old object (a failed delete is logged and found by the orphan check). Delete: tombstone the row (`deleted_at`, unpublished) -> delete the object at once. Offboarding (`deleteOrganizationFiles`) removes every object under the organization's prefix (including orphans) and tombstones every row; it is idempotent. `findOrphanObjects` lists stored objects no live row refers to.

**Audit.** Every download and file change writes an `activity_log` entry (actor type, actor, entity type and id, time; all `internal`) in the same transaction as the change. Entries hold **no URL, key, token or file name**. `brand.storage.cleanup_failed` marks an object that needs the orphan check.

## Residual risk (be clear about this)

Attachment headers and extension checks do not make a file safe, and nothing here is an antivirus. These checks stop mislabelled files, executables, scripts in images/PDFs/SVG, macro Office files, PostScript file operators and hostile ZIP structure. They do **not** detect a new or well-hidden exploit aimed at a PDF reader, font renderer, image library or Office app on **a person's computer that opens the file**. Cloudflare's malware scanning for uploads is not part of this plan's account. What reduces the risk:

1. Client files are never rendered in the portal or Admin (no inline, no preview, no thumbnails, no ZIP listing).
2. They are served as opaque bytes with a sandboxing CSP.
3. Narrow allowlist; no executables, macros, HTML or other archives; ZIPs are never opened by us.
4. Admin can **hold** a file (nobody can download it) and delete it.
5. Hashes are stored so a file can be checked later (for example against a threat-intelligence service) without re-reading it.
6. Staff guidance (for Phase 2's Admin screen): open client files only on a patched machine, preferably in a sandboxed viewer, and treat ZIPs and Office files as the riskiest.
7. Limits (25 MB, 50 files, 250 MB) bound how much can be stored and how fast.

Optional later hardening, only if you want it: an on-demand malware check by hash or file via an external service (needs a privacy decision, because the file would leave Cloudflare), or restricting clients to images and PDFs.

## Retention and deletion

**Decided (2026-10-26):** files stay available during an active client relationship and are generally kept for **90 days afterward**, subject to contractual, legal and privacy requirements. Owners and members can access shared branding files. Staff download activity stays internal (it is not shown to clients). Nothing in the code hard-codes the period: offboarding is an explicit action (`deleteOrganizationFiles`), run by Framework when the relationship has ended and the 90 days have passed (or earlier on a valid request).

Still to settle before Production (wording, not code):

1. Whether deliverables Framework made are kept longer than client uploads, and whether any file is kept longer for a legal or contractual reason (for example an unpaid account or a dispute).
2. Whether deleted-file **metadata tombstones** (name, hash, time) are kept, and for how long.
3. The backup statement: R2 has no versioning here and a deleted file is not recoverable from R2; D1 has Time Travel (about 30 days) for the database only.
4. Who can ask for early deletion and how (today: an owner deletes uploads; Framework runs `deleteOrganizationFiles`).
5. How the 90-day period is tracked (a reminder when a client is archived, since there is no scheduled job).

## Staging migration: applied (Staging only)

Applied on 2026-10-26 to `framework-portal-staging` (id `1edda8a2-5249-4f40-9dbc-d29aa44e21f8`). Before: migrations 0001 to 0004 recorded, no branding tables. A Time Travel bookmark was recorded first. After: the four tables and four indexes exist, `0005_branding.sql` is recorded in `d1_migrations`, and the existing organizations, memberships and data were not touched. The statements were exactly the file's contents, run through the D1 API (the sandbox has no `wrangler` login) and recorded in `d1_migrations` by hand, which is what `wrangler d1 migrations apply` would have done. The Production workflow's expected list deliberately does **not** include 0005, so it fails closed if 0005 ever appears pending there.

## Generated file names (Admin uploads)

Deliverables are named by the system, not typed: `Company-Type-Shape-Version[-Transparent].ext` for logos (`Framework-Primary-Square-Light-Transparent.png`) and `Company-Name.ext` for everything else (`Framework-Brand-Guidelines.pdf`). The company part comes from the organization's name (ASCII letters and digits, words joined by hyphens, at most 30 characters, falling back to the portal address, then "Client"). The one rule lives in `admin/assets/brand-names.js`, a pure module used by both the Admin form (the live preview) and the server (which recomputes the name and never trusts one from the browser). The stored `original_name` is that generated name, so every download, for staff and for clients, uses it. The formats of one logo variant share a stem and a `variant_key` and differ only by extension.

* **No duplicates, no overwrites:** the insert, rename and replace statements refuse, atomically in the database statement itself, a name already used (case-insensitively) by a live file of the same organization (`duplicate_name`). Nothing is renamed with a suffix behind the staff member's back; the Admin form warns before uploading.
* **Editing:** publishing, notes, order and fonts' licence settings never rename a file. Changing a naming detail (logo type, shape, version, transparency, or a non-logo's name) regenerates the name consistently. The file type cannot be changed after upload. Replacing keeps the file's stem and takes the new file's extension.
* **Older files keep their names.** Nothing was migrated or renamed. An older file is renamed only if staff tick "Rename this file to the standard name" when editing it, or change a naming detail on purpose.
* **Brand name (optional):** the Admin Branding page has a Brand name field. When set it is used for the company part of generated names instead of the organization's full name ("Framework Test Organization" with brand name "Framework" gives `Framework-Primary-Square-Dark.png`); when empty, the organization's name is used. It is stored on the kit (`brand_kits.brand_name`, migration 0006, nullable, at most 60 characters). Saving, changing or clearing it never renames an existing file; a file takes the current brand name only when it is explicitly renamed (the opt-in rename, or a deliberate change to a naming detail).
* Uniqueness is enforced inside the statements; the file name uses the existing `original_name` column.

## Migration 0006 (brand name): applied to Staging only

Applied 2026-10-27 to `framework-portal-staging` after confirming the target and recording a Time Travel bookmark (`000000a3-00000000-0000510f-13f013a86927a34740827a6dc3472352`): one nullable column, existing rows get NULL, nothing was renamed, the published kit and the uploaded logo were untouched. Recorded in `d1_migrations`. Production: not applied; its workflow's expected list does not know 0005 or 0006 and fails closed.

## Phase 2: the Admin interface

Admin only (behind Cloudflare Access and `ADMIN_EMAILS`); clients cannot reach any of it. `/admin/clients/:id/branding` (linked from the client page's Branding row and its "Next step" card): upload and organize logo variants and brand files (draft until published), edit colours and typography, publish or unpublish single files and the whole kit, replace and delete files, review and download client uploads (hold, release, delete), update service requests, and run a storage check. API: `worker/portal/admin-branding.js`. The client page also receives a branding summary (kit state, files, new uploads, open requests) which feeds its "Next step" card.

Tested against real Staging: the exact SQL of every write path was replayed on the Staging D1 (all statements accepted, change counts as expected, the one-open-request rule enforced by the database), the read paths were run against the real data, and the full Admin read stack answered from the real database. R2 could **not** be exercised from the build environment (no R2 credential), so the Admin has a "Run storage check" button that writes, reads back, isolates and deletes one tiny object in the real Staging bucket and logs the result (`brand.storage.selftest`).

## Before Production (all separate approvals; none done)

1. Create the private bucket (suggested `framework-portal-files`) and add the `PORTAL_FILES` binding to the **top-level** `wrangler.jsonc` (no public access, no custom domain). The wrangler-config test must be updated in the same change.
2. Apply 0005 to `framework-portal` through the manual Production workflow after the Staging run.
3. Publish the privacy policy amendments (see `PRIVACY-BRANDING-DRAFT.md`) after adviser review.
4. Decide the retention items above.
5. Add `branding` to `LIVE_AREAS` only when the pages exist and have been reviewed.

## Phase 3: the client Branding page (Staging only)

Enabled by `PORTAL_BRANDING = "1"` in `previews.vars` only (never the top-level vars, so never Production). Without it Branding stays the "Coming soon" page and the routes below answer 404.

| Route (under `/portal/o/:slug/branding`) | Who | What |
| --- | --- | --- |
| `` (GET) | owner, member | Published brand system, or the empty state when the kit is a draft or absent |
| `/files/:assetId` (GET, `?preview=1` for logos) | owner, member | Download of a published deliverable; previews are inline for logo images only |
| `/uploads` (GET, POST multipart) | view: both; upload: both | Separate area for the client's own materials |
| `/uploads/:id/download` (GET) | owner, member | Own organization's, non-held uploads, always as an attachment |
| `/uploads/:id/delete` (POST) | owner only | Removes a shared upload (object deleted, row tombstoned) |

Every route re-checks organization membership and permission; a file that is another organization's, unpublished, held, deleted or an unlicensed font is the same 404. Uploads use the `branding` rate-limit bucket, a CSRF token and the same-site check; the body is size-limited while streaming (`readUpload` in `form.js`). Downloads are audited (`brand.asset.download`, `brand.upload.download`) without keys or addresses. Colour swatches are SVG fills (no inline style); `/assets/js/portal-branding.js` only reveals the Copy buttons. "Request a quote" services are not part of this phase.
