# Client portal privacy wording: DRAFT review for publication

**Status: not published.** The portal wording is in `privacy.html` on the Staging branch; the live website still has the old policy. This is not legal advice and has not been reviewed by an adviser.
Reviewed 2026-10-21 against the code, the tests, the live Staging site and the providers' settings (read-only). Sources are marked **code**, **live** (observed on Staging), **config** (provider setting, read-only) or **owner** (cannot be verified from here).

## Owner decisions (2026-10-21) [DECISION records]
1. **Clients:** email one-time code only, no mandatory MFA for the initial Beta. The policy sentence "we do not currently require a second sign-in step for clients" stays. Reconsider when the portal expands (and update that sentence in the same change).
2. **Administrators:** MFA required on administrative accounts and services wherever supported. See "Administrator MFA" below: this is **not yet true** and must be made true before the sentence is published.
3. **Incident contact:** the owner, initially.
4. **Effective date:** the actual date of publication (set at publication; see "Publication steps").

## Statement-by-statement check (portal wording in `privacy.html`)
| Statement | Verified how | Result |
|---|---|---|
| Sign-in is by a one-time code emailed by WorkOS; no social providers | config: WorkOS Production has email code on, password off, every social provider off | **True for Production.** (Staging still allows social sign-in; it is not the published environment.) |
| "We do not see or store your one-time codes" | code: the portal only receives the authorization code from WorkOS and never the emailed code | True |
| Clients: no second sign-in step | config: WorkOS Production MFA is Off | True, and matches decision 1 |
| Access is checked on every request; removal takes effect on the next request | code + live tests (membership re-read per request; removed users cut off) | True |
| Everyone in the organization can view and edit the Business Profile; only Owners see the people list | code: `policy.js` (profile.view/edit: owner, member; members.view: owner) | True |
| Each organization sees only its own information | live: both directions, pages and writes, identical 404 | True |
| Business Profile and portal feedback data listed (feedback: message, type, section, organization and account) | code: `portal_feedback` table; Business Profile fields from code: `profile-schema.js` (legal and operating name, industry, description, city, service area, size, products, customers, goals, competitors, website, social, contact name/role/email/phone, brand words, tone, positioning, and the optional services of interest, start window, budget range and existing brand materials) | True; **wording extended** to name tone and positioning; the four optional Goals answers (services of interest, project timeline, approximate budget, existing brand materials) are now named in `privacy.html` and the in-portal notice using the owner-supplied wording of 2026-10-22, including "prepare proposals" as a purpose (**wording flagged for legal review**; the policy still needs the adviser review and effective date before publication) |
| Activity records hold who and when, not the answers | live: audit rows carry the step id and schema version only | True |
| Sign-in and security records: method, session record, hashed network address | code: `portal_sessions` stores method, WorkOS session id, times, hashed address; no user agent, no raw address | True |
| Portal cookies `__Host-fw_auth` (10 min) and `__Host-fw_portal` (12 h idle, 14 d absolute); no tracking cookies | live: cookie attributes and session expiry observed; config: WorkOS limits match | True |
| Portal data stored in a Cloudflare database; WorkOS and Cloudflare may process outside Canada, location unconfirmed | code; no residency claim is made | True as worded. **Cannot verify** the Production database region (Staging's is Western North America) without reading Production resources |
| Providers: WorkOS, Cloudflare, Resend, Fontshare | code: the portal loads Fontshare fonts; Resend used only for notices and invitations when sending is on | True |
| Invitations "sent by WorkOS or by Framework through Resend" | code + plan: on Production Beta 1.0, admin-sent invitations are OFF; invitations go by the runbook (WorkOS user, then your own email) | **Was inaccurate for the Beta path; wording changed** to include "directly by a member of Framework" |
| Invitation record shows "whether it was delivered to the email service" | code: the system records only "submitted", never inbox delivery | **Wording changed** to "accepted by a service (we cannot confirm it reached your inbox)" |
| Admin area protected by Cloudflare Access and individual staff sign-in | code: verified Access token AND an address on the admin list; live: `/admin` redirects to Access | True. **Cannot verify** the Access policy's sign-in method from here |
| Staff view client information "only when needed" | **owner**: a practice, not a technical control; there is no log of staff views | Needs your confirmation (see below) |
| Retention: inactive beta accounts reviewed after 12 months; requests acknowledged in 5 business days, completed in 30 days; manual deletion | **owner**: commitments to a manual process; no tooling or schedule | Needs your confirmation |
| If a breach creates a real risk of significant harm, we notify people and regulators as the law requires | owner: matches `INCIDENT-RESPONSE.md` | Needs your confirmation and adviser review |

## Administrator MFA (decision 2): what is true today
* **WorkOS dashboard** (the account that controls Production sign-in): **done 2026-10-21.** The owner enrolled an authenticator app (verified read-only: MFA configured) and the workspace setting **"require MFA for all dashboard members"** was then switched on (confirmed in WorkOS's response). It applies to people who sign in to the WorkOS dashboard only. The client portal's own WorkOS settings (environment MFA Off, email code on) were re-read afterwards and are unchanged, so client sign-in is unaffected.
* **Cloudflare account** (can run SQL on the portal database and change secrets): **cannot be verified from here** (the read-only token cannot read account security settings). Action: confirm two-factor is on (Profile, Authentication).
* **GitHub account** (owns the repository, which deploys the site): **cannot be verified from here.** Action: confirm two-factor is on, with a security key or authenticator app.
* **Cloudflare Access sign-in to `/admin`:** **cannot be verified from here.** If it uses an emailed one-time PIN it is single-factor; if it uses a Google or similar identity provider with MFA, it inherits that. Action: confirm which method the Access policy uses and, if needed, require an identity provider with MFA.
* **The mailbox for hello@frameworkco.ca** (receives every sign-in and reset email): **cannot be verified from here.** Action: confirm two-step verification is on.

**Wording to publish only after every item above is confirmed** (replaces the current "are expected to use" sentence, and requires updating the test that forbids an enforced-MFA claim):
> Framework requires multi-factor authentication on the administrator accounts and services that can reach client information, wherever the service supports it. Clients currently sign in with an email code only; we do not currently require a second sign-in step for clients.

If you prefer to publish before all are confirmed, keep the current sentence ("expected to use").

## [OWNER CONFIRMATION] Items: status after the owner's answers (2026-10-21)
| # | Item | Status |
|---|---|---|
| 1 | **Staff access "only when needed".** Wording kept as "Authorized Framework personnel ... only when needed". A log of staff profile views is deliberately **deferred** (it would change the Admin area from read-only to writing records). | Decided. **Not claimed:** that only one administrator has access. The size of the admin list (the `ADMIN_EMAILS` secret) and the Cloudflare Access policy are **UNVERIFIED**; verify both before publication and keep the wording at "authorized administrators" until then. |
| 2 | **Retention and requests.** A simple manual process: the owner is the initial privacy and incident contact; targets stay "aims" (5 business days to acknowledge, 30 days to complete an eligible deletion, 12-month review of inactive beta accounts). | Decided. **Open for the owner:** set the calendar reminders (quarterly review fits `PRIVACY-OPERATIONS.md`). Whether the targets can be met cannot be verified from here. |
| 3 | **Resend disclosed.** Verified: Resend already sends the website's assessment emails, so naming it is accurate regardless of how portal invitations are sent. | **Resolved.** |
| 4 | **Business Profile: notice, not a consent checkbox** (invite-only Beta; the in-portal notice says what is collected, why and who sees it). | Decided for the Beta. **FLAGGED FOR LEGAL REVIEW before publication.** This is a legal judgement that cannot be verified here. |
| 5 | **Adviser review** of the whole portal section (Alberta's PIPA purposes, acknowledgement versus consent, breach-notice steps). | **Open: required before publication.** Send the adviser this file. |
| 6 | **Location.** The policy says WorkOS and Cloudflare may process portal information in the United States and other countries and that a specific location is unconfirmed. | Keep that wording unless the Production database region and the providers' terms are confirmed (**UNVERIFIED**). |

Policy text now says: "Framework's owner is our privacy contact and handles these requests."

## Cannot be verified from here (flagged)
Production database region; the Cloudflare Access sign-in method; two-factor status of Cloudflare, GitHub and the mailbox; whether any staff will actually view client data and how often; your ability to meet the manual retention and request targets; WorkOS's own retention periods.

## Publication steps (when you approve promotion to `main`)
1. Apply the administrator MFA sentence (only once confirmed) and update the privacy test that currently forbids an enforced-MFA claim.
2. Set the effective date to the real publication date: replace the `data-status="pending"` notice in `privacy.html` with that date, then run `PRIVACY_PUBLISH=1 node --test worker/test/privacy.test.mjs` (it fails until the date is real).
3. Publish by promoting Staging to `main` (a separate approval). Until then the live policy describes only the website.

## Operational follow-ups (not website text)
`PRIVACY-OPERATIONS.md` section 6 holds the portal data inventory and the request procedure. `INCIDENT-RESPONSE.md` names the owner as incident contact. Ended-session records are purged by hand only (`purgeEndedSessions`); put a monthly reminder in your calendar.
