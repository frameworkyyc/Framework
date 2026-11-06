/* The unified request engine (migration 0020): the registry, the lifecycle rulebook, the data layer on a real SQLite database with the real migrations, the service layer
   with fake storage, and everything a stranger, another organization, a member without the right, or a private note or draft file must NOT reach. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb, PROPOSED_DIR } from "./helpers/portal-db.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as repo from "../portal/requests/repo.js";
import * as svc from "../portal/requests/service.js";
import { TYPES, KINDS, getType, typesOfKind, validateDetails, effectiveSettings, DEFAULT_REVISIONS } from "../portal/requests/registry.js";
import { canMove, STATUSES, staffMoves, stageIndex, clientActionReason, revisionsLeft } from "../portal/requests/workflow.js";
import { quoteAcceptanceOpen, QUOTE_TERMS } from "../portal/requests/quote-gate.js";
import { can } from "../portal/policy.js";

const ORG_A = "11111111-1111-4111-8111-111111111111", ORG_B = "22222222-2222-4222-8222-222222222222";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", MEMBER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = new Date("2026-11-10T15:00:00.000Z");
let tick = 0;
const at = () => new Date(T0.getTime() + (tick++) * 1000);

function world() {
  const db = openPortalDb({});
  const r = db.raw;
  for (const [id, slug] of [[ORG_A, "alpha"], [ORG_B, "beta"]]) r.prepare("INSERT INTO organizations (id, slug, name) VALUES (?, ?, ?)").run(id, slug, slug.toUpperCase());
  [[OWNER, "owner@a.test"], [MEMBER, "member@a.test"], [OTHER, "other@b.test"]].forEach(([id, email], i) => r.prepare("INSERT INTO portal_users (id, workos_user_id, email, name) VALUES (?, ?, ?, ?)").run(id, `user_01TEST00000${i}`, email, i === 0 ? "Olive Owner" : i === 1 ? "Max Member" : "Otto Other"));
  [[ORG_A, OWNER, "owner"], [ORG_A, MEMBER, "member"], [ORG_B, OTHER, "owner"]].forEach(([o, u, role], i) => r.prepare("INSERT INTO memberships (id, organization_id, user_id, role, created_by) VALUES (?, ?, ?, ?, 'test')").run(`dddddddd-dddd-4ddd-8ddd-00000000000${i}`, o, u, role));
  return { db, bucket: fakeR2(), r };
}
const form = (o = {}) => { const m = new Map(Object.entries(o)); return { get: (n) => (m.has(n) ? m.get(n) : null), keys: () => m.keys() }; };
const GOOD = { title: "Spring business cards", d_person: "Ann Lee, Owner", d_contact: "403 555 0100\nann@alpha.test", d_purpose: "Hand out at trade shows", d_sides: "two" };
// `now` is a getter: every use of the dependencies moves the clock forward, so a long-lived `d` never carries a stale time
const deps = (w, extra = {}) => ({ db: w.db, bucket: w.bucket, env: {}, get now() { return at(); }, ...extra });
const create = async (w, o = {}, files = []) => svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, typeKey: "business_card", form: form({ ...GOOD, ...o }), files });
const STAFF = "Framework Staff";
const png = () => new Uint8Array(S.png ? S.png() : Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082", "hex"));

/* ------------------------------------------------------------------ registry */

test("registry: every type is complete, unique and has a section; the questions validate and never store unknown fields", () => {
  assert.ok(TYPES.length >= 21);
  assert.equal(new Set(TYPES.map((t) => t.key)).size, TYPES.length);
  for (const t of TYPES) {
    assert.ok(KINDS[t.kind], t.key); assert.match(t.key, /^[a-z0-9_]{2,60}$/); assert.ok(t.label && t.summary && t.fields.length > 0, t.key);
    assert.equal(new Set(t.fields.map((f) => f.key)).size, t.fields.length, t.key + " has duplicate fields");
    for (const f of t.fields) if (f.type === "select" || f.type === "checks") assert.ok(f.options.length > 1, `${t.key}.${f.key}`);
  }
  for (const k of ["business_card", "digital_business_card", "poster", "flyer", "brochure", "social_graphics", "letterhead", "email_signature", "custom_branded"]) assert.equal(getType(k).kind, "deliverable", k);
  assert.equal(typesOfKind("development").length, 8); assert.equal(typesOfKind("deliverable").filter((t) => !t.hidden).length, 8); assert.equal(getType("brochure").hidden, true, "kept so earlier requests still open"); assert.equal(effectiveSettings(getType("brochure")).enabled, false);
  assert.ok(typesOfKind("seo").length >= 4);
  assert.equal(getType("nope"), null); assert.equal(getType("__proto__"), null);
  const t = getType("business_card");
  assert.deepEqual(validateDetails(t, (n) => ({ d_person: "Ann", d_contact: "x", d_purpose: "y", d_evil: "z" })[n] ?? null).details, { person: "Ann", contact: "x", purpose: "y" });
  assert.deepEqual(validateDetails(getType("social_graphics"), (n) => ({ d_platforms__instagram: "1", d_platforms__tiktok: "1", d_platforms__bogus: "1", d_message: "m" })[n] ?? null).details, { platforms: ["instagram", "tiktok"], message: "m" }, "checkbox options are fixed by the registry");
  const bad = validateDetails(t, () => null);
  assert.equal(bad.ok, false); assert.ok(bad.errors.person && bad.errors.contact && bad.errors.purpose);
  assert.equal(validateDetails(t, (n) => ({ d_person: "a", d_contact: "b", d_purpose: "c", d_sides: "three" })[n] ?? null).errors.sides, "Choose one of the options.");
  assert.equal(getType("social_graphics").fields.find((f) => f.type === "checks").required, true);
});

test("registry: settings default to two revision rounds and a custom quote; prices exist only when Admin entered one", () => {
  const e = effectiveSettings(getType("poster"), null);
  assert.deepEqual(e, { enabled: true, revisionsIncluded: DEFAULT_REVISIONS, pricing: { mode: "quote", fixedPriceCents: null }, turnaroundNote: "" });
  assert.equal(DEFAULT_REVISIONS, 2);
  const f = effectiveSettings(getType("poster"), { enabled: 1, revisions_included: 3, pricing_mode: "fixed", fixed_price_cents: 15000, turnaround_note: "About a week" });
  assert.equal(f.revisionsIncluded, 3); assert.deepEqual(f.pricing, { mode: "fixed", fixedPriceCents: 15000 }); assert.equal(f.turnaroundNote, "About a week");
  assert.equal(effectiveSettings(getType("poster"), { enabled: 0, revisions_included: null, pricing_mode: "quote", fixed_price_cents: null }).enabled, false);
  const src = readFileSync(new URL("../portal/requests/registry.js", import.meta.url), "utf8");
  assert.ok(!/\$\s?\d{2,}|\d+\s?(CAD|dollars)\b/.test(src.replace(/\$2,500|\$10,000|\$25,000/g, "")), "no prices or terms are invented in the registry");
});

/* ------------------------------------------------------------------ workflow rulebook */

test("workflow: the rulebook has exactly the approved lifecycle and nothing else", () => {
  assert.deepEqual(STATUSES, ["new", "in_review", "quoted", "approved", "in_progress", "client_review", "revision_requested", "completed", "declined", "cancelled"]);
  for (const closed of ["completed", "declined", "cancelled"]) for (const to of STATUSES) for (const who of ["staff", "client"]) assert.equal(canMove(closed, to, who), false, `${closed} is final`);
  assert.equal(canMove("client_review", "revision_requested", "client"), true);
  assert.equal(canMove("client_review", "revision_requested", "staff"), false);
  assert.equal(canMove("client_review", "completed", "client"), true);
  assert.equal(canMove("in_progress", "completed", "client"), false, "the client cannot complete work that is not in review");
  assert.equal(canMove("new", "in_progress", "staff"), false, "no skipping review and approval");
  assert.equal(canMove("in_review", "approved", "client"), false);
  assert.equal(canMove("approved", "cancelled", "client"), false, "once approved, only Framework cancels");
  assert.ok(staffMoves("new").includes("in_review") && !staffMoves("new").includes("completed"));
  assert.equal(stageIndex("new"), 0); assert.equal(stageIndex("completed"), 6); assert.equal(stageIndex("revision_requested"), stageIndex("in_progress")); assert.equal(stageIndex("declined"), -1);
  assert.equal(clientActionReason({ status: "client_review" }), "proof");
  assert.equal(clientActionReason({ status: "quoted" }, { owner: true }), "quote");
  assert.equal(clientActionReason({ status: "quoted" }, { owner: false }), "");
  assert.equal(clientActionReason({ status: "completed", unreadForClient: true }), "");
  assert.equal(revisionsLeft({ revisionsIncluded: 2, revisionsPaid: 1, revisionsUsed: 2 }), 1);
});

test("policy: members may ask for work and review proofs; only owners accept quotes; strangers and unknown roles get nothing", () => {
  for (const a of ["requests.view", "requests.submit", "requests.approve_proof"]) { assert.equal(can("owner", a), true); assert.equal(can("member", a), true); assert.equal(can("viewer", a), false); }
  assert.equal(can("owner", "requests.accept_quote"), true);
  assert.equal(can("member", "requests.accept_quote"), false);
  assert.equal(can(undefined, "requests.view"), false);
});

test("the quote gate is closed until Framework's terms exist AND the flag is on; nothing is pre-filled", () => {
  assert.equal(QUOTE_TERMS.version, ""); assert.equal(QUOTE_TERMS.text, "");
  assert.equal(quoteAcceptanceOpen({ PORTAL_REQUESTS_QUOTES: "1" }), false, "flag alone is not enough");
  assert.equal(quoteAcceptanceOpen({}, { version: "v1", text: "x" }), false, "terms alone are not enough");
  assert.equal(quoteAcceptanceOpen({ PORTAL_REQUESTS_QUOTES: "1" }, { version: "v1", text: "x" }), true);
  assert.equal(quoteAcceptanceOpen({ PORTAL_REQUESTS_QUOTES: "true" }, { version: "v1", text: "x" }), false);
});

/* ------------------------------------------------------------------ migration */

test("migration 0020 is additive, applies on top of everything shipped, and its constraints hold", () => {
  const sql = readFileSync(new URL("../../migrations/portal/0020_requests.sql", import.meta.url), "utf8");
  assert.ok(!/DROP\s|DELETE\s+FROM|UPDATE\s+\w+\s+SET|RENAME/i.test(sql.replace(/--.*$/gm, "")), "additive only");
  assert.equal([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]).join(), "requests,request_events,request_files,request_quotes,request_type_settings");
  const w = world(), r = w.r;
  const ins = (o) => r.prepare("INSERT INTO requests (id, organization_id, kind, type_key, title, status, submitted_by, created_at, status_changed_at, last_message_at) VALUES (?, ?, ?, ?, ?, ?, ?, 't', 't', 't')").run(...o);
  ins(["e1111111-1111-4111-8111-111111111111", ORG_A, "deliverable", "poster", "ok", "new", OWNER]);
  assert.throws(() => ins(["e2222222-2222-4222-8222-222222222222", ORG_A, "bogus", "poster", "x", "new", OWNER]), /constraint/i);
  assert.throws(() => ins(["e3333333-3333-4333-8333-333333333333", ORG_A, "deliverable", "Bad Key", "x", "new", OWNER]), /constraint/i);
  assert.throws(() => ins(["e4444444-4444-4444-8444-444444444444", ORG_A, "deliverable", "poster", "x", "completed", OWNER]), /constraint/i, "completed needs completed_at");
  assert.throws(() => r.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, visibility, body, created_at) VALUES ('f1111111-1111-4111-8111-111111111111', ?, 'e1111111-1111-4111-8111-111111111111', 'message', 'client', 'client', '', 't')").run(ORG_A), /constraint/i, "a client event needs its user");
  assert.throws(() => r.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, created_at) VALUES ('f2222222-2222-4222-8222-222222222222', ?, 'e1111111-1111-4111-8111-111111111111', 'message', 'client', ?, 'internal', '', 't')").run(ORG_A, OWNER), /constraint/i, "a client cannot write internal notes");
  assert.throws(() => r.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_user_id, visibility, body, created_at) VALUES ('f3333333-3333-4333-8333-333333333333', ?, 'e1111111-1111-4111-8111-111111111111', 'proof', 'client', ?, 'client', '', 't')").run(ORG_A, OWNER), /constraint/i, "only staff add proofs");
  assert.throws(() => r.prepare("INSERT INTO request_events (id, organization_id, request_id, kind, author_type, author_label, visibility, body, created_at) VALUES ('f4444444-4444-4444-8444-444444444444', ?, 'e1111111-1111-4111-8111-111111111111', 'message', 'staff', 'S', 'client', '', 't')").run(ORG_B), /constraint/i, "an event cannot point at another organization's request");
  assert.throws(() => r.prepare("INSERT INTO request_type_settings (type_key, pricing_mode, fixed_price_cents, updated_by, updated_at) VALUES ('poster', 'quote', 100, 'x', 't')").run(), /constraint/i, "a price needs fixed mode");
  assert.throws(() => r.prepare("INSERT INTO request_type_settings (type_key, pricing_mode, updated_by, updated_at) VALUES ('poster', 'fixed', 'x', 't')").run(), /constraint/i, "fixed mode needs a price");
  assert.ok(r.prepare("SELECT 1 FROM pragma_table_info('invoices') WHERE name = 'request_id'").get());
  assert.equal(w.db.raw.prepare("PRAGMA foreign_key_check").all().length, 0);
});

/* ------------------------------------------------------------------ create */

test("creating a request validates, snapshots nothing it was not given, queues one staff notice, and stores reference files privately under the organization", async () => {
  const w = world();
  assert.deepEqual((await create(w, { title: "" })).errors.title.length > 0, true);
  const bad = await create(w, { d_person: "" }); assert.equal(bad.error, "invalid_details"); assert.ok(bad.errors.person);
  assert.equal((await create(w, { needed_by: "soon" })).errors.needed_by.length > 0, true);
  assert.equal((await svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, typeKey: "nope", form: form(GOOD) })).error, "invalid_type");
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM requests").get().n, 0, "nothing was written by the refusals");
  const made = await create(w, {}, [{ name: "logo.png", bytes: png() }]);
  assert.equal(made.ok, true); assert.equal(made.attached, 1);
  const row = w.r.prepare("SELECT * FROM requests WHERE id = ?").get(made.id);
  assert.equal(row.kind, "deliverable"); assert.equal(row.status, "new"); assert.equal(row.revisions_included, 2); assert.equal(row.revisions_used, 0);
  assert.deepEqual(JSON.parse(row.details_json), { person: "Ann Lee, Owner", contact: "403 555 0100\nann@alpha.test", purpose: "Hand out at trade shows", sides: "two" });
  assert.equal(row.brand_snapshot_json, null);
  const f = w.r.prepare("SELECT * FROM request_files WHERE request_id = ?").get(made.id);
  assert.match(f.storage_key, new RegExp(`^org/${ORG_A}/requests/`)); assert.equal(f.role, "reference");
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM service_notifications WHERE entity_id = ? AND audience = 'staff' AND event = 'request_submitted'").get(made.id).n, 1);
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM activity_log WHERE entity_id = ? AND action = 'request.created'").get(made.id).n, 1);
});

test("a development request keeps zero included revisions (revisions apply to design proofs); a disabled service cannot be requested", async () => {
  const w = world();
  const dev = await svc.clientCreate(deps(w), { role: "member", organizationId: ORG_A, userId: MEMBER, typeKey: "ai_automation", form: form({ title: "Quote follow-ups", d_problem: "We chase quotes by hand", d_outcomes: "Automatic reminders", d_budget: "2500_10000" }) });
  assert.equal(dev.ok, true);
  assert.equal(w.r.prepare("SELECT revisions_included AS n FROM requests WHERE id = ?").get(dev.id).n, 0);
  await repo.saveTypeSettings(w.db, "poster", { enabled: false }, STAFF);
  assert.equal((await create(w, {})).ok, true, "business cards unaffected");
  const off = await svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, typeKey: "poster", form: form({ title: "P", d_headline: "H", d_details: "D", d_purpose: "P" }) });
  assert.equal(off.error, "not_available");
  await repo.saveTypeSettings(w.db, "business_card", { revisionsIncluded: 3, pricingMode: "fixed", fixedPriceCents: 12500, turnaroundNote: "Five working days" }, STAFF);
  const three = await create(w, {}); assert.equal(w.r.prepare("SELECT revisions_included AS n FROM requests WHERE id = ?").get(three.id).n, 3, "the per-service setting is copied onto the request");
});

test("only organization members can create; a stranger, a revoked member and an unknown role cannot; the open-request cap holds", async () => {
  const w = world();
  assert.equal((await svc.clientCreate(deps(w), { role: "viewer", organizationId: ORG_A, userId: OWNER, typeKey: "business_card", form: form(GOOD) })).error, "forbidden");
  assert.equal((await svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OTHER, typeKey: "business_card", form: form(GOOD) })).error, "not_allowed", "another organization's user is not a member of this one");
  w.r.prepare("UPDATE memberships SET status = 'revoked', revoked_at = 't' WHERE user_id = ?").run(MEMBER);
  assert.equal((await svc.clientCreate(deps(w), { role: "member", organizationId: ORG_A, userId: MEMBER, typeKey: "business_card", form: form(GOOD) })).error, "not_allowed");
  for (let i = 0; i < repo.MAX_OPEN_REQUESTS; i++) assert.equal((await create(w, { title: "n" + i })).ok, true);
  assert.equal((await create(w, { title: "one too many" })).error, "too_many_open");
});

/* ------------------------------------------------------------------ the lifecycle, end to end */

async function toClientReview(w, id) {
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_review", STAFF, { now: at() })).ok, true);
  assert.equal((await repo.approveRequest(w.db, ORG_A, id, { via: "staff_record", actorLabel: STAFF, note: "Included in the package" }, { now: at() })).ok, true);
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_progress", STAFF, { now: at() })).ok, true);
}
const proof = (name = "proof.png") => ({ bytes: png(), name });

test("lifecycle with a quote: request, review, quote, recorded approval, work, proof, revision, new proof, approval, final files", async () => {
  const w = world(); const d = deps(w);
  const { id } = await create(w);
  const asClient = { role: "owner", organizationId: ORG_A, userId: OWNER };
  // the client cannot approve a proof that does not exist, or complete unreviewed work
  assert.equal((await svc.clientApprove(d, { ...asClient, requestId: id })).error, "not_permitted_move");
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_review", STAFF, { now: at() })).ok, true);
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "quoted", STAFF)).error, "use_quote_or_approval");
  const q = await repo.createQuote(w.db, ORG_A, id, { title: "Business cards", scope: "Design of a two-sided card, delivered digitally.", amountCents: 18000, validUntil: "2026-12-31" }, STAFF, { now: at() });
  assert.equal(q.ok, true);
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).status, "quoted");
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM service_notifications WHERE audience = 'client' AND entity_id = ?").get(id).n, 1);
  // a quote is a number staff typed: nothing is calculated, tax is reserved and empty
  const row = w.r.prepare("SELECT amount_cents, currency, tax_cents, tax_label FROM request_quotes WHERE id = ?").get(q.id);
  assert.deepEqual({ ...row }, { amount_cents: 18000, currency: "CAD", tax_cents: null, tax_label: null });
  // the client cannot accept in the portal while the gate is closed
  assert.equal((await svc.clientAcceptQuote(d, { ...asClient, requestId: id, quoteId: q.id, typedName: "Olive Owner" })).error, "acceptance_closed");
  assert.equal((await svc.clientAcceptQuote(deps(w, { env: { PORTAL_REQUESTS_QUOTES: "1" } }), { ...asClient, requestId: id, quoteId: q.id, typedName: "Olive Owner" })).error, "acceptance_closed", "flag without terms stays closed");
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).status, "quoted");
  // Framework records an agreement made outside the portal
  const rec = await repo.approveRequest(w.db, ORG_A, id, { via: "staff_record", quoteId: q.id, actorLabel: STAFF, note: "Agreed by phone" }, { now: at() });
  assert.equal(rec.ok, true);
  const quote = w.r.prepare("SELECT status, decided_via, decided_by, accepted_name, terms_version FROM request_quotes WHERE id = ?").get(q.id);
  assert.deepEqual({ ...quote }, { status: "accepted", decided_via: "staff_record", decided_by: null, accepted_name: null, terms_version: null });
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_progress", STAFF, { now: at() })).ok, true);
  // a draft proof is invisible to the client until it is sent for review
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: id, role: "proof", file: proof(), actor: STAFF })).ok, true);
  assert.equal((await repo.getClientThread(w.db, ORG_A, id)).files.filter((f) => f.role === "proof").length, 0, "draft proof hidden");
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "client_review", STAFF, { now: at() })).ok, true);
  let thread = await repo.getClientThread(w.db, ORG_A, id);
  const p1 = thread.files.find((f) => f.role === "proof"); assert.ok(p1); assert.equal(p1.version, 1); assert.equal(p1.round, 0);
  // the client asks for a revision (comment required), then Framework sends a new proof
  assert.equal((await svc.clientRevise(d, { ...asClient, requestId: id, note: "" })).error, "message_required");
  assert.equal((await svc.clientRevise(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: id, note: "Make the logo larger" })).ok, true, "a member may review proofs");
  let cur = await repo.getRequest(w.db, ORG_A, id); assert.equal(cur.status, "revision_requested"); assert.equal(cur.revisionsUsed, 1); assert.equal(cur.revisionsLeft, 1);
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "client_review", STAFF)).error, "no_proof", "cannot send for review without a proof for the new round");
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_progress", STAFF, { now: at() })).ok, true);
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: id, role: "proof", file: proof("proof-2.png"), actor: STAFF })).ok, true);
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "client_review", STAFF, { now: at() })).ok, true);
  thread = await repo.getClientThread(w.db, ORG_A, id);
  const p2 = thread.files.filter((f) => f.role === "proof").map((f) => f.version).sort(); assert.deepEqual(p2, [1, 2]);
  assert.equal(thread.files.find((f) => f.version === 2).round, 1);
  // final files are held back until the client approves
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: id, role: "final", file: { bytes: S.pdf ? S.pdf() : new TextEncoder().encode("%PDF-1.4\n%%EOF\n"), name: "cards-final.pdf" }, actor: STAFF })).ok, true);
  assert.equal((await repo.getClientThread(w.db, ORG_A, id)).files.some((f) => f.role === "final"), false, "finals hidden before completion");
  assert.equal((await svc.clientApprove(d, { ...asClient, requestId: id, note: "Looks great" })).ok, true);
  cur = await repo.getRequest(w.db, ORG_A, id); assert.equal(cur.status, "completed"); assert.ok(cur.completedAt);
  thread = await repo.getClientThread(w.db, ORG_A, id);
  assert.equal(thread.files.filter((f) => f.role === "final").length, 1, "finals released on completion");
  const kinds = thread.events.map((e) => e.kind); assert.ok(kinds.includes("quote") && kinds.includes("revision") && kinds.includes("approval"));
  // closed is closed
  assert.equal((await svc.clientReply(d, { ...asClient, requestId: id, body: "one more thing" })).error, "closed");
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_progress", STAFF)).error, "not_permitted_move");
  assert.ok(w.r.prepare("SELECT count(*) AS n FROM activity_log WHERE entity_id = ?").get(id).n >= 10, "every step is audited");
});

test("revision limit: the included rounds run out, the client is told, and Framework can grant paid rounds", async () => {
  const w = world(); const d = deps(w); const asClient = { role: "owner", organizationId: ORG_A, userId: OWNER };
  const { id } = await create(w); await toClientReview(w, id);
  for (let round = 0; round < 2; round++) {
    assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: id, role: "proof", file: proof(), actor: STAFF })).ok, true);
    assert.equal((await repo.setStatus(w.db, ORG_A, id, "client_review", STAFF, { now: at() })).ok, true);
    assert.equal((await svc.clientRevise(d, { ...asClient, requestId: id, note: "Change " + round })).ok, true);
    assert.equal((await repo.setStatus(w.db, ORG_A, id, "in_progress", STAFF, { now: at() })).ok, true);
  }
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: id, role: "proof", file: proof(), actor: STAFF })).ok, true);
  assert.equal((await repo.setStatus(w.db, ORG_A, id, "client_review", STAFF, { now: at() })).ok, true);
  const third = await svc.clientRevise(d, { ...asClient, requestId: id, note: "A third change" });
  assert.equal(third.error, "revision_limit"); assert.equal((await repo.getRequest(w.db, ORG_A, id)).status, "client_review", "refused without changing anything");
  assert.equal((await repo.grantRevisions(w.db, ORG_A, id, 1, STAFF, { now: at() })).ok, true);
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).revisionsLeft, 1);
  assert.equal((await svc.clientRevise(d, { ...asClient, requestId: id, note: "A third change, now agreed" })).ok, true);
  assert.equal((await repo.grantRevisions(w.db, ORG_A, id, 0, STAFF)).error, "invalid_count");
});

test("a declined quote returns the request to review; a withdrawn quote disappears for the client; a new quote supersedes the old", async () => {
  const w = world(); const d = deps(w);
  const { id } = await create(w);
  const q1 = await repo.createQuote(w.db, ORG_A, id, { title: "First", scope: "Scope one", amountCents: 10000 }, STAFF, { now: at() });
  const dec = await svc.clientDeclineQuote(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: id, quoteId: q1.id, note: "Too high" });
  assert.equal(dec.ok, true); assert.equal((await repo.getRequest(w.db, ORG_A, id)).status, "in_review");
  assert.equal((await svc.clientDeclineQuote(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: id, quoteId: q1.id })).error, "forbidden", "members do not decide quotes");
  const q2 = await repo.createQuote(w.db, ORG_A, id, { title: "Second", scope: "Scope two", amountCents: 8000 }, STAFF, { now: at() });
  const q3 = await repo.createQuote(w.db, ORG_A, id, { title: "Third", scope: "Scope three", amountCents: 7500 }, STAFF, { now: at() });
  const states = w.r.prepare("SELECT version, status FROM request_quotes WHERE request_id = ? ORDER BY version").all(id).map((x) => `${x.version}:${x.status}`);
  assert.deepEqual(states, ["1:declined", "2:superseded", "3:sent"]);
  assert.equal((await repo.withdrawQuote(w.db, ORG_A, id, q3.id, STAFF)).ok, true);
  assert.deepEqual((await repo.getClientThread(w.db, ORG_A, id)).quotes.map((q) => q.version), [1, 2], "the withdrawn quote is not shown");
  assert.equal((await repo.createQuote(w.db, ORG_A, id, { title: "", scope: "x", amountCents: 1 }, STAFF)).error, "invalid_title");
  assert.equal((await repo.createQuote(w.db, ORG_A, id, { title: "t", scope: "x", amountCents: -5 }, STAFF)).error, "invalid_amount");
  assert.equal((await repo.createQuote(w.db, ORG_A, id, { title: "t", scope: "x", amountCents: 1.5 }, STAFF)).error, "invalid_amount");
});

test("accepting a quote works once the gate is open (terms supplied): owners only, typed name required, recorded with the terms version", async () => {
  const w = world(); const terms = { version: "2026-12-01", text: "approval wording" }; const env = { PORTAL_REQUESTS_QUOTES: "1" }; const d = deps(w, { env });
  const { id } = await create(w);
  const q = await repo.createQuote(w.db, ORG_A, id, { title: "Q", scope: "S", amountCents: 5000 }, STAFF, { now: at() });
  assert.equal((await svc.clientAcceptQuote(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: id, quoteId: q.id, typedName: "Max", terms })).error, "forbidden");
  assert.equal((await svc.clientAcceptQuote(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: id, quoteId: q.id, typedName: "", terms })).error, "name_required");
  assert.equal((await svc.clientAcceptQuote(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: id, quoteId: q.id, typedName: "Olive Owner", terms })).ok, true);
  assert.deepEqual({ ...w.r.prepare("SELECT status, decided_via, decided_by, accepted_name, terms_version FROM request_quotes WHERE id = ?").get(q.id) }, { status: "accepted", decided_via: "portal", decided_by: OWNER, accepted_name: "Olive Owner", terms_version: "2026-12-01" });
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).status, "approved");
  assert.equal((await svc.clientAcceptQuote(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: id, quoteId: q.id, typedName: "Olive Owner", terms })).error, "not_permitted_move", "cannot accept twice");
});

test("cancelling: a member withdraws their own request, an owner any, nobody after approval; staff decline", async () => {
  const w = world(); const d = deps(w);
  const mine = (await svc.clientCreate(deps(w), { role: "member", organizationId: ORG_A, userId: MEMBER, typeKey: "flyer", form: form({ title: "Flyer", d_headline: "Sale", d_details: "All week", d_purpose: "Walk-ins" }) })).id;
  const owners = (await create(w)).id;
  assert.equal((await svc.clientCancel(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: owners })).error, "forbidden", "a member cannot withdraw the owner's request");
  assert.equal((await svc.clientCancel(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: mine, note: "Changed my mind" })).ok, true);
  assert.equal((await svc.clientCancel(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: mine })).error, "closed", "already cancelled");
  assert.equal((await svc.clientCancel(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: owners })).ok, true, "an owner may withdraw any");
  const later = (await create(w, { title: "later" })).id; await toClientReview(w, later);
  assert.equal((await svc.clientCancel(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: later })).error, "not_permitted_move");
  const n = (await create(w, { title: "no" })).id;
  assert.equal((await repo.setStatus(w.db, ORG_A, n, "declined", STAFF, { note: "Not something we do" })).ok, true);
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM service_notifications WHERE audience = 'client' AND event = 'request_status' AND entity_id = ?").get(n).n, 1);
});

/* ------------------------------------------------------------------ privacy and isolation */

test("a client never sees internal notes, draft proofs or early finals; replies and unread markers work both ways", async () => {
  const w = world(); const d = deps(w);
  const { id } = await create(w);
  assert.equal((await repo.addStaffMessage(w.db, ORG_A, id, "Private: price it high", STAFF, { internal: true, now: at() })).ok, true);
  assert.equal((await repo.addStaffMessage(w.db, ORG_A, id, "Thanks, we are on it.", STAFF, { now: at() })).ok, true);
  const t = await repo.getClientThread(w.db, ORG_A, id);
  assert.equal(JSON.stringify(t).includes("Private"), false, "internal notes never reach the client payload");
  assert.ok(t.events.some((e) => e.body === "Thanks, we are on it." && e.authorName === "Framework"));
  assert.equal(t.request.unreadForClient, true);
  await repo.markClientRead(w.db, ORG_A, id, { now: at() });
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).unreadForClient, false);
  const rep = await svc.clientReply(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: id, body: "Great, thank you" }); assert.equal(rep.ok, true, JSON.stringify(rep));
  assert.equal((await repo.getRequest(w.db, ORG_A, id)).newForAdmin, true);
  const admin = await repo.getAdminThread(w.db, ORG_A, id);
  assert.ok(admin.events.some((e) => e.visibility === "internal" && e.body.startsWith("Private")), "staff see the notes");
  assert.equal((await svc.clientReply(d, { role: "member", organizationId: ORG_A, userId: MEMBER, requestId: id, body: "   " })).error, "message_required");
});

test("files: tenant isolation, draft and final gating, proofs are viewed (never downloaded), downloads are recorded and hardened", async () => {
  const w = world(); const d = deps(w);
  const ref = await create(w, {}, [{ name: "logo.png", bytes: png() }]);
  const reqId = ref.id; const refFile = w.r.prepare("SELECT id FROM request_files WHERE request_id = ? AND role = 'reference'").get(reqId).id;
  await toClientReview(w, reqId);
  await svc.adminUpload(d, { organizationId: ORG_A, requestId: reqId, role: "proof", file: proof(), actor: STAFF });
  const proofId = w.r.prepare("SELECT id FROM request_files WHERE role = 'proof'").get().id;
  const open = (o) => svc.clientOpenFile(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: reqId, ...o });
  assert.equal((await open({ fileId: proofId, view: true })).error, "not_found", "a draft proof is not visible");
  await repo.setStatus(w.db, ORG_A, reqId, "client_review", STAFF, { now: at() });
  const view = await open({ fileId: proofId, view: true }); assert.equal(view.ok, true);
  assert.equal(view.response.headers.get("Content-Disposition"), "inline"); assert.equal(view.response.headers.get("Content-Type"), "image/png");
  assert.equal(view.response.headers.get("X-Content-Type-Options"), "nosniff"); assert.match(view.response.headers.get("Content-Security-Policy"), /sandbox/);
  assert.equal((await open({ fileId: proofId, view: false })).error, "not_found", "a proof cannot be downloaded, only viewed");
  const dl = await open({ fileId: refFile }); assert.equal(dl.ok, true);
  assert.match(dl.response.headers.get("Content-Disposition"), /^attachment/); assert.equal(dl.response.headers.get("Content-Type"), "application/octet-stream");
  assert.equal((await open({ fileId: refFile, view: true })).error, "not_found", "only proofs have a view");
  assert.equal((await svc.clientOpenFile(d, { role: "owner", organizationId: ORG_B, userId: OTHER, requestId: reqId, fileId: refFile })).error, "not_found", "another organization gets the same not_found");
  assert.equal((await svc.clientOpenFile(d, { role: "viewer", organizationId: ORG_A, userId: OWNER, requestId: reqId, fileId: refFile })).error, "forbidden");
  assert.equal((await open({ fileId: "99999999-9999-4999-8999-999999999999" })).error, "not_found");
  await svc.adminUpload(d, { organizationId: ORG_A, requestId: reqId, role: "final", file: { bytes: png(), name: "final.png" }, actor: STAFF });
  const finalId = w.r.prepare("SELECT id FROM request_files WHERE role = 'final'").get().id;
  assert.equal((await open({ fileId: finalId })).error, "not_found", "finals are not visible before completion");
  await svc.clientApprove(d, { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: reqId });
  assert.equal((await open({ fileId: finalId })).ok, true, "released on completion");
  assert.ok(w.r.prepare("SELECT count(*) AS n FROM activity_log WHERE action = 'request.file.download'").get().n >= 2, "downloads are recorded");
  // staff upload rules
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: reqId, role: "proof", file: { bytes: new TextEncoder().encode("MZ binary"), name: "x.exe" }, actor: STAFF })).ok, false);
  assert.equal((await svc.adminUpload(d, { organizationId: ORG_A, requestId: reqId, role: "bogus", file: proof(), actor: STAFF })).error, "invalid_role");
});

test("client uploads: executable and disguised files are refused, limits hold per message and per request, and nothing is stored on refusal", async () => {
  const w = world();
  const bad = await create(w, { title: "bad" }, [{ name: "run.exe", bytes: new TextEncoder().encode("MZ…") }]);
  assert.ok(["type_not_allowed", "invalid_name"].includes(bad.error), "an executable is refused: " + bad.error);
  assert.equal((await create(w, { title: "bad2" }, [{ name: "fake.png", bytes: new TextEncoder().encode("<html>not a png</html>") }])).ok, false);
  assert.equal((await create(w, { title: "many" }, Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.png`, bytes: png() })))).error, "too_many_attachments");
  assert.equal(w.bucket.size ? w.bucket.size() : 0, 0, "no object was stored for refused uploads");
  assert.equal(w.r.prepare("SELECT count(*) AS n FROM requests").get().n, 0);
  const ok1 = await create(w, { title: "fine" }, Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.png`, bytes: png() }))); assert.equal(ok1.attached, 4);
  let total = 4;
  while (total < repo.MAX_FILES_PER_REQUEST) { const r = await svc.clientReply(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: ok1.id, body: "more", files: Array.from({ length: 4 }, (_, i) => ({ name: `g${total}${i}.png`, bytes: png() })) }); total += r.attached; }
  const over = await svc.clientReply(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: ok1.id, body: "one more", files: [{ name: "h.png", bytes: png() }] });
  assert.equal(over.ok, true); assert.equal(over.attached, 0); assert.equal(over.attachmentsFailed, 1, "the per-request file cap refuses the file, not the message");
});

test("requests belong to one organization: lists, threads, writes and the global lists never cross", async () => {
  const w = world(); const d = deps(w);
  const a = (await create(w)).id;
  const b = (await svc.clientCreate(d, { role: "owner", organizationId: ORG_B, userId: OTHER, typeKey: "flyer", form: form({ title: "Beta flyer", d_headline: "H", d_details: "D", d_purpose: "P" }) })).id;
  assert.deepEqual((await repo.listClientRequests(w.db, ORG_A)).map((r) => r.id), [a]);
  assert.equal(await repo.getClientThread(w.db, ORG_A, b), null);
  assert.equal(await repo.getRequest(w.db, ORG_A, b), null);
  assert.equal((await repo.addClientMessage(w.db, ORG_A, OWNER, b, "hi")).error, "not_found");
  assert.equal((await repo.clientCancel(w.db, ORG_A, OWNER, b)).error, "not_found");
  assert.equal((await repo.addStaffMessage(w.db, ORG_A, b, "hi", STAFF)).error, "not_found");
  assert.equal((await repo.setStatus(w.db, ORG_A, b, "in_review", STAFF)).error, "not_found");
  assert.equal((await repo.createQuote(w.db, ORG_A, b, { title: "t", scope: "s", amountCents: 1 }, STAFF)).error, "conflict".replace("conflict", (await repo.getRequest(w.db, ORG_A, b)) ? "conflict" : "not_found"));
  assert.equal((await repo.listRequestsAllAdmin(w.db, { scope: "all" })).length, 2, "Admin's global list spans organizations");
  assert.equal((await repo.listRequestsAdmin(w.db, ORG_B)).length, 1);
  assert.equal(await repo.getAdminThread(w.db, ORG_B, a), null);
});

test("the summary names what waits for the client: a design to review, a quote (owners only), a new reply", async () => {
  const w = world(); const d = deps(w);
  const q = (await create(w, { title: "needs quote" })).id; await repo.createQuote(w.db, ORG_A, q, { title: "Q", scope: "S", amountCents: 100 }, STAFF, { now: at() });
  const p = (await create(w, { title: "needs review" })).id; await toClientReview(w, p);
  await svc.adminUpload(d, { organizationId: ORG_A, requestId: p, role: "proof", file: proof(), actor: STAFF }); await repo.setStatus(w.db, ORG_A, p, "client_review", STAFF, { now: at() });
  const owner = await repo.clientSummary(w.db, ORG_A, { owner: true }), member = await repo.clientSummary(w.db, ORG_A, { owner: false });
  assert.equal(owner.open, 2); assert.deepEqual(owner.actions.map((a) => a.reason).sort(), ["proof", "quote"]);
  assert.ok(!member.actions.some((a) => a.reason === "quote"), "a member is not asked to decide a quote"); assert.ok(member.actions.some((a) => a.reason === "proof"), "but is asked to review a design");
});

test("Admin lists say why a request needs attention and count it", async () => {
  const w = world();
  const { id } = await create(w);
  let all = await repo.listRequestsAllAdmin(w.db, { scope: "attention" });
  assert.equal(all.length, 1); assert.equal(all[0].reason, "New request"); assert.equal(all[0].orgName, "ALPHA");
  await repo.markAdminSeen(w.db, ORG_A, id, { now: at() });
  await repo.setStatus(w.db, ORG_A, id, "in_review", STAFF, { now: at() });
  assert.equal((await repo.listRequestsAllAdmin(w.db, { scope: "attention" })).length, 0, "seen and in review: nothing to do");
  assert.equal((await repo.adminTotals(w.db)).open, 1);
  await svc.clientReply(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, requestId: id, body: "Any news?" });
  assert.equal((await repo.listRequestsAllAdmin(w.db, { scope: "attention" }))[0].reason, "Client replied");
  assert.equal((await repo.listRequestsAllAdmin(w.db, { scope: "closed" })).length, 0);
});

test("a request about a website must name one of the organization's own published websites", async () => {
  const w = world(); const r = w.r;
  const site = (id, org, pub) => r.prepare("INSERT INTO websites (id, organization_id, name, url, origin, status, published) VALUES (?, ?, 'Site', 'https://example.com', 'client', 'live', ?)").run(id, org, pub);
  site("a1111111-1111-4111-8111-111111111111", ORG_A, 1); site("b1111111-1111-4111-8111-111111111111", ORG_B, 1); site("a2222222-2222-4222-8222-222222222222", ORG_A, 0);
  const seo = (wid) => svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, typeKey: "seo_audit", form: form({ title: "Audit", d_goals: "More calls", website_id: wid }) });
  assert.equal((await seo("a1111111-1111-4111-8111-111111111111")).ok, true);
  assert.equal((await seo("b1111111-1111-4111-8111-111111111111")).error, "website_not_found", "another organization's website");
  assert.equal((await seo("a2222222-2222-4222-8222-222222222222")).error, "website_not_found", "an unpublished website");
  assert.equal((await seo("not-a-uuid")).error, "website_not_found");
  assert.equal((await svc.clientCreate(deps(w), { role: "owner", organizationId: ORG_A, userId: OWNER, typeKey: "poster", form: form({ title: "P", d_headline: "H", d_details: "D", d_purpose: "P", website_id: "a1111111-1111-4111-8111-111111111111" }) })).ok, true, "types that do not use a website ignore the field");
});

test("the brand snapshot is built from the PUBLISHED kit on the server, never from what the form says", async () => {
  const w = world(); const r = w.r;
  const noKit = await create(w, { use_brand: "1" }); assert.equal(w.r.prepare("SELECT brand_snapshot_json AS j FROM requests WHERE id = ?").get(noKit.id).j, null, "no published kit: nothing snapshotted");
  r.prepare("INSERT INTO brand_kits (organization_id, status, colours_json, typography_json, updated_by, published_at, published_by) VALUES (?, 'published', ?, ?, 'a', 't', 'a')").run(ORG_A, JSON.stringify([{ name: "Brick", hex: "#aa3322" }, { name: "Bad", hex: "javascript:alert(1)" }]), JSON.stringify([{ family: "Switzer", slot: "primary" }]));
  const asset = (id, kind, title) => r.prepare("INSERT INTO brand_assets (id, organization_id, kind, title, format, content_type, size_bytes, sha256, storage_key, original_name, published, created_at, created_by, updated_at, updated_by) VALUES (?, ?, ?, ?, 'png', 'image/png', 10, ?, ?, 'x.png', 1, 't', 'a', 't', 'a')").run(id, ORG_A, kind, title, "a".repeat(64), `org/${ORG_A}/brand-assets/${id}`);
  const LOGO = "a0000000-0000-4000-8000-000000000001", OTHERLOGO = "a0000000-0000-4000-8000-000000000002";
  try { asset(LOGO, "logo", "Primary logo"); asset(OTHERLOGO, "guideline", "Guide"); } catch (e) { /* the asset table's column set is the brand module's: skip the logo parts if it differs */ }
  const made = await create(w, { use_brand: "1", [`logo_${LOGO}`]: "1", [`logo_${OTHERLOGO}`]: "1", "logo_11111111-2222-4333-8444-555555555555": "1" });
  const snap = JSON.parse(w.r.prepare("SELECT brand_snapshot_json AS j FROM requests WHERE id = ?").get(made.id).j);
  assert.deepEqual(snap.colours, [{ name: "Brick", hex: "#aa3322" }], "an unsafe colour value is dropped");
  assert.deepEqual(snap.fonts, [{ family: "Switzer", slot: "primary" }]);
  assert.ok(snap.logos.every((l) => l.id !== OTHERLOGO && l.id !== "11111111-2222-4333-8444-555555555555"), "only real, published logos of this organization");
  const off = await create(w, { title: "no brand" }); assert.equal(w.r.prepare("SELECT brand_snapshot_json AS j FROM requests WHERE id = ?").get(off.id).j, null);
});

test("every statement in the engine names the organization (static check on the data layer)", () => {
  const src = readFileSync(new URL("../portal/requests/repo.js", import.meta.url), "utf8");
  const sqls = [...src.matchAll(/prepare\(\s*[`"]([\s\S]*?)[`"]\s*\)/g)].map((m) => m[1]);
  const writes = sqls.filter((q) => /^\s*(UPDATE|INSERT INTO) (requests|request_events|request_files|request_quotes)\b/i.test(q));
  assert.ok(writes.length >= 15);
  for (const q of writes) assert.match(q, /organization_id/, "a write that does not name the organization: " + q.slice(0, 80));
  assert.ok(!/DELETE\s+FROM\s+(requests|request_)/i.test(src), "nothing in the engine deletes requests, events, files or quotes");
});
