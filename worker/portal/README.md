# Framework client portal (Stage 2: wired into the Worker, enabled on Staging only)

`worker/index.js` routes `/portal` and `/portal/*` to `router.js` (`handlePortal(request, env)`). The router answers only when
`PORTAL_ENABLED` is exactly `"1"`, the settings are valid and the request is on `PORTAL_BASE_URL`'s host; otherwise the Worker returns
`portalNotFound()` (a bare, `no-store` 404 with no cookies and no HSTS). `PORTAL_ENABLED` is `"1"` in `previews.vars` only (Staging); it is
never set at the top level, so every `/portal` path is a 404 on Production. The Phase 0 probe has been removed.

## Modules

| file | role |
| --- | --- |
| `config.js` | validates settings; off / misconfigured (fail closed) / on; production hosts need a second flag |
| `crypto.js` | random tokens, HMAC session / ip / CSRF hashes, signed expiring cookie payloads |
| `http.js` | security headers, `__Host-` cookies, safe redirects, error pages with reference ids |
| `log.js` | allow-list structured logging (no emails, URLs, tokens, cookies) |
| `policy.js` | the only place roles are interpreted (default deny) |
| `claims.js` | access-token claim checks (pinned issuer, client, REQUIRED `sid`) and verified-email identity |
| `workos.js` | authorize URL (PKCE S256), server-side code exchange, JWKS + RS256 verification; typed outcomes |
| `sessions.js`, `repo/sessions.js` | server-side sessions: create / rotate / validate / revoke / disable, 10-session cap |
| `auth.js` | `/portal/login`, `/portal/auth/callback`, `/portal/logout` |
| `guard.js` | `requireSession`, `requireOrgAccess` (membership + org status + role, every request) |
| `pages.js` | server-rendered HTML, no client script |
| `ratelimit.js` | abuse limiter on sign-in start, callback and sign-out (Workers Rate Limiting binding, Staging only) |
| `router.js` | route table; the single entry point |

## Request flow

`/portal/login` (interstitial) -> `?start=1` sets a signed 10-minute state cookie and redirects to WorkOS (PKCE) ->
`/portal/auth/callback` checks state against the cookie, exchanges the code server-side, verifies signature + claims, requires a
`sid`, requires `email_verified === true`, upserts the user, activates pending invitations for that verified email, creates a NEW
session (revoking only the session cookie this browser presented) -> `/portal` -> picker or `/portal/o/<slug>`.

Every organization request: session lookup (1 query) -> membership + org status lookup (1 query) -> role check -> data (scoped by the
membership's organization id, never by anything in the request). Typically 3-4 queries.

## Failure handling the person can see

| situation | response |
| --- | --- |
| no / ended / unknown session | redirect to sign-in (`?r=ended` shows a notice and clears the dead cookie) |
| database unavailable | `503` "try again" page with `Retry-After`; session cookie left alone; never described as "signed out" |
| WorkOS unreachable | `502` "sign-in service unavailable"; nothing created |
| WorkOS refused / bad state / bad token / no `sid` / unverified email | `400`/`403` generic page, nothing created |
| not a member / unknown organization | identical `404` (existence is never revealed) |
| member lacks the permission (for example Team page) | `403` |
| unexpected bug | `500` generic page; detail only in the log, by reference id |

## `client_redirect_key` in the Referer (investigation)

Confirmed (from the Phase 0 log review): Cloudflare's request logs retain request headers other than cookies, and at least one logged
callback request carried a `Referer` containing a `client_redirect_key` query parameter.

Not confirmed: what the key is, whether it is a secret or grants anything, and which WorkOS page sends it. A web search of WorkOS's
public documentation found no mention of `client_redirect_key`. That is "undocumented", not "safe".

What the code does regardless: never reads or logs `Referer`; sends `Referrer-Policy: no-referrer` on every portal response so no portal page
leaks anything onward; keeps the one-time `code` and `state` out of logs (and Staging's `redact_query_string` already hides query strings).

Recommended, needs your decision: ask WorkOS support what `client_redirect_key` is and whether it is sensitive; consider turning off
Worker invocation request logging for the portal (the `observability` `logs.invocation_logs` option; validate with `wrangler` before use)
or shortening log retention. Neither is changed here.

## Rate limiting

Two independent layers, both Staging only today:

1. **Cloudflare WAF rate-limiting rule** (dashboard; the Free plan allows one). It runs before the Worker, so blocked requests cost no Worker
   invocation, database or WorkOS call. It is not part of this repository.
2. **Workers Rate Limiting binding `PORTAL_RATE_LIMITER`** (`wrangler.jsonc` `previews.ratelimits`, namespace `4101`, **20 requests per 60 seconds**).
   `worker/portal/ratelimit.js` calls it for `/portal/login?start=1`, `/portal/auth/callback` and `POST /portal/logout` (the plain login page and
   authenticated browsing are not limited). Each (bucket, client network) has its own counter, so one noisy client or bucket cannot use up another's.
   * **Runs first:** the check happens before any session, database or WorkOS work; a limited request gets a `429` page with `Retry-After: 60`
     and a `rate.limited` log line.
   * **Who is counted:** IPv4 per address, IPv6 per **/64** (IPv4-mapped IPv6 as the IPv4 address). Keys are a keyed hash of that network
     (`<bucket>:<32 hex>`); the raw address is never stored or logged.
   * **Missing or invalid `CF-Connecting-IP`** (never happens behind Cloudflare, which sets it): the request is **not limited**. A shared
     "unknown" bucket would let one unattributable client throttle everyone.
   * **Fails open:** no binding, a limiter error or an unexpected result means "not limited". The WAF rule stays in front.
   * **Limits of the binding:** counters are per Cloudflare location and approximate; the period can only be 10 or 60 seconds; `namespace_id`
     values are shared by every binding with the same id in the account (use a different id for Production when that is ever approved).
   * **Not verified from the repo:** that Cloudflare applies `previews.ratelimits` in the Preview runtime and that the Free plan includes the binding.
     Verify after deployment with a small, paced, supervised test (about 25 requests to `/portal/login?start=1` over ~50 seconds, kept under the WAF
     rule's rate): the first 20 should redirect, the rest return `429`.
* **Sign-out body bound:** `POST /portal/logout` accepts at most 2048 bytes. A declared oversized or malformed `Content-Length` is refused (`413`/`400`)
  before the session lookup and without reading the body; a chunked body is cancelled as soon as it crosses the limit.
* No database counters are used (that would need a migration).

## Settings required (names only)

Staging vars (already in `wrangler.jsonc` `previews.vars`): `PORTAL_BASE_URL`, `PORTAL_AUTH_CLIENT_ID`, `PORTAL_AUTH_ISSUER`.
Secrets (Cloudflare only): `PORTAL_AUTH_CLIENT_SECRET` (WorkOS API key), `PORTAL_SESSION_PEPPER`.
Activation adds: `PORTAL_ENABLED="1"` (Staging preview vars only). Production: none of these, ever, without separate approval.

### Generating the pepper (32+ bytes of randomness; never display or commit it)

```
openssl rand -base64 48        # 64 characters; the portal requires >= 43 characters, 12+ distinct symbols
```
Paste the output straight into the Cloudflare secret field (Workers & Pages > framework > Settings > Variables and Secrets, Staging /
preview environment). Do not paste it into chat, a file, or a command that is saved in shell history. Changing the pepper signs everyone out
and invalidates in-flight sign-ins (acceptable on Staging).

## Activation checklist (NOT done; needs explicit authorization)

1. Staging only: confirm `PORTAL_SESSION_PEPPER` meets the rule above (rotate if unsure) and the API key secret is set.
2. Run the reviewed seed (`migrations/portal-seed/README.md`) for the test email. The test email must already exist as a WorkOS user
   (it does from Phase 0) because WorkOS sign-up is disabled.
3. DONE (wiring commit, portal still off): `worker/index.js` calls `handlePortal` for `/portal*` with an explicit 404 fallback; `run_worker_first`
   is `/api/*`, `/admin`, `/admin/*`, `/card`, `/portal`, `/portal/*`; the probe, its test and `PORTAL_PROBE` are removed.
   DONE (activation commit): `"PORTAL_ENABLED": "1"` in `previews.vars` ONLY; the pinned config/wiring tests were updated to match.
4. Cloudflare: "Always Use HTTPS" on for the zone (the Worker sends one-year HSTS without includeSubDomains/preload); create the one rate rule (or the binding).
5. WorkOS dashboard: confirm redirect URI, initiate-login URL, sign-out URI are unchanged (`/portal/auth/callback`, `/portal/login`, `/portal/login`).
6. Staging browser checks: invited sign-in; second browser; logout (both portal and WorkOS session end); expired session; uninvited email -> no access;
   second test email for the multi-organization picker; confirm `Referer` handling after the WorkOS answer.
7. Production stays disabled until a separate launch review (MFA / passkeys decision happens there).
