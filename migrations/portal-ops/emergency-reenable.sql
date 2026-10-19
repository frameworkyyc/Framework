-- Framework client portal: RE-ENABLE a previously disabled user. Portal database only. NOT a migration. Read README.md first.
--
-- Replace the TWO placeholders (all occurrences):  __USER_ID__ (a UUID from the lookup query; paste only that)  and  __ACTOR__ (see emergency-offboard.sql).
-- This NEVER restores organization memberships or invitations: access to an organization must be granted again on purpose (a fresh invitation
-- is preferred). It revokes any session of the user that is still unrevoked while the user is disabled, so no old cookie can come back to life.
-- Run the WHOLE file; if it stops part-way, run it again (every statement is safe to repeat). Re-enabling an already-active user signs nobody out.

UPDATE portal_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_reason = 'user_reenabled'
 WHERE user_id = '__USER_ID__' AND revoked_at IS NULL
   AND EXISTS (SELECT 1 FROM portal_users WHERE id = '__USER_ID__' AND status = 'disabled');

UPDATE portal_users SET status = 'active', disabled_at = NULL
 WHERE id = '__USER_ID__';

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       NULL, 'admin', '__ACTOR__', 'user.reenabled', 'user', u.id, 'internal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM portal_users u
 WHERE u.id = '__USER_ID__' AND u.status = 'active'
   AND EXISTS (SELECT 1 FROM activity_log b WHERE b.organization_id IS NULL AND b.action = 'user.offboarded' AND b.entity_id = u.id)
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id IS NULL AND a.action = 'user.reenabled' AND a.entity_id = u.id
                     AND a.created_at >= (SELECT max(b.created_at) FROM activity_log b WHERE b.organization_id IS NULL AND b.action = 'user.offboarded' AND b.entity_id = u.id));
