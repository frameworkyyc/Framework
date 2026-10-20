/**
 * Framework Admin: client access management API. Creates client organizations, lists their members and invitations, creates, revokes and replaces
 * invitations, changes member roles, removes members, and (Phase 3) sends and resends invitations through WorkOS or, for people who already have a
 * WorkOS user, through Framework's own email (invite-delivery.js).
 *
 * Authorization: reached only from worker/admin/router.js AFTER authenticateAdmin() (a verified Cloudflare Access token for an email on ADMIN_EMAILS).
 * That email is the actor recorded in every audit entry. Writes additionally need:
 *   - PORTAL_ADMIN_WRITES = "1" (an explicit switch, absent from every checked-in configuration: until it is set, the write routes answer 403 writes_disabled);
 *   - anything that contacts a provider (send, resend, and cancelling the WorkOS side of a revoke) ALSO needs PORTAL_INVITE_SENDING = "1", a second switch that is
 *     likewise absent everywhere: send and resend answer 403 sending_disabled, and a revoke then changes D1 only;
 *   - a same-origin request carrying X-Framework-Admin: 1 (CSRF defence: a cross-site page cannot set that header without a CORS preflight, which is never granted);
 *   - Content-Type: application/json, a body of at most 2 KB, and exactly the documented fields (unknown fields are refused, not ignored).
 *
 * RECIPIENT ALLOWLIST (temporary, for the controlled live test): creating, replacing, sending or resending an invitation is refused with 403
 * recipient_not_allowed unless the address is on PORTAL_INVITE_ALLOWED_EMAILS, and with 403 recipient_allowlist_missing (fail closed) when that setting is
 * missing or empty. The check runs before any database change or provider call, on the address in the request or in the stored invitation (so an invitation
 * created earlier for another address can never be sent). See invite-recipients.js.
 *
 * Every operation is organization-scoped: the organization id comes from the URL (validated as a UUID and looked up), and the membership or
 * invitation id must belong to it, otherwise 404. Emergency global offboarding is deliberately NOT reachable from here.
 *
 * Routes (path after /api/admin):
 *   GET  /clients/:org/access                         organization, members, invitations
 *   POST /clients                                     {name, slug?, websiteUrl?}   create an organization
 *   POST /clients/:org/invitations                    {email, role}                create a pending invitation (7 days), not sent
 *   POST /clients/:org/invitations/:id/revoke         {}                           revoke in D1 first, then cancel the WorkOS invitation (partial failure is reported; repeat to retry WorkOS)
 *   POST /clients/:org/invitations/:id/replace        {role?}                      replace an expired or revoked invitation with a fresh 7-day one
 *   POST /clients/:org/invitations/:id/send           {}                           first send (or retry after a failure); new WorkOS user -> WorkOS invitation,
 *                                                                                  existing WorkOS user -> Framework email. Never changes the expiry.
 *   POST /clients/:org/invitations/:id/resend         {}                           resend a submitted invitation; the original expiry is kept
 *   POST /clients/:org/members/:user/role             {role}                       change a role (the last active owner cannot be demoted)
 *   POST /clients/:org/members/:user/remove           {}                           remove access (the last active owner cannot be removed); data is kept
 * Errors are { error: <code>, message: <sentence> } (plus invitationId for a duplicate); unexpected failures answer a bare server_error.
 */
import { readOnlyDb } from "./admin-clients.js";
import { createOrganizationAudited, getOrganizationById } from "./repo/orgs.js";
import { createInvitation, replaceInvitation, revokeInvitation, getInvitation } from "./repo/invitations.js";
import { setMemberRole, revokeMembership } from "./repo/memberships.js";
import { validateSlug, validateName, validateHttpsUrl, normalizeEmail, validateEnum, ROLES } from "./repo/validate.js";
import { UUID } from "./repo/common.js";
import { createWorkosAdminClient } from "./workos-admin.js";
import { deliverInvitation, revokeInvitationEverywhere } from "./invite-delivery.js";
import { sendEmail } from "../assessment.js";
import { checkRecipient, allowlistStatus } from "./invite-recipients.js";

const MAX_BODY = 2048;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const err = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);

const STATUS = {
  invalid_slug: 422, invalid_name: 422, invalid_website_url: 422, invalid_email: 422, invalid_role: 422, invalid_expiry: 422, invalid_actor: 500,
  not_found: 404, invalid_organization: 404,
  slug_taken: 409, revenue_client_taken: 409, already_pending: 409, already_member: 409, last_owner: 409, still_pending: 409, already_revoked: 409,
  already_expired: 409, already_accepted: 409, not_revoked: 409, organization_inactive: 409,
  expired_replace_required: 409, already_submitted: 409, not_yet_submitted: 409, invitation_revoked: 409, send_in_progress: 409,
  delivery_unrecorded: 500, recipient_not_allowed: 403, recipient_allowlist_missing: 403,
};

/** The data layer's structured failure, as a safe HTTP response. Anything it does not know about becomes a bare 500. */
function fromFailure(r) {
  const status = STATUS[r.error];
  if (r.error === "delivery_unrecorded") return err(500, "delivery_unrecorded", r.message);
  if (!status || status === 500) return err(500, "server_error", "Something went wrong. Nothing was changed.");
  return err(status, r.error, r.message || "The change was not made.", r.invitationId ? { invitationId: r.invitationId } : {});
}

/** State-changing requests must come from our own pages: same Origin plus a custom header (the existing admin pattern). */
function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  if (!origin || origin !== new URL(request.url).origin) return false;
  return request.headers.get("X-Framework-Admin") === "1";
}

/** @returns {{body: object}|{response: Response}} exactly the allowed keys, nothing else */
async function readBody(request, allowed) {
  const type = (request.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") return { response: err(415, "unsupported_media_type", "Send the request as application/json.") };
  const declared = Number(request.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) return { response: err(413, "payload_too_large", "The request is too large.") };
  const text = await request.text();
  if (text.length > MAX_BODY) return { response: err(413, "payload_too_large", "The request is too large.") };
  let body;
  try {
    body = text.trim() === "" ? {} : JSON.parse(text);
  } catch {
    return { response: err(400, "invalid_json", "The request body is not valid JSON.") };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return { response: err(400, "invalid_json", "The request body must be a JSON object.") };
  const unknown = Object.keys(body).filter((k) => !allowed.includes(k));
  if (unknown.length) return { response: err(400, "unknown_field", "The request contains a field that is not accepted.") };
  return { body };
}

/** "Acme Co. Ltd." -> "acme-co-ltd". Returns "" when nothing usable remains (the caller then asks for an explicit URL name). */
export function slugFromName(name) {
  const s = String(name || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "");
  return validateSlug(s) || "";
}

const publicOrg = (o) => ({ id: o.id, name: o.name, slug: o.slug, status: o.status, website_url: o.website_url, created_at: o.created_at });
/**
 * Delivery state, kept apart from the invitation's own status. "submitted" means a provider ACCEPTED our request: it never means the email reached an inbox.
 * Rows from a database without migration 0004 carry no delivery fields; they are reported as not tracked.
 */
const deliveryOf = (i) =>
  i && i.delivery_status !== undefined
    ? { state: i.delivery_status, channel: i.delivery_channel, attempted_at: i.delivery_attempted_at, error: i.delivery_error }
    : { state: "not_tracked" };
const publicInvitation = (i, nowIso) => ({
  id: i.id, email: i.email, role: i.role, status: i.status, created_at: i.created_at, created_by: i.created_by, expires_at: i.expires_at,
  accepted_at: i.accepted_at, revoked_at: i.revoked_at, past_expiry: i.status === "pending" && i.expires_at <= nowIso, delivery: deliveryOf(i),
  // For a REVOKED invitation that was submitted to WorkOS: has the WorkOS side been cancelled? "pending" means D1 is revoked but the cleanup still needs a retry.
  workos_cleanup: i.workos_cleanup || "none",
});
/** A freshly created or replaced invitation has not been sent: true by construction (the column default). */
const fresh = (i, nowIso) => publicInvitation({ ...i, delivery_status: "not_sent", delivery_channel: null, delivery_attempted_at: null, delivery_error: null }, nowIso);
const CLEANUP_COLUMN = `, CASE WHEN status = 'revoked' AND workos_invitation_id IS NOT NULL
    THEN CASE WHEN EXISTS (SELECT 1 FROM activity_log a WHERE a.organization_id = invitations.organization_id AND a.entity_id = invitations.id AND a.action = 'invitation.workos_revoked') THEN 'done' ELSE 'pending' END
    ELSE 'none' END AS workos_cleanup`;
const DELIVERY_COLUMNS = ", delivery_status, delivery_channel, delivery_attempted_at, delivery_error";

async function readAccess(env, org, now) {
  const rdb = readOnlyDb(env.PORTAL_DB);
  const members = (
    await rdb
      .prepare(
        `SELECT m.user_id, u.email, u.name, m.role, m.status, u.status AS user_status, m.created_at, u.last_login_at
           FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = ? ORDER BY m.created_at, u.email`,
      )
      .bind(org.id)
      .all()
  ).results;
  const invitationSql = (extra) => `SELECT id, email, role, status, created_at, created_by, expires_at, accepted_at, revoked_at${extra}${CLEANUP_COLUMN} FROM invitations WHERE organization_id = ? ORDER BY created_at DESC, id LIMIT 200`;
  let invitations;
  try {
    invitations = (await rdb.prepare(invitationSql(DELIVERY_COLUMNS)).bind(org.id).all()).results;
  } catch {
    invitations = (await rdb.prepare(invitationSql("")).bind(org.id).all()).results; // a database without migration 0004 (for example Production's, which is not migrated)
  }
  const nowIso = now.toISOString();
  const activeOwners = members.filter((m) => m.role === "owner" && m.status === "active" && m.user_status === "active").length;
  return {
    organization: publicOrg(org),
    members: members.map((m) => ({
      user_id: m.user_id, email: m.email, name: m.name, role: m.role, status: m.status, user_status: m.user_status, joined_at: m.created_at, last_login_at: m.last_login_at,
      // advisory only: the database refuses removing or demoting the last active owner whatever this says
      last_active_owner: m.role === "owner" && m.status === "active" && m.user_status === "active" && activeOwners === 1,
    })),
    invitations: invitations.map((i) => publicInvitation(i, nowIso)),
    delivery_tracking: invitations.length === 0 ? undefined : invitations[0].delivery_status !== undefined,
    // Whether this deployment accepts changes, and whether it may contact providers. Booleans only: lets the interface explain itself instead of failing on click.
    capabilities: { writes: env.PORTAL_ADMIN_WRITES === "1", sending: env.PORTAL_ADMIN_WRITES === "1" && env.PORTAL_INVITE_SENDING === "1", recipients: allowlistStatus(env) }, // "configured" | "missing": never the addresses
  };
}

/** The WorkOS client built from the Worker's existing secret, or a short code saying why there is none. */
function workosClient(env, deps) {
  try {
    return { client: createWorkosAdminClient({ apiKey: env.PORTAL_AUTH_CLIENT_SECRET, fetch: deps.fetch || fetch }), code: null };
  } catch {
    return { client: null, code: "workos_not_configured" };
  }
}

/** Providers for a send or resend. Missing configuration answers 503 BEFORE anything is attempted or recorded. */
function deliveryContext(env, deps, db, now) {
  const wk = workosClient(env, deps);
  if (!wk.client) return { error: err(503, "provider_not_configured", "WorkOS is not configured on this deployment. Nothing was sent.") };
  let base;
  try {
    base = new URL(env.PORTAL_BASE_URL).origin;
  } catch {
    return { error: err(503, "provider_not_configured", "The portal address is not configured on this deployment. Nothing was sent.") };
  }
  const f = deps.fetch || fetch;
  return { db, workos: wk.client, sendEmail: (m) => sendEmail(env, m, f), baseUrl: base, now, checkRecipient: (email) => checkRecipient(env, email) };
}

/**
 * The allowlist check for an operation on an existing invitation. Returns a Response to answer with, or null to carry on.
 * Order: a locked allowlist answers first (nothing is looked at); an unknown invitation is the usual 404; otherwise its stored address must be approved.
 */
async function gateStoredInvitation(env, db, organizationId, invitationId) {
  const locked = checkRecipient(env, null);
  if (locked.error === "recipient_allowlist_missing") return err(403, locked.error, locked.message);
  const row = await db.prepare("SELECT email FROM invitations WHERE id = ? AND organization_id = ?").bind(invitationId, organizationId).first();
  if (!row) return err(404, "not_found", "No such invitation in this organization.");
  const gate = checkRecipient(env, row.email);
  return gate.ok ? null : err(403, gate.error, gate.message);
}

/** Does this database have migration 0004's delivery columns? (A database that has not been migrated answers false.) */
async function hasDeliveryColumns(db) {
  try {
    await db.prepare("SELECT delivery_status FROM invitations LIMIT 1").first();
    return true;
  } catch {
    return false;
  }
}

async function readInvitationRow(db, organizationId, id) {
  const sqlText = (extra) => `SELECT id, email, role, status, created_at, created_by, expires_at, accepted_at, revoked_at${extra}${CLEANUP_COLUMN} FROM invitations WHERE id = ? AND organization_id = ?`;
  try {
    return await db.prepare(sqlText(DELIVERY_COLUMNS)).bind(id, organizationId).first();
  } catch {
    return await db.prepare(sqlText("")).bind(id, organizationId).first();
  }
}

/**
 * @param path pathname with "/api/admin" removed. @returns Response, or null when the path is not an access-management route.
 */
export async function handleAccessApi(request, env, principal, path, deps = {}) {
  const seg = path.split("/").filter(Boolean);
  if (seg[0] !== "clients") return null;
  const method = request.method;
  const now = deps.now || new Date();

  // Route table. `kind` decides the method and the body schema.
  let route = null;
  if (seg.length === 1) {
    if (method !== "POST") return null; // GET /clients (and others) belong to the read-only Clients handler
    route = { kind: "create_org" };
  } else if (seg.length === 3 && seg[2] === "access") route = { kind: "access", org: seg[1] };
  else if (seg.length === 3 && seg[2] === "invitations") route = { kind: "invite", org: seg[1] };
  else if (seg.length === 5 && seg[2] === "invitations" && (seg[4] === "revoke" || seg[4] === "replace" || seg[4] === "send" || seg[4] === "resend")) route = { kind: "invitation_" + seg[4], org: seg[1], target: seg[3] };
  else if (seg.length === 5 && seg[2] === "members" && (seg[4] === "role" || seg[4] === "remove")) route = { kind: "member_" + seg[4], org: seg[1], target: seg[3] };
  else return null;

  const wanted = route.kind === "access" ? "GET" : "POST";
  if (method !== wanted) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: wanted });
  if (route.org !== undefined && !UUID.test(route.org)) return err(404, "not_found", "No such organization.");
  if (route.target !== undefined && !UUID.test(route.target)) return err(404, "not_found", "Not found.");

  if (wanted === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Client access changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
    if ((route.kind === "invitation_send" || route.kind === "invitation_resend") && env.PORTAL_INVITE_SENDING !== "1") {
      return err(403, "sending_disabled", "Sending invitations is not enabled on this deployment.");
    }
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");

  try {
    const db = env.PORTAL_DB;
    const actor = principal && principal.email;
    const fields = {
      create_org: ["name", "slug", "websiteUrl"], invite: ["email", "role"], invitation_revoke: [], invitation_replace: ["role"], invitation_send: [], invitation_resend: [], member_role: ["role"], member_remove: [],
    }[route.kind];
    let body = {};
    if (wanted === "POST") {
      const read = await readBody(request, fields);
      if (read.response) return read.response;
      body = read.body;
    }

    if (route.kind === "create_org") {
      if (typeof body.name !== "string" || !validateName(body.name) || (body.slug !== undefined && typeof body.slug !== "string") || (body.websiteUrl !== undefined && body.websiteUrl !== null && typeof body.websiteUrl !== "string")) {
        return err(422, "invalid_name", "Enter the organization's name.");
      }
      const slug = body.slug !== undefined ? body.slug : slugFromName(body.name);
      if (!slug) return err(422, "invalid_slug", "A URL name could not be made from that name. Enter one (letters, digits and hyphens).");
      const r = await createOrganizationAudited(db, { name: body.name, slug, websiteUrl: body.websiteUrl }, actor, { now });
      return r.ok ? json({ organization: publicOrg(r.organization) }, 201) : fromFailure(r);
    }

    const org = await getOrganizationById(db, route.org);
    if (!org) return err(404, "not_found", "No such organization.");

    if (route.kind === "access") return json(await readAccess(env, org, now));

    if (route.kind === "invite") {
      if (typeof body.email !== "string" || !normalizeEmail(body.email)) return err(422, "invalid_email", "Enter a valid email address.");
      if (!validateEnum(body.role, ROLES)) return err(422, "invalid_role", "The role must be owner or member.");
      const gate = checkRecipient(env, body.email);
      if (!gate.ok) return err(403, gate.error, gate.message); // before any write
      const r = await createInvitation(db, org.id, { email: body.email, role: body.role, createdBy: actor }, { now });
      return r.ok ? json({ invitation: fresh(r.invitation, now.toISOString()) }, 201) : fromFailure(r);
    }

    // Send, resend and replace act on a STORED invitation: its own address must be approved (an invitation made earlier for another address can never be sent).
    if (route.kind === "invitation_send" || route.kind === "invitation_resend" || route.kind === "invitation_replace") {
      const gate = await gateStoredInvitation(env, db, org.id, route.target);
      if (gate) return gate;
    }

    if (route.kind === "invitation_send" || route.kind === "invitation_resend") {
      if (!(await hasDeliveryColumns(db))) return err(503, "delivery_tracking_unavailable", "Invitation delivery tracking is not available on this database. Nothing was sent.");
      const ctx = deliveryContext(env, deps, db, now);
      if (ctx.error) return ctx.error;
      const r = await deliverInvitation(ctx, { organizationId: org.id, invitationId: route.target, actor, mode: route.kind === "invitation_send" ? "send" : "resend" });
      const row = await readInvitationRow(db, org.id, route.target);
      if (r.ok) return json({ delivery: r.delivery, invitation: row ? publicInvitation(row, now.toISOString()) : undefined });
      if (r.error === "delivery_failed") return json({ error: "delivery_failed", message: r.message, delivery: r.delivery, invitation: row ? publicInvitation(row, now.toISOString()) : undefined }, 502, {});
      return fromFailure(r);
    }

    if (route.kind === "invitation_revoke") {
      // WorkOS is contacted only when sending is switched on AND a key exists; otherwise the revoke is D1-only and says why.
      const wk = env.PORTAL_INVITE_SENDING === "1" ? workosClient(env, deps) : { client: null, code: "sending_disabled" };
      const tracked = await hasDeliveryColumns(db);
      const r = tracked
        ? await revokeInvitationEverywhere({ db, workos: wk.client, workosUnavailableCode: wk.code, now }, { organizationId: org.id, invitationId: route.target, actor })
        : await revokeInvitation(db, org.id, route.target, actor, { now });
      if (!r.ok) return fromFailure(r);
      const row = await readInvitationRow(db, org.id, route.target);
      return json({ invitation: publicInvitation(row, now.toISOString()), ...(r.workos ? { workos: r.workos } : {}) });
    }

    if (route.kind === "invitation_replace") {
      if (body.role !== undefined && !validateEnum(body.role, ROLES)) return err(422, "invalid_role", "The role must be owner or member.");
      const r = await replaceInvitation(db, org.id, route.target, { actor, role: body.role }, { now }); // always a fresh 7 days
      return r.ok ? json({ invitation: fresh(r.invitation, now.toISOString()), replaced: r.replaced }, 201) : fromFailure(r);
    }

    if (route.kind === "member_role") {
      if (!validateEnum(body.role, ROLES)) return err(422, "invalid_role", "The role must be owner or member.");
      const r = await setMemberRole(db, org.id, route.target, body.role, actor, { now });
      return r.ok ? json({ changed: r.changed, role: body.role }) : fromFailure(r);
    }

    // member_remove
    const r = await revokeMembership(db, org.id, route.target, actor, { now });
    return r.ok ? json({ changed: r.changed }) : fromFailure(r);
  } catch (e) {
    console.error("admin access api error:", e && e.name); // never the message: it can carry SQL text or values
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
