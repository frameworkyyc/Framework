// Run with:  node --test worker/test/*.mjs
// Exercises the REAL admin router (handleAdmin) with genuinely signed Cloudflare Access tokens, to prove that every
// assessments endpoint (list, summary, resend, test email, DELETE) is closed to anyone who is not an authorised admin.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { handleAssessmentSubmit, resetAssessmentSchemaForTests } from "../assessment.js";

const TEAM = "framework.cloudflareaccess.com";
const AUD = "a".repeat(64);
const ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims, kp = pair) => {
  const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims));
  return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(kp.privateKey))}`;
};
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });

const makeDb = () => {
  const db = new DatabaseSync(":memory:");
  return { raw: db, prepare(sql) { let a = []; const s = { bind: (...x) => { a = x; return s; }, run: async () => { const r = db.prepare(sql).run(...a); return { meta: { changes: r.changes } }; }, first: async () => db.prepare(sql).get(...a) ?? null, all: async () => ({ results: db.prepare(sql).all(...a) }) }; return s; } };
};
const ID = "rt-aaaaaaaaaaaaaaaaaaaa", ID2 = "rt-bbbbbbbbbbbbbbbbbbbb";
let db, emailCalls, env;
const resendOk = async (url) => { emailCalls.push(String(url)); return new Response("{}", { status: 200 }); };

beforeEach(async () => {
  resetAssessmentSchemaForTests(); resetKeyCacheForTests();
  db = makeDb(); emailCalls = [];
  env = { DB: db, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca, second@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
    RESEND_API_KEY: "re_k", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" };
  let n = 0;
  for (const id of [ID, ID2]) {
    await handleAssessmentSubmit(new Request(ORIGIN + "/api/assessment", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, "CF-Connecting-IP": "198.51.100." + ++n },
      body: JSON.stringify({ business_name: "Co " + id, website: "example.com", contact_name: "A", email: "a@example.com", location: "Calgary", industry: "Trades", privacy_ack: true, submission_id: id, elapsed_ms: 9000 }) }), { DB: db }, { fetch: resendOk });
  }
  emailCalls = [];
});

const call = (path, { method = "GET", token, cookie, headers = {}, body, e = env } = {}) => {
  const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
  if (token) h["Cf-Access-Jwt-Assertion"] = token;
  if (cookie) h.Cookie = "CF_Authorization=" + cookie;
  return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e, { fetch: resendOk });
};
const rows = () => db.raw.prepare("SELECT COUNT(*) AS n FROM assessment_requests").get().n;
const ENDPOINTS = [
  ["GET", "/api/admin/assessments"], ["GET", "/api/admin/assessments/summary"],
  ["POST", "/api/admin/assessments/resend"], ["POST", "/api/admin/assessments/test-email"], ["DELETE", `/api/admin/assessments/${ID}`],
];

test("authorised admin: can list, delete one record (token via header or the CF_Authorization cookie)", async () => {
  const good = sign(claims());
  assert.equal((await call("/api/admin/assessments", { token: good })).status, 200);
  assert.equal((await call(`/api/admin/assessments/${ID}`, { method: "DELETE", token: good })).status, 200);
  assert.equal(rows(), 1);
  assert.equal((await call(`/api/admin/assessments/${ID2}`, { method: "DELETE", cookie: sign(claims({ email: "SECOND@frameworkco.ca" })) })).status, 200); // case-insensitive allow-list
  assert.equal(rows(), 0);
});

test("NO token: every assessments endpoint answers 401 and nothing is read, deleted or emailed", async () => {
  for (const [method, path] of ENDPOINTS) {
    const res = await call(path, { method });
    assert.equal(res.status, 401, method + " " + path);
    assert.deepEqual(await res.json(), { error: "unauthenticated" });
  }
  assert.equal(rows(), 2); assert.equal(emailCalls.length, 0);
});

test("invalid tokens are refused on every endpoint: forged signature, wrong audience, wrong issuer, expired, not-yet-valid, garbage", async () => {
  const bad = {
    "signed by another key": sign(claims(), other),
    "wrong audience": sign(claims({ aud: ["b".repeat(64)] })),
    "wrong issuer": sign(claims({ iss: "https://evil.cloudflareaccess.com" })),
    "expired": sign(claims({ exp: now() - 3600 })),
    "not yet valid": sign(claims({ nbf: now() + 3600 })),
    "garbage": "not.a.token",
    "alg none": `${b64u(JSON.stringify({ alg: "none", kid: "k1" }))}.${b64u(JSON.stringify(claims()))}.`,
  };
  for (const [label, token] of Object.entries(bad)) {
    for (const [method, path] of ENDPOINTS) {
      const res = await call(path, { method, token });
      assert.equal(res.status, 401, `${label}: ${method} ${path}`);
    }
  }
  assert.equal(rows(), 2); assert.equal(emailCalls.length, 0);
});

test("a validly signed token for someone NOT in ADMIN_EMAILS is 403 everywhere (including DELETE)", async () => {
  const token = sign(claims({ email: "intruder@example.com" }));
  for (const [method, path] of ENDPOINTS) assert.equal((await call(path, { method, token })).status, 403, method + " " + path);
  assert.equal(rows(), 2); assert.equal(emailCalls.length, 0);
});

test("a service token (no email claim) is not an admin", async () => {
  const token = sign(claims({ email: undefined, common_name: "svc.access" }));
  assert.equal((await call(`/api/admin/assessments/${ID}`, { method: "DELETE", token })).status, 403);
  assert.equal(rows(), 2);
});

test("admin auth not configured on this deployment: everything is denied (503), nothing deleted", async () => {
  for (const missing of ["ACCESS_TEAM_DOMAIN", "ACCESS_AUD", "ADMIN_EMAILS"]) {
    const e = { ...env, [missing]: "" };
    const res = await call(`/api/admin/assessments/${ID}`, { method: "DELETE", token: sign(claims()), e });
    assert.equal(res.status, 503, missing);
    assert.deepEqual(await res.json(), { error: "not_configured" });
  }
  assert.equal(rows(), 2);
});

test("a valid admin token still cannot delete or resend cross-site: Origin and the admin header are enforced", async () => {
  const token = sign(claims());
  assert.equal((await call(`/api/admin/assessments/${ID}`, { method: "DELETE", token, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call(`/api/admin/assessments/${ID}`, { method: "DELETE", token, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal((await call("/api/admin/assessments/resend", { method: "POST", token, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal(rows(), 2); assert.equal(emailCalls.length, 0);
});

test("the public Worker routes never expose assessment data or accept deletes", async () => {
  const worker = (await import("../index.js")).default;
  const publicEnv = { ...env, ASSETS: { fetch: () => new Response("asset") } };
  for (const [method, path] of [["GET", "/api/assessment"], ["DELETE", "/api/assessment"], ["DELETE", `/api/assessment/${ID}`], ["GET", "/api/assessments"], ["GET", "/api/feedback"]]) {
    const res = await worker.fetch(new Request(ORIGIN + path, { method, headers: { Origin: ORIGIN } }), publicEnv);
    assert.ok([404, 405].includes(res.status), `${method} ${path} -> ${res.status}`);
    assert.ok(!(await res.text()).includes("Co " + ID));
  }
  const cfg = await worker.fetch(new Request(ORIGIN + "/api/assessment/config"), publicEnv);
  assert.deepEqual(Object.keys(await cfg.json()).sort(), ["metaPixelId", "turnstileSiteKey"]);
  assert.equal(rows(), 2);
});
