// Invitation delivery design (Phase 2, NOT WIRED): the proposed delivery-tracking migration, delivery state recording, the WorkOS administrative client
// and the delivery orchestration. Every provider is a mock; nothing here can reach WorkOS, Resend or a real address.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { openPortalDb, migrationFiles, count } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import { recordDeliveryAttempt, getDelivery } from "../portal/repo/invitation-delivery.js";
import { createWorkosAdminClient, WorkosAdminError } from "../portal/workos-admin.js";
import { deliverInvitation, existingUserEmail } from "../portal/invite-delivery.js";

const ADMIN = "admin@frameworkco.ca";
const T = new Date("2026-10-20T12:00:00.000Z");
const at = (days) => new Date(T.getTime() + days * 86400000);
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const rows = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const MIGRATION = "migrations/portal/0004_invitation_delivery.sql";
const BASE = "https://staging.frameworkco.ca";

/** The test database applies every file in migrations/portal, so it already has the delivery columns. */
const openWithDelivery = () => openPortalDb();
async function org(db, slug = "acme", name = "Acme Co") {
  const r = await repo.createOrganization(db, { slug, name }, { now: T });
  assert.ok(r.ok);
  return r.organization;
}
async function invitation(db, o, email = "sam@example.com", role = "member", now = T) {
  const r = await repo.createInvitation(db, o.id, { email, role, createdBy: ADMIN }, { now });
  assert.ok(r.ok, JSON.stringify(r));
  return r.invitation;
}
const audit = (db, where = "1=1") => rows(db, `SELECT actor_ref, action, entity_id, detail FROM activity_log WHERE ${where} ORDER BY created_at, rowid`);

/** Mock providers that record every call. */
function mocks({ userExists = false, lookup, create, resend, email, createId = "invitation_01MOCKCREATED" } = {}) {
  const calls = { find: [], create: [], resend: [], email: [] };
  const workos = {
    async findUserByEmail(e) { calls.find.push(e); if (lookup) throw lookup; return { exists: userExists }; },
    async createInvitation(a) { calls.create.push(a); if (create) throw create; return { id: createId }; },
    async resendInvitation(id) { calls.resend.push(id); if (resend) throw resend; return { id }; },
    async revokeInvitation() { throw new Error("not used"); },
  };
  const sendEmail = async (m) => { calls.email.push(m); if (email instanceof Error) throw email; return email || { ok: true }; };
  return { calls, ctx: (db, now = T) => ({ db, workos, sendEmail, baseUrl: BASE, now }) };
}
const send = (m, db, o, inv, over = {}) => deliverInvitation(m.ctx(db, over.now), { organizationId: o.id, invitationId: inv.id, actor: ADMIN, mode: over.mode || "send" });

/* ------------------------------------------------------------------ the proposed migration */

test("migration 0004: additive and compatible. It is the fourth portal migration, existing invitations become 'not_sent', and the constraints hold", () => {
  assert.deepEqual(migrationFiles(), ["0001_portal_foundation.sql", "0002_business_profile.sql", "0003_portal_feedback.sql", "0004_invitation_delivery.sql"]);
  assert.ok(!existsSync(new URL("../../migrations/portal-proposed/", import.meta.url)), "the proposal folder is gone: the file was moved, not copied");
  const sqlText = read(MIGRATION).replace(/^--.*$/gm, "");
  assert.deepEqual(sqlText.match(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE)\b/g), ["ALTER", "ALTER", "ALTER", "ALTER"], "four ALTER TABLE ... ADD COLUMN statements and nothing else");
  assert.deepEqual([...sqlText.matchAll(/ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map((m) => m.slice(1)), [["invitations", "delivery_status"], ["invitations", "delivery_channel"], ["invitations", "delivery_attempted_at"], ["invitations", "delivery_error"]]);
  assert.ok(!/DROP|DELETE|UPDATE|INSERT|CREATE/.test(sqlText));
  // a database exactly as Staging is today (0001 to 0003), with invitations in every status, then the migration
  const db = openPortalDb({ migrate: false });
  db.raw.exec("PRAGMA foreign_keys = ON");
  for (const f of migrationFiles().filter((f) => !f.startsWith("0004"))) db.raw.exec(read("migrations/portal/" + f));
  db.raw.exec(`INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES ('aaaaaaaa-0000-4000-8000-00000000000a', 'acme', 'Acme', 'active', '${T.toISOString()}', '${T.toISOString()}')`);
  db.raw.exec(`INSERT INTO portal_users (id, workos_user_id, email, status, created_at) VALUES ('11111111-1111-4111-8111-111111111111', 'user_01EXISTING', 'old@example.com', 'active', '${T.toISOString()}')`);
  const ins = (id, email, status, extra = "") => db.raw.exec(`INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at ${extra ? ", " + extra.split("|")[0] : ""}) VALUES ('${id}', 'aaaaaaaa-0000-4000-8000-00000000000a', '${email}', 'member', '${status}', '${T.toISOString()}', 'seed', '${at(7).toISOString()}' ${extra ? ", " + extra.split("|")[1] : ""})`);
  ins("10000000-0000-4000-8000-000000000001", "p@example.com", "pending");
  ins("10000000-0000-4000-8000-000000000002", "r@example.com", "revoked", `revoked_at, revoked_by|'${at(1).toISOString()}', 'seed'`);
  ins("10000000-0000-4000-8000-000000000003", "a@example.com", "accepted", `accepted_at, accepted_user_id|'${at(1).toISOString()}', '11111111-1111-4111-8111-111111111111'`);
  ins("10000000-0000-4000-8000-000000000004", "e@example.com", "expired");
  const COLS = "id, organization_id, email, role, workos_invitation_id, status, created_at, created_by, expires_at, accepted_at, accepted_user_id, revoked_at, revoked_by";
  const before = rows(db, `SELECT ${COLS} FROM invitations ORDER BY id`);
  db.raw.exec(read(MIGRATION));
  assert.deepEqual(rows(db, `SELECT ${COLS} FROM invitations ORDER BY id`), before, "every existing column is unchanged");
  assert.deepEqual(rows(db, "SELECT delivery_status, delivery_channel, delivery_attempted_at, delivery_error FROM invitations"), Array(4).fill({ delivery_status: "not_sent", delivery_channel: null, delivery_attempted_at: null, delivery_error: null }));
  assert.deepEqual(rows(db, "SELECT name FROM pragma_table_info('invitations') WHERE name LIKE 'delivery_%' ORDER BY cid").map((r) => r.name), ["delivery_status", "delivery_channel", "delivery_attempted_at", "delivery_error"]);
  // constraints
  const bad = (set) => assert.throws(() => db.raw.exec(`UPDATE invitations SET ${set} WHERE id = '10000000-0000-4000-8000-000000000001'`), /constraint/i, set);
  bad("delivery_status = 'delivered'"); bad("delivery_status = 'sent'"); bad("delivery_status = NULL"); bad("delivery_channel = 'smtp'"); bad("delivery_error = 'Has Spaces!'"); bad("delivery_error = ''"); bad("delivery_error = '" + "a".repeat(41) + "'");
  db.raw.exec("UPDATE invitations SET delivery_status = 'failed', delivery_channel = 'workos', delivery_error = 'workos_rejected' WHERE id = '10000000-0000-4000-8000-000000000001'");
  assert.equal(rows(db, "SELECT count(*) AS n FROM invitations WHERE status = 'pending'")[0].n, 1);
});

test("migration workflows: the Production workflow and its check still expect exactly 0001 (so Production is untouched), and the Staging config reads migrations/portal", () => {
  assert.match(read(".github/scripts/portal-d1-check.mjs"), /migration: "0001_portal_foundation\.sql"/);
  assert.ok(!/delivery/i.test(read(".github/workflows/portal-production-d1-migration.yml")));
  assert.match(read("wrangler.jsonc"), /"migrations_dir": "migrations\/portal"/);
  assert.match(read("migrations/portal/wrangler.migrate.staging.jsonc"), /"database_name": "framework-portal-staging"/);
  assert.ok(!/delivery|0004/.test(read("migrations/portal/wrangler.migrate.production.jsonc")));
});

/* ------------------------------------------------------------------ delivery state recording */

test("delivery state: not_sent -> submitted or failed, audited once per attempt, only for a pending invitation, never touching expiry or status, organization-scoped", async () => {
  const db = openWithDelivery();
  const [o, other] = [await org(db), await org(db, "other", "Other")];
  const inv = await invitation(db, o);
  assert.deepEqual({ ...(await getDelivery(db, o.id, inv.id)) }, { id: inv.id, status: "pending", expires_at: at(7).toISOString(), workos_invitation_id: null, delivery_status: "not_sent", delivery_channel: null, delivery_attempted_at: null, delivery_error: null });
  const f = await recordDeliveryAttempt(db, o.id, inv.id, { outcome: "failed", channel: "workos", errorCode: "workos_rejected" }, ADMIN, { now: at(1) });
  assert.deepEqual(f, { ok: true, state: "failed" });
  let d = await getDelivery(db, o.id, inv.id);
  assert.deepEqual([d.delivery_status, d.delivery_channel, d.delivery_error, d.delivery_attempted_at, d.workos_invitation_id], ["failed", "workos", "workos_rejected", at(1).toISOString(), null]);
  assert.ok((await recordDeliveryAttempt(db, o.id, inv.id, { outcome: "submitted", channel: "workos", workosInvitationId: "invitation_01ABCDE" }, ADMIN, { now: at(2) })).ok);
  d = await getDelivery(db, o.id, inv.id);
  assert.deepEqual([d.delivery_status, d.delivery_error, d.workos_invitation_id, d.expires_at, d.status], ["submitted", null, "invitation_01ABCDE", at(7).toISOString(), "pending"], "success clears the error; expiry and status are untouched");
  assert.deepEqual(audit(db, "action LIKE 'invitation.delivery%'").map((a) => [a.action, a.actor_ref, JSON.parse(a.detail)]), [["invitation.delivery_failed", ADMIN, { channel: "workos", error: "workos_rejected" }], ["invitation.delivery_submitted", ADMIN, { channel: "workos", error: null }]]);
  assert.ok(audit(db).every((a) => !/@/.test(a.detail || "")), "no address in audit detail");
  // scope and guards
  assert.equal((await recordDeliveryAttempt(db, other.id, inv.id, { outcome: "submitted", channel: "resend" }, ADMIN)).error, "not_found", "another organization cannot record on it");
  await repo.revokeInvitation(db, o.id, inv.id, ADMIN);
  const countBefore = count(db, "activity_log");
  assert.equal((await recordDeliveryAttempt(db, o.id, inv.id, { outcome: "submitted", channel: "resend" }, ADMIN)).error, "not_found", "a revoked invitation is not updated");
  assert.equal(count(db, "activity_log"), countBefore, "and a refusal writes no audit entry");
  const inv2 = await invitation(db, o, "x@example.com");
  for (const [args, error] of [[{ outcome: "delivered", channel: "workos" }, "invalid_outcome"], [{ outcome: "submitted", channel: "sms" }, "invalid_channel"], [{ outcome: "failed", channel: "workos" }, "invalid_error_code"], [{ outcome: "failed", channel: "workos", errorCode: "Bad Code!" }, "invalid_error_code"], [{ outcome: "failed", channel: "resend", errorCode: "x", workosInvitationId: "invitation_01ABCDE" }, "invalid_workos_invitation_id"], [{ outcome: "submitted", channel: "resend", workosInvitationId: "invitation_01ABCDE" }, "invalid_workos_invitation_id"]]) {
    assert.equal((await recordDeliveryAttempt(db, o.id, inv2.id, args, ADMIN)).error, error, JSON.stringify(args));
  }
  assert.equal((await recordDeliveryAttempt(db, o.id, inv2.id, { outcome: "submitted", channel: "resend" }, "")).error, "invalid_actor");
  assert.equal((await getDelivery(db, o.id, inv2.id)).delivery_status, "not_sent");
});

test("a replaced invitation starts again at 'not_sent' with no provider id carried over", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o);
  await recordDeliveryAttempt(db, o.id, inv.id, { outcome: "submitted", channel: "workos", workosInvitationId: "invitation_01ABCDE" }, ADMIN, { now: at(1) });
  await repo.revokeInvitation(db, o.id, inv.id, ADMIN, { now: at(2) });
  const rep = await repo.replaceInvitation(db, o.id, inv.id, { actor: ADMIN }, { now: at(3) });
  const d = await getDelivery(db, o.id, rep.invitation.id);
  assert.deepEqual([d.delivery_status, d.delivery_channel, d.workos_invitation_id], ["not_sent", null, null]);
});

/* ------------------------------------------------------------------ the WorkOS administrative client (fake fetch) */

function fakeFetch(handler) {
  const seen = [];
  const f = async (url, init) => { seen.push({ url, init }); return handler(url, init); };
  return { f, seen };
}
const resJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const KEY = "sk_test_NEVERLOGTHISKEY123456";

test("WorkOS client: calls only the documented endpoints with the key in the Authorization header; success needs a valid invitation id", async () => {
  const { f, seen } = fakeFetch((url, init) => (url.includes("/users?") ? resJson(200, { data: [{ email: "Sam@Example.com" }] }) : resJson(201, { id: init.method === "POST" && url.endsWith("/invitations") ? "invitation_01ABCDEFG" : "invitation_01ABCDEFG" })));
  const c = createWorkosAdminClient({ apiKey: KEY, fetch: f });
  assert.deepEqual(await c.findUserByEmail("sam@example.com"), { exists: true });
  assert.deepEqual(await c.createInvitation({ email: "sam@example.com", expiresInDays: 5 }), { id: "invitation_01ABCDEFG" });
  assert.deepEqual(await c.resendInvitation("invitation_01ABCDEFG"), { id: "invitation_01ABCDEFG" });
  assert.deepEqual(await c.revokeInvitation("invitation_01ABCDEFG"), { id: "invitation_01ABCDEFG" });
  assert.deepEqual(seen.map((s) => `${s.init.method} ${s.url.replace("https://api.workos.com", "")}`), ["GET /user_management/users?email=sam%40example.com", "POST /user_management/invitations", "POST /user_management/invitations/invitation_01ABCDEFG/resend", "POST /user_management/invitations/invitation_01ABCDEFG/revoke"]);
  assert.ok(seen.every((s) => s.init.headers.Authorization === `Bearer ${KEY}` && new URL(s.url).origin === "https://api.workos.com"));
  assert.deepEqual(JSON.parse(seen[1].init.body), { email: "sam@example.com", expires_in_days: 5 });
  assert.deepEqual(await createWorkosAdminClient({ apiKey: KEY, fetch: async () => resJson(200, { data: [] }) }).findUserByEmail("none@example.com"), { exists: false });
  assert.deepEqual(await createWorkosAdminClient({ apiKey: KEY, fetch: async () => resJson(200, { data: [{ email: "other@example.com" }] }) }).findUserByEmail("sam@example.com"), { exists: false }, "only an exact email match counts");
});

test("WorkOS client: EVERY failure is a failure (never a success), with a short code and no key, address or body in the error", async () => {
  const attempt = async (respond) => {
    const c = createWorkosAdminClient({ apiKey: KEY, fetch: async () => respond() });
    try { await c.createInvitation({ email: "sam@example.com", expiresInDays: 7 }); return "SUCCEEDED"; } catch (e) { assert.ok(e instanceof WorkosAdminError); assert.ok(!(KEY + e.message + String(e.stack)).includes("sam@example.com") && !(e.message + e.stack).includes(KEY)); return e.code; }
  };
  for (const [status, code] of [[400, "workos_rejected"], [404, "workos_rejected"], [409, "workos_rejected"], [422, "workos_rejected"], [401, "workos_unauthorized"], [403, "workos_unauthorized"], [429, "workos_rate_limited"], [500, "workos_unavailable"], [502, "workos_unavailable"], [503, "workos_unavailable"]]) {
    assert.equal(await attempt(() => resJson(status, { code: "user_already_exists", message: "secret provider text sam@example.com" })), code, String(status));
  }
  assert.equal(await attempt(() => { throw new TypeError("fetch failed: sam@example.com " + KEY); }), "workos_unreachable");
  assert.equal(await attempt(() => { throw new DOMException("timeout", "TimeoutError"); }), "workos_unreachable");
  for (const body of [{}, { id: "" }, { id: 5 }, { id: "user_01ABCDEFG" }, { id: "invitation_" }, { id: "invitation_01 ABC" }, { id: "../../x" }, [], null, "ok"]) {
    assert.equal(await attempt(() => resJson(200, body)), "workos_bad_response", JSON.stringify(body));
  }
  assert.equal(await attempt(() => new Response("<html>ok</html>", { status: 200 })), "workos_bad_response", "a 2xx that is not JSON");
  assert.equal(await attempt(() => new Response(null, { status: 204 })), "workos_bad_response", "an empty 2xx is not an invitation");
  const c = createWorkosAdminClient({ apiKey: KEY, fetch: async () => resJson(200, { id: "invitation_01OTHER00" }) });
  await assert.rejects(() => c.resendInvitation("invitation_01ABCDEFG"), (e) => e.code === "workos_bad_response", "a response for a different invitation is not accepted");
  for (const badId of ["../users", "invitation_01/../x", "", undefined, "invitation_01ABCDE?x=1"]) {
    await assert.rejects(() => c.revokeInvitation(badId), (e) => e.code === "workos_rejected", String(badId));
  }
  await assert.rejects(() => c.createInvitation({ email: "a@b.co", expiresInDays: 0 }), (e) => e.code === "workos_rejected");
  await assert.rejects(() => c.findUserByEmail("a@b.co"), () => true, "nothing responds");
  assert.throws(() => createWorkosAdminClient({ apiKey: "" }), (e) => e.code === "workos_not_configured");
  const lookup = createWorkosAdminClient({ apiKey: KEY, fetch: async () => resJson(200, { users: [] }) });
  await assert.rejects(() => lookup.findUserByEmail("a@b.co"), (e) => e.code === "workos_bad_response");
});

/* ------------------------------------------------------------------ delivery orchestration (mocks) */

test("no WorkOS user yet: a WorkOS invitation is requested with the REMAINING validity, recorded as 'submitted' (never 'delivered'), and its id is stored; D1 expiry is untouched", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o);
  const m = mocks({ userExists: false });
  const r = await send(m, db, o, inv, { now: at(2) });
  assert.deepEqual(r, { ok: true, delivery: { state: "submitted", channel: "workos" } });
  assert.deepEqual(m.calls.find, ["sam@example.com"]);
  assert.deepEqual(m.calls.create, [{ email: "sam@example.com", expiresInDays: 5 }], "7 days from creation, 2 elapsed: 5 left");
  assert.equal(m.calls.email.length, 0);
  const d = await getDelivery(db, o.id, inv.id);
  assert.deepEqual([d.delivery_status, d.delivery_channel, d.workos_invitation_id, d.expires_at, d.status], ["submitted", "workos", "invitation_01MOCKCREATED", at(7).toISOString(), "pending"]);
  assert.ok(!/delivered/i.test(JSON.stringify([r, d, audit(db)])), "nothing claims delivery");
  assert.equal((await send(m, db, o, inv, { now: at(2) })).error, "already_submitted", "a second send is refused; use resend");
  assert.equal(m.calls.create.length, 1);
});

test("an EXISTING WorkOS user is told by Framework's own email (Resend path): a plain sign-in link, no token, no secret; recorded as 'submitted' on the resend channel", async () => {
  const db = openWithDelivery();
  const o = await org(db, "acme", "Acme & Co <Ltd>");
  const inv = await invitation(db, o, "sam@example.com", "owner");
  const m = mocks({ userExists: true });
  const r = await send(m, db, o, inv);
  assert.deepEqual(r, { ok: true, delivery: { state: "submitted", channel: "resend" } });
  assert.equal(m.calls.create.length, 0, "no WorkOS invitation for a person who already has an account");
  assert.equal(m.calls.email.length, 1);
  const mail = m.calls.email[0];
  assert.equal(mail.to, "sam@example.com");
  assert.match(mail.subject, /invited to Acme & Co <Ltd> on the Framework client portal/);
  assert.ok(mail.text.includes(`${BASE}/portal/login`));
  assert.ok(mail.text.includes("as an owner") && mail.text.includes("expires on October 27, 2026"));
  assert.ok(!/token|code=|state=|invitation_/i.test(mail.text.replace("one-time code", "")), "no token or secret in the message");
  assert.ok(mail.html.includes("Acme &amp; Co &lt;Ltd&gt;") && !mail.html.includes("<Ltd>"), "organization names are escaped in HTML");
  const d = await getDelivery(db, o.id, inv.id);
  assert.deepEqual([d.delivery_status, d.delivery_channel, d.workos_invitation_id], ["submitted", "resend", null]);
  assert.equal(existingUserEmail({ orgName: "A", role: "member", email: "x@y.co", expiresAt: at(3).toISOString(), loginUrl: BASE + "/portal/login" }).text.includes("as a member"), true);
});

test("a failed provider request is NEVER recorded as sent: lookup, WorkOS and email failures each give 'failed' with a code, and the next attempt is an explicit retry", async () => {
  for (const [label, opts, channel, code] of [
    ["lookup fails", { lookup: new WorkosAdminError("workos_unreachable") }, "workos", "workos_unreachable"],
    ["WorkOS rejects (for example 'already exists')", { create: new WorkosAdminError("workos_rejected") }, "workos", "workos_rejected"],
    ["WorkOS bad response", { create: new WorkosAdminError("workos_bad_response") }, "workos", "workos_bad_response"],
    ["WorkOS unauthorized", { create: new WorkosAdminError("workos_unauthorized") }, "workos", "workos_unauthorized"],
    ["an unexpected error type", { create: new Error("boom sam@example.com " + KEY) }, "workos", "provider_error"],
    ["email provider fails", { userExists: true, email: { ok: false, error: "provider 500: secret text" } }, "resend", "email_provider_failed"],
    ["email provider throws", { userExists: true, email: new Error("network sam@example.com") }, "resend", "email_provider_failed"],
  ]) {
    const db = openWithDelivery();
    const o = await org(db);
    const inv = await invitation(db, o);
    const m = mocks(opts);
    const r = await send(m, db, o, inv);
    assert.deepEqual([r.ok, r.error, r.delivery], [false, "delivery_failed", { state: "failed", channel, error: code }], label);
    const d = await getDelivery(db, o.id, inv.id);
    assert.deepEqual([d.delivery_status, d.delivery_channel, d.delivery_error, d.workos_invitation_id], ["failed", channel, code, null], label);
    assert.ok(!(JSON.stringify(r) + JSON.stringify(audit(db)) + JSON.stringify(d)).match(/sam@example\.com|secret|NEVERLOGTHIS/), label + ": no address, key or provider text is stored or returned");
    assert.equal((await send(mocks({ userExists: false }), db, o, inv)).ok, true, label + ": a retry after a failure is allowed");
  }
});

test("resend keeps the original expiry and the original channel; it needs a prior submission; an expired, revoked or accepted invitation is never sent or resent", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o);
  const m = mocks();
  assert.equal((await send(m, db, o, inv, { mode: "resend" })).error, "not_yet_submitted");
  await send(m, db, o, inv, { now: at(1) });
  const before = await getDelivery(db, o.id, inv.id);
  const again = await send(m, db, o, inv, { mode: "resend", now: at(3) });
  assert.deepEqual(again, { ok: true, delivery: { state: "submitted", channel: "workos" } });
  assert.deepEqual(m.calls.resend, ["invitation_01MOCKCREATED"]);
  assert.equal(m.calls.create.length, 1, "no second WorkOS invitation");
  const after = await getDelivery(db, o.id, inv.id);
  assert.equal(after.expires_at, before.expires_at, "the original expiry is preserved");
  assert.equal(after.delivery_attempted_at, at(3).toISOString());
  // a failing resend is recorded as failed
  const failing = mocks({ resend: new WorkosAdminError("workos_unavailable") });
  const f = await send(failing, db, o, inv, { mode: "resend", now: at(4) });
  assert.deepEqual([f.ok, f.delivery.error], [false, "workos_unavailable"]);
  assert.equal((await getDelivery(db, o.id, inv.id)).expires_at, before.expires_at);
  // the resend channel resends the email, again with the original expiry
  const inv2 = await invitation(db, o, "kim@example.com");
  const e = mocks({ userExists: true });
  await send(e, db, o, inv2, { now: at(1) });
  assert.ok((await send(e, db, o, inv2, { mode: "resend", now: at(2) })).ok);
  assert.equal(e.calls.email.length, 2);
  assert.ok(e.calls.email[1].text.includes("expires on October 27, 2026"), "the same expiry date as the original");
  assert.equal(e.calls.resend.length, 0);
  // expired: by date, by status; revoked; accepted
  const inv3 = await invitation(db, o, "lee@example.com");
  const none = mocks();
  assert.equal((await send(none, db, o, inv3, { now: at(8) })).error, "expired_replace_required");
  assert.equal((await send(none, db, o, inv3, { mode: "resend", now: at(8) })).error, "expired_replace_required");
  await repo.revokeInvitation(db, o.id, inv3.id, ADMIN, { now: at(1) });
  assert.equal((await send(none, db, o, inv3)).error, "invitation_revoked");
  const sam = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01SAMUSER", email: "pat@example.com" }, { now: T })).user;
  const inv4 = await invitation(db, o, "pat@example.com");
  await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(1) });
  assert.equal((await send(none, db, o, inv4)).error, "already_accepted");
  assert.equal(none.calls.find.length + none.calls.create.length + none.calls.email.length + none.calls.resend.length, 0, "no provider was contacted for any of them");
  assert.equal((await send(none, db, o, { id: crypto.randomUUID() })).error, "not_found");
  assert.equal((await send(none, db, await org(db, "other", "Other"), inv)).error, "not_found", "another organization's invitation");
});

test("a suspended organization's invitation is not delivered; an unrecorded result is reported rather than hidden", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o);
  await repo.setOrganizationStatus(db, o.id, "suspended");
  const m = mocks();
  assert.equal((await send(m, db, o, inv)).error, "organization_inactive");
  assert.equal(m.calls.find.length, 0);
  await repo.setOrganizationStatus(db, o.id, "active");
  // the provider accepts, but the result cannot be saved: say so
  const ctx = { ...m.ctx(db), db: { ...db, batch: async () => { throw new Error("D1 down"); }, prepare: (q) => db.prepare(q) } };
  const lost = await deliverInvitation(ctx, { organizationId: o.id, invitationId: inv.id, actor: ADMIN, mode: "send" });
  assert.deepEqual([lost.ok, lost.error], [false, "delivery_unrecorded"], "never reported as success, and the message says to check before retrying");
  assert.equal(m.calls.create.length, 1, "the provider WAS asked, which is exactly why the caller must be told");
});

test("D1 stays the authority: delivery grants nothing, and the invitation still activates ONLY for the verified, matching email", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o, "sam@example.com", "owner");
  await send(mocks({ userExists: true }), db, o, inv);
  const imposter = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01IMPOSTER", email: "mallory@example.com" }, { now: T })).user;
  assert.equal((await repo.activatePendingInvitations(db, { user: imposter, emailVerified: true }, { now: at(1) })).activated.length, 0, "a different email gets nothing");
  const sam = (await repo.upsertUserFromIdentity(db, { workosUserId: "user_01SAMUSER", email: "sam@example.com" }, { now: T })).user;
  assert.equal((await repo.activatePendingInvitations(db, { user: sam, emailVerified: false }, { now: at(1) })).error, "email_not_verified", "an unverified email gets nothing");
  assert.equal(count(db, "memberships"), 0);
  assert.equal((await repo.activatePendingInvitations(db, { user: sam, emailVerified: true }, { now: at(1) })).activated.length, 1);
  await repo.revokeInvitation(db, o.id, inv.id, ADMIN).catch(() => {});
  assert.equal(rows(db, "SELECT delivery_status FROM invitations")[0].delivery_status, "submitted", "acceptance and delivery are separate fields");
});

test("the delivery code is reachable only from the admin access API (behind its two switches), and contains no live endpoint other than WorkOS's API host", () => {
  const importers = ["worker/index.js", "worker/admin/router.js", "worker/portal/router.js", "worker/portal/pages.js", "worker/portal/auth.js"];
  for (const f of importers) assert.ok(!/invite-delivery|workos-admin|invitation-delivery/.test(read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), f);
  const hosts = new Set();
  for (const f of ["worker/portal/workos-admin.js", "worker/portal/invite-delivery.js", "worker/portal/repo/invitation-delivery.js"]) for (const m of read(f).matchAll(/https?:\/\/[a-z0-9.-]+/gi)) hosts.add(m[0]);
  assert.deepEqual([...hosts].filter((h) => !/example|frameworkco/.test(h)), ["https://api.workos.com"]);
});

test("duplicate prevention at the data level: two simultaneous sends make ONE provider request (compare-and-swap claim), and a claim never gets stuck", async () => {
  const db = openWithDelivery();
  const o = await org(db);
  const inv = await invitation(db, o);
  const m = mocks();
  const results = await Promise.all([send(m, db, o, inv), send(m, db, o, inv), send(m, db, o, inv)]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.ok(results.filter((r) => !r.ok).every((r) => ["send_in_progress", "already_submitted"].includes(r.error)));
  assert.equal(m.calls.create.length, 1, "one provider invitation");
  assert.equal(audit(db, "action = 'invitation.delivery_submitted'").length, 1);
  // a worker that died after claiming leaves no lock: the next attempt reads the new value and proceeds
  const inv2 = await invitation(db, o, "kim@example.com");
  const { claimDeliveryAttempt } = await import("../portal/repo/invitation-delivery.js");
  assert.equal((await claimDeliveryAttempt(db, o.id, inv2.id, null, { now: at(1) })).ok, true);
  assert.equal((await claimDeliveryAttempt(db, o.id, inv2.id, null, { now: at(1) })).error, "send_in_progress", "a stale read cannot claim");
  const later = await send(mocks({ createId: "invitation_01MOCKSECOND" }), db, o, inv2, { now: at(2) });
  assert.equal(later.ok, true, JSON.stringify(later) + " the abandoned claim does not block a later attempt");
});
