// Admin "Delete client": a reversible archive. Driven end to end through the real Admin API and the real portal router with live sessions.
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import * as inv from "../portal/repo/invoices.js";
import * as sup from "../portal/repo/support.js";
import { processNotifications } from "../portal/service-notifications.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const T0 = Math.floor(Date.now() / 1000);

async function setup({ writes = true } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("bravo", "Bravo Co");
  await w.invite(A, "ann@a.test", "owner");
  await w.invite(B, "bob@b.test", "owner");
  const ann = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@a.test"));
  await bob.signIn(w.user(2, "bob@b.test"));
  const annId = sql(w.db, "SELECT id FROM portal_users WHERE email = 'ann@a.test'")[0].id;
  assert.ok((await saveProfileStep(w.db, A.id, annId, "business", { legal: "Alpha Co Ltd.", operating: "Alpha" })).ok);
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), ...(writes ? { PORTAL_ADMIN_WRITES: "1" } : {}) };
  const call = (path, { method = "POST", json = {}, headers = {}, token } = {}) => {
    const t = token === undefined ? sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T0, exp: T0 + 600 }) : token;
    const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
    if (t) h["Cf-Access-Jwt-Assertion"] = t;
    return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: method === "GET" ? undefined : JSON.stringify(json) }), env, { fetch: async () => { throw new Error("no network"); } });
  };
  const del = (org, json = { confirm: "DELETE" }, opts) => call(`/api/admin/clients/${org.id}/delete`, { json, ...opts });
  const restore = (org, opts) => call(`/api/admin/clients/${org.id}/restore`, { json: {}, ...opts });
  return { w, A, B, ann, bob, annId, call, del, restore, env };
}
const orgRow = (s, o) => sql(s.w.db, "SELECT status, archived_at FROM organizations WHERE id = ?", o.id)[0];
const audit = (s, o) => sql(s.w.db, "SELECT actor_type, actor_ref, action FROM activity_log WHERE organization_id = ? AND action LIKE 'org.%' ORDER BY created_at, rowid", o.id);

test("deleting needs the typed word on the SERVER: no body, wrong case, wrong word and extra fields change nothing", async () => {
  const s = await setup();
  for (const json of [{}, { confirm: "delete" }, { confirm: "Delete" }, { confirm: " DELETE" }, { confirm: true }, { confirm: "DELETE", extra: 1 }]) {
    const r = await s.del(s.A, json);
    assert.ok([400, 422].includes(r.status), JSON.stringify(json));
  }
  assert.deepEqual(orgRow(s, s.A), { status: "active", archived_at: null });
  assert.equal(audit(s, s.A).filter((a) => a.action === "org.deleted").length, 0);
});

test("authorization, writes switch and CSRF apply to delete and restore", async () => {
  const off = await setup({ writes: false });
  assert.equal((await off.del(off.A)).status, 403);
  assert.equal((await off.restore(off.A)).status, 403);
  const s = await setup();
  for (const opts of [{ token: null }, { token: "garbage" }, { headers: { Origin: "https://evil.example" } }, { headers: { "X-Framework-Admin": "0" } }, { headers: { "Content-Type": "text/plain" } }]) {
    const r = await s.del(s.A, { confirm: "DELETE" }, opts);
    assert.ok([401, 403, 415].includes(r.status), JSON.stringify(opts));
  }
  assert.equal((await s.call(`/api/admin/clients/${s.A.id}/delete`, { method: "GET" })).status, 405);
  assert.equal((await s.call(`/api/admin/clients/not-a-uuid/delete`, { json: { confirm: "DELETE" } })).status, 404);
  assert.equal((await s.call(`/api/admin/clients/00000000-0000-4000-8000-000000000000/delete`, { json: { confirm: "DELETE" } })).status, 404);
  assert.deepEqual(orgRow(s, s.A), { status: "active", archived_at: null });
});

test("delete revokes portal access at once, keeps every record, leaves other clients alone, and restore brings it all back", async () => {
  const s = await setup();
  const keep = ["memberships", "business_profile_answers", "portal_users", "invitations"];
  const snap = () => JSON.stringify(keep.map((t) => sql(s.w.db, `SELECT * FROM ${t} ORDER BY 1, 2`)));
  const cInvoice = await inv.createInvoice(s.w.db, s.A.id, { invoiceNumber: "FW-1", issueDate: "2026-10-01", amount: "100" }, "admin@framework.test");
  const before = snap();
  assert.equal((await s.ann.get("/portal/o/alpha/profile/business")).status, 200);

  const r = await s.del(s.A);
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.equal(body.deleted, true);
  assert.equal(body.changed, true);
  const row = orgRow(s, s.A);
  assert.equal(row.status, "archived");
  assert.ok(row.archived_at);

  // access is gone on the very next request; the other client is untouched
  const gone = await s.ann.get("/portal/o/alpha/profile/business");
  assert.notEqual(gone.status, 200);
  assert.ok(!(await gone.text()).includes("Alpha Co Ltd."));
  assert.equal((await s.bob.get("/portal/o/bravo/profile/business")).status, 200);

  // nothing was removed
  assert.equal(snap(), before);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM invoices WHERE organization_id = ?", s.A.id)[0].n, 1);
  assert.equal(orgRow(s, s.B).status, "active");

  // a second delete is harmless and leaves one audit entry
  const again = await s.del(s.A);
  assert.equal(again.status, 200);
  assert.equal((await again.json()).changed, false);
  assert.deepEqual(audit(s, s.A).filter((a) => a.action === "org.deleted"), [{ actor_type: "admin", actor_ref: ADMIN, action: "org.deleted" }]);

  // the Admin list still shows it, marked as deleted; the detail too
  const list = await (await s.call("/api/admin/clients", { method: "GET" })).json();
  const mine = list.clients.find((c) => c.id === s.A.id);
  assert.equal(mine.status, "archived");
  assert.ok(mine.archived_at);

  // restore
  const rr = await s.restore(s.A);
  assert.equal(rr.status, 200);
  assert.deepEqual(orgRow(s, s.A), { status: "active", archived_at: null });
  assert.equal((await s.ann.get("/portal/o/alpha/profile/business")).status, 200);
  assert.equal(snap(), before);
  assert.equal((await (await s.restore(s.A)).json()).changed, false, "restoring an active client is a harmless no-op");
  assert.deepEqual(audit(s, s.A).map((a) => a.action), ["org.deleted", "org.restored"]);
  assert.ok(cInvoice);
});

test("a deleted client cannot be invited to, and is left out of the global Admin counts and lists, and is not emailed", async () => {
  const s = await setup();
  const r = await s.del(s.A);
  assert.equal(r.status, 200);
  const invite = await s.call(`/api/admin/clients/${s.A.id}/invitations`, { json: { email: "new@a.test", role: "member" } });
  assert.ok([403, 409].includes(invite.status), `invite -> ${invite.status}`);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM invitations WHERE organization_id = ? AND email = 'new@a.test'", s.A.id)[0].n, 0);
  // global Admin counts and lists
  const bobId = sql(s.w.db, "SELECT id FROM portal_users WHERE email = 'bob@b.test'")[0].id;
  await s.restore(s.A);
  const ra = await sup.createRequest(s.w.db, s.A.id, s.annId, { category: "technical_issue", title: "A problem", description: "x" });
  const rb = await sup.createRequest(s.w.db, s.B.id, bobId, { category: "technical_issue", title: "B problem", description: "x" });
  assert.ok(ra.ok && rb.ok);
  await inv.createInvoice(s.w.db, s.A.id, { invoiceNumber: "FW-9", issueDate: "2026-10-01", amount: "5" }, "admin@framework.test");
  assert.equal((await sup.adminSupportTotals(s.w.db)).total, 2);
  assert.equal((await inv.adminInvoiceTotals(s.w.db)).drafts, 1);
  await s.del(s.A);
  assert.equal((await sup.adminSupportTotals(s.w.db)).total, 1);
  assert.deepEqual((await sup.listRequestsAllAdmin(s.w.db, { scope: "all" })).map((r) => r.orgName), ["Bravo Co"]);
  assert.equal((await inv.adminInvoiceTotals(s.w.db)).drafts, 0);

  // a queued email for a deleted client is skipped, never sent
  sql(s.w.db, "INSERT INTO service_notifications (id, organization_id, audience, event, entity_type, entity_id, created_at) VALUES (?, ?, 'staff', 'request_submitted', 'support_request', ?, ?)", crypto.randomUUID(), s.A.id, ra.id, new Date().toISOString());
  const sent = [];
  await processNotifications({ ...s.w.env, RESEND_API_KEY: "re_test_FAKE", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "staff@framework.test" }, { db: s.w.db, fetch: async (u) => { sent.push(String(u)); return new Response("{}", { status: 200 }); } });
  assert.equal(sent.length, 1, "only the other client's queued email goes out");
  const left = sql(s.w.db, "SELECT status, last_error FROM service_notifications WHERE organization_id = ?", s.A.id);
  assert.ok(left.length >= 1);
  assert.ok(left.every((n) => n.status === "skipped" && n.last_error === "client_deleted"), JSON.stringify(left));
});

test("the interface: Confirm Delete starts disabled and needs the typed word, Enter cannot confirm, the request is sent only after confirmation, and nothing is injected as HTML", async () => {
  const { readFileSync } = await import("node:fs");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ui = strip(readFileSync(new URL("../../admin/assets/clients-delete.js", import.meta.url), "utf8"));
  assert.match(ui, /disabled: true \}, "Confirm Delete"/, "Confirm Delete starts disabled");
  assert.match(ui, /confirm\.disabled = input\.value !== WORD/);
  assert.match(ui, /dialog\.returnValue === "confirm" && input\.value === WORD/, "re-checked at close");
  assert.match(ui, /e\.key === "Enter"\) e\.preventDefault\(\)/);
  assert.ok(ui.indexOf("await deleteDialog") < ui.indexOf('"delete"'), "the dialog comes before the request");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(ui));
  const clients = strip(readFileSync(new URL("../../admin/assets/clients.js", import.meta.url), "utf8"));
  assert.ok(!/\bapi\([^)]*\/delete|\bapi\([^)]*\/restore/.test(clients), "the page only goes through the confirmation helpers");
});

test("a deleted client's EXISTING signed-in sessions lose every page and every write on the very next request, and nothing they could replay changes data; restore brings the same sessions back", async () => {
  const s = await setup();
  // a second organization for the same person, so "still signed in" can be told apart from "signed out"
  await s.w.invite(s.B, "ann@a.test", "member");
  assert.equal((await s.w.browser().signIn(s.w.user(1, "ann@a.test"))).status, 303); // activates the Bravo invitation; the existing session below is the one under test
  const profilePage = await (await s.ann.get("/portal/o/alpha/profile/business")).text();
  const csrf = csrfOf(profilePage);
  assert.ok(csrf && profilePage.includes("Alpha Co Ltd."));
  const stable = ["business_profile_answers", "portal_feedback", "projects", "invoices", "support_requests", "memberships", "portal_users"];
  const snap = () => JSON.stringify(stable.map((t) => sql(s.w.db, `SELECT * FROM ${t} ORDER BY 1`)));
  const before = snap();
  const sessionsBefore = sql(s.w.db, "SELECT count(*) AS n FROM portal_sessions WHERE revoked_at IS NULL")[0].n;

  assert.equal((await s.del(s.A)).status, 200);

  const routes = ["", "/progress", "/profile", "/profile/business", "/projects", "/activity", "/documents", "/account", "/members", "/feedback", "/branding", "/services", "/services/invoices", "/services/requests", "/services/requests/new"];
  for (const r of routes) {
    const res = await s.ann.get("/portal/o/alpha" + r);
    assert.equal(res.status, 404, "GET " + r);
    assert.ok(!(await res.text()).includes("Alpha Co"), "no Alpha data on " + r);
  }
  const post = (path, fields) => s.ann.post(path, { csrf, ...fields });
  for (const [path, fields] of [["/portal/o/alpha/profile/business", { legal: "HIJACKED", operating: "X" }], ["/portal/o/alpha/feedback", { kind: "problem", message: "still here?" }], ["/portal/o/alpha/account", { name: "Hijack" }], ["/portal/o/alpha/services/requests", { category: "general", title: "Hijack", description: "x" }]]) {
    assert.equal((await post(path, fields)).status, 404, "POST " + path);
  }
  assert.equal(snap(), before, "no record changed and the replayed writes wrote nothing");
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM portal_sessions WHERE revoked_at IS NULL")[0].n, sessionsBefore, "sessions are not revoked: access is decided on every request");
  // the same session still reaches the person's OTHER organization
  assert.equal((await s.ann.get("/portal/o/bravo")).status, 200);
  assert.equal((await s.ann.get("/portal")).headers.get("Location"), "/portal/o/bravo", "the picker offers only the organization still available");
  // a deleted client looks exactly like one that does not exist
  const strip = (h) => h.replace(/\b[A-Z0-9]{8}\b/g, "REF");
  assert.equal(strip(await (await s.ann.get("/portal/o/alpha")).text()), strip(await (await s.ann.get("/portal/o/no-such-org")).text()));
  // a fresh sign-in does not reopen it either
  const again = s.w.browser();
  await again.signIn(s.w.user(1, "ann@a.test"));
  assert.equal((await again.get("/portal/o/alpha")).status, 404);

  // retained records are all still in place
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM business_profile_answers WHERE organization_id = ?", s.A.id)[0].n > 0, true);
  assert.equal(sql(s.w.db, "SELECT count(*) AS n FROM memberships WHERE organization_id = ? AND status = 'active'", s.A.id)[0].n, 1);

  // restore: the original session works again, with the original data
  assert.equal((await s.restore(s.A)).status, 200);
  assert.equal((await s.ann.get("/portal/o/alpha")).status, 200);
  assert.ok((await (await s.ann.get("/portal/o/alpha/profile/business")).text()).includes("Alpha Co Ltd."));
  assert.equal(snap(), before);
});

test("the Clients list has no navigation arrow: the row is the link and the three-dot menu sits beside it", async () => {
  const { readFileSync } = await import("node:fs");
  const js = readFileSync(new URL("../../admin/assets/clients.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../admin/assets/admin.css", import.meta.url), "utf8");
  assert.ok(!/ARROW|clientrow__arrow/.test(js + css));
  assert.match(js, /h\("li", \{ class: "adm-clientitem" \}, clientRow\(c\),\s*writes \? actionsMenu/);
});
