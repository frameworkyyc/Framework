# Branding and private files: Phase 1 (infrastructure) design

Status: **built and tested on a feature branch for Staging. Not applied anywhere.** No routes, no pages, no Admin screens, no Production change. Phase 2 (Admin) and
Phase 3 (client interface) are separate approvals.

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

## Retention and deletion (decisions needed before Production)

Files stay available during an active client relationship. Nothing in the code hard-codes a retention period. Decisions needed from you (and, for wording, your adviser):

1. How long client uploads and deliverables are kept **after** the relationship ends (the draft policy's 12-month inactive-account review is the nearest existing commitment), and whether deliverables are kept longer than client uploads.
2. Who can ask for early deletion and how it is requested (today: an owner deletes uploads; Framework runs `deleteOrganizationFiles` for offboarding).
3. Whether deleted-file **metadata tombstones** (name, hash, time) are kept for the audit trail, and for how long.
4. Backups: R2 has no versioning here; D1 has Time Travel (about 30 days). State that deleted files are not recoverable from R2.
5. Whether staff downloads of client uploads should be visible to the client (they are logged internally today).

## Staging migration: not applied

Confirmed read-only on 2026-10-26: `framework-portal-staging` (id `1edda8a2-5249-4f40-9dbc-d29aa44e21f8`) has migrations 0001 to 0004 recorded and **no** branding tables. The apply procedure is in `migrations/portal/README.md`, "Apply 0005 to the Staging portal database". It must not be run until you approve it, and only after: (1) the proposed file is moved to `migrations/portal/` in its own reviewed change, (2) a Time Travel bookmark is recorded, (3) the prompt names `framework-portal-staging`.

## Before Production (all separate approvals; none done)

1. Create the private bucket (suggested `framework-portal-files`) and add the `PORTAL_FILES` binding to the **top-level** `wrangler.jsonc` (no public access, no custom domain). The wrangler-config test must be updated in the same change.
2. Apply 0005 to `framework-portal` through the manual Production workflow after the Staging run.
3. Publish the privacy policy amendments (see `PRIVACY-BRANDING-DRAFT.md`) after adviser review.
4. Decide the retention items above.
5. Add `branding` to `LIVE_AREAS` only when the pages exist and have been reviewed.
