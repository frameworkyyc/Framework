/* The Analytics portfolio endpoint GET /api/admin/analytics/summary: read-only, cached figures only, connection status as booleans, no secrets (no migration). */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sites from "../portal/repo/websites.js";

import * as analytics from "../portal/repo/website-analytics.js";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const nowS = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld({});
  Object.assign(w.env, { PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) });
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  const call = async (path, { method = "GET", auth = true } = {}) => {
    const h = { Origin: ORIGIN, ...(auth ? { "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }) } : {}), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: h }), w.env, {});
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const mk = async (org, over = {}) => (await sites.createWebsite(w.db, org.id, { name: "Main website", url: "https://alpha.example.ca", origin: "client", status: "live", published: true, ...over }, ADMIN, { now: w.clock.now() })).id;
  return { w, A, B, call, mk };
}

test("GET /analytics/summary: connection status per website, own-account flag, cached figures with their time; never a token; read-only", async () => {
  const s = await setup();
  const a = await s.mk(s.A, { name: "Alpha site" });
  const b = await s.mk(s.B, { name: "Beta site", url: "https://beta.example.ca" });
  await analytics.saveConfig(s.w.db, s.A.id, a, { cf_site_tag: "0123456789abcdef0123456789abcdef", gsc_property: "sc-domain:alpha.example.ca" }, ADMIN);
  await analytics.putCached(s.w.db, s.A.id, a, "cloudflare", 30, "0123456789abcdef0123456789abcdef", { totals: { pageViews: 120, visits: 40 } }, { now: s.w.clock.now() });
  const r = await s.call("/analytics/summary");
  assert.equal(r.status, 200);
  assert.equal(r.json.available, true);
  assert.equal(typeof r.json.platform.cloudflare, "boolean");
  const A = r.json.websites.find((x) => x.id === a), B = r.json.websites.find((x) => x.id === b);
  assert.equal(A.cloudflare.connected, true); assert.equal(A.searchConsole.connected, true); assert.equal(A.cloudflare.account, "framework");
  assert.deepEqual(A.cloudflare.figures, { pageViews: 120, visits: 40 }); assert.ok(A.cloudflare.fetchedAt);
  assert.equal(A.searchConsole.figures, null, "never read: no figures, nothing estimated");
  assert.equal(B.cloudflare.connected, false); assert.equal(B.cloudflare.figures, null);
  const text = JSON.stringify(r.json);
  assert.ok(!/cf_token|cfTokenEnc|cf_api_token|secret/i.test(text), "no token or secret field");
  assert.equal((await s.call("/analytics/summary", { method: "POST" })).status, 405);
  assert.notEqual((await s.call("/analytics/summary", { auth: false })).status, 200);
});

test("GET /analytics/summary leaves out archived websites and deleted clients", async () => {
  const s = await setup();
  const a = await s.mk(s.A, { name: "Alpha site" });
  await s.mk(s.B, { name: "Beta site" });
  s.w.db.raw.prepare("UPDATE websites SET archived_at = ? WHERE id = ?").run("2026-01-01T00:00:00.000Z", a);
  s.w.db.raw.prepare("UPDATE organizations SET status = 'archived', archived_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(s.B.id);
  const r = await s.call("/analytics/summary");
  assert.deepEqual(r.json.websites, []);
});
