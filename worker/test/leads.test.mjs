// Admin Leads workspace: finder import, lifecycle, drafting, sending pipeline, unsubscribe, delivery webhook, Admin API (worker/leads.js, worker/admin/leads-api.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { openPortalDb } from "./helpers/portal-db.mjs";
import worker from "../index.js";
import { handleAdmin } from "../admin/router.js";
import { handleLeadsApi } from "../admin/leads-api.js";
import { sendEmail } from "../assessment.js";
import { tokenForLinkId, newLinkId } from "../demo-traffic.js";
import {
  buildReason, dedupeKey, contactEligibility, composeDraft, composeFollowup, lintFirstEmail, wordCount, finderSelect, syncFinder, unsubscribeToken, verifyUnsubscribeToken,
  handleUnsubscribe, handleLeadsWebhook, verifySvix, sendingMode, APPROACHES, UNSUBSCRIBE_CSS, forgetLeadsReady,
} from "../leads.js";

const ORIGIN = "https://staging.frameworkco.ca";
const PEPPER = "p".repeat(40);
const NOW = new Date("2026-11-06T12:00:00.000Z");
const DAY = 86400000;
const WHSEC_BYTES = Buffer.from("webhook-secret-bytes-0123456789");
const WHSEC = "whsec_" + WHSEC_BYTES.toString("base64");

/* ---------------- fakes ---------------- */

function d1(raw, spy) {
  return {
    prepare(sql) {
      spy && spy.push(sql);
      let params = [];
      const stmt = { sql, bind(...p) { params = p; return stmt; }, all: async () => ({ results: raw.prepare(sql).all(...params) }), first: async () => raw.prepare(sql).get(...params) ?? null, run: async () => { const r = raw.prepare(sql).run(...params); return { meta: { changes: Number(r.changes) } }; } };
      return stmt;
    },
  };
}

function finderDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`CREATE TABLE leads (id INTEGER PRIMARY KEY, place_id TEXT UNIQUE, name TEXT, trade TEXT, city TEXT, address TEXT, maps_url TEXT, website TEXT, rating REAL, review_count INTEGER, last_review_at TEXT,
    site_status TEXT, site_score INTEGER, site_issues TEXT, no_solicit INTEGER DEFAULT 0, status TEXT, disqualify_reason TEXT, created_at TEXT, enriched_at TEXT, reviewed_at TEXT);
    CREATE TABLE contacts (id INTEGER PRIMARY KEY, lead_id INTEGER, type TEXT, value TEXT, source_url TEXT, found_at TEXT, UNIQUE (lead_id, type, value));`);
  const spy = [];
  let n = 0;
  const add = (o = {}) => {
    n++;
    const row = { place_id: "pl" + n, name: "Lead " + n, trade: "fence", city: "Calgary", website: null, rating: 4.6, review_count: 77, last_review_at: null, site_status: "none", site_issues: "[]", no_solicit: 0, status: "qualified", ...o };
    const { contacts = [], ...cols } = row;
    const r = raw.prepare(`INSERT INTO leads (place_id, name, trade, city, address, maps_url, website, rating, review_count, last_review_at, site_status, site_score, site_issues, no_solicit, status, created_at) VALUES (?, ?, ?, ?, '1 Main St', 'https://maps.example/x', ?, ?, ?, ?, ?, 10, ?, ?, ?, '2026-10-01')`)
      .run(cols.place_id, cols.name, cols.trade, cols.city, cols.website, cols.rating, cols.review_count, cols.last_review_at, cols.site_status, cols.site_issues, cols.no_solicit, cols.status);
    for (const c of contacts) raw.prepare("INSERT INTO contacts (lead_id, type, value, source_url, found_at) VALUES (?, ?, ?, ?, '2026-10-02')").run(Number(r.lastInsertRowid), c.type, c.value, c.source_url ?? null);
    return Number(r.lastInsertRowid);
  };
  return { raw, db: d1(raw, spy), spy, add, dump: () => JSON.stringify([raw.prepare("SELECT * FROM leads").all(), raw.prepare("SELECT * FROM contacts").all()]) };
}

function world({ migrated = true, finder = true, env = {} } = {}) {
  const db = openPortalDb({ skip: migrated ? ["0025_seo_leads.sql"] : ["0021_demo_traffic.sql", "0024_leads.sql", "0025_seo_leads.sql"] });
  const f = finder ? finderDb() : null;
  const w = { db, raw: db.raw, f, calls: [], clock: new Date(NOW), delay: 0 };
  w.fetch = async (url, init) => {
    const call = { url, headers: init.headers, body: JSON.parse(init.body) };
    w.calls.push(call);
    if (w.delay) await new Promise((r) => setTimeout(r, w.delay));
    return new Response(JSON.stringify({ id: "re_" + w.calls.length }), { status: 200 });
  };
  w.env = {
    PORTAL_DB: db, ...(f ? { LEADGEN_DB: f.db } : {}), DEMO_LINK_SECRET: "s".repeat(40), RESEND_API_KEY: "re_test", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "owner@frameworkco.ca",
    LEADS_SENDER_NAME: "Alex", LEADS_MAILING_ADDRESS: "Framework, 1 Example Rd SW, Calgary AB T2P 0A0", LEADS_SENDING: "1", RESEND_WEBHOOK_SECRET: WHSEC, ...env,
  };
  w.deps = { now: () => w.clock, fetch: w.fetch };
  w.q = (sql, ...p) => db.raw.prepare(sql).all(...p).map((r) => ({ ...r }));
  w.api = async (method, path, body, { origin = ORIGIN, headers = {}, write = true } = {}) => {
    const h = { ...(write && method !== "GET" ? { Origin: origin, "X-Framework-Admin": "1" } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers };
    const r = await handleLeadsApi(new Request(ORIGIN + "/api/admin" + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), w.env, { email: "owner@frameworkco.ca" }, path.split("?")[0], w.deps);
    const text = await r.text();
    return { status: r.status, body: text && r.headers.get("Content-Type").includes("json") ? JSON.parse(text) : text, headers: r.headers };
  };
  return w;
}

const SITE = "https://summitfencing.ca";
const eligibleLead = (o = {}) => ({ name: "Summit Fencing", website: SITE, site_status: "outdated", site_issues: '["No HTTPS","Not mobile-friendly"]', contacts: [{ type: "email", value: "Info@SummitFencing.ca", source_url: SITE + "/contact" }, { type: "phone", value: "403-555-0100" }], ...o });
const leadId = (w, name = "Summit Fencing") => w.q("SELECT id FROM outreach_leads WHERE name = ?", name)[0].id;
const lead = (w, id) => w.q("SELECT * FROM outreach_leads WHERE id = ?", id)[0];
const msgs = (w, id, extra = "") => w.q(`SELECT * FROM outreach_messages WHERE lead_id = ? ${extra} ORDER BY created_at, rowid`, id);

/** Imports the lead, approves it and its email: ready to send. */
async function ready(w, o = {}) {
  w.f.add(eligibleLead(o));
  assert.equal((await w.api("POST", "/leads/sync")).status, 200);
  const id = leadId(w, o.name || "Summit Fencing");
  assert.equal((await w.api("POST", `/leads/${id}/approve`, {})).status, 200);
  const a = await w.api("POST", `/leads/${id}/message/approve`, {});
  assert.equal(a.status, 200, JSON.stringify(a.body));
  return id;
}
const previewHash = async (w, id) => (await w.api("POST", "/leads/send/preview", { ids: [id] })).body.emails[0];
const sendLead = async (w, id) => { const p = await previewHash(w, id); return (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0]; };

/* ---------------- pure pieces ---------------- */

test("reason strings are specific, built only from the data", () => {
  const d28 = new Date(NOW.getTime() - 28 * DAY).toISOString();
  assert.equal(buildReason({ site_status: "none", rating: 4.6, review_count: 77, last_review_at: d28 }, NOW), "No website; 4.6 stars from 77 reviews, latest review 28 days ago.");
  // "doesn't load" is only ever said of a site a check confirmed offline; the finder's own claim ("broken") is unconfirmed, and online/unverified say what they are
  assert.equal(buildReason({ site_status: "offline", website: "https://www.totalfencinginc.com/", rating: 4.9, review_count: 58 }, NOW), "Website doesn't load (totalfencinginc.com); 4.9 stars from 58 reviews.");
  assert.equal(buildReason({ site_status: "broken", website: "https://www.totalfencinginc.com/", rating: 4.9, review_count: 58 }, NOW), "Finder reported the website as not loading (totalfencinginc.com); not confirmed yet; 4.9 stars from 58 reviews.");
  assert.equal(buildReason({ site_status: "unverified", website: "https://www.totalfencinginc.com/", rating: 4.9, review_count: 58 }, NOW), "Website couldn't be checked automatically (totalfencinginc.com); it may be protected, not offline; 4.9 stars from 58 reviews.");
  assert.equal(buildReason({ site_status: "online", website: "https://www.totalfencinginc.com/", rating: 4.9, review_count: 58 }, NOW), "Website is online (totalfencinginc.com); 4.9 stars from 58 reviews.");
  assert.equal(buildReason({ site_status: "social_only", website: "https://facebook.com/x", rating: 5, review_count: 17 }, NOW), "Only a Facebook page; 5.0 stars from 17 reviews.");
  assert.equal(buildReason({ site_status: "outdated", website: "https://a.ca", site_issues: '["No HTTPS","Not mobile-friendly"]', rating: 4.4, review_count: 31 }, NOW), "Outdated site: no HTTPS, not mobile-friendly; 4.4 stars from 31 reviews.");
  assert.equal(buildReason({ site_status: "none" }, NOW), "No website.");
  assert.equal(buildReason({ site_status: "none", rating: 4, review_count: 1 }, NOW, { oldFinder: true }), "No website; 4.0 stars from 1 review. Approved in the old finder dashboard.");
});

test("dedupe key: the website host (without www) for a real site, else name and city", () => {
  assert.equal(dedupeKey({ website: "https://www.Summit.ca/about", site_status: "outdated", name: "A", city: "B" }), "summit.ca");
  assert.equal(dedupeKey({ website: "https://facebook.com/summit", site_status: "social_only", name: "Summit Fencing", city: "Calgary" }), "summit fencing|calgary");
  assert.equal(dedupeKey({ website: "https://facebook.com/summit", site_status: "outdated", name: "Summit  Fencing", city: "Calgary" }), "summit fencing|calgary", "a social page is not a site of their own");
  assert.equal(dedupeKey({ website: null, site_status: "none", name: "X", city: null }), "x|");
});

test("contact eligibility: only an address published on the business's own site is eligible; the rest needs the owner; suppressed is blocked; phones are never emailed", () => {
  const l = { website: SITE, site_status: "outdated", no_solicit: 0 };
  assert.deepEqual(contactEligibility({ type: "email", value: " Info@SummitFencing.CA ", source_url: SITE + "/contact" }, l), { type: "email", value: "info@summitfencing.ca", eligibility: "eligible", note: `Published at ${SITE}/contact`, source_url: SITE + "/contact" });
  assert.equal(contactEligibility({ type: "email", value: "a@b.ca", source_url: null }, l).eligibility, "review");
  assert.equal(contactEligibility({ type: "email", value: "a@b.ca", source_url: "https://facebook.com/x" }, l).eligibility, "review");
  assert.equal(contactEligibility({ type: "email", value: "a@b.ca", source_url: SITE + "/c" }, { ...l, site_status: "none" }).eligibility, "review", "no site of their own");
  assert.equal(contactEligibility({ type: "email", value: "a@summitfencing.ca", source_url: SITE + "/c" }, { ...l, no_solicit: 1 }).eligibility, "review");
  assert.equal(contactEligibility({ type: "email", value: "info@summitfencing.ca", source_url: SITE + "/c" }, l, new Set(["info@summitfencing.ca"])).eligibility, "blocked");
  assert.equal(contactEligibility({ type: "email", value: "a@b.ca" }, l, new Set(), "manual").eligibility, "review");
  assert.equal(contactEligibility({ type: "email", value: "not-an-email" }, l), null);
  const p = contactEligibility({ type: "phone", value: "403-555-0100" }, l);
  assert.equal(p.eligibility, "review"); assert.equal(p.note, "Phone only: not emailed");
});

test("drafting: three approaches differ, carry the demo link and the owner's background, 90 to 150 words, no pricing, deterministic", () => {
  const DEMO = "https://staging.frameworkco.ca/d/AAAAAAAAAAAAAAAAAAAAAA";
  const variants = [
    { name: "Summit Fencing", trade: "fence", city: "Calgary", site_status: "none", rating: 4.6, review_count: 77 },
    { name: "Summit Fencing", trade: "Fence & Deck", city: "Calgary", site_status: "social_only", website: "https://facebook.com/summit", rating: 5, review_count: 17 },
    { name: "Total Fencing", trade: "fence", city: "Airdrie", site_status: "offline", website: "https://totalfencinginc.com", rating: 4.9, review_count: 58 },
    { name: "Peak Decks", trade: "deck builder", city: "Calgary", site_status: "outdated", website: "https://peakdecks.ca", site_issues: '["No HTTPS","Not mobile-friendly","Slow to load"]', rating: 4.4, review_count: 31 },
    { name: "No Rating Co", trade: "renovation", city: "", site_status: "none" },
  ];
  for (const v of variants) {
    const drafts = APPROACHES.map((a) => composeDraft(v, { demoUrl: DEMO, approach: a.id, senderName: "Alex" }));
    for (const [i, d] of drafts.entries()) {
      const label = `${v.name}/${APPROACHES[i].id}`;
      assert.ok(d.body.includes(DEMO), label + " has the demo link");
      assert.match(d.body, /carpenter in Calgary/, label); assert.match(d.body, /10,000 hours/, label);
      assert.equal(lintFirstEmail(d.subject, d.body), null, label + " has no pricing: " + d.subject + " / " + d.body);
      const words = wordCount(d.body);
      assert.ok(words >= 90 && words <= 150, `${label}: ${words} words`);
      assert.ok(d.subject.length > 5 && d.subject.length <= 70 && !/^re:/i.test(d.subject) && !/[!]/.test(d.subject), label + " subject: " + d.subject);
      assert.match(d.body, /\n- Alex\nFramework$/);
      assert.ok(!/\bundefined\b|\bnull\b|\{|\}/.test(d.subject + d.body), label);
    }
    if (v.rating) assert.equal(new Set(drafts.map((d) => d.body)).size, 3, v.name + ": three different bodies");
    assert.equal(new Set(drafts.map((d) => d.subject)).size >= 2, true);
    assert.deepEqual(composeDraft(v, { demoUrl: DEMO, approach: "demo", senderName: "Alex" }), drafts[1], "deterministic");
  }
  assert.match(composeDraft(variants[2], { demoUrl: DEMO }).body, /\(totalfencinginc\.com\) and it doesn't load/);
  assert.match(composeDraft(variants[0], { demoUrl: DEMO }).body, /\n- Framework$/, "no sender name: signed once");
  const f = composeFollowup(variants[0], { demoUrl: DEMO, senderName: "Alex" });
  assert.ok(f.body.includes(DEMO) && lintFirstEmail(f.subject, f.body) === null);
});

test("the pricing lint catches money, rates, quotes, discounts and free; and leaves ordinary words alone", () => {
  for (const bad of ["It's $500", "only $ 99", "our pricing", "the price", "no cost", "great rates", "a rate of", "get a quote", "$0 down", "per month", "monthly plan", "10% discount", "totally free", "Free demo"]) assert.ok(lintFirstEmail("Hello", bad) !== null || /rate of/.test(bad), bad);
  assert.ok(lintFirstEmail("Hello", "a free website") !== null);
  for (const ok of ["4.6 stars from 77 reviews", "a freelance carpenter", "accurate rating", "price-less"]) assert.equal(lintFirstEmail("Hi", ok), ok === "price-less" ? "price" : null, ok);
  assert.ok(lintFirstEmail("Free quote", "hello"), "the subject is checked too");
});

/* ---------------- finder sync ---------------- */

test("sync imports only qualified or approved, not do-not-solicit, not-ok-site finder rows; maps every field; is idempotent", async () => {
  const w = world();
  const d28 = new Date(NOW.getTime() - 28 * DAY).toISOString();
  w.f.add({ name: "No Site Co", site_status: "none", last_review_at: d28 });
  w.f.add({ name: "Old Dash Co", status: "approved", site_status: "broken", website: "https://www.totalfencinginc.com", rating: 4.9, review_count: 58 });
  w.f.add({ name: "FB Co", site_status: "social_only", website: "https://facebook.com/fbco", rating: 5, review_count: 17 });
  w.f.add(eligibleLead({ rating: 4.4, review_count: 31 }));
  for (const [name, o] of [["Good Site", { site_status: "ok", website: "https://good.ca" }], ["Nope", { no_solicit: 1 }], ["DQ", { status: "disqualified" }], ["Rej", { status: "rejected" }], ["Fresh", { status: "new" }]]) w.f.add({ name, ...o });
  const r = await w.api("POST", "/leads/sync");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { imported: 4, skipped: 0, waiting: 0, assessed: 0 });
  assert.deepEqual(w.q("SELECT name FROM outreach_leads ORDER BY name").map((x) => x.name), ["FB Co", "No Site Co", "Old Dash Co", "Summit Fencing"]);
  const by = (n) => lead(w, leadId(w, n));
  assert.equal(by("No Site Co").reason, "No website; 4.6 stars from 77 reviews, latest review 28 days ago.");
  assert.equal(by("Old Dash Co").reason, "Finder reported the website as not loading (totalfencinginc.com); not confirmed yet; 4.9 stars from 58 reviews. Approved in the old finder dashboard.");
  assert.equal(by("Old Dash Co").site_status, "broken", "the finder's claim is stored as it was, and stays unconfirmed until a check runs");
  assert.equal(by("FB Co").reason, "Only a Facebook page; 5.0 stars from 17 reviews.");
  assert.equal(by("Summit Fencing").reason, "Outdated site: no HTTPS, not mobile-friendly; 4.4 stars from 31 reviews.");
  const s = by("Summit Fencing");
  assert.equal(s.status, "new"); assert.equal(s.source, "finder"); assert.match(s.source_ref, /^pl\d+$/); assert.equal(s.dedupe_key, "summitfencing.ca"); assert.equal(s.trade, "fence"); assert.equal(s.city, "Calgary");
  assert.deepEqual(JSON.parse(s.site_issues), ["No HTTPS", "Not mobile-friendly"]);
  assert.equal(by("Old Dash Co").status, "new", "approved in the old dashboard still arrives as new");
  assert.deepEqual(w.q("SELECT type, value, source, eligibility, eligibility_note FROM outreach_contacts WHERE lead_id = ? ORDER BY type", s.id), [
    { type: "email", value: "info@summitfencing.ca", source: "finder", eligibility: "eligible", eligibility_note: "Published at https://summitfencing.ca/contact" },
    { type: "phone", value: "403-555-0100", source: "finder", eligibility: "review", eligibility_note: "Phone only: not emailed" },
  ]);
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'imported'")[0].n, 4);
  const again = await w.api("POST", "/leads/sync");
  assert.deepEqual(again.body, { imported: 0, skipped: 4, waiting: 0, assessed: 0 });
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_leads")[0].n, 4);
});

test("sync: a dismissed lead stays dismissed and nothing is overwritten, even when the finder row changes", async () => {
  const w = world();
  const fid = w.f.add({ name: "Dismissed Co", site_status: "none" });
  await w.api("POST", "/leads/sync");
  const id = leadId(w, "Dismissed Co");
  assert.equal((await w.api("POST", `/leads/${id}/dismiss`, { reason: "Not a fit" })).status, 200);
  w.f.raw.prepare("UPDATE leads SET name = 'Renamed', status = 'approved', rating = 1, website = 'https://new.example', site_status = 'broken' WHERE id = ?").run(fid);
  const r = await w.api("POST", "/leads/sync");
  assert.equal(r.body.imported, 0);
  const l = lead(w, id);
  assert.equal(l.status, "dismissed"); assert.equal(l.name, "Dismissed Co"); assert.equal(l.dismiss_reason, "Not a fit"); assert.equal(l.rating, 4.6);
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_leads")[0].n, 1);
});

test("sync dedupes: the same finder place, the same website host, and the same name in the same city", async () => {
  const w = world();
  w.f.add({ name: "A", place_id: "samePlace", site_status: "outdated", website: "https://a-fence.ca" });
  await w.api("POST", "/leads/sync");
  w.f.raw.prepare("UPDATE leads SET website = 'https://other-host.ca' WHERE place_id = 'samePlace'").run(); // the same place, now with another dedupe key
  w.f.add({ name: "B1", site_status: "outdated", website: "https://www.b-fence.ca/" });
  w.f.add({ name: "B2 (second listing)", site_status: "broken", website: "https://b-fence.ca" });
  w.f.add({ name: "Twin Fencing", site_status: "none", city: "Airdrie" });
  w.f.add({ name: "TWIN  fencing", site_status: "none", city: "airdrie" });
  w.f.add({ name: "Twin Fencing", site_status: "none", city: "Calgary" });
  const r = await w.api("POST", "/leads/sync");
  assert.equal(r.body.imported, 3, "B1, one Twin in Airdrie, one Twin in Calgary");
  assert.equal(r.body.waiting, 0, "duplicates are not 'waiting'");
  assert.deepEqual(w.q("SELECT name FROM outreach_leads ORDER BY name").map((x) => x.name), ["A", "B1", "Twin Fencing", "Twin Fencing"]);
});

test("sync: suppressed addresses arrive blocked, an invalid email is dropped, and no usable site means a found email needs review", async () => {
  const w = world();
  w.raw.prepare("INSERT INTO outreach_suppressions (email, reason, at) VALUES ('gone@summitfencing.ca', 'optout', '2026-10-01')").run();
  w.f.add(eligibleLead({ contacts: [{ type: "email", value: "gone@summitfencing.ca", source_url: SITE + "/c" }, { type: "email", value: "broken-address" }, { type: "email", value: "x@gmail.com", source_url: null }] }));
  w.f.add({ name: "No Site", site_status: "none", contacts: [{ type: "email", value: "a@b.ca", source_url: "https://yelp.com/biz/x" }] });
  await w.api("POST", "/leads/sync");
  assert.deepEqual(w.q("SELECT value, eligibility FROM outreach_contacts WHERE lead_id = ? ORDER BY value", leadId(w)), [{ value: "gone@summitfencing.ca", eligibility: "blocked" }, { value: "x@gmail.com", eligibility: "review" }]);
  assert.equal(w.q("SELECT eligibility FROM outreach_contacts WHERE lead_id = ?", leadId(w, "No Site"))[0].eligibility, "review");
});

test("the finder database is never written: only SELECT statements ever reach LEADGEN_DB, and its data is unchanged", async () => {
  const w = world();
  w.f.add(eligibleLead());
  w.f.add({ name: "Other", site_status: "none" });
  const before = w.f.dump();
  await w.api("GET", "/leads/status");
  await w.api("POST", "/leads/sync");
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  await w.api("POST", `/leads/${id}/approve`, {}); await w.api("POST", `/leads/${id}/dismiss`, {}); await w.api("GET", "/leads/list"); await w.api("GET", `/leads/${id}`);
  assert.ok(w.f.spy.length >= 3);
  for (const sql of w.f.spy) assert.match(sql, /^\s*SELECT\b/i, sql);
  assert.equal(w.f.dump(), before);
  for (const bad of ["DELETE FROM leads", "UPDATE leads SET status = 'x'", "INSERT INTO leads (id) VALUES (1)", "SELECT 1; DROP TABLE leads", "PRAGMA writable_schema = 1", "  drop table leads"]) await assert.rejects(() => finderSelect(w.f.db, bad), /finder_read_only/, bad);
  assert.equal(w.f.dump(), before);
});

test("without LEADGEN_DB the sync is a quiet no-op", async () => {
  const w = world({ finder: false });
  assert.deepEqual((await w.api("POST", "/leads/sync")).body, { imported: 0, skipped: 0, waiting: 0 });
  assert.deepEqual(await syncFinder({ PORTAL_DB: w.db }, {}), { imported: 0, skipped: 0, waiting: 0 });
});

/* ---------------- approve, draft, edit ---------------- */

test("approve creates exactly one tracking link and one first draft, is idempotent, and records who", async () => {
  const w = world();
  w.f.add(eligibleLead());
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  const [a, b] = await Promise.all([w.api("POST", `/leads/${id}/approve`, {}), w.api("POST", `/leads/${id}/approve`, {})]); // a double click
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal((await w.api("POST", `/leads/${id}/approve`, {})).status, 200);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_links")[0].n, 1);
  assert.equal(msgs(w, id).length, 1);
  const l = lead(w, id);
  assert.equal(l.status, "approved"); assert.ok(l.approved_at); assert.match(l.demo_link_id, /^[0-9a-f]{16}$/);
  const link = w.q("SELECT * FROM demo_links")[0];
  assert.equal(link.id, l.demo_link_id); assert.equal(link.label, "Summit Fencing"); assert.equal(link.created_by, "owner@frameworkco.ca");
  const m = msgs(w, id)[0];
  assert.equal(m.status, "draft"); assert.equal(m.kind, "first"); assert.equal(m.approach, "observation"); assert.equal(m.to_email, "info@summitfencing.ca");
  const token = await tokenForLinkId("s".repeat(40), link.id);
  assert.ok(m.body.includes(`${ORIGIN}/d/${token}`));
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'approved'")[0].n, 1);
});

test("approve with no signing key fails cleanly with 409 secret_missing and changes nothing", async () => {
  const w = world({ env: { DEMO_LINK_SECRET: undefined } });
  w.f.add(eligibleLead());
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  const r = await w.api("POST", `/leads/${id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.error, "secret_missing");
  assert.equal(lead(w, id).status, "new"); assert.equal(w.q("SELECT count(*) AS n FROM demo_links")[0].n, 0); assert.equal(msgs(w, id).length, 0);
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'approved'")[0].n, 0);
  const bulk = await w.api("POST", "/leads/bulk", { action: "approve", ids: [id] });
  assert.deepEqual(bulk.body.results, [{ id, ok: false, error: "secret_missing" }]);
});

test("a dismissed lead cannot be approved until it is reopened; reopen works only if never contacted", async () => {
  const w = world();
  w.f.add(eligibleLead());
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  await w.api("POST", `/leads/${id}/dismiss`, {});
  assert.equal((await w.api("POST", `/leads/${id}/approve`, {})).body.error, "lead_dismissed");
  assert.equal((await w.api("POST", `/leads/${id}/reopen`, {})).body.lead.status, "new");
  assert.equal((await w.api("POST", `/leads/${id}/reopen`, {})).status, 409, "not dismissed any more");
  assert.equal((await w.api("POST", `/leads/${id}/approve`, {})).status, 200);
  const ready2 = await w.api("POST", `/leads/${id}/message/approve`, {});
  assert.equal(ready2.status, 200);
  await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: ready2.body.message.content_hash }] });
  w.raw.prepare("UPDATE outreach_leads SET status = 'dismissed', dismiss_reason = NULL WHERE id = ?").run(id);
  assert.equal((await w.api("POST", `/leads/${id}/reopen`, {})).body.error, "already_contacted");
});

test("the panel shows the draft with the read-only footer, and a pricing word in the first email is refused on approve", async () => {
  const w = world();
  w.f.add(eligibleLead());
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  await w.api("POST", `/leads/${id}/approve`, {});
  const d = (await w.api("GET", `/leads/${id}`)).body;
  assert.match(d.message.footer, /^--\nFramework\nFramework, 1 Example Rd SW, Calgary AB T2P 0A0\nI'm writing because your address is published at https:\/\/summitfencing\.ca\/contact\.\nNot interested\? Unsubscribe: https:\/\/staging\.frameworkco\.ca\/u\/[A-Za-z0-9_-]{22}$/);
  assert.ok(!d.message.body.includes("Unsubscribe"), "the footer is not part of the editable body");
  assert.deepEqual(d.approaches.map((a) => a.id), ["observation", "demo", "reputation"]);
  assert.ok(d.message.blockers.includes("The email is not approved yet"));
  const e = await w.api("PUT", `/leads/${id}/message`, { subject: "Hello", body: "Our pricing is $99 a month. Reply here.\n\n- Alex" });
  assert.equal(e.status, 200);
  const a = await w.api("POST", `/leads/${id}/message/approve`, {});
  assert.equal(a.status, 422); assert.equal(a.body.error, "pricing_in_first_email");
  assert.equal(msgs(w, id)[0].status, "draft");
  await w.api("PUT", `/leads/${id}/message`, { subject: "Free demo for you", body: "Hello there" });
  assert.equal((await w.api("POST", `/leads/${id}/message/approve`, {})).body.error, "pricing_in_first_email", "the subject is linted too");
});

test("choosing an approach rewrites the draft in place; editing an approved email returns it to draft and the lead from ready to approved", async () => {
  const w = world();
  const id = await ready(w);
  assert.equal(lead(w, id).status, "ready");
  const hashBefore = msgs(w, id)[0].content_hash;
  assert.match(hashBefore, /^[0-9a-f]{64}$/);
  const e = await w.api("PUT", `/leads/${id}/message`, { subject: "A short note", body: "Hi,\n\nA new body.\n\n- Alex" });
  assert.equal(e.status, 200); assert.equal(e.body.message.status, "draft"); assert.equal(e.body.message.content_hash, null);
  assert.equal(lead(w, id).status, "approved");
  const d = await w.api("POST", `/leads/${id}/draft`, { approach: "demo" });
  assert.equal(d.status, 200); assert.equal(d.body.message.approach, "demo"); assert.equal(msgs(w, id).length, 1, "replaced, not duplicated");
  assert.equal((await w.api("POST", `/leads/${id}/draft`, { approach: "pitch" })).status, 422);
  await w.api("POST", `/leads/${id}/message/approve`, {});
  assert.equal(lead(w, id).status, "ready");
  const u = await w.api("POST", `/leads/${id}/message/unapprove`, {});
  assert.equal(u.body.message.status, "draft"); assert.equal(lead(w, id).status, "approved");
  assert.equal((await w.api("PUT", `/leads/${id}/message`, { subject: "", body: "x" })).status, 422);
  assert.equal((await w.api("PUT", `/leads/${id}/message`, { subject: "x", body: "x", contact_id: 99999 })).status, 422);
});

test("approving the email needs an eligible recipient; the owner confirms a 'review' address, and that never un-blocks a suppressed one", async () => {
  const w = world();
  w.f.add({ name: "Review Co", site_status: "none", contacts: [{ type: "email", value: "boss@gmail.com", source_url: null }, { type: "phone", value: "587 555 0111" }] });
  await w.api("POST", "/leads/sync");
  const id = leadId(w, "Review Co");
  const l0 = (await w.api("GET", "/leads/list")).body.leads[0];
  assert.equal(l0.has_email, true); assert.equal(l0.has_eligible_email, false); assert.equal(l0.phone, "587 555 0111");
  await w.api("POST", `/leads/${id}/approve`, {});
  assert.equal(msgs(w, id)[0].to_email, null);
  const no = await w.api("POST", `/leads/${id}/message/approve`, {});
  assert.equal(no.status, 422); assert.equal(no.body.error, "no_eligible_recipient");
  const phone = w.q("SELECT id FROM outreach_contacts WHERE type = 'phone'")[0].id;
  assert.equal((await w.api("POST", `/leads/${id}/contacts/${phone}`, { eligibility: "eligible" })).status, 422, "a phone number can never be a recipient");
  const email = w.q("SELECT id FROM outreach_contacts WHERE type = 'email'")[0].id;
  assert.equal((await w.api("POST", `/leads/${id}/contacts/${email}`, { eligibility: "blocked" })).status, 422);
  const c = await w.api("POST", `/leads/${id}/contacts/${email}`, { eligibility: "eligible" });
  assert.equal(c.status, 200); assert.equal(c.body.contact.eligibility, "eligible");
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'contact_confirmed'")[0].n, 1);
  assert.equal(msgs(w, id)[0].to_email, "boss@gmail.com", "the draft picks up the confirmed address");
  assert.equal((await w.api("POST", `/leads/${id}/message/approve`, {})).status, 200);
  // a manual address starts as 'review'; a suppressed one is blocked and cannot be confirmed
  const m = await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "Second@Example.com", source_url: "https://example.com/team" });
  assert.equal(m.status, 201); assert.equal(m.body.contact.eligibility, "review"); assert.equal(m.body.contact.value, "second@example.com"); assert.equal(m.body.contact.source, "manual");
  assert.equal((await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "second@example.com" })).status, 409);
  w.raw.prepare("INSERT INTO outreach_suppressions (email, reason, at) VALUES ('bad@example.com', 'bounce', '2026-10-01')").run();
  const bl = await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "bad@example.com" });
  assert.equal(bl.body.contact.eligibility, "blocked");
  assert.equal((await w.api("POST", `/leads/${id}/contacts/${bl.body.contact.id}`, { eligibility: "eligible" })).body.error, "blocked");
  assert.equal((await w.api("POST", `/leads/${id}/contacts`, { type: "phone", value: "403-555-9999" })).body.contact.eligibility, "review");
  assert.equal((await w.api("POST", `/leads/${id}/contacts`, { type: "fax", value: "1" })).status, 422);
  assert.equal((await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "nope" })).status, 422);
  assert.equal((await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "a@b.ca", source_url: "javascript:alert(1)" })).status, 422);
});

/* ---------------- sending ---------------- */

test("a content-hash mismatch refuses the send: tampering with the stored text after approval sends nothing", async () => {
  const w = world();
  const id = await ready(w);
  const p = await previewHash(w, id);
  assert.deepEqual(p.blockers, []);
  w.raw.prepare("UPDATE outreach_messages SET body = body || ' Also: tampered.' WHERE lead_id = ?").run(id);
  let r = (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0];
  assert.deepEqual([r.ok, r.error], [false, "hash_mismatch"]);
  w.raw.prepare("UPDATE outreach_messages SET body = replace(body, ' Also: tampered.', '') WHERE lead_id = ?").run(id);
  r = (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: "0".repeat(64) }] })).body.results[0];
  assert.equal(r.error, "hash_mismatch", "a hash the owner did not see");
  assert.equal(w.calls.length, 0);
  assert.equal(msgs(w, id)[0].status, "approved");
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: "nothex" }] })).status, 422);
  w.env.LEADS_MAILING_ADDRESS = "Another address"; // the footer is part of the hash
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].error, "hash_mismatch");
});

test("live send: the lead becomes contacted; the provider gets the unsubscribe headers, a per-message idempotency key, the owner as Reply-To and the exact text", async () => {
  const w = world();
  const id = await ready(w);
  const p = await previewHash(w, id);
  const r = await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] });
  assert.deepEqual(r.body.results, [{ lead_id: id, ok: true, status: "sent" }]);
  assert.equal(w.calls.length, 1);
  const c = w.calls[0], m = msgs(w, id)[0];
  assert.equal(c.body.to[0], "info@summitfencing.ca"); assert.equal(c.body.subject, m.subject); assert.equal(c.body.reply_to, "owner@frameworkco.ca");
  assert.equal(c.headers["Idempotency-Key"], "lead-msg-" + m.id);
  assert.equal(c.body.text, `${p.body}\n\n${p.footer}`);
  const token = p.footer.match(/\/u\/([A-Za-z0-9_-]{22})/)[1];
  assert.equal(c.body.headers["List-Unsubscribe"], `<${ORIGIN}/u/${token}>`); assert.equal(c.body.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(await verifyUnsubscribeToken("s".repeat(40), token), m.id);
  assert.equal(m.status, "sent"); assert.equal(m.provider_id, "re_1"); assert.ok(m.sent_at); assert.equal(m.is_test, 0);
  const l = lead(w, id);
  assert.equal(l.status, "contacted"); assert.ok(l.contacted_at);
  // a second send of the same message finds nothing approved
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].ok, false);
  assert.equal(w.calls.length, 1);
});

test("atomic claim: two concurrent sends of the same message make exactly ONE provider call", async () => {
  const w = world();
  const id = await ready(w);
  const p = await previewHash(w, id);
  w.delay = 20;
  const item = { lead_id: id, hash: p.hash };
  const [a, b, c] = await Promise.all([1, 2, 3].map(() => w.api("POST", "/leads/send", { items: [item] })));
  assert.equal(w.calls.length, 1);
  const results = [a, b, c].map((x) => x.body.results[0]);
  assert.equal(results.filter((x) => x.ok).length, 1);
  assert.ok(results.filter((x) => !x.ok).every((x) => ["already_sending", "not_approved", "lead_inactive"].includes(x.error)), JSON.stringify(results));
  assert.equal(msgs(w, id)[0].status, "sent");
});

test("a failed provider call marks the message failed, puts the lead back to approved, and it can be approved and retried with the same idempotency key", async () => {
  const w = world();
  const id = await ready(w);
  const p = await previewHash(w, id);
  const ok = w.fetch;
  w.deps.fetch = async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 422 });
  const r = (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0];
  assert.deepEqual([r.ok, r.error], [false, "send_failed"]);
  const m = msgs(w, id)[0];
  assert.equal(m.status, "failed"); assert.match(m.error, /provider 422: Domain not verified/); assert.equal(lead(w, id).status, "approved");
  w.deps.fetch = ok;
  assert.equal((await w.api("POST", `/leads/${id}/message/approve`, {})).status, 200);
  const p2 = await previewHash(w, id);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p2.hash }] })).body.results[0].ok, true);
  assert.equal(w.calls[0].headers["Idempotency-Key"], "lead-msg-" + m.id);
  assert.equal(msgs(w, id).length, 1);
});

test("a second first email for the same lead is refused by the partial unique index and by the API; test copies are exempt", async () => {
  const w = world();
  const id = await ready(w);
  const ins = (status, test = 0) => w.raw.prepare("INSERT INTO outreach_messages (id, lead_id, kind, subject, body, status, is_test, created_at) VALUES (?, ?, 'first', 's', 'b', ?, ?, '2026-11-06')").run(newLinkId(), id, status, test);
  assert.throws(() => ins("approved"), /UNIQUE/);
  assert.throws(() => ins("sent"), /UNIQUE/);
  ins("draft"); ins("failed"); ins("sent", 1); // not live: allowed
  const p = await previewHash(w, id);
  await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] });
  assert.equal((await w.api("POST", `/leads/${id}/draft`, {})).body.error, "first_email_already_sent");
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_messages WHERE lead_id = ? AND is_test = 0 AND kind = 'first' AND status = 'sent'", id)[0].n, 1);
});

test("sending modes: off blocks; test redirects to the test recipient with a prefix and records a test without touching the lead; live needs a mailing address", async () => {
  // off
  let w = world({ env: { LEADS_SENDING: undefined, LEADS_TEST_RECIPIENT: "hello@frameworkco.ca" } });
  let id = await ready(w);
  let p = await previewHash(w, id);
  assert.match(p.blockers.join("|"), /Sending is off/);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].error, "sending_off");
  assert.equal(w.calls.length, 0);
  for (const v of ["0", "true", "yes", " 1", "11"]) assert.equal(sendingMode({ LEADS_SENDING: v }).mode, "off", JSON.stringify(v));

  // test
  w = world({ env: { LEADS_TEST_RECIPIENT: "hello@frameworkco.ca" } });
  id = await ready(w);
  p = await previewHash(w, id);
  assert.equal(p.to, "hello@frameworkco.ca"); assert.equal(p.real_to, "info@summitfencing.ca"); assert.match(p.subject, /^\[TEST for info@summitfencing\.ca\] /);
  const r = (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0];
  assert.deepEqual([r.ok, r.status], [true, "test_sent"]);
  assert.deepEqual(w.calls[0].body.to, ["hello@frameworkco.ca"]);
  assert.match(w.calls[0].body.subject, /^\[TEST for info@summitfencing\.ca\] /);
  assert.ok(!JSON.stringify(w.calls[0].body).includes("\"info@summitfencing.ca\"") || w.calls[0].body.to[0] === "hello@frameworkco.ca");
  assert.equal(lead(w, id).status, "ready", "a test never changes the lead");
  assert.equal(lead(w, id).contacted_at, null);
  const all = msgs(w, id);
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((m) => [m.is_test, m.status]).sort(), [[0, "approved"], [1, "sent"]]);
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'test_sent'")[0].n, 1);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].ok, true, "tests can be repeated");
  assert.equal(w.calls.length, 2);
  assert.notEqual(w.calls[0].headers["Idempotency-Key"], w.calls[1].headers["Idempotency-Key"]);
  // the unsubscribe link in a test email is the test copy's: pressing it must not opt the real business out
  const testMsg = all.find((m) => m.is_test) || msgs(w, id).find((m) => m.is_test);
  const tok = await unsubscribeToken("s".repeat(40), testMsg.id);
  assert.equal((await handleUnsubscribe(new Request(`${ORIGIN}/u/${tok}`, { method: "POST" }), w.env, w.deps)).status, 200);
  assert.equal(lead(w, id).status, "ready"); assert.equal(w.q("SELECT count(*) AS n FROM outreach_suppressions")[0].n, 0);
  assert.equal(sendingMode({ LEADS_SENDING: "1", LEADS_TEST_RECIPIENT: "not an address", RESEND_API_KEY: "k", ASSESSMENT_FROM: "a@b.ca", DEMO_LINK_SECRET: "x".repeat(20) }).blocked[0], "test_recipient_invalid");

  // live without a mailing address
  w = world({ env: { LEADS_MAILING_ADDRESS: undefined } });
  id = await ready(w);
  p = await previewHash(w, id);
  assert.match(p.blockers.join("|"), /LEADS_MAILING_ADDRESS/);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].error, "mailing_address_missing");
  assert.equal(w.calls.length, 0);
  // live with one
  w.env.LEADS_MAILING_ADDRESS = "1 Example Rd, Calgary";
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: (await previewHash(w, id)).hash }] })).body.results[0].error, "hash_mismatch", "the footer changed since the owner approved the email");
  await w.api("POST", `/leads/${id}/message/unapprove`, {}); await w.api("POST", `/leads/${id}/message/approve`, {});
  p = await previewHash(w, id);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0].status, "sent");
  assert.equal(lead(w, id).status, "contacted");
});

test("no send to a dismissed, replied, won or opted-out lead, or to a suppressed or unconfirmed address", async () => {
  const w = world();
  const id = await ready(w);
  const p = await previewHash(w, id);
  const attempt = async () => (await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: p.hash }] })).body.results[0];
  const resetMsg = () => w.raw.prepare("UPDATE outreach_messages SET status = 'approved' WHERE lead_id = ? AND is_test = 0", ).run(id);
  w.raw.prepare("UPDATE outreach_leads SET status = 'dismissed' WHERE id = ?").run(id);
  assert.equal((await attempt()).error, "lead_inactive");
  for (const s of ["replied", "won"]) { w.raw.prepare("UPDATE outreach_leads SET status = ? WHERE id = ?").run(s, id); assert.equal((await attempt()).error, "lead_inactive", s); }
  w.raw.prepare("UPDATE outreach_leads SET status = 'ready', dismiss_reason = 'Opted out' WHERE id = ?").run(id);
  assert.equal((await attempt()).error, "opted_out");
  w.raw.prepare("UPDATE outreach_leads SET dismiss_reason = NULL WHERE id = ?").run(id);
  w.raw.prepare("UPDATE outreach_contacts SET opted_out_at = '2026-11-01' WHERE lead_id = ? AND type = 'email'").run(id);
  assert.equal((await attempt()).error, "opted_out");
  w.raw.prepare("UPDATE outreach_contacts SET opted_out_at = NULL WHERE lead_id = ?").run(id);
  w.raw.prepare("INSERT INTO outreach_suppressions (email, reason, at) VALUES ('info@summitfencing.ca', 'manual', '2026-11-01')").run();
  assert.equal((await attempt()).error, "suppressed");
  w.raw.prepare("DELETE FROM outreach_suppressions").run();
  w.raw.prepare("UPDATE outreach_contacts SET eligibility = 'review' WHERE lead_id = ? AND type = 'email'").run(id);
  assert.equal((await attempt()).error, "recipient_not_eligible");
  w.raw.prepare("UPDATE outreach_contacts SET eligibility = 'eligible' WHERE lead_id = ?").run(id);
  w.raw.prepare("UPDATE outreach_messages SET body = body || ' Only $5.' WHERE lead_id = ?").run(id);
  assert.equal((await attempt()).error, "pricing_in_first_email", "the rule is enforced at send time too");
  assert.equal(w.calls.length, 0);
  assert.ok(resetMsg);
  // dismissing a lead withdraws the approval
  const w2 = world();
  const id2 = await ready(w2);
  await w2.api("POST", `/leads/${id2}/dismiss`, {});
  assert.equal(msgs(w2, id2)[0].status, "draft");
  assert.equal((await w2.api("POST", "/leads/send", { items: [{ lead_id: id2, hash: "a".repeat(64) }] })).body.results[0].error, "not_approved");
});

test("follow-up: not before 5 days, not after a reply or opt-out, only one, and it goes through the same pipeline", async () => {
  const w = world();
  const id = await ready(w);
  assert.equal((await w.api("POST", `/leads/${id}/followup`, {})).body.error, "followup_not_allowed", "nothing sent yet");
  await sendLead(w, id);
  assert.equal(lead(w, id).status, "contacted");
  w.clock = new Date(NOW.getTime() + 4 * DAY);
  let f = await w.api("POST", `/leads/${id}/followup`, {});
  assert.equal(f.status, 409); assert.match(f.body.reason, /Follow up after 2026-11-11/);
  assert.match((await w.api("GET", "/leads/list")).body.leads[0].next_action, /Waiting for a reply; follow up after 2026-11-11/);
  w.clock = new Date(NOW.getTime() + 5 * DAY);
  assert.match((await w.api("GET", "/leads/list")).body.leads[0].next_action, /Draft the follow-up/);
  f = await w.api("POST", `/leads/${id}/followup`, {});
  assert.equal(f.status, 200); assert.equal(f.body.message.kind, "followup"); assert.ok(f.body.message.body.includes("/d/"));
  assert.equal((await w.api("POST", `/leads/${id}/followup`, {})).status, 200, "drafting again just refreshes the draft");
  assert.equal(msgs(w, id, "AND kind = 'followup'").length, 1);
  assert.equal((await w.api("POST", `/leads/${id}/message/approve`, {})).status, 200);
  assert.equal(lead(w, id).status, "contacted", "a follow-up never changes the lead status");
  const r = await sendLead(w, id);
  assert.deepEqual([r.ok, r.status], [true, "sent"]);
  assert.equal(w.calls.length, 2);
  assert.equal(lead(w, id).status, "contacted");
  const again = await w.api("POST", `/leads/${id}/followup`, {});
  assert.equal(again.status, 409); assert.match(again.body.reason, /already sent/);
  // a reply stops everything
  const w2 = world();
  const id2 = await ready(w2);
  await sendLead(w2, id2);
  w2.clock = new Date(NOW.getTime() + 9 * DAY);
  assert.equal((await w2.api("POST", `/leads/${id2}/status`, { status: "replied" })).body.lead.status, "replied");
  assert.equal((await w2.api("POST", `/leads/${id2}/followup`, {})).status, 409);
  assert.equal((await w2.api("POST", `/leads/${id2}/status`, { status: "won" })).body.lead.status, "won");
  assert.equal((await w2.api("POST", `/leads/${id2}/status`, { status: "replied" })).status, 409);
  // an opt-out stops it too
  const w3 = world();
  const id3 = await ready(w3);
  await sendLead(w3, id3);
  w3.clock = new Date(NOW.getTime() + 9 * DAY);
  await w3.api("POST", `/leads/${id3}/status`, { status: "optout" });
  assert.equal((await w3.api("POST", `/leads/${id3}/followup`, {})).status, 409);
  assert.equal((await w3.api("POST", `/leads/${id3}/status`, { status: "shipped" })).status, 422);
});

/* ---------------- unsubscribe ---------------- */

const unsubRequest = (token, method = "GET", extra = {}) => new Request(`${ORIGIN}/u/${token}`, { method, ...extra });

test("unsubscribe: GET shows a page and records NOTHING; POST records the opt-out and suppression blocks every lead with that address", async () => {
  const w = world();
  const id = await ready(w);
  w.f.add({ name: "Sister Co", site_status: "none", contacts: [{ type: "email", value: "info@summitfencing.ca", source_url: null }] });
  await w.api("POST", "/leads/sync");
  const sister = leadId(w, "Sister Co");
  w.raw.prepare("UPDATE outreach_contacts SET eligibility = 'eligible' WHERE lead_id = ?").run(sister);
  const m = msgs(w, id)[0];
  const token = await unsubscribeToken("s".repeat(40), m.id);
  const snapshot = () => JSON.stringify(["outreach_leads", "outreach_contacts", "outreach_suppressions", "outreach_messages", "outreach_events"].map((t) => w.q(`SELECT * FROM ${t}`)));
  const before = snapshot();
  for (const method of ["GET", "HEAD"]) {
    const g = await handleUnsubscribe(unsubRequest(token, method), w.env, w.deps);
    assert.equal(g.status, 200);
    assert.equal(g.headers.get("X-Robots-Tag"), "noindex, nofollow"); assert.equal(g.headers.get("Cache-Control"), "no-store");
    const csp = g.headers.get("Content-Security-Policy");
    assert.match(csp, /default-src 'none'/); assert.match(csp, /form-action 'self'/); assert.ok(!/script-src|unsafe-inline|unsafe-eval|https?:/.test(csp), csp);
    if (method === "GET") {
      const html = await g.text();
      assert.ok(!/<script|<link|<img|<iframe|src=|https?:\/\//i.test(html), "no scripts and no external requests");
      assert.match(html, /<form method="post">/); assert.match(html, /<button type="submit">Unsubscribe<\/button>/); assert.match(html, /noindex/);
      const hash = createHash(UNSUBSCRIBE_CSS);
      assert.ok(csp.includes(`'sha256-${hash}'`), "the CSP allows exactly the one inline style");
    }
  }
  assert.equal(snapshot(), before, "a GET (a scanner prefetching the link) changes nothing");
  assert.equal(lead(w, id).status, "ready");

  const p = await handleUnsubscribe(unsubRequest(token, "POST", { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" }), w.env, w.deps);
  assert.equal(p.status, 200); assert.match(await p.text(), /You&#39;re unsubscribed/);
  const l = lead(w, id);
  assert.equal(l.status, "dismissed"); assert.equal(l.dismiss_reason, "Opted out");
  assert.deepEqual(w.q("SELECT email, reason FROM outreach_suppressions"), [{ email: "info@summitfencing.ca", reason: "optout" }]);
  assert.ok(w.q("SELECT * FROM outreach_contacts WHERE type = 'email'").every((c) => c.eligibility === "blocked" && c.opted_out_at), "every lead with that address is blocked");
  assert.equal(msgs(w, id)[0].status, "draft", "the approval was withdrawn");
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'opted_out'")[0].n, 1);
  await handleUnsubscribe(unsubRequest(token, "POST"), w.env, w.deps); // idempotent
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'opted_out'")[0].n, 1);
  // the other lead with the same address can never be emailed
  await w.api("POST", `/leads/${sister}/approve`, {});
  assert.equal((await w.api("POST", `/leads/${sister}/message/approve`, {})).body.error, "no_eligible_recipient");
  assert.equal((await w.api("POST", `/leads/${id}/reopen`, {})).body.error, "opted_out");
  assert.equal(w.calls.length, 0);
});

test("unsubscribe: a tampered, foreign or malformed token is refused before the database is touched", async () => {
  const w = world();
  const id = await ready(w);
  const m = msgs(w, id)[0];
  const token = await unsubscribeToken("s".repeat(40), m.id);
  let touched = 0;
  const env = { ...w.env, PORTAL_DB: new Proxy(w.db, { get: (t, k) => { touched++; return t[k]; } }) };
  const demoTok = await tokenForLinkId("s".repeat(40), m.id);
  for (let i = 0; i < 22; i++) assert.equal((await handleUnsubscribe(unsubRequest(token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1), "POST"), env, w.deps)).status, 404, "position " + i);
  for (const bad of [demoTok, "short", token + "A", "A".repeat(22), "%00%00", "!".repeat(22)]) { assert.equal((await handleUnsubscribe(unsubRequest(bad, "POST"), env, w.deps)).status, 404, bad); assert.equal((await handleUnsubscribe(unsubRequest(bad, "GET"), env, w.deps)).status, 404, bad); }
  assert.equal(touched, 0);
  assert.equal(await verifyUnsubscribeToken("q".repeat(40), token), null, "another key");
  assert.equal(await verifyUnsubscribeToken(null, token), null);
  assert.equal(lead(w, id).status, "ready");
  assert.equal((await handleUnsubscribe(unsubRequest(token, "PUT"), w.env, w.deps)).status, 405);
  // a well-formed token for a message that does not exist
  assert.equal((await handleUnsubscribe(unsubRequest(await unsubscribeToken("s".repeat(40), "ffffffffffffffff"), "POST"), w.env, w.deps)).status, 404);
});

/* ---------------- webhook ---------------- */

const svix = (body, { id = "msg_1", ts = Math.floor(NOW.getTime() / 1000), secretBytes = WHSEC_BYTES, tamper = false } = {}) => {
  const sig = createHmac("sha256", secretBytes).update(`${id}.${ts}.${body}`).digest("base64");
  return { "svix-id": id, "svix-timestamp": String(ts), "svix-signature": `v1,${tamper ? "AAAA" + sig.slice(4) : sig}`, "Content-Type": "application/json" };
};
const hook = (w, event, opts) => { const body = JSON.stringify(event); return handleLeadsWebhook(new Request(ORIGIN + "/api/leads/webhook", { method: "POST", headers: svix(body, opts), body }), w.env, w.deps); };

test("webhook signature: valid, wrong secret, tampered, stale, missing headers, and an unconfigured secret stores nothing", async () => {
  const w = world();
  const id = await ready(w);
  await sendLead(w, id);
  const ev = { type: "email.delivered", data: { email_id: "re_1" } };
  assert.equal((await hook(w, ev)).status, 200);
  assert.equal((await hook(w, ev, { secretBytes: Buffer.from("another secret entirely") })).status, 401);
  assert.equal((await hook(w, ev, { tamper: true })).status, 401);
  assert.equal((await hook(w, ev, { ts: Math.floor(NOW.getTime() / 1000) - 400 })).status, 401, "stale");
  assert.equal((await hook(w, ev, { ts: Math.floor(NOW.getTime() / 1000) + 400 })).status, 401, "from the future");
  assert.equal((await hook(w, ev, { ts: Math.floor(NOW.getTime() / 1000) - 200 })).status, 200);
  const body = JSON.stringify(ev);
  for (const drop of ["svix-id", "svix-timestamp", "svix-signature"]) { const h = svix(body); delete h[drop]; assert.equal((await handleLeadsWebhook(new Request(ORIGIN + "/api/leads/webhook", { method: "POST", headers: h, body }), w.env, w.deps)).status, 401, drop); }
  const h2 = svix(body); h2["svix-signature"] = `v1,bogus v1,${h2["svix-signature"].slice(3)}`; // several signatures: one valid is enough
  assert.equal((await handleLeadsWebhook(new Request(ORIGIN + "/api/leads/webhook", { method: "POST", headers: h2, body }), w.env, w.deps)).status, 200);
  assert.equal((await handleLeadsWebhook(new Request(ORIGIN + "/api/leads/webhook", { method: "GET" }), w.env, w.deps)).status, 405);
  // unconfigured: 503 and nothing stored
  const before = JSON.stringify(w.q("SELECT * FROM outreach_events"));
  for (const secret of [undefined, "", "   "]) {
    const w2 = { ...w, env: { ...w.env, RESEND_WEBHOOK_SECRET: secret } };
    const r = await hook(w2, { type: "email.bounced", data: { email_id: "re_1" } });
    assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: "not_configured" });
  }
  assert.equal(JSON.stringify(w.q("SELECT * FROM outreach_events")), before);
  assert.equal(await verifySvix(w.env, new Headers(svix("x")), "x", NOW.getTime()), "ok");
  assert.equal(await verifySvix({}, new Headers(svix("x")), "x", NOW.getTime()), "not_configured");
});

test("webhook events: delivered, bounced (contact blocked and suppressed), failed, complained (lead dismissed as opted out); unknown ids are accepted and ignored", async () => {
  const w = world();
  const id = await ready(w);
  await sendLead(w, id);
  const m = msgs(w, id)[0];
  assert.equal((await hook(w, { type: "email.delivered", data: { email_id: "re_1" } })).status, 200);
  assert.ok(msgs(w, id)[0].delivered_at);
  await hook(w, { type: "email.delivered", data: { email_id: "re_1" } }, { id: "msg_2" });
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'delivered'")[0].n, 1, "a retry does not duplicate");
  const unk = await hook(w, { type: "email.bounced", data: { email_id: "re_unknown" } });
  assert.equal(unk.status, 200);
  assert.equal(msgs(w, id)[0].status, "sent");
  assert.equal((await hook(w, { type: "email.opened", data: { email_id: "re_1" } })).status, 200);
  assert.equal((await hook(w, { nonsense: true })).status, 200);

  assert.equal((await hook(w, { type: "email.bounced", data: { email_id: "re_1" } })).status, 200);
  const b = msgs(w, id)[0];
  assert.equal(b.status, "bounced"); assert.ok(b.failed_at);
  assert.deepEqual(w.q("SELECT email, reason FROM outreach_suppressions"), [{ email: "info@summitfencing.ca", reason: "bounce" }]);
  assert.equal(w.q("SELECT eligibility FROM outreach_contacts WHERE lead_id = ? AND type = 'email'", id)[0].eligibility, "blocked");
  assert.equal(lead(w, id).status, "contacted", "the lead stays, showing the failure");
  const row = (await w.api("GET", "/leads/list")).body.leads[0];
  assert.match(row.next_action, /bounced: add another email address or phone them/);
  assert.equal((await w.api("GET", `/leads/${id}`)).body.timeline[0].type, "bounced");

  // complaint
  const w2 = world();
  const id2 = await ready(w2);
  await sendLead(w2, id2);
  await hook(w2, { type: "email.complained", data: { email_id: "re_1" } });
  const l = lead(w2, id2);
  assert.equal(l.status, "dismissed"); assert.equal(l.dismiss_reason, "Opted out (complaint)");
  assert.equal(msgs(w2, id2)[0].status, "complained");
  assert.deepEqual(w2.q("SELECT email, reason FROM outreach_suppressions"), [{ email: "info@summitfencing.ca", reason: "complaint" }]);
  assert.equal(w2.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'complained'")[0].n, 1);
  await hook(w2, { type: "email.complained", data: { email_id: "re_1" } }, { id: "msg_9" });
  assert.equal(w2.q("SELECT count(*) AS n FROM outreach_events WHERE type = 'complained'")[0].n, 1);

  // failed
  const w3 = world();
  const id3 = await ready(w3);
  await sendLead(w3, id3);
  await hook(w3, { type: "email.failed", data: { email_id: "re_1" } });
  assert.equal(msgs(w3, id3)[0].status, "failed");
  assert.equal(w3.q("SELECT reason FROM outreach_suppressions")[0].reason, "bounce");
  assert.ok(m.id);
});

test("webhook: a bounce of a TEST email never suppresses the real business's address", async () => {
  const w = world({ env: { LEADS_TEST_RECIPIENT: "hello@frameworkco.ca" } });
  const id = await ready(w);
  await sendLead(w, id);
  await hook(w, { type: "email.bounced", data: { email_id: "re_1" } });
  await hook(w, { type: "email.complained", data: { email_id: "re_1" } }, { id: "msg_3" });
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_suppressions")[0].n, 0);
  assert.equal(lead(w, id).status, "ready");
  assert.equal(w.q("SELECT eligibility FROM outreach_contacts WHERE type = 'email'")[0].eligibility, "eligible");
});

/* ---------------- Admin API ---------------- */

test("bulk approve and dismiss: up to 50 ids, per-lead results, bad ids and unknown ids reported, one failure does not stop the rest", async () => {
  const w = world();
  for (let i = 0; i < 4; i++) w.f.add({ name: "Bulk " + i, site_status: "none" });
  await w.api("POST", "/leads/sync");
  const ids = w.q("SELECT id FROM outreach_leads ORDER BY name").map((r) => r.id);
  const a = await w.api("POST", "/leads/bulk", { action: "approve", ids: [ids[0], ids[1], "0000000000000000"] });
  assert.deepEqual(a.body.results, [{ id: ids[0], ok: true }, { id: ids[1], ok: true }, { id: "0000000000000000", ok: false, error: "not_found" }]);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_links")[0].n, 2);
  const d = await w.api("POST", "/leads/bulk", { action: "dismiss", ids: [ids[2], ids[3]], reason: "Not now" });
  assert.deepEqual(d.body.results.map((r) => r.ok), [true, true]);
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_leads WHERE status = 'dismissed' AND dismiss_reason = 'Not now'")[0].n, 2);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "approve", ids: [] })).status, 422);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "approve", ids: Array(51).fill(ids[0]).map((x, i) => i.toString(16).padStart(16, "0")) })).status, 422);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "approve", ids: ["nope"] })).status, 422);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "delete", ids: [ids[0]] })).status, 422);
  assert.equal((await w.api("POST", "/leads/bulk", { action: "dismiss", ids: [ids[0]], reason: "x".repeat(201) })).status, 422);
});

test("list: counts per status, filters by status and text, the row shape, and sensible next actions", async () => {
  const w = world();
  w.f.add(eligibleLead());
  w.f.add({ name: "Alpha Decks", trade: "deck", city: "Okotoks", site_status: "none" });
  w.f.add({ name: "100% Fence_Co", site_status: "none", contacts: [{ type: "email", value: "x@y.ca" }] });
  await w.api("POST", "/leads/sync");
  const summit = leadId(w), alpha = leadId(w, "Alpha Decks");
  await w.api("POST", `/leads/${alpha}/dismiss`, { reason: "Retired" });
  await w.api("POST", `/leads/${summit}/approve`, {});
  const all = (await w.api("GET", "/leads/list")).body;
  assert.deepEqual(all.counts, { new: 1, approved: 1, ready: 0, contacted: 0, replied: 0, won: 0, dismissed: 1 });
  assert.equal(all.limit, 300); assert.equal(all.leads.length, 3);
  const row = all.leads.find((l) => l.id === summit);
  assert.deepEqual(Object.keys(row).sort(), ["city", "demo", "has_eligible_email", "has_email", "id", "contacted_at", "name", "next_action", "opted_out", "phone", "rating", "reason", "review_count", "seo_level", "seo_score", "site_status", "site_verified", "source_note", "status", "trade", "updated_at", "website"].sort());
  assert.equal(row.has_eligible_email, true); assert.equal(row.phone, "403-555-0100"); assert.deepEqual(row.demo, { visits: 0, opens: 0, company: null, enquired: false, last_activity: null });
  assert.equal(row.next_action, "Review the draft and approve the email"); assert.equal(row.opted_out, false);
  assert.equal(all.leads.find((l) => l.id === alpha).next_action, "Dismissed: Retired");
  assert.equal(all.leads.find((l) => l.status === "new").demo, null, "no tracking link before approval");
  assert.equal(all.leads.find((l) => l.status === "new").next_action, "Review, then approve or dismiss");
  assert.deepEqual((await w.api("GET", "/leads/list?status=dismissed")).body.leads.map((l) => l.name), ["Alpha Decks"]);
  assert.equal((await w.api("GET", "/leads/list?status=dismissed")).body.counts.new, 1, "counts ignore the filter");
  assert.deepEqual((await w.api("GET", "/leads/list?q=okotoks")).body.leads.map((l) => l.name), ["Alpha Decks"]);
  assert.deepEqual((await w.api("GET", "/leads/list?q=100%25")).body.leads.map((l) => l.name), ["100% Fence_Co"]);
  assert.deepEqual((await w.api("GET", "/leads/list?q=%25")).body.leads.map((l) => l.name), ["100% Fence_Co"], "LIKE wildcards are literal");
  assert.equal((await w.api("GET", "/leads/list?status=bogus")).status, 422);
  assert.equal((await w.api("GET", "/leads/list?status=all&q=")).body.leads.length, 3);
});

test("the lead panel's demo section reuses the tracking link's journeys: bots are excluded by default, names and design choices are shown", async () => {
  const w = world();
  const id = await ready(w);
  const linkId = lead(w, id).demo_link_id;
  const j = (jid, o = {}) => w.raw.prepare("INSERT INTO demo_journeys (id, link_id, source, first_seen_at, last_seen_at, country, device, bot, human, discipline, vibe, colour, company, demo_opens, enquired) VALUES (?, ?, 'link', ?, ?, 'CA', 'desktop', ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(jid, linkId, "2026-11-05T10:00:00.000Z", o.last || "2026-11-05T10:05:00.000Z", o.bot || 0, o.human ?? 1, o.discipline ?? null, o.vibe ?? null, o.colour ?? null, o.company ?? null, o.opens ?? 0, o.enq ?? 0);
  j("A".repeat(22), { discipline: "fence-deck", vibe: "rugged", colour: "#AA3300", company: "Summit Fencing Ltd", opens: 2, enq: 1 });
  j("B".repeat(22), { bot: 1, human: 0, opens: 7, last: "2026-11-05T11:00:00.000Z" });
  j("C".repeat(22), { last: "2026-11-06T08:00:00.000Z", opens: 1 });
  const key = "s".repeat(40);
  const detail = (await w.api("GET", `/leads/${id}`)).body;
  assert.equal(detail.demo.link.url, `${ORIGIN}/d/${await tokenForLinkId(key, linkId)}`);
  assert.equal(detail.demo.link.id, linkId); assert.equal(detail.demo.link.label, "Summit Fencing"); assert.equal(detail.demo.link.revoked_at, null);
  assert.deepEqual(detail.demo.summary, { opens: 3, visits: 2, enquiries: 1 });
  assert.equal(detail.demo.journeys.length, 2);
  assert.deepEqual(detail.demo.journeys.map((x) => x.id), ["C".repeat(22), "A".repeat(22)], "newest first");
  const a = detail.demo.journeys[1];
  assert.deepEqual([a.discipline, a.vibe, a.colour, a.company, a.demo_opens, a.enquired, a.human, a.bot, a.device, a.country], ["fence-deck", "rugged", "#AA3300", "Summit Fencing Ltd", 2, true, true, false, "desktop", "CA"]);
  const withBots = (await w.api("GET", `/leads/${id}?bots=1`)).body.demo;
  assert.equal(withBots.journeys.length, 3); assert.equal(withBots.summary.opens, 10); assert.equal(withBots.journeys.find((x) => x.bot).human, false);
  const row = (await w.api("GET", "/leads/list")).body.leads[0];
  assert.deepEqual(row.demo, { visits: 2, opens: 3, company: "Summit Fencing Ltd", enquired: true, last_activity: "2026-11-06T08:00:00.000Z" });
  // the shape of the whole panel
  assert.deepEqual(Object.keys(detail).sort(), ["approaches", "contacts", "demo", "lead", "message", "messages", "sending", "timeline"]);
  assert.deepEqual(Object.keys(detail.message).sort(), ["approach", "blockers", "body", "contact_id", "content_hash", "delivered_at", "error", "footer", "id", "is_test", "kind", "sent_at", "status", "subject", "to_email"]);
  assert.ok(detail.lead.next_action && detail.lead.opted_out === false && detail.lead.reason && "notes" in detail.lead);
  assert.deepEqual(Object.keys(detail.contacts[0]).sort(), ["eligibility", "eligibility_note", "id", "opted_out_at", "source", "source_url", "type", "value"]);
  assert.deepEqual(Object.keys(detail.timeline[0]).sort(), ["at", "detail", "type"]);
  assert.deepEqual(detail.sending, { mode: "live", blocked_reason: null });
});

test("PATCH saves notes and the next-action note with length caps; unknown leads and fields are refused", async () => {
  const w = world();
  w.f.add({ name: "Notes Co" });
  await w.api("POST", "/leads/sync");
  const id = leadId(w, "Notes Co");
  const r = await w.api("PATCH", `/leads/${id}`, { notes: "Met at the lumber yard.\nCall Tuesday.", next_action_note: "Call Tuesday" });
  assert.equal(r.status, 200); assert.equal(r.body.lead.notes, "Met at the lumber yard.\nCall Tuesday."); assert.equal(r.body.lead.next_action_note, "Call Tuesday");
  assert.equal((await w.api("PATCH", `/leads/${id}`, { notes: null })).body.lead.notes, null);
  assert.equal((await w.api("PATCH", `/leads/${id}`, { notes: "x".repeat(4001) })).status, 422);
  assert.equal((await w.api("PATCH", `/leads/${id}`, { next_action_note: "x".repeat(201) })).status, 422);
  assert.equal((await w.api("PATCH", `/leads/${id}`, { notes: 5 })).status, 422);
  assert.equal((await w.api("PATCH", `/leads/${id}`, {})).status, 422);
  assert.equal((await w.api("PATCH", `/leads/${id}`, { status: "won" })).status, 422, "status cannot be set here");
  assert.equal(lead(w, id).status, "new");
  assert.equal((await w.api("PATCH", "/leads/0000000000000000", { notes: "x" })).status, 404);
});

test("the API guards: writes need the same origin and the header, ids are validated, methods are checked, bodies are bounded, nothing is injectable", async () => {
  const w = world();
  w.f.add({ name: "Guard Co" });
  await w.api("POST", "/leads/sync");
  const id = leadId(w, "Guard Co");
  for (const [method, path, body] of [["POST", "/leads/sync"], ["POST", `/leads/${id}/approve`, {}], ["POST", `/leads/${id}/dismiss`, {}], ["PATCH", `/leads/${id}`, { notes: "x" }], ["POST", "/leads/bulk", { action: "approve", ids: [id] }], ["POST", "/leads/send", { items: [] }], ["PUT", `/leads/${id}/message`, {}]]) {
    assert.equal((await w.api(method, path, body, { write: false })).status, 403, method + path + " without the header");
    assert.equal((await w.api(method, path, body, { origin: "https://evil.example" })).status, 403, method + path + " from another origin");
  }
  assert.equal(lead(w, id).status, "new");
  assert.equal((await w.api("GET", "/leads/nope")).status, 404);
  assert.equal((await w.api("GET", "/leads/ABCDEF0123456789")).status, 404, "ids are lower-case hex");
  assert.equal((await w.api("GET", `/leads/${id}'; DROP TABLE outreach_leads;--`)).status, 404);
  assert.equal((await w.api("DELETE", `/leads/${id}`, undefined)).status, 405);
  assert.equal((await w.api("GET", "/leads/sync")).status, 405);
  assert.equal((await w.api("POST", "/leads/list", {})).status, 405);
  assert.equal((await w.api("POST", `/leads/${id}/nothing`, {})).status, 404);
  assert.equal((await w.api("POST", `/leads/${id}/contacts/abc`, { eligibility: "eligible" })).status, 404);
  assert.equal((await w.api("POST", `/leads/${id}/contacts/99999`, { eligibility: "eligible" })).status, 404);
  assert.equal((await w.api("POST", `/leads/${id}/message/launch`, {})).status, 404);
  assert.equal((await w.api("POST", `/leads/${id}/approve`, undefined)).status, 200, "an empty body is fine");
  const bad = await handleLeadsApi(new Request(ORIGIN + `/api/admin/leads/${id}/dismiss`, { method: "POST", headers: { Origin: ORIGIN, "X-Framework-Admin": "1" }, body: "{not json" }), w.env, {}, `/leads/${id}/dismiss`, w.deps);
  assert.equal(bad.status, 400);
  const big = await handleLeadsApi(new Request(ORIGIN + `/api/admin/leads/${id}/dismiss`, { method: "POST", headers: { Origin: ORIGIN, "X-Framework-Admin": "1" }, body: JSON.stringify({ reason: "x".repeat(70000) }) }), w.env, {}, `/leads/${id}/dismiss`, w.deps);
  assert.equal(big.status, 413);
  assert.equal((await w.api("POST", "/leads/send/preview", { ids: Array.from({ length: 11 }, (_, i) => i.toString(16).padStart(16, "0")) })).status, 422);
  assert.equal((await w.api("POST", "/leads/send", { items: Array.from({ length: 11 }, (_, i) => ({ lead_id: i.toString(16).padStart(16, "0"), hash: "a".repeat(64) })) })).status, 422);
  assert.equal((await w.api("POST", "/leads/send", { items: [{ lead_id: id, hash: "a".repeat(64) }, { lead_id: id, hash: "a".repeat(64) }] })).status, 422, "the same lead twice");
  assert.equal(w.q("SELECT count(*) AS n FROM outreach_leads")[0].n, 1);
  assert.equal(handleLeadsApi(new Request(ORIGIN + "/api/admin/clients"), w.env, {}, "/clients", w.deps) instanceof Promise, true);
  assert.equal(await handleLeadsApi(new Request(ORIGIN + "/api/admin/clients"), w.env, {}, "/clients", w.deps), null);
});

test("the router sends /api/admin/leads/* to the leads API after authentication, and a signed-out request reaches nothing", async () => {
  const w = world();
  const r = await handleAdmin(new Request(ORIGIN + "/api/admin/leads/status"), { ...w.env }, {});
  assert.ok([401, 403, 503].includes(r.status));
  assert.ok(!/migration|setup/.test(await r.text()));
});

test("status reports exactly what is and is not configured, and never throws", async () => {
  const w = world();
  w.f.add(eligibleLead()); w.f.add({ name: "Second" });
  let s = (await w.api("GET", "/leads/status")).body;
  assert.deepEqual(s, {
    ready: true, migration: "0024_leads.sql",
    setup: { finder: { connected: true, waiting: 2 }, tracking: { ready: true }, email: { configured: true, from: "Framework <hello@frameworkco.ca>" }, sending: { mode: "live", test_recipient: null, blocked_reason: null }, mailing_address: true, sender_name: true, webhook: { configured: true }, replies: "manual" },
  });
  await w.api("POST", "/leads/sync");
  assert.equal((await w.api("GET", "/leads/status")).body.setup.finder.waiting, 0);
  // everything missing
  const bare = world({ finder: false, env: { DEMO_LINK_SECRET: undefined, RESEND_API_KEY: undefined, LEADS_SENDING: undefined, LEADS_MAILING_ADDRESS: undefined, LEADS_SENDER_NAME: undefined, RESEND_WEBHOOK_SECRET: undefined } });
  s = (await bare.api("GET", "/leads/status")).body;
  assert.deepEqual(s.setup, { finder: { connected: false, waiting: 0 }, tracking: { ready: false }, email: { configured: false, from: null }, sending: { mode: "off", test_recipient: null, blocked_reason: s.setup.sending.blocked_reason }, mailing_address: false, sender_name: false, webhook: { configured: false }, replies: "manual" });
  assert.match(s.setup.sending.blocked_reason, /awaiting setup/);
  // test mode, masked recipient; a pepper alone is enough for tracking
  const t = world({ env: { DEMO_LINK_SECRET: undefined, PORTAL_SESSION_PEPPER: PEPPER, LEADS_TEST_RECIPIENT: "hello@frameworkco.ca", LEADS_MAILING_ADDRESS: undefined } });
  s = (await t.api("GET", "/leads/status")).body.setup;
  assert.deepEqual([s.tracking.ready, s.sending.mode, s.sending.test_recipient, s.sending.blocked_reason], [true, "test", "h***@frameworkco.ca", null]);
  const noMail = world({ env: { LEADS_MAILING_ADDRESS: undefined } });
  assert.match((await noMail.api("GET", "/leads/status")).body.setup.sending.blocked_reason, /LEADS_MAILING_ADDRESS/);
  // a finder that errors is reported as not connected, not thrown
  const broken = world();
  broken.env.LEADGEN_DB = { prepare() { throw new Error("D1_ERROR: no such table"); } };
  s = (await broken.api("GET", "/leads/status")).body.setup;
  assert.deepEqual(s.finder, { connected: false, waiting: 0 });
  // no database at all
  const none = await handleLeadsApi(new Request(ORIGIN + "/api/admin/leads/status"), { DEMO_LINK_SECRET: "s".repeat(40) }, {}, "/leads/status", {});
  assert.equal(none.status, 200); assert.equal((await none.json()).ready, false);
});

test("everything degrades gracefully while migration 0024 is not applied", async () => {
  const w = world({ migrated: false });
  const s = await w.api("GET", "/leads/status");
  assert.equal(s.status, 200); assert.equal(s.body.ready, false); assert.equal(s.body.migration, "0024_leads.sql");
  w.f.add({ name: "Waiting Co" });
  assert.equal((await w.api("GET", "/leads/status")).body.setup.finder.waiting, 1, "the finder can still be counted");
  for (const [m, p, b] of [["GET", "/leads/list"], ["POST", "/leads/sync", {}], ["GET", "/leads/0123456789abcdef"], ["POST", "/leads/bulk", { action: "approve", ids: ["0123456789abcdef"] }], ["POST", "/leads/send", { items: [] }], ["POST", "/leads/0123456789abcdef/approve", {}]]) {
    const r = await w.api(m, p, b);
    assert.equal(r.status, 409, m + p); assert.deepEqual(r.body, { error: "not_set_up", migration: "0024_leads.sql" });
  }
  const token = await unsubscribeToken("s".repeat(40), "0123456789abcdef");
  assert.equal((await handleUnsubscribe(unsubRequest(token, "GET"), w.env, w.deps)).status, 200);
  assert.equal((await handleUnsubscribe(unsubRequest(token, "POST"), w.env, w.deps)).status, 503);
  const body = JSON.stringify({ type: "email.bounced", data: { email_id: "re_1" } });
  const hr = await handleLeadsWebhook(new Request(ORIGIN + "/api/leads/webhook", { method: "POST", headers: svix(body), body }), w.env, w.deps);
  assert.equal(hr.status, 200);
  // and through the Worker entry point
  const viaWorker = await worker.fetch(new Request(`${ORIGIN}/u/${token}`, { method: "POST" }), { ...w.env, ASSETS: { fetch: async () => new Response("static") } }, {});
  assert.equal(viaWorker.status, 503);
});

test("approve says so when the tracking tables (0021) are missing, and changes nothing", async () => {
  const w = world();
  w.f.add(eligibleLead());
  await w.api("POST", "/leads/sync");
  const id = leadId(w);
  w.raw.exec("PRAGMA foreign_keys = OFF; DROP TABLE demo_events; DROP TABLE demo_journeys; DROP TABLE demo_links; PRAGMA foreign_keys = ON;");
  const r = await w.api("POST", `/leads/${id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.migration, "0021_demo_traffic.sql");
  assert.equal(lead(w, id).status, "new");
  const d = await w.api("GET", `/leads/${id}`);
  assert.equal(d.status, 200); assert.deepEqual(d.body.demo, { link: null, summary: { opens: 0, visits: 0, enquiries: 0 }, journeys: [] });
  assert.equal((await w.api("GET", "/leads/list")).body.leads[0].demo, null);
});

test("no email body or recipient address is ever stored in the timeline, and details stay short", async () => {
  const w = world({ env: { LEADS_TEST_RECIPIENT: "hello@frameworkco.ca" } });
  const id = await ready(w);
  await sendLead(w, id);
  w.env.LEADS_TEST_RECIPIENT = undefined;
  await sendLead(w, id);
  await hook(w, { type: "email.delivered", data: { email_id: "re_2" } });
  await hook(w, { type: "email.bounced", data: { email_id: "re_2" } }, { id: "m2" });
  await w.api("POST", `/leads/${id}/contacts`, { type: "email", value: "extra@example.com" });
  await w.api("POST", `/leads/${id}/status`, { status: "optout" });
  const events = w.q("SELECT type, detail FROM outreach_events");
  assert.ok(events.length >= 8);
  const bodyText = msgs(w, id)[0].body;
  for (const e of events) {
    const d = e.detail || "";
    assert.ok(!/@/.test(d), `${e.type}: ${d}`);
    assert.ok(d.length <= 300);
    assert.ok(!d.includes(bodyText.slice(0, 40)) && !d.includes("summitfencing"), `${e.type}: ${d}`);
  }
  const { eventStmt } = await import("../leads.js");
  await eventStmt(w.db, id, "2026-11-06", "note", "Spoke to boss@secret.example about it").run();
  assert.ok(!w.q("SELECT detail FROM outreach_events WHERE type = 'note'")[0].detail.includes("secret.example"), "an address is scrubbed even if one slips in");
});

test("the signing key helper is shared: tracking links and unsubscribe tokens use distinct labels and cannot stand in for each other", async () => {
  const id = newLinkId();
  assert.notEqual(await unsubscribeToken(PEPPER, id), await tokenForLinkId(PEPPER, id));
  assert.equal(await verifyUnsubscribeToken(PEPPER, await tokenForLinkId(PEPPER, id)), null);
  const { verifyToken } = await import("../demo-traffic.js");
  assert.equal(await verifyToken(PEPPER, await unsubscribeToken(PEPPER, id)), null);
});

/* ---------------- email provider extension ---------------- */

test("sendEmail: optional headers go to the provider, the provider's message id is returned, and existing callers see the same behaviour", async () => {
  const env = { RESEND_API_KEY: "re_test", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" };
  let seen;
  const ok = (id) => async (url, init) => { seen = JSON.parse(init.body); return new Response(id === undefined ? "not json" : JSON.stringify({ id }), { status: 200 }); };
  assert.deepEqual(await sendEmail(env, { to: "a@b.ca", subject: "s", text: "t", headers: { "List-Unsubscribe": "<https://x/u/1>" } }, ok("re_123")), { ok: true, id: "re_123" });
  assert.deepEqual(seen.headers, { "List-Unsubscribe": "<https://x/u/1>" });
  assert.deepEqual(await sendEmail(env, { to: "a@b.ca", subject: "s", text: "t" }, ok(undefined)), { ok: true });
  assert.ok(!("headers" in seen), "no headers key when none were given");
  assert.deepEqual(await sendEmail(env, { to: "a@b.ca", subject: "s", text: "t" }, async () => new Response("{}", { status: 200 })), { ok: true });
  assert.equal((await sendEmail(env, { to: "a@b.ca", subject: "s", text: "t" }, async () => new Response(JSON.stringify({ message: "bad" }), { status: 422 }))).error, "provider 422: bad");
  assert.deepEqual(await sendEmail({}, { to: "a@b.ca", subject: "s", text: "t" }), { ok: false, error: "config:missing_api_key" });
});

/* ---------------- files and wiring ---------------- */

test("the migration is additive, held in migrations/portal for the manual Production workflow, and holds the contract's tables, constraints and partial unique indexes", () => {
  const sql = readFileSync(new URL("../../migrations/portal/0024_leads.sql", import.meta.url), "utf8");
  const code = sql.replace(/--.*$/gm, "");
  assert.match(sql, /Not applied to Production/);
  assert.ok(!/DROP |DELETE FROM|ALTER |\bUPDATE |INSERT /i.test(code), "additive only, no seed rows");
  assert.deepEqual([...code.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]), ["outreach_leads", "outreach_contacts", "outreach_suppressions", "outreach_messages", "outreach_events"]);
  assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS \w+ ON outreach_messages \(lead_id, kind\) WHERE is_test = 0 AND status IN \('approved', 'sending', 'sent', 'bounced', 'complained'\)/);
  assert.match(code, /ON outreach_leads \(source_ref\) WHERE source_ref IS NOT NULL/);
  assert.match(code, /demo_link_id\s+TEXT REFERENCES demo_links \(id\) ON DELETE SET NULL/);
  const db = openPortalDb({ skip: ["0025_seo_leads.sql"] });
  db.raw.exec(sql); // a second run changes nothing
  assert.throws(() => db.raw.exec("INSERT INTO outreach_leads (id, source, dedupe_key, name, reason, status, created_at, updated_at) VALUES ('0123456789abcdef', 'finder', 'k', 'n', 'r', 'bogus', 'x', 'x')"), /constraint/i);
  assert.throws(() => db.raw.exec("INSERT INTO outreach_suppressions (email, reason, at) VALUES ('a@b.ca', 'because', 'x')"), /constraint/i);
  const readme = readFileSync(new URL("../../migrations/portal/README.md", import.meta.url), "utf8");
  assert.match(readme, /0024_leads\.sql` \(applied to Staging/);
});

test("wiring: /u/* runs the Worker first, the public routes are in index.js, the API is registered, and Production binds the finder database but has no sending settings", () => {
  const cfg = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"run_worker_first": \[[^\]]*"\/u\/\*"/);
  const before = cfg.slice(0, cfg.indexOf('"previews"')).replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/LEADS_/.test(before), "no LEADS_* settings at the top level (Production sends nothing)"); assert.equal((before.match(/LEADGEN_DB/g) || []).length, 1, "only the finder binding");
  const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(idx, /path\.startsWith\("\/u\/"\)/); assert.match(idx, /path === "\/api\/leads\/webhook"/);
  assert.match(readFileSync(new URL("../admin/router.js", import.meta.url), "utf8"), /handleLeadsApi/);
  assert.ok(!/DELETE|UPDATE|INSERT/i.test(readFileSync(new URL("../leads.js", import.meta.url), "utf8").match(/export async function finderSelect[\s\S]*?\n}/)[0].replace(/\/\*\*[\s\S]*?\*\//g, "")), "finderSelect is the only finder access and does not write");
});

test("the public routes work through the Worker entry point (unsubscribe page and webhook), without a database binding too", async () => {
  const w = world();
  const id = await ready(w);
  const token = await unsubscribeToken("s".repeat(40), msgs(w, id)[0].id);
  const env = { ...w.env, ASSETS: { fetch: async () => new Response("static") } };
  const g = await worker.fetch(new Request(`${ORIGIN}/u/${token}`), env, {});
  assert.equal(g.status, 200); assert.match(await g.text(), /Unsubscribe/);
  const body = JSON.stringify({ type: "email.delivered", data: { email_id: "x" } });
  const h = await worker.fetch(new Request(`${ORIGIN}/api/leads/webhook`, { method: "POST", headers: svix(body, { ts: Math.floor(Date.now() / 1000) }), body }), env, {});
  assert.equal(h.status, 200);
  const bare = await worker.fetch(new Request(`${ORIGIN}/u/${token}`, { method: "POST" }), { ASSETS: env.ASSETS }, {});
  assert.ok([404, 503].includes(bare.status));
  const nohook = await worker.fetch(new Request(`${ORIGIN}/api/leads/webhook`, { method: "POST", body: "{}" }), { ASSETS: env.ASSETS }, {});
  assert.equal(nohook.status, 503);
});

function createHash(s) { return require_crypto().createHash("sha256").update(s).digest("base64"); }
import * as nodeCrypto from "node:crypto";
function require_crypto() { return nodeCrypto; }

/* ---------------- website check: Online / Offline / Unverified ---------------- */

const SR = (status, headers = {}, body = "") => new Response(body === "" ? null : body, { status, headers });
const DNS_OK = SR(200, { "content-type": "application/json" }, JSON.stringify({ Status: 0 }));
/** A scripted site fetch: exact URL, then host, then "*"; an Error is thrown. Returns the calls too. */
const siteFetch = (map) => { const calls = []; const f = async (url) => { const u = new URL(url); calls.push(u.href); const v = map[u.href] ?? map[u.host] ?? map["*"]; if (v instanceof Error) throw v; if (!v) throw new TypeError("fetch failed"); return v.clone(); }; f.calls = calls; return f; };
const withSite = (w, map) => { w.deps.siteFetch = siteFetch(map); return w.deps.siteFetch; };
/** Imports finder leads that carry the finder's "doesn't load" claim; returns their ids by name. */
async function brokenLeads(w, names) {
  for (const n of names) w.f.add({ name: n, website: `https://${n.toLowerCase().replace(/\W+/g, "")}.ca/?utm_source=google`, site_status: "broken", site_score: 85, site_issues: '["Website doesn\'t load"]', contacts: [] });
  assert.equal((await w.api("POST", "/leads/sync")).status, 200);
  return Object.fromEntries(names.map((n) => [n, leadId(w, n)]));
}
const apiWith = (w, method, path, body) => w.api(method, path, body);

test("recheck: a working site flagged 'doesn't load' becomes Online and is no longer scored or worded as a broken-site prospect", async () => {
  const w = world(); const ids = await brokenLeads(w, ["Working Co"]);
  assert.equal(lead(w, ids["Working Co"]).site_status, "broken");
  assert.match(lead(w, ids["Working Co"]).reason, /not confirmed yet/, "the finder's claim is shown as unconfirmed, not as fact");
  withSite(w, { "https://workingco.ca/": SR(301, { location: "https://www.workingco.ca/" }), "https://www.workingco.ca/": SR(200, {}, "<html>hello</html>") });
  const r = await w.api("POST", "/leads/recheck-sites", {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual([r.body.checked, r.body.remaining, r.body.results[0].state, r.body.results[0].changed, r.body.results[0].was], [1, 0, "online", true, "broken"]);
  const l = lead(w, ids["Working Co"]);
  assert.deepEqual([l.site_status, l.site_score], ["online", null], "an online site is not scored as a broken-site prospect");
  assert.match(l.reason, /^Website is online \(workingco\.ca\); 4\.6 stars from 77 reviews\.$/);
  assert.deepEqual(JSON.parse(l.site_issues), ["Checked 2026-11-06: online, ok", "HTTP status 200 after 1 redirect"]);
  const note = w.q("SELECT type, detail FROM outreach_events WHERE lead_id = ? AND type = 'note'", l.id);
  assert.equal(note.length, 1); assert.match(note[0].detail, /^Website check: Online: ok \(HTTP 200, 1 redirect\) at www\.workingco\.ca\.$/);
  assert.equal(w.q("SELECT website FROM outreach_leads WHERE id = ?", l.id)[0].website, "https://workingco.ca/?utm_source=google", "the stored address is kept as it was");
});

test("recheck: a site that blocks automated requests is Unverified, never Offline, and says why", async () => {
  const w = world(); const ids = await brokenLeads(w, ["Guarded Co", "Limited Co"]);
  withSite(w, { "guardedco.ca": SR(403, { server: "cloudflare", "cf-ray": "1", "cf-mitigated": "challenge" }, "Just a moment..."), "www.guardedco.ca": SR(403, { server: "cloudflare", "cf-mitigated": "challenge" }), "limitedco.ca": SR(429, { "retry-after": "30" }), "www.limitedco.ca": SR(429) });
  const r = await w.api("POST", "/leads/recheck-sites", {});
  assert.deepEqual(r.body.results.map((x) => x.state).sort(), ["unverified", "unverified"]);
  for (const id of Object.values(ids)) {
    const l = lead(w, id);
    assert.equal(l.site_status, "unverified"); assert.equal(l.site_score, null);
    assert.match(l.reason, /couldn't be checked automatically .*; it may be protected, not offline/);
    assert.ok(!/doesn't load/.test(l.reason));
  }
  assert.match(JSON.parse(lead(w, ids["Guarded Co"]).site_issues).join(" | "), /HTTP status 403 \| Bot protection seen: Cloudflare challenge/);
  assert.match(w.q("SELECT detail FROM outreach_events WHERE lead_id = ? AND type = 'note'", ids["Limited Co"])[0].detail, /Unverified: blocked or protected \(HTTP 429\) at limitedco\.ca\. Not treated as offline\./);
});

test("recheck: a verified offline site keeps its score and the plain 'doesn't load' wording; the diagnostics record the HTTP status", async () => {
  const w = world(); const ids = await brokenLeads(w, ["Gone Co", "Missing Co"]);
  const scoreBefore = lead(w, ids["Gone Co"]).site_score;
  assert.ok(Number.isFinite(scoreBefore), "the finder's score was imported");
  withSite(w, { "goneco.ca": SR(404), "www.goneco.ca": SR(404), "missingco.ca": SR(521, { server: "cloudflare" }), "www.missingco.ca": SR(521, { server: "cloudflare" }) });
  const r = await w.api("POST", "/leads/recheck-sites", {});
  assert.deepEqual(r.body.results.map((x) => [x.state, x.httpStatus]).sort(), [["offline", 404], ["offline", 521]]);
  const l = lead(w, ids["Gone Co"]);
  assert.deepEqual([l.site_status, l.site_score], ["offline", scoreBefore]);
  assert.equal(l.reason, "Website doesn't load (goneco.ca); 4.6 stars from 77 reviews.");
  assert.match(JSON.parse(l.site_issues)[0], /^Checked 2026-11-06: offline, home page not found \(HTTP 404\)$/);
});

test("recheck: only leads nobody has started on are touched; the drafts of started leads are never made untrue", async () => {
  const w = world(); const ids = await brokenLeads(w, ["Started Co", "Fresh Co"]);
  assert.equal((await w.api("POST", `/leads/${ids["Started Co"]}/approve`, {})).status, 200);
  const draftBefore = JSON.stringify(msgs(w, ids["Started Co"]));
  assert.match(msgs(w, ids["Started Co"])[0].body, /came across Started Co online/, "a draft made from an unconfirmed claim never says the site doesn't load");
  assert.ok(!/doesn't load|isn't loading/.test(JSON.stringify(msgs(w, ids["Started Co"]).map((m) => [m.subject, m.body]))));
  const f = withSite(w, { "*": SR(200, {}, "ok") });
  const r = await w.api("POST", "/leads/recheck-sites", { ids: [ids["Started Co"], ids["Fresh Co"]] });
  assert.deepEqual(r.body.results.map((x) => x.skipped || x.state), ["already_started", "online"]);
  assert.equal(lead(w, ids["Started Co"]).site_status, "broken"); assert.equal(JSON.stringify(msgs(w, ids["Started Co"])), draftBefore);
  assert.ok(f.calls.every((u) => /freshco/.test(u)), "no request was made for the started lead");
});

test("recheck: batches of five, remaining reported, repeatable until none are left; a site is never fetched twice for one check", async () => {
  const w = world(); const names = Array.from({ length: 7 }, (_, i) => `Batch ${String.fromCharCode(97 + i)} Co`);
  await brokenLeads(w, names);
  const f = withSite(w, { "*": SR(200, {}, "ok") });
  let r = (await w.api("POST", "/leads/recheck-sites", {})).body;
  assert.deepEqual([r.checked, r.remaining], [5, 2]);
  r = (await w.api("POST", "/leads/recheck-sites", {})).body;
  assert.deepEqual([r.checked, r.remaining], [2, 0]);
  r = (await w.api("POST", "/leads/recheck-sites", {})).body;
  assert.deepEqual([r.checked, r.remaining], [0, 0], "nothing left to check");
  assert.equal(f.calls.length, 7, "one request per site: the first address that proves the site online ends the check");
  assert.equal(w.q("SELECT COUNT(*) AS n FROM outreach_leads WHERE site_status = 'online'")[0].n, 7);
});

test("recheck: an explicit 'check again' works on any website status, input is validated, writes need the same origin", async () => {
  const w = world(); const ids = await brokenLeads(w, ["Again Co"]);
  withSite(w, { "*": SR(403) });
  assert.equal((await w.api("POST", "/leads/recheck-sites", { ids: [ids["Again Co"]] })).body.results[0].state, "unverified");
  withSite(w, { "*": SR(200, {}, "ok") });
  assert.equal((await w.api("POST", "/leads/recheck-sites", {})).body.checked, 0, "an Unverified lead is not re-queued on its own");
  assert.equal((await w.api("POST", "/leads/recheck-sites", { ids: [ids["Again Co"]] })).body.results[0].state, "online", "but can be checked again by hand");
  assert.equal(lead(w, ids["Again Co"]).site_status, "online");
  for (const bad of [{ ids: [] }, { ids: "x" }, { ids: ["nope"] }, { ids: Array.from({ length: 6 }, () => ids["Again Co"].replace(/.$/, "0")) }]) assert.equal((await w.api("POST", "/leads/recheck-sites", bad)).status, 422, JSON.stringify(bad));
  assert.equal((await w.api("POST", "/leads/recheck-sites", {}, undefined)).status, 200);
  assert.equal((await w.api("POST", "/leads/recheck-sites", {}, { write: false })).status ?? 403, 403);
  assert.equal((await w.api("GET", "/leads/recheck-sites")).status, 405);
});

test("recheck: leads whose status is about something else (no website, social page, outdated) are not touched", async () => {
  const w = world();
  w.f.add({ name: "Nothing Co", site_status: "none", contacts: [] }); w.f.add({ name: "Social Co", website: "https://facebook.com/social", site_status: "social_only", contacts: [] }); w.f.add({ name: "Old Co", website: "https://oldco.ca", site_status: "outdated", site_issues: '["No HTTPS"]', contacts: [] });
  await w.api("POST", "/leads/sync");
  const f = withSite(w, { "*": SR(200, {}, "ok") });
  const r = await w.api("POST", "/leads/recheck-sites", { ids: ["Nothing Co", "Social Co", "Old Co"].map((n) => leadId(w, n)) });
  assert.deepEqual(r.body.results.map((x) => x.skipped), ["no_website_claim", "no_website_claim", "no_website_claim"]);
  assert.equal(f.calls.length, 0);
});

test("recheck: drafts and reasons never claim a site is offline unless a check confirmed it", async () => {
  const w = world();
  for (const [status, name] of [["broken", "Claim Co"], ["unverified", "Guarded2 Co"], ["online", "Fine Co"], ["offline", "Down Co"]]) {
    w.f.add({ name, trade: "fence", city: "Calgary", website: `https://${name.toLowerCase().replace(/\W+/g, "")}.ca`, site_status: "outdated", contacts: [] });
  }
  await w.api("POST", "/leads/sync");
  for (const [status, name] of [["broken", "Claim Co"], ["unverified", "Guarded2 Co"], ["online", "Fine Co"], ["offline", "Down Co"]]) w.raw.prepare("UPDATE outreach_leads SET site_status = ? WHERE name = ?").run(status, name);
  for (const [status, name, says] of [["broken", "Claim Co", false], ["unverified", "Guarded2 Co", false], ["online", "Fine Co", false], ["offline", "Down Co", true]]) {
    const l = w.q("SELECT * FROM outreach_leads WHERE name = ?", name)[0];
    for (const approach of ["observation", "demo", "reputation"]) {
      const d = composeDraft({ ...l, rating: 4.8, review_count: 40 }, { demoUrl: "https://staging.frameworkco.ca/d/x", approach });
      assert.equal(/doesn't load|isn't loading|doesn't open/.test(d.subject + d.body), says, `${status} ${approach}`);
      assert.ok(!/looks dated/.test(d.body), `${status}: no claim about the look of a site nobody has assessed`);
    }
  }
});

test("coordination with the finder: its 'offline' (proven) and 'unverified' (could not be judged) rows import with matching wording, a null score for unverified, and drafts that claim only what was proven", async () => {
  const w = world();
  w.f.add({ name: "Proven Gone Co", website: "https://provengone.ca/", site_status: "offline", site_score: 85, site_issues: '["Checked 2026-11-06: offline, home page not found (HTTP 404)","HTTP status 404"]', contacts: [] });
  w.f.add({ name: "Guarded Finder Co", website: "https://guardedfinder.ca/", site_status: "unverified", site_issues: '["Checked 2026-11-06: unverified, blocked or protected (HTTP 403, Cloudflare challenge)","Bot protection seen: Cloudflare challenge"]', contacts: [] });
  w.f.raw.prepare("UPDATE leads SET site_score = NULL WHERE name = 'Guarded Finder Co'").run();
  assert.equal((await w.api("POST", "/leads/sync")).status, 200);
  const gone = w.q("SELECT * FROM outreach_leads WHERE name = 'Proven Gone Co'")[0], guarded = w.q("SELECT * FROM outreach_leads WHERE name = 'Guarded Finder Co'")[0];
  assert.deepEqual([gone.site_status, gone.reason], ["offline", "Website doesn't load (provengone.ca); 4.6 stars from 77 reviews."]);
  assert.deepEqual([guarded.site_status, guarded.site_score], ["unverified", null]);
  assert.match(guarded.reason, /^Website couldn't be checked automatically \(guardedfinder\.ca\); it may be protected, not offline; /);
  assert.deepEqual(JSON.parse(guarded.site_issues), ["Checked 2026-11-06: unverified, blocked or protected (HTTP 403, Cloudflare challenge)", "Bot protection seen: Cloudflare challenge"]);
  const d = composeDraft({ ...guarded, rating: 4.8, review_count: 40 }, { demoUrl: "https://staging.frameworkco.ca/d/x", approach: "observation" });
  assert.ok(!/doesn't load|isn't loading/.test(d.subject + d.body));
  assert.match(composeDraft({ ...gone, rating: 4.8, review_count: 40 }, { demoUrl: "https://staging.frameworkco.ca/d/x", approach: "observation" }).body, /doesn't load for me/);
  // only legacy 'broken' rows are queued for a check; rows the finder already judged are left alone
  const f = withSite(w, { "*": SR(200, {}, "ok") });
  assert.equal((await w.api("POST", "/leads/recheck-sites", {})).body.checked, 0); assert.equal(f.calls.length, 0);
});
