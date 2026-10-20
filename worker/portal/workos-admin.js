/**
 * WorkOS AuthKit administrative client (server-side, used only for invitation delivery). NOT WIRED to any route and NEVER called with a live key by
 * the tests: every test injects a fake fetch. The endpoint paths and field names below come from WorkOS's public reference as far as it could be read
 * (POST /user_management/invitations with email and expires_in_days; POST /user_management/invitations/{id}/resend and /revoke; GET /user_management/users?email=)
 * and are UNVERIFIED against a live Staging call. That is why every response is validated strictly: anything unexpected is a failure (workos_bad_response),
 * never a success.
 *
 * The API key is the Worker's existing PORTAL_AUTH_CLIENT_SECRET. A WorkOS API key is environment-wide, so this adds no new secret and no new exposure,
 * but it also cannot be narrowed to "invitations only". It is sent only in the Authorization header and never logged, returned or placed in an error.
 * Errors carry a short code only: never the response body, never the address.
 *
 * Codes: workos_unreachable (network or timeout), workos_unauthorized (401/403), workos_rate_limited (429), workos_rejected (other 4xx),
 * workos_unavailable (5xx), workos_bad_response (a 2xx that is not the documented shape).
 */
const BASE = "https://api.workos.com";
const INVITATION_ID = /^invitation_[A-Za-z0-9]{5,100}$/;

export class WorkosAdminError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkosAdminError";
    this.code = code;
  }
}

export function createWorkosAdminClient({ apiKey, fetch: doFetch = fetch, timeoutMs = 8000, base = BASE } = {}) {
  if (typeof apiKey !== "string" || apiKey.length < 8) throw new WorkosAdminError("workos_not_configured");

  async function call(method, path, body) {
    let res;
    try {
      res = await doFetch(base + path, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new WorkosAdminError("workos_unreachable");
    }
    if (res.status === 401 || res.status === 403) throw new WorkosAdminError("workos_unauthorized");
    if (res.status === 429) throw new WorkosAdminError("workos_rate_limited");
    if (res.status >= 500) throw new WorkosAdminError("workos_unavailable");
    if (res.status < 200 || res.status > 299) throw new WorkosAdminError("workos_rejected");
    let data;
    try {
      data = await res.json();
    } catch {
      throw new WorkosAdminError("workos_bad_response");
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new WorkosAdminError("workos_bad_response");
    return data;
  }

  return {
    /** Read-only: does a WorkOS user with this email already exist? */
    async findUserByEmail(email) {
      const data = await call("GET", `/user_management/users?email=${encodeURIComponent(email)}`);
      if (!Array.isArray(data.data)) throw new WorkosAdminError("workos_bad_response");
      const wanted = String(email).trim().toLowerCase();
      return { exists: data.data.some((u) => u && typeof u.email === "string" && u.email.trim().toLowerCase() === wanted) };
    },
    /** Ask WorkOS to create an invitation (and email it). Success only when WorkOS returns an invitation id. */
    async createInvitation({ email, expiresInDays }) {
      if (!Number.isInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 30) throw new WorkosAdminError("workos_rejected");
      const data = await call("POST", "/user_management/invitations", { email, expires_in_days: expiresInDays });
      if (typeof data.id !== "string" || !INVITATION_ID.test(data.id)) throw new WorkosAdminError("workos_bad_response");
      return { id: data.id };
    },
    async resendInvitation(id) {
      if (!INVITATION_ID.test(String(id))) throw new WorkosAdminError("workos_rejected");
      const data = await call("POST", `/user_management/invitations/${id}/resend`);
      if (data.id !== id) throw new WorkosAdminError("workos_bad_response");
      return { id };
    },
    async revokeInvitation(id) {
      if (!INVITATION_ID.test(String(id))) throw new WorkosAdminError("workos_rejected");
      const data = await call("POST", `/user_management/invitations/${id}/revoke`);
      if (data.id !== id) throw new WorkosAdminError("workos_bad_response");
      return { id };
    },
  };
}
