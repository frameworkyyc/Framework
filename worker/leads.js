/**
 * Framework — Leads workspace, server side (worker/LEADS.md). Plain JavaScript, unit-testable like demo-traffic.js.
 *
 * Candidates are found by the separate finder Worker (`framework-leadgen`); its D1 database is bound here as LEADGEN_DB and is only ever READ
 * (every statement that reaches it goes through finderSelect, which refuses anything but one SELECT). They are imported into the outreach_*
 * tables of PORTAL_DB (proposed migration 0024), reviewed by the owner in Admin, given a tracking link on approval (demo_links, migration 0021),
 * and emailed only after the owner approved the exact text. Public side: /u/<token> (unsubscribe) and POST /api/leads/webhook (delivery events).
 * The Admin API is worker/admin/leads-api.js.
 *
 * Without migration 0024 nothing here throws to a visitor: the public paths answer politely and do nothing.
 */
import { bytesToB64url, b64urlToBytes, hmacHex, timingSafeEqualStrings } from "./portal/crypto.js";
import { signingKey, tokenForLinkId, newLinkId, tablesReady } from "./demo-traffic.js";
import { sendEmail, emailConfigured, notifyRecipient, readTextLimited, oneLine } from "./assessment.js";
import { json } from "./shared.js";
import { checkSite, diagnosticLines } from "./site-check.js";

export const MIGRATION = "0024_leads.sql";
export const STATUSES = ["new", "approved", "ready", "contacted", "replied", "won", "dismissed"];
export const APPROACHES = [
  { id: "observation", label: "A specific observation about their web presence" },
  { id: "demo", label: "Short, lead with the demo" },
  { id: "reputation", label: "Lead with their reviews" },
];
export const FOLLOWUP_DAYS = 5;
export const MAX_SEND = 10;
export const IMPORT_LIMIT = 500;
export const UNSUB_LABEL = "unsub"; // distinct HMAC label: a demo-link token can never be accepted as an unsubscribe token
export const OLD_FINDER_NOTE = "Approved in the old finder dashboard";
export const PRICING = /\$\s?\d|\b(price|pricing|cost|rates?|quote|per month|monthly|discount|free)\b/i;

const MESSAGE_ID = /^[0-9a-f]{16}$/;
export const LEAD_ID = MESSAGE_ID;
const EMAIL = /^[^\s@<>",;:]+@[^\s@<>",;:]+\.[^\s@<>",;:]+$/;
const MAX_SCAN = 5000;
const WEBHOOK_TOLERANCE_S = 300;

/* ---------- Small helpers ---------- */

export const newId = newLinkId; // 16 hex characters, same shape as a demo link id
export const nowOf = (deps) => { const n = deps && deps.now; const d = typeof n === "function" ? n() : n; return d instanceof Date ? d : new Date(); };
const bytesToHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g).map((x) => parseInt(x, 16)));

const CONTROL = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
/** One line of user text: control and zero-width characters out, whitespace collapsed, capped. */
export const clean = (v, max) => (typeof v === "string" || typeof v === "number" ? String(v).replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Multi-line user text (email bodies, notes): control characters out except line breaks, trailing spaces trimmed. */
export const cleanMultiline = (v, max) => (typeof v === "string" ? v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, max) : "");

export const normaliseEmail = (v) => { const e = clean(v, 254).toLowerCase(); return e.length <= 254 && EMAIL.test(e) ? e : null; };
export const maskEmail = (e) => { const m = /^(.)[^@]*@(.+)$/.exec(String(e || "")); return m ? `${m[1]}***@${m[2]}` : null; };

const one = (db, sql, ...p) => db.prepare(sql).bind(...p).first();
const many = async (db, sql, ...p) => (await db.prepare(sql).bind(...p).all()).results || [];

/** A timeline row. The detail is a short note: anything that looks like an email address is removed, so an address can never be stored here. */
export function eventStmt(db, leadId, at, type, detail = null) {
  const d = detail == null ? null : clean(String(detail).replace(/\S+@\S+/g, "[address]"), 300) || null;
  return db.prepare("INSERT INTO outreach_events (lead_id, at, type, detail) VALUES (?, ?, ?, ?)").bind(leadId, at, type, d);
}

/* ---------- Tables present? ---------- */

const readyCache = new WeakMap();
/** One cheap query: a positive answer is kept for 5 minutes, a negative one for 30 seconds (so applying the migration needs no redeploy). */
export async function leadsReady(db, now = Date.now()) {
  if (!db || typeof db.prepare !== "function") return false;
  const hit = readyCache.get(db);
  if (hit && now - hit.at < (hit.ready ? 300000 : 30000)) return hit.ready;
  let ready = false;
  try {
    const row = await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name IN ('outreach_leads', 'outreach_contacts', 'outreach_suppressions', 'outreach_messages', 'outreach_events')").first();
    ready = !!row && Number(row.n) === 5;
  } catch {
    ready = false;
  }
  readyCache.set(db, { ready, at: now });
  return ready;
}
export const forgetLeadsReady = (db) => { if (db && typeof db === "object") readyCache.delete(db); };

/* ---------- Reason, dedupe key, contact eligibility ---------- */

// Social pages and directory listings are not "a website of their own".
const SOCIAL_DOMAINS = ["facebook.com", "fb.com", "fb.me", "instagram.com", "linkedin.com", "twitter.com", "x.com", "youtube.com", "tiktok.com", "pinterest.com", "yelp.com", "yelp.ca", "kijiji.ca", "homestars.com", "houzz.com", "yellowpages.ca", "linktr.ee", "linktree.com", "google.com", "goo.gl", "g.page", "business.site"];
const isSocialHost = (host) => SOCIAL_DOMAINS.some((d) => host === d || host.endsWith("." + d));

export function hostOf(website) {
  const raw = clean(website, 500);
  if (!raw) return null;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : "https://" + raw).hostname.toLowerCase().replace(/^www\./, "");
    return host && host.includes(".") ? host : null;
  } catch {
    return null;
  }
}
/** The business's own website host, or null when it has none (no site, only a social page, or a directory listing). */
export function realSiteHost(website, siteStatus) {
  if (siteStatus === "none" || siteStatus === "social_only") return null;
  const host = hostOf(website);
  return host && !isSocialHost(host) ? host : null;
}
const socialName = (website) => {
  const h = hostOf(website) || "";
  return /facebook|fb\./.test(h) ? "Facebook" : /instagram/.test(h) ? "Instagram" : /linkedin/.test(h) ? "LinkedIn" : /yelp/.test(h) ? "Yelp" : /houzz/.test(h) ? "Houzz" : null;
};

export function dedupeKey({ website, site_status, name, city }) {
  const host = realSiteHost(website, site_status);
  if (host) return host;
  const norm = (s) => clean(s, 200).toLowerCase();
  return `${norm(name)}|${norm(city)}`;
}

/** Up to three short phrases from the finder's issue list, e.g. "no HTTPS, not mobile-friendly". */
export function parseIssues(raw) {
  let list = raw;
  if (typeof raw === "string") { try { list = JSON.parse(raw); } catch { list = []; } }
  if (!Array.isArray(list)) return [];
  return list.filter((x) => typeof x === "string").map((x) => clean(x, 120)).filter(Boolean).slice(0, 10);
}
const lowerFirst = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

const agoPhrase = (iso, now) => {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return null;
  const days = Math.floor((now.getTime() - t) / 86400000);
  if (days < 0) return null;
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 60) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months < 24 ? `${months} months ago` : `${Math.floor(days / 365)} years ago`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The specific reason this business is a prospect, built only from the finder's data. */
export function buildReason(lead, now = new Date(), { oldFinder = false } = {}) {
  const host = hostOf(lead.website);
  const issues = parseIssues(lead.site_issues).slice(0, 3).map((i) => lowerFirst(i.replace(/[.;]+$/, "")).slice(0, 50));
  let site;
  switch (lead.site_status) {
    case "none": site = "No website"; break;
    case "social_only": { const s = socialName(lead.website); site = s ? `Only a ${s} page` : "Only a social media page"; break; }
    case "offline": site = host ? `Website doesn't load (${host})` : "Website doesn't load"; break; // only ever set by a verified check (site-check.js)
    case "broken": site = host ? `Finder reported the website as not loading (${host}); not confirmed yet` : "Finder reported the website as not loading; not confirmed yet"; break;
    case "unverified": site = host ? `Website couldn't be checked automatically (${host}); it may be protected, not offline` : "Website couldn't be checked automatically"; break;
    case "online": site = host ? `Website is online (${host})` : "Website is online"; break;
    case "outdated": site = issues.length ? `Outdated site: ${issues.join(", ")}` : "Outdated website"; break;
    default: site = "Weak web presence";
  }
  const rating = Number(lead.rating), reviews = Number(lead.review_count);
  let rep = "";
  if (Number.isFinite(rating) && rating > 0 && Number.isFinite(reviews) && reviews > 0) {
    rep = `${rating.toFixed(1)}★ from ${plural(reviews, "review")}`;
    const ago = agoPhrase(lead.last_review_at, now);
    if (ago) rep += `, latest review ${ago}`;
  }
  return `${site}${rep ? "; " + rep : ""}.${oldFinder ? ` ${OLD_FINDER_NOTE}.` : ""}`;
}

const ownSiteUrl = (sourceUrl, lead) => {
  const host = realSiteHost(lead.website, lead.site_status);
  if (!host) return false;
  try {
    const u = new URL(sourceUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const h = u.hostname.toLowerCase().replace(/^www\./, "");
    return h === host || h.endsWith("." + host);
  } catch {
    return false;
  }
};

/**
 * Whether a contact may be emailed. 'eligible' only for an address published on the business's own website (CASL conspicuous publication) that is not
 * suppressed; everything else an owner must confirm ('review'); suppressed or opted-out addresses are 'blocked'. Phone numbers are never emailed.
 * @returns { type, value, eligibility, note, source_url } or null when the value is unusable
 */
export function contactEligibility(c, lead, suppressed = new Set(), source = "finder") {
  if (c.type === "phone") {
    const value = clean(c.value, 40);
    return value ? { type: "phone", value, eligibility: "review", note: "Phone only: not emailed", source_url: null } : null;
  }
  const value = normaliseEmail(c.value);
  if (!value) return null;
  const url = clean(c.source_url, 500) || null;
  if (suppressed.has(value)) return { type: "email", value, eligibility: "blocked", note: "Unsubscribed, bounced or marked as spam: suppressed", source_url: url };
  if (source === "finder" && !lead.no_solicit && url && ownSiteUrl(url, lead)) return { type: "email", value, eligibility: "eligible", note: `Published at ${url}`.slice(0, 300), source_url: url };
  return { type: "email", value, eligibility: "review", note: (url ? "Found, but not on the business's own website: confirm before emailing" : "No source page recorded: confirm before emailing").slice(0, 300), source_url: url };
}

/* ---------- Finder (read only) ---------- */

/** The ONLY way to talk to LEADGEN_DB: one SELECT statement, nothing else. */
export async function finderSelect(finder, sql, params = []) {
  if (!/^\s*SELECT\b/i.test(sql) || /;\s*\S/.test(sql)) throw new Error("finder_read_only");
  return (await finder.prepare(sql).bind(...params).all()).results || [];
}
export const finderBound = (env) => !!env && !!env.LEADGEN_DB && typeof env.LEADGEN_DB.prepare === "function";

const CANDIDATES = "status IN ('qualified', 'approved') AND COALESCE(no_solicit, 0) = 0 AND site_status <> 'ok'";

async function scanFinder(env) {
  const db = env.PORTAL_DB, finder = env.LEADGEN_DB;
  const refs = new Set((await many(db, "SELECT source_ref FROM outreach_leads WHERE source_ref IS NOT NULL")).map((r) => r.source_ref));
  const keys = new Set((await many(db, "SELECT dedupe_key FROM outreach_leads")).map((r) => r.dedupe_key));
  const fresh = [];
  let skipped = 0, after = 0, scanned = 0;
  while (scanned < MAX_SCAN) {
    const rows = await finderSelect(finder, `SELECT id, place_id, name, trade, city, address, maps_url, website, rating, review_count, last_review_at, site_status, site_score, site_issues, no_solicit, status FROM leads WHERE id > ? AND ${CANDIDATES} ORDER BY id LIMIT 500`, [after]);
    if (!rows.length) break;
    for (const r of rows) {
      after = Math.max(after, Number(r.id));
      scanned++;
      const name = clean(r.name, 200);
      if (!name) { skipped++; continue; }
      const key = dedupeKey(r);
      if ((r.place_id && refs.has(r.place_id)) || keys.has(key)) { skipped++; continue; }
      keys.add(key);
      fresh.push({ ...r, name, key });
    }
    if (rows.length < 500) break;
  }
  return { fresh, skipped };
}

/** How many finder candidates are waiting to be imported (never throws). */
export async function finderWaiting(env) {
  if (!finderBound(env)) return { connected: false, waiting: 0 };
  try {
    if (await leadsReady(env.PORTAL_DB)) return { connected: true, waiting: (await scanFinder(env)).fresh.length };
    const row = await finderSelect(env.LEADGEN_DB, `SELECT COUNT(*) AS n FROM leads WHERE ${CANDIDATES}`);
    return { connected: true, waiting: Number(row[0] && row[0].n) || 0 };
  } catch (e) {
    console.error("leads finder status error:", e && e.message);
    return { connected: false, waiting: 0 };
  }
}

/**
 * Imports qualified finder candidates that are not in the workspace yet (at most IMPORT_LIMIT per call, oldest first). Idempotent: an existing lead is never
 * touched, re-opened or overwritten (a dismissed lead stays dismissed). Never writes to the finder.
 * @returns { imported, skipped, waiting }
 */
export async function syncFinder(env, deps = {}) {
  if (!finderBound(env)) return { imported: 0, skipped: 0, waiting: 0 };
  const db = env.PORTAL_DB, now = nowOf(deps), at = now.toISOString();
  const { fresh, skipped: dupes } = await scanFinder(env);
  const batch = fresh.slice(0, IMPORT_LIMIT);
  const contacts = new Map();
  for (let i = 0; i < batch.length; i += 50) {
    const ids = batch.slice(i, i + 50).map((r) => r.id);
    const rows = await finderSelect(env.LEADGEN_DB, `SELECT lead_id, type, value, source_url, found_at FROM contacts WHERE lead_id IN (${ids.map(() => "?").join(",")}) AND type IN ('email', 'phone') ORDER BY id`, ids);
    for (const c of rows) { if (!contacts.has(c.lead_id)) contacts.set(c.lead_id, []); contacts.get(c.lead_id).push(c); }
  }
  const suppressed = new Set((await many(db, "SELECT email FROM outreach_suppressions")).map((r) => r.email));
  let imported = 0, skipped = dupes;
  for (const r of batch) {
    const id = newId();
    const issues = JSON.stringify(parseIssues(r.site_issues));
    const reason = buildReason(r, now, { oldFinder: r.status === "approved" });
    const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : null);
    const stmts = [
      db.prepare("INSERT OR IGNORE INTO outreach_leads (id, source, source_ref, dedupe_key, name, trade, city, address, website, maps_url, rating, review_count, last_review_at, site_status, site_score, site_issues, reason, status, created_at, updated_at) VALUES (?, 'finder', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)")
        .bind(id, r.place_id ? clean(r.place_id, 200) : null, r.key, r.name, clean(r.trade, 80) || null, clean(r.city, 80) || null, clean(r.address, 300) || null, clean(r.website, 500) || null, clean(r.maps_url, 500) || null,
          num(r.rating), num(r.review_count), clean(r.last_review_at, 40) || null, clean(r.site_status, 20) || null, num(r.site_score), issues, reason, at, at),
    ];
    const seen = new Set();
    for (const c of contacts.get(r.id) || []) {
      const e = contactEligibility(c, r, suppressed);
      if (!e || seen.has(e.type + e.value)) continue;
      seen.add(e.type + e.value);
      stmts.push(db.prepare("INSERT OR IGNORE INTO outreach_contacts (lead_id, type, value, source, source_url, eligibility, eligibility_note, found_at) VALUES (?, ?, ?, 'finder', ?, ?, ?, ?)")
        .bind(id, e.type, e.value, e.source_url, e.eligibility, e.note, clean(c.found_at, 40) || at));
    }
    stmts.push(eventStmt(db, id, at, "imported", r.status === "approved" ? OLD_FINDER_NOTE : "Imported from the finder"));
    try { await db.batch(stmts); imported++; } catch (e) { skipped++; console.error("leads import skipped one lead:", e && e.message); }
  }
  return { imported, skipped, waiting: Math.max(0, fresh.length - imported) };
}

/* ---------- Website check (Online / Offline / Unverified) ---------- */

export const RECHECK_BATCH = 5; // sites checked per request (each may make a few fetches; Workers cap subrequests per request)
const SITE_CLAIMS = ["broken", "unverified", "offline", "online"];

/**
 * Checks one lead's website and records the answer: site_status becomes online, offline or unverified; site_issues lists what was seen (HTTP status, redirects,
 * protection, failure reason); the one-sentence reason is rebuilt from it; the finder's score is kept only for a verified offline site (an online or unverified one
 * is not a prospect because of its website, so it is no longer scored as one); and one timeline note says what happened. Only a lead nobody has started on
 * (status `new`) is touched, so an email already drafted or sent is never made untrue behind someone's back. Writes nothing to the finder.
 * @returns { id, name, ok, state?, reason?, httpStatus?, protection?, changed?, summary? } or { id, ok: false, skipped | error }
 */
export async function recheckLeadSite(env, leadId, deps = {}) {
  const db = env.PORTAL_DB, now = nowOf(deps), at = now.toISOString();
  const lead = await getLead(db, leadId);
  if (!lead) return { id: leadId, ok: false, error: "not_found" };
  const base = { id: lead.id, name: lead.name };
  if (!lead.website || !SITE_CLAIMS.includes(lead.site_status)) return { ...base, ok: false, skipped: "no_website_claim" };
  if (lead.status !== "new") return { ...base, ok: false, skipped: "already_started" };
  const result = await (deps.checkSite || checkSite)(lead.website, { fetchImpl: deps.fetch || undefined, at: now });
  const state = result.state;
  const issues = JSON.stringify(diagnosticLines(result));
  const score = state === "offline" ? (Number.isFinite(Number(lead.site_score)) && lead.site_score !== null ? Number(lead.site_score) : null) : null;
  const reason = buildReason({ ...lead, site_status: state, site_issues: issues }, now, { oldFinder: String(lead.reason || "").includes(OLD_FINDER_NOTE) });
  const res = await db.prepare("UPDATE outreach_leads SET site_status = ?, site_score = ?, site_issues = ?, reason = ?, updated_at = ? WHERE id = ? AND status = 'new'").bind(state, score, issues, reason, at, lead.id).run();
  if (!res.meta.changes) return { ...base, ok: false, skipped: "already_started" };
  await eventStmt(db, lead.id, at, "note", `Website check: ${result.summary}`).run();
  return { ...base, ok: true, state, reason: result.reason, httpStatus: result.httpStatus, protection: result.protection, changed: lead.site_status !== state, summary: result.summary, was: lead.site_status };
}

/**
 * Checks up to RECHECK_BATCH leads at once. With `ids`, exactly those (any website status: "check again"); without, the next leads whose website status is still the
 * finder's unconfirmed "doesn't load" claim. `remaining` is how many such leads are still waiting, so the page can keep going until it reaches 0.
 */
export async function recheckSites(env, { ids = null } = {}, deps = {}) {
  const db = env.PORTAL_DB;
  const pick = ids ? ids.slice(0, RECHECK_BATCH) : (await many(db, "SELECT id FROM outreach_leads WHERE status = 'new' AND site_status = 'broken' AND website IS NOT NULL ORDER BY updated_at, id LIMIT ?", RECHECK_BATCH)).map((r) => r.id);
  const results = await Promise.all(pick.map(async (id) => { try { return await recheckLeadSite(env, id, deps); } catch (e) { console.error("leads website check failed:", e && e.message); return { id, ok: false, error: "check_failed" }; } }));
  const waiting = await one(db, "SELECT COUNT(*) AS n FROM outreach_leads WHERE status = 'new' AND site_status = 'broken' AND website IS NOT NULL");
  return { checked: results.filter((r) => r.ok).length, results, remaining: Number(waiting && waiting.n) || 0 };
}

/* ---------- Drafting (templates, deterministic, no pricing) ---------- */

const BIO = "I'm a carpenter in Calgary with about 10,000 hours in the trade, and these days I build websites for trades businesses.";

const factOf = (lead) => {
  const host = hostOf(lead.website);
  const issues = parseIssues(lead.site_issues).slice(0, 2).map((i) => lowerFirst(i.replace(/[.;]+$/, "")).slice(0, 40));
  switch (lead.site_status) {
    case "none": return { observe: `I looked for ${lead.name} online and couldn't find a website.`, short: `I couldn't find a website for ${lead.name}`, close: "Right now there's nothing for them to find.", subject: `Finding ${lead.name} online` };
    case "social_only": { const s = socialName(lead.website) || "social media"; return { observe: `I looked for ${lead.name} online and only found a ${s} page, no website.`, short: `I only found a ${s} page for ${lead.name}`, close: `A ${s} page helps, but it isn't something you own or control.`, subject: `${lead.name} and your ${s} page` }; }
    case "offline": return { observe: `I tried to open the website for ${lead.name}${host ? ` (${host})` : ""} and it doesn't load for me.`, short: `The website I found for ${lead.name}${host ? ` (${host})` : ""} doesn't load`, close: "Right now they'd hit an error instead of your work.", subject: host ? `${host} isn't loading` : `The ${lead.name} website isn't loading` };
    // Not confirmed offline (still the finder's unchecked claim, protected from automated checks, or loading fine): never say it doesn't load or looks dated.
    case "broken": case "unverified": case "online": return { observe: `I came across ${lead.name} online.`, short: `I came across ${lead.name}`, close: "Most customers look a business up online before they call.", subject: `A question for ${lead.name}` };
    default: return { observe: `I had a look at the website for ${lead.name}${host ? ` (${host})` : ""} and it looks dated${issues.length ? ` (${issues.join(", ")})` : ""}.`, short: `The website I found for ${lead.name}${host ? ` (${host})` : ""} looks dated`, close: "A dated site can lose you jobs before anyone has called.", subject: `A look at the ${lead.name} website` };
  }
};

const signature = (senderName) => { const n = clean(senderName, 60); return n && n.toLowerCase() !== "framework" ? `- ${n}\nFramework` : "- Framework"; };

/**
 * A first-email draft: { subject, body } (the compliance footer is added separately). Plain text, about 100 to 140 words, one clear ask, no pricing.
 * Every sentence uses a fact from the lead's data or the owner's own background; nothing else is claimed.
 */
export function composeDraft(lead, { demoUrl, approach = "observation", senderName = "" }) {
  const l = { ...lead, name: clean(lead.name, 120) };
  const trade = clean(lead.trade, 60).toLowerCase() || "trades";
  const city = clean(lead.city, 60);
  const where = city ? ` in ${city}` : "";
  const rating = Number(lead.rating), reviews = Number(lead.review_count);
  const hasRep = Number.isFinite(rating) && rating > 0 && Number.isFinite(reviews) && reviews > 0;
  const stars = hasRep ? rating.toFixed(1) : null;
  const fact = factOf(l);
  const sign = signature(senderName);
  const ask = "If it's worth a conversation, reply to this email. If not, no hard feelings.";
  let subject, text;
  if (approach === "demo") {
    subject = `A demo site for ${l.name}`;
    text = [
      "Hi,",
      `I made a short demo of what a website could look like for a ${trade} business like ${l.name}: ${demoUrl}`,
      "Pick a trade, a style and a colour, put in your company name, and watch it change. It takes about a minute.",
      `${BIO} ${fact.short}, so I thought this might be useful.`,
      "If you'd like to talk it over, reply to this email and I'll answer it myself.",
      sign,
    ];
  } else if (approach === "reputation" && hasRep) {
    subject = `${stars} stars from ${plural(reviews, "review")}`;
    text = [
      "Hi,",
      `${plural(reviews, "review")} at ${stars} stars is a strong record for a ${trade} business${where}. People clearly trust the work ${l.name} does.`,
      `${fact.observe} Someone checking you out online should see that same quality.`,
      `${BIO} I put together a short demo of what a site could look like for a ${trade} business: ${demoUrl}`,
      ask,
      sign,
    ];
  } else {
    subject = fact.subject;
    text = [
      "Hi,",
      `${fact.observe}${hasRep ? ` Your ${plural(reviews, "review")} (${stars} stars) tell me people are happy with the work.` : ""}`,
      `When someone needs a ${trade}${where}, the first thing most of them do is look the business up online. ${fact.close}`,
      `${BIO} I put together a short demo of what a site could look like for a ${trade} business: ${demoUrl}`,
      ask,
      sign,
    ];
  }
  return { subject: clean(subject, 120), body: text.join("\n\n") };
}

export function composeFollowup(lead, { demoUrl, senderName = "" }) {
  const name = clean(lead.name, 120);
  return {
    subject: clean(`A quick follow-up about ${name}`, 120),
    body: [
      "Hi,",
      `I emailed a few days ago about a demo website for ${name}. In case it got buried, here's the link again: ${demoUrl}`,
      "If it isn't for you, no problem, and you won't hear from me again. If you have a question, reply here and I'll answer it myself.",
      signature(senderName),
    ].join("\n\n"),
  };
}

/** Pricing and "free" language is a product rule for a first contact. Returns the matching text or null. */
export function lintFirstEmail(subject, body) {
  const m = PRICING.exec(`${subject}\n${body}`);
  return m ? m[0] : null;
}
export const wordCount = (s) => (String(s).match(/\S+/g) || []).length;

/* ---------- Footer, content hash, unsubscribe token ---------- */

export const mailingAddress = (env) => clean(env && env.LEADS_MAILING_ADDRESS, 300);
export const senderName = (env) => clean(env && env.LEADS_SENDER_NAME, 60);

export function buildFooter({ mailing, sourceUrl, unsubscribeUrl }) {
  return [
    "--",
    "Framework",
    mailing || "[Mailing address not set: live sending is blocked]",
    sourceUrl ? `I'm writing because your address is published at ${sourceUrl}.` : "I'm writing because I found your business's contact details online.",
    `Not interested? Unsubscribe: ${unsubscribeUrl || "[unavailable]"}`,
  ].join("\n");
}

export async function contentHash(toEmail, subject, body, footer) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([String(toEmail || "").toLowerCase(), subject, body, footer])));
  return bytesToHex(new Uint8Array(digest));
}

/** Token = base64url(8 message-id bytes) + base64url(first 8 bytes of HMAC-SHA256(key, "unsub:" + messageId)): 22 characters, nothing stored. */
export async function unsubscribeToken(key, messageId) {
  if (!MESSAGE_ID.test(messageId)) throw new Error("invalid_message_id");
  const mac = await hmacHex(key, UNSUB_LABEL, messageId);
  return bytesToB64url(hexToBytes(messageId)) + bytesToB64url(hexToBytes(mac.slice(0, 16)));
}
export async function verifyUnsubscribeToken(key, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(token) || !key) return null;
  try {
    const id = bytesToHex(b64urlToBytes(token.slice(0, 11)));
    if (!MESSAGE_ID.test(id)) return null;
    return timingSafeEqualStrings(await unsubscribeToken(key, id), token) ? id : null;
  } catch {
    return null;
  }
}

/** The footer, text to send, hash and unsubscribe address for a message exactly as it would go out. */
export async function renderMessage(env, msg, contact, origin) {
  const key = signingKey(env);
  const unsubscribeUrl = key ? `${origin}/u/${await unsubscribeToken(key, msg.id)}` : null;
  const footer = buildFooter({ mailing: mailingAddress(env), sourceUrl: contact && contact.source_url, unsubscribeUrl });
  return { footer, unsubscribeUrl, text: `${msg.body}\n\n${footer}`, hash: await contentHash(msg.to_email, msg.subject, msg.body, footer) };
}

/* ---------- Sending mode and per-message rules ---------- */

/** { mode: off|test|live, test_recipient, blocked: [code, text] | null } from the environment. Never throws. */
export function sendingMode(env) {
  const e = env || {};
  if (e.LEADS_SENDING !== "1") return { mode: "off", test_recipient: null, blocked: ["sending_off", "Sending is off: awaiting setup (LEADS_SENDING is not 1)"] };
  const raw = clean(e.LEADS_TEST_RECIPIENT, 254);
  const testTo = raw ? normaliseEmail(raw) : null;
  const mode = raw ? "test" : "live";
  let blocked = null;
  if (raw && !testTo) blocked = ["test_recipient_invalid", "LEADS_TEST_RECIPIENT is not a valid address"];
  else if (!emailConfigured(e)) blocked = ["email_not_configured", "Email is not configured (RESEND_API_KEY and ASSESSMENT_FROM)"];
  else if (!signingKey(e)) blocked = ["secret_missing", "Unsubscribe links need DEMO_LINK_SECRET (or the portal session pepper)"];
  else if (mode === "live" && !mailingAddress(e)) blocked = ["mailing_address_missing", "LEADS_MAILING_ADDRESS is not set: live sending is blocked"];
  return { mode, test_recipient: testTo, blocked };
}

export async function getLead(db, id) { return LEAD_ID.test(String(id)) ? one(db, "SELECT * FROM outreach_leads WHERE id = ?", id) : null; }

/** A lead has opted out when it was dismissed as such (unsubscribe link, spam complaint, or marked by the owner). One opted-out ADDRESS only blocks that address (see the recipient checks). */
export const isOptedOut = (lead) => /^Opted out/i.test(lead.dismiss_reason || "");

async function isSuppressed(db, email) { return !!email && !!(await one(db, "SELECT 1 AS x FROM outreach_suppressions WHERE email = ?", String(email).toLowerCase())); }

/** The first eligible, unsuppressed email contact of a lead, or null. */
export async function preferredRecipient(db, leadId) {
  return one(db, "SELECT * FROM outreach_contacts c WHERE c.lead_id = ? AND c.type = 'email' AND c.eligibility = 'eligible' AND c.opted_out_at IS NULL AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.email = lower(c.value)) ORDER BY c.id LIMIT 1", leadId);
}

/** Follow-up rules: lead contacted, no reply, not opted out, last live send at least 5 days ago, no follow-up yet. */
export async function followupState(db, lead, now = new Date(), ignoreMessageId = null) {
  const no = (reason, extra = {}) => ({ allowed: false, reason, ...extra });
  if (lead.status !== "contacted") return no("A follow-up is possible only after the first email was sent");
  if (lead.replied_at) return no("They already replied");
  if (isOptedOut(lead)) return no("They opted out");
  const first = await one(db, "SELECT sent_at FROM outreach_messages WHERE lead_id = ? AND kind = 'first' AND is_test = 0 AND status = 'sent' ORDER BY sent_at DESC LIMIT 1", lead.id);
  if (!first || !first.sent_at) return no("No sent first email");
  const due = new Date(Date.parse(first.sent_at) + FOLLOWUP_DAYS * 86400000);
  if (due > now) return no(`Follow up after ${due.toISOString().slice(0, 10)} (${FOLLOWUP_DAYS} days after the first email)`, { due_at: due.toISOString() });
  const have = await one(db, "SELECT 1 AS x FROM outreach_messages WHERE lead_id = ? AND kind = 'followup' AND is_test = 0 AND status IN ('approved', 'sending', 'sent', 'bounced', 'complained') AND id <> ?", lead.id, ignoreMessageId || "");
  if (have) return no("A follow-up was already sent");
  return { allowed: true, reason: null, due_at: due.toISOString() };
}

/** One sentence: what the owner should do next for this lead. */
export function nextAction(lead, f = {}) {
  if (lead.status === "dismissed") return lead.dismiss_reason ? `Dismissed: ${lead.dismiss_reason}` : "Dismissed";
  if (lead.status === "won") return "Won";
  if (lead.status === "replied") return "Reply from your inbox, then mark won or dismiss";
  if (lead.status === "new") return "Review, then approve or dismiss";
  const failed = f.msgStatus === "bounced" ? "The email bounced" : f.msgStatus === "complained" ? "The recipient marked it as spam" : null;
  if (lead.status === "contacted") {
    if (failed) return f.hasEligible ? `${failed}: choose another address` : `${failed}: add another email address or phone them`;
    if (f.followup && f.followup.allowed) return `Draft the follow-up (${FOLLOWUP_DAYS} days have passed)`;
    if (f.followupLive) return "Waiting for a reply";
    return f.followup && f.followup.due_at ? `Waiting for a reply; follow up after ${f.followup.due_at.slice(0, 10)}` : "Waiting for a reply";
  }
  if (!f.hasEligible) return f.hasEmail ? "Confirm an email address (found, but not yet cleared)" : "Add an email address, or phone them";
  if (lead.status === "ready") return "Send the approved email";
  if (f.msgStatus === "failed") return "Sending failed: review and approve again";
  return "Review the draft and approve the email";
}

/**
 * Everything that stops this message going out right now, as [code, text] pairs (empty = it can be sent). Used for the panel, the preview and the send itself.
 * `mode` is sendingMode(env).
 */
export async function sendBlockers(env, lead, msg, contact, mode, now = new Date()) {
  const db = env.PORTAL_DB, out = [];
  const add = (c, t) => out.push([c, t]);
  if (isOptedOut(lead)) add("opted_out", "This lead opted out");
  else if (["dismissed", "replied", "won"].includes(lead.status)) add("lead_inactive", `Lead is ${lead.status}: no more email`);
  else if (msg.kind === "first" && !["approved", "ready"].includes(lead.status)) add("lead_inactive", lead.status === "contacted" ? "The first email was already sent" : "Approve the lead first");
  else if (msg.kind === "followup" && lead.status !== "contacted") add("lead_inactive", "A follow-up needs a sent first email");
  if (!contact || !msg.to_email) add("no_recipient", "No eligible email address");
  else if (contact.type !== "email" || String(contact.value).toLowerCase() !== String(msg.to_email).toLowerCase()) add("no_recipient", "The recipient does not match the contact");
  else if (contact.opted_out_at) add("opted_out", "This address opted out");
  else if (contact.eligibility === "blocked") add("suppressed", "This address is blocked");
  else if (contact.eligibility !== "eligible") add("recipient_not_eligible", "This address is not confirmed yet (review it first)");
  if (msg.to_email && (await isSuppressed(db, msg.to_email))) add("suppressed", "This address is suppressed (unsubscribed, bounced or marked as spam)");
  if (msg.kind === "first" && lintFirstEmail(msg.subject, msg.body)) add("pricing_in_first_email", "A first email may not mention pricing, rates or \"free\"");
  if (msg.kind === "followup") { const f = await followupState(db, lead, now, msg.id); if (!f.allowed && lead.status === "contacted") add("followup_not_allowed", f.reason); }
  if (msg.status !== "approved") add("not_approved", "The email is not approved yet");
  if (mode.blocked) add(mode.blocked[0], mode.blocked[1]);
  return out;
}

/** The panel's view of a message: its row plus the read-only footer and the blockers (texts). */
export async function messageView(env, lead, msg, origin, now = new Date()) {
  if (!msg) return null;
  const db = env.PORTAL_DB;
  const contact = msg.contact_id ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", msg.contact_id, lead.id) : null;
  const r = await renderMessage(env, msg, contact, origin);
  const blockers = await sendBlockers(env, lead, msg, contact, sendingMode(env), now);
  return {
    id: msg.id, kind: msg.kind, approach: msg.approach, subject: msg.subject, body: msg.body, footer: r.footer, to_email: msg.to_email, contact_id: msg.contact_id,
    status: msg.status, is_test: !!msg.is_test, content_hash: msg.content_hash, sent_at: msg.sent_at, delivered_at: msg.delivered_at, error: msg.error, blockers: blockers.map((b) => b[1]),
  };
}

/** The message the panel shows: the newest live (non-test) one. */
export const currentMessage = (db, leadId) => one(db, "SELECT * FROM outreach_messages WHERE lead_id = ? AND is_test = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1", leadId);

/* ---------- Lifecycle ---------- */

const fail = (status, error, extra = {}) => ({ ok: false, status, error, ...extra });
const notSetUp = () => fail(409, "not_set_up", { migration: MIGRATION });

/** Creates (or refreshes) the draft of a lead's first or follow-up email. */
async function writeDraft(env, lead, { approach, kind }, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const key = signingKey(env);
  if (!key) return fail(409, "secret_missing");
  const link = lead.demo_link_id ? await one(db, "SELECT id FROM demo_links WHERE id = ?", lead.demo_link_id) : null;
  if (!link) return fail(409, "no_demo_link");
  const demoUrl = `${ctx.origin}/d/${await tokenForLinkId(key, link.id)}`;
  const contact = (kind === "followup" && (await one(db, "SELECT c.* FROM outreach_messages m JOIN outreach_contacts c ON c.id = m.contact_id WHERE m.lead_id = ? AND m.kind = 'first' AND m.is_test = 0 AND m.status = 'sent' ORDER BY m.sent_at DESC LIMIT 1", lead.id))) || (await preferredRecipient(db, lead.id));
  const draft = kind === "followup" ? composeFollowup(lead, { demoUrl, senderName: senderName(env) }) : composeDraft(lead, { demoUrl, approach, senderName: senderName(env) });
  const stmts = [];
  const existing = await one(db, "SELECT * FROM outreach_messages WHERE lead_id = ? AND kind = ? AND is_test = 0 AND status IN ('draft', 'approved', 'failed') ORDER BY created_at DESC LIMIT 1", lead.id, kind);
  let id;
  if (existing) {
    id = existing.id;
    stmts.push(db.prepare("UPDATE outreach_messages SET status = 'draft', approach = ?, subject = ?, body = ?, contact_id = ?, to_email = ?, content_hash = NULL, approved_at = NULL, error = NULL, failed_at = NULL, edited_at = ? WHERE id = ? AND status IN ('draft', 'approved', 'failed')")
      .bind(approach, draft.subject, draft.body, contact ? contact.id : null, contact ? contact.value : null, at, id));
  } else {
    id = newId();
    stmts.push(db.prepare("INSERT INTO outreach_messages (id, lead_id, contact_id, to_email, kind, approach, subject, body, status, is_test, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', 0, ?)")
      .bind(id, lead.id, contact ? contact.id : null, contact ? contact.value : null, kind, approach, draft.subject, draft.body, at));
  }
  if (kind === "first" && lead.status === "ready") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'ready'").bind(at, lead.id));
  stmts.push(eventStmt(db, lead.id, at, kind === "followup" ? "followup_drafted" : "draft", `${kind === "followup" ? "Follow-up" : "Draft"} created (${approach})`));
  await db.batch(stmts);
  return { ok: true, message: await one(db, "SELECT * FROM outreach_messages WHERE id = ?", id) };
}

export async function draftMessage(env, leadId, approach, ctx) {
  const db = env.PORTAL_DB;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const id = approach || "observation";
  if (!APPROACHES.some((a) => a.id === id)) return fail(422, "validation_failed", { field: "approach" });
  if (await one(db, "SELECT 1 AS x FROM outreach_messages WHERE lead_id = ? AND kind = 'first' AND is_test = 0 AND status IN ('sending', 'sent', 'bounced', 'complained')", lead.id)) return fail(409, "first_email_already_sent");
  if (!["approved", "ready"].includes(lead.status)) return fail(409, lead.status === "new" ? "approve_first" : "lead_inactive");
  return writeDraft(env, lead, { approach: id, kind: "first" }, ctx);
}

export async function draftFollowup(env, leadId, ctx) {
  const db = env.PORTAL_DB;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const f = await followupState(db, lead, new Date(ctx.at));
  if (!f.allowed) return fail(409, "followup_not_allowed", { reason: f.reason });
  const first = await one(db, "SELECT approach FROM outreach_messages WHERE lead_id = ? AND kind = 'first' AND is_test = 0 ORDER BY created_at DESC LIMIT 1", lead.id);
  return writeDraft(env, lead, { approach: (first && first.approach) || "observation", kind: "followup" }, ctx);
}

/**
 * Approve a lead: claims it atomically (new -> approved), creates its tracking link and its first draft. Idempotent. With no signing key it fails cleanly
 * (409 secret_missing) and changes nothing.
 */
export async function approveLead(env, leadId, principal, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  let lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  if (lead.status === "dismissed") return fail(409, "lead_dismissed");
  if (lead.status !== "new") return { ok: true, lead };
  if (!signingKey(env)) return fail(409, "secret_missing");
  if (!(await tablesReady(db))) return fail(409, "not_set_up", { migration: "0021_demo_traffic.sql" });
  const claim = await db.prepare("UPDATE outreach_leads SET status = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND status = 'new'").bind(at, at, lead.id).run();
  if (!claim.meta || claim.meta.changes !== 1) return { ok: true, lead: await getLead(db, leadId) }; // another request approved it first
  try {
    const stmts = [];
    let linkId = lead.demo_link_id;
    if (!linkId || !(await one(db, "SELECT 1 AS x FROM demo_links WHERE id = ?", linkId))) {
      linkId = newLinkId();
      stmts.push(db.prepare("INSERT INTO demo_links (id, label, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(linkId, clean(lead.name, 120) || "Lead", "Created by the Leads workspace", at, clean(principal && principal.email, 254) || "admin"));
      stmts.push(db.prepare("UPDATE outreach_leads SET demo_link_id = ? WHERE id = ?").bind(linkId, lead.id));
    }
    stmts.push(eventStmt(db, lead.id, at, "approved", "Approved: tracking link created"));
    await db.batch(stmts);
    lead = await getLead(db, leadId);
    const d = await writeDraft(env, lead, { approach: "observation", kind: "first" }, ctx);
    if (!d.ok) throw new Error(d.error);
  } catch (e) {
    console.error("leads approve failed, reverting:", e && e.message);
    await db.prepare("UPDATE outreach_leads SET status = 'new', approved_at = NULL, updated_at = ? WHERE id = ? AND status = 'approved'").bind(at, leadId).run().catch(() => {});
    return fail(500, "approve_failed");
  }
  return { ok: true, lead: await getLead(db, leadId), created: true };
}

export async function dismissLead(env, leadId, reason, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  if (lead.status === "dismissed") return { ok: true, lead };
  const why = clean(reason, 200) || null;
  await db.batch([
    db.prepare("UPDATE outreach_leads SET status = 'dismissed', dismiss_reason = ?, dismissed_at = ?, updated_at = ? WHERE id = ?").bind(why, at, at, lead.id),
    db.prepare("UPDATE outreach_messages SET status = 'draft', content_hash = NULL, approved_at = NULL WHERE lead_id = ? AND status = 'approved'").bind(lead.id),
    eventStmt(db, lead.id, at, "dismissed", why || "Dismissed"),
  ]);
  return { ok: true, lead: await getLead(db, leadId) };
}

export async function reopenLead(env, leadId, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  if (lead.status !== "dismissed") return fail(409, "not_dismissed");
  if (isOptedOut(lead)) return fail(409, "opted_out");
  const sent = await one(db, "SELECT 1 AS x FROM outreach_messages WHERE lead_id = ? AND is_test = 0 AND status IN ('sending', 'sent', 'bounced', 'complained')", lead.id);
  if (lead.contacted_at || sent) return fail(409, "already_contacted");
  await db.batch([
    db.prepare("UPDATE outreach_leads SET status = 'new', dismiss_reason = NULL, dismissed_at = NULL, updated_at = ? WHERE id = ? AND status = 'dismissed'").bind(at, lead.id),
    eventStmt(db, lead.id, at, "reopened", "Reopened"),
  ]);
  return { ok: true, lead: await getLead(db, leadId) };
}

/** Statements that suppress these addresses everywhere: the suppression row, and every contact (of any lead) with that address blocked. */
function suppressStmts(db, emails, reason, at, note, optedOut) {
  const out = [];
  for (const e of new Set(emails.map((x) => String(x).toLowerCase()).filter(Boolean))) {
    out.push(db.prepare("INSERT OR IGNORE INTO outreach_suppressions (email, reason, at) VALUES (?, ?, ?)").bind(e, reason, at));
    out.push(db.prepare("UPDATE outreach_contacts SET eligibility = 'blocked', eligibility_note = ?, opted_out_at = CASE WHEN ? = 1 THEN COALESCE(opted_out_at, ?) ELSE opted_out_at END WHERE type = 'email' AND lower(value) = ?").bind(note, optedOut ? 1 : 0, at, e));
  }
  return out;
}

/** The lead opts out (unsubscribe link, a manual mark, or a spam complaint): every address of the lead is suppressed, the lead is dismissed, approved emails go back to draft. */
export async function optOutLead(env, leadId, { at, reason = "optout", dismissReason = "Opted out", eventType = "opted_out", detail = "Opted out", extraEmails = [] } = {}) {
  const db = env.PORTAL_DB;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const emails = [...(await many(db, "SELECT value FROM outreach_contacts WHERE lead_id = ? AND type = 'email'", lead.id)).map((r) => r.value), ...(await many(db, "SELECT to_email FROM outreach_messages WHERE lead_id = ? AND to_email IS NOT NULL AND is_test = 0", lead.id)).map((r) => r.to_email), ...extraEmails];
  const already = /^Opted out/i.test(lead.dismiss_reason || "");
  await db.batch([
    ...suppressStmts(db, emails, reason, at, reason === "complaint" ? "Marked as spam: suppressed" : "Opted out: suppressed", true),
    db.prepare("UPDATE outreach_leads SET status = 'dismissed', dismiss_reason = CASE WHEN dismiss_reason LIKE 'Opted out%' THEN dismiss_reason ELSE ? END, dismissed_at = COALESCE(dismissed_at, ?), updated_at = ? WHERE id = ?").bind(dismissReason, at, at, lead.id),
    db.prepare("UPDATE outreach_messages SET status = 'draft', content_hash = NULL, approved_at = NULL WHERE lead_id = ? AND status = 'approved'").bind(lead.id),
    ...(already ? [] : [eventStmt(db, lead.id, at, eventType, detail)]),
  ]);
  return { ok: true, lead: await getLead(db, leadId) };
}

/** Manual replied / won / optout. Replies are recorded by hand until inbound email is connected. */
export async function markLead(env, leadId, status, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  if (status === "optout") return optOutLead(env, leadId, { at, detail: "Marked as opted out by the owner" });
  if (status === "replied") {
    if (lead.status === "replied") return { ok: true, lead };
    if (lead.status !== "contacted") return fail(409, "invalid_transition");
    await db.batch([db.prepare("UPDATE outreach_leads SET status = 'replied', replied_at = ?, updated_at = ? WHERE id = ? AND status = 'contacted'").bind(at, at, lead.id), eventStmt(db, lead.id, at, "replied", "Marked as replied")]);
  } else if (status === "won") {
    if (lead.status === "won") return { ok: true, lead };
    if (!["contacted", "replied"].includes(lead.status)) return fail(409, "invalid_transition");
    await db.batch([db.prepare("UPDATE outreach_leads SET status = 'won', won_at = ?, updated_at = ? WHERE id = ? AND status IN ('contacted', 'replied')").bind(at, at, lead.id), eventStmt(db, lead.id, at, "won", "Marked as won")]);
  } else return fail(422, "validation_failed", { field: "status" });
  return { ok: true, lead: await getLead(db, leadId) };
}

/* ---------- Contacts ---------- */

export async function addContact(env, leadId, { type, value, source_url }, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const suppressed = new Set((await many(db, "SELECT email FROM outreach_suppressions")).map((r) => r.email));
  const e = contactEligibility({ type, value, source_url: null }, lead, suppressed, "manual");
  if (!e) return fail(422, "validation_failed", { field: "value" });
  let url = null;
  if (source_url !== undefined && source_url !== null && source_url !== "") {
    try { const u = new URL(String(source_url)); if (!/^https?:$/.test(u.protocol) || String(source_url).length > 500) throw new Error("x"); url = u.href.slice(0, 500); } catch { return fail(422, "validation_failed", { field: "source_url" }); }
  }
  const note = e.eligibility === "blocked" ? e.note : e.type === "email" ? "Added by hand: confirm before emailing" : e.note;
  try {
    const r = await db.prepare("INSERT INTO outreach_contacts (lead_id, type, value, source, source_url, eligibility, eligibility_note, found_at) VALUES (?, ?, ?, 'manual', ?, ?, ?, ?)").bind(lead.id, e.type, e.value, url, e.eligibility, note, at).run();
    await eventStmt(db, lead.id, at, "contact_added", `${e.type} added by hand`).run();
    return { ok: true, contact: await one(db, "SELECT * FROM outreach_contacts WHERE id = ?", r.meta.last_row_id) };
  } catch (err) {
    if (/UNIQUE|constraint/i.test(String(err && err.message))) return fail(409, "exists");
    throw err;
  }
}

/** The owner confirms a 'review' email. An address that is suppressed or opted out can never be un-blocked. */
export async function confirmContact(env, leadId, contactId, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const c = await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", contactId, leadId);
  if (!c) return fail(404, "not_found");
  if (c.type !== "email") return fail(422, "validation_failed", { field: "eligibility" });
  if (c.eligibility === "blocked" || c.opted_out_at || (await isSuppressed(db, c.value))) return fail(409, "blocked");
  if (c.eligibility !== "eligible") {
    await db.batch([
      db.prepare("UPDATE outreach_contacts SET eligibility = 'eligible', eligibility_note = ? WHERE id = ? AND eligibility = 'review'").bind("Confirmed by the owner", c.id),
      db.prepare("UPDATE outreach_messages SET contact_id = ?, to_email = ? WHERE lead_id = ? AND contact_id IS NULL AND status IN ('draft', 'failed')").bind(c.id, c.value, leadId),
      eventStmt(db, leadId, at, "contact_confirmed", "Email address confirmed by the owner"),
    ]);
  }
  return { ok: true, contact: await one(db, "SELECT * FROM outreach_contacts WHERE id = ?", c.id) };
}

/* ---------- Editing and approving the exact email ---------- */

const EDITABLE = ["draft", "approved", "failed"];

export async function editMessage(env, leadId, { subject, body, contact_id }, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const msg = await currentMessage(db, lead.id);
  if (!msg) return fail(404, "no_message");
  if (!EDITABLE.includes(msg.status)) return fail(409, "message_locked");
  const s = clean(subject, 150), b = cleanMultiline(body, 4000);
  if (!s) return fail(422, "validation_failed", { field: "subject" });
  if (!b) return fail(422, "validation_failed", { field: "body" });
  let contact = msg.contact_id ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", msg.contact_id, lead.id) : null;
  if (contact_id !== undefined && contact_id !== null) {
    contact = Number.isInteger(contact_id) ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ? AND type = 'email'", contact_id, lead.id) : null;
    if (!contact) return fail(422, "validation_failed", { field: "contact_id" });
  }
  const stmts = [db.prepare("UPDATE outreach_messages SET subject = ?, body = ?, contact_id = ?, to_email = ?, status = 'draft', content_hash = NULL, approved_at = NULL, error = NULL, edited_at = ? WHERE id = ? AND status IN ('draft', 'approved', 'failed')")
    .bind(s, b, contact ? contact.id : null, contact ? contact.value : null, at, msg.id)];
  if (msg.kind === "first" && lead.status === "ready") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'ready'").bind(at, lead.id));
  stmts.push(eventStmt(db, lead.id, at, "edited", msg.status === "approved" ? "Edited after approval: approval withdrawn" : "Edited"));
  await db.batch(stmts);
  return { ok: true, message: await one(db, "SELECT * FROM outreach_messages WHERE id = ?", msg.id) };
}

export async function approveMessage(env, leadId, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  let msg = await currentMessage(db, lead.id);
  if (!msg) return fail(404, "no_message");
  if (msg.status === "approved") return { ok: true, message: msg };
  if (!["draft", "failed"].includes(msg.status)) return fail(409, "message_locked");
  if (!signingKey(env)) return fail(409, "secret_missing");
  if (isOptedOut(lead) || ["dismissed", "replied", "won"].includes(lead.status)) return fail(409, "lead_inactive");
  if (msg.kind === "first" ? lead.status !== "approved" : lead.status !== "contacted") return fail(409, "lead_inactive");
  if (msg.kind === "first" && lintFirstEmail(msg.subject, msg.body)) return fail(422, "pricing_in_first_email");
  let contact = msg.contact_id ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", msg.contact_id, lead.id) : null;
  if (!contact || contact.eligibility !== "eligible") contact = await preferredRecipient(db, lead.id); // the chosen address is not usable (or none was chosen): fall back to a cleared one
  if (!contact || contact.type !== "email" || contact.eligibility !== "eligible" || contact.opted_out_at || (await isSuppressed(db, contact.value))) return fail(422, "no_eligible_recipient");
  msg = { ...msg, contact_id: contact.id, to_email: contact.value };
  const hash = (await renderMessage(env, msg, contact, ctx.origin)).hash;
  try {
    const stmts = [
      db.prepare("UPDATE outreach_messages SET status = 'approved', content_hash = ?, approved_at = ?, contact_id = ?, to_email = ?, error = NULL WHERE id = ? AND status IN ('draft', 'failed')").bind(hash, at, contact.id, contact.value, msg.id),
    ];
    if (msg.kind === "first") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'ready', updated_at = ? WHERE id = ? AND status = 'approved'").bind(at, lead.id));
    stmts.push(eventStmt(db, lead.id, at, "email_approved", msg.kind === "followup" ? "Follow-up approved" : "Email approved"));
    await db.batch(stmts);
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String(e && e.message))) return fail(409, "already_has_live_message");
    throw e;
  }
  return { ok: true, message: await one(db, "SELECT * FROM outreach_messages WHERE id = ?", msg.id) };
}

export async function unapproveMessage(env, leadId, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  if (!lead) return fail(404, "not_found");
  const msg = await currentMessage(db, lead.id);
  if (!msg) return fail(404, "no_message");
  if (msg.status === "draft") return { ok: true, message: msg };
  if (msg.status !== "approved") return fail(409, "message_locked");
  const stmts = [db.prepare("UPDATE outreach_messages SET status = 'draft', content_hash = NULL, approved_at = NULL WHERE id = ? AND status = 'approved'").bind(msg.id)];
  if (msg.kind === "first") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'ready'").bind(at, lead.id));
  stmts.push(eventStmt(db, lead.id, at, "email_unapproved", "Approval withdrawn"));
  await db.batch(stmts);
  return { ok: true, message: await one(db, "SELECT * FROM outreach_messages WHERE id = ?", msg.id) };
}

/* ---------- Sending ---------- */

const testSubject = (realTo, subject) => `[TEST for ${realTo}] ${subject}`;

/** The message that a send of this lead would use: the approved one, else the newest live one (so a preview can show a draft with its blockers). */
async function messageToSend(db, leadId) {
  return (await one(db, "SELECT * FROM outreach_messages WHERE lead_id = ? AND is_test = 0 AND status = 'approved' ORDER BY created_at DESC LIMIT 1", leadId)) || currentMessage(db, leadId);
}

/** Exactly what would be sent for up to MAX_SEND leads (nothing is sent or changed). */
export async function previewSend(env, ids, ctx) {
  const db = env.PORTAL_DB, mode = sendingMode(env), emails = [];
  for (const id of ids) {
    const lead = await getLead(db, id);
    const msg = lead ? await messageToSend(db, lead.id) : null;
    if (!lead || !msg) { emails.push({ lead_id: id, name: lead ? lead.name : null, to: null, real_to: null, subject: null, body: null, footer: null, hash: null, blockers: [lead ? "No email drafted yet" : "Lead not found"] }); continue; }
    const contact = msg.contact_id ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", msg.contact_id, lead.id) : null;
    const r = await renderMessage(env, msg, contact, ctx.origin);
    const blockers = await sendBlockers(env, lead, msg, contact, mode, new Date(ctx.at));
    emails.push({
      lead_id: lead.id, name: lead.name, to: mode.mode === "test" ? mode.test_recipient : msg.to_email, real_to: msg.to_email,
      subject: mode.mode === "test" && msg.to_email ? testSubject(msg.to_email, msg.subject) : msg.subject, body: msg.body, footer: r.footer, hash: r.hash, blockers: blockers.map((b) => b[1]),
    });
  }
  return { mode: mode.mode, emails };
}

async function sendOne(env, { lead_id: leadId, hash }, ctx) {
  const db = env.PORTAL_DB, at = ctx.at;
  const lead = await getLead(db, leadId);
  const res = (ok, extra) => ({ lead_id: leadId, ok, ...extra });
  if (!lead) return res(false, { error: "not_found" });
  const msg = await one(db, "SELECT * FROM outreach_messages WHERE lead_id = ? AND is_test = 0 AND status = 'approved' ORDER BY created_at DESC LIMIT 1", lead.id);
  if (!msg) return res(false, { error: "not_approved" });
  const mode = sendingMode(env);
  const contact = msg.contact_id ? await one(db, "SELECT * FROM outreach_contacts WHERE id = ? AND lead_id = ?", msg.contact_id, lead.id) : null;
  const blockers = await sendBlockers(env, lead, msg, contact, mode, new Date(at));
  if (blockers.length) return res(false, { error: blockers[0][0] });
  const rendered = await renderMessage(env, msg, contact, ctx.origin);
  if (!msg.content_hash || typeof hash !== "string" || rendered.hash !== msg.content_hash || hash !== msg.content_hash) return res(false, { error: "hash_mismatch" });

  // Atomic claim: only one request can move this message from approved to sending, so a double click or a retry can never send twice.
  const claim = await db.prepare("UPDATE outreach_messages SET status = 'sending' WHERE id = ? AND status = 'approved'").bind(msg.id).run();
  if (!claim.meta || claim.meta.changes !== 1) return res(false, { error: "already_sending" });

  const test = mode.mode === "test";
  const copyId = test ? newId() : null; // a test send leaves the approved message untouched and records its own copy
  const idForLink = test ? copyId : msg.id;
  const out = test ? await renderMessage(env, { ...msg, id: copyId }, contact, ctx.origin) : rendered;
  let result;
  try {
    result = await sendEmail(env, {
      to: test ? mode.test_recipient : msg.to_email,
      replyTo: notifyRecipient(env),
      subject: test ? testSubject(msg.to_email, msg.subject) : msg.subject,
      text: out.text,
      idempotencyKey: "lead-msg-" + idForLink,
      headers: { "List-Unsubscribe": `<${out.unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    }, ctx.fetch || fetch);
  } catch (e) {
    result = { ok: false, error: "network:" + oneLine(e && e.name, 40) };
  }
  if (!result.ok) {
    const error = oneLine(result.error, 200);
    const stmts = test
      ? [db.prepare("UPDATE outreach_messages SET status = 'approved' WHERE id = ? AND status = 'sending'").bind(msg.id)]
      : [db.prepare("UPDATE outreach_messages SET status = 'failed', error = ?, failed_at = ? WHERE id = ? AND status = 'sending'").bind(error, at, msg.id)];
    if (!test && msg.kind === "first") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'ready'").bind(at, lead.id));
    stmts.push(eventStmt(db, lead.id, at, "failed", `${test ? "Test send" : "Send"} failed: ${error}`));
    await db.batch(stmts);
    return res(false, { error: "send_failed", detail: error });
  }
  if (test) {
    await db.batch([
      db.prepare("INSERT INTO outreach_messages (id, lead_id, contact_id, to_email, kind, approach, subject, body, status, content_hash, is_test, provider_id, created_at, approved_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, 1, ?, ?, ?, ?)")
        .bind(copyId, lead.id, msg.contact_id, msg.to_email, msg.kind, msg.approach, msg.subject, msg.body, msg.content_hash, result.id || null, at, msg.approved_at, at),
      db.prepare("UPDATE outreach_messages SET status = 'approved' WHERE id = ? AND status = 'sending'").bind(msg.id),
      eventStmt(db, lead.id, at, "test_sent", "Test email sent to the test recipient; the lead was not contacted"),
    ]);
    return res(true, { status: "test_sent" });
  }
  const stmts = [db.prepare("UPDATE outreach_messages SET status = 'sent', provider_id = ?, sent_at = ?, error = NULL WHERE id = ? AND status = 'sending'").bind(result.id || null, at, msg.id)];
  if (msg.kind === "first") stmts.push(db.prepare("UPDATE outreach_leads SET status = 'contacted', contacted_at = COALESCE(contacted_at, ?), updated_at = ? WHERE id = ? AND status = 'ready'").bind(at, at, lead.id));
  else stmts.push(db.prepare("UPDATE outreach_leads SET updated_at = ? WHERE id = ?").bind(at, lead.id));
  stmts.push(eventStmt(db, lead.id, at, "sent", msg.kind === "followup" ? "Follow-up sent" : "Email sent"));
  await db.batch(stmts);
  return res(true, { status: "sent" });
}

/** Sends up to MAX_SEND approved emails, one after the other. Each item is checked on its own; one failure never stops the others. */
export async function sendMessages(env, items, ctx) {
  const results = [];
  for (const item of items.slice(0, MAX_SEND)) {
    try { results.push(await sendOne(env, item, ctx)); } catch (e) { console.error("leads send error:", e && e.message); results.push({ lead_id: item.lead_id, ok: false, error: "server_error" }); }
  }
  return results;
}

/* ---------- Public: unsubscribe page ---------- */

export const UNSUBSCRIBE_CSS = "body{margin:0;background:#fff;color:#000;font:16px/1.5 system-ui,-apple-system,Segoe UI,Arial,sans-serif}main{max-width:32rem;margin:0 auto;padding:3rem 1.25rem}h1{font-size:1.75rem;line-height:1.15;margin:0 0 1rem;border-bottom:2px solid #000;padding-bottom:.75rem}p{margin:0 0 1rem}button{font:inherit;font-weight:600;background:#000;color:#fff;border:0;border-radius:0;padding:.75rem 1.5rem;cursor:pointer}button:focus-visible{outline:3px solid #000;outline-offset:3px}";
let cssHash;
const styleHash = async () => cssHash || (cssHash = crypto.subtle.digest("SHA-256", new TextEncoder().encode(UNSUBSCRIBE_CSS)).then((d) => btoa(String.fromCharCode(...new Uint8Array(d)))));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function unsubscribePage(status, title, lines, button = false) {
  const html = `<!DOCTYPE html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(title)} | Framework</title><style>${UNSUBSCRIBE_CSS}</style></head>
<body><main><h1>${esc(title)}</h1>${lines.map((l) => `<p>${esc(l)}</p>`).join("")}${button ? '<form method="post"><button type="submit">Unsubscribe</button></form>' : ""}</main></body></html>`;
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": `default-src 'none'; style-src 'sha256-${await styleHash()}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
      "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
    },
  });
}

/**
 * GET/HEAD /u/<token> shows a page with a button and records NOTHING (mail scanners prefetch links). POST /u/<token> (the button, and the RFC 8058
 * one-click List-Unsubscribe-Post) records the opt-out. A tampered token is refused before any database access.
 */
export async function handleUnsubscribe(request, env, deps = {}) {
  const url = new URL(request.url);
  const m = url.pathname.match(/^\/u\/([^/]+)\/*$/);
  const invalid = () => unsubscribePage(404, "This link isn't valid", ["If you want to stop emails from Framework, reply to the message and say so, and it will stop."]);
  if (!m) return invalid();
  if (request.method !== "GET" && request.method !== "HEAD" && request.method !== "POST") {
    const r = await unsubscribePage(405, "Not allowed", ["Open this page in a browser."]);
    r.headers.set("Allow", "GET, HEAD, POST");
    return r;
  }
  try {
    const messageId = await verifyUnsubscribeToken(signingKey(env), m[1]);
    if (!messageId) return invalid();
    if (request.method !== "POST") return unsubscribePage(200, "Unsubscribe", ["Press the button to stop emails from Framework to this address.", "Nothing changes until you press it."], true);
    const db = env.PORTAL_DB;
    if (!(await leadsReady(db))) return unsubscribePage(503, "Please try again later", ["We couldn't record this just now. Reply to the email and say you want to stop, and it will stop."]);
    const msg = await one(db, "SELECT id, lead_id, to_email, is_test FROM outreach_messages WHERE id = ?", messageId);
    if (!msg) return invalid();
    if (!msg.is_test) await optOutLead(env, msg.lead_id, { at: nowOf(deps).toISOString(), extraEmails: msg.to_email ? [msg.to_email] : [], detail: "Opted out through the unsubscribe link" });
    return unsubscribePage(200, "You're unsubscribed", ["Framework won't email this address again."]);
  } catch (e) {
    console.error("leads unsubscribe error:", e && e.message);
    forgetLeadsReady(env.PORTAL_DB);
    return unsubscribePage(503, "Please try again later", ["We couldn't record this just now. Reply to the email and say you want to stop, and it will stop."]);
  }
}

/* ---------- Public: Resend delivery webhook (Svix) ---------- */

function webhookKey(env) {
  const raw = clean(env && env.RESEND_WEBHOOK_SECRET, 400).replace(/^whsec_/, "");
  if (!raw) return null;
  try { const bin = atob(raw.replace(/-/g, "+").replace(/_/g, "/")); return bin.length >= 8 ? Uint8Array.from(bin, (c) => c.charCodeAt(0)) : null; } catch { return null; }
}
export const webhookConfigured = (env) => !!webhookKey(env);

/** Svix signature check: id.timestamp.body signed with HMAC-SHA256 under the decoded secret, timestamp within 5 minutes, constant-time compare. */
export async function verifySvix(env, headers, body, nowMs = Date.now()) {
  const keyBytes = webhookKey(env);
  if (!keyBytes) return "not_configured";
  const id = headers.get("svix-id"), ts = headers.get("svix-timestamp"), sigs = headers.get("svix-signature");
  if (!id || !ts || !sigs || !/^\d{9,12}$/.test(ts) || id.length > 200) return "invalid";
  if (Math.abs(nowMs / 1000 - Number(ts)) > WEBHOOK_TOLERANCE_S) return "stale";
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  let ok = false;
  for (const part of sigs.split(" ")) { const [version, sig] = part.split(","); if (version === "v1" && sig && timingSafeEqualStrings(sig, expected)) ok = true; }
  return ok ? "ok" : "invalid";
}

async function applyDeliveryEvent(env, type, providerId, at) {
  const db = env.PORTAL_DB;
  const msg = await one(db, "SELECT * FROM outreach_messages WHERE provider_id = ?", providerId);
  if (!msg) return "unknown";
  if (type === "email.delivered") {
    if (msg.delivered_at) return "duplicate";
    await db.batch([db.prepare("UPDATE outreach_messages SET delivered_at = ? WHERE id = ? AND delivered_at IS NULL").bind(at, msg.id), eventStmt(db, msg.lead_id, at, "delivered", msg.is_test ? "Test email delivered" : "Email delivered")]);
    return "delivered";
  }
  if (type === "email.bounced" || type === "email.failed") {
    const status = type === "email.bounced" ? "bounced" : "failed";
    if (!["sent", "sending"].includes(msg.status)) return "duplicate";
    const stmts = [db.prepare("UPDATE outreach_messages SET status = ?, failed_at = ?, error = ? WHERE id = ? AND status IN ('sent', 'sending')").bind(status, at, status === "bounced" ? "Bounced" : "Delivery failed", msg.id)];
    if (!msg.is_test && msg.to_email) stmts.push(...suppressStmts(db, [msg.to_email], "bounce", at, "Bounced: address suppressed", false)); // a test send never suppresses the real address
    stmts.push(eventStmt(db, msg.lead_id, at, status, msg.is_test ? `Test email ${status}` : `Email ${status}`));
    await db.batch(stmts);
    return status;
  }
  if (type === "email.complained") {
    if (msg.status === "complained") return "duplicate";
    if (msg.is_test) { await db.batch([db.prepare("UPDATE outreach_messages SET status = 'complained' WHERE id = ?").bind(msg.id), eventStmt(db, msg.lead_id, at, "complained", "Test email marked as spam")]); return "complained"; }
    await db.prepare("UPDATE outreach_messages SET status = 'complained', failed_at = ?, error = 'Marked as spam' WHERE id = ?").bind(at, msg.id).run();
    await optOutLead(env, msg.lead_id, { at, reason: "complaint", dismissReason: "Opted out (complaint)", eventType: "complained", detail: "Recipient marked the email as spam", extraEmails: msg.to_email ? [msg.to_email] : [] });
    return "complained";
  }
  return "ignored";
}

/** POST /api/leads/webhook. Signature required; without a configured secret nothing is stored (503). 200 for every valid signature, unknown ids included. */
export async function handleLeadsWebhook(request, env, deps = {}) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (!webhookKey(env)) return json({ error: "not_configured" }, 503);
  const raw = await readTextLimited(request, 65536);
  if (raw === null) return json({ error: "too_large" }, 413);
  const verdict = await verifySvix(env, request.headers, raw, nowOf(deps).getTime());
  if (verdict !== "ok") return json({ error: verdict === "stale" ? "stale_timestamp" : "invalid_signature" }, 401);
  let event;
  try { event = JSON.parse(raw); } catch { return json({ ok: true, ignored: "invalid_json" }); }
  const type = event && typeof event.type === "string" ? event.type : "";
  const providerId = event && event.data && typeof event.data.email_id === "string" ? event.data.email_id.slice(0, 100) : "";
  if (!providerId || !type.startsWith("email.")) return json({ ok: true, ignored: true });
  try {
    if (!(await leadsReady(env.PORTAL_DB))) return json({ ok: true, ignored: "not_set_up" });
    return json({ ok: true, result: await applyDeliveryEvent(env, type, providerId, nowOf(deps).toISOString()) });
  } catch (e) {
    console.error("leads webhook error:", e && e.message);
    forgetLeadsReady(env.PORTAL_DB);
    return json({ error: "server_error" }, 500); // a storage fault: the provider retries, so a bounce is not lost
  }
}
