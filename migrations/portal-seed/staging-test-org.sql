-- Framework client portal: STAGING-ONLY test data. DO NOT RUN against Production, and not against framework-staging / framework-feedback.
--
-- Target: the portal database framework-portal-staging ONLY (binding PORTAL_DB in migrations/portal/wrangler.migrate.staging.jsonc).
-- Creates one test organization, one sample project, one client-visible activity entry, and one PENDING invitation for the test
-- email address. Nothing here is a migration (it lives outside migrations/portal on purpose, so `wrangler d1 migrations apply`
-- never picks it up). It has NOT been run; see README.md in this folder for the exact, reviewed procedure.
--
-- Before running: replace the ONE placeholder in the invitation row (the upper-case token with double underscores, inside quotes, near the
-- end of this file) with the lower-case address that will sign in. If it is left in place the invitation insert is rejected by the
-- database (not a valid lower-case address) and the run stops with an error: no invitation exists.
--
-- Re-running: the organization, project and activity inserts are INSERT OR IGNORE on fixed ids. The invitation insert is a plain INSERT
-- on purpose: a mistake (bad address) or a second pending invitation for the same address fails loudly instead of silently doing nothing.
-- The invitation is valid for 7 days from the moment this is run.

INSERT OR IGNORE INTO organizations (id, slug, name, status, website_url, created_at, updated_at)
VALUES ('b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51', 'framework-test', 'Framework Test Organization', 'active', 'https://staging.frameworkco.ca/',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO projects (id, organization_id, name, kind, status, summary, created_at, updated_at)
VALUES ('c7a2d3b1-8e45-4f62-9bac-1d2e3f4a5b62', 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51', 'Test website', 'website', 'build',
        'A sample project so the portal pages have something to show.', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT OR IGNORE INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
VALUES ('d8b3e4c2-9f56-4a73-8cbd-2e3f4a5b6c73', 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51', 'system', 'seed:staging', 'project.created',
        'project', 'c7a2d3b1-8e45-4f62-9bac-1d2e3f4a5b62', 'client', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at)
VALUES ('e9c4f5d3-a067-4b84-9dce-3f4a5b6c7d84', 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51', '__INVITEE_EMAIL__', 'owner', 'pending',
        strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'seed:staging', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days'));

-- Verify afterwards (read-only):
--   SELECT slug, name, status FROM organizations WHERE slug = 'framework-test';
--   SELECT email, role, status, expires_at FROM invitations WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
