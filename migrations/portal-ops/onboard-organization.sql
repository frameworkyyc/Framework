-- Framework client portal: ONBOARD ONE ORGANIZATION (organization + its first owner invitation). Portal database only
-- (framework-portal-staging for rehearsals; framework-portal for Production).
-- NOT a migration: it lives outside migrations/portal on purpose, so `wrangler d1 migrations apply` can never run it. Read README.md first.
--
-- Before running, replace the FOUR placeholders below (all occurrences of each):
--   __SLUG__         the organization's URL name: 2-48 lower-case letters, digits and hyphens (no leading/trailing/double hyphen), for example  acme-co
--   __NAME__         the organization's display name, 1-120 characters. NO apostrophes or quotes (write  Acme Co  not  Acme's Co).
--   __OWNER_EMAIL__  the first owner's email address, ALL LOWER CASE, copied exactly from the WorkOS user (no spaces).
--   __ACTOR__        who is doing this: letters, digits and . _ @ : - only, up to 100 characters (for example  admin:jj). Recorded in the audit trail.
-- A placeholder left in place makes the database REJECT the statement (nothing is created): the slug and the email fail their CHECK rules, and the
-- name and actor are tested against their own placeholder text below.
--
-- What it does, in this order. Every statement is scoped to the ONE slug you typed and is safe to run again:
--   1. closes an earlier, already-expired pending invitation for this address in this organization (so it cannot block a fresh one)
--   2. creates the organization, unless the slug already exists
--   3. creates ONE pending OWNER invitation (valid 7 days), but only while the organization has NO members and no live invitation. An existing
--      organization with people in it can therefore never receive a new owner from this file, even if the slug is typed wrongly.
--   4. writes one internal audit entry (never client-visible), unless it was already written
-- Do NOT assume the D1 Console runs this file as one transaction. If it stops part-way, run the WHOLE file again, then run verify-organization.sql.

UPDATE invitations SET status = 'expired'
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__')
   AND email = '__OWNER_EMAIL__' AND status = 'pending' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO organizations (id, slug, name, status, created_at, updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       '__SLUG__', CASE WHEN '__NAME__' = '__' || 'NAME' || '__' THEN NULL ELSE '__NAME__' END, 'active',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE slug = '__SLUG__');

INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       o.id, '__OWNER_EMAIL__', 'owner', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       CASE WHEN '__ACTOR__' = '__' || 'ACTOR' || '__' THEN NULL ELSE '__ACTOR__' END, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
  FROM organizations o
 WHERE o.slug = '__SLUG__' AND o.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id)
   AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.organization_id = o.id AND i.status IN ('pending', 'accepted'));

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       o.id, 'admin', CASE WHEN '__ACTOR__' = '__' || 'ACTOR' || '__' THEN NULL ELSE '__ACTOR__' END, 'org.onboarded', 'organization', o.id, 'internal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM organizations o
 WHERE o.slug = '__SLUG__'
   AND EXISTS (SELECT 1 FROM invitations i WHERE i.organization_id = o.id AND i.email = '__OWNER_EMAIL__')
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = o.id AND a.action = 'org.onboarded');
