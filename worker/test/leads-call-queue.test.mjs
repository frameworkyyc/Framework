// Call Queue (proposed migration 0027): flag a lead to phone later WITHOUT contacting it. Separate from approval and outreach.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import { handleLeadsApi } from "../admin/leads-api.js";
import { callQueueReady, callDate, callOf, edmontonDay, logContact, queueCall, clearCall, outreachOf } from "../leads.js";

const ORIGIN = "https://staging.frameworkco.ca";
const NOW = new Date("2026-11-10T15:30:00.000Z"); // 8:30 in Edmonton, Nov 10
const MIG = "0027_call_queue.sql";
let seq = 0;

function world({ call = true } = {}) {
  const db = openPortalDb({ skip: ["0025_seo_leads.sql"], proposed: call ? [MIG] : [] });
  const w = { db, raw: db.raw, env: { PORTAL_DB: db, DEMO_LINK_SECRET: "s".repeat(40) } };
  w.q = (sql, ...p) => db.raw.prepare(sql).all(...p).map((r) => ({ ...r }));
  w.lead = (o = {}) => {
    seq++;
    const id = seq.toString(16).padStart(16, "0");
    const row = { id, source: "manual", dedupe_key: "k" + seq, name: "Lead " + seq, reason: "No website", status: "new", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", ...o };
    db.raw.prepare(`INSERT INTO outreach_leads (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row));
    return id;
  };
  w.row = (id) => w.q("SELECT * FROM outreach_leads WHERE id = ?", id)[0];
  w.events = (id) => w.q("SELECT type, detail FROM outreach_events WHERE lead_id = ? ORDER BY id", id);
  w.ctx = { at: NOW.toISOString() };
  w.api = async (method, path, body) => {
    const h = { ...(method !== "GET" ? { Origin: ORIGIN, "X-Framework-Admin": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
    const r = await handleLeadsApi(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), w.env, { email: "owner@frameworkco.ca" }, path.split("?")[0], { now: () => NOW });
    const t = await r.text();
    return { status: r.status, body: t && r.headers.get("Content-Type").includes("json") ? JSON.parse(t) : t };
  };
  return w;
}

test("migration 0027 is PROPOSED (not applied), additive, and only adds the three call columns and an index", async () => {
  assert.ok(existsSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url)));
  assert.ok(!existsSync(new URL("../../migrations/portal/" + MIG, import.meta.url)), "waits in the proposal folder until approved");
  const sql = readFileSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url), "utf8");
  assert.equal([...sql.matchAll(/ALTER TABLE outreach_leads ADD COLUMN (\w+)/g)].map((m) => m[1]).join(), "call_on,call_note,call_queued_at");
  assert.ok(!/DROP|DELETE|UPDATE|CREATE TABLE/i.test(sql.replace(/--.*$/gm, "")), "additive only");
  const w = world();
  assert.equal(await callQueueReady(w.db), true);
  assert.throws(() => w.raw.exec(`UPDATE outreach_leads SET call_on = 'tomorrow' WHERE id = '${w.lead()}'`), /constraint/i);
  assert.equal(await callQueueReady(world({ call: false }).db), false);
});

test("without the migration the feature is dormant: Queue Call explains, the list and filter still work", async () => {
  const w = world({ call: false });
  const id = w.lead({ status: "approved" });
  const r = await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-11" });
  assert.equal(r.status, 409); assert.equal(r.body.error, "not_set_up"); assert.equal(r.body.migration, MIG);
  assert.equal((await w.api("GET", "/leads/status")).body.setup.call_queue.ready, false);
  const l = await w.api("GET", "/leads/list?status=all");
  assert.equal(l.status, 200); assert.equal(l.body.call_queue, false); assert.equal(l.body.call_counts.queued, 0); assert.equal(l.body.leads[0].call, null);
  assert.deepEqual((await w.api("GET", "/leads/list?status=all&call=queued")).body.leads, [], "the queue filter never shows everything when the columns are missing");
});

test("Queue Call flags a lead for a day with a note and changes nothing else: approval, outreach, follow-up all stay", async () => {
  const w = world();
  const id = w.lead({ status: "approved", approved_at: "2026-11-05T10:00:00.000Z", notes: "keep me", follow_up_on: null });
  const before = w.row(id);
  const r = await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-11", note: "Strong reviews, no site. Ask for the owner" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const a = w.row(id);
  assert.equal(a.call_on, "2026-11-11"); assert.equal(a.call_note, "Strong reviews, no site. Ask for the owner"); assert.equal(a.call_queued_at, NOW.toISOString());
  for (const k of ["status", "approved_at", "notes", "outreach_status", "contact_method", "contacted_at", "last_contact_at", "follow_up_on", "outreach_note", "replied_at"]) assert.equal(a[k], before[k], k);
  assert.equal(outreachOf(a), null, "a queued call is not a contact");
  assert.deepEqual(r.body.lead.call, { on: "2026-11-11", note: "Strong reviews, no site. Ask for the owner", queued_at: NOW.toISOString(), overdue: false, today: false, days_overdue: 0 });
  assert.equal(r.body.lead.outreach, null);
  assert.deepEqual(w.events(id), [{ type: "note", detail: "Call queued for 2026-11-11. Note: Strong reviews, no site. Ask for the owner" }]);
});

test("the date must be a real day, today or later (Edmonton); the note must be text", async () => {
  const w = world(); const id = w.lead();
  for (const bad of [undefined, "", "tomorrow", "2026-13-40", "2026-02-30", "2026-11-09", "11/12/2026", 20261112]) assert.equal((await w.api("POST", `/leads/${id}/call`, { call_on: bad })).status, 422, String(bad));
  assert.equal((await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-11", note: 7 })).status, 422);
  assert.equal((await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-10" })).status, 200, "today is allowed");
  assert.equal(callDate("2026-11-10", NOW.toISOString()), "2026-11-10"); assert.equal(callDate("2026-11-09", NOW.toISOString()), null);
  assert.equal(edmontonDay("2026-11-11T05:00:00.000Z"), "2026-11-10", "Edmonton's day, not UTC's");
  assert.equal(w.row(id).call_note, null);
});

test("rescheduling moves the date, keeps when it was first queued and the note unless a new one is given; a note is address-free", async () => {
  const w = world(); const id = w.lead({ status: "approved" });
  await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-11", note: "first" });
  const later = { at: "2026-11-10T20:00:00.000Z" };
  const r = await queueCall(w.env, id, { call_on: "2026-11-15", note: "Ring ana@example.ca after lunch" }, later);
  assert.equal(r.ok, true);
  const a = w.row(id);
  assert.equal(a.call_on, "2026-11-15"); assert.equal(a.call_queued_at, NOW.toISOString(), "first queued time kept");
  const ev = w.events(id);
  assert.equal(ev[1].detail, "Call rescheduled from 2026-11-11 to 2026-11-15. Note: Ring [address] after lunch");
  assert.ok(!ev[1].detail.includes("ana@example.ca"));
});

test("Remove from queue clears it, records it, is idempotent, and leaves status and outreach alone", async () => {
  const w = world(); const id = w.lead({ status: "approved" });
  await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-12", note: "x" });
  const r = await w.api("POST", `/leads/${id}/call-clear`, {});
  assert.equal(r.status, 200); assert.equal(r.body.lead.call, null);
  const a = w.row(id);
  assert.equal(a.call_on, null); assert.equal(a.call_note, null); assert.equal(a.call_queued_at, null); assert.equal(a.status, "approved"); assert.equal(a.outreach_status, null);
  assert.equal(w.events(id).at(-1).detail, "Removed from the call queue.");
  const n = w.events(id).length;
  assert.equal((await w.api("POST", `/leads/${id}/call-clear`, {})).status, 200);
  assert.equal(w.events(id).length, n, "clearing an empty queue writes nothing");
});

test("a dismissed or opted-out lead cannot be queued", async () => {
  const w = world();
  const d = w.lead({ status: "dismissed", dismiss_reason: "No fit" }), o = w.lead({ status: "dismissed", dismiss_reason: "Opted out: asked not to be contacted" });
  const rd = await w.api("POST", `/leads/${d}/call`, { call_on: "2026-11-11" }), ro = await w.api("POST", `/leads/${o}/call`, { call_on: "2026-11-11" });
  assert.equal(rd.body.error, "lead_dismissed"); assert.equal(ro.body.error, "opted_out");
  assert.equal(w.row(d).call_on, null);
  assert.equal((await w.api("POST", `/leads/${"f".repeat(16)}/call`, { call_on: "2026-11-11" })).status, 404);
});

test("making the call: Mark as Contacted by Phone clears the queued call in the same write; other methods keep it queued", async () => {
  const w = world();
  const a = w.lead({ status: "approved" }), b = w.lead({ status: "approved" });
  await w.api("POST", `/leads/${a}/call`, { call_on: "2026-11-11", note: "ask for Sam" });
  await w.api("POST", `/leads/${b}/call`, { call_on: "2026-11-11" });
  const ra = await w.api("POST", `/leads/${a}/contacted`, { method: "phone", note: "Spoke to Sam" });
  assert.equal(ra.status, 200, JSON.stringify(ra.body));
  const x = w.row(a);
  assert.equal(x.call_on, null); assert.equal(x.call_note, null); assert.equal(x.outreach_status, "contacted"); assert.equal(x.contact_method, "phone"); assert.equal(x.status, "approved", "approval untouched");
  assert.equal(ra.body.lead.call, null);
  assert.match(w.events(a).at(-1).detail, /^Contacted by phone\. Note: Spoke to Sam Queued call cleared\.$/);
  await w.api("POST", `/leads/${b}/contacted`, { method: "text" });
  assert.equal(w.row(b).call_on, "2026-11-11", "a text is not the call");
  assert.ok(!w.events(b).at(-1).detail.includes("cleared"));
});

test("a lead already contacted by email can still be queued; 'Call made' removes it without rewriting its outreach history", async () => {
  const w = world();
  const id = w.lead({ status: "contacted", contacted_at: "2026-11-03T10:00:00.000Z" });
  assert.equal((await w.api("POST", `/leads/${id}/call`, { call_on: "2026-11-12" })).status, 200);
  const before = w.row(id);
  assert.equal((await w.api("POST", `/leads/${id}/contacted`, { method: "phone" })).body.error, "already_contacted");
  const r = await w.api("POST", `/leads/${id}/call-clear`, { done: true });
  assert.equal(r.status, 200);
  const a = w.row(id);
  for (const k of ["status", "contacted_at", "outreach_status", "contact_method", "last_contact_at"]) assert.equal(a[k], before[k], k);
  assert.equal(w.events(id).at(-1).detail, "Call made. Removed from the call queue.");
});

test("the list: Call Queue filter, soonest first, counts and overdue", async () => {
  const w = world();
  const late = w.lead({ name: "Late Co", status: "approved" }), soon = w.lead({ name: "Soon Co", status: "new" }), today = w.lead({ name: "Today Co", status: "approved" }), none = w.lead({ name: "No Call Co" });
  // an overdue call cannot be queued through the API (past dates are refused), so seed it as time passing would
  await w.api("POST", `/leads/${late}/call`, { call_on: "2026-11-10" });
  w.raw.prepare("UPDATE outreach_leads SET call_on = '2026-11-07' WHERE id = ?").run(late);
  await w.api("POST", `/leads/${soon}/call`, { call_on: "2026-11-14", note: "later" });
  await w.api("POST", `/leads/${today}/call`, { call_on: "2026-11-10" });
  const r = await w.api("GET", "/leads/list?status=all&call=queued");
  assert.deepEqual(r.body.leads.map((l) => l.name), ["Late Co", "Today Co", "Soon Co"], "soonest first");
  assert.deepEqual(r.body.call_counts, { queued: 3, overdue: 1 });
  const byName = Object.fromEntries(r.body.leads.map((l) => [l.name, l.call]));
  assert.equal(byName["Late Co"].overdue, true); assert.equal(byName["Late Co"].days_overdue, 3);
  assert.equal(byName["Today Co"].today, true); assert.equal(byName["Today Co"].overdue, false);
  assert.equal(byName["Soon Co"].note, "later");
  const all = await w.api("GET", "/leads/list?status=all");
  assert.equal(all.body.leads.length, 4); assert.equal(all.body.leads.find((l) => l.name === "No Call Co").call, null);
  assert.equal((await w.api("GET", "/leads/list?status=new&call=queued")).body.leads.length, 1, "combines with the status filter");
  assert.equal((await w.api("GET", "/leads/list?call=nope")).status, 422);
  assert.equal((await w.api("GET", `/leads/${soon}`)).body.call_queue, true);
  assert.equal((await w.api("GET", `/leads/${soon}`)).body.lead.call.on, "2026-11-14");
});

test("queueing many at once: one call, each lead reported; ones that cannot be queued fail alone", async () => {
  const w = world();
  const ids = [w.lead({ status: "new" }), w.lead({ status: "approved" }), w.lead({ status: "dismissed", dismiss_reason: "No fit" })];
  const r = await w.api("POST", "/leads/bulk", { action: "queue_call", ids, call_on: "2026-11-11", note: "batch" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x) => x.ok), [true, true, false]);
  assert.equal(r.body.results[2].error, "lead_dismissed");
  assert.deepEqual(ids.map((i) => w.row(i).call_on), ["2026-11-11", "2026-11-11", null]);
  assert.deepEqual(ids.slice(0, 2).map((i) => w.row(i).status), ["new", "approved"], "approval untouched");
  const c = await w.api("POST", "/leads/bulk", { action: "clear_call", ids: ids.slice(0, 2) });
  assert.deepEqual(c.body.results.map((x) => x.ok), [true, true]);
  assert.deepEqual(ids.map((i) => w.row(i).call_on), [null, null, null]);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "nope", ids })).status, 422);
});

test("call writes need the admin header and same origin like every other write", async () => {
  const w = world(); const id = w.lead();
  const r = await handleLeadsApi(new Request(ORIGIN + `/api/admin/leads/${id}/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ call_on: "2026-11-11" }) }), w.env, { email: "o@x.ca" }, `/leads/${id}/call`, { now: () => NOW });
  assert.equal(r.status, 403);
  assert.equal(w.row(id).call_on, null);
});

/* ---------- the Admin pages ---------- */
const src = (f) => readFileSync(new URL("../../admin/assets/" + f, import.meta.url), "utf8");
const panel = src("lead-panel.js"), list = src("leads.js"), call = src("lead-call.js"), common = src("leads-common.js"), brief = src("lead-brief.js");

test("Queue Call sits in the action bar, defaults to tomorrow, takes a note, and is dormant (with a reason) until 0027", () => {
  assert.match(panel, /btn\("Queue Call", "btn--secondary"/);
  assert.match(panel, /queueCallDialog\(\{ names: l\.name \}\)/);
  assert.match(panel, /Queue Call is waiting for migration 0027 to be approved/);
  assert.match(panel, /l\.opted_out \|\| l\.status === "dismissed" \|\| l\.status === "won"/, "not offered for a dismissed, opted-out or won lead");
  assert.match(call, /tomorrowEd\(\)/); assert.match(call, /min: todayEd\(\)/);
  assert.match(call, /Why call this business\? \(optional\)/);
  assert.match(call, /does not mark them as contacted/);
});

test("the badge is the subtle yellow 'Pending · Call' beside the status, with the date and overdue/due-today indicators", () => {
  assert.match(common, /badge\("Pending · Call", "warn"\)/);
  assert.match(common, /Overdue · \$\{call\.days_overdue\} day/); assert.match(common, /"Due today", "warn"/);
  assert.match(panel, /statusChip\(l\), outreachChip\(l\.outreach\), callChip\(l\.call\)/);
  assert.match(panel, /"Call " \+ dayWord\(l\.call\.on\)/);
  assert.match(list, /callChip\(l\.call\)[\s\S]*"Call " \+ dayWord\(l\.call\.on\)[\s\S]*callDue\(l\.call\)/);
});

test("the Call Queue filter shows a count, asks the list for call=queued, and bulk actions queue, reschedule and remove many at once", () => {
  assert.match(list, /"Call Queue", h\("span", \{ class: "ld-seg__n"/);
  assert.match(list, /&call=queued/);
  assert.match(list, /bulk\("queue_call", ids, r\)/); assert.match(list, /bulk\("clear_call", ids\)/);
  assert.match(list, /"Reschedule selected"/); assert.match(list, /"Remove from queue"/);
  assert.match(list, /data && data\.call_queue/, "hidden until the migration is applied");
});

test("the Call card: reschedule, remove, and Call made (Mark as Contacted with Phone ready, which clears the call)", () => {
  assert.match(call, /"Call made"/); assert.match(call, /"Reschedule"/); assert.match(call, /"Remove from queue"/);
  assert.match(panel, /markContactedDialog\(l, \{ method: "phone" \}\)/);
  assert.match(panel, /post\("\/call-clear", \{ done: true \}\)/);
  assert.match(src("lead-outreach.js"), /Choosing Phone also clears their queued call/);
});

test("the call UI follows the Admin rules: no inline styles, no HTML insertion, no new colours", () => {
  for (const [name, text] of [["lead-call.js", call], ["lead-panel.js", panel]]) { assert.ok(!/\.innerHTML|insertAdjacentHTML|style:\s*["{]/.test(text), name); }
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(call), "uses the kit's tones, not its own colours");
});

test("Copy Lead Info includes the queued call", async () => {
  assert.match(brief, /Call queued/);
  const { leadBrief } = await import("../../admin/assets/lead-brief.js");
  const md = leadBrief({ lead: { name: "X", status: "approved", call: { on: "2026-11-08", note: "ask for Sam", overdue: true, days_overdue: 2 } }, contacts: [] }, NOW);
  assert.match(md, /Call queued:\*\* 2026-11-08 \(overdue by 2 days\)\. A queued call is a reminder, not a contact/);
  assert.match(md, /Why call:\*\* ask for Sam/);
});
