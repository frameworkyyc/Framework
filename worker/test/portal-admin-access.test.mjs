// Framework Admin: client access management API (Phase 2). Authorization, switch, CSRF, strict input, organization scoping, last-owner protection,
// audit, safe errors, and the absence of any email, WorkOS call or global offboarding.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import { slugFromName, candidateSlug } from "../portal/admin-access.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, exp: nowS() + 600, iat: nowS(), ...over });
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const NOW = new Date("2026-10-20T12:00:00.000Z");
// The recipient allowlist is mandatory (fail closed); these tests use these addresses. The allowlist itself is tested in portal-invite-allowlist.test.mjs.
const ALLOWED = "a@b.co ann@alpha.test bob@alpha.test bob@beta.test late@example.com mia@alpha.test new.person@example.com old@example.com pending@example.com sam@example.com zed@example.com";
const at = (days) => new Date(NOW.getTime() + days * 86400000);

async function setup({ writes = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  const net = { calls: 0 };
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_INVITE_ALLOWLIST: ALLOWED, ...(writes ? { PORTAL_ADMIN_WRITES: "1" } : {}) };
  const call = (path, { method = "GET", token, headers = {}, e = env, body, json, now = NOW } = {}) => {
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    // a valid admin token by default, minted relative to the (injected) current time so that tests can move time forward
    const tok = token === undefined ? sign(claims({ iat: Math.floor(now.getTime() / 1000), exp: Math.floor(now.getTime() / 1000) + 600 })) : token;
    if (tok) h["Cf-Access-Jwt-Assertion"] = tok;
    const payload = json !== undefined ? JSON.stringify(json) : body;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: payload }), e, { now, fetch: async () => { net.calls++; throw new Error("no network in these tests"); } });
  };
  const post = (path, json = {}, opts = {}) => call(path, { method: "POST", json, ...opts });
  // a person with an ACTIVE membership, made the supported way (invitation + verified sign-in)
  const person = async (org, email, role, n) => {
    await w.invite(org, email, role);
    const b = w.browser();
    await b.signIn(w.user(n, email));
    return sql(w.db, "SELECT id FROM portal_users WHERE email = ?", email)[0].id;
  };
  const snap = () => JSON.stringify(["organizations", "portal_users", "memberships", "invitations", "business_profile_answers", "activity_log", "portal_sessions", "portal_feedback"].map((t) => sql(w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  return { w, alpha, beta, env, call, post, person, snap, net };
}
const audit = (db, where = "1=1") => sql(db, `SELECT organization_id, actor_type, actor_ref, action, entity_type, entity_id, detail, visibility FROM activity_log WHERE ${where} ORDER BY created_at, rowid`);

/* ------------------------------------------------------------------ the switch and authorization */

test("the write routes are OFF unless PORTAL_ADMIN_WRITES is exactly '1': 403 writes_disabled, nothing changes; reads still work; the switch is on in the launch configuration (Staging and Production)", async () => {
  const off = await setup({ writes: false });
  await off.person(off.alpha, "ann@alpha.test", "owner", 1);
  const before = off.snap();
  const uid = sql(off.w.db, "SELECT id FROM portal_users")[0].id;
  for (const [path, json] of [["/api/admin/clients", { name: "X" }], [`/api/admin/clients/${off.alpha.id}/invitations`, { email: "a@b.co", role: "member" }], [`/api/admin/clients/${off.alpha.id}/members/${uid}/remove`, {}], [`/api/admin/clients/${off.alpha.id}/members/${uid}/role`, { role: "member" }]]) {
    const r = await off.post(path, json);
    assert.equal(r.status, 403, path);
    assert.equal((await r.json()).error, "writes_disabled");
  }
  assert.equal(off.snap(), before);
  assert.equal((await off.call(`/api/admin/clients/${off.alpha.id}/access`)).status, 200);
  for (const v of ["0", "true", "yes", " 1", "1 "]) assert.equal((await off.post("/api/admin/clients", { name: "X" }, { e: { ...off.env, PORTAL_ADMIN_WRITES: v } })).status, 403, JSON.stringify(v));
  const code = (f) => read(f).replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/PORTAL_ADMIN_WRITES/.test(code(".github/workflows/ci.yml")), "CI does not enable the write routes");
  const cfg = JSON.parse(code("wrangler.jsonc"));
  assert.equal(cfg.vars.PORTAL_ADMIN_WRITES, "1", "on in the top-level (Production) vars since launch");
  assert.equal(cfg.previews.vars.PORTAL_ADMIN_WRITES, "1", "and on for Staging (invitations are still limited to the allowlist secret)");
  assert.equal((code("wrangler.jsonc").match(/PORTAL_ADMIN_WRITES/g) || []).length, 2, "the switch appears once per environment");
});

test("authorization is unchanged: no token, a forged token, an unlisted admin and a client's cookie get nothing, for reads and writes alike", async () => {
  const s = await setup();
  const ann = await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims({ iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 600 })));
  const forged = `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(other.privateKey))}`;
  const before = s.snap();
  const targets = [["GET", `/api/admin/clients/${s.alpha.id}/access`], ["POST", "/api/admin/clients"], ["POST", `/api/admin/clients/${s.alpha.id}/members/${ann}/remove`]];
  for (const [method, path] of targets) for (const token of [null, "garbage", forged, sign(claims({ email: "intruder@example.com", iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 600 })), sign(claims({ aud: ["b".repeat(64)], iat: Math.floor(NOW / 1000), exp: Math.floor(NOW / 1000) + 600 })), sign(claims({ iat: Math.floor(NOW / 1000) - 7200, exp: Math.floor(NOW / 1000) - 3600 }))]) {
    const r = await s.call(path, { method, token, json: method === "POST" ? { name: "X" } : undefined });
    assert.ok([401, 403].includes(r.status), `${method} ${path} -> ${r.status}`);
    assert.ok(!/Alpha Co|ann@alpha/.test(await r.text()));
  }
  assert.equal((await s.post("/api/admin/clients", { name: "X" }, { token: null, headers: { Cookie: "x=1" } })).status, 401);
  assert.equal((await s.post("/api/admin/clients", { name: "X" }, { e: { ...s.env, ADMIN_EMAILS: "" } })).status, 503);
  assert.equal(s.snap(), before);
});

test("CSRF: a write needs the same Origin and X-Framework-Admin: 1; JSON only; unknown fields, bad JSON, arrays and oversized bodies are refused; nothing changes", async () => {
  const s = await setup();
  const before = s.snap();
  const attempt = (opts) => s.call("/api/admin/clients", { method: "POST", ...opts });
  const good = { json: { name: "Acme" } };
  assert.equal((await attempt({ ...good, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await attempt({ ...good, headers: { Origin: "null" } })).status, 403);
  assert.equal((await attempt({ ...good, headers: { Origin: "" } })).status, 403);
  assert.equal((await attempt({ ...good, headers: { "X-Framework-Admin": "0" } })).status, 403);
  assert.equal((await attempt({ ...good, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal((await attempt({ body: JSON.stringify({ name: "Acme" }), headers: { "Content-Type": "text/plain" } })).status, 415, "a form or text post is not accepted");
  assert.equal((await attempt({ body: JSON.stringify({ name: "Acme" }), headers: { "Content-Type": "application/x-www-form-urlencoded" } })).status, 415);
  assert.equal((await attempt({ body: "{not json", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await attempt({ body: "[1]", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await attempt({ body: "null", headers: { "Content-Type": "application/json" } })).status, 400);
  assert.equal((await attempt({ json: { name: "Acme", role: "owner" } })).status, 400, "unknown field");
  assert.equal((await attempt({ json: { name: "Acme", id: "x", status: "archived" } })).status, 400, "no mass assignment");
  assert.equal((await attempt({ json: { name: "x".repeat(3000) } })).status, 413);
  assert.equal(s.snap(), before);
  assert.equal((await attempt(good)).status, 201, "and the same request, correctly formed, works");
});

/* ------------------------------------------------------------------ organizations */

test("create organization: a URL name is derived (or given), validated and unique; one audit entry names the admin; no member, invitation or email is created", async () => {
  const s = await setup();
  const r = await s.post("/api/admin/clients", { name: "Café Müller & Sons Ltd.", websiteUrl: "https://cafe.example" });
  assert.equal(r.status, 201);
  const { organization: o } = await r.json();
  assert.deepEqual([o.name, o.slug, o.status, o.website_url], ["Café Müller & Sons Ltd.", "cafe-muller-sons-ltd", "active", "https://cafe.example/"]);
  assert.deepEqual(audit(s.w.db, "action = 'org.created'").map((x) => [x.actor_type, x.actor_ref, x.entity_id, x.visibility, JSON.parse(x.detail)]), [["admin", ADMIN, o.id, "internal", { slug: "cafe-muller-sons-ltd" }]]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships")[0].n, 0);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM invitations")[0].n, 0);
  assert.equal(s.net.calls, 0);
  const dup = await s.post("/api/admin/clients", { name: "Anything", slug: "cafe-muller-sons-ltd" });
  assert.deepEqual([dup.status, (await dup.json()).error], [409, "slug_taken"]);
  for (const [json, error] of [[{ name: "" }, "invalid_name"], [{ name: 5 }, "invalid_name"], [{}, "invalid_name"], [{ name: "X", slug: "Bad Slug" }, "invalid_slug"], [{ name: "X", slug: "-no" }, "invalid_slug"], [{ name: "Ok", websiteUrl: "http://plain.example" }, "invalid_website_url"], [{ name: "Ok", slug: 5 }, "invalid_name"]]) {
    const bad = await s.post("/api/admin/clients", json);
    assert.equal(bad.status, 422, JSON.stringify(json));
    assert.equal((await bad.json()).error, error, JSON.stringify(json));
  }
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM organizations")[0].n, 3, "alpha, beta and the one new organization");
  assert.deepEqual(["Acme Co. Ltd.", "  Spaces   everywhere  ", "ÅÄÖ", "a", ""].map(slugFromName), ["acme-co-ltd", "spaces-everywhere", "aao", "", ""]);
});

test("create organization WITHOUT a URL name: the slug is made from the business name (lower-case letters, digits, hyphens) and made unique with -2, -3 ...; existing organizations and their slugs are never touched", async () => {
  const s = await setup();
  const slugs = () => sql(s.w.db, "SELECT id, slug, name FROM organizations ORDER BY created_at, id");
  const before = slugs();
  const create = async (name, extra = {}) => { const r = await s.post("/api/admin/clients", { name, ...extra }); return [r.status, (await r.json()).organization]; };
  let [st, o] = await create("Field Ready Collective", { websiteUrl: "https://frc.frameworkco.ca" });
  assert.deepEqual([st, o.slug, o.website_url], [201, "field-ready-collective", "https://frc.frameworkco.ca/"]);
  // the same name again, and again: -2, -3 (never the same slug, never an overwrite)
  const second = await create("Field Ready Collective");
  const third = await create("  field   READY collective!! ");
  assert.deepEqual([second[0], second[1].slug, third[0], third[1].slug], [201, "field-ready-collective-2", 201, "field-ready-collective-3"]);
  assert.notEqual(second[1].id, o.id);
  assert.equal(sql(s.w.db, "SELECT name FROM organizations WHERE slug = 'field-ready-collective'")[0].name, "Field Ready Collective", "the first organization is unchanged");
  // a name whose slug equals an EXISTING organization's slug gets a suffix; that organization keeps its slug
  const existing = before[0];
  const clash = await create(existing.slug);
  assert.deepEqual([clash[0], clash[1].slug], [201, existing.slug + "-2"]);
  for (const b of before) assert.deepEqual(sql(s.w.db, "SELECT id, slug, name FROM organizations WHERE id = ?", b.id)[0], b, "existing organizations are untouched");
  // nothing usable in the name: a safe fallback; and the fallback is made unique too
  assert.deepEqual([(await create("!!!"))[1].slug, (await create("日本語"))[1].slug, (await create("A"))[1].slug], ["client", "client-2", "client-3"]);
  // accents are folded, punctuation collapses, an over-long name is cut, and a suffix still fits within 48 characters
  assert.equal((await create("Café Müller & Sons Ltd."))[1].slug, "cafe-muller-sons-ltd");
  const long = "x".repeat(70);
  const l1 = (await create(long))[1].slug, l2 = (await create(long))[1].slug;
  assert.deepEqual([l1.length, l2.length, l2.endsWith("-2")], [48, 48, true]);
  // every created slug is valid and unique, and each organization has exactly one org.created audit entry carrying its real slug
  const all = slugs();
  assert.equal(new Set(all.map((x) => x.slug)).size, all.length);
  for (const x of all) assert.match(x.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  const created = audit(s.w.db, "action = 'org.created'").map((x) => JSON.parse(x.detail).slug).sort();
  assert.deepEqual(created, all.filter((x) => !before.some((b) => b.id === x.id)).map((x) => x.slug).sort());
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships")[0].n, 0, "no member is created");
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM invitations")[0].n, 0, "no invitation is created");
});

test("create organization without a URL name: simultaneous requests for the same name all succeed with DIFFERENT slugs; after 25 clashes it refuses cleanly and creates nothing; an explicit URL name is still used exactly as given and refused when taken", async () => {
  const s = await setup();
  const results = await Promise.all(Array.from({ length: 5 }, () => s.post("/api/admin/clients", { name: "Same Name Ltd" })));
  assert.deepEqual(results.map((r) => r.status), [201, 201, 201, 201, 201]);
  const slugs = (await Promise.all(results.map(async (r) => (await r.json()).organization.slug))).sort();
  assert.deepEqual(slugs, ["same-name-ltd", "same-name-ltd-2", "same-name-ltd-3", "same-name-ltd-4", "same-name-ltd-5"]);
  for (let i = 0; i < 20; i++) assert.equal((await s.post("/api/admin/clients", { name: "Same Name Ltd" })).status, 201); // -6 ... -25
  const count = sql(s.w.db, "SELECT count(*) AS n FROM organizations")[0].n;
  const auditBefore = sql(s.w.db, "SELECT count(*) AS n FROM activity_log WHERE action = 'org.created'")[0].n;
  const full = await s.post("/api/admin/clients", { name: "Same Name Ltd" });
  assert.deepEqual([full.status, (await full.json()).error], [409, "slug_unavailable"]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM organizations")[0].n, count, "a refused request creates nothing");
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM activity_log WHERE action = 'org.created'")[0].n, auditBefore, "and writes no audit entry");
  // explicit slug: exact, and a taken one is refused, never altered
  const ok = await s.post("/api/admin/clients", { name: "Explicit", slug: "my-explicit-name" });
  assert.deepEqual([ok.status, (await ok.json()).organization.slug], [201, "my-explicit-name"]);
  const dup = await s.post("/api/admin/clients", { name: "Explicit Again", slug: "my-explicit-name" });
  assert.deepEqual([dup.status, (await dup.json()).error], [409, "slug_taken"]);
  assert.deepEqual([1, 2, 3, 12, 25].map((n) => candidateSlug("Acme", n)), ["acme", "acme-2", "acme-3", "acme-12", "acme-25"]);
  for (const n of [1, 2, 9, 10, 25]) assert.ok(candidateSlug("y".repeat(80), n).length <= 48, "within the 48-character limit: " + n);
});

/* ------------------------------------------------------------------ invitations */

test("create invitation: pending for seven days, not sent, audited; no email and no WorkOS call is made; bad input and conflicts are refused with structured errors", async () => {
  const s = await setup();
  const r = await s.post(`/api/admin/clients/${s.alpha.id}/invitations`, { email: "  New.Person@Example.com ", role: "owner" });
  assert.equal(r.status, 201);
  const out = await r.json();
  assert.deepEqual([out.invitation.email, out.invitation.role, out.invitation.status, out.invitation.created_by, out.invitation.expires_at], ["new.person@example.com", "owner", "pending", ADMIN, at(7).toISOString()]);
  assert.deepEqual(out.invitation.delivery, { state: "not_sent", channel: null, attempted_at: null, error: null });
  assert.ok(!("workos_invitation_id" in out.invitation));
  assert.equal(audit(s.w.db, "action = 'invitation.created'").length, 1);
  assert.equal(s.net.calls, 0, "no provider was contacted");
  const dup = await s.post(`/api/admin/clients/${s.alpha.id}/invitations`, { email: "NEW.person@example.com", role: "member" });
  assert.deepEqual([dup.status, (await dup.json())], [409, { error: "already_pending", message: "There is already a pending invitation for this email address.", invitationId: out.invitation.id }]);
  const member = await s.person(s.alpha, "ann@alpha.test", "member", 1);
  const existing = await s.post(`/api/admin/clients/${s.alpha.id}/invitations`, { email: "ann@alpha.test", role: "owner" });
  assert.deepEqual([existing.status, (await existing.json()).error], [409, "already_member"]);
  for (const [json, error] of [[{ email: "nope", role: "member" }, "invalid_email"], [{ email: 5, role: "member" }, "invalid_email"], [{ role: "member" }, "invalid_email"], [{ email: "a@b.co", role: "admin" }, "invalid_role"], [{ email: "a@b.co" }, "invalid_role"], [{ email: "a@b.co", role: "owner\n" }, "invalid_role"]]) {
    const bad = await s.post(`/api/admin/clients/${s.alpha.id}/invitations`, json);
    assert.equal(bad.status, 422, JSON.stringify(json));
    assert.equal((await bad.json()).error, error);
  }
  assert.equal((await s.post(`/api/admin/clients/${s.alpha.id}/invitations`, { email: "a@b.co", role: "member", expiresInDays: 365 })).status, 400, "the expiry is not caller-controlled");
  assert.equal((await s.post(`/api/admin/clients/${crypto.randomUUID()}/invitations`, { email: "a@b.co", role: "member" })).status, 404);
  assert.equal((await s.post(`/api/admin/clients/not-a-uuid/invitations`, { email: "a@b.co", role: "member" })).status, 404);
  await s.w.db.prepare("UPDATE organizations SET status = 'suspended', archived_at = NULL WHERE id = ?").bind(s.beta.id).run();
  const sus = await s.post(`/api/admin/clients/${s.beta.id}/invitations`, { email: "a@b.co", role: "member" });
  assert.deepEqual([sus.status, (await sus.json()).error], [409, "organization_inactive"]);
  assert.equal(s.net.calls, 0);
  assert.equal(member.length, 36);
});

test("revoke and replace: revoke once (repeat is a clear 409), replace only an expired or revoked invitation, always with a fresh seven days; another organization's invitation is 404", async () => {
  const s = await setup();
  const mk = async (org, email) => (await (await s.post(`/api/admin/clients/${org.id}/invitations`, { email, role: "member" })).json()).invitation;
  const inv = await mk(s.alpha, "sam@example.com");
  const foreign = await mk(s.beta, "zed@example.com");
  const before = s.snap();
  assert.equal((await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${foreign.id}/revoke`)).status, 404, "alpha cannot reach beta's invitation");
  assert.equal((await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${foreign.id}/replace`)).status, 404);
  assert.equal(s.snap(), before);
  assert.equal((await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/replace`, {}, { now: at(1) })).status, 409, "still valid");
  const rev = await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/revoke`, {}, { now: at(1) });
  assert.deepEqual([rev.status, (await rev.json()).invitation.status], [200, "revoked"]);
  const again = await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/revoke`, {}, { now: at(1) });
  assert.deepEqual([again.status, (await again.json()).error], [409, "already_revoked"]);
  assert.equal(audit(s.w.db, "action = 'invitation.revoked'").length, 1, "a repeat is not audited again");
  const rep = await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/replace`, { role: "owner" }, { now: at(2) });
  assert.equal(rep.status, 201);
  const repBody = await rep.json();
  assert.deepEqual([repBody.invitation.status, repBody.invitation.role, repBody.invitation.expires_at, repBody.replaced, repBody.invitation.delivery.state], ["pending", "owner", at(9).toISOString(), inv.id, "not_sent"]);
  assert.deepEqual(audit(s.w.db, "action = 'invitation.replaced'").map((x) => [x.actor_ref, JSON.parse(x.detail).replaces]), [[ADMIN, inv.id]]);
  const retry = await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${inv.id}/replace`, {}, { now: at(2) });
  assert.deepEqual([retry.status, (await retry.json()).invitationId], [409, repBody.invitation.id], "a retry never creates a second invitation");
  // an expired one (by date) is replaceable, and replacement closes it
  const exp = await mk(s.alpha, "late@example.com");
  const lapsed = await s.post(`/api/admin/clients/${s.alpha.id}/invitations/${exp.id}/replace`, {}, { now: at(8) });
  assert.equal(lapsed.status, 201);
  assert.equal(sql(s.w.db, "SELECT status FROM invitations WHERE id = ?", exp.id)[0].status, "expired");
  assert.equal(s.net.calls, 0);
});

/* ------------------------------------------------------------------ members */

test("members: the last active owner can be neither removed nor demoted through the API; with a second owner both work; the person's business data is kept", async () => {
  const s = await setup();
  const ann = await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  const mia = await s.person(s.alpha, "mia@alpha.test", "member", 2);
  await saveProfileStep(s.w.db, s.alpha.id, mia, "business", { legal: "Alpha Co Ltd", operating: "Alpha" });
  const base = `/api/admin/clients/${s.alpha.id}/members`;
  for (const [path, json] of [[`${base}/${ann}/remove`, {}], [`${base}/${ann}/role`, { role: "member" }]]) {
    const r = await s.post(path, json);
    assert.deepEqual([r.status, (await r.json()).error], [409, "last_owner"], path);
  }
  assert.equal(sql(s.w.db, "SELECT role, status FROM memberships WHERE user_id = ?", ann)[0].status, "active");
  const promote = await s.post(`${base}/${mia}/role`, { role: "owner" });
  assert.deepEqual([promote.status, await promote.json()], [200, { changed: true, role: "owner" }]);
  const same = await s.post(`${base}/${mia}/role`, { role: "owner" });
  assert.deepEqual(await same.json(), { changed: false, role: "owner" }, "setting the same role is a no-op");
  const keepBefore = JSON.stringify(sql(s.w.db, "SELECT * FROM business_profile_answers ORDER BY 1, 2"));
  assert.equal((await s.post(`${base}/${ann}/remove`)).status, 200);
  assert.equal((await s.post(`${base}/${ann}/remove`)).status, 409, "already removed");
  assert.equal(JSON.stringify(sql(s.w.db, "SELECT * FROM business_profile_answers ORDER BY 1, 2")), keepBefore, "business information is untouched");
  assert.equal((await s.post(`${base}/${mia}/remove`)).status, 409, "mia is now the last owner");
  assert.deepEqual(audit(s.w.db, "action LIKE 'membership.%'").map((x) => [x.action, x.actor_ref]), [["membership.role_changed", ADMIN], ["membership.revoked", ADMIN]]);
  assert.ok(audit(s.w.db).every((x) => !/@/.test(x.detail || "")), "no email addresses in audit detail");
  assert.equal((await s.post(`${base}/${mia}/role`, { role: "admin" })).status, 422);
  assert.equal((await s.post(`${base}/${mia}/role`, {})).status, 422);
  assert.equal(s.net.calls, 0);
});

test("CONCURRENT removal requests for the two owners: exactly one succeeds (200) and one is refused (409); an owner remains", async () => {
  const s = await setup();
  const a = await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  const b = await s.person(s.alpha, "bob@alpha.test", "owner", 2);
  const rs = await Promise.all([s.post(`/api/admin/clients/${s.alpha.id}/members/${a}/remove`), s.post(`/api/admin/clients/${s.alpha.id}/members/${b}/remove`)]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships WHERE organization_id = ? AND role = 'owner' AND status = 'active'", s.alpha.id)[0].n, 1);
});

test("members are organization-scoped: another organization's person is 404 for remove and role; malformed ids are 404; nothing changes", async () => {
  const s = await setup();
  await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  const bob = await s.person(s.beta, "bob@beta.test", "owner", 2);
  const before = s.snap();
  for (const tail of ["remove", "role"]) {
    const r = await s.post(`/api/admin/clients/${s.alpha.id}/members/${bob}/${tail}`, tail === "role" ? { role: "member" } : {});
    assert.equal(r.status, 404, tail);
    assert.equal((await s.post(`/api/admin/clients/${s.alpha.id}/members/not-a-uuid/${tail}`, tail === "role" ? { role: "member" } : {})).status, 404);
  }
  assert.equal(s.snap(), before);
});

/* ------------------------------------------------------------------ reading */

test("access listing: the organization's own members and invitations only, with ids for the actions, the advisory last-owner flag and no provider ids", async () => {
  const s = await setup();
  const ann = await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  await s.person(s.beta, "bob@beta.test", "owner", 2);
  const mk = (email) => s.post(`/api/admin/clients/${s.alpha.id}/invitations`, { email, role: "member" });
  await mk("pending@example.com");
  await mk("old@example.com");
  const r = await s.call(`/api/admin/clients/${s.alpha.id}/access`, { now: at(8) });
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.deepEqual(out.organization, { id: s.alpha.id, name: "Alpha Co", slug: "alpha", status: "active", website_url: null, created_at: out.organization.created_at });
  assert.deepEqual(out.members.map((m) => [m.user_id, m.email, m.role, m.status, m.last_active_owner]), [[ann, "ann@alpha.test", "owner", "active", true]]);
  assert.ok(out.invitations.every((i) => i.id && !("workos_invitation_id" in i)));
  assert.ok(out.invitations.some((i) => i.email === "old@example.com" && i.past_expiry === true), "a lapsed pending invitation is flagged");
  assert.ok(out.invitations.every((i) => i.delivery.state === "not_sent"), "nothing has been sent");
  assert.equal(out.delivery_tracking, true);
  const text = JSON.stringify(out);
  assert.ok(!/bob@beta|Beta Co/.test(text), "nothing from another organization");
  assert.equal((await s.call(`/api/admin/clients/${crypto.randomUUID()}/access`)).status, 404);
  assert.equal((await s.call(`/api/admin/clients/x/access`)).status, 404);
  // the existing read-only Clients routes are unchanged
  assert.equal((await s.call("/api/admin/clients")).status, 200);
  assert.equal((await s.call(`/api/admin/clients/${s.alpha.id}`)).status, 200);
});

/* ------------------------------------------------------------------ methods, scope and failure handling */

test("methods and paths: wrong methods get 405 with Allow; unknown paths are 404; emergency global offboarding is not reachable here", async () => {
  const s = await setup();
  const ann = await s.person(s.alpha, "ann@alpha.test", "owner", 1);
  const base = `/api/admin/clients/${s.alpha.id}`;
  assert.equal((await s.call(`${base}/invitations`)).status, 405);
  assert.equal((await s.call(`${base}/access`, { method: "POST", json: {} })).headers.get("Allow"), "GET");
  assert.equal((await s.call(`${base}/members/${ann}/remove`, { method: "DELETE" })).headers.get("Allow"), "POST");
  assert.equal((await s.call(`${base}/members/${ann}/remove`, { method: "PUT", json: {} })).status, 405);
  const before = s.snap();
  for (const p of [`${base}/members/${ann}`, `${base}/members/${ann}/offboard`, `${base}/members/${ann}/disable`, `/api/admin/users/${ann}/offboard`, `/api/admin/users/${ann}/disable`, `${base}/delete`, `${base}/status`]) {
    const r = await s.post(p, {});
    assert.ok([404, 503].includes(r.status), `${p} -> ${r.status}`); // 503 = the feedback modules' own "no feedback database" answer in this harness; never a success
    assert.ok(r.status !== 200 && r.status !== 201);
  }
  assert.equal(s.snap(), before);
  const src = read("worker/portal/admin-access.js");
  assert.ok(!/offboard|reenable|disableUser|setUserStatus/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")), "the module cannot offboard or disable a user");
  assert.equal(s.net.calls, 0);
});

test("failures are safe: a database error answers 500 server_error with no SQL, ids or values, and the portal being absent answers 503", async () => {
  const s = await setup();
  const broken = { ...s.w.db, prepare: () => { throw new Error("SELECT secret FROM users WHERE token = 'abc123'"); }, batch: () => { throw new Error("D1_ERROR near secret"); } };
  const r = await s.post("/api/admin/clients", { name: "Acme" }, { e: { ...s.env, PORTAL_DB: broken } });
  assert.equal(r.status, 500);
  const text = await r.text();
  assert.deepEqual(JSON.parse(text).error, "server_error");
  assert.ok(!/SELECT|secret|abc123|D1_ERROR/.test(text));
  assert.equal((await s.post("/api/admin/clients", { name: "Acme" }, { e: { ...s.env, PORTAL_DB: undefined } })).status, 503);
});

test("the module imports exactly the reviewed modules, and no other file imports the delivery code", () => {
  const src = read("worker/portal/admin-access.js");
  const imports = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(imports, ["./admin-clients.js", "./repo/orgs.js", "./repo/invitations.js", "./repo/memberships.js", "./repo/validate.js", "./repo/common.js", "./workos-admin.js", "./invite-delivery.js", "../assessment.js", "./invite-recipients.js"]);
  for (const f of ["worker/index.js", "worker/admin/router.js", "worker/portal/router.js", "worker/portal/auth.js", "worker/portal/admin-clients.js", "worker/portal/admin-feedback.js"]) {
    assert.ok(!/invite-delivery|workos-admin|invitation-delivery/.test(read(f)), f + " does not import the unwired delivery code");
  }
});
