/**
 * Invitation recipient allowlist: a TEMPORARY, server-side control for the controlled live invitation test.
 *
 * PORTAL_INVITE_ALLOWLIST is a list of exact email addresses (separated by commas, semicolons or whitespace). It is a Cloudflare SECRET, never a
 * checked-in variable: the repository is public and the list is made of real people's addresses. See "Invitation recipient allowlist (secret)" in
 * worker/portal/INVITATION-DELIVERY-PLAN.md. While it is the gate:
 *   - an invitation can be CREATED, REPLACED, SENT or RESENT only for an address on the list;
 *   - a missing, empty or malformed list locks ALL of those operations (fail closed). "Malformed" means any entry that is not a plain, valid address
 *     (a wildcard, a display name, a quote, a stray character...) or a value that is too long: the WHOLE list is then refused rather than partly used,
 *     so a bad paste can never leave a half-understood list in force. There is deliberately no "allow everyone" value, so lifting the restriction later
 *     is an explicit, reviewed code change and never a missing setting.
 * Matching is exact after normalization (trimmed, lower-cased, same validator as every other email in the portal). There is no wildcard, domain match,
 * plus-address or dot folding: `name+test@example.test` is a different address from `name@example.test`. The old variable name
 * (PORTAL_INVITE_ALLOWED_EMAILS) is deliberately NOT read: a value left under it, or put back into checked-in configuration, does nothing.
 *
 * The decision is made in the Worker (worker/portal/admin-access.js, and again in invite-delivery.js), before any database write or provider call, and the
 * answer never reveals which addresses are allowed. Addresses are never logged.
 */
import { normalizeEmail } from "./repo/validate.js";

const SEPARATORS = /[\s,;]+/;
const PATTERN_CHARS = /[*?%\\<>()[\]{}|"'`!$^~=&]/; // an entry that looks like a pattern, a display name or a header trick is never an address

/** The name of the Cloudflare secret that holds the list. */
export const ALLOWLIST_SETTING = "PORTAL_INVITE_ALLOWLIST";

/** @returns {Set<string>} the normalized addresses of a well-formed setting; EMPTY (so locked) for a missing, empty or malformed one */
export function parseAllowlist(raw) {
  const out = new Set();
  if (typeof raw !== "string" || raw.length > 4096) return out;
  for (const part of raw.split(SEPARATORS)) {
    if (!part) continue;
    const email = PATTERN_CHARS.test(part) ? null : normalizeEmail(part);
    if (!email || email.startsWith("@") || /^\.|\.@|@\.|\.\./.test(email)) return new Set(); // one bad entry refuses the whole list
    out.add(email);
  }
  return out;
}

/** The policy for this deployment: restricted (with the usable list) or locked (nothing may be invited). */
export function recipientPolicy(env) {
  const emails = parseAllowlist(env && env[ALLOWLIST_SETTING]);
  return { locked: emails.size === 0, emails };
}

/** "configured" when at least one usable address is set; "missing" otherwise. Never includes the addresses. */
export const allowlistStatus = (env) => (recipientPolicy(env).locked ? "missing" : "configured");

/**
 * @returns {{ok:true, email:string} | {ok:false, error:"recipient_allowlist_missing"|"recipient_not_allowed", message:string}}
 * `raw` is whatever address the operation would use (a request field or a stored invitation's email).
 */
export function checkRecipient(env, raw) {
  const policy = recipientPolicy(env);
  if (policy.locked) {
    return { ok: false, error: "recipient_allowlist_missing", message: "Invitations are locked: no approved recipients are configured on this site. Nothing was created or sent." };
  }
  const email = normalizeEmail(raw);
  if (!email || !policy.emails.has(email)) {
    return { ok: false, error: "recipient_not_allowed", message: "This email address isn’t on the approved list for the controlled test, so no invitation was created or sent." };
  }
  return { ok: true, email };
}
