# Client portal: incident note (DRAFT, owner to confirm names and wording)

**Operator:** [OWNER: name the one person who acts first]. **Contact for clients:** hello@frameworkco.ca. This note is a checklist, not legal advice; confirm the privacy-breach wording with your adviser.

## 1. Something looks wrong with the portal (stop first, investigate second)
1. **Switch the portal off.** Fastest: a Cloudflare WAF custom rule blocking `/portal*` (about a minute). Permanent: a reviewed change removing `PORTAL_ENABLED` and `PORTAL_ALLOW_PRODUCTION`; every `/portal` path then answers a plain 404.
2. **Keep the evidence.** Note the time, what was seen, and any reference id shown on an error page. Do not delete logs or data.
3. **Check Workers Logs** (Cloudflare, Workers & Pages, framework, Logs) for `request.failed`, `org.denied`, `rate.limited`, `config.invalid`, `store.unavailable`. Logs hold fixed fields only (no emails, codes or answers).

## 2. One person must lose access now
Use `migrations/portal-ops/emergency-offboard.sql` (README in that folder): it disables the user, revokes their sessions and memberships and pending invitations, and writes audit entries. Then revoke their sessions in the WorkOS dashboard and **do not delete the WorkOS user** (that would make the portal refuse the address later). Re-enable with `emergency-reenable.sql` (it never restores memberships).

## 3. A secret may have leaked
Rotate it in Cloudflare (`wrangler secret put`): changing `PORTAL_SESSION_PEPPER` signs everyone out; rotating the WorkOS key means create a new key, update `PORTAL_AUTH_CLIENT_SECRET`, delete the old key. Rotate the Cloudflare API token and GitHub secrets the same way.

## 4. Data may have been exposed or corrupted
1. Record a Time Travel bookmark first, then decide between a restore to a point before the problem (all writes stop while restoring) and a manual fix.
2. Work out **whose** information, **what** categories (account details, Business Profile answers, feedback, sign-in records) and **when**.
3. **Notice.** Alberta's PIPA expects notice to the Privacy Commissioner, and to the affected people, without unreasonable delay when there is a real risk of significant harm. [OWNER/ADVISER: confirm who decides, and keep a short written record of the decision either way.]
4. Tell affected clients plainly what happened, what was involved and what you did. Record the incident, the fix and the follow-ups.

## 5. Routine
During the first weeks: check Admin > Portal Feedback and Admin > Clients daily, and Workers Logs for the events above. Aim to acknowledge a client's access problem within one business day.
