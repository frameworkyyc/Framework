// Admin Overview "Client requests": outstanding Branding requests and support or change requests of every live client in one newest-first list, with a count;
// closed and declined ones, and deleted clients, are never listed; read-only, admin-only; each source independent; the Overview markup links and refreshes it.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as sup from "../portal/repo/support.js";
import * as brand from "../portal/repo/brand.js";
import { isKnownBrandingService } from "../portal/brand-services.js";
import { createOrganizationAudited, archiveOrganizationAudited } from "../portal/repo/orgs.js";
import { ACTIVITY_LABELS } from "../portal/admin-dashboard.js";
import { requestsSection } from "../../admin/assets/overview.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const at = (day, hour = 9) => new Date(Date.UTC(2026, 9, day, hour));

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const call = (path, { token, method = "GET", e = env } = {}) => handleAdmin(new Request(ORIGIN + path, { method, headers: token === null ? {} : { "Cf-Access-Jwt-Assertion": token || sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T, exp: T + 600 }) } }), e, {});
  const A = (await createOrganizationAudited(w.db, { slug: "alpha", name: "Alpha Co" }, ADMIN)).organization;
  const B = (await createOrganizationAudited(w.db, { slug: "bravo", name: "Bravo Co" }, ADMIN)).organization;
  const C = (await createOrganizationAudited(w.db, { slug: "gone", name: "Deleted Co" }, ADMIN)).organization;
  await w.invite(A, "ann@a.test", "owner"); await w.invite(B, "bob@b.test", "owner"); await w.invite(C, "cy@c.test", "owner");
  await w.browser().signIn(w.user(1, "ann@a.test")); await w.browser().signIn(w.user(2, "bob@b.test")); await w.browser().signIn(w.user(3, "cy@c.test"));
  const uid = (email) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(email).id;
  const branding = async (org, email, key, now, note = null) => { const r = await brand.createServiceRequest(w.db, org.id, uid(email), { serviceKey: key, note }, isKnownBrandingService, { now }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const support = async (org, email, input, now) => { const r = await sup.createRequest(w.db, org.id, uid(email), input, { now }); assert.ok(r.ok, JSON.stringify(r)); return r.id; };
  const get = async () => (await (await call("/api/admin/dashboard/requests")).json());
  return { w, call, A, B, C, branding, support, get };
}

test("the list is outstanding Branding and support or change requests of every live client, newest first, with the client, type, status, date and a total", async () => {
  const s = await setup();
  await s.branding(s.A, "ann@a.test", "brand-logos", at(20));
  await s.support(s.B, "bob@b.test", { category: "technical_issue", title: "Site is down", description: "SECRET MESSAGE TEXT" }, at(22));
  await s.branding(s.B, "bob@b.test", "brand-full-kit", at(24), "private note");
  await s.support(s.A, "ann@a.test", { category: "website_change", title: "New hours", description: "x" }, at(21));
  const d = await s.get();
  assert.equal(d.available, true);
  assert.deepEqual([d.requests.total, d.requests.branding, d.requests.support], [4, 2, 2]);
  assert.deepEqual(d.requests.items.map((r) => [r.orgName, r.type, r.statusLabel, r.createdAt.slice(0, 10)]), [
    ["Bravo Co", "Branding: Full Brand Kit", "New", "2026-10-24"],
    ["Bravo Co", "Support request: Technical issue", "New", "2026-10-22"],
    ["Alpha Co", "Change request: Website change", "New", "2026-10-21"],
    ["Alpha Co", "Branding: Logos", "New", "2026-10-20"],
  ], "newest first, across both sources");
  assert.deepEqual(new Set(d.requests.items.map((r) => r.kind)), new Set(["branding", "support"]));
  const text = JSON.stringify(d);
  assert.ok(!text.includes("SECRET MESSAGE TEXT") && !text.includes("private note"), "no message text and no client note");
  assert.ok(d.requests.items.every((r) => r.id && r.organizationId), "every item carries what its link needs");
});

test("closed and declined requests drop off the list and the count; an in-progress one stays; a new request or a status change shows on the next read", async () => {
  const s = await setup();
  const b1 = await s.branding(s.A, "ann@a.test", "brand-logos", at(20));
  const b2 = await s.branding(s.A, "ann@a.test", "brand-colours", at(21));
  const s1 = await s.support(s.A, "ann@a.test", { category: "general", title: "Hello", description: "x" }, at(22));
  const s2 = await s.support(s.B, "bob@b.test", { category: "general", title: "Declined soon", description: "x" }, at(23));
  assert.equal((await s.get()).requests.total, 4);
  await brand.updateServiceRequest(s.w.db, s.A.id, b1, { status: "closed", adminNote: null }, ADMIN);
  assert.deepEqual([(await s.get()).requests.total, (await s.get()).requests.branding], [3, 1], "a closed Branding request leaves the list");
  await brand.updateServiceRequest(s.w.db, s.A.id, b2, { status: "contacted", adminNote: null }, ADMIN);
  assert.deepEqual((await s.get()).requests.items.filter((r) => r.kind === "branding").map((r) => r.statusLabel), ["In progress"], "contacted is still outstanding");
  await brand.updateServiceRequest(s.w.db, s.A.id, b2, { status: "declined", adminNote: null }, ADMIN);
  assert.equal((await s.get()).requests.branding, 0, "a declined Branding request leaves the list");
  assert.ok((await sup.setRequestStatus(s.w.db, s.B.id, s2, "declined", ADMIN)).ok);
  assert.ok((await sup.setRequestStatus(s.w.db, s.A.id, s1, "in_progress", ADMIN)).ok);
  let d = await s.get();
  assert.deepEqual([d.requests.total, d.requests.items.map((r) => r.statusLabel)], [1, ["In progress"]]);
  assert.ok((await sup.setRequestStatus(s.w.db, s.A.id, s1, "completed", ADMIN)).ok);
  d = await s.get();
  assert.deepEqual([d.requests.total, d.requests.items.length], [0, 0]);
  await s.branding(s.B, "bob@b.test", "brand-typography", at(25));
  assert.equal((await s.get()).requests.total, 1, "a new request appears at once");
});

test("deleted clients are left out; the list is capped at ten while the total stays exact", async () => {
  const s = await setup();
  await s.branding(s.C, "cy@c.test", "brand-logos", at(20));
  await s.support(s.C, "cy@c.test", { category: "general", title: "Gone", description: "x" }, at(21));
  await archiveOrganizationAudited(s.w.db, s.C.id, ADMIN);
  assert.equal((await s.get()).requests.total, 0, "an archived client's requests are not counted");
  for (let i = 1; i <= 7; i++) await s.branding(s.A, "ann@a.test", ["brand-logos", "brand-colours", "brand-typography", "brand-guidelines", "brand-additional", "brand-full-kit", "business-card-design"][i - 1], at(i));
  for (let i = 8; i <= 13; i++) await s.support(s.B, "bob@b.test", { category: "general", title: "T" + i, description: "x" }, at(i, 8 + (i % 3)));
  const d = (await s.get()).requests;
  assert.deepEqual([d.total, d.items.length], [13, 10]);
  assert.deepEqual(d.items.map((r) => r.createdAt), [...d.items.map((r) => r.createdAt)].sort().reverse(), "newest first");
});

test("each source is independent: Branding alone is listed when Client Services' tables are not there; nothing at all gives null", async () => {
  const s = await setup();
  await s.branding(s.A, "ann@a.test", "brand-logos", at(20));
  s.w.db.raw.exec("PRAGMA foreign_keys = OFF; DROP TABLE support_messages; DROP TABLE support_attachments; DROP TABLE support_requests;");
  const d = (await s.get()).requests;
  assert.deepEqual([d.total, d.branding, d.support, d.items.length], [1, 1, 0, 1]);
  s.w.db.raw.exec("DROP TABLE service_requests;");
  assert.equal((await s.get()).requests, null);
  assert.equal((await (await s.call("/api/admin/dashboard")).json()).requests, null, "the main dashboard answer stays valid too");
});

test("admin-only, GET-only and read-only; the full dashboard carries the same part; the activity feed names a Branding request", async () => {
  const s = await setup();
  await s.branding(s.A, "ann@a.test", "brand-logos", at(20));
  for (const token of [null, "garbage"]) assert.ok([401, 403].includes((await s.call("/api/admin/dashboard/requests", { token })).status));
  assert.equal((await s.call("/api/admin/dashboard/requests", { method: "POST" })).status, 405);
  const before = JSON.stringify(s.w.db.raw.prepare("SELECT (SELECT count(*) FROM activity_log) a, (SELECT count(*) FROM service_requests) r").all());
  const full = await (await s.call("/api/admin/dashboard")).json();
  assert.equal(full.requests.total, 1);
  assert.equal(JSON.stringify(s.w.db.raw.prepare("SELECT (SELECT count(*) FROM activity_log) a, (SELECT count(*) FROM service_requests) r").all()), before, "nothing is written");
  assert.equal(ACTIVITY_LABELS["service.requested"], "Branding request submitted");
  assert.ok(full.activity.some((a) => a.label === "Branding request submitted" && a.orgName === "Alpha Co"));
});

test("the Overview section: count, newest-first rows linking to the right page, a quiet empty state, and a refresh that stops when the section leaves the page", () => {
  const src = read("admin/assets/overview.js");
  assert.match(src, /\/admin\/clients\/\$\{enc\(r\.organizationId\)\}\/branding/);
  assert.match(src, /\/admin\/support\/\$\{enc\(r\.organizationId\)\}\/\$\{enc\(r\.id\)\}/);
  assert.match(src, /quiet\("\/dashboard\/requests"\)/); assert.match(src, /visibilitychange/); assert.match(src, /isConnected/);
  assert.match(src, /h2", \{ id: "adm-req", text: "Client requests" \}/);
  assert.ok(src.indexOf("requestsEl, supportSection") > -1, "it leads the section grid");
  assert.equal(requestsSection(null), null, "no data, no section");
  const css = read("admin/assets/admin.css");
  assert.match(css, /\.adm-dash__sec--wide \{ grid-column: 1 \/ -1; \}/);
});
