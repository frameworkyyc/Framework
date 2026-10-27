# Approved Emails

Which email addresses may be invited to a client portal, and may receive Client Services emails (invoice published, Framework replied, quote sent).

## How it works
- **Admin -> Approved Emails** lists, adds and removes addresses (table `approved_emails`, migration 0008). Behind Cloudflare Access and `ADMIN_EMAILS`; writes need `PORTAL_ADMIN_WRITES` and a same-origin request with `X-Framework-Admin`.
- An address is **approved when it is in the table OR in the Cloudflare secret `PORTAL_INVITE_ALLOWLIST`**. Nothing approved before the table existed stops working. The secret is never written by the Worker. "Add to the list" on the page copies the secret's addresses into the table so the secret can later be deleted.
- Nothing approved at all (table empty and secret missing/malformed) = **locked**: no invitation can be created, replaced, sent or resent, and no client email goes out. There is no "allow everyone" value.
- The check runs before any invitation write or provider call (`admin-access.js`, `invite-delivery.js`) and again when a client notice is sent (`service-notifications.js`).
- **Invite and approve in one step**: the invite form has "Also approve this address" (on by default). The server only acts on an explicit `approve: true`; it approves first (one audit entry, source `invite`) and then creates the invitation. It never sends by itself.
- **Removing** an address stops future invitations and emails to it. It never ends anyone's existing access (that is "Remove access" on the client).
- **Validation**: one plain address (the same strict test as every entry of the secret; no wildcards, domains, separators, display names), at most 120 characters of note, at most 500 addresses.
- **Audit**: `activity_log` (internal, `organization_id` NULL, actor = the admin) gets `approved_email.added` / `approved_email.removed` with `{email, source}` in the detail, in the same batch as the change and only when something actually changed.
- A database without migration 0008 reads as an empty list (the secret alone decides) and the page says the list is not available.

## Deploying
The code is safe before the migration. Apply 0008 to a database only with its own approval (Staging: manual, with a Time Travel bookmark first; Production: after the Production workflow's expected list is extended by a reviewed change).
