-- Framework client portal: EMERGENCY OFFBOARDING of one user. Portal database only (framework-portal-staging now; framework-portal later).
-- NOT a migration: it lives outside migrations/portal on purpose, so `wrangler d1 migrations apply` can never run it. Read README.md first.
--
-- Before running, replace the TWO placeholders below (all occurrences):
--   __USER_ID__  the user's id (a UUID) copied from the lookup query in README.md. Paste ONLY that UUID, nothing else.
--   __ACTOR__    who is doing this: letters, digits and . _ @ : - only, up to 100 characters (for example  admin:jj). It is recorded in the audit trail.
-- If __USER_ID__ is left unreplaced (or matches nobody) every statement matches nothing and changes nothing.
--
-- What it does, most urgent first. Every statement touches ONE user only and is safe to run again:
--   1. disables the user              2. revokes all of the user's unrevoked sessions
--   3. revokes the user's active memberships (in every organization)
--   4. revokes the pending invitations addressed to the user's email (so access cannot silently return)
--   5-6. writes internal audit entries (one for the user, one per organization), but only if that change has not been recorded yet.
-- Do NOT assume the D1 Console runs this file as one transaction. If it stops part-way, run the WHOLE file again, then run the checks in README.md.

UPDATE portal_users SET status = 'disabled', disabled_at = COALESCE(disabled_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
 WHERE id = '__USER_ID__';

UPDATE portal_sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_reason = 'user_offboarded'
 WHERE user_id = '__USER_ID__' AND revoked_at IS NULL;

UPDATE memberships SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_by = 'offboard:__ACTOR__'
 WHERE user_id = '__USER_ID__' AND status = 'active';

UPDATE invitations SET status = 'revoked', revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), revoked_by = 'offboard:__ACTOR__'
 WHERE status = 'pending' AND email = (SELECT email FROM portal_users WHERE id = '__USER_ID__');

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       NULL, 'admin', '__ACTOR__', 'user.offboarded', 'user', u.id, 'internal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM portal_users u
 WHERE u.id = '__USER_ID__' AND u.status = 'disabled'
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id IS NULL AND a.action = 'user.offboarded' AND a.entity_id = u.id AND a.created_at >= u.disabled_at);

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       m.organization_id, 'admin', '__ACTOR__', 'member.offboarded', 'user', m.user_id, 'internal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM memberships m
 WHERE m.user_id = '__USER_ID__' AND m.status = 'revoked' AND m.revoked_by = 'offboard:__ACTOR__'
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = m.organization_id AND a.action = 'member.offboarded' AND a.entity_id = m.user_id AND a.created_at >= m.revoked_at);
