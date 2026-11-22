/* GET /api/admin/dashboard/trends: eight weekly counts of the allow-listed activity events (read-only, counts only, no names; deleted clients excluded). */
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { createOrganizationAudited } from "../portal/repo/orgs.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };

test("trends: eight Monday-start weeks, allow-listed events counted, others ignored, read-only and admin-only", async () => {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const token = sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T, exp: T + 600 });
  const call = (path, { method = "GET", auth = true } = {}) => handleAdmin(new Request(ORIGIN + path, { method, headers: auth ? { "Cf-Access-Jwt-Assertion": token, Origin: ORIGIN } : {} }), env, {});
  await createOrganizationAudited(w.db, { slug: "alpha", name: "Alpha Co" }, ADMIN); // writes an org.created activity row now
  const res = await call("/api/admin/dashboard/trends");
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.available, true);
  assert.equal(j.weeks.length, 8);
  for (const wk of j.weeks) assert.match(wk.start, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(j.weeks.every((x) => new Date(x.start + "T00:00:00Z").getUTCDay() === 1), "weeks start on Monday");
  assert.ok(j.weeks[7].total >= 1, "this week counts the new client");
  assert.ok(!JSON.stringify(j).includes("Alpha"), "counts only, no names");
  assert.equal((await call("/api/admin/dashboard/trends", { method: "POST" })).status, 405);
  assert.notEqual((await call("/api/admin/dashboard/trends", { auth: false })).status, 200);
});
