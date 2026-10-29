# Websites (Client Portal Website section)

Status: **Phase 1** (database foundation and Framework Admin). Nothing is shown to clients: no client route, no hub change, no `PORTAL_WEBSITE` flag in any environment.

## Model (migration 0011, proposed until approved)
* `websites`: several per client. `status` is `existing | in_development | live`; **"No website" is not stored** (a client with no rows has none). `managed_by_framework` is a separate yes/no, so a client's own live site and a live site Framework manages are different rows of the same status. `origin` says who built it (a site in development is always built by Framework). Domain and hosting are plain facts (provider, who owns it, renewal date) and notes: never credentials. One optional private screenshot (png, jpg or webp, up to 5 MB) in the files bucket under `org/<id>/websites/`; `published` says whether the client may see the website once the section is switched on. Archived websites are hidden, never deleted; up to 12 active per client.
* `website_milestones`: title, status (`todo | in_progress | done`), due date, order; tied to their website and organization by a composite key. Used from Phase 3.
* `support_requests.website_id`: nullable; lets a website change request name its website (Phase 4). The Worker only accepts a website of the same organization.
* The four website services (Design, Redesign, SEO, Maintenance) are rows of `service_prices`, defaulting to a custom quote, and appear in Admin -> Settings -> Service Pricing.

## Admin (this phase)
`/admin/clients/:id/website`: add, edit, archive and restore websites, set or remove the screenshot. API: `worker/portal/admin-websites.js`; data layer `repo/websites.js`; screenshot `website-files.js`.

## Phases
1. Foundation and Admin website management (this).
2. Client dashboard behind `PORTAL_WEBSITE` (four states: no website, existing, in development, live).
3. Milestones and progress (Admin editor, client timeline).
4. Change requests and feedback on the existing Client Services request infrastructure, independent of `PORTAL_SERVICES`; the service offers for design, redesign, SEO and maintenance.
5. Files and handover documents.
