/* GET /api/admin/activity and POST /api/admin/activity/state: the client activity feed from real portal events, with read and dismissed state kept as append-only marks (no new table); history is never deleted, nothing is invented, nothing leaks to clients. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";

import { recordActivity, listActivity } from "../portal/repo/activity.js";

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
  const call = async (path, { method = "GET", auth = true, body } = {}) => {
    const h = { Origin: ORIGIN, ...(auth ? { "Cf-Access-Jwt-Assertion": sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: nowS(), exp: nowS() + 600 }) } : {}), ...(method !== "GET" ? { "X-Framework-Admin": "1" } : {}) };
    const res = await handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: body ? { ...h, "Content-Type": "application/json" } : h, body: body ? JSON.stringify(body) : undefined }), w.env, {});
    return { status: res.status, json: (res.headers.get("Content-Type") || "").includes("json") ? await res.json() : null };
  };
  const ev = async (org, action, entityId, at, actorType = "client") => (await recordActivity(w.db, { organizationId: org.id, actorType, actorRef: "u1", action, entityType: "x", entityId, visibility: "internal" }, { now: new Date(at) })).id;
  return { w, A, B, call, ev };
}


const NOW = () => Date.now();
const iso = (minAgo) => new Date(NOW() - minAgo * 60000).toISOString();
const SUP = "0f6d3f7a-1111-4a11-8111-111111111111";

test("feed: only client events from the allow-list, newest first, with client, action, time, destination and kind; nothing invented; bursts grouped", async () => {
  const s = await setup();
  const a = await s.ev(s.A, "support.request.created", SUP, iso(5));
  await s.ev(s.A, "brand.upload.created", "f1", iso(20)); await s.ev(s.A, "brand.upload.created", "f2", iso(24)); await s.ev(s.A, "brand.upload.created", "f3", iso(26));
  await s.ev(s.B, "feedback.submitted", "fb", iso(60));
  await s.ev(s.A, "invoice.published", "i1", iso(2), "admin"); // a staff action: not in the feed
  await s.ev(s.A, "auth.signed_in", "s", iso(3));              // a sign-in: not in the feed
  await s.ev(s.A, "support.message.client", SUP, iso(60 * 24 * 40)); // older than 30 days: not shown
  const r = await s.call("/activity");
  assert.equal(r.status, 200); assert.equal(r.json.available, true);
  assert.deepEqual(r.json.events.map((e) => e.action), ["support.request.created", "brand.upload.created", "feedback.submitted"]);
  const [sup, up, fb] = r.json.events;
  assert.equal(sup.id, a); assert.equal(sup.clientName, "Alpha Co"); assert.equal(sup.kind, "action"); assert.equal(sup.href, `/admin/support/${s.A.id}/${SUP}`); assert.equal(sup.state, "new");
  assert.equal(up.count, 3, "three uploads in a row are one entry"); assert.equal(up.kind, "info"); assert.equal(up.href, `/admin/clients/${s.A.id}/branding`);
  assert.equal(fb.clientName, "Beta Co");
  assert.equal(r.json.unread, 3); assert.equal(r.json.actionNeeded, 1);
  assert.ok(!JSON.stringify(r.json).includes("u1"), "no user reference");
});

test("state: read and dismissed persist across requests, never delete the history, can be undone, and never reach a client", async () => {
  const s = await setup();
  const a = await s.ev(s.A, "support.request.created", SUP, iso(5)), b = await s.ev(s.A, "request.created", SUP, iso(4));
  let r = await s.call("/activity/state", { method: "POST", body: { scope: "event", ids: [a], state: "read" } });
  assert.equal(r.status, 200); assert.equal(r.json.marked, 1);
  r = await s.call("/activity/state", { method: "POST", body: { scope: "event", ids: [b], state: "dismissed" } });
  let feed = (await s.call("/activity")).json;
  assert.equal(feed.events.find((e) => e.id === a).state, "read"); assert.equal(feed.events.find((e) => e.id === b).state, "dismissed");
  assert.equal(feed.unread, 0);
  assert.equal(feed.events.length, 2, "dismissed activity stays in the history");
  await s.call("/activity/state", { method: "POST", body: { scope: "event", ids: [a], state: "unread" } });
  assert.equal((await s.call("/activity")).json.events.find((e) => e.id === a).state, "new");
  const count = (act) => s.w.db.raw.prepare("SELECT COUNT(*) AS n FROM activity_log WHERE action = ?").get(act).n;
  assert.equal(count("support.request.created"), 1, "the events themselves are untouched");
  const clientView = await listActivity(s.w.db, s.A.id, { limit: 50, clientVisibleOnly: false });
  assert.ok(!clientView.some((x) => x.action.startsWith("admin.")), "marks belong to no client");
  // an id that is not a feed event is refused quietly; bad input is refused
  assert.equal((await s.call("/activity/state", { method: "POST", body: { scope: "event", ids: ["not-an-id"], state: "read" } })).status, 422);
  assert.equal((await s.call("/activity/state", { method: "POST", body: { scope: "event", ids: [a], state: "delete" } })).status, 422);
});

test("attention dismissals persist per key and fingerprint: the same issue stays dismissed, a new occurrence (new fingerprint) is the UI's cue to show it again", async () => {
  const s = await setup();
  let r = await s.call("/activity/state", { method: "POST", body: { scope: "attention", key: "invoices.overdue", fingerprint: "2|inv-9", state: "dismissed" } });
  assert.equal(r.status, 200);
  assert.deepEqual((await s.call("/activity")).json.attention.dismissed, { "invoices.overdue": "2|inv-9" });
  await s.call("/activity/state", { method: "POST", body: { scope: "attention", key: "invoices.overdue", fingerprint: "3|inv-12", state: "dismissed" } });
  assert.deepEqual((await s.call("/activity")).json.attention.dismissed, { "invoices.overdue": "3|inv-12" }, "the newest mark wins");
  await s.call("/activity/state", { method: "POST", body: { scope: "attention", key: "invoices.overdue", state: "restored" } });
  assert.deepEqual((await s.call("/activity")).json.attention.dismissed, {});
  assert.equal((await s.call("/activity/state", { method: "POST", body: { scope: "attention", key: "BAD KEY", state: "dismissed" } })).status, 422);
});

test("auth and method rules: admin only, writes need the writes flag and the same-origin header, GET is read-only", async () => {
  const s = await setup();
  assert.notEqual((await s.call("/activity", { auth: false })).status, 200);
  assert.equal((await s.call("/activity", { method: "POST" })).status, 405);
  assert.equal((await s.call("/activity/state")).status, 405);
  s.w.env.PORTAL_ADMIN_WRITES = "0";
  assert.equal((await s.call("/activity/state", { method: "POST", body: { scope: "attention", key: "a.b", state: "dismissed" } })).status, 403);
});
