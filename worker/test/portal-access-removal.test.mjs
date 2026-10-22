// Stage 1 security audit of "Remove access": driven END TO END through the real Admin API and the real portal router with live sessions.
// (Earlier tests covered the repository functions and the Admin API separately; these tests join them.)
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const T0 = Math.floor(Date.now() / 1000);

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("bravo", "Bravo Co");
  for (const [o, email, role] of [[A, "ann@a.test", "owner"], [A, "mia@both.test", "member"], [B, "mia@both.test", "member"], [B, "bob@b.test", "owner"]]) await w.invite(o, email, role);
  const people = { ann: w.user(1, "ann@a.test"), mia: w.user(2, "mia@both.test"), bob: w.user(3, "bob@b.test") };
  const br = {};
  for (const [n, u] of Object.entries(people)) { br[n] = w.browser(); assert.equal((await br[n].signIn(u)).status, 303, n); }
  const uid = (email) => sql(w.db, "SELECT id FROM portal_users WHERE email = ?", email)[0].id;
  assert.ok((await saveProfileStep(w.db, A.id, uid("mia@both.test"), "business", { legal: "Alpha Co Ltd.", operating: "Alpha" })).ok);
  assert.ok((await saveProfileStep(w.db, B.id, uid("mia@both.test"), "business", { legal: "Bravo Co Ltd.", operating: "Bravo" })).ok);
  const calls = [];
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1",
    PORTAL_INVITE_ALLOWLIST: "mia@both.test", PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE", RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" };
  const call = (path, { method = "POST", json = {}, headers = {}, token, e = env } = {}) => {
    const t = token === undefined ? sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T0, exp: T0 + 600 }) : token;
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    if (t) h["Cf-Access-Jwt-Assertion"] = t;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json) }), e, { fetch: async (u) => { calls.push(String(u)); throw new Error("no network in these tests"); } });
  };
  const remove = (org, userId, opts) => call(`/api/admin/clients/${org.id}/members/${userId}/remove`, opts);
  const snap = (tables) => JSON.stringify(tables.map((t) => sql(w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  return { w, A, B, br, uid, call, remove, calls, snap, people };
}
const status = async (b, path) => (await b.get(path)).status;

test("REMOVE ACCESS cuts off an existing signed-in session on the next request, on every portal route and every portal POST, without touching data, other memberships, the session or the WorkOS identity", async () => {
  const s = await setup();
  const mia = s.uid("mia@both.test");
  // while still a member: capture what a hostile or stale tab could replay later (the session-bound CSRF token is valid for this session)
  const profilePage = await (await s.br.mia.get("/portal/o/alpha/profile/business")).text();
  const csrf = csrfOf(profilePage);
  assert.ok(csrf);
  const feedbackBefore = sql(s.w.db, "SELECT count(*) AS n FROM portal_feedback")[0].n;
  const stable = ["business_profile_answers", "portal_feedback", "projects", "organizations"];
  const stableBefore = s.snap(stable);
  const userRowBefore = JSON.stringify(sql(s.w.db, "SELECT * FROM portal_users WHERE id = ?", mia));
  const bravoBefore = (await (await s.br.mia.get("/portal/o/bravo/profile/business")).text()).includes("Bravo Co Ltd.");
  assert.ok(bravoBefore);

  const res = await s.remove(s.A, mia);
  assert.deepEqual([res.status, await res.json()], [200, { changed: true }]);

  const routes = ["", "/progress", "/profile", "/profile/business", "/projects", "/activity", "/documents", "/account", "/members", "/feedback", "/branding", "/website", "/marketing", "/content", "/files"];
  for (const r of routes) assert.equal(await status(s.br.mia, "/portal/o/alpha" + r), 404, "GET " + r);
  const post = (path, fields) => s.br.mia.post(path, { csrf, ...fields });
  assert.equal((await post("/portal/o/alpha/profile/business", { legal: "HIJACKED", operating: "X" })).status, 404);
  assert.equal((await post("/portal/o/alpha/feedback", { kind: "problem", message: "still here?" })).status, 404);
  assert.equal((await post("/portal/o/alpha/account", { name: "Hijack" })).status, 404);
  assert.equal(s.snap(stable), stableBefore, "no Business Profile answer, feedback, project or organization row changed, and the POSTs wrote nothing");
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM portal_feedback")[0].n, feedbackBefore);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM business_profile_answers WHERE value = 'HIJACKED'")[0].n, 0);
  assert.equal(JSON.stringify(sql(s.w.db, "SELECT * FROM portal_users WHERE id = ?", mia)), userRowBefore, "the person's account is untouched (no name change, still active)");
  // the removed person is still signed in, with a membership in Bravo only: nothing else of theirs changed
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM portal_sessions WHERE user_id = ? AND revoked_at IS NULL", mia)[0].n, 1, "the session is not revoked: access is decided per request, not by the session");
  assert.equal((await s.br.mia.get("/portal")).headers.get("Location"), "/portal/o/bravo", "the picker now offers only the organization they still belong to");
  assert.equal(await status(s.br.mia, "/portal/o/bravo"), 200);
  assert.ok((await (await s.br.mia.get("/portal/o/bravo/profile/business")).text()).includes("Bravo Co Ltd."), "the other organization's data and access are intact");
  assert.deepEqual(sql(s.w.db, "SELECT organization_id, status FROM memberships WHERE user_id = ? ORDER BY status", mia).map((m) => m.status), ["active", "revoked"], "the membership row is kept (revoked), not deleted");
  assert.equal(s.calls.length, 0, "no WorkOS or email request was made: the WorkOS identity is untouched");
  // the organization's remaining owner still has everything; the Team page no longer lists the removed member
  assert.equal(await status(s.br.ann, "/portal/o/alpha"), 200);
  const team = await (await s.br.ann.get("/portal/o/alpha/members")).text();
  assert.ok(!/mia@both\.test/.test(team));
  assert.ok((await (await s.br.ann.get("/portal/o/alpha/profile/business")).text()).includes("Alpha Co Ltd."), "Business Profile data is preserved");
  // a 404 for a removed member is identical to a 404 for an organization that does not exist
  const strip = (h) => h.replace(/\b[A-Z0-9]{8}\b/g, "REF");
  assert.equal(strip(await (await s.br.mia.get("/portal/o/alpha")).text()), strip(await (await s.br.mia.get("/portal/o/no-such-org")).text()));
});

test("audit integrity: exactly one internal entry names the admin, the membership and the role; clients never see it; a repeat or refusal adds none", async () => {
  const s = await setup();
  const mia = s.uid("mia@both.test");
  await s.remove(s.A, mia);
  const rows = sql(s.w.db, "SELECT actor_type, actor_ref, action, entity_type, entity_id, detail, visibility, organization_id FROM activity_log WHERE action = 'membership.revoked'");
  const membershipId = sql(s.w.db, "SELECT id FROM memberships WHERE organization_id = ? AND user_id = ?", s.A.id, mia)[0].id;
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].actor_type, rows[0].actor_ref, rows[0].entity_type, rows[0].entity_id, rows[0].visibility, rows[0].organization_id], ["admin", ADMIN, "membership", membershipId, "internal", s.A.id]);
  assert.deepEqual(JSON.parse(rows[0].detail), { user_id: mia, role: "member" });
  assert.ok(!/@/.test(rows[0].detail), "no email address in the audit detail");
  const again = await s.remove(s.A, mia);
  assert.deepEqual([again.status, (await again.json()).error], [409, "already_revoked"]);
  const refused = await s.remove(s.A, s.uid("ann@a.test"));
  assert.deepEqual([refused.status, (await refused.json()).error], [409, "last_owner"]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM activity_log WHERE action = 'membership.revoked'")[0].n, 1, "repeats and refusals leave no entries");
  for (const page of ["/portal/o/alpha/activity", "/portal/o/alpha"]) assert.ok(!/revoked|membership/i.test(await (await s.br.ann.get(page)).text().then((t) => t.replace(/<(script|style)[\s\S]*?<\/\1>/g, ""))), "clients cannot see " + page);
});

test("the last-owner rule holds against direct API calls (no browser, no buttons) and under concurrency, including two requests for the SAME member", async () => {
  const s = await setup();
  const ann = s.uid("ann@a.test"), mia = s.uid("mia@both.test");
  // direct HTTP: the only owner can be neither removed nor demoted, whatever the interface shows
  for (const [path, json] of [[`/api/admin/clients/${s.A.id}/members/${ann}/remove`, {}], [`/api/admin/clients/${s.A.id}/members/${ann}/role`, { role: "member" }]]) {
    const r = await s.call(path, { json });
    assert.deepEqual([r.status, (await r.json()).error], [409, "last_owner"], path);
  }
  assert.equal(sql(s.w.db, "SELECT status, role FROM memberships WHERE organization_id = ? AND user_id = ?", s.A.id, ann)[0].status, "active");
  // two owners, removed at the same moment: one wins, one is refused, an owner remains
  await s.call(`/api/admin/clients/${s.A.id}/members/${mia}/role`, { json: { role: "owner" } });
  const [x, y] = await Promise.all([s.remove(s.A, ann), s.remove(s.A, mia)]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships WHERE organization_id = ? AND role = 'owner' AND status = 'active'", s.A.id)[0].n, 1);
  // the same member removed twice at once: one change, one 'already revoked', one audit entry
  const s2 = await setup();
  const mia2 = s2.uid("mia@both.test");
  const [p, q] = await Promise.all([s2.remove(s2.A, mia2), s2.remove(s2.A, mia2)]);
  assert.deepEqual([p.status, q.status].sort(), [200, 409]);
  assert.equal(sql(s2.w.db, "SELECT count(*) AS n FROM activity_log WHERE action = 'membership.revoked'")[0].n, 1);
});

test("authorization and isolation of the removal itself: portal sessions are not admin credentials; another organization's person is a 404; nothing changes on refusal", async () => {
  const s = await setup();
  const mia = s.uid("mia@both.test"), bob = s.uid("bob@b.test");
  const before = s.snap(["memberships", "activity_log"]);
  const attempts = [
    s.remove(s.A, mia, { token: null, headers: { Cookie: s.br.ann.cookieHeader() } }), // a signed-in portal OWNER's cookie
    s.remove(s.A, mia, { token: "garbage" }),
    s.remove(s.A, mia, { headers: { Origin: "https://evil.example" } }),
    s.remove(s.A, mia, { headers: { "X-Framework-Admin": "" } }),
    s.remove(s.A, mia, { headers: { "Content-Type": "text/plain" } }),
    s.remove(s.A, mia, { e: { ...(s.w.env), ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) } }), // writes switched off
    s.remove(s.A, bob),                                  // Bravo's owner through Alpha's id
    s.remove(s.B, s.uid("ann@a.test")),                  // Alpha's owner through Bravo's id
    s.call(`/api/admin/clients/${s.A.id}/members/${mia}/remove`, { json: { user_id: bob } }), // a smuggled target is an unknown field
  ];
  const codes = (await Promise.all(attempts)).map((r) => r.status);
  assert.deepEqual(codes, [401, 401, 403, 403, 415, 403, 404, 404, 400]);
  assert.equal(s.snap(["memberships", "activity_log"]), before);
  assert.equal(await status(s.br.mia, "/portal/o/alpha"), 200, "nobody lost access");
  assert.equal(s.calls.length, 0);
});

test("REINSTATEMENT is the normal verified-email invitation process: an invitation alone grants nothing, only the matching verified sign-in does, the same membership row returns, and removed data stays", async () => {
  const s = await setup();
  const mia = s.uid("mia@both.test");
  await s.remove(s.A, mia);
  assert.equal(await status(s.br.mia, "/portal/o/alpha"), 404);
  // signing in again while removed, with no new invitation, grants nothing (the old accepted invitation cannot re-grant)
  const fresh = s.w.browser();
  await fresh.signIn(s.people.mia);
  assert.equal(await status(fresh, "/portal/o/alpha"), 404);
  // an admin invites the address again (it is on the test allowlist): still no access until the person signs in
  const inv = await s.call(`/api/admin/clients/${s.A.id}/invitations`, { json: { email: "mia@both.test", role: "owner" } });
  assert.equal(inv.status, 201, "a removed member is not an 'active member', so they can be invited again");
  assert.equal(await status(s.br.mia, "/portal/o/alpha"), 404, "creating the invitation grants nothing");
  assert.equal(await status(fresh, "/portal/o/alpha"), 404);
  // someone else signing in cannot use it
  const other = s.w.browser();
  await other.signIn(s.w.user(9, "mallory@evil.test"));
  assert.equal(await status(other, "/portal/o/alpha"), 404);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships WHERE organization_id = ? AND status = 'active'", s.A.id)[0].n, 1, "still only the owner");
  // the invited person signs in with the verified, matching email: access returns under the NEW invitation's role, on the SAME membership row
  const again = s.w.browser();
  await again.signIn(s.people.mia);
  assert.equal(await status(again, "/portal/o/alpha"), 200);
  assert.equal(await status(again, "/portal/o/alpha/members"), 200, "the new role (owner) applies");
  const rows = sql(s.w.db, "SELECT role, status, revoked_at, revoked_by FROM memberships WHERE organization_id = ? AND user_id = ?", s.A.id, mia);
  assert.deepEqual(rows, [{ role: "owner", status: "active", revoked_at: null, revoked_by: null }], "one membership row, reactivated");
  assert.ok((await (await again.get("/portal/o/alpha/profile/business")).text()).includes("Alpha Co Ltd."), "the organization's data was never removed");
  assert.deepEqual(sql(s.w.db, "SELECT action FROM activity_log WHERE organization_id = ? AND action IN ('membership.revoked', 'invitation.created', 'invitation.accepted') ORDER BY rowid", s.A.id).map((r) => r.action).slice(-3), ["membership.revoked", "invitation.created", "invitation.accepted"]);
  // an invitation is single use: signing in again does not stack anything, and removal works again
  assert.equal((await s.remove(s.A, mia)).status, 200);
  assert.equal(await status(again, "/portal/o/alpha"), 404);
  const later = s.w.browser();
  await later.signIn(s.people.mia);
  assert.equal(await status(later, "/portal/o/alpha"), 404, "the spent invitation cannot grant access a second time");
});
