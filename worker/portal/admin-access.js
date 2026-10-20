/**
 * Framework Admin: client access management API (Phase 2). Creates client organizations, lists their members and invitations, creates, revokes and
 * replaces invitations, changes member roles and removes members. DATABASE ONLY: nothing here sends an email or calls WorkOS (delivery lives in
 * invite-delivery.js and is not wired to any route yet).
 *
 * Authorization: reached only from worker/admin/router.js AFTER authenticateAdmin() (a verified Cloudflare Access token for an email on ADMIN_EMAILS).
 * That email is the actor recorded in every audit entry. Writes additionally need:
 *   - PORTAL_ADMIN_WRITES = "1" (an explicit switch, absent from every checked-in configuration: until it is set, the write routes answer 403 writes_disabled);
 *   - a same-origin request carrying X-Framework-Admin: 1 (CSRF defence: a cross-site page cannot set that header without a CORS preflight, which is never granted);
 *   - Content-Type: application/json, a body of at most 2 KB, and exactly the documented fields (unknown fields are refused, not ignored).
 *
 * Every operation is organization-scoped: the organization id comes from the URL (validated as a UUID and looked up), and the membership or
 * invitation id must belong to it, otherwise 404. Emergency global offboarding is deliberately NOT reachable from here.
 *
 * Routes (path after /api/admin):
 *   GET  /clients/:org/access                         organization, members, invitations
 *   POST /clients                                     {name, slug?, websiteUrl?}   create an organization
 *   POST /clients/:org/invitations                    {email, role}                create a pending invitation (7 days), not sent
 *   POST /clients/:org/invitations/:id/revoke         {}                           revoke a pending invitation
 *   POST /clients/:org/invitations/:id/replace        {role?}                      replace an expired or revoked invitation with a fresh 7-day one
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

const MAX_BODY = 2048;
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
const err = (status, error, message, extra = {}) => json({ error, message, ...extra }, status);

const STATUS = {
  invalid_slug: 422, invalid_name: 422, invalid_website_url: 422, invalid_email: 422, invalid_role: 422, invalid_expiry: 422, invalid_actor: 500,
  not_found: 404, invalid_organization: 404,
  slug_taken: 409, revenue_client_taken: 409, already_pending: 409, already_member: 409, last_owner: 409, still_pending: 409, already_revoked: 409,
  already_expired: 409, already_accepted: 409, not_revoked: 409, organization_inactive: 409,
};

/** The data layer's structured failure, as a safe HTTP response. Anything it does not know about becomes a bare 500. */
function fromFailure(r) {
  const status = STATUS[r.error];
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
const publicInvitation = (i, nowIso) => ({
  id: i.id, email: i.email, role: i.role, status: i.status, created_at: i.created_at, created_by: i.created_by, expires_at: i.expires_at,
  accepted_at: i.accepted_at, revoked_at: i.revoked_at, past_expiry: i.status === "pending" && i.expires_at <= nowIso,
});
// Delivery is not wired to any route yet, so no invitation created here has been sent. (Delivery tracking needs the proposed migration: see INVITATION-DELIVERY-PLAN.md.)
const NOT_SENT = Object.freeze({ state: "not_sent", sending: "not_enabled" });

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
  const invitations = (
    await rdb
      .prepare("SELECT id, email, role, status, created_at, created_by, expires_at, accepted_at, revoked_at FROM invitations WHERE organization_id = ? ORDER BY created_at DESC, id LIMIT 200")
      .bind(org.id)
      .all()
  ).results;
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
    delivery: NOT_SENT,
  };
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
  else if (seg.length === 5 && seg[2] === "invitations" && (seg[4] === "revoke" || seg[4] === "replace")) route = { kind: "invitation_" + seg[4], org: seg[1], target: seg[3] };
  else if (seg.length === 5 && seg[2] === "members" && (seg[4] === "role" || seg[4] === "remove")) route = { kind: "member_" + seg[4], org: seg[1], target: seg[3] };
  else return null;

  const wanted = route.kind === "access" ? "GET" : "POST";
  if (method !== wanted) return json({ error: "method_not_allowed", message: "That method is not allowed here." }, 405, { Allow: wanted });
  if (route.org !== undefined && !UUID.test(route.org)) return err(404, "not_found", "No such organization.");
  if (route.target !== undefined && !UUID.test(route.target)) return err(404, "not_found", "Not found.");

  if (wanted === "POST") {
    if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Client access changes are not enabled on this deployment.");
    if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  }
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");

  try {
    const db = env.PORTAL_DB;
    const actor = principal && principal.email;
    const fields = {
      create_org: ["name", "slug", "websiteUrl"], invite: ["email", "role"], invitation_revoke: [], invitation_replace: ["role"], member_role: ["role"], member_remove: [],
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
      const r = await createInvitation(db, org.id, { email: body.email, role: body.role, createdBy: actor }, { now });
      return r.ok ? json({ invitation: publicInvitation(r.invitation, now.toISOString()), delivery: NOT_SENT }, 201) : fromFailure(r);
    }

    if (route.kind === "invitation_revoke") {
      const r = await revokeInvitation(db, org.id, route.target, actor, { now });
      if (!r.ok) return fromFailure(r);
      return json({ invitation: publicInvitation(await getInvitation(db, org.id, route.target), now.toISOString()) });
    }

    if (route.kind === "invitation_replace") {
      if (body.role !== undefined && !validateEnum(body.role, ROLES)) return err(422, "invalid_role", "The role must be owner or member.");
      const r = await replaceInvitation(db, org.id, route.target, { actor, role: body.role }, { now }); // always a fresh 7 days
      return r.ok ? json({ invitation: publicInvitation(r.invitation, now.toISOString()), replaced: r.replaced, delivery: NOT_SENT }, 201) : fromFailure(r);
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
