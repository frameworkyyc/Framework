// Run with:  node --test worker/test
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { authenticateAdmin, verifyAccessJwt, readAccessConfig, resetKeyCacheForTests } from "../admin/access.js";

const TEAM = "framework.cloudflareaccess.com";
const AUD = "a".repeat(64);
const b64u = (buf) => Buffer.from(buf).toString("base64url");

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (kp, kid) => ({ ...kp.publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });

const sign = (claims, { kp = pair, kid = "k1", alg = "RS256" } = {}) => {
  const head = b64u(JSON.stringify({ alg, kid, typ: "JWT" }));
  const body = b64u(JSON.stringify(claims));
  const sig = createSign("RSA-SHA256").update(head + "." + body).sign(kp.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
};
const nowS = () => Math.floor(Date.now() / 1000);
const good = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@example.com", exp: nowS() + 600, iat: nowS(), ...over });

const env = (over = {}) => ({
  ACCESS_TEAM_DOMAIN: TEAM,
  ACCESS_AUD: AUD,
  ADMIN_EMAILS: "Owner@Example.com, other@example.com",
  ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwkOf(pair, "k1")] }),
  ...over,
});
const req = (token, headers = {}) => new Request("https://frameworkco.ca/api/admin/me", { headers: token ? { "Cf-Access-Jwt-Assertion": token, ...headers } : headers });

test("valid token for an allow-listed admin is accepted (email compared case-insensitively)", async () => {
  const r = await authenticateAdmin(req(sign(good())), env());
  assert.deepEqual(r, { ok: true, email: "owner@example.com" });
});

test("token in the CF_Authorization cookie also works", async () => {
  const r = await authenticateAdmin(new Request("https://x/", { headers: { Cookie: `a=b; CF_Authorization=${sign(good())}` } }), env());
  assert.equal(r.ok, true);
});

test("fails closed when any setting is missing", async () => {
  for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ADMIN_EMAILS"]) {
    const r = await authenticateAdmin(req(sign(good())), env({ [missing]: "" }));
    assert.equal(r.ok, false);
    assert.equal(r.status, 503);
    assert.equal(r.code, "not_configured");
  }
});

test("no token → 401", async () => {
  const r = await authenticateAdmin(req(null), env());
  assert.deepEqual([r.ok, r.status, r.code], [false, 401, "unauthenticated"]);
});

test("rejects: wrong audience, wrong issuer, expired, not-yet-valid", async () => {
  for (const claims of [good({ aud: ["b".repeat(64)] }), good({ iss: "https://evil.cloudflareaccess.com" }), good({ exp: nowS() - 3600 }), good({ nbf: nowS() + 3600 })]) {
    const r = await authenticateAdmin(req(sign(claims)), env());
    assert.equal(r.ok, false, JSON.stringify(claims));
    assert.equal(r.status, 401);
  }
});

test("rejects a token signed by a different key", async () => {
  const r = await authenticateAdmin(req(sign(good(), { kp: other })), env());
  assert.equal(r.ok, false);
});

test("rejects tampered payload (signature no longer matches)", async () => {
  const [h, , s] = sign(good()).split(".");
  const forged = b64u(JSON.stringify(good({ email: "attacker@example.com" })));
  const r = await authenticateAdmin(req(`${h}.${forged}.${s}`), env({ ADMIN_EMAILS: "attacker@example.com" }));
  assert.equal(r.ok, false);
});

test("rejects alg none and HS256 (algorithm confusion)", async () => {
  const head = b64u(JSON.stringify({ alg: "none", kid: "k1" }));
  const body = b64u(JSON.stringify(good()));
  assert.equal((await authenticateAdmin(req(`${head}.${body}.`), env())).ok, false);
  const hs = b64u(JSON.stringify({ alg: "HS256", kid: "k1" }));
  assert.equal((await authenticateAdmin(req(`${hs}.${body}.${b64u("x")}`), env())).ok, false);
});

test("rejects an unknown key id", async () => {
  const r = await authenticateAdmin(req(sign(good(), { kid: "nope" })), env());
  assert.equal(r.ok, false);
});

test("rejects garbage and oversized tokens", async () => {
  for (const t of ["abc", "a.b.c", "....", "x".repeat(9000)]) assert.equal((await authenticateAdmin(req(t), env())).ok, false);
});

test("valid Access login for someone not in ADMIN_EMAILS → 403", async () => {
  const r = await authenticateAdmin(req(sign(good({ email: "client@example.com" }))), env());
  assert.deepEqual([r.ok, r.status, r.code], [false, 403, "forbidden"]);
});

test("service token (no email) is not an admin → 403", async () => {
  const r = await authenticateAdmin(req(sign(good({ email: undefined, common_name: "svc" }))), env());
  assert.deepEqual([r.ok, r.status], [false, 403]);
});

test("audience may be a plain string and ACCESS_AUD may list several", async () => {
  assert.equal((await authenticateAdmin(req(sign(good({ aud: AUD }))), env())).ok, true);
  assert.equal((await authenticateAdmin(req(sign(good({ aud: ["z".repeat(64)] }))), env({ ACCESS_AUD: `${"z".repeat(64)}, ${AUD}` }))).ok, true);
});

test("fetches signing keys from the team domain and refetches once on rotation", async () => {
  resetKeyCacheForTests();
  let calls = 0;
  let keys = [jwkOf(pair, "k1")];
  const fetchImpl = async (url) => { calls++; assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`); return new Response(JSON.stringify({ keys })); };
  const config = readAccessConfig({ ACCESS_TEAM_DOMAIN: `https://${TEAM}/`, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@example.com" });
  assert.equal(config.team, TEAM);
  const e = { ACCESS_TEAM_DOMAIN: TEAM };
  await verifyAccessJwt(sign(good()), config, e, { fetchImpl });
  await verifyAccessJwt(sign(good()), config, e, { fetchImpl });
  assert.equal(calls, 1, "keys are cached");
  keys = [jwkOf(pair, "k1"), jwkOf(other, "k2")];
  await verifyAccessJwt(sign(good(), { kp: other, kid: "k2" }), config, e, { fetchImpl, now: Date.now() + 2 * 60 * 1000 });
  assert.equal(calls, 2, "refetched once for the new key id");
});
