// Private demo-page traffic reporting: opaque links (/d/<token>), anonymous events (/api/demo-events), enquiries, and the Admin API (worker/demo-traffic.js, worker/admin/demo-traffic-api.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openPortalDb } from "./helpers/portal-db.mjs";
import worker from "../index.js";
import { handleAdmin } from "../admin/router.js";
import { handleDemoTrafficApi } from "../admin/demo-traffic-api.js";
import { csvCell } from "../shared.js";
import { handleContactSubmit } from "../contact.js";
import {
  tokenForLinkId, verifyToken, classifyRequest, BOT_UA, BOT_ORG, handleDemoLink, handleDemoEvents, recordEnquiry, purgeOld, validateEvent, tablesReady, forgetReady,
  newLinkId, signingKey, RETENTION_DAYS, MAX_EVENTS_PER_JOURNEY,
} from "../demo-traffic.js";

const ORIGIN = "https://frameworkco.ca";
const PEPPER = "p".repeat(40);
const CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const JID = "AAAAAAAAAAAAAAAAAAAAAA"; // 22 chars
const JID2 = "BBBBBBBBBBBBBBBBBBBBBB";
const humanHeaders = (ua = CHROME) => ({ "User-Agent": ua, "Accept-Language": "en-CA,en;q=0.9" });

/** A fake D1 that records every bound parameter and every SQL text, so tests can prove what is (not) stored. */
function world({ migrated = true, env = {} } = {}) {
  const db = openPortalDb({ skip: migrated ? ["0024_leads.sql", "0025_seo_leads.sql"] : ["0021_demo_traffic.sql", "0024_leads.sql", "0025_seo_leads.sql"] });
  const bound = [];
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => { const s = prepare(sql); const bind = s.bind; s.bind = (...p) => { bound.push({ sql, p }); return bind(...p); }; return s; };
  return { db, bound, env: { PORTAL_DB: db, PORTAL_SESSION_PEPPER: PEPPER, ...env }, raw: db.raw, q: (sql, ...p) => db.raw.prepare(sql).all(...p) };
}
const ev = (j, e, { headers = humanHeaders(), cf, origin = ORIGIN, type = "application/json", raw } = {}) => {
  const r = new Request(ORIGIN + "/api/demo-events", { method: "POST", headers: { "Content-Type": type, ...(origin ? { Origin: origin } : {}), ...headers }, body: raw !== undefined ? raw : JSON.stringify({ j, e }) });
  if (cf) Object.defineProperty(r, "cf", { value: cf });
  return r;
};
const get = (path, { method = "GET", headers = humanHeaders(), cf } = {}) => {
  const r = new Request(ORIGIN + path, { method, headers });
  if (cf) Object.defineProperty(r, "cf", { value: cf });
  return r;
};
const addLink = async (w, label = "Summit Fencing") => {
  const id = newLinkId();
  w.raw.prepare("INSERT INTO demo_links (id, label, created_at, created_by) VALUES (?, ?, ?, ?)").run(id, label, "2026-11-01T00:00:00.000Z", "owner@frameworkco.ca");
  return { id, token: await tokenForLinkId(PEPPER, id) };
};

/* ---------------- tokens ---------------- */

test("tokens: 22 URL-safe characters, recoverable from the link id, verified before any lookup, tamper-proof", async () => {
  const id = newLinkId();
  assert.match(id, /^[0-9a-f]{16}$/);
  const token = await tokenForLinkId(PEPPER, id);
  assert.match(token, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(await verifyToken(PEPPER, token), id);
  assert.equal(await tokenForLinkId(PEPPER, id), token, "re-copyable: derived, not stored");
  assert.notEqual(await tokenForLinkId(PEPPER, newLinkId()), token);
  for (let i = 0; i < 22; i++) { // every single-character change is refused
    const tampered = token.slice(0, i) + (token[i] === "A" ? "B" : "A") + token.slice(i + 1);
    assert.equal(await verifyToken(PEPPER, tampered), null, "position " + i);
  }
  assert.equal(await verifyToken("q".repeat(40), token), null, "another key");
  for (const bad of [token.slice(1), token + "A", "", null, undefined, 42, {}, [token], token.slice(0, 21) + "!", token.slice(0, 21) + " "]) assert.equal(await verifyToken(PEPPER, bad), null, String(bad));
  assert.equal(await verifyToken(null, token), null, "no key");
  await assert.rejects(() => tokenForLinkId(PEPPER, "xyz"));
  assert.equal(signingKey({ DEMO_LINK_SECRET: "s".repeat(20), PORTAL_SESSION_PEPPER: PEPPER }), "s".repeat(20));
  assert.equal(signingKey({ DEMO_LINK_SECRET: "short", PORTAL_SESSION_PEPPER: PEPPER }), PEPPER);
  assert.equal(signingKey({}), null);
});

test("a junk token never touches the database", async () => {
  const w = world();
  let touched = 0;
  const env = { ...w.env, PORTAL_DB: new Proxy(w.db, { get: (t, k) => { touched++; return t[k]; } }) };
  for (const t of ["x", "A".repeat(22), "A".repeat(23), "%00%00"]) {
    const r = await handleDemoLink(get("/d/" + t), env);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("Location"), ORIGIN + "/demos/");
  }
  assert.equal(touched, 0);
});

/* ---------------- /d/<token> ---------------- */

test("a valid link creates a journey and redirects to /demos/#j=<journey> with private headers; the fragment is the only place the id travels", async () => {
  const w = world(); const { id, token } = await addLink(w);
  const r = await worker.fetch(get(`/d/${token}`, { cf: { country: "CA" } }), w.env, {});
  assert.equal(r.status, 302);
  const loc = new URL(r.headers.get("Location"));
  assert.equal(loc.origin + loc.pathname, ORIGIN + "/demos/");
  assert.equal(loc.search, "");
  assert.match(loc.hash, /^#j=[A-Za-z0-9_-]{22}$/);
  assert.equal(r.headers.get("Cache-Control"), "no-store");
  assert.equal(r.headers.get("Referrer-Policy"), "no-referrer");
  assert.equal(r.headers.get("X-Robots-Tag"), "noindex, nofollow");
  const j = w.q("SELECT * FROM demo_journeys");
  assert.equal(j.length, 1);
  assert.deepEqual([j[0].id, j[0].link_id, j[0].source, j[0].country, j[0].device, j[0].bot], [loc.hash.slice(3), id, "link", "CA", "desktop", 0]);
  const e = w.q("SELECT type, value, bot FROM demo_events");
  assert.deepEqual(e.map((x) => ({ ...x })), [{ type: "link_open", value: null, bot: 0 }]);
  assert.equal((await worker.fetch(get(`/d/${token}/`), w.env, {})).status, 302, "trailing slash tolerated");
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 2);
});

test("junk, revoked and table-less links redirect identically to plain /demos/ and reveal nothing", async () => {
  const w = world(); const { id, token } = await addLink(w);
  w.raw.prepare("UPDATE demo_links SET revoked_at = ? WHERE id = ?").run("2026-11-02T00:00:00.000Z", id);
  const plain = [await worker.fetch(get("/d/" + "z".repeat(22)), w.env, {}), await worker.fetch(get("/d/" + token), w.env, {}), await worker.fetch(get("/d/short"), w.env, {})];
  for (const r of plain) { assert.equal(r.status, 302); assert.equal(r.headers.get("Location"), ORIGIN + "/demos/"); assert.equal(r.headers.get("Cache-Control"), "no-store"); assert.equal(r.headers.get("Referrer-Policy"), "no-referrer"); }
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 0);
  const none = world({ migrated: false });
  const r = await handleDemoLink(get("/d/" + token), none.env);
  assert.equal(r.status, 302); assert.equal(r.headers.get("Location"), ORIGIN + "/demos/");
  const noKey = await handleDemoLink(get("/d/" + token), { PORTAL_DB: w.db });
  assert.equal(noKey.headers.get("Location"), ORIGIN + "/demos/");
  assert.equal((await handleDemoLink(get("/d/" + token), {})).status, 302, "no database at all");
});

test("HEAD and non-GET: no journey, no event; scanners and bots are flagged on GET", async () => {
  const w = world(); const { token } = await addLink(w);
  const head = await handleDemoLink(get(`/d/${token}`, { method: "HEAD" }), w.env);
  assert.equal(head.status, 302); assert.equal(head.headers.get("Location"), ORIGIN + "/demos/");
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 0);
  assert.equal((await handleDemoLink(get(`/d/${token}`, { method: "POST" }), w.env)).status, 405);
  for (const ua of ["Mozilla/5.0 (compatible; Googlebot/2.1)", "Slackbot-LinkExpanding 1.0", "curl/8.4", "Mozilla/5.0 Microsoft Office/16.0 (Windows NT 10.0)", "python-requests/2.31", ""]) {
    await handleDemoLink(get(`/d/${token}`, { headers: { "User-Agent": ua, "Accept-Language": "en" } }), w.env);
  }
  const rows = w.q("SELECT bot, bot_reason FROM demo_journeys");
  assert.equal(rows.length, 6);
  assert.ok(rows.every((r) => r.bot === 1 && r.bot_reason));
  assert.ok(w.q("SELECT bot FROM demo_events").every((r) => r.bot === 1));
});

/* ---------------- classification ---------------- */

test("classifyRequest: HEAD, missing UA, crawler UA, mail-security/data-centre networks, device class; the weak no-Accept-Language signal", () => {
  const c = (headers, o = {}) => classifyRequest(Object.assign(new Request(ORIGIN + "/d/x", { method: o.method || "GET", headers }), o.cf ? { cf: o.cf } : {}));
  assert.deepEqual(c(humanHeaders()), { bot: false, reason: null, device: "desktop", country: null });
  assert.equal(c(humanHeaders(IPHONE)).device, "mobile");
  assert.equal(c(humanHeaders("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit Safari")).device, "tablet");
  assert.equal(c(humanHeaders("Mozilla/5.0 (Linux; Android 14; Pixel Tablet) Chrome/126 Safari")).device, "tablet");
  assert.equal(c(humanHeaders("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/126 Mobile Safari")).device, "mobile");
  assert.equal(c(humanHeaders("SomethingElse/1")).device, "other");
  assert.equal(c(humanHeaders(), { method: "HEAD" }).reason, "head");
  assert.equal(c({ "Accept-Language": "en" }).reason, "no_user_agent");
  assert.equal(c(humanHeaders("Mozilla/5.0 HeadlessChrome/126")).reason, "user_agent");
  assert.equal(c(humanHeaders(), { cf: { asOrganization: "Proofpoint, Inc." } }).reason, "network");
  assert.equal(c(humanHeaders(), { cf: { asOrganization: "Amazon.com, Inc." } }).bot, true);
  assert.equal(c(humanHeaders(), { cf: { asOrganization: "Bell Canada" } }).bot, false);
  assert.equal(c({ "User-Agent": CHROME }).reason, "no_accept_language");
  // A beacon from the page's own JavaScript (POST) is not judged by network or Accept-Language: that is the human signal, and Private Relay or a VPN would otherwise be hidden.
  assert.equal(c(humanHeaders(), { method: "POST", cf: { asOrganization: "Cloudflare, Inc." } }).bot, false);
  assert.equal(c({ "User-Agent": CHROME }, { method: "POST" }).bot, false);
  assert.equal(c(humanHeaders(), { method: "POST" }).device, "desktop");
  assert.equal(c(humanHeaders(), { cf: { country: "ca" } }).country, "CA");
  assert.equal(c(humanHeaders(), { cf: { country: "Canada<script>" } }).country, null);
  assert.ok(BOT_UA instanceof RegExp && BOT_ORG instanceof RegExp);
  for (const ua of ["facebookexternalhit/1.1", "Twitterbot/1.0", "WhatsApp/2.23", "TelegramBot", "LinkedInBot/1.0", "SkypeUriPreview", "Mozilla/5.0 (compatible; bingbot/2.0)", "Mozilla/5.0 (compatible; AhrefsBot/7.0)", "Go-http-client/2.0", "okhttp/4.9", "axios/1.6", "node-fetch/1.0", "Java/17", "GoogleImageProxy", "Mimecast", "Barracuda", "Zscaler", "DuckDuckBot", "Lighthouse", "UptimeRobot/2.0", "MJ12bot", "YandexBot", "Baiduspider", "PetalBot", "Mozilla/5.0 (Windows NT 10.0) Safelinks"]) assert.ok(BOT_UA.test(ua), ua);
  for (const ua of [CHROME, IPHONE, "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0"]) assert.ok(!BOT_UA.test(ua), ua);
});

/* ---------------- /api/demo-events ---------------- */

test("event validation: each type, bad values, and the server-only types", () => {
  const ok = (e) => validateEvent(e);
  assert.deepEqual(ok({ t: "view" }), { type: "view", value: null });
  assert.deepEqual(ok({ t: "active" }), { type: "active", value: null });
  assert.equal(ok({ t: "view", v: "x" }), null);
  for (const d of ["general-contractor", "fence-deck", "renovations", "landscaping"]) assert.equal(ok({ t: "discipline", v: d }).value, d);
  assert.equal(ok({ t: "discipline", v: "plumbing" }), null);
  for (const d of ["rugged", "modern", "minimal", "friendly"]) assert.equal(ok({ t: "vibe", v: d }).value, d);
  assert.equal(ok({ t: "vibe", v: "Rugged" }), null);
  assert.equal(ok({ t: "colour", v: "#a1b2c3" }).value, "#A1B2C3");
  for (const v of ["a1b2c3", "#a1b2c", "#a1b2c3d", "#ggg000", "red", 5, null]) assert.equal(ok({ t: "colour", v }), null, String(v));
  assert.equal(ok({ t: "company", v: "  Summit \u0000 Fencing\n\tLtd  " }).value, "Summit Fencing Ltd");
  assert.equal(ok({ t: "company", v: "<b>Acme</b>" }).value, "<b>Acme</b>", "stored as plain text (escaped by the reader)");
  assert.equal(ok({ t: "company", v: "‮evil" }).value, "evil", "bidi override stripped");
  assert.equal(ok({ t: "company", v: "   " }), null);
  assert.equal(ok({ t: "company", v: "x".repeat(61) }), null);
  assert.equal(ok({ t: "company", v: "x".repeat(60) }).value.length, 60);
  assert.equal(ok({ t: "company", v: 5 }), null);
  assert.deepEqual(ok({ t: "open" }), { type: "open", value: null });
  assert.equal(ok({ t: "open", v: "card" }).value, "card");
  assert.equal(ok({ t: "open", v: "preview" }).value, "preview");
  assert.equal(ok({ t: "open", v: "other" }), null);
  for (const t of ["enquiry", "link_open", "bogus", 5, undefined]) assert.equal(ok({ t, v: null }), null, String(t));
  for (const bad of [null, undefined, "x", 5, [], { v: "a" }]) assert.equal(ok(bad), null);
});

test("ingestion: 204 always for valid-shaped requests; creates a direct journey; link_id can never be forged; summary columns follow the events", async () => {
  const w = world(); const { id: linkId } = await addLink(w);
  const body = { j: JID, link_id: linkId, e: [{ t: "view" }, { t: "discipline", v: "fence-deck" }, { t: "vibe", v: "rugged" }, { t: "colour", v: "#c0ffee" }, { t: "company", v: "Summit Fencing" }, { t: "open", v: "card" }, { t: "open", v: "preview" }, { t: "enquiry" }, { t: "link_open" }, { t: "discipline", v: "bad" }] };
  const r = await worker.fetch(ev(JID, [], { raw: JSON.stringify(body) }), w.env, {});
  assert.equal(r.status, 204);
  const j = w.q("SELECT * FROM demo_journeys")[0];
  assert.equal(j.link_id, null); assert.equal(j.source, "direct");
  assert.deepEqual([j.discipline, j.vibe, j.colour, j.company, j.demo_opens, j.human, j.bot, j.enquired], ["fence-deck", "rugged", "#C0FFEE", "Summit Fencing", 2, 1, 0, 0]);
  assert.deepEqual(w.q("SELECT type FROM demo_events ORDER BY id").map((x) => x.type), ["view", "discipline", "vibe", "colour", "company", "open", "open"], "server-only and invalid events were dropped");
  await worker.fetch(ev(JID, [{ t: "discipline", v: "landscaping" }, { t: "vibe", v: "modern" }]), w.env, {});
  const j2 = w.q("SELECT discipline, vibe, colour, company FROM demo_journeys")[0];
  assert.deepEqual({ ...j2 }, { discipline: "landscaping", vibe: "modern", colour: "#C0FFEE", company: "Summit Fencing" }, "latest wins; untouched fields stay");
  // a link journey keeps its link; a later client request cannot change it
  const lj = bodyJourney(w, linkId);
  await worker.fetch(ev(lj, [{ t: "active" }]), w.env, {});
  assert.equal(w.q("SELECT link_id FROM demo_journeys WHERE id = ?", lj)[0].link_id, linkId);
  assert.equal((await worker.fetch(ev("not-a-journey", [{ t: "active" }]), w.env, {})).status, 204);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 2);
});
function bodyJourney(w, linkId) {
  const id = "CCCCCCCCCCCCCCCCCCCCCC";
  w.raw.prepare("INSERT INTO demo_journeys (id, link_id, source, first_seen_at, last_seen_at) VALUES (?, ?, 'link', ?, ?)").run(id, linkId, "2026-11-01T00:00:00.000Z", "2026-11-01T00:00:00.000Z");
  return id;
}

test("human flag: view alone is not human; an interaction from a non-bot request is; a bot never makes a journey human", async () => {
  const w = world();
  await handleDemoEvents(ev(JID, [{ t: "view" }]), w.env);
  assert.equal(w.q("SELECT human FROM demo_journeys")[0].human, 0);
  await handleDemoEvents(ev(JID, [{ t: "active" }]), w.env);
  assert.equal(w.q("SELECT human FROM demo_journeys")[0].human, 1);
  await handleDemoEvents(ev(JID2, [{ t: "view" }, { t: "active" }, { t: "colour", v: "#000000" }], { headers: { "User-Agent": "HeadlessChrome/126", "Accept-Language": "en" } }), w.env);
  const b = w.q("SELECT human, bot, bot_reason FROM demo_journeys WHERE id = ?", JID2)[0];
  assert.deepEqual({ ...b }, { human: 0, bot: 1, bot_reason: "user_agent" });
  assert.ok(w.q("SELECT bot FROM demo_events WHERE journey_id = ?", JID2).every((e) => e.bot === 1));
  // a strong bot flag is sticky even when a browser-looking request follows; a weak one is cleared by a human interaction
  await handleDemoEvents(ev(JID2, [{ t: "active" }]), w.env);
  assert.deepEqual({ ...w.q("SELECT human, bot FROM demo_journeys WHERE id = ?", JID2)[0] }, { human: 0, bot: 1 });
  const { token } = await addLink(w);
  await handleDemoLink(get(`/d/${token}`, { headers: { "User-Agent": CHROME } }), w.env); // no Accept-Language: weak
  const lj = w.q("SELECT id, bot, bot_reason FROM demo_journeys WHERE link_id IS NOT NULL")[0];
  assert.deepEqual([lj.bot, lj.bot_reason], [1, "no_accept_language"]);
  await handleDemoEvents(ev(lj.id, [{ t: "view" }]), w.env);
  assert.equal(w.q("SELECT bot FROM demo_journeys WHERE id = ?", lj.id)[0].bot, 1, "a view does not clear it");
  await handleDemoEvents(ev(lj.id, [{ t: "active" }]), w.env);
  assert.deepEqual({ ...w.q("SELECT human, bot, bot_reason FROM demo_journeys WHERE id = ?", lj.id)[0] }, { human: 1, bot: 0, bot_reason: null });
});

test("request rules: size, JSON, content type, origin, method, rate limit; malformed bodies are dropped with 204", async () => {
  const w = world();
  assert.equal((await handleDemoEvents(ev(JID, [], { raw: "{nope" }), w.env)).status, 400);
  assert.equal((await handleDemoEvents(ev(JID, [], { type: "text/plain" }), w.env)).status, 415);
  assert.equal((await handleDemoEvents(ev(JID, [], { origin: "https://evil.example" }), w.env)).status, 403);
  assert.equal((await handleDemoEvents(ev(JID, [], { raw: JSON.stringify({ j: JID, e: [{ t: "company", v: "x".repeat(5000) }] }) }), w.env)).status, 413);
  assert.equal((await handleDemoEvents(get("/api/demo-events"), w.env)).status, 405);
  for (const raw of ["[]", "null", "5", JSON.stringify({ j: 5, e: [] }), JSON.stringify({ j: "short", e: [{ t: "view" }] }), JSON.stringify({ j: JID, e: "x" }), JSON.stringify({ j: JID })]) assert.equal((await handleDemoEvents(ev(JID, [], { raw }), w.env)).status, 204, raw);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 0);
  // at most 12 events per request
  await handleDemoEvents(ev(JID, Array.from({ length: 20 }, () => ({ t: "view" }))), w.env);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_events")[0].n, 12);
  // rate limit, keyed per network; fails open
  const keys = [];
  const limited = { ...w.env, PORTAL_RATE_LIMITER: { limit: async ({ key }) => { keys.push(key); return { success: false }; } } };
  const r = await handleDemoEvents(ev(JID2, [{ t: "view" }], { headers: { ...humanHeaders(), "CF-Connecting-IP": "203.0.113.9" } }), limited);
  assert.equal(r.status, 429); assert.deepEqual(keys, ["demo:203.0.113.9"]);
  const broken = { ...w.env, PORTAL_RATE_LIMITER: { limit: async () => { throw new Error("down"); } } };
  assert.equal((await handleDemoEvents(ev(JID2, [{ t: "view" }], { headers: { ...humanHeaders(), "CF-Connecting-IP": "203.0.113.9" } }), broken)).status, 204);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_events WHERE journey_id = ?", JID2)[0].n, 1);
});

test("a journey stores at most 300 events", async () => {
  const w = world();
  for (let i = 0; i < 30; i++) await handleDemoEvents(ev(JID, Array.from({ length: 12 }, () => ({ t: "view" }))), w.env);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_events")[0].n, MAX_EVENTS_PER_JOURNEY);
});

test("graceful without the tables: events are dropped with 204, nothing throws, and the cache notices the migration", async () => {
  const w = world({ migrated: false });
  assert.equal((await worker.fetch(ev(JID, [{ t: "active" }]), w.env, {})).status, 204);
  assert.equal(await tablesReady(w.db), false);
  assert.equal(await recordEnquiry(w.env, JID), false);
  assert.equal((await handleDemoEvents(ev(JID, [{ t: "active" }]), {})).status, 204, "no database binding");
  const broken = { PORTAL_DB: { prepare: () => { throw new Error("boom"); }, batch: async () => { throw new Error("boom"); } } };
  assert.equal((await handleDemoEvents(ev(JID, [{ t: "active" }]), broken)).status, 204);
  assert.equal(await tablesReady(broken.PORTAL_DB), false);
  const later = world();
  assert.equal(await tablesReady(later.db), true);
  forgetReady(later.db);
});

test("retention: purge removes journeys not seen for 180 days with their events, and keeps recent ones", async () => {
  const w = world(); const now = new Date("2026-11-06T00:00:00.000Z");
  const old = new Date(now.getTime() - (RETENTION_DAYS + 1) * 86400000).toISOString(), fresh = new Date(now.getTime() - 5 * 86400000).toISOString();
  w.raw.prepare("INSERT INTO demo_journeys (id, source, first_seen_at, last_seen_at) VALUES (?, 'direct', ?, ?), (?, 'direct', ?, ?)").run(JID, old, old, JID2, old, fresh);
  w.raw.prepare("INSERT INTO demo_events (journey_id, at, type) VALUES (?, ?, 'view'), (?, ?, 'view'), (?, ?, 'view')").run(JID, old, JID2, old, JID2, fresh);
  assert.equal(await purgeOld(w.db, now), 1);
  assert.deepEqual(w.q("SELECT id FROM demo_journeys").map((r) => r.id), [JID2]);
  assert.deepEqual(w.q("SELECT at FROM demo_events").map((r) => r.at), [fresh], "old events go, even of a journey that is still active");
  // about 1 in 50 ingestions runs it, via waitUntil
  const waited = [];
  await handleDemoEvents(ev(JID, [{ t: "view" }]), w.env, { random: () => 0, waitUntil: (p) => waited.push(p), now: () => now });
  await handleDemoEvents(ev(JID, [{ t: "view" }]), w.env, { random: () => 0.9, waitUntil: (p) => waited.push(p), now: () => now });
  assert.equal(waited.length, 1); await waited[0];
});

/* ---------------- enquiries ---------------- */

test("recordEnquiry marks the journey, creates a direct one when unknown, stores nothing from the form, and never throws", async () => {
  const w = world();
  assert.equal(await recordEnquiry(w.env, JID, new Date("2026-11-06T10:00:00.000Z")), true);
  const j = w.q("SELECT * FROM demo_journeys")[0];
  assert.deepEqual([j.source, j.link_id, j.enquired, j.human, j.bot, j.last_seen_at], ["direct", null, 1, 1, 0, "2026-11-06T10:00:00.000Z"]);
  assert.deepEqual(w.q("SELECT type, value FROM demo_events").map((e) => ({ ...e })), [{ type: "enquiry", value: null }]);
  assert.equal(await recordEnquiry(w.env, "bad"), false);
  assert.equal(await recordEnquiry({ PORTAL_DB: { prepare: () => { throw new Error("x"); } } }, JID), false);
  // an existing bot-flagged journey becomes human: an accepted enquiry is the strongest signal
  await handleDemoEvents(ev(JID2, [{ t: "view" }], { headers: { "User-Agent": "curl/8" } }), w.env);
  await recordEnquiry(w.env, JID2);
  assert.deepEqual({ ...w.q("SELECT human, bot, enquired FROM demo_journeys WHERE id = ?", JID2)[0] }, { human: 1, bot: 0, enquired: 1 });
});

test("/api/contact: the response is unchanged with or without a journey, a failing recorder, and nothing from the form is stored", async () => {
  const w = world();
  const ENV = { ...w.env, RESEND_API_KEY: "re_test", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "hello@frameworkco.ca" };
  const good = (over = {}) => ({ name: "Alex Rivera", email: "alex@summit.ca", business: "Summit Fencing", project_type: "Website Only", message: "SECRET-MESSAGE-TEXT", elapsed_ms: 8000, ...over });
  const post = (b) => new Request(ORIGIN + "/api/contact", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify(b) });
  const fetchOk = async () => new Response("{}", { status: 200 });
  const plain = await handleContactSubmit(post(good()), ENV, { fetch: fetchOk });
  const withJ = await handleContactSubmit(post(good({ journey: JID })), ENV, { fetch: fetchOk });
  assert.equal(plain.status, 200); assert.equal(withJ.status, 200);
  assert.deepEqual(await plain.json(), await withJ.json());
  assert.equal(w.q("SELECT enquired FROM demo_journeys WHERE id = ?", JID)[0].enquired, 1);
  assert.equal((await handleContactSubmit(post(good({ journey: "not valid!!" })), ENV, { fetch: fetchOk })).status, 200);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 1, "an invalid id is ignored");
  const dump = JSON.stringify(w.q("SELECT * FROM demo_journeys")) + JSON.stringify(w.q("SELECT * FROM demo_events")) + JSON.stringify(w.bound);
  for (const secret of ["SECRET-MESSAGE-TEXT", "alex@summit.ca", "Alex Rivera", "Summit Fencing"]) assert.ok(!dump.includes(secret), secret + " is not stored");
  const throwing = { ...ENV, PORTAL_DB: { prepare: () => { throw new Error("db down"); } } };
  const r = await handleContactSubmit(post(good({ journey: JID })), throwing, { fetch: fetchOk });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  const failed = await handleContactSubmit(post(good({ journey: JID2 })), ENV, { fetch: async () => new Response("{}", { status: 500 }) });
  assert.equal(failed.status, 502);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys WHERE id = ?", JID2)[0].n, 0, "nothing is recorded when the email was not accepted");
});

/* ---------------- privacy: nothing identifying is stored ---------------- */

test("no IP address and no user-agent string is ever bound into a statement or stored", async () => {
  const w = world(); const { token } = await addLink(w);
  const ip = "203.0.113.77", ua = "Mozilla/5.0 UNIQUE-UA-MARKER-9981 (X11; Linux x86_64) Chrome/126 Safari/537.36";
  const h = { "User-Agent": ua, "Accept-Language": "en", "CF-Connecting-IP": ip, Referer: "https://mail.example/inbox/secret-thread" };
  await handleDemoLink(get(`/d/${token}`, { headers: h, cf: { country: "CA", asOrganization: "Bell Canada" } }), w.env);
  await handleDemoEvents(ev(JID, [{ t: "active" }, { t: "company", v: "Acme" }], { headers: h, cf: { country: "CA" } }), { ...w.env, PORTAL_RATE_LIMITER: { limit: async () => ({ success: true }) } });
  await recordEnquiry(w.env, JID);
  const everything = JSON.stringify(w.bound) + JSON.stringify(w.q("SELECT * FROM demo_journeys")) + JSON.stringify(w.q("SELECT * FROM demo_events"));
  for (const s of [ip, "UNIQUE-UA-MARKER", "Chrome", "secret-thread", "mail.example", "Bell Canada"]) assert.ok(!everything.includes(s), s + " is not stored");
  const src = readFileSync(new URL("../demo-traffic.js", import.meta.url), "utf8");
  assert.ok(!/bind\([^)]*\bua\b/.test(src), "the user agent is never bound");
});

/* ---------------- Admin API ---------------- */

const admin = (path, { method = "GET", body, origin = ORIGIN, write = true } = {}) =>
  new Request(ORIGIN + "/api/admin" + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(write ? { "X-Framework-Admin": "1" } : {}), "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const P = { email: "owner@frameworkco.ca" };
const call = (w, path, o) => handleDemoTrafficApi(admin(path, o), w.env, P, path.split("?")[0], {});
const seed = async (w) => {
  const a = await addLink(w, "Summit Fencing"), b = await addLink(w, "=HYPERLINK(\"http://evil\")");
  const rec = async (token, ua, acceptLang = true) => handleDemoLink(get("/d/" + token, { headers: acceptLang ? humanHeaders(ua) : { "User-Agent": ua }, cf: { country: "CA" } }), w.env);
  await rec(a.token, CHROME); await rec(a.token, IPHONE); await rec(b.token, CHROME); await rec(a.token, "Slackbot-LinkExpanding 1.0");
  const js = w.q("SELECT id, link_id, bot FROM demo_journeys ORDER BY rowid");
  const jA = js[0].id;
  await handleDemoEvents(ev(jA, [{ t: "active" }, { t: "discipline", v: "fence-deck" }, { t: "vibe", v: "rugged" }, { t: "colour", v: "#112233" }, { t: "company", v: "+SUM(1)" }, { t: "open", v: "card" }]), w.env);
  await recordEnquiry(w.env, jA);
  await handleDemoEvents(ev(JID, [{ t: "active" }, { t: "discipline", v: "landscaping" }]), w.env);
  return { a, b, jA, journeys: js };
};

test("admin API: status, summary, links (with re-copyable urls), journeys and timeline", async () => {
  const w = world(); const s = await seed(w);
  const st = await (await call(w, "/demo-traffic/status")).json();
  assert.deepEqual(st, { ready: true, secret: true, retention_days: 180, migration: "0021_demo_traffic.sql" });
  const sum = await (await call(w, "/demo-traffic/summary?days=7&bots=0")).json();
  assert.equal(sum.link_opens, 4); assert.equal(sum.likely_bots, 1);
  assert.equal(sum.journeys, 4); // 3 link journeys (bot hidden) + 1 direct
  assert.equal(sum.verified, 2); assert.equal(sum.companies_applied, 1); assert.equal(sum.demo_opens, 1); assert.equal(sum.enquiries, 1);
  assert.deepEqual(sum.discipline.map((d) => d.label).sort(), ["fence-deck", "landscaping"]);
  assert.deepEqual(sum.colour, [{ label: "#112233", count: 1 }]);
  const withBots = await (await call(w, "/demo-traffic/summary?days=30&bots=1")).json();
  assert.equal(withBots.journeys, 5);
  const links = (await (await call(w, "/demo-traffic/links")).json()).links;
  const a = links.find((l) => l.id === s.a.id);
  assert.equal(a.url, `${ORIGIN}/d/${s.a.token}`);
  assert.deepEqual([a.link_opens, a.link_opens_bots, a.verified_visits, a.enquiries], [2, 1, 1, 1]);
  assert.ok(a.last_activity);
  const list = (await (await call(w, "/demo-traffic/journeys?days=30&link=" + s.a.id)).json()).journeys;
  assert.equal(list.length, 2, "bots hidden by default");
  assert.equal(list[0].link_label, "Summit Fencing");
  assert.equal((await (await call(w, `/demo-traffic/journeys?link=${s.a.id}&bots=1`)).json()).journeys.length, 3);
  assert.equal((await (await call(w, "/demo-traffic/journeys?link=direct")).json()).journeys.length, 1);
  assert.equal((await (await call(w, "/demo-traffic/journeys?limit=1")).json()).journeys.length, 1);
  const one = await (await call(w, "/demo-traffic/journeys/" + s.jA)).json();
  assert.equal(one.journey.company, "+SUM(1)"); assert.equal(one.journey.human, true); assert.equal(one.journey.enquired, true);
  assert.deepEqual(one.events.map((e) => e.type), ["link_open", "active", "discipline", "vibe", "colour", "company", "open", "enquiry"]);
  assert.deepEqual(Object.keys(one.events[0]).sort(), ["at", "bot", "type", "value"]);
  assert.equal((await call(w, "/demo-traffic/journeys/" + "Z".repeat(22))).status, 404);
  assert.equal((await call(w, "/demo-traffic/journeys/short")).status, 404);
  for (const bad of ["days=0", "days=999", "days=x", "bots=2", "link=zzz", "limit=0"]) assert.equal((await call(w, "/demo-traffic/journeys?" + bad)).status, 422, bad);
  assert.equal((await call(w, "/demo-traffic/nope")).status, 404);
  assert.equal((await handleDemoTrafficApi(admin("/clients"), w.env, P, "/clients", {})), null, "other paths are not ours");
  const r = await call(w, "/demo-traffic/summary"); assert.equal(r.headers.get("Cache-Control"), "no-store");
});

test("admin API: create, revoke and delete links (writes need same-origin and the admin header; delete needs confirm)", async () => {
  const w = world();
  const made = await call(w, "/demo-traffic/links", { method: "POST", body: { label: "  Acme \n Fencing  ", note: "met at expo" } });
  assert.equal(made.status, 201);
  const { link } = await made.json();
  assert.equal(link.label, "Acme Fencing"); assert.match(link.id, /^[0-9a-f]{16}$/);
  assert.match(link.url, new RegExp(`^${ORIGIN}/d/[A-Za-z0-9_-]{22}$`));
  assert.ok(!link.url.includes("Acme") && !link.url.includes("@"), "label and email never appear in the URL");
  assert.equal(await verifyToken(PEPPER, link.url.split("/d/")[1]), link.id);
  for (const body of [{}, { label: "" }, { label: "   " }, { label: 5 }, null]) assert.equal((await call(w, "/demo-traffic/links", { method: "POST", body })).status, 422);
  assert.equal((await call(w, "/demo-traffic/links", { method: "POST", body: { label: "x".repeat(300) } })).status, 201, "long labels are trimmed to 120");
  assert.equal(w.q("SELECT max(length(label)) AS n FROM demo_links")[0].n, 120);
  assert.equal((await call(w, "/demo-traffic/links", { method: "POST", body: { label: "x" }, origin: "https://evil.example" })).status, 403);
  assert.equal((await call(w, "/demo-traffic/links", { method: "POST", body: { label: "x" }, write: false })).status, 403);
  assert.equal((await handleDemoTrafficApi(admin("/demo-traffic/links", { method: "POST", body: { label: "x" } }), { PORTAL_DB: w.db }, P, "/demo-traffic/links", {})).status, 409, "no signing key");
  // visits, then revoke: the link stops creating journeys, and history stays
  await handleDemoLink(get("/d/" + link.url.split("/d/")[1]), w.env);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 1);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}/revoke`, { method: "POST", body: {} })).status, 200);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}/revoke`, { method: "POST", body: {} })).status, 200, "idempotent");
  assert.equal((await call(w, `/demo-traffic/links/${"0".repeat(16)}/revoke`, { method: "POST", body: {} })).status, 404);
  await handleDemoLink(get("/d/" + link.url.split("/d/")[1]), w.env);
  assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 1);
  assert.ok(w.q("SELECT revoked_at FROM demo_links WHERE id = ?", link.id)[0].revoked_at);
  // delete: confirm required; removes the link, its journeys and their events, and nothing else
  await handleDemoEvents(ev(JID, [{ t: "view" }]), w.env);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}`, { method: "DELETE", body: {} })).status, 422);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}`, { method: "DELETE", body: { confirm: "yes" } })).status, 422);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}`, { method: "DELETE", body: { confirm: true }, origin: null })).status, 403);
  const del = await call(w, `/demo-traffic/links/${link.id}`, { method: "DELETE", body: { confirm: true } });
  assert.equal(del.status, 200); assert.deepEqual((await del.json()).deleted, { journeys: 1, events: 1 });
  assert.equal(w.q("SELECT count(*) AS n FROM demo_links WHERE id = ?", link.id)[0].n, 0);
  assert.deepEqual(w.q("SELECT id FROM demo_journeys").map((r) => r.id), [JID], "the direct journey is untouched");
  assert.equal(w.q("SELECT count(*) AS n FROM demo_events")[0].n, 1);
  assert.equal((await call(w, `/demo-traffic/links/${link.id}`, { method: "DELETE", body: { confirm: true } })).status, 404);
});

test("admin API: CSV export has a BOM, one row per event, neutralised formulas and the documented columns", async () => {
  const w = world(); const s = await seed(w);
  const res = await call(w, "/demo-traffic/export.csv?days=30&bots=0");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Disposition"), /^attachment; filename="framework-demo-traffic-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(res.headers.get("Cache-Control"), "no-store");
  assert.match(res.headers.get("Content-Type"), /^text\/csv/);
  const bytes = new Uint8Array(await res.clone().arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xEF, 0xBB, 0xBF], "UTF-8 BOM");
  const text = "\uFEFF" + (await res.text());
  const lines = text.slice(1).trim().split("\r\n");
  assert.equal(lines[0], "timestamp_utc,journey_id,source,prospect_label,verified_human,likely_bot,bot_reason,country,device,event,value,discipline,vibe,colour,company");
  assert.equal(lines.length - 1, w.q("SELECT count(*) AS n FROM demo_events e JOIN demo_journeys j ON j.id = e.journey_id WHERE e.bot = 0 AND j.bot = 0")[0].n);
  assert.ok(lines.some((l) => l.includes("'=HYPERLINK")), "a label starting with = is neutralised");
  assert.ok(lines.some((l) => l.endsWith(",'+SUM(1)")), "a company starting with + is neutralised");
  assert.ok(!lines.some((l) => /(^|,)[=+\-@]/.test(l.replace(/"[^"]*"/g, ""))), "no cell starts with a formula character");
  assert.ok(lines.some((l) => l.includes(s.jA) && l.includes(",yes,no,")), "verified human, not a bot");
  const withBots = (await (await call(w, "/demo-traffic/export.csv?bots=1")).text()).trim().split("\r\n");
  assert.ok(withBots.length > lines.length);
  assert.ok(withBots.some((l) => l.includes(",no,yes,user_agent,")));
  assert.equal((await call(w, "/demo-traffic/export.csv?days=x")).status, 422);
  // csvCell itself: every dangerous first character is neutralised
  for (const v of ["=1+1", "+1", "-1", "@x", "\tx", "\rx"]) assert.ok(csvCell(v).startsWith("'") || csvCell(v).startsWith("\"'"), JSON.stringify(v));
});

test("admin API: 'not set up' before the migration, and a missing database", async () => {
  const w = world({ migrated: false });
  const st = await (await call(w, "/demo-traffic/status")).json();
  assert.deepEqual([st.ready, st.secret, st.retention_days], [false, true, 180]);
  for (const p of ["/demo-traffic/summary", "/demo-traffic/links", "/demo-traffic/journeys", "/demo-traffic/export.csv"]) {
    const r = await call(w, p); assert.equal(r.status, 409, p); assert.equal((await r.json()).migration, "0021_demo_traffic.sql");
  }
  assert.equal((await call(world({ env: { PORTAL_SESSION_PEPPER: "" } }), "/demo-traffic/status").then((r) => r.json())).secret, false);
  const none = await handleDemoTrafficApi(admin("/demo-traffic/status"), {}, P, "/demo-traffic/status", {});
  assert.equal((await none.json()).ready, false);
  assert.equal((await handleDemoTrafficApi(admin("/demo-traffic/links"), {}, P, "/demo-traffic/links", {})).status, 503);
});

test("every demo-traffic admin route and page is refused without a valid admin token", async () => {
  const w = world();
  const env = { ...w.env, ACCESS_TEAM_DOMAIN: "framework.cloudflareaccess.com", ACCESS_AUD: "a".repeat(64), ADMIN_EMAILS: "owner@frameworkco.ca" };
  await addLink(w, "Private Prospect Co");
  const id = "0".repeat(16);
  const routes = [["GET", "/status"], ["GET", "/summary"], ["GET", "/links"], ["POST", "/links"], ["POST", `/links/${id}/revoke`], ["DELETE", `/links/${id}`], ["GET", "/journeys"], ["GET", `/journeys/${JID}`], ["GET", "/export.csv"]];
  for (const [method, path] of routes) {
    const r = await handleAdmin(new Request(ORIGIN + "/api/admin/demo-traffic" + path, { method, headers: { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json" }, body: method === "GET" ? undefined : JSON.stringify({ label: "x", confirm: true }) }), env, {});
    assert.ok([401, 403, 503].includes(r.status), `${method} ${path} -> ${r.status}`);
    assert.ok(!/Private Prospect Co/.test(await r.text()));
  }
  const page = await handleAdmin(new Request(ORIGIN + "/admin/demo-traffic"), env, {});
  assert.ok([401, 403, 503].includes(page.status));
  assert.equal(w.q("SELECT count(*) AS n FROM demo_links")[0].n, 1, "nothing was written");
});

test("wiring: /d/* runs the Worker first, the public routes are in index.js, the admin handler is registered and the migration is proposed only", () => {
  const cfg = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
  assert.match(cfg, /"run_worker_first": \[[^\]]*"\/d\/\*"/);
  const idx = readFileSync(new URL("../index.js", import.meta.url), "utf8");
  assert.match(idx, /path\.startsWith\("\/d\/"\)/); assert.match(idx, /path === "\/api\/demo-events"/);
  assert.match(readFileSync(new URL("../admin/router.js", import.meta.url), "utf8"), /handleDemoTrafficApi/);
  const sql = readFileSync(new URL("../../migrations/portal/0021_demo_traffic.sql", import.meta.url), "utf8");
  assert.match(sql, /Not applied to Production/);
  assert.ok(!/DROP |DELETE FROM|ALTER |\bUPDATE /i.test(sql.replace(/--.*$/gm, "")), "additive only");
  assert.ok(!/ip_?address|user_?agent|\bua\b/i.test(sql.replace(/--.*$/gm, "")), "no column can hold an address or a user agent");
});

/* ---------------- Do Not Track and Global Privacy Control, enforced on the server ---------------- */

test("opt-out: a request with DNT: 1 or Sec-GPC: 1 creates no journey and no event anywhere (link, events and enquiry)", async () => {
  const { optedOut } = await import("../demo-traffic.js");
  assert.equal(optedOut(get("/", { headers: { ...humanHeaders(), DNT: "1" } })), true);
  assert.equal(optedOut(get("/", { headers: { ...humanHeaders(), "Sec-GPC": "1" } })), true);
  assert.equal(optedOut(get("/", { headers: { ...humanHeaders(), DNT: "0" } })), false);
  assert.equal(optedOut(get("/")), false);

  for (const optHeader of [{ DNT: "1" }, { "Sec-GPC": "1" }]) {
    const w = world();
    const { token } = await addLink(w);
    // the tracking link still redirects to /demos/ like any visit, but writes nothing and carries no journey id
    const r = await handleDemoLink(get("/d/" + token, { headers: { ...humanHeaders(), ...optHeader } }), w.env);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("Location"), ORIGIN + "/demos/");
    // an events request from an opted-out client is accepted and dropped
    const e = await handleDemoEvents(ev(JID, [{ t: "view" }, { t: "active" }, { t: "company", v: "Summit Fencing" }], { headers: { ...humanHeaders(), ...optHeader } }), w.env);
    assert.equal(e.status, 204);
    assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 0);
    assert.equal(w.q("SELECT count(*) AS n FROM demo_events")[0].n, 0);
    // an enquiry sent with the header does not record a journey either, and still succeeds
    const ENV = { ...w.env, RESEND_API_KEY: "re_test", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "hello@frameworkco.ca" };
    const post = new Request(ORIGIN + "/api/contact", { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN, ...optHeader }, body: JSON.stringify({ name: "A", email: "a@b.ca", message: "hi", elapsed_ms: 8000, journey: JID }) });
    assert.equal((await handleContactSubmit(post, ENV, { fetch: async () => new Response("{}", { status: 200 }) })).status, 200);
    assert.equal(w.q("SELECT count(*) AS n FROM demo_journeys")[0].n, 0);
    assert.equal(w.q("SELECT count(*) AS n FROM demo_events")[0].n, 0);
  }
});
