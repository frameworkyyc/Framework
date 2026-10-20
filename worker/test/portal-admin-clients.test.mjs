// Framework Admin: Clients (read-only). Admin-only access, tenant data shown only to staff, completion accuracy, invitation statuses, read-only database.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { readOnlyDb } from "../portal/admin-clients.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import { createInvitation, revokeInvitation } from "../portal/repo/invitations.js";
import { PROFILE_STEPS } from "../portal/profile-schema.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));

const ANSWERS = {
  business: { legal: "Acme Co. Ltd.", operating: "Acme", industry: "Retail", about: "We sell things." },
  location: { city: "Calgary, Alberta", size: "2 to 10 people" },
  offering: { offer: "Widgets", customers: "People who need widgets" },
  goals: { goals: "Grow" },
  online: { social: "@acme" },
  contact: { cname: "Ann Owner", cemail: "ann@acme.test" },
  personality: { words: "warm, honest", tone: "Friendly and relaxed" },
};

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co"), gamma = await w.org("gamma", "Gamma Empty");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), bob = w.browser(), mia = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test")); await mia.signIn(w.user(3, "mia@alpha.test"));
  const uid = (email) => sql(w.db, "SELECT id FROM portal_users WHERE email = ?", email)[0].id;
  for (const s of PROFILE_STEPS) await saveProfileStep(w.db, alpha.id, uid("ann@alpha.test"), s.id, ANSWERS[s.id]);   // alpha: complete
  await saveProfileStep(w.db, beta.id, uid("bob@beta.test"), "business", { legal: "Beta Secret Ltd", industry: "Retail" }); // beta: partial
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const call = (path, { method = "GET", token = sign(claims()), headers = {}, e = env, body } = {}) => {
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", ...headers };
    if (token) h["Cf-Access-Jwt-Assertion"] = token;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body }), e, { fetch: async () => { throw new Error("no network in these tests"); } });
  };
  return { w, alpha, beta, gamma, env, call, ann, bob, mia, uid };
}

/* ------------------------------------------------------------------ authorization */

test("admin-only: no token, a forged token, an unlisted email, a client session cookie and a wrong audience are all refused, with no data", async () => {
  const { call, alpha, ann } = await setup();
  const wrongAud = sign(claims({ aud: ["b".repeat(64)] })), stranger = sign(claims({ email: "intruder@example.com" })), expired = sign(claims({ exp: now() - 3600 }));
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims()));
  const forged = `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(other.privateKey))}`;
  for (const path of ["/api/admin/clients", `/api/admin/clients/${alpha.id}`]) {
    for (const token of [null, "garbage", forged, stranger, wrongAud, expired]) {
      const r = await call(path, { token });
      assert.ok([401, 403].includes(r.status), `${path} ${String(token).slice(0, 12)} -> ${r.status}`);
      const text = await r.text();
      assert.ok(!/Alpha Co|Acme|ann@alpha/.test(text), "no client data in a refusal");
    }
    // a signed-in CLIENT's portal cookie is not an admin credential
    const r = await call(path, { token: null, headers: { Cookie: ann.cookieHeader() } });
    assert.ok([401, 403].includes(r.status));
  }
  assert.equal((await call("/api/admin/clients")).status, 200);
});
test("the admin allowlist is still the second lock: a valid Access token for an email that is not on ADMIN_EMAILS gets nothing", async () => {
  const { call, env } = await setup();
  const r = await call("/api/admin/clients", { token: sign(claims({ email: "other.staff@frameworkco.ca" })) });
  assert.equal(r.status, 403);
  assert.equal((await call("/api/admin/clients", { e: { ...env, ADMIN_EMAILS: "" } })).status, 503, "no allowlist configured: closed");
});
test("everything under /api/admin/clients is read-only: every other method is refused and nothing changes", async () => {
  const { w, call, alpha } = await setup();
  const snap = () => JSON.stringify(["organizations", "portal_users", "memberships", "invitations", "business_profile_answers", "activity_log", "portal_sessions"].map((t) => sql(w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  const before = snap();
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) for (const path of ["/api/admin/clients", `/api/admin/clients/${alpha.id}`]) {
    const r = await call(path, { method, body: JSON.stringify({ name: "x" }) });
    assert.ok([404, 405].includes(r.status), `${method} ${path} -> ${r.status}`);
  }
  assert.equal(snap(), before);
});
test("the database handle given to the clients API can only run single SELECT statements", async () => {
  const { w } = await setup();
  const ro = readOnlyDb(w.db);
  assert.equal((await ro.prepare("SELECT count(*) AS n FROM organizations").first()).n, 3);
  for (const bad of ["INSERT INTO organizations (id) VALUES ('x')", "UPDATE organizations SET name = 'x'", "DELETE FROM organizations", "DROP TABLE organizations", "PRAGMA writable_schema = 1", "SELECT 1; DELETE FROM organizations", "  insert into x values (1)", "WITH x AS (SELECT 1) DELETE FROM organizations"]) assert.throws(() => ro.prepare(bad), /read_only_database/, bad);
  assert.equal(typeof ro.batch, "undefined"); assert.equal(typeof ro.exec, "undefined");
  const src = read("worker/portal/admin-clients.js");
  assert.ok(!/\.run\(|\.batch\(|\.exec\(|INSERT|UPDATE |DELETE FROM|DROP |ALTER /.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), "no write statement exists in the module");
});

/* ------------------------------------------------------------------ data and isolation */

test("list: each organization with its own member count, invitation summary and exact profile completion", async () => {
  const { call, alpha, beta, gamma } = await setup();
  const j = await (await call("/api/admin/clients")).json();
  assert.equal(j.profile_available, true);
  const by = Object.fromEntries(j.clients.map((c) => [c.name, c]));
  assert.deepEqual(Object.keys(by).sort(), ["Alpha Co", "Beta Co", "Gamma Empty"]);
  assert.equal(by["Alpha Co"].active_members, 2); assert.equal(by["Beta Co"].active_members, 1); assert.equal(by["Gamma Empty"].active_members, 0);
  assert.deepEqual([by["Alpha Co"].profile.done, by["Alpha Co"].profile.percent], [7, 100]);
  assert.deepEqual([by["Beta Co"].profile.done, by["Beta Co"].profile.percent], [0, 0], "a partly answered step does not count");
  assert.deepEqual([by["Gamma Empty"].profile.done, by["Gamma Empty"].profile.percent, by["Gamma Empty"].profile.last_saved], [0, 0, null]);
  assert.deepEqual(by["Alpha Co"].invitations, { pending: 0, accepted: 2, revoked: 0, lapsed: 0 });
  assert.equal(by["Alpha Co"].id, alpha.id); assert.equal(by["Beta Co"].id, beta.id); assert.equal(by["Gamma Empty"].id, gamma.id);
  assert.ok(!JSON.stringify(j).match(/Acme|Beta Secret|Widgets/), "the list carries no answers");
});
test("detail: all seven sections, answers, completion states (complete / partial / missing) and exact counts; an empty profile is handled", async () => {
  const { call, alpha, beta, gamma } = await setup();
  const a = await (await call(`/api/admin/clients/${alpha.id}`)).json();
  assert.equal(a.profile.steps.length, 7); assert.deepEqual(a.profile.steps.map((s) => s.id), PROFILE_STEPS.map((s) => s.id));
  assert.ok(a.profile.steps.every((s) => s.state === "complete")); assert.equal(a.profile.percent, 100);
  const legal = a.profile.steps[0].fields.find((f) => f.label === "Legal business name");
  assert.equal(legal.value, "Acme Co. Ltd."); assert.equal(legal.required, true);
  assert.equal(a.profile.steps[0].fields.find((f) => f.label === "Operating name").required, false);
  const b = await (await call(`/api/admin/clients/${beta.id}`)).json();
  assert.equal(b.profile.steps[0].state, "partial"); assert.deepEqual(b.profile.steps[0].missing_required, ["What does your business do?"]);
  assert.ok(b.profile.steps.slice(1).every((s) => s.state === "missing" && s.answered === 0));
  assert.equal(b.profile.done, 0);
  const g = await (await call(`/api/admin/clients/${gamma.id}`)).json();
  assert.equal(g.profile.percent, 0); assert.ok(g.profile.steps.every((s) => s.state === "missing" && s.fields.every((f) => f.value === null))); assert.equal(g.profile.last_saved, null);
  assert.deepEqual(g.members, []); assert.deepEqual(g.invitations, []);
});
test("client isolation: one organization's detail never contains another's answers, members or invitations; unknown or malformed ids are 404", async () => {
  const { call, alpha, beta } = await setup();
  const a = JSON.stringify(await (await call(`/api/admin/clients/${alpha.id}`)).json()), b = JSON.stringify(await (await call(`/api/admin/clients/${beta.id}`)).json());
  assert.ok(a.includes("Acme Co. Ltd.") && !a.includes("Beta Secret") && !a.includes("bob@beta.test") && !a.includes("Beta Co"));
  assert.ok(b.includes("Beta Secret Ltd") && !b.includes("Acme") && !b.includes("ann@alpha.test") && !b.includes("Alpha Co"));
  for (const id of ["alpha", "../clients", "00000000-0000-4000-8000-000000000000", "x' OR '1'='1", alpha.id.toUpperCase().slice(0, 30), `${alpha.id}%00`]) assert.equal((await call(`/api/admin/clients/${encodeURIComponent(id)}`)).status, 404, id);
});
test("invitations: only statuses the portal database records are shown, plus the fact that a pending one is past its expiry date", async () => {
  const { w, call, alpha, uid } = await setup();
  const t0 = new Date(w.clock.now());
  const a = await createInvitation(w.db, alpha.id, { email: "new1@alpha.test", role: "member", createdBy: "owner@frameworkco.ca" }, { now: t0 });
  await createInvitation(w.db, alpha.id, { email: "new2@alpha.test", role: "member", createdBy: "owner@frameworkco.ca" }, { now: t0 });
  await revokeInvitation(w.db, alpha.id, a.invitation.id, "owner@frameworkco.ca", { now: t0 });
  w.db.raw.prepare("INSERT INTO invitations (id, organization_id, email, role, status, created_by, created_at, expires_at) VALUES (?, ?, 'old@alpha.test', 'member', 'pending', 'owner@frameworkco.ca', '2020-01-01T00:00:00.000Z', '2020-01-08T00:00:00.000Z')").run("11111111-1111-4111-8111-111111111111", alpha.id);
  const j = await (await call(`/api/admin/clients/${alpha.id}`)).json();
  const by = Object.fromEntries(j.invitations.map((i) => [i.email, i]));
  assert.equal(by["new1@alpha.test"].status, "revoked"); assert.equal(by["new2@alpha.test"].status, "pending"); assert.equal(by["new2@alpha.test"].past_expiry, false);
  assert.equal(by["old@alpha.test"].status, "pending"); assert.equal(by["old@alpha.test"].past_expiry, true, "stored status is reported as it is; only the date fact is added");
  assert.equal(by["ann@alpha.test"].status, "accepted");
  assert.ok(j.invitations.every((i) => ["pending", "accepted", "revoked", "expired"].includes(i.status)));
  const list = (await (await call("/api/admin/clients")).json()).clients.find((c) => c.id === alpha.id);
  assert.deepEqual(list.invitations, { pending: 1, accepted: 2, revoked: 1, lapsed: 1 });
});
test("members: active, revoked and disabled people are told apart, with no tokens or session data", async () => {
  const { w, call, alpha } = await setup();
  w.db.raw.exec("UPDATE memberships SET status='revoked', revoked_at='2026-03-10T00:00:00.000Z' WHERE user_id IN (SELECT id FROM portal_users WHERE email='mia@alpha.test')");
  const j = await (await call(`/api/admin/clients/${alpha.id}`)).json();
  assert.deepEqual(j.members.map((m) => [m.email, m.status]).sort(), [["ann@alpha.test", "active"], ["mia@alpha.test", "revoked"]]);
  assert.equal((await (await call("/api/admin/clients")).json()).clients.find((c) => c.id === alpha.id).active_members, 1);
  assert.ok(!/workos|session|csrf|token/i.test(JSON.stringify(j)), "no identifiers or secrets beyond what staff need");
});
test("a deployment without the Business Profile table still lists clients and says the profile is unavailable", async () => {
  const { w, call, env } = await setup();
  w.db.raw.exec("DROP TABLE business_profile_answers");
  const j = await (await call("/api/admin/clients")).json();
  assert.equal(j.profile_available, false); assert.ok(j.clients.every((c) => c.profile === null)); assert.equal(j.clients.length, 3);
  const d = await (await call(`/api/admin/clients/${j.clients[0].id}`)).json();
  assert.equal(d.profile_available, false); assert.equal(d.profile, null);
  assert.equal((await call("/api/admin/clients", { e: { ...env, PORTAL_DB: undefined } })).status, 503);
});
test("failures answer generically and nothing sensitive is logged", async () => {
  const { w, call, env } = await setup();
  const failing = { prepare() { throw new Error("D1_ERROR secret answers: Beta Secret Ltd"); } };
  const logs = []; const o = console.error; console.error = (...a) => logs.push(a.join(" "));
  let r;
  try { r = await call("/api/admin/clients", { e: { ...env, PORTAL_DB: failing } }); } finally { console.error = o; }
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: "portal_unavailable" });
  assert.ok(!logs.join(" ").includes("Beta Secret"), "the error text is never logged");
  const withAnswers = await call("/api/admin/clients");
  assert.match(withAnswers.headers.get("cache-control"), /no-store/);
});

/* ------------------------------------------------------------------ interface */

test("the Clients entry is live in the admin navigation, and the page is read-only: no edit, send or impersonation controls", () => {
  assert.match(read("admin/assets/modules.js"), /id: "clients", label: "Clients", path: "\/admin\/clients", enabled: true, load: \(\) => import\("\.\/clients\.js"\)/);
  const ui = read("admin/assets/clients.js");
  assert.ok(!/method: "(POST|PUT|PATCH|DELETE)"|<form|"input"|"textarea"|"select"|onsubmit|impersonat|sign in as/i.test(ui), "no write, form or impersonation");
  assert.equal([...ui.matchAll(/api\(/g)].length, 2, "two read calls");
  for (const w of ["Complete", "Partial", "Missing"]) assert.ok(ui.includes(`"${w}"`), w);
  assert.match(ui, /staff cannot edit them here/);
  assert.ok(!/style: *"/.test(ui), "no inline styles (the admin CSP forbids them)");
});
