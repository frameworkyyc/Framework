-- Framework client portal: VERIFY one organization (READ-ONLY: SELECT statements only; changes nothing). Portal database only.
-- Replace __SLUG__ (all occurrences) with the organization's slug, then run each query and compare with the expectation beside it.

-- 1. Exactly one row; status 'active'; the name is the one you meant.
SELECT id, slug, name, status, created_at FROM organizations WHERE slug = '__SLUG__';

-- 2. Invitations: one 'pending' owner row for the intended address (expires_at about 7 days ahead) before the person signs in;
--    'accepted' afterwards. Nothing else.
SELECT email, role, status, created_by, created_at, expires_at, accepted_at FROM invitations
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__') ORDER BY created_at;

-- 3. Members: none before the first sign-in; afterwards exactly the intended people with the intended roles, all 'active'.
SELECT u.email, m.role, m.status, m.created_by, m.created_at FROM memberships m JOIN portal_users u ON u.id = m.user_id
 WHERE m.organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__') ORDER BY m.created_at;

-- 4. Projects the client will see.
SELECT name, kind, status, created_at FROM projects
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__') ORDER BY created_at;

-- 5. Audit trail: 'org.onboarded' (internal) and 'project.created' (client-visible) exist once each.
SELECT action, actor_ref, visibility, created_at FROM activity_log
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__') ORDER BY created_at;

-- 6. Tenant isolation sanity: the number of organizations and the people who can open each (every person should appear only where intended).
SELECT o.slug, o.status, (SELECT count(*) FROM memberships m WHERE m.organization_id = o.id AND m.status = 'active') AS active_members,
       (SELECT count(*) FROM invitations i WHERE i.organization_id = o.id AND i.status = 'pending') AS pending_invitations
  FROM organizations o ORDER BY o.slug;
