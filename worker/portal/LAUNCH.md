# Client portal: Production launch plan

Status when written: Production code, bindings, database schema and both secrets are in place; the portal is **OFF** (neither `PORTAL_ENABLED` nor
`PORTAL_ALLOW_PRODUCTION` is set; every `/portal` path answers a plain 404). WorkOS Production has 0 users and 0 organizations, and its API key has
never been used. Nothing below is done by merging this file.

## 1. MFA recommendation (WorkOS Production, currently `Off`)
**Recommended: set the environment MFA policy to `Required` (authenticator-app TOTP) before the first real client signs in.**
* Sign-in today is a single factor: a one-time code sent to the person's mailbox. Whoever controls the mailbox controls the portal account, and the
  portal shows non-public client information (project names, status, activity, and later files).
* A second factor makes mailbox compromise alone insufficient. With a small, invited client list the friction is small and one-time, and it is much
  easier to start with MFA than to retrofit it onto live sessions later. It is reversible (`Optional`) if clients struggle.
* `Optional` does not help much in practice (people do not enrol). `Passkeys` are a good addition later; they are not needed for launch.
* The application does not need a code change: WorkOS runs the challenge on its hosted sign-in page, then returns the normal authorization code. The
  portal stores the method used (`auth_method`) per session. **Verify at the first Production sign-in test** that the MFA screen appears and the portal still
  completes sign-in; to change it, WorkOS dashboard (Production) > Authentication > Multi-factor, or the connector's `updateAuthkitSettings` with your approval.
* If you prefer to launch with `Optional`, write that decision down and re-visit before adding file sharing or any financial/legal documents.
* Also turn on two-factor authentication for every human account that can change the portal: Cloudflare (it can run SQL on the portal database), WorkOS, GitHub.

## 2. Authentication, authorization, sessions, invitations and recovery: remaining launch risks
What is already strong (tested): the sign-in attempt is bound to the browser by a sealed state/PKCE cookie; the code exchange is server-side; the token
is verified against WorkOS keys with a pinned issuer and our client id and a required session id; the email must be `email_verified === true`; access
exists only through an invitation matched on that verified email, then through an active membership re-checked on **every** request; a non-member gets
404, never 403; sessions are server-side, hashed, 12 h idle / 14 d absolute, rotated at sign-in, capped per user; disabling or offboarding a user
revokes their sessions atomically and re-enabling never revives them; the unauthenticated endpoints are rate limited; secrets never reach logs.

| # | risk | severity | what to do |
| --- | --- | --- | --- |
| 1 | Single-factor (email code) sign-in | **High until decided** | Section 1: require MFA |
| 2 | Recovery = mailbox access; a person who loses the mailbox cannot self-recover | Medium | Out-of-band verification + the "Account recovery" procedure in `migrations/portal-ops/README.md` |
| 3 | Deleting and re-creating a WorkOS user makes the portal refuse that email (`email_conflict`) | Medium (operational) | Never delete WorkOS users; documented; offboard in D1 and keep the WorkOS user |
| 4 | No admin screen: organizations, invitations and offboarding are hand-run SQL | Medium | Tested runbooks (`onboard-organization.sql`, `invite-member.sql`, `emergency-offboard.sql`), copy outside the repo, verify afterwards; rehearse on Staging; limit who has D1 Console access |
| 5 | The WorkOS session of an offboarded person stays valid in WorkOS (the portal blocks them anyway) | Low | Revoke their WorkOS sessions as part of offboarding |
| 6 | WorkOS IdP-initiated SSO and SSO are enabled but unused | Low | Turn them off (recommended; nothing uses them) |
| 7 | Ended sessions are never purged automatically (`purgeEndedSessions` exists, unscheduled) | Low | Run it by hand monthly, or add a schedule later; also covered by the privacy retention statement |
| 8 | Rate limiting is per Cloudflare location and approximate | Low | Acceptable for a small invited client list; Cloudflare WAF rate rule is a second layer |
| 9 | Sign-in depends on WorkOS being up | Low | Fails closed with a plain "service unavailable" page |
| 10 | Production observability: no alerting yet | Low | Check Workers Logs and the WorkOS dashboard daily for the first weeks |

No blocker was found in the code paths reviewed. The mandatory items are in section 5.

## 3. First Production sign-in test, without exposing the portal prematurely
Turning the flags on makes the login page reachable by anyone, but nobody can get in without a WorkOS account (sign-up is off) **and** a D1 invitation
for the same verified email, and WorkOS has no users yet. The residual exposure is the login page itself plus the rate-limited start endpoint. To keep even
that private during the test:
1. **Rehearse the whole runbook on Staging first** (WorkOS invitation email, onboarding SQL, sign-in, MFA, logout, offboarding).
2. **Put a temporary Cloudflare WAF custom rule in front of `/portal*`** (manual, one minute; Free plans allow custom rules): block when the path starts
   with `/portal` and `ip.src` is not your own address. Create it **before** the launch change goes live; remove it only when you open the portal to clients.
3. Create **your own** WorkOS Production user (your address) and the two internal organizations with the onboarding runbook (see "Tenant isolation check").
4. Merge the **launch change** (adds `PORTAL_ENABLED="1"` and `PORTAL_ALLOW_PRODUCTION="1"` to the Production top-level vars; a reviewed PR, separate from everything else).
5. Test from your own network: sign-in (email code, MFA screen), landing page, project page, second browser/device, logout (both the portal and the WorkOS session end),
   idle behaviour, the tenant isolation steps, a wrong-organization URL (404), the old cookie after logout (redirect to sign-in).
6. Check the evidence: WorkOS shows the Production API key `lastUsedAt`; D1 `verify-organization.sql`; Workers Logs show only fixed fields (no codes, tokens, emails);
   the browser shows `__Host-` cookies with `Secure`, `HttpOnly`, `SameSite=Lax`.
7. **Rollback plan**: remove the two flags (a one-line revert PR) or redeploy the previous version in Cloudflare; the portal returns to the plain 404 at once.
8. Open to clients only after the checklist below is complete; then remove the WAF rule.

## 4. First-organization onboarding
See `migrations/portal-ops/README.md` ("Onboarding a new organization"): who does what, the SQL runbooks and their tests, the WorkOS user step, the tenant
isolation check and account recovery. Parts that need a person: creating the WorkOS user, running the SQL in the D1 Console, and telling the client.

## 5. Prioritized launch-readiness checklist
**Mandatory (do not invite a real client until all are done)**
- [ ] M1 Privacy notice updated and published (`worker/portal/PRIVACY-DRAFT.md`), including the service providers outside Canada.
- [ ] M2 MFA decision applied in WorkOS Production and tested at the first sign-in.
- [ ] M3 Onboarding runbook rehearsed end to end on Staging, including the WorkOS user/invitation path.
- [ ] M4 Two-factor authentication on the Cloudflare, WorkOS and GitHub accounts that can change the portal or its data.
- [ ] M5 Launch change (the two flags) reviewed and merged with your explicit approval, with the WAF restriction in place first.
- [ ] M6 First Production sign-in test and tenant isolation check passed (section 3).
- [ ] M7 A D1 Time Travel bookmark recorded just before the first real client's data is created, and the restore command written down.
- [ ] M8 A short incident/breach note: who to contact, how to disable the portal (remove the flags), how to offboard a user, and that Alberta's PIPA expects notice to the
      Commissioner and affected people when there is a real risk of significant harm (confirm the wording with your adviser).
- [ ] M9 The `www.frameworkco.ca` behaviour confirmed (redirect to the apex or intentionally not served), and the public site and `/portal/login` checked in a browser.

**Recommended**
- [ ] R1 Disable WorkOS IdP-initiated SSO and SSO if unused.
- [ ] R2 Keep the WAF restriction until the first client is invited, then replace it with the normal rate rule only.
- [ ] R3 Define retention periods for portal data (draft in the privacy draft) and run the monthly session purge.
- [ ] R4 Secret rotation notes: pepper rotation signs everyone out; WorkOS key rotation is create new, update the Cloudflare secret, delete the old key.
- [ ] R5 After launch, add `secrets.required` for the two secrets to `wrangler.jsonc` so a future deploy cannot ship without them.
- [ ] R6 Alerting/log review routine for the first weeks.
- [ ] R7 An admin screen for organizations and invitations (future).
