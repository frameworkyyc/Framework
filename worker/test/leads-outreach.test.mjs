// Admin Leads: "Mark as Contacted" and outreach tracking (proposed migration 0026). Reuses outreach_leads and the timeline; the lead's approval is never rewritten.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import { handleLeadsApi } from "../admin/leads-api.js";
import { logContact, updateOutreach, outreachOf, followUpDate, trackingReady, forgetLeadsReady, CONTACT_METHODS, OUTREACH_STATUSES } from "../leads.js";

const ORIGIN = "https://staging.frameworkco.ca";
const NOW = new Date("2026-11-10T15:30:00.000Z");
const MIG = "0026_outreach_tracking.sql";
let seq = 0;

function world({ tracking = true } = {}) {
  const db = openPortalDb({ skip: ["0025_seo_leads.sql"], proposed: tracking ? [MIG] : [] });
  const w = { db, raw: db.raw, env: { PORTAL_DB: db, DEMO_LINK_SECRET: "s".repeat(40) }, clock: NOW };
  w.q = (sql, ...p) => db.raw.prepare(sql).all(...p).map((r) => ({ ...r }));
  w.lead = (o = {}) => {
    seq++;
    const id = seq.toString(16).padStart(16, "0");
    const row = { id, source: "manual", dedupe_key: "k" + seq, name: "Lead " + seq, reason: "No website", status: "new", created_at: "2026-11-01T00:00:00.000Z", updated_at: "2026-11-01T00:00:00.000Z", ...o };
    db.raw.prepare(`INSERT INTO outreach_leads (${Object.keys(row).join(", ")}) VALUES (${Object.keys(row).map(() => "?").join(", ")})`).run(...Object.values(row));
    return id;
  };
  w.row = (id) => w.q("SELECT * FROM outreach_leads WHERE id = ?", id)[0];
  w.events = (id) => w.q("SELECT type, detail, at FROM outreach_events WHERE lead_id = ? ORDER BY id", id);
  w.ctx = { at: NOW.toISOString() };
  w.api = async (method, path, body, { write = true } = {}) => {
    const h = { ...(write && method !== "GET" ? { Origin: ORIGIN, "X-Framework-Admin": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) };
    const r = await handleLeadsApi(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), w.env, { email: "owner@frameworkco.ca" }, path.split("?")[0], { now: () => w.clock });
    const t = await r.text();
    return { status: r.status, body: t && r.headers.get("Content-Type").includes("json") ? JSON.parse(t) : t };
  };
  return w;
}

test("migration 0026 is proposed (not applied), additive, and gates the feature like the SEO columns", async () => {
  assert.ok(existsSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url)));
  assert.ok(!existsSync(new URL("../../migrations/portal/" + MIG, import.meta.url)), "not in the applied directory");
  const sql = readFileSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url), "utf8");
  assert.equal([...sql.matchAll(/ALTER TABLE outreach_leads ADD COLUMN/g)].length, 5);
  assert.ok(!/DROP|DELETE|UPDATE|CREATE TABLE/i.test(sql.replace(/--.*$/gm, "")), "additive only");
  const w = world();
  assert.equal(await trackingReady(w.db), true);
  assert.throws(() => w.raw.exec(`UPDATE outreach_leads SET contact_method = 'carrier pigeon' WHERE id = '${w.lead()}'`), /constraint/i);
  const off = world({ tracking: false });
  assert.equal(await trackingReady(off.db), false);
});

test("Mark as Contacted: records method and the moment automatically, sets Contacted, keeps approval, data and history", async () => {
  const w = world();
  const id = w.lead({ status: "approved", approved_at: "2026-11-05T10:00:00.000Z", notes: "Spoke to the owner's brother", trade: "fence", city: "Calgary", demo_link_id: null });
  w.raw.prepare("INSERT INTO outreach_events (lead_id, at, type, detail) VALUES (?, ?, 'approved', 'Approved')").run(id, "2026-11-05T10:00:00.000Z");
  const before = w.row(id);
  const r = await w.api("POST", `/leads/${id}/contacted`, { method: "phone", note: "Left a voicemail. Call back on 403-555-0100 or info@example.ca", follow_up_on: "2026-11-14" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const after = w.row(id);
  assert.equal(after.outreach_status, "contacted");
  assert.equal(after.contact_method, "phone");
  assert.equal(after.contacted_at, NOW.toISOString(), "the date and time are recorded automatically");
  assert.equal(after.last_contact_at, NOW.toISOString());
  assert.equal(after.follow_up_on, "2026-11-14");
  assert.match(after.outreach_note, /Left a voicemail/);
  // approval and everything else untouched
  assert.equal(after.status, "approved"); assert.equal(after.approved_at, before.approved_at);
  for (const k of ["name", "reason", "notes", "trade", "city", "dedupe_key", "created_at", "dismissed_at", "replied_at", "won_at"]) assert.equal(after[k], before[k], k);
  // history kept, one new timeline entry, address-free
  const ev = w.events(id);
  assert.equal(ev[0].type, "approved");
  assert.equal(ev.length, 2);
  assert.match(ev[1].detail, /^Contacted by phone\. Follow up 2026-11-14\. Note: Left a voicemail/);
  assert.ok(!/@/.test(ev[1].detail), "no email address in the timeline");
  // the API shows it
  assert.deepEqual({ s: r.body.lead.outreach.status, m: r.body.lead.outreach.method, w: r.body.lead.outreach.method_word, f: r.body.lead.outreach.follow_up_on }, { s: "contacted", m: "phone", w: "Phone", f: "2026-11-14" });
  assert.equal(r.body.lead.status, "approved");
});

test("Mark as Contacted: every method works; bad input, dismissed, opted-out and already-contacted leads are refused; a double click writes once", async () => {
  const w = world();
  for (const m of CONTACT_METHODS) { const id = w.lead(); assert.equal((await w.api("POST", `/leads/${id}/contacted`, { method: m })).status, 200, m); assert.equal(w.row(id).contact_method, m); }
  const id = w.lead();
  for (const [body, field] of [[{}, "method"], [{ method: "pigeon" }, "method"], [{ method: "text", follow_up_on: "2026-13-40" }, "follow_up_on"], [{ method: "text", follow_up_on: "11/14/2026" }, "follow_up_on"], [{ method: "text", follow_up_on: "2026-11-01" }, "follow_up_on"], [{ method: "text", note: 5 }, "note"]]) {
    const r = await w.api("POST", `/leads/${id}/contacted`, body);
    assert.equal(r.status, 422, JSON.stringify(body)); assert.equal(r.body.field, field);
  }
  assert.equal(w.row(id).outreach_status, null, "nothing was written");
  assert.equal((await w.api("POST", `/leads/${w.lead({ status: "dismissed", dismissed_at: "2026-11-02T00:00:00.000Z" })}/contacted`, { method: "text" })).body.error, "lead_dismissed");
  assert.equal((await w.api("POST", `/leads/${w.lead({ status: "dismissed", dismiss_reason: "Opted out" })}/contacted`, { method: "text" })).body.error, "opted_out");
  assert.equal((await w.api("POST", `/leads/${w.lead({ status: "contacted", contacted_at: "2026-11-08T00:00:00.000Z" })}/contacted`, { method: "text" })).body.error, "already_contacted", "already emailed from Leads");
  const a = await Promise.all([w.api("POST", `/leads/${id}/contacted`, { method: "text", note: "x" }), w.api("POST", `/leads/${id}/contacted`, { method: "text", note: "x" })]);
  assert.deepEqual(a.map((r) => r.status).sort(), [200, 409]);
  assert.equal(w.events(id).length, 1, "one timeline entry");
  assert.equal((await w.api("POST", "/leads/0000000000000000/contacted", { method: "text" })).status, 404);
});

test("outreach status: Replied, Interested, Not interested, Follow-up needed, with notes and follow-up dates; approval stays", async () => {
  const w = world();
  const id = w.lead({ status: "ready", approved_at: "2026-11-05T10:00:00.000Z" });
  assert.equal((await w.api("POST", `/leads/${id}/outreach`, { status: "interested" })).body.error, "not_contacted");
  await w.api("POST", `/leads/${id}/contacted`, { method: "text", follow_up_on: "2026-11-12", note: "Sent a text" });
  let r = await w.api("POST", `/leads/${id}/outreach`, { status: "interested", note: "Wants to see a demo", follow_up_on: "2026-11-20" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([w.row(id).outreach_status, w.row(id).follow_up_on, w.row(id).outreach_note, w.row(id).status, w.row(id).contact_method], ["interested", "2026-11-20", "Wants to see a demo", "ready", "text"]);
  r = await w.api("POST", `/leads/${id}/outreach`, { status: "follow_up", follow_up_on: "2026-11-25" });
  assert.deepEqual([w.row(id).outreach_status, w.row(id).follow_up_on, w.row(id).outreach_note], ["follow_up", "2026-11-25", "Wants to see a demo"], "an omitted note keeps the last one");
  r = await w.api("POST", `/leads/${id}/outreach`, { status: "replied", note: "Replied by text" });
  assert.equal(w.row(id).outreach_status, "replied"); assert.equal(w.row(id).replied_at, NOW.toISOString()); assert.equal(w.row(id).status, "ready", "a hand-logged reply does not rewrite the approval");
  r = await w.api("POST", `/leads/${id}/outreach`, { status: "not_interested", note: "Not now", follow_up_on: "2026-12-01" });
  assert.equal(w.row(id).outreach_status, "not_interested"); assert.equal(w.row(id).follow_up_on, null, "no follow-up for Not interested");
  assert.equal((await w.api("POST", `/leads/${id}/outreach`, { status: "bogus" })).status, 422);
  assert.equal((await w.api("POST", `/leads/${id}/outreach`, { status: "interested", follow_up_on: "nope" })).body.field, "follow_up_on");
  const types = w.events(id).map((e) => e.type);
  assert.deepEqual(types, ["note", "note", "note", "replied", "note"]);
  assert.ok(w.events(id).every((e) => e.detail && e.detail.length <= 300));
  // every outreach status is allowed
  for (const s of OUTREACH_STATUSES) assert.equal((await w.api("POST", `/leads/${id}/outreach`, { status: s })).status, 200, s);
});

test("a lead emailed from Leads already counts as Contacted (method Email) and Replied; marking it replied moves the lifecycle like Mark replied does", async () => {
  const w = world();
  const emailed = w.lead({ status: "contacted", contacted_at: "2026-11-08T09:00:00.000Z", approved_at: "2026-11-07T09:00:00.000Z" });
  const o = outreachOf(w.row(emailed));
  assert.deepEqual([o.status, o.method, o.last_contact_at], ["contacted", "email", "2026-11-08T09:00:00.000Z"]);
  const r = await w.api("POST", `/leads/${emailed}/outreach`, { status: "replied", note: "They answered" });
  assert.equal(r.status, 200);
  assert.deepEqual([w.row(emailed).status, w.row(emailed).replied_at, w.row(emailed).outreach_status], ["replied", NOW.toISOString(), "replied"]);
  assert.equal(outreachOf(w.row(w.lead())), null, "a new lead has no outreach");
  assert.equal(outreachOf(w.row(w.lead({ status: "approved" }))), null);
  assert.equal(followUpDate("2026-11-10", NOW.toISOString()), "2026-11-10"); assert.equal(followUpDate("2026-11-09", NOW.toISOString()), "2026-11-09"); assert.equal(followUpDate("2026-11-08", NOW.toISOString()), undefined);
});

test("contacted leads stay in the list and can be filtered by outreach status; counts and rows carry the outreach state", async () => {
  const w = world();
  const a = w.lead({ status: "approved" }), b = w.lead({ status: "approved" }), c = w.lead({ status: "new" }), d = w.lead({ status: "contacted", contacted_at: "2026-11-08T09:00:00.000Z" }), e = w.lead({ status: "replied", contacted_at: "2026-11-08T09:00:00.000Z", replied_at: "2026-11-09T09:00:00.000Z" });
  await w.api("POST", `/leads/${a}/contacted`, { method: "phone" });
  await w.api("POST", `/leads/${b}/contacted`, { method: "facebook", follow_up_on: "2026-11-15" }); await w.api("POST", `/leads/${b}/outreach`, { status: "follow_up", follow_up_on: "2026-11-15" });
  const ids = async (qs) => (await w.api("GET", "/leads/list" + qs)).body.leads.map((l) => l.id).sort();
  assert.deepEqual(await ids(""), [a, b, c, d, e].sort(), "everything remains accessible");
  assert.deepEqual(await ids("?outreach=any"), [a, b, d, e].sort());
  assert.deepEqual(await ids("?outreach=none"), [c]);
  assert.deepEqual(await ids("?outreach=contacted"), [a, d].sort());
  assert.deepEqual(await ids("?outreach=follow_up"), [b]);
  assert.deepEqual(await ids("?outreach=replied"), [e]);
  assert.deepEqual(await ids("?outreach=interested"), []);
  assert.deepEqual(await ids("?status=approved&outreach=any"), [a, b].sort(), "combines with the lifecycle filter, and approved leads stay approved");
  assert.equal((await w.api("GET", "/leads/list?outreach=bogus")).status, 422);
  const L = await w.api("GET", "/leads/list");
  assert.deepEqual(L.body.outreach_counts, { any: 4, none: 1, contacted: 2, replied: 1, interested: 0, not_interested: 0, follow_up: 1 });
  assert.equal(L.body.tracking, true);
  const row = L.body.leads.find((l) => l.id === b);
  assert.deepEqual([row.status, row.outreach.status, row.outreach.method, row.outreach.follow_up_on], ["approved", "follow_up", "facebook", "2026-11-15"]);
  assert.equal(L.body.leads.find((l) => l.id === c).outreach, null);
  const det = await w.api("GET", `/leads/${a}`);
  assert.equal(det.body.tracking, true); assert.equal(det.body.lead.outreach.method, "phone"); assert.equal(det.body.timeline.length, 1);
});

test("until migration 0026 is applied: the action says so, nothing is written, and the list, filter and detail keep working from the lifecycle", async () => {
  const w = world({ tracking: false });
  const id = w.lead({ status: "approved" }), emailed = w.lead({ status: "contacted", contacted_at: "2026-11-08T09:00:00.000Z" });
  for (const [p, body] of [[`/leads/${id}/contacted`, { method: "text" }], [`/leads/${id}/outreach`, { status: "replied" }]]) {
    const r = await w.api("POST", p, body);
    assert.equal(r.status, 409); assert.deepEqual(r.body, { error: "not_set_up", migration: MIG });
  }
  assert.equal(w.q("SELECT COUNT(*) AS n FROM outreach_events")[0].n, 0);
  const L = await w.api("GET", "/leads/list?outreach=any");
  assert.equal(L.status, 200); assert.deepEqual(L.body.leads.map((l) => l.id), [emailed]); assert.equal(L.body.tracking, false);
  assert.equal(L.body.leads[0].outreach.method, "email");
  const d = await w.api("GET", `/leads/${id}`); assert.equal(d.status, 200); assert.equal(d.body.tracking, false);
  const s = await w.api("GET", "/leads/status"); assert.deepEqual(s.body.setup.outreach_tracking, { ready: false, migration: MIG });
  // applying it later is noticed without a redeploy
  w.raw.exec(readFileSync(new URL("../../migrations/portal-proposed/" + MIG, import.meta.url), "utf8")); forgetLeadsReady(w.db);
  assert.equal((await w.api("POST", `/leads/${id}/contacted`, { method: "text" })).status, 200);
});

test("security: writes need the same-origin header, other methods are refused, and unknown or malformed ids are not found", async () => {
  const w = world();
  const id = w.lead();
  assert.equal((await w.api("POST", `/leads/${id}/contacted`, { method: "text" }, { write: false })).status, 403);
  assert.equal((await w.api("POST", `/leads/${id}/outreach`, { status: "replied" }, { write: false })).status, 403);
  assert.equal((await w.api("GET", `/leads/${id}/contacted`)).status, 405);
  assert.equal((await w.api("PUT", `/leads/${id}/outreach`, {})).status, 405);
  assert.equal((await w.api("POST", "/leads/not-an-id/contacted", { method: "text" })).status, 404);
  assert.equal(w.row(id).outreach_status, null);
  assert.equal((await logContact(w.env, id, { method: "text", note: "<img src=x onerror=1>" }, w.ctx)).ok, true, "text is stored as text; the UI only ever sets it as text");
});

test("Admin UI: the button sits beside Approve and Dismiss, uses the existing patterns, sets server text as text only, and says why when dormant", () => {
  const panel = readFileSync(new URL("../../admin/assets/lead-panel.js", import.meta.url), "utf8");
  const out = readFileSync(new URL("../../admin/assets/lead-outreach.js", import.meta.url), "utf8");
  const list = readFileSync(new URL("../../admin/assets/leads.js", import.meta.url), "utf8");
  const common = readFileSync(new URL("../../admin/assets/leads-common.js", import.meta.url), "utf8");
  for (const status of ["new", "approved", "ready"]) {
    const block = panel.slice(panel.indexOf(`l.status === "${status}"`), panel.indexOf("dismiss();", panel.indexOf(`l.status === "${status}"`)));
    assert.match(block, /markContacted\(\);\s*$/, `Mark as Contacted comes right before Dismiss for ${status}`);
  }
  assert.match(panel, /btn\("Mark as Contacted", "btn--secondary"/);
  assert.match(panel, /post\("\/contacted", r\)/); assert.match(out, /post\("\/outreach"/);
  assert.match(panel, /data\.tracking === false\) \{ b\.disabled = true/, "disabled with a reason until the migration is applied");
  assert.match(common, /not_set_up" && err && err\.data && err\.data\.migration === "0026_outreach_tracking\.sql"/);
  for (const [name, src] of [["lead-outreach.js", out], ["leads.js", list], ["lead-panel.js", panel]]) { assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML|document\.write|eval\(/.test(src), name + ": no HTML insertion"); assert.ok(!/style\s*=\s*"/.test(src) && !/\.style\./.test(src), name + ": no inline styles"); }
  for (const m of ["Text", "Email", "Phone", "Facebook", "Other"]) assert.ok(common.includes(`"${m}"]`), m);
  for (const s of ["Contacted", "Replied", "Interested", "Not interested", "Follow-up needed"]) assert.ok(common.includes(`"${s}"]`), s);
  assert.match(list, /ld-outsel/); assert.match(list, /outreach=\$\{encodeURIComponent\(outreach\)\}/);
});
