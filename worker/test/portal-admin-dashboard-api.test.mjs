// Admin Overview dashboard data: live counts and short lists across clients, support, invoices and activity; admin-only; read-only; deleted clients left out; no client
// text (answers, messages, file names) and no contact addresses in the answer; each part independent.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import * as inv from "../portal/repo/invoices.js";
import * as sup from "../portal/repo/support.js";
import { createOrganizationAudited, archiveOrganizationAudited } from "../portal/repo/orgs.js";
import { saveProfileStep } from "../portal/repo/business-profile.js";
import { ACTIVITY_LABELS } from "../portal/admin-dashboard.js";
import { attentionItems, ago } from "../../admin/assets/overview.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const T = Math.floor(Date.now() / 1000);
const NOW = new Date();

async function setup() {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }) };
  const call = (path = "/api/admin/dashboard", { token, method = "GET" } = {}) => handleAdmin(new Request(ORIGIN + path, { method, headers: (token === null ? {} : { "Cf-Access-Jwt-Assertion": token || sign({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", iat: T, exp: T + 600 }) }) }), env, { now: NOW });
  return { w, env, call };
}

test("the dashboard is admin-only, GET-only and writes nothing", async () => {
  const s = await setup();
  for (const token of [null, "garbage"]) assert.ok([401, 403].includes((await s.call("/api/admin/dashboard", { token })).status));
  assert.equal((await s.call("/api/admin/dashboard", { method: "POST" })).status, 405);
  const before = JSON.stringify(s.w.db.raw.prepare("SELECT count(*) AS n FROM activity_log").all());
  assert.equal((await s.call()).status, 200);
  assert.equal(JSON.stringify(s.w.db.raw.prepare("SELECT count(*) AS n FROM activity_log").all()), before);
});

test("live numbers and lists: clients, people, invitations, profile completion, support, invoices and curated activity; deleted clients are left out of everything", async () => {
  const s = await setup();
  const A = (await createOrganizationAudited(s.w.db, { slug: "alpha", name: "Alpha Co" }, "owner@frameworkco.ca")).organization;
  const B = (await createOrganizationAudited(s.w.db, { slug: "bravo", name: "Bravo Co" }, "owner@frameworkco.ca")).organization;
  const C = (await createOrganizationAudited(s.w.db, { slug: "gone", name: "Deleted Co" }, "owner@frameworkco.ca")).organization;
  await s.w.invite(A, "ann@a.test", "owner");
  const ann = s.w.browser(); await ann.signIn(s.w.user(1, "ann@a.test"));
  const annId = s.w.db.raw.prepare("SELECT id FROM portal_users WHERE email = 'ann@a.test'").get().id;
  await saveProfileStep(s.w.db, A.id, annId, "business", { legal: "Alpha Co Ltd.", operating: "Alpha" });
  // support, invoices on A; the same on the deleted client C
  const req = await sup.createRequest(s.w.db, A.id, annId, { category: "technical_issue", title: "Site is down", description: "SECRET MESSAGE TEXT" });
  assert.ok(req.ok);
  const mk = async (org, number, due, publish) => { const c = await inv.createInvoice(s.w.db, org.id, { invoiceNumber: number, issueDate: "2020-01-01", dueDate: due, amount: "100" }, "owner@frameworkco.ca"); if (publish) { await inv.setInvoiceFile(s.w.db, org.id, c.id, { ext: "pdf", contentType: "application/pdf", size: 5, sha256: "a".repeat(64), storageKey: `org/${org.id}/invoices/${crypto.randomUUID()}` }, "owner@frameworkco.ca"); await inv.publishInvoice(s.w.db, org.id, c.id, "owner@frameworkco.ca"); } return c.id; };
  await mk(A, "FW-1", "2020-02-01", true);     // overdue
  await mk(A, "FW-2", "2999-01-01", true);     // outstanding, not due
  await mk(A, "FW-3", "2999-01-01", false);    // draft
  await mk(C, "GONE-1", "2020-02-01", true);   // would be overdue, but the client is deleted
  await sup.createRequest(s.w.db, C.id, annId, { category: "technical_issue", title: "Gone request", description: "x" });
  await archiveOrganizationAudited(s.w.db, C.id, "owner@frameworkco.ca");
  s.w.db.raw.prepare("INSERT INTO invitations (id, organization_id, email, role, status, created_at, created_by, expires_at) VALUES (?, ?, ?, 'member', 'pending', ?, 'x', ?)").run(crypto.randomUUID(), A.id, "lapsed@a.test", "2020-01-01T00:00:00.000Z", "2020-01-08T00:00:00.000Z");

  const d = await (await s.call()).json();
  assert.equal(d.available, true);
  assert.deepEqual([d.clients.active, d.clients.deleted, d.clients.people, d.clients.lapsedInvitations], [2, 1, 1, 1]);
  assert.deepEqual(d.clients.withoutAccess.map((c) => c.name), ["Bravo Co"], "only a live client without anyone is listed");
  assert.equal(d.clients.profile.total, 2);
  assert.ok(Number.isInteger(d.clients.profile.avgPercent) && d.clients.profile.incomplete === 2, "a started but unfinished profile counts as not finished");
  assert.deepEqual([d.support.open, d.support.items.length, d.support.items[0].orgName, d.support.items[0].title], [1, 1, "Alpha Co", "Site is down"], "the deleted client's request is not counted");
  assert.deepEqual([d.invoices.drafts, d.invoices.overdue, d.invoices.outstandingCount, d.invoices.outstandingCents], [1, 1, 2, 20000]);
  assert.deepEqual(d.invoices.overdueItems.map((r) => [r.orgName, r.number, r.cents]), [["Alpha Co", "FW-1", 10000]]);
  const labels = d.activity.map((a) => a.label);
  assert.ok(labels.includes("Client added") && labels.includes("Joined the portal") && labels.includes("Invoice published") && labels.includes("Support request submitted"), labels.join());
  assert.ok(!d.activity.some((a) => a.orgName === "Deleted Co"), "no activity of a deleted client");
  assert.equal(d.activity.filter((a) => a.label === "Client added").length, 2, "a burst of the same event for one client is one line each");
  const text = JSON.stringify(d);
  assert.ok(!/SECRET MESSAGE TEXT|ann@a\.test|lapsed@a\.test|Alpha Co Ltd\./.test(text), "no message text, address or answer is in the dashboard data");
  assert.ok(!/storage|org\//.test(text.replace(/organizationId/g, "")));
  // the attention list ranks failures first and links somewhere useful
  const items = attentionItems({ dash: d, services: { emails: { failed: 1, pending: 2 } }, assess: { unsent: 1 }, feedback: { stats: { unreviewed: 3 } } });
  assert.deepEqual(items.map((i) => i.tone).slice(0, 4), ["bad", "bad", "bad", "warn"]);
  assert.ok(items.every((i) => i.href.startsWith("/admin/") && i.text && i.label));
  assert.equal(attentionItems({ dash: null, services: null, assess: null, feedback: null }).length, 0);
});

test("a database missing a part's tables leaves that part null and the rest intact; activity labels are an explicit allow-list", async () => {
  const s = await setup();
  await createOrganizationAudited(s.w.db, { slug: "alpha", name: "Alpha Co" }, "owner@frameworkco.ca");
  s.w.db.raw.exec("DROP TABLE service_notifications; DROP TABLE support_attachments; DROP TABLE support_messages; DROP TABLE support_requests; DROP TABLE invoices");
  const d = await (await s.call()).json();
  assert.equal(d.support, null);
  assert.equal(d.invoices, null);
  assert.equal(d.clients.active, 1);
  assert.ok(Array.isArray(d.activity));
  for (const a of ["auth.signed_in", "profile.view", "org.view", "invoice.download", "brand.asset.download"]) assert.ok(!(a in ACTIVITY_LABELS), a + " is never shown");
  assert.equal(ago(new Date(Date.now() - 5 * 60000).toISOString()), "5 min ago");
  assert.equal(ago("not a date"), "");
});

test("the Overview page: loads each part independently, no HTML injection, no null children, Testimonials is gone from the navigation", () => {
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const ui = strip(readFileSync(new URL("../../admin/assets/overview.js", import.meta.url), "utf8"));
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(ui));
  assert.match(ui, /Promise\.all\(\[quiet\("\/dashboard"\), quiet\("\/overview"\), quiet\("\/services\/attention"\), quiet\("\/assessments\/summary"\)\]\)/);
  assert.match(ui, /\]\.filter\(Boolean\),\n/, "optional parts are filtered out before they reach the DOM");
  const modules = readFileSync(new URL("../../admin/assets/modules.js", import.meta.url), "utf8");
  assert.ok(!/testimonials/i.test(modules), "Testimonials is removed from Coming later (Client Feedback covers it)");
  for (const id of ["projects", "leads", "settings"]) assert.match(modules, new RegExp(`id: "${id}"[^\\n]*enabled: false`), id + " stays registered but hidden until it is built");
  for (const id of ["files", "changes"]) assert.ok(!new RegExp(`id: "${id}"`).test(modules), id + " is removed (covered by Branding/Invoices/Support and Support Requests)");
  const shell = strip(readFileSync(new URL("../../admin/assets/admin.js", import.meta.url), "utf8"));
  assert.ok(!/Coming later|adm-nav__later/.test(shell), "no Coming later heading and no placeholder links");
  assert.match(shell, /MODULES\.filter\(\(m\) => m\.enabled\)/);
});
