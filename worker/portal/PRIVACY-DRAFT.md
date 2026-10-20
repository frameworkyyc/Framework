# Client portal privacy wording: applied to `privacy.html` (Staging), awaiting owner confirmation

**Status: DRAFT record. The portal wording is now IN `privacy.html` on the Staging branch. It is not yet published on Production (`main`), it is not legal advice, and it has not been
reviewed by an adviser.** The effective date is deliberately the "pending" notice (`<time id="effective-date" data-status="pending">`): set the real date when the policy is
published on the live website (`PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs` fails until you do). Tests in `worker/test/privacy.test.mjs` check the portal
wording against the code (cookies, session limits, data categories, no MFA or residency claims).

## Decisions the owner made (recorded here; wording in `privacy.html`)
* Active client information is kept while the client relationship continues, subject to legal and contractual obligations.
* Inactive beta accounts are reviewed after 12 months; information no longer needed is deleted, subject to legal and operational retention requirements.
* Privacy and deletion requests go to `hello@frameworkco.ca`. Aim: acknowledge within 5 business days; complete eligible deletion requests within 30 calendar days (targets, not guarantees; legal and operational exceptions apply).
* Authorized Framework personnel access client information only when needed for service delivery, support, security or account administration.
* Framework administrators should use MFA. Beta clients use the existing email one-time code for now.

## [OWNER CONFIRMATION] Items to confirm before publishing (do not publish until each is confirmed or changed)
1. **[DECISION] Administrator MFA sentence.** The policy says administrators "are expected to use multi-factor authentication for the accounts that can reach client information". That is a statement of expectation, not of enforcement. Confirm MFA is on for Cloudflare, WorkOS (staff login), GitHub and the email account, or soften the sentence.
2. **Clients and MFA.** The policy says "we do not currently require a second sign-in step for clients". If you turn MFA on in WorkOS, update that sentence (and the tests) in the same change.
3. **Retention reality.** The "review after 12 months" and "30 calendar days" statements are commitments to a manual process; there is no scheduled job or tooling. Confirm you can keep them, and who does it. Ended-session records are only purged by hand (`purgeEndedSessions`, never scheduled): the policy therefore gives no specific period for them.
4. **[DECISION] Staff access.** The policy says staff access client information "only when needed". There is no audit entry when staff view a client's profile (see BETA-READINESS "optional improvements"). Confirm that wording is acceptable, or add the audit trail.
5. **Resend for portal invitations.** The policy says an invitation may be sent by WorkOS or by Framework through Resend. Today invitation sending is switched off; confirm the wording is still wanted for the beta.
6. **Location.** The policy says WorkOS and Cloudflare may process portal information in the United States and other countries and that a specific location has not been confirmed. Do not replace this with a residency claim unless the providers' terms (and your Cloudflare plan) support it.
7. **Adviser review.** Have your adviser confirm the whole portal wording (PIPA purposes, consent or acknowledgement for Business Profile, breach-notice steps) before it goes live on Production.
8. **Business Profile consent.** No consent checkbox is used; the in-portal notice and the policy describe collection and use. Confirm that is acceptable for your clients.
9. **Publication.** Publishing means merging Staging to `main` (a separate, approved step). Until then the live website policy still describes only the website.

## What changed in `privacy.html`
Summary bullet; scope paragraph; "Information in the client portal" (account, Business Profile, portal feedback, sign-in and security records, activity records, invitation records);
purposes; new section "The client portal" (WorkOS sign-in, who can see what, invitations, storage); portal cookies `__Host-fw_auth` (10 minutes) and `__Host-fw_portal`
(12 hours idle, 14 days absolute); providers (WorkOS; Cloudflare for the portal; Resend for invitations; Fontshare in the portal); where information is processed;
security; retention; requests (5 business days / 30 calendar days targets) and what deletion does not remove.

## Operational follow-ups (not website text)
* `PRIVACY-OPERATIONS.md` section 6 records the portal data inventory and the request procedure.
* Breach handling: write who decides and who notifies (Alberta's PIPA expects notice to the Commissioner and to affected individuals where there is a real risk of significant harm).
* A `no sensitive personal information` hint on the free-text boxes is still optional (not added).
