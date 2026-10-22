# Admin runbook: inviting a client from Framework Admin

Scope: **Staging** (the Preview `Staging`). Production is not enabled for any of this and is not touched by this document. Nothing here contains a real address: this repository is public.

## What the two switches do (Staging only)
* `PORTAL_ADMIN_WRITES = "1"` lets a signed-in administrator (Cloudflare Access **and** an address on the `ADMIN_EMAILS` list) create client organizations and invitations, change roles, and remove access.
* `PORTAL_INVITE_SENDING = "1"` additionally lets the administrator **send** invitations (a WorkOS invitation email for a new person, or Framework's own email through Resend for someone who already has a sign-in).
* **Recipients are limited server-side** to the exact addresses in the Cloudflare secret `PORTAL_INVITE_ALLOWLIST`. Missing, empty or malformed means nothing can be created or sent. Neither switch sends anything by itself.

## Invite a client (Admin, Clients)
1. **New client:** business name and an optional website (a domain such as `example.com` or a full address). The portal address (the URL name) is made automatically from the business name, with `-2`, `-3` added if it is already taken; an existing organization's address never changes. You land on the client's page, which shows the portal address.
2. **Invite:** enter the person's email address and a role (**Owner** for the first person; **Member** for colleagues).
3. Choose **Create and send** (one confirmation shows the person, role, organization and what will be emailed) or **Create only** to save it and send later.
4. Watch the invitation row: **Invitation** status (Pending, Accepted, Revoked, Expired) and **Delivery** (Not sent, Submitted to WorkOS or Framework email, Send failed) are shown separately. "Submitted" means the provider accepted the request; it never confirms that the email reached an inbox.
5. The client opens the email, signs in with an emailed one-time code using **that same address**, and lands in their own organization. The invitation then shows **Accepted** and the person appears under Members as an active Owner or Member.

## When something does not go as planned
| You see | What it means | What to do |
|---|---|---|
| "address isn't on the approved list" | The address is not in the allowlist secret. Nothing was created or sent. | Add it (see below), then try again. |
| "Invitations are locked: no approved recipients" | The allowlist secret is missing or malformed. | Re-set the secret (see below). |
| "already a pending invitation for this email address" | One exists (see the list). | Use Send or Resend on it, or revoke it first. |
| "already has access" | The person is already a member. | Nothing to do. |
| "saved but NOT sent" after Create and send | The invitation is saved; the provider request failed (reason shown). | Use **Try again** on the row. |
| WorkOS "did not accept the request" | Often an earlier WorkOS invitation for the same address was never accepted or cancelled. | Revoke the old invitation (use **Retry WorkOS cancel** if shown), then **Replace** or create a new one. |
| Expired | Invitations last 7 days and an expired one is never sent again. | **Replace** it. |
| The client says no email came | Delivery to the inbox is never confirmed. | Ask them to check spam; use **Resend** (the expiry does not change). |

## Add or change an approved address (a person does this; never paste addresses into chat, a ticket, a commit or a command line)
The list is a Cloudflare **secret** on the Staging Preview. **`secret put` REPLACES the whole list**, so always re-enter **every** address you still want allowed.
1. `npx wrangler preview secret put PORTAL_INVITE_ALLOWLIST --name Staging` and type or paste the full list at the hidden prompt (addresses separated by commas, semicolons or spaces; exact addresses only: no wildcards, no display names).
2. `npx wrangler preview secret list --name Staging` must list `PORTAL_INVITE_ALLOWLIST` (names only; values are never shown). Setting a secret creates a new Preview deployment.
3. In Admin, the invitation area shows the recipient list as **configured** (never the addresses). Run `node scripts/ops/staging-health.mjs`: `critical.allowlist_enforced` must pass.
4. Remove addresses you no longer need. A real client's address is added **only** when you are about to invite that person.

## Switch it off (emergency or when the test ends)
* Fastest: remove the allowlist secret (`npx wrangler preview secret delete PORTAL_INVITE_ALLOWLIST --name Staging`): every invitation operation is refused at once.
* Fully off: a reviewed change removing `PORTAL_INVITE_SENDING` and `PORTAL_ADMIN_WRITES` from `previews.vars` in `wrangler.jsonc` (and `switches` in `scripts/ops/staging-expected.json`), then deploy. The Admin then shows the read-only view.

## Not covered
Production. Enabling these switches on Production, a Production allowlist, and the Production email sender are separate, explicitly approved steps. Production WorkOS has no custom email domain yet, so clients would receive WorkOS's default sender.
