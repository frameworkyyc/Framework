/* Master Client Access: a verified, bound Framework grant opens any ACTIVE client's own portal, as no member of it. Everything a normal client, a stranger, a revoked or
   unbound person must NOT get, and everything the Framework visit must NOT leave behind (membership rows, invitations, client-visible names), is pinned here. */
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, csrfOf, ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import { bindStaffUser, grantStaff, revokeStaff, getStaffAccess } from "../portal/repo/staff.js";
import { handleStaffApi } from "../portal/admin-staff.js";
import { VIEW_ROLE_COOKIE } from "../portal/http.js";

const STAFF_EMAIL = "hello@frameworkco.ca";
const sql = (w, q, ...p) => w.db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const text = async (b, path) => (await b.get(path)).text();

async function setup() {
  const w = await makeWorld();
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_SERVICES: "1" });
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(B, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser(), hello = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  await hello.signIn(w.user(9, STAFF_EMAIL));
  const staffId = sql(w, "SELECT id FROM portal_users WHERE email = ?", STAFF_EMAIL)[0].id;
  return { w, A, B, ann, mia, bob, hello, staffId };
}
const post = (b, path, fields, extra) => b.post(path, fields, extra);

test("migration 0013 seeds exactly one pending grant, for hello@frameworkco.ca, and nothing else", async () => {
  const w = await makeWorld();
  const rows = sql(w, "SELECT email, user_id, role, revoked_at FROM portal_staff");
  assert.deepEqual(rows, [{ email: STAFF_EMAIL, user_id: null, role: "master", revoked_at: null }]);
});

test("without the table (before the migration) nobody has master access and sign-in still works", async () => {
  const w = await makeWorld({ skip: ["0013_staff_access.sql"] });
  const b = w.browser();
  const r = await b.signIn(w.user(9, STAFF_EMAIL));
  assert.equal(r.status, 303);
  assert.equal((await b.get("/portal")).headers.get("Location"), "/portal/no-access");
});

test("the grant binds once, at the first verified sign-in of that exact address, and is audited internally", async () => {
  const { w, staffId } = await setup();
  const g = sql(w, "SELECT user_id, bound_at FROM portal_staff")[0];
  assert.equal(g.user_id, staffId); assert.ok(g.bound_at);
  assert.equal(sql(w, "SELECT * FROM activity_log WHERE action = 'staff.access.bound' AND visibility = 'internal'").length, 1);
  // a second person can never take a bound grant, and the same address signing in again changes nothing
  const other = { id: "u-other", email: STAFF_EMAIL, status: "active" };
  assert.equal((await bindStaffUser(w.db, other, { now: w.clock.now() })).bound, false);
  assert.equal(sql(w, "SELECT user_id FROM portal_staff")[0].user_id, staffId);
});

test("an editable email is not the credential: after binding, access follows the user id even if the stored email changes", async () => {
  const { w, hello, staffId } = await setup();
  w.db.raw.prepare("UPDATE portal_users SET email = 'renamed@frameworkco.ca' WHERE id = ?").run(staffId);
  assert.equal((await hello.get("/portal/o/alpha")).status, 200);
  const other = w.browser();
  await other.signIn(w.user(10, "someone@example.test"));
  assert.equal((await other.get("/portal/o/alpha")).status, 404);
});

test("ordinary clients: no directory, no staff routes, no other organization, and Admin-style probing finds nothing", async () => {
  const { ann, bob, mia } = await setup();
  assert.equal((await ann.get("/portal")).headers.get("Location"), "/portal/o/alpha");
  assert.equal((await ann.get("/portal?q=beta")).headers.get("Location"), "/portal/o/alpha");
  assert.equal((await ann.get("/portal/o/beta")).status, 404);
  assert.equal((await bob.get("/portal/o/alpha")).status, 404);
  const csrf = csrfOf(await text(ann, "/portal/o/alpha/account"));
  assert.equal((await post(ann, "/portal/staff/view-as", { csrf, role: "member", next: "/portal" })).status, 404);
  assert.ok(![...ann.jar.keys()].includes(VIEW_ROLE_COOKIE));
  // a tampered preview cookie from a normal member grants nothing
  mia.jar.set(VIEW_ROLE_COOKIE, "owner");
  assert.equal((await mia.get("/portal/o/alpha/members")).status, 403, "a member stays a member whatever cookie is sent");
  assert.equal((await mia.get("/portal/o/beta")).status, 404);
});

test("the directory lists every active client, searches, and leaves out archived or suspended ones", async () => {
  const { w, hello } = await setup();
  await w.org("gamma", "Gamma LaNoir");
  const arch = await w.org("old", "Old Client");
  w.db.raw.prepare("UPDATE organizations SET status = 'archived', archived_at = '2026-10-01T00:00:00.000Z' WHERE id = ?").run(arch.id);
  const home = await hello.get("/portal");
  assert.equal(home.status, 200);
  const html = await home.text();
  for (const n of ["Alpha Co", "Beta Co", "Gamma LaNoir"]) assert.match(html, new RegExp(n));
  assert.doesNotMatch(html, /Old Client/);
  assert.match(html, /href="\/portal\/o\/alpha"/);
  const q = await text(hello, "/portal?q=lanoir");
  assert.match(q, /Gamma LaNoir/); assert.doesNotMatch(q, /Alpha Co/);
  assert.match(await text(hello, "/portal?q=zzzz"), /No client matches/);
  assert.equal((await hello.get("/portal/o/old")).status, 404);
  assert.equal((await hello.get("/portal/o/nope")).status, 404);
});

test("opening a client: its own pages and content, a persistent banner, and no trace in members, invitations or notifications", async () => {
  const { w, hello, staffId } = await setup();
  const before = { m: sql(w, "SELECT COUNT(*) n FROM memberships")[0].n, i: sql(w, "SELECT COUNT(*) n FROM invitations")[0].n };
  for (const p of ["", "/account", "/projects", "/activity", "/documents", "/services", "/services/requests/new", "/members"]) {
    const res = await hello.get(`/portal/o/alpha${p}`);
    assert.equal(res.status, 200, p);
    const html = await res.text();
    assert.match(html, /Viewing: Alpha Co/, p);
    assert.match(html, /Framework master access/, p);
    assert.match(html, /href="\/portal">Switch client/, p);
  }
  const team = await text(hello, "/portal/o/alpha/members");
  assert.match(team, /ann@alpha\.test/); assert.match(team, /mia@alpha\.test/);
  const main = /<main[\s\S]*<\/main>/.exec(team)[0];
  assert.doesNotMatch(main, new RegExp(STAFF_EMAIL), "never a member row");
  assert.deepEqual({ m: sql(w, "SELECT COUNT(*) n FROM memberships")[0].n, i: sql(w, "SELECT COUNT(*) n FROM invitations")[0].n }, before);
  assert.equal(sql(w, "SELECT COUNT(*) n FROM memberships WHERE user_id = ?", staffId)[0].n, 0);
  // normal clients never see the banner or the staff user
  const ann = w.browser(); await ann.signIn(w.user(1, "ann@alpha.test"));
  const own = await text(ann, "/portal/o/alpha");
  assert.doesNotMatch(own, /master access|Viewing:/);
  assert.doesNotMatch(/<main[\s\S]*<\/main>/.exec(await text(ann, "/portal/o/alpha/members"))[0], new RegExp(STAFF_EMAIL));
  assert.doesNotMatch(await text(ann, "/portal/o/alpha/activity"), /staff|master/i);
});

test("role preview: Owner (default) shows Team; Member hides it exactly as a member sees it; the choice grants nothing and is CSRF- and same-site-protected", async () => {
  const { hello } = await setup();
  assert.equal((await hello.get("/portal/o/alpha/members")).status, 200);
  const csrf = csrfOf(await text(hello, "/portal/o/alpha"));
  assert.equal((await post(hello, "/portal/staff/view-as", { csrf: "bad", role: "member", next: "/portal/o/alpha" })).status, 403);
  assert.equal((await post(hello, "/portal/staff/view-as", { csrf, role: "admin", next: "/portal/o/alpha" })).status, 400);
  assert.equal((await post(hello, "/portal/staff/view-as", { csrf, role: "member", next: "/portal/o/alpha" }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
  assert.equal((await hello.get("/portal/o/alpha")).status, 200);
  const ok = await post(hello, "/portal/staff/view-as", { csrf, role: "member", next: "https://evil.example/x" });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get("Location"), "/portal", "an external next is ignored");
  const member = await text(hello, "/portal/o/alpha");
  assert.doesNotMatch(member, /href="\/portal\/o\/alpha\/members"/);
  assert.equal((await hello.get("/portal/o/alpha/members")).status, 403, "refused exactly as it is for a real member");
  assert.match(member, /aria-pressed="true">Member/);
  await post(hello, "/portal/staff/view-as", { csrf: csrfOf(member), role: "owner", next: "/portal/o/alpha" });
  assert.equal((await hello.get("/portal/o/alpha/members")).status, 200);
  hello.jar.set(VIEW_ROLE_COOKIE, "superuser"); // a tampered cookie falls back to the default and cannot raise anything
  assert.equal((await hello.get("/portal/o/alpha/members")).status, 200);
});

test("switching between several clients works, and each shows only its own content", async () => {
  const { hello } = await setup();
  const a = await text(hello, "/portal/o/alpha"), b = await text(hello, "/portal/o/beta");
  assert.match(a, /Viewing: Alpha Co/); assert.doesNotMatch(a, /Beta Co/);
  assert.match(b, /Viewing: Beta Co/); assert.doesNotMatch(b, /Alpha Co/);
});

test("a Framework request is attributed to Framework: the client sees \"Framework\", Admin sees the staff name flagged, and every write and visit is audited internally", async () => {
  const { w, A, hello, ann, staffId } = await setup();
  w.db.raw.prepare("UPDATE portal_users SET name = 'Hello Staffer' WHERE id = ?").run(staffId);
  await hello.get("/portal/o/alpha");
  const csrf = csrfOf(await text(hello, "/portal/o/alpha/services/requests/new"));
  const fd = new FormData();
  fd.set("csrf", csrf); fd.set("category", "general"); fd.set("title", "Test from Framework"); fd.set("description", "Checking the flow.");
  const res = await hello.send("/portal/o/alpha/services/requests", { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN } });
  assert.equal(res.status, 303);
  const id = /requests\/([0-9a-f-]{36})/.exec(res.headers.get("Location"))[1];
  assert.equal(sql(w, "SELECT organization_id, submitted_by FROM support_requests WHERE id = ?", id)[0].organization_id, A.id);
  const client = await text(ann, `/portal/o/alpha/services/requests/${id}`);
  assert.match(client, /<strong>Framework<\/strong>/);
  assert.doesNotMatch(client, /Hello Staffer/);
  const { getAdminThread } = await import("../portal/repo/support.js");
  const thread = await getAdminThread(w.db, A.id, id);
  assert.equal(thread.messages[0].authorName, "Hello Staffer (Framework master access)");
  const audit = sql(w, "SELECT action, actor_type, actor_ref, visibility, organization_id FROM activity_log WHERE action LIKE 'staff.portal.%' ORDER BY created_at, rowid");
  assert.ok(audit.some((r) => r.action === "staff.portal.opened"));
  assert.ok(audit.some((r) => r.action === "staff.portal.write"));
  for (const r of audit) { assert.equal(r.visibility, "internal"); assert.equal(r.actor_ref, `staff:${staffId}`); assert.equal(r.organization_id, A.id); }
});

test("a normal member can never write as staff: the staff-only SQL path needs a verified grant", async () => {
  const { w, A, ann, mia } = await setup();
  const csrf = csrfOf(await text(mia, "/portal/o/alpha/services/requests/new"));
  const fd = new FormData(); fd.set("csrf", csrf); fd.set("category", "general"); fd.set("title", "From a member"); fd.set("description", "Hello.");
  const res = await mia.send("/portal/o/alpha/services/requests", { method: "POST", body: fd, headers: { "Sec-Fetch-Site": "same-origin", Origin: ORIGIN } });
  assert.equal(res.status, 303);
  assert.equal(sql(w, "SELECT COUNT(*) n FROM support_requests WHERE organization_id = ?", A.id)[0].n, 1);
  assert.equal(sql(w, "SELECT COUNT(*) n FROM activity_log WHERE action LIKE 'staff.%' AND action NOT LIKE 'staff.access.%'").length, 1);
  assert.equal(sql(w, "SELECT COUNT(*) n FROM activity_log WHERE action LIKE 'staff.portal.%'")[0].n, 0);
  assert.ok(ann);
});

test("revocation takes effect on the very next request; reinstating restores the same person", async () => {
  const { w, hello, staffId } = await setup();
  assert.equal((await hello.get("/portal/o/alpha")).status, 200);
  assert.equal((await revokeStaff(w.db, STAFF_EMAIL, "owner@frameworkco.ca", { now: w.clock.now() })).ok, true);
  assert.equal((await hello.get("/portal/o/alpha")).status, 404);
  assert.equal((await hello.get("/portal")).headers.get("Location"), "/portal/no-access");
  assert.equal(await getStaffAccess(w.db, staffId), null);
  assert.equal((await grantStaff(w.db, STAFF_EMAIL, "owner@frameworkco.ca", { now: w.clock.now() })).ok, true);
  assert.equal((await hello.get("/portal/o/alpha")).status, 200);
  assert.deepEqual(sql(w, "SELECT action FROM activity_log WHERE action IN ('staff.access.revoked','staff.access.granted') ORDER BY created_at, rowid").map((r) => r.action), ["staff.access.revoked", "staff.access.granted"]);
});

test("an expired session or a signed-out browser gets the sign-in page, never a client portal", async () => {
  const { w, hello } = await setup();
  w.clock.advance(60 * 60 * 24 * 60);
  const res = await hello.get("/portal/o/alpha");
  assert.equal(res.status, 303);
  assert.match(res.headers.get("Location"), /^\/portal\/login/);
  const anon = w.browser();
  assert.equal((await anon.get("/portal/o/alpha")).status, 303);
  assert.equal((await post(anon, "/portal/staff/view-as", { role: "member" })).status, 303);
});

test("Admin API: grant, list and revoke need the writes flag and a same-origin admin request; a grant is by email only and rejects junk", async () => {
  const w = await makeWorld();
  const env = { PORTAL_DB: w.db, PORTAL_ADMIN_WRITES: "1" };
  const call = (body, { method = "POST", e = env, headers = {} } = {}) => handleStaffApi(new Request("https://staging.frameworkco.ca/api/admin/staff-access", { method, headers: { "Content-Type": "application/json", Origin: "https://staging.frameworkco.ca", "X-Framework-Admin": "1", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body) }), e, { email: "owner@frameworkco.ca" }, "/staff-access", { now: w.clock.now() });
  assert.equal((await call(null, { method: "GET" })).status, 200);
  assert.equal((await call({ action: "grant", email: "second@frameworkco.ca" })).status, 200);
  assert.equal((await call({ action: "grant", email: "not an email" })).status, 422);
  assert.equal((await call({ action: "promote", email: "x@y.test" })).status, 422);
  assert.equal((await call({ action: "revoke", email: "nobody@frameworkco.ca" })).status, 404);
  assert.equal((await call({ action: "grant", email: "third@frameworkco.ca" }, { e: { ...env, PORTAL_ADMIN_WRITES: "0" } })).status, 403);
  assert.equal((await call({ action: "grant", email: "third@frameworkco.ca" }, { headers: { Origin: "https://evil.example" } })).status, 403);
  const body = await (await call(null, { method: "GET" })).json();
  assert.deepEqual(body.staff.map((s) => s.email).sort(), [STAFF_EMAIL, "second@frameworkco.ca"]);
  assert.equal(sql(w, "SELECT COUNT(*) n FROM portal_staff")[0].n, 2);
});

test("audit: a direct link to an inner page records the visit, once per 30-minute window per client, and a different client is its own entry", async () => {
  const { w, A, B, hello, staffId } = await setup();
  const opened = (org) => sql(w, "SELECT detail FROM activity_log WHERE action = 'staff.portal.opened' AND organization_id = ? AND actor_ref = ?", org.id, `staff:${staffId}`);
  assert.equal((await hello.get("/portal/o/alpha/documents")).status, 200); // straight to an inner page, never via the directory or the home page
  assert.equal(opened(A).length, 1);
  for (const p of ["", "/account", "/projects", "/documents"]) await hello.get(`/portal/o/alpha${p}`);
  assert.equal(opened(A).length, 1, "further views in the same visit add nothing");
  await hello.get("/portal/o/beta/projects");
  assert.equal(opened(B).length, 1);
  assert.equal(opened(A).length, 1);
  w.clock.advance(31 * 60);
  await hello.get("/portal/o/alpha/projects");
  assert.equal(opened(A).length, 2, "a new visit after the window is a new entry");
  assert.match(opened(A)[0].detail, /"route":/);
  // writes are never collapsed
  const csrf = csrfOf(await text(hello, "/portal/o/alpha/account"));
  await post(hello, "/portal/o/alpha/account", { csrf, name: "A" });
  await post(hello, "/portal/o/alpha/account", { csrf, name: "B" });
  assert.equal(sql(w, "SELECT COUNT(*) n FROM activity_log WHERE action = 'staff.portal.write' AND organization_id = ?", A.id)[0].n, 2);
});
