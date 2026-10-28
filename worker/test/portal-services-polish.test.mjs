/* Release 3 polish (Staging): (1) an Admin Overview warning when client notifications were skipped because a recipient is not approved (organization and addresses,
   no content), which clears itself once they are approved or is dismissed; (2) the invoice page's manual-payment wording; (3) overdue measured in America/Edmonton;
   (4) the quote wording that says how a client approves. The Approved Emails restrictions themselves are untouched. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { handleDashboardApi } from "../portal/admin-dashboard.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as sup from "../portal/repo/support.js";
import * as inv from "../portal/repo/invoices.js";
import { archiveOrganizationAudited } from "../portal/repo/orgs.js";
import { addApproved } from "../portal/repo/approved-emails.js";
import { processNotifications, unapprovedSkips } from "../portal/service-notifications.js";
import { attentionItems } from "../../admin/assets/overview.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca", ADMIN = "owner@frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const T = () => Math.floor(Date.now() / 1000);
const sign = (c) => { const h = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), p = b64u(JSON.stringify(c)); return `${h}.${p}.${b64u(createSign("RSA-SHA256").update(h + "." + p).sign(pair.privateKey))}`; };
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

async function setup({ approved = "someone-else@example.test" } = {}) {
  resetKeyCacheForTests();
  const w = await makeWorld();
  const A = await w.org("alpha", "Alpha Co"), B = await w.org("beta", "Beta Co");
  await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member"); await w.invite(B, "bob@beta.test", "owner");
  Object.assign(w.env, { PORTAL_FILES: fakeR2(), PORTAL_SERVICES: "1", PORTAL_ADMIN_WRITES: "1", ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: ADMIN, ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }),
    RESEND_API_KEY: "re_test_key", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "staff@framework.test", PORTAL_INVITE_ALLOWLIST: approved });
  const mail = [];
  const fetch = async (url, init) => { if (String(url).startsWith("https://api.resend.com")) { const b = JSON.parse(init.body); mail.push({ to: b.to[0], subject: b.subject, text: b.text }); return new Response("{}", { status: 200 }); } throw new Error("no network: " + url); };
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const uid = (e) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(e).id;
  const call = (path, { method = "GET", token, json, e = w.env, origin = ORIGIN, csrfHeader = true } = {}) => handleAdmin(new Request(ORIGIN + "/api/admin" + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(method !== "GET" && csrfHeader ? { "X-Framework-Admin": "1", "Content-Type": "application/json" } : {}), ...(token === null ? {} : { "Cf-Access-Jwt-Assertion": token || sign({ iss: `https://${TEAM}`, aud: [AUD], email: ADMIN, iat: T(), exp: T() + 600 }) }) }, body: json === undefined ? undefined : JSON.stringify(json) }), e, { fetch });
  // a client request from an owner, then a Framework reply: this queues a client notice
  const reply = async (org, email, title = "SECRET REQUEST TITLE") => { const r = await sup.createRequest(w.db, org.id, uid(email), { category: "general", title, description: "SECRET DESCRIPTION" }); assert.ok(r.ok); await sup.addStaffMessage(w.db, org.id, r.id, "SECRET STAFF REPLY", ADMIN); return r.id; };
  const send = () => processNotifications(w.env, { db: w.db, fetch });
  const attention = async () => (await (await call("/services/attention")).json());
  return { w, A, B, ann, mia, bob, uid, call, reply, send, attention, mail };
}

test("a client notice with nobody approved is skipped and the Overview data names the organization and the addresses that are not approved, with no content", async () => {
  const s = await setup();
  await s.reply(s.A, "ann@alpha.test");
  const r = await s.send();
  assert.equal(r.skipped >= 1, true);
  assert.deepEqual(s.mail.filter((m) => m.to !== "staff@framework.test"), [], "nothing went to the unapproved client");
  const a = await s.attention();
  assert.deepEqual(a.emails.unapproved.map((o) => [o.orgName, o.notices, o.recipients]), [["Alpha Co", 1, ["ann@alpha.test"]]]);
  const text = JSON.stringify(a);
  for (const secret of ["SECRET REQUEST TITLE", "SECRET DESCRIPTION", "SECRET STAFF REPLY"]) assert.ok(!text.includes(secret), "no private content: " + secret);
});

test("approving the address resolves the warning by itself; a notice that reached at least one approved recipient is never flagged", async () => {
  const s = await setup();
  await s.reply(s.A, "ann@alpha.test"); await s.send();
  assert.equal((await s.attention()).emails.unapproved.length, 1);
  assert.ok((await addApproved(s.w.db, "ann@alpha.test", ADMIN)).ok);
  assert.deepEqual((await s.attention()).emails.unapproved, [], "resolved: every address is approved now");
  // approved owner + unapproved owner: the notice is sent to the approved one, so nothing is skipped or flagged
  const s2 = await setup({ approved: "ann@alpha.test" });
  s2.w.db.raw.prepare("UPDATE memberships SET role = 'owner' WHERE organization_id = ? AND user_id = ?").run(s2.A.id, s2.uid("mia@alpha.test")); // mia becomes a second owner, not approved
  await s2.reply(s2.A, "ann@alpha.test"); await s2.send();
  assert.deepEqual(s2.mail.map((m) => m.to).filter((t) => t !== "staff@framework.test"), ["ann@alpha.test"]);
  assert.deepEqual((await s2.attention()).emails.unapproved, []);
});

test("a partially approved organization lists only the addresses still missing", async () => {
  const s = await setup();
  s.w.db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, 'owner', 'active', ?, 'seed')").run(crypto.randomUUID(), s.B.id, s.uid("mia@alpha.test"), new Date().toISOString());
  await s.reply(s.B, "bob@beta.test"); await s.send();
  assert.deepEqual((await s.attention()).emails.unapproved[0].recipients.sort(), ["bob@beta.test", "mia@alpha.test"]);
  await addApproved(s.w.db, "bob@beta.test", ADMIN);
  assert.deepEqual((await s.attention()).emails.unapproved[0].recipients, ["mia@alpha.test"]);
});

test("dismiss: clears the warning for one organization only, sends nothing, is audited, and the restrictions stay as they were", async () => {
  const s = await setup();
  await s.reply(s.A, "ann@alpha.test"); await s.reply(s.B, "bob@beta.test"); await s.send();
  assert.equal((await s.attention()).emails.unapproved.length, 2);
  const mailBefore = s.mail.length;
  const res = await s.call("/services/notifications/dismiss", { method: "POST", json: { organization_id: s.A.id } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual([body.ok, body.dismissed, body.emails.unapproved.map((o) => o.orgName)], [true, 1, ["Beta Co"]]);
  assert.equal(s.mail.length, mailBefore, "dismissing never sends");
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM service_notifications WHERE last_error = 'no_allowed_recipient_dismissed'").get().n, 1);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM activity_log WHERE action = 'service.notice.dismissed' AND organization_id = ? AND actor_ref = ?").get(s.A.id, ADMIN).n, 1);
  assert.equal(JSON.parse((s.w.db.raw.prepare("SELECT detail FROM activity_log WHERE action = 'service.notice.dismissed'").get()).detail).notices, 1);
  // dismissing again changes nothing; a new skip for the same organization warns again
  assert.equal((await (await s.call("/services/notifications/dismiss", { method: "POST", json: { organization_id: s.A.id } })).json()).dismissed, 0);
  await s.reply(s.A, "ann@alpha.test"); await s.send();
  assert.equal((await s.attention()).emails.unapproved.some((o) => o.orgName === "Alpha Co"), true);
  // the gate itself is unchanged: the address is still not approved
  assert.equal((await s.call("/approved-emails")).status, 200);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM approved_emails").get().n, 0);
});

test("dismiss is admin-only, write-gated, same-origin, validated and POST-only", async () => {
  const s = await setup();
  await s.reply(s.A, "ann@alpha.test"); await s.send();
  const go = (o) => s.call("/services/notifications/dismiss", { method: "POST", json: { organization_id: s.A.id }, ...o });
  for (const token of [null, "garbage"]) assert.ok([401, 403].includes((await go({ token })).status));
  assert.equal((await go({ e: { ...s.w.env, PORTAL_ADMIN_WRITES: undefined } })).status, 403);
  assert.equal((await go({ origin: "https://evil.example" })).status, 403);
  assert.equal((await go({ csrfHeader: false })).status, 403);
  assert.equal((await s.call("/services/notifications/dismiss")).status, 405);
  for (const bad of [{}, { organization_id: "x" }, { organization_id: "00000000-0000-4000-8000-000000000000" }]) assert.equal((await s.call("/services/notifications/dismiss", { method: "POST", json: bad })).status, 404);
  assert.equal(s.w.db.raw.prepare("SELECT count(*) n FROM service_notifications WHERE last_error = 'no_allowed_recipient'").get().n, 1, "none of the refused calls changed anything");
});

test("deleted clients do not warn; the warning data is empty when nothing was skipped", async () => {
  const s = await setup();
  assert.deepEqual((await s.attention()).emails.unapproved, []);
  await s.reply(s.A, "ann@alpha.test"); await s.send();
  assert.ok((await archiveOrganizationAudited(s.w.db, s.A.id, ADMIN)).ok);
  assert.deepEqual(await unapprovedSkips(s.w.env, s.w.db), []);
});

test("Overview: one warning line per client with the addresses, a link to Approved Emails and a confirmed Dismiss; at most three lines plus a summary", () => {
  const unapproved = [1, 2, 3, 4, 5].map((n) => ({ organizationId: `0000000${n}-0000-4000-8000-000000000000`, orgName: `Client ${n}`, notices: n, recipients: n === 2 ? ["a@x.test", "b@x.test"] : n === 3 ? [] : [`o${n}@x.test`], latest: "2026-10-27T00:00:00Z" }));
  const items = attentionItems({ dash: null, services: { emails: { failed: 0, pending: 0, unapproved } }, assess: null, feedback: null });
  assert.equal(items.length, 4, "three clients plus one summary line");
  assert.match(items[0].text, /^Client 1: 1 client notification not emailed\. Not approved: o1@x\.test\.$/);
  assert.match(items[1].text, /Not approved: a@x\.test, b@x\.test\./);
  assert.match(items[2].text, /Nobody with access can receive email\./);
  assert.ok(items.slice(0, 3).every((i) => i.tone === "warn" && i.href === "/admin/approved-emails" && i.dismiss && i.dismiss.organizationId));
  assert.match(items[3].text, /^2 more clients have notifications not emailed/); assert.ok(!items[3].dismiss);
  assert.deepEqual(attentionItems({ dash: null, services: { emails: { failed: 0, pending: 0, unapproved: [] } }, assess: null, feedback: null }), []);
  const src = read("admin/assets/overview.js");
  assert.match(src, /confirmDialog\(\{ title: "Dismiss this warning\?"/); assert.match(src, /\/services\/notifications\/dismiss/); assert.match(src, /role: "status"/);
});

test("overdue is measured in America/Edmonton: not overdue on the due date or on its evening in Calgary, overdue from the next local day, in summer and winter time", async () => {
  const { todayOf, effectiveStatus } = inv;
  // MDT (UTC-6): local midnight is 06:00Z
  assert.equal(todayOf(new Date("2026-10-28T05:59:00Z")), "2026-10-27");
  assert.equal(todayOf(new Date("2026-10-28T06:00:00Z")), "2026-10-28");
  // MST (UTC-7): local midnight is 07:00Z
  assert.equal(todayOf(new Date("2027-01-15T06:59:00Z")), "2027-01-14");
  assert.equal(todayOf(new Date("2027-01-15T07:00:00Z")), "2027-01-15");
  const due = { paymentStatus: "unpaid", dueDate: "2026-10-27" };
  assert.equal(effectiveStatus(due, todayOf(new Date("2026-10-28T03:00:00Z"))), "unpaid", "21:00 on the due date in Calgary");
  assert.equal(effectiveStatus(due, todayOf(new Date("2026-10-28T05:59:00Z"))), "unpaid", "23:59 on the due date");
  assert.equal(effectiveStatus(due, todayOf(new Date("2026-10-28T06:00:00Z"))), "overdue", "the next local day");
  assert.equal(effectiveStatus({ paymentStatus: "paid", dueDate: "2020-01-01" }, "2026-10-28"), "paid");
  const s = await setup();
  const c = await inv.createInvoice(s.w.db, s.A.id, { invoiceNumber: "FW-9", issueDate: "2026-10-01", dueDate: "2026-10-27", amount: "100" }, ADMIN);
  assert.ok(c.ok);
  s.w.db.raw.prepare("UPDATE invoices SET published_at = ?, published_by = ? WHERE id = ?").run("2026-10-02T00:00:00.000Z", ADMIN, c.invoice ? c.invoice.id : c.id);
  const evening = new Date("2026-10-28T03:00:00Z"), next = new Date("2026-10-28T07:00:00Z");
  assert.equal((await inv.clientInvoiceSummary(s.w.db, s.A.id, { now: evening })).overdue, 0);
  assert.equal((await inv.clientInvoiceSummary(s.w.db, s.A.id, { now: next })).overdue, 1);
  assert.equal((await inv.listClientInvoices(s.w.db, s.A.id, { now: evening }))[0].status, "unpaid");
  assert.equal((await inv.listClientInvoices(s.w.db, s.A.id, { now: next }))[0].status, "overdue");
  assert.equal((await inv.adminInvoiceTotals(s.w.db, { now: evening })).overdue, 0);
  assert.equal((await inv.adminInvoiceTotals(s.w.db, { now: next })).overdue, 1);
  const dash = async (now) => (await (await handleDashboardApi(new Request(ORIGIN + "/api/admin/dashboard"), s.w.env, { email: ADMIN }, "/dashboard", { now })).json()).invoices.overdue;
  assert.equal(await dash(evening), 0); assert.equal(await dash(next), 1);
  assert.ok(!/toISOString\(\)\.slice\(0, 10\)/.test(read("worker/portal/admin-dashboard.js")), "no UTC day left in the dashboard");
});

test("client pages: the invoice page carries the manual-payment wording (owners only), and a quote says how to approve it, in the page, the email and the Admin confirmation", async () => {
  const s = await setup({ approved: "ann@alpha.test mia@alpha.test" });
  const WORDS = "Payment instructions are included in your invoice PDF. Payments are recorded by Framework, and your invoice status will update once payment is confirmed.";
  const empty = await (await s.ann.get("/portal/o/alpha/services/invoices")).text();
  assert.ok(empty.includes(WORDS), "shown even before the first invoice");
  assert.equal((await s.mia.get("/portal/o/alpha/services/invoices")).status, 403, "members still cannot open invoices");
  const c = await inv.createInvoice(s.w.db, s.A.id, { invoiceNumber: "FW-1", issueDate: "2026-10-01", dueDate: "2999-01-01", amount: "100" }, ADMIN);
  s.w.db.raw.prepare("UPDATE invoices SET published_at = ?, published_by = ? WHERE id = ?").run("2026-10-02T00:00:00.000Z", ADMIN, c.invoice ? c.invoice.id : c.id);
  const withInvoice = await (await s.ann.get("/portal/o/alpha/services/invoices")).text();
  assert.ok(withInvoice.includes(WORDS) && withInvoice.includes("Invoice FW-1"));
  assert.ok(!/pay now|online payment|credit card|card number/i.test(withInvoice), "no online payment is offered");
  // the quote wording
  const chg = await sup.createRequest(s.w.db, s.A.id, s.uid("ann@alpha.test"), { category: "website_change", title: "Change", description: "x" });
  assert.ok((await sup.setRequestStatus(s.w.db, s.A.id, chg.id, "quoted", ADMIN)).ok);
  const thread = await (await s.ann.get(`/portal/o/alpha/services/requests/${chg.id}`)).text();
  assert.ok(thread.includes("To approve it, reply in this conversation. No work starts until Framework confirms your approval."));
  assert.ok(!thread.includes("Nothing goes ahead until you approve it."), "the old line is gone");
  await s.send();
  const quoteMail = s.mail.find((m) => m.subject === "Framework sent you a quote");
  assert.ok(quoteMail && quoteMail.text.includes("To approve it, reply in the request conversation in your portal. No work starts until Framework confirms your approval."));
  assert.ok(!/amount|\$\d|invoice number/i.test(quoteMail.text), "the email still carries no amounts or details");
  assert.match(read("admin/assets/support.js"), /They approve it by replying in the conversation, and no work starts until you confirm their approval\./);
});
