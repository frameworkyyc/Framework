-- Approved emails (Staging first). Approved for Staging only; NOT applied to Production, which follows the manual Production workflow after its own approval
-- (that workflow's expected list deliberately does not know 0008). One ADDITIVE table; nothing existing is altered.
--
--   approved_emails  the addresses that may be invited to the portal and may receive Client Services emails. Managed in Admin -> Approved Emails (behind Cloudflare
--                    Access and ADMIN_EMAILS). It is used TOGETHER WITH the Cloudflare secret PORTAL_INVITE_ALLOWLIST (an address is approved when it is in either), so
--                    nothing that is approved today stops working. Every change is also written to activity_log by the application. Removing an address stops future
--                    invitations and emails to it; it never ends anyone's existing access.
--                    Addresses are stored exactly as the portal normalizes them (trimmed, lower-case).

CREATE TABLE IF NOT EXISTS approved_emails (
  email    TEXT PRIMARY KEY CHECK (length(email) BETWEEN 3 AND 254 AND email = lower(email) AND email NOT GLOB '*[ ,;]*' AND instr(email, '@') > 1),
  note     TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 120),
  added_by TEXT NOT NULL CHECK (length(added_by) BETWEEN 1 AND 254),
  added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
