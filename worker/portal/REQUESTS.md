# Requests: the unified request engine and the expanded Client Portal

Status: **Phase 1 is live on Staging only: migration `0020_requests.sql` is applied there and `PORTAL_REQUESTS=1` is set in the Staging (previews) vars. Production has neither the table set nor the flag.**

## Decisions this follows (owner-approved)

- One engine for Deliverables, SEO and Custom Development requests; Website and Support requests move onto it in Phase 2 (`kind` already allows `website` and `support`).
- Workflow: Request → Review → Quote → Approval → In Progress → Client Review → Completed, plus Declined, Cancelled and Revision requested.
- Owners accept quotes and authorise paid work. Owners and members review and approve design proofs. The portal has only `owner` and `member` roles, so "owners/admins" is `owner`. Enforced server-side in `policy.js` (`requests.accept_quote` owner; `requests.approve_proof` owner and member).
- Mixed pricing: a per-service fixed price or a custom quote (`request_type_settings`, edited in Admin → Requests → Service settings). A price shows only when staff enter one. Default two revision rounds, configurable per service; extra rounds are granted by staff (`revisions_paid`), nothing is charged by the engine.
- **Payments are deferred.** The portal cannot bind a client to a quote or take money. `quote-gate.js` keeps acceptance closed until `QUOTE_TERMS.version`/`text` are filled in **and** `PORTAL_REQUESTS_QUOTES=1`. Until then staff record an agreement (`decided_via = staff_record`). Tax columns (`tax_cents`, `tax_label`) are reserved and unused. `invoices.request_id` is added for later.
- Digital delivery only. No print fulfilment.
- SEO page reads the existing `website_seo*` data only. Nothing is fabricated; Search Console and paid rank tracking are deferred.

## Where things are

| Area | Files |
| --- | --- |
| Registry (types, questions, revision defaults) | `requests/registry.js` |
| Rulebook (statuses, who may move what) | `requests/workflow.js` |
| Quote gate | `requests/quote-gate.js` |
| Data layer (every query names `organization_id`) | `requests/repo.js` |
| Service layer (uploads, brand snapshot, files) | `requests/service.js` |
| Client routes, pages, navigation | `requests/routes.js`, `views.js`, `nav.js`, `assets/css/portal-requests.css` |
| Admin API / UI | `admin-requests.js`, `admin/assets/requests.js` |
| Email | `service-notifications.js` (reuses `entity_type = support_request`; `entity_id` is the request id) |
| Tests | `worker/test/portal-requests-{engine,client,admin}.test.mjs` |

## Home and navigation (with `PORTAL_REQUESTS` on)

- Home is one design: greeting, six equal service blocks (Branding, Websites, SEO, Deliverables, Custom Development, Support; 3x2 on desktop, 2x3 on tablet, 1x6 on phones), then "Needs your action" only when something waits, then a compact Business Profile strip. Each block says in words whether the service is Active, needs the person, or is Available to request. Built in `requests/views.js` (`unifiedHome`); flag off keeps the original Home.
- Header: from 1024px the brand and account controls are row one and the ten navigation links sit on their own ruled row, so they cannot collide; below 1024px the links become a Menu button with the same ten entries. Tested for overflow, overlap and layout shift at 1440, 1366, 1180, 1024, 820, 768, 390 and 320px.

## SEO

`/seo` opens with a search performance dashboard and tracked keywords; see `worker/portal/SEO-MONITORING.md` for how it works, the Search Console and rank-tracking architecture, and the dependencies and costs. Migration `0021_seo_keywords.sql` is proposed, not applied.

## Safety properties (all tested)

- Flag off: nothing changes; new routes are 404.
- Every row is addressed by `(id, organization_id)`; another organization's request is "not found".
- Private staff notes never reach the client. Draft proofs are hidden until the request is sent for review; finals are released only on completion. Proofs are viewed inline as images, never downloaded by the client. Downloads are `attachment`, `nosniff`, sandboxed, `no-store`.
- Status moves are compare-and-swap batches that write the timeline event, audit entry and at most one notification together.
- Emails carry no request text or amounts.

## Migration 0020

1. Staging: applied (owner-approved). The file is `migrations/portal/0020_requests.sql`.
2. Production: only through the manual "Portal Production D1 migration" workflow, after a restore bookmark and before-snapshot, each run approved. `PORTAL_REQUESTS` stays off until the Production release is approved.

## Phases

1. **Engine + Deliverables foundation** (this change): registry, rulebook, repo, files, notifications, client pages, wide navigation, My Requests hub, SEO and Development pages, Admin queue/detail/settings.
2. Move Support and Website change requests onto the engine; Home and navigation polish.
3. SEO and Websites consolidation.
4. Custom Development refinements.
5. Integrations, each separately approved: Search Console, payments, invoices linked to requests.

## Blockers that need the owner

- Terms of service and approval wording (`QUOTE_TERMS`), and tax treatment, before quote acceptance or payments can open.
- Which services and prices to publish; included revision rounds per service.
- Whether a separate Admin role is wanted in the portal.
- **Services has never been live in Production** (support, invoices, notification emails). A Production release of this engine implies approving those there too, including privacy text and an approved-recipient email test.
