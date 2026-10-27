/* Client Services, Phase 1 (foundation): migration 0007, the invoice and support data layers, permissions, the PORTAL_SERVICES flag, the hub and the Contact page.
   No routes for invoices or requests exist yet, and nothing is sent: those are later phases. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld } from "./helpers/portal-e2e.mjs";
import { openPortalDb, rows } from "./helpers/portal-db.mjs";
import * as repo from "../portal/repo/index.js";
import * as inv from "../portal/repo/invoices.js";
import * as sup from "../portal/repo/support.js";
import { can } from "../portal/policy.js";
import { PORTAL_CSP } from "../portal/http.js";

const NOW = new Date("2026-10-26T12:00:00.000Z");
const ADMIN = "admin@framework.test";
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));
const FILE = (n = 1) => ({ ext: "pdf", contentType: "application/pdf", size: 1234, sha256: "a".repeat(63) + String(n % 10), storageKey: `org/${"1".repeat(8)}-1111-4111-8111-${"1".repeat(12)}/invoices/${"2".repeat(8)}-2222-4222-8222-${String(n).padStart(12, "0")}` });

async function dbWorld() {
  const db = openPortalDb();
  const org = async (slug) => (await repo.createOrganizationAudited(db, { slug, name: slug.toUpperCase() }, "seed")).organization;
  const user = async (n, email) => (await repo.upsertUserFromIdentity(db, { workosUserId: `user_01SERV${n}0000`, email, name: email.split("@")[0] })).user;
  const join = (o, u, role) => db.raw.prepare("INSERT INTO memberships (id, organization_id, user_id, role, status, created_at, created_by) VALUES (?, ?, ?, ?, 'active', ?, 'seed')").run(crypto.randomUUID(), o.id, u.id, role, NOW.toISOString());
  const a = await org("alpha"), b = await org("beta");
  const ann = await user(1, "ann@alpha.test"), mia = await user(2, "mia@alpha.test"), bob = await user(3, "bob@beta.test");
  join(a, ann, "owner"); join(a, mia, "member"); join(b, bob, "owner");
  return { db, a, b, ann, mia, bob };
}

/* ------------------------------------------------------------------ pure helpers */

test("amounts are typed in as dollars and stored as whole cents: no rounding, no negatives, no tax maths", () => {
  for (const [raw, cents] of [["1234.5", 123450], ["1,234.50", 123450], ["$99", 9900], ["0", 0], ["0.07", 7], [12.3, 1230], ["  10.00 ", 1000]]) assert.equal(inv.parseAmountToCents(raw), cents, String(raw));
  for (const bad of ["", "-5", "1.234", "abc", "1e3", "12.", ".5", "1 000", null, undefined, NaN, "9999999999", {}]) assert.equal(inv.parseAmountToCents(bad), null, String(bad));
  assert.equal(inv.formatMoney(123456), "$1,234.56 CAD"); assert.equal(inv.formatMoney(5), "$0.05 CAD"); assert.equal(inv.formatMoney(-1), "");
});
test("dates are real calendar dates; overdue is derived, never stored; retention is six years after the year of issue", () => {
  assert.equal(inv.validDate("2026-02-28"), "2026-02-28"); for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", "", null]) assert.equal(inv.validDate(bad), null, String(bad));
  assert.equal(inv.effectiveStatus({ paymentStatus: "unpaid", dueDate: "2026-10-01" }, "2026-10-26"), "overdue");
  assert.equal(inv.effectiveStatus({ paymentStatus: "unpaid", dueDate: "2026-10-26" }, "2026-10-26"), "unpaid", "due today is not yet overdue");
  assert.equal(inv.effectiveStatus({ paymentStatus: "unpaid", dueDate: null }, "2026-10-26"), "unpaid");
  assert.equal(inv.effectiveStatus({ paymentStatus: "paid", dueDate: "2020-01-01" }, "2026-10-26"), "paid");
  assert.equal(inv.retainUntil("2026-03-15"), "2032-12-31"); assert.equal(inv.retainUntil("nope"), null);
});
test("support scope follows the category: technical and general are support; website and design changes are potentially billable", () => {
  assert.deepEqual(sup.CATEGORIES.map((c) => [c, sup.scopeOf(c)]), [["website_change", "change"], ["design_revision", "change"], ["technical_issue", "support"], ["general", "support"]]);
  assert.match(sup.SUBMISSION_NOTICE, /does not authorize any paid work/); assert.match(sup.SUBMISSION_NOTICE, /quote/);
});

/* ------------------------------------------------------------------ invoices */

test("invoices: staff create a draft; clients see nothing until it has a file and is published; publishing queues the client notice", async () => {
  const { db, a, b } = await dbWorld();
  const c = await inv.createInvoice(db, a.id, { invoiceNumber: "FW-2026-001", issueDate: "2026-10-01", dueDate: "2026-10-15", amount: "1,500.00", description: "Brand refresh", internalNote: "Net 14" }, ADMIN, { now: NOW });
  assert.ok(c.ok, JSON.stringify(c));
  assert.equal((await inv.listClientInvoices(db, a.id, { now: NOW })).length, 0, "a draft does not exist for the client");
  assert.equal((await inv.publishInvoice(db, a.id, c.id, ADMIN)).error, "needs_file");
  assert.ok((await inv.setInvoiceFile(db, a.id, c.id, FILE(1), ADMIN, { now: NOW })).ok);
  assert.equal((await inv.listClientInvoices(db, a.id, { now: NOW })).length, 0, "a file alone does not publish");
  assert.deepEqual(await inv.publishInvoice(db, a.id, c.id, ADMIN, { now: NOW }), { ok: true, changed: true });
  assert.deepEqual(await inv.publishInvoice(db, a.id, c.id, ADMIN, { now: NOW }), { ok: true, changed: false }, "publishing twice is harmless");
  const [mine] = await inv.listClientInvoices(db, a.id, { now: NOW });
  assert.deepEqual(Object.keys(mine).sort(), ["amountCents", "description", "dueDate", "format", "hasFile", "id", "invoiceNumber", "issueDate", "paidAt", "size", "status"], "no keys, hashes or internal notes reach a client");
  assert.equal(mine.amountCents, 150000); assert.equal(mine.status, "overdue", "past its due date and unpaid");
  assert.equal(sql(db, "SELECT * FROM service_notifications WHERE event = 'invoice_published'").length, 1, "one client notice queued, once");
  assert.equal((await inv.listClientInvoices(db, b.id, { now: NOW })).length, 0, "another organization sees nothing");
  assert.equal(await inv.getClientInvoiceFile(db, b.id, c.id), null);
  assert.ok(await inv.getClientInvoiceFile(db, a.id, c.id));
  assert.deepEqual(await inv.clientInvoiceSummary(db, a.id, { now: NOW }), { total: 1, unpaid: 1, overdue: 1 });
});

test("invoices: numbers are unique per organization, amounts and dates are validated, paid invoices lock their figures, payment status is staff-set", async () => {
  const { db, a, b } = await dbWorld();
  const mk = (org, n, o = {}) => inv.createInvoice(db, org.id, { invoiceNumber: n, issueDate: "2026-10-01", amount: "10", ...o }, ADMIN);
  const one = await mk(a, "A-1"); assert.ok(one.ok);
  assert.equal((await mk(a, "A-1")).error, "duplicate_number"); assert.ok((await mk(b, "A-1")).ok, "the same number in another organization is fine");
  for (const [o, err] of [[{ invoiceNumber: "bad number" }, "invalid_invoice_number"], [{ issueDate: "2026-02-30" }, "invalid_issue_date"], [{ dueDate: "2026-09-01" }, "due_before_issue"], [{ amount: "-1" }, "invalid_amount"], [{ amount: "1.234" }, "invalid_amount"], [{ description: "x".repeat(301) }, "invalid_description"]]) assert.equal((await mk(a, "A-X", o)).error, err, err);
  assert.equal((await inv.createInvoice(db, a.id, { invoiceNumber: "A-2", issueDate: "2026-10-01", amount: "1" }, "")).error, "invalid_actor");
  assert.ok((await inv.setPaymentStatus(db, a.id, one.id, "paid", ADMIN, { now: NOW })).ok);
  assert.equal(sql(db, "SELECT paid_at FROM invoices WHERE id = ?", one.id)[0].paid_at, "2026-10-26");
  assert.equal((await inv.updateInvoice(db, a.id, one.id, { amount: "11" }, ADMIN)).error, "paid_locked");
  assert.ok((await inv.updateInvoice(db, a.id, one.id, { description: "Thanks" }, ADMIN)).ok, "a note can still change");
  assert.equal((await inv.setPaymentStatus(db, a.id, one.id, "refunded", ADMIN)).error, "invalid_status");
  assert.equal((await inv.setPaymentStatus(db, a.id, one.id, "paid", ADMIN, { paidOn: "2026-13-01" })).error, "invalid_paid_date");
  assert.ok((await inv.setPaymentStatus(db, a.id, one.id, "unpaid", ADMIN)).ok);
  assert.equal(sql(db, "SELECT paid_at FROM invoices WHERE id = ?", one.id)[0].paid_at, null, "back to unpaid clears the paid date");
  assert.equal((await inv.updateInvoice(db, b.id, one.id, { description: "hijack" }, ADMIN)).error, "not_found", "another organization's id is not found");
});

test("invoices are archived, never routinely deleted: there is no delete function, archived and void invoices leave the client's view, and the row and file are kept", async () => {
  const { db, a } = await dbWorld();
  let fileSeq = 100;
  const make = async (n) => { const c = await inv.createInvoice(db, a.id, { invoiceNumber: n, issueDate: "2026-10-01", amount: "5" }, ADMIN); await inv.setInvoiceFile(db, a.id, c.id, FILE(++fileSeq), ADMIN); await inv.publishInvoice(db, a.id, c.id, ADMIN); return c.id; };
  const [x, y] = [await make("X-1"), await make("Y-1")];
  assert.equal((await inv.listClientInvoices(db, a.id, { now: NOW })).length, 2);
  assert.ok((await inv.archiveInvoice(db, a.id, x, ADMIN)).ok);
  assert.ok((await inv.setPaymentStatus(db, a.id, y, "void", ADMIN)).ok);
  assert.equal((await inv.listClientInvoices(db, a.id, { now: NOW })).length, 0);
  assert.equal(await inv.getClientInvoiceFile(db, a.id, x), null);
  assert.equal((await inv.listInvoicesAdmin(db, a.id)).length, 1, "the default admin list hides archived invoices"); assert.equal((await inv.listInvoicesAdmin(db, a.id, { includeArchived: true })).length, 2);
  assert.equal((await inv.updateInvoice(db, a.id, x, { description: "no" }, ADMIN)).error, "archived");
  assert.ok((await inv.restoreInvoice(db, a.id, x, ADMIN)).ok); assert.equal((await inv.listClientInvoices(db, a.id, { now: NOW })).length, 1);
  assert.equal(sql(db, "SELECT count(*) n FROM invoices").length && sql(db, "SELECT count(*) n FROM invoices")[0].n, 2, "nothing was deleted");
  assert.ok(!/DELETE\s+FROM\s+invoices/i.test(readFileSync(new URL("../portal/repo/invoices.js", import.meta.url), "utf8")), "no code path deletes an invoice");
  assert.equal(sql(db, "SELECT count(*) n FROM activity_log WHERE action IN ('invoice.archived', 'invoice.restored', 'invoice.payment_void')")[0].n, 3, "each step is audited");
});

test("the schema refuses bad invoice rows by itself: non-CAD, odd numbers, paid without a date, a key without a hash", async () => {
  const { db, a } = await dbWorld();
  const ins = (cols, vals) => db.raw.prepare(`INSERT INTO invoices (id, organization_id, invoice_number, issue_date, amount_cents, created_by, updated_by${cols}) VALUES (?, ?, 'N-1', '2026-10-01', 100, 'x', 'x'${vals.map(() => ", ?").join("")})`);
  const base = () => [crypto.randomUUID(), a.id];
  assert.throws(() => ins(", currency", ["USD"]).run(...base(), "USD"), /constraint/i);
  assert.throws(() => ins(", payment_status", ["paid"]).run(...base(), "paid"), /constraint/i, "paid needs a paid date");
  assert.throws(() => ins(", storage_key", ["k"]).run(...base(), "k".repeat(50)), /constraint/i, "a storage key needs its hash");
  assert.throws(() => db.raw.prepare("INSERT INTO invoices (id, organization_id, invoice_number, issue_date, amount_cents, created_by, updated_by) VALUES (?, ?, 'bad number!', '2026-10-01', 1, 'x', 'x')").run(crypto.randomUUID(), a.id), /constraint/i);
  assert.throws(() => db.raw.prepare("INSERT INTO invoices (id, organization_id, invoice_number, issue_date, amount_cents, created_by, updated_by) VALUES (?, ?, 'N', '2026-10-01', -1, 'x', 'x')").run(crypto.randomUUID(), a.id), /constraint/i);
});

/* ------------------------------------------------------------------ support requests */

test("support: a request and its first message are written together; the conversation is complete and append-only; the staff are told", async () => {
  const { db, a, b, ann, mia } = await dbWorld();
  const r = await sup.createRequest(db, a.id, mia.id, { category: "website_change", title: "Update our hours", description: "Please change the footer hours." }, { now: NOW });
  assert.ok(r.ok, JSON.stringify(r));
  const t = await sup.getClientThread(db, a.id, r.id);
  assert.equal(t.request.scope, "change"); assert.equal(t.request.status, "new"); assert.equal(t.messages.length, 1); assert.equal(t.messages[0].authorType, "client");
  assert.equal(sql(db, "SELECT * FROM service_notifications WHERE event = 'request_submitted' AND audience = 'staff'").length, 1);
  assert.ok((await sup.addClientMessage(db, a.id, ann.id, r.id, "More detail: weekdays 9 to 5.", { now: NOW })).ok, "any member of the organization can follow up");
  assert.ok((await sup.addStaffMessage(db, a.id, r.id, "Thanks, we are looking at it.", ADMIN, { now: NOW })).ok);
  assert.ok((await sup.addStaffMessage(db, a.id, r.id, "Quote about 1h. Check availability.", ADMIN, { internal: true, now: NOW })).ok);
  assert.ok((await sup.setRequestStatus(db, a.id, r.id, "in_review", ADMIN, { note: "In review now.", now: NOW })).ok);
  const client = await sup.getClientThread(db, a.id, r.id), admin = await sup.getAdminThread(db, a.id, r.id);
  assert.deepEqual(client.messages.map((m) => [m.kind, m.authorType]), [["message", "client"], ["message", "client"], ["message", "staff"], ["status", "staff"]], "the whole visible history, in order, status changes included");
  assert.ok(!JSON.stringify(client).includes("Check availability"), "a private note never reaches the client");
  assert.equal(admin.messages.length, 5); assert.ok(admin.messages.some((m) => m.visibility === "internal"));
  assert.equal(client.messages[3].statusTo, "in_review");
  assert.equal(sql(db, "SELECT count(*) n FROM service_notifications WHERE audience = 'client'")[0].n, 1, "a Framework reply notifies the client; a routine status change and a private note do not");
  assert.equal(sql(db, "SELECT count(*) n FROM service_notifications WHERE audience = 'staff'")[0].n, 2, "a submit and a client reply notify the staff");
  assert.equal(await sup.getClientThread(db, b.id, r.id), null, "another organization cannot read the thread");
  assert.equal((await sup.addClientMessage(db, b.id, ann.id, r.id, "x")).error, "not_found");
  const src = readFileSync(new URL("../portal/repo/support.js", import.meta.url), "utf8");
  assert.ok(!/UPDATE support_messages|DELETE FROM support_(messages|attachments|requests)/i.test(src), "the conversation is append-only: no code edits or deletes a message");
});

test("support: only potentially billable changes can be quoted or approved; submitting never approves; closed requests take no client messages", async () => {
  const { db, a, mia } = await dbWorld();
  const chg = (await sup.createRequest(db, a.id, mia.id, { category: "design_revision", title: "New logo colours", description: "Try a darker blue." })).id;
  const tech = (await sup.createRequest(db, a.id, mia.id, { category: "technical_issue", title: "Form broken", description: "The contact form errors." })).id;
  assert.equal(sql(db, "SELECT status FROM support_requests WHERE id = ?", chg)[0].status, "new", "a change request starts as new, not approved");
  assert.equal((await sup.setRequestStatus(db, a.id, tech, "quoted", ADMIN)).error, "not_billable");
  assert.equal((await sup.setRequestStatus(db, a.id, tech, "approved", ADMIN)).error, "not_billable");
  assert.throws(() => db.raw.prepare("UPDATE support_requests SET status = 'approved' WHERE id = ?").run(tech), /constraint/i, "the database refuses it too");
  assert.ok((await sup.setRequestStatus(db, a.id, chg, "quoted", ADMIN, { note: "Quote sent by email." })).ok);
  assert.ok((await sup.setRequestStatus(db, a.id, chg, "approved", ADMIN, { note: "Client approved the quote." })).ok);
  assert.deepEqual(await sup.setRequestStatus(db, a.id, chg, "approved", ADMIN), { ok: true, changed: false });
  assert.equal((await sup.setRequestStatus(db, a.id, chg, "paid", ADMIN)).error, "invalid_status");
  assert.ok((await sup.setRequestStatus(db, a.id, tech, "completed", ADMIN)).ok);
  assert.equal((await sup.addClientMessage(db, a.id, mia.id, tech, "Still broken")).error, "closed");
  assert.ok((await sup.addStaffMessage(db, a.id, tech, "Follow-up from us", ADMIN)).ok, "staff can still write on a closed request");
  assert.equal(sup.STATUS_LABEL.approved, "Approved"); assert.equal(sup.STATUS_LABEL.quoted, "Quote sent");
});

test("support: validation, the open-request cap, membership, unread tracking and the attachment limit", async () => {
  const { db, a, b, ann, mia, bob } = await dbWorld();
  const mk = (o = {}, user = mia, org = a) => sup.createRequest(db, org.id, user.id, { category: "general", title: "T", description: "D", ...o });
  for (const [o, err] of [[{ category: "billing" }, "invalid_category"], [{ title: "" }, "invalid_title"], [{ title: "x".repeat(121) }, "invalid_title"], [{ description: "" }, "description_required"], [{ description: "x".repeat(4001) }, "invalid_description"]]) assert.equal((await mk(o)).error, err, err);
  assert.equal((await mk({}, bob, a)).error, "not_allowed", "someone who is not a member of the organization cannot open a request for it");
  const ids = []; for (let i = 0; i < sup.MAX_OPEN_REQUESTS; i++) ids.push((await mk({ title: "R" + i })).id);
  assert.equal((await mk({ title: "one too many" })).error, "too_many_open");
  assert.ok((await mk({}, bob, b)).ok, "another organization has its own allowance");
  await sup.setRequestStatus(db, a.id, ids[0], "completed", ADMIN);
  assert.ok((await mk({ title: "room again" })).ok, "closing a request frees a place");
  // unread: a Framework reply is unread until the client opens the thread
  assert.equal((await sup.clientSupportSummary(db, a.id)).unread, 1, "Framework closing a request is an update the client has not seen");
  await sup.markClientRead(db, a.id, ids[0]);
  assert.equal((await sup.clientSupportSummary(db, a.id)).unread, 0);
  await sup.addStaffMessage(db, a.id, ids[1], "Reply", ADMIN);
  assert.equal((await sup.clientSupportSummary(db, a.id)).unread, 1);
  assert.equal((await sup.listClientRequests(db, a.id)).find((r) => r.id === ids[1]).unreadForClient, true);
  await sup.markClientRead(db, a.id, ids[1]);
  assert.equal((await sup.clientSupportSummary(db, a.id)).unread, 0);
  assert.equal((await sup.adminSupportSummary(db, a.id)).unseen > 0, true, "client activity the staff have not seen is counted");
  // attachments: at most three per request, ten megabytes each, metadata scoped to the organization
  const first = (await sup.getClientThread(db, a.id, ids[2])).messages[0].id;
  const att = (n, size = 100) => sup.createAttachment(db, a.id, ids[2], first, "client", { name: `f${n}.png`, ext: "png", contentType: "image/png", size, sha256: String(n).repeat(64).slice(0, 64), storageKey: `org/${a.id}/support/${crypto.randomUUID()}` });
  for (const n of [1, 2, 3]) assert.ok((await att(n)).ok);
  assert.equal((await att(4)).error, "too_many_attachments");
  assert.equal((await sup.createAttachment(db, a.id, ids[3], (await sup.getClientThread(db, a.id, ids[3])).messages[0].id, "client", { name: "big.png", ext: "png", contentType: "image/png", size: sup.MAX_ATTACHMENT_BYTES + 1, sha256: "b".repeat(64), storageKey: `org/${a.id}/support/${crypto.randomUUID()}` })).error, "file_too_large");
  assert.equal((await sup.getClientThread(db, a.id, ids[2])).attachments.length, 3);
  assert.equal(await sup.getClientAttachment(db, b.id, ids[2], (await sup.getClientThread(db, a.id, ids[2])).attachments[0].id), null, "another organization cannot reach the file record");
  void ann;
});

test("the schema refuses a quoted support request, an internal client message, and a status entry from a client", async () => {
  const { db, a, mia } = await dbWorld();
  const r = await sup.createRequest(db, a.id, mia.id, { category: "general", title: "T", description: "D" });
  const msg = (cols) => db.raw.prepare(`INSERT INTO support_messages (id, organization_id, request_id, ${cols.join(", ")}) VALUES (?, ?, ?, ${cols.map(() => "?").join(", ")})`);
  assert.throws(() => msg(["kind", "author_type", "author_user_id", "visibility", "body"]).run(crypto.randomUUID(), a.id, r.id, "message", "client", mia.id, "internal", "x"), /constraint/i);
  assert.throws(() => msg(["kind", "author_type", "author_user_id", "status_to", "body"]).run(crypto.randomUUID(), a.id, r.id, "status", "client", mia.id, "approved", ""), /constraint/i);
  assert.throws(() => msg(["kind", "author_type", "visibility", "body"]).run(crypto.randomUUID(), a.id, r.id, "message", "staff", "client", "no label"), /constraint/i);
  assert.throws(() => msg(["kind", "author_type", "author_user_id", "body"]).run(crypto.randomUUID(), crypto.randomUUID(), r.id, "message", "client", mia.id, "wrong organization"), /constraint|FOREIGN/i);
});

/* ------------------------------------------------------------------ permissions, flag, pages */

test("permissions: everyone may use the hub and support; only owners may see invoices; there is no client write action for invoices", () => {
  for (const action of ["services.view", "support.view", "support.submit"]) { assert.ok(can("owner", action) && can("member", action), action); }
  assert.ok(can("owner", "invoices.view")); assert.ok(!can("member", "invoices.view"));
  assert.ok(!["invoices.create", "invoices.edit", "invoices.delete", "support.approve", "support.status"].some((a) => can("owner", a)), "invoices and approvals are Framework Admin's alone");
});

async function webWorld({ flag = true } = {}) {
  const w = await makeWorld();
  if (flag) w.env.PORTAL_SERVICES = "1";
  const alpha = await w.org("alpha", "Alpha Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(alpha, "mia@alpha.test", "member");
  const ann = w.browser(), mia = w.browser(), anon = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test"));
  return { w, ann, mia, anon };
}

test("with PORTAL_SERVICES off, Home has no Client Services card and every services route is 404", async () => {
  const { ann } = await webWorld({ flag: false });
  assert.ok(!/Client Services|\/services/.test(await (await ann.get("/portal/o/alpha")).text()));
  for (const p of ["/services", "/services/contact"]) assert.equal((await ann.get("/portal/o/alpha" + p)).status, 404, p);
});

test("with the flag on: Home links Client Services; the hub shows Invoices only to owners; unavailable parts are quiet text; Contact is a real page", async () => {
  const { ann, mia, anon } = await webWorld();
  const home = await (await ann.get("/portal/o/alpha")).text();
  assert.match(home, /<a class="hub" href="\/portal\/o\/alpha\/services">/); assert.ok(!/class="lead"|home-note/.test(home));
  const owner = await ann.get("/portal/o/alpha/services");
  assert.equal(owner.status, 200); assert.equal(owner.headers.get("content-security-policy"), PORTAL_CSP, "no script");
  const o = await owner.text();
  assert.match(o, /<h1 class="h1 h1--section">Client Services<\/h1>/);
  assert.deepEqual([...o.matchAll(/class="hub__title">([^<]+)</g)].map((m) => m[1].replace(/&amp;/g, "&")), ["Invoices", "Support & Change Requests", "Contact"]);
  assert.equal([...o.matchAll(/<a class="hub"/g)].length, 3, "Invoices, Support and Contact are all links now");
  assert.match(o, /href="\/portal\/o\/alpha\/services\/contact"/); assert.equal([...o.matchAll(/Coming soon/g)].length, 0); assert.match(o, /href="\/portal\/o\/alpha\/services\/invoices"/);
  const m = await (await mia.get("/portal/o/alpha/services")).text();
  assert.deepEqual([...m.matchAll(/class="hub__title">([^<]+)</g)].map((x) => x[1].replace(/&amp;/g, "&")), ["Support & Change Requests", "Contact"], "members do not see Invoices");
  const c = await mia.get("/portal/o/alpha/services/contact");
  assert.equal(c.status, 200);
  const ch = await c.text();
  assert.match(ch, /mailto:hello@frameworkco\.ca\?subject=Client%20portal%3A%20Alpha%20Co/); assert.match(ch, /Calgary, Alberta/); assert.match(ch, /quoted for your approval before it starts/);
  assert.ok(!/style=|<script/.test(o + ch));
  assert.equal((await anon.get("/portal/o/alpha/services")).status, 303, "signed-in only");
});

test("services pages never leak another organization or a draft: the hub and contact take their organization from the membership", async () => {
  const { w, ann } = await webWorld();
  const beta = await w.org("beta", "Beta Co"); await w.invite(beta, "bob@beta.test", "owner");
  assert.equal((await ann.get("/portal/o/beta/services")).status, 404);
  assert.equal((await ann.get("/portal/o/beta/services/contact")).status, 404);
});

test("the privacy additions are a draft for review: written to a separate file, and privacy.html carries them with either the pending notice or a real effective date", () => {
  const draft = readFileSync(new URL("../portal/PRIVACY-SERVICES-DRAFT.md", import.meta.url), "utf8");
  assert.match(draft, /DRAFT/); assert.match(draft, /not published/i); assert.match(draft, /invoice/i); assert.match(draft, /support/i);
  const policy = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8");
  if (/support and change request/i.test(policy)) assert.match(policy, /<time (id="effective-date" data-status="pending"|datetime="\d{4}-\d{2}-\d{2}" id="effective-date")>/, "a policy that describes Client Services carries either the pending notice or a real effective date");
  assert.ok(rows(openPortalDb(), "SELECT name FROM sqlite_master WHERE name = 'invoices'").length === 1);
});
