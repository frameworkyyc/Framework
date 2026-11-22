/* GET /api/admin/invoices: every client's invoices in one read-only list; no storage key, note or description; archived invoices and deleted clients left out. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sites from "../portal/repo/websites.js";

import * as inv from "../portal/repo/invoices.js";

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

test("GET /invoices: all clients, derived status, totals, no private fields; read-only", async () => {
  const s = await setup();
  const mkInv = async (org, number, extra = {}) => { const r = await inv.createInvoice(s.w.db, org.id, { invoiceNumber: number, issueDate: "2026-01-10", dueDate: "2026-01-20", amount: "100.00", description: "secret description", internalNote: "private note", ...extra }, ADMIN); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const a = await mkInv(s.A, "A-1"); await mkInv(s.B, "B-1", { dueDate: "2099-01-01", amount: "50.00" });
  s.w.db.raw.prepare("UPDATE invoices SET published_by = 'x@y.z', published_at = ?, sha256 = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', format = 'pdf', content_type = 'application/pdf', size_bytes = 10, storage_key = 'org/' || organization_id || '/invoices/private-key-1234567890' WHERE id = ?").run("2026-01-11T00:00:00.000Z", a);
  const r = await s.call("/invoices");
  assert.equal(r.status, 200);
  assert.equal(r.json.invoices.length, 2);
  const A1 = r.json.invoices.find((i) => i.invoiceNumber === "A-1"), B1 = r.json.invoices.find((i) => i.invoiceNumber === "B-1");
  assert.equal(A1.status, "overdue"); assert.equal(A1.hasFile, true); assert.equal(B1.status, "draft");
  assert.equal(r.json.summary.overdueCount, 1); assert.equal(r.json.summary.draftCount, 1); assert.equal(r.json.summary.outstandingCents, 10000);
  assert.ok(!/private|secret|storage|sha256/i.test(JSON.stringify(r.json)), "no storage key, hash, note or description");
  assert.equal((await s.call("/invoices", { method: "POST" })).status, 405);
  assert.notEqual((await s.call("/invoices", { auth: false })).status, 200);
});
