// Phase 4: the Admin Clients interface. Browser behaviour was verified separately in Chromium (see the phase report); these tests pin what can be pinned in Node:
// the additive API fields the interface relies on, the browser-side API wrapper's error mapping, and source-level guards (no inline styles, no HTML injection,
// confirmations on every change, no access logic in the front end, no claim of delivery, nothing but the reviewed endpoints).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const NOW = new Date("2026-10-20T12:00:00.000Z");
const at = (d) => new Date(NOW.getTime() + d * 86400000);
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));

async function setup(over = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const org = await w.org("alpha", "Alpha Co");
  const calls = [];
  const fetchMock = async (url, init = {}) => {
    const u = new URL(url); calls.push(`${init.method || "GET"} ${u.host}${u.pathname}`);
    if (u.host === "api.workos.com" && (init.method || "GET") === "GET") return new Response(JSON.stringify({ data: [] }), { status: 200 });
    if (u.pathname === "/user_management/invitations") return new Response(JSON.stringify({ id: "invitation_01UITEST" }), { status: 201 });
    const m = /invitations\/(invitation_\w+)\/revoke$/.exec(u.pathname);
    if (m) return new Response("{}", { status: 500 });
    throw new Error("no network");
  };
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_INVITE_ALLOWED_EMAILS: "plain@example.com sent@example.com", ...over };
  const call = (path, { method = "GET", json, e = env, now = NOW } = {}) => {
    const t = sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 600 });
    return handleAdmin(new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", "Cf-Access-Jwt-Assertion": t }, body: json === undefined ? undefined : JSON.stringify(json) }), e, { now, fetch: fetchMock });
  };
  return { w, org, env, call, calls };
}

/* ------------------------------------------------------------------ additive API fields */

test("capabilities: the list and the access listing say, as booleans only, whether changes and sending are switched on (sending needs BOTH switches)", async () => {
  for (const [over, writes, sending] of [[{}, false, false], [{ PORTAL_ADMIN_WRITES: "1" }, true, false], [{ PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1" }, true, true], [{ PORTAL_INVITE_SENDING: "1" }, false, false], [{ PORTAL_ADMIN_WRITES: "true" }, false, false]]) {
    const s = await setup(over);
    const list = await (await s.call("/api/admin/clients")).json();
    assert.deepEqual(list.capabilities, { writes });
    const access = await (await s.call(`/api/admin/clients/${s.org.id}/access`)).json();
    assert.deepEqual(access.capabilities, { writes, sending, recipients: "configured" }, JSON.stringify(over));
    assert.ok(!JSON.stringify([list, access]).match(/PORTAL_|sk_|key/i), "booleans only: no setting names or values");
  }
});

test("workos_cleanup tells the interface whether a revoked invitation's WorkOS side still needs cancelling (read from the audit trail; the WorkOS id stays private)", async () => {
  const s = await setup({ PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1", PORTAL_AUTH_CLIENT_SECRET: "sk_test_FAKE_FOR_UI_TESTS", PORTAL_BASE_URL: ORIGIN });
  const post = (path, json = {}) => s.call(path, { method: "POST", json });
  const mk = async (email) => (await (await post(`/api/admin/clients/${s.org.id}/invitations`, { email, role: "member" })).json()).invitation;
  const sent = await mk("sent@example.com");
  const plain = await mk("plain@example.com");
  await post(`/api/admin/clients/${s.org.id}/invitations/${sent.id}/send`);
  const listed = async () => Object.fromEntries((await (await s.call(`/api/admin/clients/${s.org.id}/access`)).json()).invitations.map((i) => [i.email, i]));
  assert.deepEqual([(await listed())["sent@example.com"].workos_cleanup, (await listed())["plain@example.com"].workos_cleanup], ["none", "none"], "nothing revoked yet");
  const rev = await (await post(`/api/admin/clients/${s.org.id}/invitations/${sent.id}/revoke`)).json();
  assert.deepEqual([rev.invitation.status, rev.workos, rev.invitation.workos_cleanup], ["revoked", { state: "revoke_failed", error: "workos_unavailable" }, "pending"]);
  await post(`/api/admin/clients/${s.org.id}/invitations/${plain.id}/revoke`);
  const l = await listed();
  assert.deepEqual([l["sent@example.com"].workos_cleanup, l["plain@example.com"].workos_cleanup], ["pending", "none"], "a revoked invitation with no WorkOS side has nothing to clean up");
  // the cleanup is recorded as done once WorkOS accepts the cancel
  sql(s.w.db, "SELECT 1");
  s.w.db.raw.exec(`INSERT INTO activity_log (id, organization_id, actor_type, actor_ref, action, entity_type, entity_id, visibility, created_at) VALUES ('${crypto.randomUUID()}', '${s.org.id}', 'admin', '${ADMIN}', 'invitation.workos_revoked', 'invitation', '${sent.id}', 'internal', '${NOW.toISOString()}')`);
  assert.equal((await listed())["sent@example.com"].workos_cleanup, "done");
  assert.ok(!JSON.stringify(await listed()).includes("invitation_01UITEST"));
  assert.deepEqual(s.calls.filter((c) => c.includes("revoke")), ["POST api.workos.com/user_management/invitations/invitation_01UITEST/revoke"]);
});

/* ------------------------------------------------------------------ the browser-side API wrapper, with a stubbed fetch */

const withFetch = async (respond, fn) => {
  const saved = globalThis.fetch;
  globalThis.fetch = async (url, init) => { const r = await respond(url, init); if (r instanceof Error) throw r; return r; };
  try { return await fn(await import("../../admin/assets/ui.js")); } finally { globalThis.fetch = saved; }
};
const json = (status, body, extra = {}) => Object.assign(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }), extra);

test("api(): server error codes become short, safe codes; the raw message is never the Error's text; writes carry the CSRF header", async () => {
  const seen = [];
  const cases = [
    [403, { error: "writes_disabled", message: "m" }, "writes_disabled"], [403, { error: "sending_disabled" }, "sending_disabled"], [403, { error: "forbidden" }, "denied"], [401, {}, "denied"],
    [404, {}, "not_found"], [409, { error: "last_owner", message: "m" }, "last_owner"], [409, {}, "conflict"], [422, { error: "invalid_slug", message: "plain sentence" }, "invalid_slug"],
    [502, { error: "delivery_failed", delivery: { state: "failed", channel: "workos", error: "workos_unavailable" } }, "delivery_failed"], [502, { error: "other" }, "error"],
    [500, { error: "delivery_unrecorded", message: "m" }, "delivery_unrecorded"], [500, { error: "server_error" }, "error"],
    [503, { error: "provider_not_configured" }, "provider_not_configured"], [503, { error: "delivery_tracking_unavailable" }, "delivery_tracking_unavailable"], [503, { error: "portal_unavailable" }, "unavailable"],
    [400, { error: "unknown_field" }, "error"], [413, {}, "error"], [415, {}, "error"],
  ];
  for (const [status, body, code] of cases) {
    await withFetch((url, init) => { seen.push({ url, init }); return json(status, { ...body, secret: "SQL: SELECT * FROM users" }); }, async ({ api, ApiError }) => {
      await assert.rejects(() => api("/clients/x/invitations", { method: "POST", body: { a: 1 } }), (e) => e instanceof ApiError && e.code === code && e.status === status && e.message === code && !String(e.stack).includes("SQL:"), `${status} ${JSON.stringify(body)}`);
    });
  }
  assert.ok(seen.every((s) => s.init.method === "POST" && s.init.headers["X-Framework-Admin"] === "1" && s.init.headers["Content-Type"] === "application/json" && s.url.startsWith("/api/admin/") && s.init.credentials === "same-origin"));
  await withFetch(() => json(502, { error: "delivery_failed", delivery: { state: "failed", channel: "workos", error: "workos_rejected" } }), async ({ api }) => {
    await assert.rejects(() => api("/x", { method: "POST", body: {} }), (e) => e.data.delivery.error === "workos_rejected" && e.detail === "");
  });
  await withFetch(() => new Error("network down"), async ({ api }) => { await assert.rejects(() => api("/x"), (e) => e.code === "network"); });
  await withFetch(() => { const r = new Response("", { status: 200 }); Object.defineProperty(r, "redirected", { value: true }); return r; }, async ({ api }) => { await assert.rejects(() => api("/x"), (e) => e.code === "session"); });
  await withFetch(() => new Response("<html>login</html>", { status: 200, headers: { "Content-Type": "text/html" } }), async ({ api }) => { await assert.rejects(() => api("/x"), (e) => e.code === "session"); });
  await withFetch(() => json(200, { ok: 1 }), async ({ api }) => { assert.deepEqual(await api("/x"), { ok: 1 }); });
});

/* ------------------------------------------------------------------ source guards */

const UI = ["admin/assets/clients.js", "admin/assets/clients-access.js"];

test("the interface is built the safe way: text nodes only, no inline styles or handlers, no HTML injection, no storage of tokens", () => {
  for (const f of UI) {
    const src = strip(read(f));
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function|dangerouslySet/.test(src), f + ": no HTML injection");
    assert.ok(!/style\s*:\s*["'{]|\.style\.|setAttribute\(\s*["']style|\son[a-z]+\s*=\s*["']/i.test(src), f + ": no inline styles or inline handlers (the admin CSP forbids them)");
    assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(src), f + ": stores nothing in the browser");
    assert.ok(!/fetch\(/.test(src), f + ": talks to the server only through the shared api() wrapper");
  }
  assert.match(read("worker/admin/router.js"), /script-src 'self'/);
});

test("only the reviewed API routes are used, each write through api() with POST, and every access-changing action asks for confirmation first", () => {
  const src = strip(read("admin/assets/clients-access.js"));
  const paths = [...src.matchAll(/api\((`[^`]*`|"[^"]*"|base \+ "[^"]*")/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(paths)].sort(), [
    "`${base}/invitations/${encodeURIComponent(i.id)}/${mode}`", "`${base}/invitations/${encodeURIComponent(i.id)}/replace`", "`${base}/invitations/${encodeURIComponent(i.id)}/revoke`",
    "`${base}/members/${encodeURIComponent(m.user_id)}/remove`", "`${base}/members/${encodeURIComponent(m.user_id)}/role`", "\"/clients\"", "base + \"/access\"", "base + \"/invitations\"",
  ].sort());
  assert.ok(!/\/offboard|\/disable|\/users\/|reenable/i.test(src), "global offboarding is not part of this interface");
  // every write is inside perform() (which confirms) or the new-client form (which has its own submit button)
  const writes = [...src.matchAll(/method: "POST"/g)].length;
  const confirmed = [...src.matchAll(/confirmLabel:/g)].length;
  assert.ok(confirmed >= 8, "create, send, resend, revoke, retry cancel, replace, role change and remove each carry a confirmation (" + confirmed + ")");
  assert.ok(writes >= 8 && /if \(confirm && !\(await confirmDialog\(confirm\)\)\) return;/.test(src), "perform() shows the confirmation before any request");
  assert.match(src, /if \(busy\) return;/, "a second submit is ignored while one is running");
  assert.match(src, /lock\(true\)/);
});

test("the interface decides nothing about access: no role, owner-count or expiry rules are re-implemented; it reads the server's flags", () => {
  const src = strip(read("admin/assets/clients-access.js"));
  assert.ok(/m\.last_active_owner/.test(src), "the last-owner state comes from the server's advisory flag");
  assert.ok(!/filter\([^)]*role === "owner"[^)]*\)\.length|owners\.length|ownerCount|countOwners/.test(src), "owners are not counted in the browser");
  assert.ok(!/Date\.now\(\)|new Date\(\)/.test(src), "expiry is read from the server's past_expiry / status, not computed from the browser clock");
  assert.ok(/i\.past_expiry/.test(src) && /caps\.sending/.test(src) && /caps\.writes/.test(src));
  assert.ok(!/(slug|name)\.(replace|toLowerCase)\(/.test(src), "the URL name is made by the server");
});

test("wording: delivery is never described as arrival; 'submitted' is explained; no raw server text is displayed", () => {
  const src = strip(read("admin/assets/clients-access.js"));
  const shown = [...src.matchAll(/"([^"\n]{12,})"|`([^`\n]{12,})`/g)].map((m) => m[1] || m[2]).join("\n");
  assert.ok(!/\bdelivered\b|has been delivered|was delivered|email sent successfully/i.test(shown), "no claim of delivery");
  assert.match(src, /Arrival in the inbox isn’t confirmed/);
  assert.match(src, /does not confirm the message reached their inbox/);
  assert.match(src, /Nothing was sent/);
  assert.match(src, /stay exactly as they are/, "removing access says the data is kept");
  assert.match(src, /It does not email anyone/, "creating an invitation is distinct from sending it");
  assert.match(src, /Retry WorkOS cancel/);
  assert.ok(!/\.detail\b|\.message\b/.test(src.replace(/e\.message/g, "")), "server messages are not displayed; only friendly copy for known codes");
  assert.ok(!/\bsk_|\bre_[A-Za-z0-9]|Bearer|api key|apiKey|secret/i.test(shown), "no credential wording or values in the interface");
});

test("the Business Profile review stays read-only and intact, and the navigation entry is unchanged", () => {
  const clients = strip(read("admin/assets/clients.js"));
  assert.match(read("admin/assets/clients.js"), /staff cannot edit them here/);
  for (const w of ["Complete", "Partial", "Missing"]) assert.ok(clients.includes(`"${w}"`), w);
  assert.ok(!/method: "(POST|PUT|PATCH|DELETE)"/.test(clients), "clients.js itself makes no write call");
  assert.equal([...clients.matchAll(/\bapi\(/g)].length, 2, "the list and the detail reads");
  assert.match(read("admin/assets/modules.js"), /id: "clients", label: "Clients", path: "\/admin\/clients", enabled: true, load: \(\) => import\("\.\/clients\.js"\)/);
  assert.match(read("admin/assets/clients.js"), /from "\.\/clients-access\.js"/);
});
