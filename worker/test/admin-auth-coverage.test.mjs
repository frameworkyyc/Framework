// Production rollout preparation: EVERY /admin page and /api/admin route answers nothing without a valid Cloudflare Access token for an allowed admin. This is the
// in-code guarantee (the Worker verifies the token itself and fails closed) that holds whether or not the Access policy in front of the site covers a path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = Math.floor(Date.now() / 1000);
const sign = (c, key = pair.privateKey) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(key))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", iat: T, exp: T + 600, ...over });
const UUID = "00000000-0000-4000-8000-000000000000";

const PAGES = ["/admin", "/admin/", "/admin/clients", `/admin/clients/${UUID}`, `/admin/clients/${UUID}/invoices`, `/admin/clients/${UUID}/support`, `/admin/clients/${UUID}/branding`, "/admin/approved-emails", "/admin/support", "/admin/assessments", "/admin/feedback", "/admin/portal-feedback", "/admin/assets/admin.js", "/admin/assets/clients.js", "/admin/assets/approved-emails.js", "/admin/zz-unknown"];
const API = [
  ["GET", "/api/admin"], ["GET", "/api/admin/clients"], ["POST", "/api/admin/clients"], ["GET", `/api/admin/clients/${UUID}`], ["GET", `/api/admin/clients/${UUID}/access`],
  ["POST", `/api/admin/clients/${UUID}/delete`], ["POST", `/api/admin/clients/${UUID}/restore`], ["POST", `/api/admin/clients/${UUID}/invitations`],
  ["POST", `/api/admin/clients/${UUID}/invitations/${UUID}/send`], ["POST", `/api/admin/clients/${UUID}/members/${UUID}/remove`],
  ["GET", "/api/admin/approved-emails"], ["POST", "/api/admin/approved-emails"], ["POST", "/api/admin/approved-emails/remove"], ["POST", "/api/admin/approved-emails/import"],
  ["GET", `/api/admin/clients/${UUID}/invoices`], ["GET", `/api/admin/clients/${UUID}/support`], ["GET", `/api/admin/clients/${UUID}/branding`], ["GET", `/api/admin/clients/${UUID}/branding/files/${UUID}/download`],
  ["GET", "/api/admin/support"], ["GET", "/api/admin/services/attention"], ["POST", "/api/admin/services/notifications/process"],
  ["GET", "/api/admin/feedback"], ["GET", "/api/admin/portal-feedback"], ["GET", "/api/admin/assessments"], ["GET", "/api/admin/database"], ["GET", "/api/admin/zz-not-a-route"],
];

test("without a valid admin token every admin page and API route is refused, reveals no data, and writes nothing", async () => {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co");
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), PORTAL_ADMIN_WRITES: "1" };
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const bad = [null, "garbage", sign(claims(), other.privateKey), sign(claims({ email: "intruder@example.com" })), sign(claims({ aud: ["b".repeat(64)] })), sign(claims({ exp: T - 3600 })), sign(claims({ iss: "https://evil.example" }))];
  const dump = () => JSON.stringify(["organizations", "memberships", "invitations", "activity_log", "approved_emails"].map((t) => w.db.raw.prepare(`SELECT * FROM ${t}`).all()));
  const before = dump();
  for (const token of bad) {
    for (const path of PAGES) {
      const h = token ? { "Cf-Access-Jwt-Assertion": token } : {};
      const r = await handleAdmin(new Request(ORIGIN + path, { headers: h }), env, {});
      assert.ok([401, 403, 503].includes(r.status), `${path} -> ${r.status}`);
      const t = await r.text();
      assert.ok(!/Alpha Co|owner@frameworkco\.ca|admin\.js"|import\(/.test(t), `${path} leaks nothing`);
    }
    for (const [method, path] of API) {
      const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...(token ? { "Cf-Access-Jwt-Assertion": token } : {}) };
      const r = await handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify({ email: "x@y.test", confirm: "DELETE", name: "X" }) }), env, {});
      assert.ok([401, 403, 503].includes(r.status), `${method} ${path} -> ${r.status}`);
      assert.ok(!/Alpha Co/.test(await r.text()), `${method} ${path} leaks nothing`);
    }
  }
  assert.equal(dump(), before, "nothing was written");
  // and a valid token gets through (the same harness), so the refusals above are about the token, not a broken route
  const ok = await handleAdmin(new Request(ORIGIN + "/api/admin/approved-emails", { headers: { "Cf-Access-Jwt-Assertion": sign(claims()) } }), env, {});
  assert.equal(ok.status, 200);
  assert.ok(A.id);
});

test("the router authenticates BEFORE it looks at the path, and a missing configuration fails closed", async () => {
  const src = readFileSync(new URL("../admin/router.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const body = src.slice(src.indexOf("export async function handleAdmin"));
  assert.ok(body.indexOf("authenticateAdmin") < body.indexOf("handleApi(") && body.indexOf("authenticateAdmin") < body.indexOf("handlePage("), "authentication comes before any page or API handler");
  const r = await handleAdmin(new Request(ORIGIN + "/api/admin/clients"), { PORTAL_DB: null }, {});
  assert.ok([401, 403, 503].includes(r.status));
  const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(idx, /path === "\/admin" \|\| path\.startsWith\("\/admin\/"\) \|\| path === "\/api\/admin" \|\| path\.startsWith\("\/api\/admin\/"\)/, "every /admin and /api/admin path is sent to the admin handler");
  const cfg = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"run_worker_first": \[[^\]]*"\/api\/\*", "\/admin", "\/admin\/\*"/, "the Worker runs first for these paths, so no static file under /admin is served without the check");
});
