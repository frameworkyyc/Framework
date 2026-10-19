-- Framework client portal: removes the STAGING-ONLY test organization created by staging-test-org.sql. Staging portal database only.
-- Deletes in dependency order (foreign keys are enforced). Sessions and the user row are removed only for people whose ONLY
-- membership is the test organization; adjust before running if the test user has other memberships.
DELETE FROM activity_log WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
DELETE FROM projects WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
DELETE FROM invitations WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
DELETE FROM portal_sessions WHERE user_id IN (SELECT user_id FROM memberships WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51');
DELETE FROM memberships WHERE organization_id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
DELETE FROM organizations WHERE id = 'b6f1c2a0-7d34-4e51-8a9b-0c1d2e3f4a51';
