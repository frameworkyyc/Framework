# Websites (Client Portal Website section)

Status: **Phase 2** (client dashboard) on top of Phase 1 (database foundation and Framework Admin). The client Website section exists only where `PORTAL_WEBSITE` is exactly "1"; the flag is unset in every environment until it is approved, so clients still see the "Coming soon" line.

## Model (migration 0011, proposed until approved)
* `websites`: several per client. `status` is `existing | in_development | live`; **"No website" is not stored** (a client with no rows has none). `managed_by_framework` is a separate yes/no, so a client's own live site and a live site Framework manages are different rows of the same status. `origin` says who built it (a site in development is always built by Framework). Domain and hosting are plain facts (provider, who owns it, renewal date) and notes: never credentials. One optional private screenshot (png, jpg or webp, up to 5 MB) in the files bucket under `org/<id>/websites/`; `published` says whether the client may see the website once the section is switched on. Archived websites are hidden, never deleted; up to 12 active per client.
* `website_milestones`: title, status (`todo | in_progress | done`), due date, order; tied to their website and organization by a composite key. Used from Phase 3.
* `support_requests.website_id`: nullable; lets a website change request name its website (Phase 4). The Worker only accepts a website of the same organization.
* The four website services (Design, Redesign, SEO, Maintenance) are rows of `service_prices`, defaulting to a custom quote, and appear in Admin -> Settings -> Service Pricing.

## Admin (this phase)
`/admin/clients/:id/website`: add, edit, archive and restore websites, set or remove the screenshot. API: `worker/portal/admin-websites.js`; data layer `repo/websites.js`; screenshot `website-files.js`.

## Client dashboard (Phase 2, behind `PORTAL_WEBSITE`)
Routes (all `website.view`, owners and members, behind the tenant guard): `/portal/o/<slug>/website` (empty state, one website in full, or a list), `/website/<id>` (one website) and `/website/<id>/screenshot` (the image through an authorised route; same sandboxed headers as every file). Four states: no website (empty state with a "Talk to us" email link; nothing stored), existing, in development, live. Status and "managed by Framework" are shown separately. Data layer `repo/client-websites.js`: only `published = 1` and unarchived websites of the member's own organization, never management notes, `updated_by` or storage details; a missing table reads as no websites but any other database failure is an error, never "no website". Page `website-live.js`. The flag is independent of `PORTAL_SERVICES` and `PORTAL_BRANDING`.

## Phases
1. Foundation and Admin website management (done).
2. Client dashboard behind `PORTAL_WEBSITE` (four states: no website, existing, in development, live) (done; flag off everywhere).
3. Milestones and progress (Admin editor, client timeline).
4. Change requests and feedback on the existing Client Services request infrastructure, independent of `PORTAL_SERVICES`; the service offers for design, redesign, SEO and maintenance.
5. Files and handover documents.
