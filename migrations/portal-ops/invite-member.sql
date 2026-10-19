-- Framework client portal: INVITE ONE PERSON into an EXISTING organization (a second user, or a replacement after an email change). Portal database only.
-- NOT a migration (see README.md). Use onboard-organization.sql for a brand-new organization.
--
-- Replace the FOUR placeholders (all occurrences):
--   __SLUG__   the organization's slug (it must already exist and be 'active')
--   __EMAIL__  the person's email address, ALL LOWER CASE, exactly as in their WorkOS user (no spaces)
--   __ROLE__   exactly  member  or  owner.  An owner can also see the organization's member list. Grant 'owner' only after confirming, OUT OF BAND
--              (phone or a known contact), that an existing owner of that organization asked for it.
--   __ACTOR__  letters, digits and . _ @ : - only, up to 100 characters (for example  admin:jj)
-- A wrong role, a malformed address or an unreplaced placeholder is REJECTED by the database (nothing is created). An unknown or non-active slug
-- matches nothing. Safe to run again: it never creates a second live invitation, and it does nothing for someone who is already an active member.
--   1. closes an earlier, already-expired pending invitation for this address (so it cannot block a fresh one)
--   2. creates ONE pending invitation (valid 7 days), unless a live one exists or the person is already an active member of this organization
--   3. writes one internal audit entry for that invitation, unless it was already written
-- Do NOT assume the D1 Console runs this file as one transaction. If it stops part-way, run the WHOLE file again, then run verify-organization.sql.

UPDATE invitations SET status = 'expired'
 WHERE organization_id = (SELECT id FROM organizations WHERE slug = '__SLUG__')
   AND email = '__EMAIL__' AND status = 'pending' AND expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       o.id, '__EMAIL__', '__ROLE__', 'pending', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       CASE WHEN '__ACTOR__' = '__' || 'ACTOR' || '__' THEN NULL ELSE '__ACTOR__' END, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+7 days')
  FROM organizations o
 WHERE o.slug = '__SLUG__' AND o.status = 'active'
   AND NOT EXISTS (SELECT 1 FROM invitations i WHERE i.organization_id = o.id AND i.email = '__EMAIL__' AND i.status = 'pending')
   AND NOT EXISTS (SELECT 1 FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = o.id AND m.status = 'active' AND u.email = '__EMAIL__');

INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at)
SELECT lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)), 2) || '-' || substr('89ab', (random() & 3) + 1, 1) || substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))),
       i.organization_id, 'admin', CASE WHEN '__ACTOR__' = '__' || 'ACTOR' || '__' THEN NULL ELSE '__ACTOR__' END, 'member.invited', 'invitation', i.id, 'internal', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM invitations i JOIN organizations o ON o.id = i.organization_id
 WHERE o.slug = '__SLUG__' AND i.email = '__EMAIL__' AND i.status = 'pending'
   AND NOT EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = i.organization_id AND a.action = 'member.invited' AND a.entity_id = i.id);
