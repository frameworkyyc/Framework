// Phase 3: sending, resending and revoking invitations through the admin API, with MOCKED WorkOS and email providers. No test can reach the network:
// the only fetch available is the mock below, and it throws for any host or path it does not know.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { openPortalDb, migrationFiles } from "./helpers/portal-db.mjs";
import { readFileSync } from "node:fs";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const KEY = "sk_test_FAKE_WORKOS_KEY_FOR_TESTS", RESEND_KEY = "re_test_FAKE_RESEND_KEY";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (days) => new Date(NOW.getTime() + days * 86400000);
const tokenAt = (now, over = {}) => sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600, ...over });
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

/** A scriptable WorkOS + Resend. Anything it does not know about throws (and is recorded), so an accidental real call is impossible. */
function providers() {
  const p = {
    calls: [], existing: new Set(), unexpected: [], n: 0,
    lookup: () => null, create: () => null, resend: () => null, revoke: () => null, email: () => null,
    fetch: async (url, init = {}) => {
      const u = new URL(url), path = u.pathname + u.search, method = init.method || "GET";
      p.calls.push({ host: u.host, method, path, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
      const reply = (override, dflt) => { const o = override(); if (o instanceof Error) throw o; return o || dflt; };
      const J = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (u.host === "api.workos.com") {
        if (method === "GET" && u.pathname === "/user_management/users") {
          const email = u.searchParams.get("email");
          return reply(p.lookup, J(200, { data: p.existing.has(email) ? [{ email }] : [] }));
        }
        if (method === "POST" && u.pathname === "/user_management/invitations") return reply(p.create, J(201, { id: "invitation_01ABCDEFG" + ++p.n }));
        let m;
        if (method === "POST" && (m = /^\/user_management\/invitations\/(invitation_[A-Za-z0-9]+)\/resend$/.exec(u.pathname))) return reply(p.resend, J(200, { id: m[1] }));
        if (method === "POST" && (m = /^\/user_management\/invitations\/(invitation_[A-Za-z0-9]+)\/revoke$/.exec(u.pathname))) return reply(p.revoke, J(200, { id: m[1] }));
      }
      if (u.host === "api.resend.com" && method === "POST" && u.pathname === "/emails") return reply(p.email, J(200, { id: "email_1" }));
      p.unexpected.push(`${method} ${url}`);
      throw new Error("no such provider endpoint in these tests");
    },
  };
  p.on = (host) => p.calls.filter((c) => c.host === host);
  return p;
}

async function setup(over = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  const pv = providers();
  const env = {
    ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
    PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1", PORTAL_AUTH_CLIENT_SECRET: KEY, RESEND_API_KEY: RESEND_KEY, ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ...over,
  };
  const call = (path, { method = "POST", token, headers = {}, e = env, json = {}, now = NOW } = {}) => {
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    const tok = token === undefined ? tokenAt(now) : token;
    if (tok) h["Cf-Access-Jwt-Assertion"] = tok;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json) }), e, { now, fetch: pv.fetch });
  };
  const invite = async (org, email, role = "member", now = NOW) => (await (await call(`/api/admin/clients/${org.id}/invitations`, { json: { email, role }, now })).json()).invitation;
  const act = (org, inv, action, opts = {}) => call(`/api/admin/clients/${org.id}/invitations/${inv.id}/${action}`, opts);
  const row = (id) => sql(w.db, "SELECT * FROM invitations WHERE id = ?", id)[0];
  const audit = (where = "1=1") => sql(w.db, `SELECT actor_type, actor_ref, action, entity_id, detail FROM activity_log WHERE ${where} ORDER BY created_at, rowid`);
  const snap = () => JSON.stringify(["organizations", "memberships", "invitations", "activity_log"].map((t) => sql(w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  return { w, alpha, beta, env, pv, call, invite, act, row, audit, snap };
}

/* ------------------------------------------------------------------ the two switches */

test("sending needs its OWN switch: with writes on but PORTAL_INVITE_SENDING unset, send and resend answer 403 sending_disabled and no provider is contacted; the switch is in no checked-in configuration", async () => {
  const s = await setup({ PORTAL_INVITE_SENDING: undefined });
  const inv = await s.invite(s.alpha, "sam@example.com");
  const before = s.snap();
  for (const action of ["send", "resend"]) {
    const r = await s.act(s.alpha, inv, action);
    assert.deepEqual([r.status, (await r.json()).error], [403, "sending_disabled"], action);
  }
  assert.equal(s.snap(), before);
  assert.equal(s.pv.calls.length, 0);
  for (const v of ["0", "true", " 1", "yes"]) assert.equal((await s.act(s.alpha, inv, "send", { e: { ...s.env, PORTAL_INVITE_SENDING: v } })).status, 403, JSON.stringify(v));
  const off = await setup({ PORTAL_ADMIN_WRITES: undefined });
  assert.equal((await off.call(`/api/admin/clients/${off.alpha.id}/invitations/${crypto.randomUUID()}/send`)).status, 403);
  assert.equal(off.pv.calls.length, 0);
  for (const f of ["wrangler.jsonc", ".github/workflows/ci.yml", "migrations/portal/wrangler.migrate.staging.jsonc"]) assert.ok(!/PORTAL_INVITE_SENDING|PORTAL_ADMIN_WRITES/.test(read(f)), f);
});

/* ------------------------------------------------------------------ sending */

test("a NEW WorkOS user: lookup, then ONE WorkOS invitation with the remaining validity; recorded as submitted (not delivered), the WorkOS id kept private, the audit entry names the admin", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com", "owner");
  const r = await s.act(s.alpha, inv, "send", { now: at(2) });
  const out = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(out.delivery, { state: "submitted", channel: "workos" });
  assert.deepEqual([out.invitation.status, out.invitation.expires_at, out.invitation.delivery.state, out.invitation.delivery.channel, out.invitation.delivery.attempted_at, out.invitation.delivery.error], ["pending", at(7).toISOString(), "submitted", "workos", at(2).toISOString(), null]);
  assert.deepEqual(s.pv.calls.map((c) => `${c.method} ${c.host}${c.path}`), ["GET api.workos.com/user_management/users?email=sam%40example.com", "POST api.workos.com/user_management/invitations"]);
  assert.deepEqual(s.pv.calls[1].body, { email: "sam@example.com", expires_in_days: 5 }, "the D1 expiry is what WorkOS is given: 5 of the 7 days remain");
  assert.ok(s.pv.calls.every((c) => c.headers.Authorization === `Bearer ${KEY}`));
  assert.equal(row_(s, inv).workos_invitation_id, "invitation_01ABCDEFG1");
  assert.ok(!JSON.stringify(out).includes("invitation_01ABCDEFG1") && !JSON.stringify(out).includes(KEY), "neither the WorkOS id nor the key leaves the server");
  assert.deepEqual(s.audit("action = 'invitation.delivery_submitted'").map((a) => [a.actor_type, a.actor_ref, a.entity_id, JSON.parse(a.detail)]), [["admin", ADMIN, inv.id, { channel: "workos", error: null }]]);
  assert.ok(!/delivered/i.test(JSON.stringify([out, s.audit()])), "never claims delivery");
  const list = await (await s.call(`/api/admin/clients/${s.alpha.id}/access`, { method: "GET", now: at(2) })).json();
  assert.deepEqual(list.invitations[0].delivery, { state: "submitted", channel: "workos", attempted_at: at(2).toISOString(), error: null });
  assert.ok(!JSON.stringify(list).includes("invitation_01ABCDEFG1"));
  assert.deepEqual(s.pv.unexpected, []);
});
const row_ = (s, inv) => s.row(inv.id);

test("an EXISTING WorkOS user: Framework's own email through Resend (a plain sign-in link, no token), no WorkOS invitation, recorded on the resend channel", async () => {
  const s = await setup();
  s.pv.existing.add("sam@example.com");
  const inv = await s.invite(s.alpha, "sam@example.com", "member");
  const r = await s.act(s.alpha, inv, "send", { now: at(1) });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).delivery, { state: "submitted", channel: "resend" });
  assert.equal(s.pv.on("api.workos.com").filter((c) => c.method === "POST").length, 0, "no WorkOS invitation for someone who already has an account");
  const mail = s.pv.on("api.resend.com");
  assert.equal(mail.length, 1);
  assert.equal(mail[0].headers.Authorization, `Bearer ${RESEND_KEY}`);
  assert.deepEqual(mail[0].body.to, ["sam@example.com"]);
  assert.match(mail[0].body.subject, /invited to Alpha Co/);
  assert.ok(mail[0].body.text.includes(`${ORIGIN}/portal/login`) && mail[0].body.text.includes("expires on October 27, 2026"));
  assert.ok(!/invitation_|token=|code=/.test(mail[0].body.text));
  const d = row_(s, inv);
  assert.deepEqual([d.delivery_status, d.delivery_channel, d.workos_invitation_id, d.status], ["submitted", "resend", null, "pending"]);
  assert.equal(s.audit("action = 'invitation.delivery_submitted'").length, 1);
});

test("every provider failure is a FAILED delivery, never a success: HTTP errors, network errors, bad bodies, lookup failures, email failures and missing email configuration", async () => {
  const cases = [
    ["workos 400", (s) => { s.pv.create = () => new Response('{"code":"user_already_exists","message":"sam@example.com exists"}', { status: 400 }); }, "workos", "workos_rejected"],
    ["workos 401", (s) => { s.pv.create = () => new Response("{}", { status: 401 }); }, "workos", "workos_unauthorized"],
    ["workos 403", (s) => { s.pv.create = () => new Response("{}", { status: 403 }); }, "workos", "workos_unauthorized"],
    ["workos 404", (s) => { s.pv.create = () => new Response("{}", { status: 404 }); }, "workos", "workos_rejected"],
    ["workos 409", (s) => { s.pv.create = () => new Response("{}", { status: 409 }); }, "workos", "workos_rejected"],
    ["workos 422", (s) => { s.pv.create = () => new Response("{}", { status: 422 }); }, "workos", "workos_rejected"],
    ["workos 429", (s) => { s.pv.create = () => new Response("{}", { status: 429 }); }, "workos", "workos_rate_limited"],
    ["workos 500", (s) => { s.pv.create = () => new Response("{}", { status: 500 }); }, "workos", "workos_unavailable"],
    ["workos 503", (s) => { s.pv.create = () => new Response("{}", { status: 503 }); }, "workos", "workos_unavailable"],
    ["workos network error", (s) => { s.pv.create = () => new TypeError("fetch failed sam@example.com"); }, "workos", "workos_unreachable"],
    ["workos 200 without an id", (s) => { s.pv.create = () => new Response("{}", { status: 200 }); }, "workos", "workos_bad_response"],
    ["workos 200 not JSON", (s) => { s.pv.create = () => new Response("OK", { status: 200 }); }, "workos", "workos_bad_response"],
    ["workos 204 empty", (s) => { s.pv.create = () => new Response(null, { status: 204 }); }, "workos", "workos_bad_response"],
    ["lookup 500", (s) => { s.pv.lookup = () => new Response("{}", { status: 500 }); }, "workos", "workos_unavailable"],
    ["lookup malformed", (s) => { s.pv.lookup = () => new Response('{"users":[]}', { status: 200 }); }, "workos", "workos_bad_response"],
    ["email provider 500", (s) => { s.pv.existing.add("sam@example.com"); s.pv.email = () => new Response('{"message":"sam@example.com rejected"}', { status: 500 }); }, "resend", "email_provider_failed"],
    ["email provider network error", (s) => { s.pv.existing.add("sam@example.com"); s.pv.email = () => new TypeError("socket sam@example.com"); }, "resend", "email_provider_failed"],
    ["email not configured", (s) => { s.pv.existing.add("sam@example.com"); s.env.RESEND_API_KEY = ""; }, "resend", "email_not_configured"],
  ];
  for (const [label, arrange, channel, code] of cases) {
    const s = await setup();
    arrange(s);
    const inv = await s.invite(s.alpha, "sam@example.com");
    const r = await s.act(s.alpha, inv, "send", { e: s.env });
    const text = await r.text();
    const out = JSON.parse(text);
    assert.equal(r.status, 502, label);
    assert.deepEqual([out.error, out.delivery], ["delivery_failed", { state: "failed", channel, error: code }], label);
    assert.ok(!/user_already_exists|exists"|internal|socket|FAKE_/.test(text), label + ": no provider text or key in the response");
    assert.ok(!text.replace(/"email":"sam@example\.com"/g, "").includes("sam@example.com"), label + ": the address appears only as the invitation's own field");
    const d = row_(s, inv);
    assert.deepEqual([d.delivery_status, d.delivery_channel, d.delivery_error, d.workos_invitation_id, d.status, d.expires_at], ["failed", channel, code, null, "pending", at(7).toISOString()], label);
    assert.deepEqual(s.audit("action LIKE 'invitation.delivery%'").map((a) => [a.action, JSON.parse(a.detail)]), [["invitation.delivery_failed", { channel, error: code }]], label);
    assert.ok(!JSON.stringify(s.audit()).match(/sam@example\.com|FAKE_/), label + ": nothing sensitive in the audit trail");
    assert.deepEqual(s.pv.unexpected, [], label);
    // the failure is recoverable: once the provider works, an explicit retry succeeds and clears the error
    s.pv.create = () => null; s.pv.lookup = () => null; s.pv.email = () => null; s.env.RESEND_API_KEY = RESEND_KEY;
    const retry = await s.act(s.alpha, inv, "send", { e: s.env, now: at(1) });
    assert.equal(retry.status, 200, label + ": retry");
    const d2 = row_(s, inv);
    assert.deepEqual([d2.delivery_status, d2.delivery_error], ["submitted", null]);
    assert.equal(s.audit("action LIKE 'invitation.delivery%'").length, 2, "failed, then submitted");
  }
});

test("missing configuration fails BEFORE anything is attempted or recorded: no WorkOS key, no portal address, or a database without migration 0004", async () => {
  for (const [over, code] of [[{ PORTAL_AUTH_CLIENT_SECRET: "" }, "provider_not_configured"], [{ PORTAL_BASE_URL: "" }, "provider_not_configured"]]) {
    const s = await setup(over);
    const inv = await s.invite(s.alpha, "sam@example.com");
    const before = s.snap();
    const r = await s.act(s.alpha, inv, "send", { e: s.env });
    assert.deepEqual([r.status, (await r.json()).error], [503, code]);
    assert.equal(s.snap(), before, "nothing recorded");
    assert.equal(s.pv.calls.length, 0);
  }
  // a database exactly as Production's is today (no migration 0004): reads still work, delivery does not
  const s = await setup();
  const old = openPortalDb({ migrate: false });
  old.raw.exec("PRAGMA foreign_keys = ON");
  for (const f of migrationFiles().filter((f) => !f.startsWith("0004"))) old.raw.exec(read("migrations/portal/" + f));
  old.raw.exec(`INSERT INTO organizations (id, slug, name, status, created_at, updated_at) VALUES ('${s.alpha.id}', 'alpha', 'Alpha Co', 'active', '${NOW.toISOString()}', '${NOW.toISOString()}')`);
  old.raw.exec(`INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at) VALUES ('10000000-0000-4000-8000-000000000001', '${s.alpha.id}', 'x@example.com', 'member', 'pending', '${NOW.toISOString()}', 'seed', '${at(7).toISOString()}')`);
  const e = { ...s.env, PORTAL_DB: old };
  const list = await (await s.call(`/api/admin/clients/${s.alpha.id}/access`, { method: "GET", e })).json();
  assert.deepEqual([list.invitations[0].delivery, list.delivery_tracking], [{ state: "not_tracked" }, false]);
  const r = await s.call(`/api/admin/clients/${s.alpha.id}/invitations/10000000-0000-4000-8000-000000000001/send`, { e });
  assert.deepEqual([r.status, (await r.json()).error], [503, "delivery_tracking_unavailable"]);
  const rev = await s.call(`/api/admin/clients/${s.alpha.id}/invitations/10000000-0000-4000-8000-000000000001/revoke`, { e });
  assert.equal(rev.status, 200, "revoke still works (D1 only)");
  assert.equal(s.pv.calls.length, 0);
});

/* ------------------------------------------------------------------ resend, expiry, replace */

test("resend keeps the ORIGINAL expiry and channel; it needs a prior submission; an expired invitation must be replaced (a fresh 7 days), never resent", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com");
  assert.equal((await (await s.act(s.alpha, inv, "resend", { now: at(1) })).json()).error, "not_yet_submitted");
  await s.act(s.alpha, inv, "send", { now: at(1) });
  const before = row_(s, inv);
  s.pv.calls.length = 0;
  const r = await s.act(s.alpha, inv, "resend", { now: at(3) });
  assert.equal(r.status, 200);
  assert.deepEqual((await r.json()).delivery, { state: "submitted", channel: "workos" });
  assert.deepEqual(s.pv.calls.map((c) => `${c.method} ${c.path}`), ["POST /user_management/invitations/invitation_01ABCDEFG1/resend"], "a resend, not a second invitation");
  const after = row_(s, inv);
  assert.equal(after.expires_at, before.expires_at, "expiry preserved");
  assert.deepEqual([after.created_at, after.status], [before.created_at, "pending"]);
  assert.equal(after.delivery_attempted_at, at(3).toISOString());
  assert.equal(s.audit("action = 'invitation.delivery_submitted'").length, 2);
  // a failing resend is a failed delivery and still leaves the expiry alone
  s.pv.resend = () => new Response("{}", { status: 500 });
  const bad = await s.act(s.alpha, inv, "resend", { now: at(4) });
  assert.deepEqual([bad.status, (await bad.json()).delivery.error], [502, "workos_unavailable"]);
  assert.equal(row_(s, inv).expires_at, before.expires_at);
  s.pv.resend = () => null;
  // expired: refused for send AND resend, by date; then replaced and sent as a new invitation
  s.pv.calls.length = 0;
  for (const action of ["send", "resend"]) {
    const r2 = await s.act(s.alpha, inv, action, { now: at(8) });
    assert.deepEqual([r2.status, (await r2.json()).error], [409, "expired_replace_required"], action);
  }
  assert.equal(s.pv.calls.length, 0, "no provider was contacted for an expired invitation");
  const rep = await s.call(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/replace`, { now: at(8) });
  const fresh = (await rep.json()).invitation;
  assert.deepEqual([rep.status, fresh.expires_at, fresh.delivery.state], [201, at(15).toISOString(), "not_sent"]);
  assert.equal((await s.act(s.alpha, fresh, "send", { now: at(8) })).status, 200);
  assert.equal(s.pv.calls.find((c) => c.method === "POST" && c.path === "/user_management/invitations").body.expires_in_days, 7);
});

/* ------------------------------------------------------------------ duplicates */

test("duplicate prevention: simultaneous sends reach the provider ONCE; a second send, a resend before sending, and an invitation for the same address are refused", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com");
  const [a, b] = await Promise.all([s.act(s.alpha, inv, "send"), s.act(s.alpha, inv, "send")]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(s.pv.on("api.workos.com").filter((c) => c.method === "POST").length, 1, "exactly one provider invitation");
  assert.ok(["send_in_progress", "already_submitted"].includes((await [a, b].find((r) => r.status === 409).json()).error));
  assert.equal(s.audit("action = 'invitation.delivery_submitted'").length, 1);
  const again = await s.act(s.alpha, inv, "send");
  assert.deepEqual([again.status, (await again.json()).error], [409, "already_submitted"]);
  const dup = await s.call(`/api/admin/clients/${s.alpha.id}/invitations`, { json: { email: "SAM@example.com", role: "owner" } });
  assert.deepEqual([dup.status, (await dup.json()).error], [409, "already_pending"]);
  assert.equal(s.pv.on("api.workos.com").filter((c) => c.method === "POST").length, 1);
});

/* ------------------------------------------------------------------ revoke, with WorkOS */

test("revoke: D1 first, then WorkOS. A WorkOS failure never undoes the revoke or hides itself; repeating the revoke retries ONLY WorkOS; the person can never gain access meanwhile", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com", "owner");
  await s.act(s.alpha, inv, "send");
  s.pv.calls.length = 0;
  s.pv.revoke = () => new Response('{"message":"internal sam@example.com"}', { status: 500 });
  const r = await s.act(s.alpha, inv, "revoke", { now: at(1) });
  const text = await r.text();
  const out = JSON.parse(text);
  assert.equal(r.status, 200);
  assert.deepEqual([out.invitation.status, out.workos], ["revoked", { state: "revoke_failed", error: "workos_unavailable" }]);
  assert.ok(!/internal|sam@example\.com.*internal/.test(text));
  assert.equal(row_(s, inv).status, "revoked", "D1 is revoked regardless");
  assert.deepEqual(s.audit("action LIKE 'invitation.%revoke%'").map((a) => [a.action, a.actor_ref, JSON.parse(a.detail).error ?? null]), [["invitation.revoked", ADMIN, null], ["invitation.workos_revoke_failed", ADMIN, "workos_unavailable"]]);
  // while WorkOS is still holding the invitation, a sign-in with that email gets NOTHING (D1 is the authority)
  const b = s.w.browser();
  await b.signIn(s.w.user(9, "sam@example.com"));
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships")[0].n, 0, "no access from a revoked invitation");
  // retry: only WorkOS is contacted
  s.pv.calls.length = 0;
  s.pv.revoke = () => null;
  const retry = await s.act(s.alpha, inv, "revoke", { now: at(2) });
  const o2 = await retry.json();
  assert.deepEqual([retry.status, o2.workos], [200, { state: "revoked" }]);
  assert.deepEqual(s.pv.calls.map((c) => `${c.method} ${c.path}`), ["POST /user_management/invitations/invitation_01ABCDEFG1/revoke"]);
  assert.equal(s.audit("action = 'invitation.revoked'").length, 1, "D1 was revoked once, not twice");
  assert.deepEqual(s.audit("action LIKE 'invitation.workos%'").map((a) => a.action), ["invitation.workos_revoke_failed", "invitation.workos_revoked"]);
  // and now it is simply revoked
  const third = await s.act(s.alpha, inv, "revoke", { now: at(3) });
  assert.deepEqual([third.status, (await third.json()).error], [409, "already_revoked"]);
  assert.equal(s.pv.calls.length, 1, "no further provider call");
});

test("revoke with sending off or WorkOS unconfigured: D1 is revoked and the cleanup is reported as failed with a code (not silently skipped); with no WorkOS invitation there is nothing to cancel", async () => {
  const s = await setup();
  const withId = await s.invite(s.alpha, "sam@example.com");
  await s.act(s.alpha, withId, "send");
  const plain = await s.invite(s.alpha, "kim@example.com");
  s.pv.calls.length = 0;
  const off = { ...s.env, PORTAL_INVITE_SENDING: undefined };
  const r = await s.act(s.alpha, withId, "revoke", { e: off });
  assert.deepEqual((await r.json()).workos, { state: "revoke_failed", error: "sending_disabled" });
  const none = await s.act(s.alpha, plain, "revoke");
  assert.deepEqual((await none.json()).workos, { state: "none" });
  assert.equal(s.pv.calls.length, 0, "no provider was contacted");
  // with the key missing
  const s2 = await setup();
  const inv = await s2.invite(s2.alpha, "sam@example.com");
  await s2.act(s2.alpha, inv, "send");
  const r2 = await s2.act(s2.alpha, inv, "revoke", { e: { ...s2.env, PORTAL_AUTH_CLIENT_SECRET: "" } });
  assert.deepEqual((await r2.json()).workos, { state: "revoke_failed", error: "workos_not_configured" });
  // an invitation sent by email (existing user) has no WorkOS side
  const s3 = await setup();
  s3.pv.existing.add("sam@example.com");
  const e = await s3.invite(s3.alpha, "sam@example.com");
  await s3.act(s3.alpha, e, "send");
  s3.pv.calls.length = 0;
  assert.deepEqual((await (await s3.act(s3.alpha, e, "revoke")).json()).workos, { state: "none" });
  assert.equal(s3.pv.calls.length, 0);
  // an accepted invitation cannot be revoked, and WorkOS is not contacted
  const s4 = await setup();
  const acc = await s4.invite(s4.alpha, "sam@example.com");
  await s4.act(s4.alpha, acc, "send");
  await s4.w.browser().signIn(s4.w.user(7, "sam@example.com"));
  s4.pv.calls.length = 0;
  const refused = await s4.act(s4.alpha, acc, "revoke");
  assert.deepEqual([refused.status, (await refused.json()).error], [409, "already_accepted"]);
  assert.equal(s4.pv.calls.length, 0);
});

/* ------------------------------------------------------------------ authorization and isolation */

test("unauthorized requests and another organization's invitations never reach a provider or change anything", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com");
  await s.act(s.alpha, inv, "send");
  const before = s.snap();
  s.pv.calls.length = 0;
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 600 }));
  const forged = `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(other.privateKey))}`;
  for (const action of ["send", "resend", "revoke"]) {
    for (const token of ["", "garbage", forged, tokenAt(NOW, { email: "intruder@example.com" }), tokenAt(NOW, { aud: ["b".repeat(64)] }), tokenAt(NOW - 7200000)]) {
      const r = await s.act(s.alpha, inv, action, { token: token || null });
      assert.ok([401, 403].includes(r.status), `${action} ${String(token).slice(0, 8)} -> ${r.status}`);
    }
    assert.equal((await s.act(s.alpha, inv, action, { headers: { Origin: "https://evil.example" } })).status, 403, action + " cross-origin");
    assert.equal((await s.act(s.alpha, inv, action, { headers: { "X-Framework-Admin": "" } })).status, 403, action + " no header");
    assert.equal((await s.act(s.alpha, inv, action, { headers: { "Content-Type": "text/plain" } })).status, 415);
    assert.equal((await s.act(s.beta, inv, action)).status, 404, action + ": alpha's invitation through beta's id");
    assert.equal((await s.act(s.alpha, { id: crypto.randomUUID() }, action)).status, 404);
    assert.equal((await s.act(s.alpha, { id: "not-a-uuid" }, action)).status, 404);
    assert.equal((await s.call(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/${action}`, { json: { extra: 1 } })).status, 400, action + ": unknown field");
    assert.equal((await s.call(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/${action}`, { method: "GET" })).status, 405);
  }
  assert.equal(s.snap(), before, "nothing changed");
  assert.equal(s.pv.calls.length, 0, "no provider request was made for any of them");
  assert.deepEqual(s.pv.unexpected, []);
});

test("D1 stays the authority: a successful send grants nothing; access follows only a verified sign-in with the invited email", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com", "owner");
  await s.act(s.alpha, inv, "send");
  const mallory = s.w.browser();
  await mallory.signIn(s.w.user(5, "mallory@example.com"));
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships")[0].n, 0, "a different email gets nothing, whatever was sent");
  const sam = s.w.browser();
  await sam.signIn(s.w.user(6, "sam@example.com"));
  assert.deepEqual(sql(s.w.db, "SELECT role, status FROM memberships"), [{ role: "owner", status: "active" }], "the matching, verified email is activated by D1");
  const d = row_(s, inv);
  assert.deepEqual([d.status, d.delivery_status], ["accepted", "submitted"], "acceptance and delivery are separate fields");
});

test("audit completeness: every state change in a full invitation life has exactly one entry, in order, all by the named admin, none with addresses or secrets", async () => {
  const s = await setup();
  const inv = await s.invite(s.alpha, "sam@example.com");
  await s.act(s.alpha, inv, "send", { now: at(1) });
  await s.act(s.alpha, inv, "resend", { now: at(2) });
  s.pv.revoke = () => new Response("{}", { status: 500 });
  await s.act(s.alpha, inv, "revoke", { now: at(3) });
  s.pv.revoke = () => null;
  await s.act(s.alpha, inv, "revoke", { now: at(4) });
  await s.act(s.alpha, inv, "revoke", { now: at(5) }); // refused: no entry
  const rep = await (await s.call(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/replace`, { now: at(6) })).json();
  s.pv.create = () => new Response("{}", { status: 500 });
  await s.act(s.alpha, rep.invitation, "send", { now: at(7) });
  assert.deepEqual(s.audit().map((a) => a.action), [
    "invitation.created", "invitation.delivery_submitted", "invitation.delivery_submitted", "invitation.revoked", "invitation.workos_revoke_failed",
    "invitation.workos_revoked", "invitation.replaced", "invitation.delivery_failed",
  ]);
  assert.ok(s.audit().every((a) => a.actor_ref === ADMIN || a.actor_type === "system"));
  assert.ok(!JSON.stringify(s.audit().map((a) => a.detail)).match(/@|FAKE_|sk_test/), "no address or secret in any audit detail");
});
