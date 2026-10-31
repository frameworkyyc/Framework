# Portal experience: Website status and SEO, Home structure, Additional Services

Migrations (proposed, not applied): `0015_website_status_seo.sql`, `0016_service_catalogue.sql`. Everything below works before they are applied (the Worker detects the missing column or table); Admin says plainly what cannot be saved yet.

- **Website status**: `websites.status` is unchanged; `websites.phase` refines it (awaiting_feedback, awaiting_approval for in_development; maintenance for live). `website-stage.js` is the one place that turns them into a label. Progress is computed from `website_milestones` (done / all) and only for a website in development; a live website says Live.
- **SEO & Search Visibility**: a subsection of one website (`/website/:id/seo`, linked from the Website page; no main navigation entry). Admin-written status, checklist, recommendations, reports (https link) and figures (`website_seo_metrics.source`, `manual` today, `search_console` reserved for a later import; nothing is imported).
- **Home**: Business Profile is the full-width onboarding section; cards in order Branding, Website, Marketing (when built), others, Client Services.
- **Additional Services**: `service-catalogue.js` is one loader plus one renderer (reusable on any page). Content and pictures per service (Admin), `client_service_state` for what a client already has, `service-relevance.js` for explicit suggestion rules. Requests reuse the existing service-request workflow.

## Per-client Additional Services and Nexus Fleet Tracker (migration 0017, proposed)
- **Per client**: Admin → Clients → [Client] → Additional Services. Show/Hide and "already has it" are `client_service_state` (0016); the Recommended label and the client's own order are `client_service_settings` (0017). No row means the global order and no label. An own order is followed exactly; without one, Recommended services come first, then Featured, then automatically suggested ones, then the global order. A service the client already has, one that is hidden, and one Framework is already doing for them is never shown, whatever else is set.
- **Nexus Fleet Tracker**: the fifth service, seeded by 0017 with exactly the supplied name, category, headline, description and six features. It has no price (set one in Service Pricing), no problem or "why" text, no pictures and no demo link until Admin adds them.
