-- Framework client portal: ADD ONE PROJECT to an existing organization, with one client-visible "project created" entry. Portal database only.
-- NOT a migration (see README.md). Run onboard-organization.sql first.
--
-- Replace the FOUR placeholders (all occurrences):
--   __SLUG__            the organization's slug (it must already exist and be 'active')
--   __PROJECT_NAME__    1-120 characters, NO apostrophes or quotes
--   __PROJECT_STATUS__  exactly one of: discovery, design, build, review, live, maintenance, paused, archived
--   __ACTOR__           letters, digits and . _ @ : - only, up to 100 characters (for example  admin:jj)
-- A wrong status or an unreplaced placeholder is REJECTED by the database (nothing is created). An unknown or non-active slug matches nothing and
-- changes nothing. Safe to run again: a project of the same name in the same organization is never created twice.
-- The activity entry is CLIENT-VISIBLE: it appears on that organization's portal home. Keep the project name something the client may see.

INSERT INTO projects (id, organization_id, name, kind, status, created_at, updated_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       o.id, CASE WHEN '__PROJECT_NAME__' = '__' || 'PROJECT_NAME' || '__' THEN NULL ELSE '__PROJECT_NAME__' END, 'website', '__PROJECT_STATUS__',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM organizations o
 WHERE o.slug = '__SLUG__' AND o.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.organization_id = o.id AND p.name = '__PROJECT_NAME__');

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       p.organization_id, 'admin', CASE WHEN '__ACTOR__' = '__' || 'ACTOR' || '__' THEN NULL ELSE '__ACTOR__' END, 'project.created', 'project', p.id, 'client', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM projects p JOIN organizations o ON o.id = p.organization_id
 WHERE o.slug = '__SLUG__' AND p.name = '__PROJECT_NAME__'
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = p.organization_id AND a.action = 'project.created' AND a.entity_id = p.id);
