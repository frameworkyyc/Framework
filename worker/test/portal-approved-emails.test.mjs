// Admin "Approved Emails": the list of addresses that may be invited and emailed, kept in the portal database and managed in Admin. Authorization, validation,
// audit, the transition from the Cloudflare secret (both are honoured), the one-step "approve while inviting", and that nothing here ever ends existing access.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sup from "../portal/repo/support.js";
import { processNotifications } from "../portal/service-notifications.js";
import { validApprovedEmail, parseAllowlist } from "../portal/invite-recipients.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const T0 = Math.floor(Date.now() / 1000);

async function setup({ writes = true, secret = "" } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co");
  await w.invite(A, "ann@a.test", "owner");
  const ann = w.browser();
  await ann.signIn(w.user(1, "ann@a.test"));
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), ...(writes ? { PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1", PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE", RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" } : {}), ...(secret ? { PORTAL_INVITE_ALLOWLIST: secret } : { PORTAL_INVITE_ALLOWLIST: undefined }) };
  const call = (path, { method = "POST", json = {}, headers = {}, token } = {}) => {
    const t = token === undefined ? sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T0, exp: T0 + 600 }) : token;
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    if (t) h["Cf-Access-Jwt-Assertion"] = t;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json) }), env, { fetch: async () => { throw new Error("no network"); } });
  };
  const add = (email, extra = {}) => call("/api/admin/approved-emails", { json: { email, ...extra } });
  const remove = (email) => call("/api/admin/approved-emails/remove", { json: { email } });
  const list = async () => (await call("/api/admin/approved-emails", { method: "GET" })).json();
  const invite = (email, extra = {}) => call(`/api/admin/clients/${A.id}/invitations`, { json: { email, role: "member", ...extra } });
  return { w, A, ann, env, call, add, remove, list, invite };
}
const audit = (s) => sql(s.w.db, "SELECT organization_id, actor_type, actor_ref, action, detail, visibility FROM activity_log WHERE action LIKE 'approved_email.%' ORDER BY created_at, rowid");
const stored = (s) => sql(s.w.db, "SELECT email FROM approved_emails ORDER BY email").map((r) => r.email);

test("authorization, the writes switch and CSRF apply to every Approved Emails route; reads need an admin too", async () => {
  const off = await setup({ writes: false });
  assert.equal((await off.add("x@y.test")).status, 403);
  assert.equal((await off.remove("x@y.test")).status, 403);
  assert.equal((await off.call("/api/admin/approved-emails/import")).status, 403);
  assert.equal((await off.call("/api/admin/approved-emails", { method: "GET" })).status, 200, "reading is allowed");
  const s = await setup();
  for (const opts of [{ token: null }, { token: "garbage" }, { headers: { Origin: "https://evil.example" } }, { headers: { "X-Framework-Admin": "0" } }, { headers: { "Content-Type": "text/plain" } }]) {
    const r = await s.call("/api/admin/approved-emails", { json: { email: "x@y.test" }, ...opts });
    assert.ok([401, 403, 415].includes(r.status), JSON.stringify(opts));
  }
  assert.equal((await s.call("/api/admin/approved-emails", { method: "GET", token: null })).status, 401);
  assert.equal((await s.call("/api/admin/approved-emails", { method: "PUT" })).status, 405);
  assert.equal((await s.call("/api/admin/approved-emails/remove", { method: "GET" })).status, 405);
  assert.equal((await s.add("x@y.test", { role: "owner" })).status, 400, "unknown field");
  assert.deepEqual(stored(s), []);
  assert.deepEqual(audit(s), []);
});

test("adding validates strictly, normalizes, is idempotent, and writes one audit entry naming the admin", async () => {
  const s = await setup();
  for (const bad of ["", "nope", "a@b", "*@y.test", "@y.test", "a b@y.test", "a,b@y.test", "<a@y.test>", "a@y.test; b@y.test", "x".repeat(250) + "@y.test", "a..b@y.test", ".a@y.test", "a.@y.test", "a@.y.test", "a'b@y.test", "a%b@y.test"]) {
    const r = await s.add(bad);
    assert.equal(r.status, 422, JSON.stringify(bad));
  }
  assert.equal((await s.call("/api/admin/approved-emails", { json: { email: 5 } })).status, 422);
  assert.equal((await s.add("ok@y.test", { note: "x".repeat(121) })).status, 422);
  assert.equal((await s.add("ok@y.test", { note: "bad\u0000note" })).status, 422);
  assert.deepEqual(stored(s), []);

  const first = await s.add("  Pat.Smith@Client.TEST ", { note: " the owner " });
  assert.equal(first.status, 201);
  assert.deepEqual(await first.json(), { email: "pat.smith@client.test", changed: true });
  const again = await s.add("pat.smith@client.test");
  assert.equal(again.status, 200);
  assert.equal((await again.json()).changed, false);
  assert.deepEqual(stored(s), ["pat.smith@client.test"]);
  const row = sql(s.w.db, "SELECT * FROM approved_emails")[0];
  assert.equal(row.note, "the owner");
  assert.equal(row.added_by, ADMIN);
  const log = audit(s);
  assert.equal(log.length, 1, "a repeat adds no second entry");
  assert.deepEqual([log[0].organization_id, log[0].actor_type, log[0].actor_ref, log[0].action, log[0].visibility], [null, "admin", ADMIN, "approved_email.added", "internal"]);
  assert.deepEqual(JSON.parse(log[0].detail), { email: "pat.smith@client.test", source: "admin" });
  assert.ok(!/@/.test(sql(s.w.db, "SELECT group_concat(detail) AS d FROM activity_log WHERE organization_id IS NOT NULL")[0].d || ""), "client-visible activity never carries it");
});

test("the list shows stored addresses and the Cloudflare secret's addresses; the secret is never written; import copies it across", async () => {
  const s = await setup({ secret: "Old.One@x.test, old.two@x.test" });
  await s.add("new@x.test");
  let data = await s.list();
  assert.equal(data.available, true);
  assert.deepEqual(data.emails.map((e) => e.email), ["new@x.test"]);
  assert.deepEqual(data.setting.addresses, [{ email: "old.one@x.test", inList: false }, { email: "old.two@x.test", inList: false }]);
  const before = s.env.PORTAL_INVITE_ALLOWLIST;
  const imp = await s.call("/api/admin/approved-emails/import");
  assert.deepEqual(await imp.json(), { added: 2 });
  assert.deepEqual((await (await s.call("/api/admin/approved-emails/import")).json()), { added: 0 }, "idempotent");
  assert.equal(s.env.PORTAL_INVITE_ALLOWLIST, before, "the secret is untouched");
  data = await s.list();
  assert.deepEqual(data.setting.addresses.map((a) => a.inList), [true, true]);
  assert.deepEqual(audit(s).map((a) => JSON.parse(a.detail).source), ["admin", "setting", "setting"]);
  // once copied, the secret can be deleted and nothing changes
  delete s.env.PORTAL_INVITE_ALLOWLIST;
  assert.equal((await s.invite("old.one@x.test")).status, 201);
  // a malformed secret is refused whole (as before) and shows nothing, but the stored list still works
  const bad = await setup({ secret: "good@x.test, *@x.test" });
  assert.deepEqual((await bad.list()).setting.addresses, []);
});

test("the approved list controls invitations: secret OR stored; empty means locked; removing stops FUTURE invitations only", async () => {
  const s = await setup({ secret: "legacy@x.test" });
  // transition: the secret alone still works, exactly as before the table existed
  assert.equal((await s.invite("legacy@x.test")).status, 201);
  assert.equal((await s.invite("stranger@x.test")).status, 403);
  assert.equal((await (await s.invite("stranger@x.test")).json()).error, "recipient_not_allowed");
  await s.add("friend@x.test");
  assert.equal((await s.invite("FRIEND@x.test")).status, 201);
  // sending is gated by the same list (invitation exists; approval is removed; send is refused)
  const inv = sql(s.w.db, "SELECT id FROM invitations WHERE email = 'friend@x.test'")[0].id;
  await s.remove("friend@x.test");
  const send = await s.call(`/api/admin/clients/${s.A.id}/invitations/${inv}/send`, { json: {} });
  assert.equal(send.status, 403);
  assert.equal((await send.json()).error, "recipient_not_allowed");
  assert.equal((await s.invite("friend@x.test")).status, 403, "removed: no new invitation");
  // existing access is untouched by removal
  assert.equal((await s.ann.get("/portal/o/alpha")).status, 200);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships WHERE status = 'active'")[0].n, 1);
  // locked when nothing is approved anywhere
  const locked = await setup();
  const r = await locked.invite("a@x.test");
  assert.equal((await r.json()).error, "recipient_allowlist_missing");
  await locked.add("a@x.test");
  assert.equal((await locked.invite("a@x.test")).status, 201);
  assert.equal((await locked.remove("a@x.test")).status, 200);
  assert.equal((await locked.invite("b@x.test")).status, 403);
  assert.equal((await (await locked.remove("a@x.test")).json()).changed, false, "removing twice is harmless");
  assert.deepEqual(audit(locked).map((a) => a.action), ["approved_email.added", "approved_email.removed"]);
});

test("approving while inviting: one step, audited, only with an explicit true, and an invalid request approves nothing", async () => {
  const s = await setup();
  const r = await s.invite("New.Person@x.test", { approve: true });
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.approved, true);
  assert.equal(body.invitation.email, "new.person@x.test");
  assert.deepEqual(stored(s), ["new.person@x.test"]);
  assert.deepEqual(audit(s).map((a) => [a.action, JSON.parse(a.detail).source]), [["approved_email.added", "invite"]]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM invitations WHERE status = 'pending'")[0].n, 2 - 1, "one pending invitation (plus the owner's accepted one)");
  // the invitation is only created, never sent: no network was needed
  // an address that is already approved is not re-added and the response does not claim it was
  const again = await (await s.invite("other@x.test", { approve: true })).json();
  assert.equal(again.approved, true);
  assert.equal((await s.invite("other@x.test", { approve: true })).status, 409, "a duplicate pending invitation is refused as before");
  const ok2 = await s.invite("new.person@x.test", { approve: true });
  assert.notEqual(ok2.status, 500);
  // not approved without an explicit boolean true
  assert.equal((await s.invite("c@x.test", { approve: "yes" })).status, 422);
  assert.equal((await s.invite("c@x.test", { approve: 1 })).status, 422);
  assert.equal((await s.invite("c@x.test", { approve: false })).status, 403);
  // an invalid address approves nothing
  assert.equal((await s.invite("not-an-email", { approve: true })).status, 422);
  assert.equal((await s.invite("*@x.test", { approve: true })).status, 422);
  assert.ok(!stored(s).includes("c@x.test") && !stored(s).some((e) => e.includes("*")));
});

test("client emails go only to approved addresses (stored or secret); removing one stops them", async () => {
  const s = await setup();
  const annId = sql(s.w.db, "SELECT id FROM portal_users WHERE email = 'ann@a.test'")[0].id;
  const req = await sup.createRequest(s.w.db, s.A.id, annId, { category: "technical_issue", title: "Help", description: "x" });
  assert.ok(req.ok);
  const env = { ...s.w.env, RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "staff@framework.test", PORTAL_BASE_URL: "https://staging.frameworkco.ca" };
  delete env.PORTAL_INVITE_ALLOWLIST;
  const queue = () => sql(s.w.db, "INSERT INTO service_notifications (id, organization_id, audience, event, entity_type, entity_id, created_at) VALUES (?, ?, 'client', 'request_staff_reply', 'support_request', ?, ?)", crypto.randomUUID(), s.A.id, req.id, new Date().toISOString());
  const run = async () => { const to = []; await processNotifications(env, { db: s.w.db, fetch: async (u, init) => { const a = JSON.parse(init.body).to[0]; if (a !== "staff@framework.test") to.push(a); return new Response("{}", { status: 200 }); }, force: true }); return to; };
  queue();
  assert.deepEqual(await run(), [], "nothing approved: no client email");
  assert.equal(sql(s.w.db, "SELECT last_error FROM service_notifications WHERE audience = 'client' AND status = 'skipped'").length >= 1, true);
  await s.add("ann@a.test");
  sql(s.w.db, "DELETE FROM service_notifications");
  queue();
  assert.deepEqual(await run(), ["ann@a.test"], "approved in Admin: the email goes out");
  await s.remove("ann@a.test");
  sql(s.w.db, "DELETE FROM service_notifications");
  queue();
  assert.deepEqual(await run(), [], "removed: it stops");
});

test("a database without migration 0008 behaves exactly as before: the secret alone decides, and the page says the list is not available", async () => {
  const s = await setup({ secret: "legacy@x.test" });
  s.w.db.raw.exec("DROP TABLE approved_emails");
  const data = await s.list();
  assert.equal(data.available, false);
  assert.deepEqual(data.emails, []);
  assert.equal((await s.invite("legacy@x.test")).status, 201);
  assert.equal((await s.invite("stranger@x.test")).status, 403);
  const r = await s.add("x@y.test");
  assert.equal(r.status, 500, "a write cannot succeed without the table, and says nothing about SQL");
  assert.ok(!/approved_emails|SQL|no such table/i.test(await r.text()));
});

test("the validator is the same strict test the secret uses, and the source never logs or exposes more than it must", () => {
  assert.equal(validApprovedEmail(" A@B.CO "), "a@b.co");
  for (const bad of ["a@b", "*@b.co", "a b@b.co", "a@b.co,c@d.co", null, undefined, 5, "a".repeat(255) + "@b.co"]) assert.equal(validApprovedEmail(bad), null);
  assert.deepEqual([...parseAllowlist("a@b.co c@d.co")], ["a@b.co", "c@d.co"]);
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const f of ["worker/portal/admin-approved-emails.js", "worker/portal/repo/approved-emails.js"]) {
    const src = strip(readFileSync(new URL("../../" + f, import.meta.url), "utf8"));
    assert.ok(!/console\.(log|warn|info)/.test(src), f);
    assert.ok(!/PORTAL_INVITE_ALLOWLIST\s*=|env\.PORTAL_INVITE_ALLOWLIST\s*=/.test(src), f + " never writes the secret");
  }
});

test("the Approved Emails page: registered as a module, no HTML injection, changes only when the server allows them, removal is confirmed, and the invite form can approve in the same step", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const page = strip(readFileSync(new URL("../../admin/assets/approved-emails.js", import.meta.url), "utf8"));
  const modules = readFileSync(new URL("../../admin/assets/modules.js", import.meta.url), "utf8");
  assert.match(modules, /id: "approved-emails", label: "Approved Emails", path: "\/admin\/approved-emails", enabled: true/);
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(page));
  assert.match(page, /\]\.filter\(Boolean\)\);/, "optional children are filtered: replaceChildren would print null");
  assert.match(page, /const writes = Boolean\(data\.capabilities && data\.capabilities\.writes\) && data\.available/);
  assert.ok(page.indexOf("confirmDialog") < page.indexOf('"/approved-emails/remove"'), "removal asks first");
  const access = strip(readFileSync(new URL("../../admin/assets/clients-access.js", import.meta.url), "utf8"));
  assert.match(access, /id: "iv-approve", type: "checkbox"/);
  assert.match(access, /\{ email: value, role, approve: true \}/);
  assert.match(access, /\["Approved emails", approveIt/, "the confirmation says whether the address will be approved");
});
