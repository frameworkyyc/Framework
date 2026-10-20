/**
 * Invitation recipient allowlist: a TEMPORARY, server-side control for the controlled live invitation test.
 *
 * PORTAL_INVITE_ALLOWED_EMAILS is a list of exact email addresses (separated by commas, semicolons or whitespace). While it is the gate:
 *   - an invitation can be CREATED, REPLACED, SENT or RESENT only for an address on the list;
 *   - a missing, empty or unusable list locks ALL of those operations (fail closed): there is deliberately no "allow everyone" value, so lifting the
 *     restriction later is an explicit, reviewed code change and never a missing setting.
 * Matching is exact after normalization (trimmed, lower-cased, same validator as every other email in the portal). There is no wildcard, domain match,
 * plus-address or dot folding: `name+test@gmail.com` is a different address from `name@gmail.com`. Entries containing anything that looks like a pattern
 * are discarded rather than interpreted.
 *
 * The decision is made in the Worker (worker/portal/admin-access.js, and again in invite-delivery.js), before any database write or provider call, and the
 * answer never reveals which addresses are allowed.
 */
import { normalizeEmail } from "./repo/validate.js";

const SEPARATORS = /[\s,;]+/;
const PATTERN_CHARS = /[*?%\\<>()[\]{}|"'`!$^~=&]/; // an entry that looks like a pattern, a display name or a header trick is never an address

/** @returns {Set<string>} the usable, normalized addresses from the raw setting (possibly empty) */
export function parseAllowlist(raw) {
  const out = new Set();
  if (typeof raw !== "string" || raw.length > 4096) return out;
  for (const part of raw.split(SEPARATORS)) {
    if (!part || PATTERN_CHARS.test(part)) continue;
    const email = normalizeEmail(part);
    if (email && !email.startsWith("@") && !/^\.|\.@|@\.|\.\./.test(email)) out.add(email);
  }
  return out;
}

/** The policy for this deployment: restricted (with the usable list) or locked (nothing may be invited). */
export function recipientPolicy(env) {
  const emails = parseAllowlist(env && env.PORTAL_INVITE_ALLOWED_EMAILS);
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
