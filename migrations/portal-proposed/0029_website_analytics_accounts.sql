-- 0029 (website analytics, per-website Cloudflare account): PROPOSED. Not applied anywhere. Needs 0028 (website_analytics).
-- Staging: only after review and approval, after a Time Travel bookmark. Production: only through the manual "Portal Production D1 migration" workflow, after its own approval.
--
-- Three nullable columns on website_analytics. Nothing existing changes and no row is rewritten: every existing website keeps NULL in all three, which means
-- "read this website from Framework's own Cloudflare account" (CF_ANALYTICS_ACCOUNT_ID + the CF_ANALYTICS_API_TOKEN secret), exactly as before.
--   cf_account_id    the client's own Cloudflare account id (32 hex characters; an identifier, not a secret). Set only together with cf_token_enc.
--   cf_token_enc     that account's READ-ONLY API token (Account Analytics: Read), ENCRYPTED with AES-256-GCM by the Worker before it is written:
--                    "v1.<iv>.<ciphertext and tag>" (base64url). The key is the Worker secret ANALYTICS_CREDENTIALS_KEY, never stored here; the website id and
--                    organization id are bound into the encryption, so a value copied to another row cannot be decrypted. The plain token is never stored.
--   cf_token_set_at  when the token was last saved (shown in Admin instead of the token, which is write-only).
-- Removing a website's own account sets all three back to NULL.
ALTER TABLE website_analytics ADD COLUMN cf_account_id TEXT CHECK (cf_account_id IS NULL OR (length(cf_account_id) = 32 AND cf_account_id NOT GLOB '*[^0-9a-f]*'));
ALTER TABLE website_analytics ADD COLUMN cf_token_enc TEXT CHECK (cf_token_enc IS NULL OR (length(cf_token_enc) BETWEEN 40 AND 1000 AND cf_token_enc LIKE 'v1.%.%'));
ALTER TABLE website_analytics ADD COLUMN cf_token_set_at TEXT;
