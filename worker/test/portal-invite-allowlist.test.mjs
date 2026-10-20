// Phase 5B: the temporary invitation RECIPIENT ALLOWLIST (PORTAL_INVITE_ALLOWED_EMAILS) for the controlled live test. Enforced in the Worker, before any database
// change or provider call, for creating, replacing, sending and resending; fail closed when missing or empty. Providers are mocks; nothing here can reach the network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import { parseAllowlist, recipientPolicy, checkRecipient, allowlistStatus } from "../portal/invite-recipients.js";
import { deliverInvitation } from "../portal/invite-delivery.js";

const APPROVED = "lanoirbadasswitchery@gmail.com";
const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (d) => new Date(NOW.getTime() + d * 86400000);
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));

/* ------------------------------------------------------------------ the policy itself */

test("parsing: exact addresses only, normalized the same way as every other portal email; patterns, domains and junk are discarded", () => {
  assert.deepEqual([...parseAllowlist(APPROVED)], [APPROVED]);
  assert.deepEqual([...parseAllowlist("  LanoirBadassWitchery@Gmail.COM ")], [APPROVED], "trimmed and lower-cased");
  assert.deepEqual([...parseAllowlist("a@x.co, B@X.co;c@x.co\n d@x.co\t\te@x.co")].sort(), ["a@x.co", "b@x.co", "c@x.co", "d@x.co", "e@x.co"], "commas, semicolons, spaces and newlines separate entries");
  assert.deepEqual([...parseAllowlist("a@x.co a@x.co A@X.CO")], ["a@x.co"], "duplicates collapse");
  for (const junk of ["", "   ", ",,;", "*", "*@gmail.com", "@gmail.com", "gmail.com", "gmail.*", "%@gmail.com", "<a@x.co>", "Name <a@x.co>", "\"a\"@x.co", "a@x.co?cc=b@y.co", "a(b)@x.co", "a@@x.co", ".a@x.co.", "a..b@x.co", "a@.x.co", "a b", "not-an-email", "a@x"]) {
    assert.equal(parseAllowlist(junk).size, 0, JSON.stringify(junk));
  }
  for (const nonString of [undefined, null, 5, {}, [], true, ["a@x.co"]]) assert.equal(parseAllowlist(nonString).size, 0);
  assert.equal(parseAllowlist("a@x.co ".repeat(2000)).size, 0, "an absurdly long setting is refused outright");
  assert.deepEqual([...parseAllowlist("good@x.co *@gmail.com bad")], ["good@x.co"], "unusable entries are dropped, usable ones kept");
});

test("matching: approved address passes however it is typed; every other form fails (no plus, dot, domain, suffix, prefix, list, display-name or lookalike matching)", () => {
  const env = { PORTAL_INVITE_ALLOWED_EMAILS: APPROVED };
  for (const ok of [APPROVED, APPROVED.toUpperCase(), "  LanoirBadassWitchery@Gmail.com  ", `\t${APPROVED}\n`]) assert.deepEqual(checkRecipient(env, ok), { ok: true, email: APPROVED }, JSON.stringify(ok));
  const bad = [
    "someone.else@gmail.com", "lanoirbadasswitchery+test@gmail.com", "lanoir.badasswitchery@gmail.com", "lanoirbadasswitchery@googlemail.com", "lanoirbadasswitchery@gmail.co",
    "lanoirbadasswitchery@gmail.com.evil.example", "x.lanoirbadasswitchery@gmail.com", "xlanoirbadasswitchery@gmail.com", "lanoirbadasswitchery@mail.gmail.com", "lanoirbadasswitchery@gmail.com.",
    `evil@x.co,${APPROVED}`, `${APPROVED},evil@x.co`, `${APPROVED};evil@x.co`, `evil@x.co ${APPROVED}`, `Lanoir <${APPROVED}>`, `<${APPROVED}>`, `"${APPROVED}"`,
    `${APPROVED}\r\nBcc: evil@x.co`, `${APPROVED}\u0000@evil.example`, `${APPROVED}%0aBcc:evil@x.co`, `evil@x.co\n${APPROVED}`,
    "lаnoirbadasswitchery@gmail.com" /* Cyrillic a */, "ｌａｎｏｉｒbadasswitchery@gmail.com" /* full-width */, "lanoirbadasswitchery@gmaıl.com" /* dotless i */,
    "", "   ", null, undefined, 5, {}, [], [APPROVED], "@gmail.com", "gmail.com", "*", "*@gmail.com",
  ];
  for (const b of bad) {
    const r = checkRecipient(env, b);
    assert.deepEqual([r.ok, r.error], [false, "recipient_not_allowed"], JSON.stringify(b));
  }
  assert.ok(!JSON.stringify(checkRecipient(env, "x@y.co")).includes("lanoir"), "the refusal never reveals what is allowed");
});

test("fail closed: a missing, empty or unusable allowlist locks every recipient, including the usual test address", () => {
  for (const setting of [undefined, null, "", "   ", ",;", "*", "*@gmail.com", "gmail.com", "@gmail.com", "bogus", 5, {}]) {
    const env = { PORTAL_INVITE_ALLOWED_EMAILS: setting };
    for (const who of [APPROVED, "anyone@example.com", "", null]) {
      const r = checkRecipient(env, who);
      assert.deepEqual([r.ok, r.error], [false, "recipient_allowlist_missing"], `${JSON.stringify(setting)} / ${JSON.stringify(who)}`);
    }
    assert.equal(allowlistStatus(env), "missing");
    assert.equal(recipientPolicy(env).locked, true);
  }
  assert.deepEqual([checkRecipient({}, APPROVED).error, checkRecipient(undefined, APPROVED).error, checkRecipient(null, APPROVED).error], ["recipient_allowlist_missing", "recipient_allowlist_missing", "recipient_allowlist_missing"]);
  assert.equal(allowlistStatus({ PORTAL_INVITE_ALLOWED_EMAILS: APPROVED }), "configured");
  assert.ok(!/\*|wildcard|allow_all|ALLOW_ALL/.test(strip(read("worker/portal/invite-recipients.js")).replace(/PATTERN_CHARS[^\n]*/, "")), "there is no allow-everyone value in the code");
});

/* ------------------------------------------------------------------ the admin API, with mocked providers */

function providers() {
  const p = { calls: [], created: 0 };
  p.fetch = async (url, init = {}) => {
    const u = new URL(url), method = init.method || "GET";
    p.calls.push(`${method} ${u.host}${u.pathname}`);
    const J = (s, b) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
    if (u.host === "api.workos.com" && method === "GET") return J(200, { data: [] });
    if (u.host === "api.workos.com" && method === "POST" && u.pathname === "/user_management/invitations") return J(201, { id: "invitation_01ALLOW" + ++p.created });
    if (u.host === "api.workos.com" && /\/resend$|\/revoke$/.test(u.pathname)) return J(200, { id: u.pathname.split("/")[3] });
    if (u.host === "api.resend.com") return J(200, { id: "e1" });
    throw new Error("no such endpoint in these tests");
  };
  return p;
}

async function setup(over = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const org = await w.org("alpha", "Alpha Co"), other = await w.org("beta", "Beta Co");
  const pv = providers();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1",
    PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE_FOR_ALLOWLIST", PORTAL_BASE_URL: ORIGIN, RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", PORTAL_INVITE_ALLOWED_EMAILS: APPROVED, ...over };
  const call = (path, { method = "POST", json, e = env, now = NOW, token, headers = {} } = {}) => {
    const t = token === undefined ? sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600 }) : token;
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    if (t) h["Cf-Access-Jwt-Assertion"] = t;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json ?? {}) }), e, { now, fetch: pv.fetch });
  };
  const invite = (email, role = "owner", o = org, opts = {}) => call(`/api/admin/clients/${o.id}/invitations`, { json: { email, role }, ...opts });
  const act = (inv, action, o = org, opts = {}) => call(`/api/admin/clients/${o.id}/invitations/${inv.id}/${action}`, opts);
  /** An invitation row that exists without going through the API (for example one made before the allowlist existed). */
  const seed = (email, status = "pending", o = org, extra = {}) => {
    const id = crypto.randomUUID();
    w.db.raw.prepare("INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at, revoked_at, revoked_by, workos_invitation_id) VALUES (?, ?, ?, 'member', ?, ?, 'seed', ?, ?, ?, ?)")
      .run(id, o.id, email, status, extra.createdAt || NOW.toISOString(), extra.expires || at(7).toISOString(), status === "revoked" ? NOW.toISOString() : null, status === "revoked" ? "seed" : null, extra.workos || null);
    return { id };
  };
  const snap = () => JSON.stringify(["organizations", "memberships", "invitations", "activity_log", "portal_users"].map((t) => sql(w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  return { w, org, other, env, pv, call, invite, act, seed, snap };
}
const body = async (r) => r.json();

test("an APPROVED recipient works end to end: create, send, resend and replace, with the usual audit trail and provider calls", async () => {
  const s = await setup();
  const r1 = await s.invite("  LanoirBadassWitchery@Gmail.com ");
  assert.equal(r1.status, 201);
  const inv = (await body(r1)).invitation;
  assert.equal(inv.email, APPROVED, "stored normalized");
  assert.equal((await s.act(inv, "send")).status, 200);
  assert.equal((await s.act(inv, "resend")).status, 200);
  assert.deepEqual(s.pv.calls, ["GET api.workos.com/user_management/users", "POST api.workos.com/user_management/invitations", "POST api.workos.com/user_management/invitations/invitation_01ALLOW1/resend"]);
  await s.act(inv, "revoke");
  const rep = await s.act(inv, "replace");
  assert.equal(rep.status, 201);
  assert.deepEqual(sql(s.w.db, "SELECT action FROM activity_log ORDER BY created_at, rowid").map((a) => a.action), ["invitation.created", "invitation.delivery_submitted", "invitation.delivery_submitted", "invitation.revoked", "invitation.workos_revoked", "invitation.replaced"]);
  const access = await body(await s.call(`/api/admin/clients/${s.org.id}/access`, { method: "GET" }));
  assert.deepEqual(access.capabilities, { writes: true, sending: true, recipients: "configured" });
  assert.ok(!JSON.stringify(access).includes("lanoirbadass") || access.invitations.every((i) => i.email === APPROVED), "the list holds only the approved address, and the setting itself is never returned");
});

test("a REJECTED recipient on creation: 403 recipient_not_allowed, no database change, no audit entry, no provider call, and no hint of what is allowed", async () => {
  const s = await setup();
  const before = s.snap();
  const attempts = ["someone@example.com", "lanoirbadasswitchery+x@gmail.com", "lanoir.badasswitchery@gmail.com", "lanoirbadasswitchery@gmail.com.evil.example", "LANOIRBADASSWITCHERY@gmail.co", "pending@example.com"];
  for (const email of attempts) {
    const r = await s.invite(email);
    const text = await r.text();
    assert.equal(r.status, 403, email);
    assert.deepEqual([JSON.parse(text).error], ["recipient_not_allowed"], email);
    assert.ok(!/lanoir|gmail/i.test(text), "the refusal never names an allowed address");
    assert.match(JSON.parse(text).message, /Nothing|no invitation was created or sent/i);
  }
  assert.equal(s.snap(), before, "byte-for-byte unchanged, including the audit log");
  assert.equal(s.pv.calls.length, 0);
});

test("bypass attempts on creation are refused or rejected, never created: extra recipient fields, address lists, display names, header injection, lookalikes", async () => {
  const s = await setup();
  const before = s.snap();
  const forms = [`evil@example.com,${APPROVED}`, `${APPROVED},evil@example.com`, `${APPROVED};evil@example.com`, `Name <${APPROVED}>`, `${APPROVED}\r\nBcc: evil@example.com`, `${APPROVED}\u0000evil@example.com`, "lаnoirbadasswitchery@gmail.com", `${APPROVED} evil@example.com`];
  for (const email of forms) {
    const r = await s.invite(email);
    assert.ok([403, 422].includes(r.status), `${JSON.stringify(email)} -> ${r.status}`);
  }
  for (const extra of [{ to: "evil@example.com" }, { cc: "evil@example.com" }, { bcc: "evil@example.com" }, { recipient: "evil@example.com" }, { allowlist: "evil@example.com" }, { PORTAL_INVITE_ALLOWED_EMAILS: "evil@example.com" }, { email2: "evil@example.com" }]) {
    const r = await s.call(`/api/admin/clients/${s.org.id}/invitations`, { json: { email: APPROVED, role: "member", ...extra } });
    assert.equal(r.status, 400, JSON.stringify(extra));
  }
  for (const e of [{ email: [APPROVED, "evil@example.com"], role: "member" }, { email: { toString: APPROVED }, role: "member" }, { email: null, role: "member" }]) {
    assert.ok([400, 422].includes((await s.call(`/api/admin/clients/${s.org.id}/invitations`, { json: e })).status));
  }
  // a query string or header cannot change the policy
  assert.equal((await s.call(`/api/admin/clients/${s.org.id}/invitations?allow=1&PORTAL_INVITE_ALLOWED_EMAILS=evil@example.com`, { json: { email: "evil@example.com", role: "member" }, headers: { "X-Allowed-Emails": "evil@example.com", "X-Forwarded-Email": "evil@example.com" } })).status, 403);
  assert.equal(s.snap(), before);
  assert.equal(s.pv.calls.length, 0);
});

test("an invitation that ALREADY exists for another address (made before the allowlist) can be neither sent, resent nor replaced; revoking it still works, with no email", async () => {
  const s = await setup();
  const pending = s.seed("old.pending@example.com");
  const expired = s.seed("old.expired@example.com", "pending", s.org, { createdAt: at(-10).toISOString(), expires: at(-3).toISOString() });
  const revoked = s.seed("old.revoked@example.com", "revoked");
  const withWorkos = s.seed("old.workos@example.com", "pending", s.org, { workos: "invitation_01SEEDOLD" });
  const before = s.snap();
  for (const inv of [pending, expired, revoked, withWorkos]) {
    for (const action of ["send", "resend", "replace"]) {
      const r = await s.act(inv, action);
      assert.deepEqual([r.status, (await body(r)).error], [403, "recipient_not_allowed"], `${action} ${inv.id}`);
    }
  }
  assert.equal(s.snap(), before, "nothing changed");
  assert.equal(s.pv.calls.length, 0, "no provider was contacted");
  // clean-up is not blocked: revoke is D1 only for an invitation with no WorkOS side, and never sends an email
  const rev = await s.act(pending, "revoke");
  assert.equal(rev.status, 200);
  assert.equal(s.pv.calls.filter((c) => /resend\.com|\/invitations$/.test(c) || c.startsWith("POST api.resend.com")).length, 0);
  assert.ok(!s.pv.calls.some((c) => c.startsWith("POST api.resend.com")), "revoking never emails anyone");
});

test("the stored address is what is checked at send time: tampering with an approved invitation's address afterwards cannot make it send elsewhere", async () => {
  const s = await setup();
  const inv = (await body(await s.invite(APPROVED))).invitation;
  s.w.db.raw.prepare("UPDATE invitations SET email = 'evil@example.com' WHERE id = ?").run(inv.id);
  for (const action of ["send", "resend", "replace"]) assert.equal((await s.act(inv, action)).status, 403, action);
  assert.equal(s.pv.calls.length, 0);
  assert.equal(sql(s.w.db, "SELECT delivery_status FROM invitations WHERE id = ?", inv.id)[0].delivery_status, "not_sent");
});

test("FAIL CLOSED through the API: with the allowlist missing, empty or unusable, create, replace, send and resend are all refused (even for the approved address), with no change and no provider call", async () => {
  const s = await setup();
  const mine = (await body(await s.invite(APPROVED))).invitation; // made while the allowlist was configured
  const seeded = s.seed("seeded@example.com", "revoked");
  s.pv.calls.length = 0;
  const before = s.snap();
  for (const setting of [undefined, "", "   ", ",", "*", "*@gmail.com", "gmail.com", "garbage"]) {
    const e = { ...s.env, PORTAL_INVITE_ALLOWED_EMAILS: setting };
    for (const r of [await s.invite(APPROVED, "owner", s.org, { e }), await s.act(mine, "send", s.org, { e }), await s.act(mine, "resend", s.org, { e }), await s.act(mine, "replace", s.org, { e }), await s.act(seeded, "replace", s.org, { e }), await s.act({ id: crypto.randomUUID() }, "send", s.org, { e })]) {
      assert.deepEqual([r.status, (await body(r)).error], [403, "recipient_allowlist_missing"], JSON.stringify(setting));
    }
    const access = await body(await s.call(`/api/admin/clients/${s.org.id}/access`, { method: "GET", e }));
    assert.equal(access.capabilities.recipients, "missing");
  }
  assert.equal(s.snap(), before);
  assert.equal(s.pv.calls.length, 0);
  const env2 = { ...s.env }; delete env2.PORTAL_INVITE_ALLOWED_EMAILS; // the variable simply absent
  assert.equal((await s.invite(APPROVED, "member", s.org, { e: env2 })).status, 403);
});

test("operations that cannot email anyone are not blocked by the allowlist: revoke, role change, remove access, create organization", async () => {
  const s = await setup({ PORTAL_INVITE_ALLOWED_EMAILS: undefined });
  const mk = await s.call("/api/admin/clients", { json: { name: "Delta Co" } });
  assert.equal(mk.status, 201, "creating an organization sends nothing");
  const u = (await repo.upsertUserFromIdentity(s.w.db, { workosUserId: "user_01PERSONONE", email: "p1@example.com" }, { now: NOW })).user;
  const u2 = (await repo.upsertUserFromIdentity(s.w.db, { workosUserId: "user_01PERSONTWO", email: "p2@example.com" }, { now: NOW })).user;
  for (const [x, role] of [[u, "owner"], [u2, "member"]]) s.w.db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, ?, 'active', ?, 'seed')").run(crypto.randomUUID(), s.org.id, x.id, role, NOW.toISOString());
  assert.equal((await s.call(`/api/admin/clients/${s.org.id}/members/${u2.id}/role`, { json: { role: "owner" } })).status, 200);
  assert.equal((await s.call(`/api/admin/clients/${s.org.id}/members/${u2.id}/remove`)).status, 200);
  const inv = s.seed("someone@example.com");
  assert.equal((await s.act(inv, "revoke")).status, 200);
  assert.equal(s.pv.calls.length, 0);
});

test("the allowlist runs AFTER authentication, CSRF and input checks, so it is no oracle for outsiders; and it keeps tenant isolation and the audit rules intact", async () => {
  const s = await setup();
  const bad = { json: { email: "evil@example.com", role: "member" } };
  assert.equal((await s.invite("evil@example.com", "member", s.org, { token: null })).status, 401);
  assert.equal((await s.invite("evil@example.com", "member", s.org, { token: "garbage" })).status, 401);
  assert.equal((await s.invite("evil@example.com", "member", s.org, { headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await body(await s.invite("evil@example.com", "member", s.org, { headers: { Origin: "https://evil.example" } }))).error, "forbidden", "a CSRF failure is not a recipient answer");
  assert.equal((await s.invite("evil@example.com", "member", s.org, { headers: { "Content-Type": "text/plain" } })).status, 415);
  assert.equal((await s.invite("evil@example.com", "member", s.org, { e: { ...s.env, PORTAL_ADMIN_WRITES: undefined } })).status, 403);
  assert.equal((await body(await s.invite("evil@example.com", "member", s.org, { e: { ...s.env, PORTAL_ADMIN_WRITES: undefined } }))).error, "writes_disabled");
  assert.equal((await s.invite("evil@example.com", "member", { id: crypto.randomUUID() })).status, 404, "an unknown organization is a plain 404");
  // another organization's invitation id is not reachable through this organization, and nothing about its address is revealed
  const foreign = s.seed("zed@example.com", "pending", s.other);
  const r = await s.act(foreign, "send");
  assert.deepEqual([r.status, (await body(r)).error], [404, "not_found"]);
  assert.equal(s.pv.calls.length, 0);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM activity_log")[0].n, 0, "rejected and refused requests leave no audit rows");
  void bad;
});

test("defence in depth: the delivery code itself refuses to contact a provider without an approving recipient check", async () => {
  const db = openPortalDb();
  const org = (await repo.createOrganization(db, { slug: "acme", name: "Acme" }, { now: NOW })).organization;
  const inv = (await repo.createInvitation(db, org.id, { email: "someone@example.com", role: "member", createdBy: ADMIN }, { now: NOW })).invitation;
  const calls = [];
  const workos = { findUserByEmail: async () => { calls.push("lookup"); return { exists: false }; }, createInvitation: async () => { calls.push("create"); return { id: "invitation_01XXXX" }; }, resendInvitation: async () => { calls.push("resend"); return { id: "x" }; } };
  const sendEmail = async () => { calls.push("email"); return { ok: true }; };
  const before = JSON.stringify(sql({ raw: db.raw }, "SELECT * FROM invitations"));
  for (const checkRecipient of [undefined, null, "yes", () => ({ ok: false, error: "recipient_not_allowed", message: "no" })]) {
    const r = await deliverInvitation({ db, workos, sendEmail, baseUrl: ORIGIN, now: NOW, checkRecipient }, { organizationId: org.id, invitationId: inv.id, actor: ADMIN, mode: "send" });
    assert.equal(r.ok, false);
    assert.ok(["recipient_allowlist_missing", "recipient_not_allowed"].includes(r.error), String(checkRecipient));
  }
  assert.deepEqual(calls, [], "no provider was contacted");
  assert.equal(JSON.stringify(sql({ raw: db.raw }, "SELECT * FROM invitations")), before, "and nothing was recorded or claimed");
});

/* ------------------------------------------------------------------ configuration and code paths */

test("configuration: the allowlist is Staging-only (previews.vars) and is exactly the approved address; neither administrative switch is set anywhere; Production is untouched", () => {
  const raw = read("wrangler.jsonc");
  const config = JSON.parse(strip(raw));
  assert.equal(config.previews.vars.PORTAL_INVITE_ALLOWED_EMAILS, APPROVED);
  assert.deepEqual([...parseAllowlist(config.previews.vars.PORTAL_INVITE_ALLOWED_EMAILS)], [APPROVED], "exactly one usable address");
  assert.equal(config.vars.PORTAL_INVITE_ALLOWED_EMAILS, undefined, "never in the top-level (Production) vars");
  const code = strip(raw);
  assert.ok(!/PORTAL_ADMIN_WRITES|PORTAL_INVITE_SENDING/.test(code), "both switches stay off");
  assert.ok(!/PORTAL_ADMIN_WRITES|PORTAL_INVITE_SENDING|PORTAL_INVITE_ALLOWED_EMAILS/.test(read("migrations/portal/wrangler.migrate.production.jsonc") + read(".github/workflows/ci.yml")));
  assert.equal(config.previews.vars.PORTAL_BASE_URL, "https://staging.frameworkco.ca");
  assert.equal(config.vars.PORTAL_ENABLED, undefined, "Production's portal stays disabled");
});

test("every path that can email an invitation is behind the check: only admin-access.js reaches the creation, replacement and delivery code, and it checks before each", () => {
  const portalDir = new URL("../portal/", import.meta.url);
  const files = readdirSync(portalDir).filter((f) => f.endsWith(".js"));
  const users = (re) => files.filter((f) => re.test(strip(readFileSync(new URL(f, portalDir), "utf8")))).sort();
  const importsRepo = /import\s*\{[^}]*\b(createInvitation|replaceInvitation)\b[^}]*\}\s*from/;
  assert.deepEqual(users(/\bsendEmail\b/), ["admin-access.js", "invite-delivery.js"], "only the admin API wires email, and the delivery code only calls what it is given");
  assert.deepEqual(users(importsRepo), ["admin-access.js"], "no other module imports the invitation creation or replacement functions");
  assert.deepEqual(users(/\bdeliverInvitation\b/), ["admin-access.js", "invite-delivery.js"]);
  const src = strip(read("worker/portal/admin-access.js"));
  assert.match(src, /const gate = checkRecipient\(env, body\.email\);\s*if \(!gate\.ok\) return err\(403/, "creation is checked before createInvitation");
  const checkAt = src.indexOf("gateStoredInvitation(env, db, org.id, route.target)");
  for (const call of ["deliverInvitation(ctx", "replaceInvitation(db"]) assert.ok(checkAt > 0 && checkAt < src.indexOf(call), `the stored-address check comes before ${call}`);
  assert.match(src, /route\.kind === "invitation_send" \|\| route\.kind === "invitation_resend" \|\| route\.kind === "invitation_replace"/);
  assert.match(src, /checkRecipient: \(email\) => checkRecipient\(env, email\)/, "the delivery code gets the same policy");
  // the portal routes (what clients can reach) have no way to create or send an invitation
  for (const f of ["router.js", "auth.js", "pages.js", "guard.js"]) assert.ok(!/createInvitation|replaceInvitation|deliverInvitation|sendEmail/.test(strip(read("worker/portal/" + f))), f);
  // the separate, existing admin FEEDBACK-request email is a different feature (a link to the public feedback form) and is not a portal invitation
  assert.ok(!/invitations|portal/i.test(strip(read("worker/feedback-invite.js")).replace(/Feedback invitations|feedback invitation/gi, "")), "the feedback-request email code has no portal invitation code in it");
});
