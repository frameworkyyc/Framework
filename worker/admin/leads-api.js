/**
 * Framework Admin — Leads API (/api/admin/leads/…). The workspace behind Admin -> Leads (worker/leads.js, worker/LEADS.md). Only ever called after
 * authenticateAdmin() succeeded (see router.js). Reads and writes the outreach_* tables of PORTAL_DB (proposed migration 0022; every route except
 * GET /status answers 409 "not_set_up" until it is applied) and reads the demo_* tables (migration 0021) for the visits shown in a lead's panel.
 * All SQL is parameterised; every id, length and enum is validated; writes need the same Origin plus X-Framework-Admin: 1 (like demo-traffic-api.js).
 * Lead names, notes and company names are user text: returned as data, the admin app sets them as text.
 */
import { json } from "../shared.js";
import { readTextLimited } from "../assessment.js";
import { signingKey, tokenForLinkId, tablesReady } from "../demo-traffic.js";
import {
  MIGRATION, STATUSES, APPROACHES, LEAD_ID, MAX_SEND, FOLLOWUP_DAYS,
  leadsReady, forgetLeadsReady, nowOf, clean, cleanMultiline, maskEmail, sendingMode, mailingAddress, senderName, finderBound, finderWaiting, syncFinder, recheckSites, RECHECK_BATCH,
  messageView, currentMessage, nextAction, isOptedOut, getLead, followupState, webhookConfigured, OLD_FINDER_NOTE,
  approveLead, dismissLead, reopenLead, markLead, addContact, confirmContact, draftMessage, draftFollowup, editMessage, approveMessage, unapproveMessage, previewSend, sendMessages,
} from "../leads.js";
import { emailConfig } from "../assessment.js";
import { seoReady, markSiteWorking, logContact, updateOutreach, outreachOf, trackingReady, TRACKING_MIGRATION, OUTREACH_STATUSES, callQueueReady, CALL_MIGRATION, callOf, queueCall, clearCall, edmontonDay } from "../leads.js";
import { scoreLead, parseAssessment, opportunityLevel } from "../seo-score.js";
import { buildSeoReport, reportMarkdown, renderSeoPdf } from "../seo-report.js";

const LIST_LIMIT = 300;
const TIMELINE_LIMIT = 200;
const JOURNEY_LIMIT = 50;
const MAX_BODY = 65536;

const bad = (field) => json({ error: "validation_failed", field }, 422);
const notAllowed = (allow) => json({ error: "method_not_allowed" }, 405, { Allow: allow });
const forbidden = () => json({ error: "forbidden" }, 403);

/** State-changing requests must come from our own pages: same Origin plus a custom header (CSRF defence). */
function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin && request.headers.get("X-Framework-Admin") === "1";
}

/** The JSON object of a request body (an empty body is {}). Returns { body } or { response }. */
async function readBody(request) {
  const text = await readTextLimited(request, MAX_BODY);
  if (text === null) return { response: json({ error: "too_large" }, 413) };
  if (!text.trim()) return { body: {} };
  try {
    const body = JSON.parse(text);
    return body && typeof body === "object" && !Array.isArray(body) ? { body } : { response: json({ error: "invalid_json" }, 400) };
  } catch {
    return { response: json({ error: "invalid_json" }, 400) };
  }
}

const all = async (db, sql, params = []) => (await db.prepare(sql).bind(...params).all()).results || [];
const flag = (v) => v === 1 || v === true;

/** A failed lifecycle result as an HTTP response. */
const failure = (r) => json({ error: r.error, ...(r.field ? { field: r.field } : {}), ...(r.migration ? { migration: r.migration } : {}), ...(r.reason ? { reason: r.reason } : {}) }, r.status || 400);

/* ---------- Status ---------- */

async function status(env, now) {
  const db = env.PORTAL_DB;
  const out = {
    ready: false, migration: MIGRATION,
    setup: {
      finder: { connected: false, waiting: 0 }, tracking: { ready: false }, email: { configured: false, from: null },
      sending: { mode: "off", test_recipient: null, blocked_reason: null }, mailing_address: false, sender_name: false, webhook: { configured: false }, replies: "manual",
    },
  };
  const guard = async (fn) => { try { await fn(); } catch (e) { console.error("admin leads status error:", e && e.message); } };
  await guard(async () => { forgetLeadsReady(db); out.ready = await leadsReady(db, now.getTime()); });
  await guard(async () => { out.setup.finder = await finderWaiting(env); });
  await guard(async () => { out.setup.tracking.ready = !!signingKey(env) && (await tablesReady(db, now.getTime())); });
  await guard(async () => { out.setup.outreach_tracking = { ready: await trackingReady(db, now.getTime()), migration: TRACKING_MIGRATION }; });
  await guard(async () => { out.setup.call_queue = { ready: await callQueueReady(db, now.getTime()), migration: CALL_MIGRATION }; });
  await guard(async () => { const c = emailConfig(env); out.setup.email = { configured: c.ok, from: c.ok ? c.from : null }; });
  await guard(async () => { const m = sendingMode(env); out.setup.sending = { mode: m.mode, test_recipient: maskEmail(m.test_recipient), blocked_reason: m.blocked ? m.blocked[1] : null }; });
  await guard(async () => { out.setup.mailing_address = !!mailingAddress(env); out.setup.sender_name = !!senderName(env); out.setup.webhook = { configured: webhookConfigured(env) }; });
  return json(out);
}

/* ---------- List ---------- */

const likeEscape = (s) => s.replace(/[\\%_]/g, (c) => "\\" + c);

async function list(url, env, now) {
  const db = env.PORTAL_DB;
  const st = url.searchParams.get("status") || "all";
  if (st !== "all" && !STATUSES.includes(st)) return bad("status");
  const q = clean(url.searchParams.get("q") || "", 100);
  if ((url.searchParams.get("q") || "").length > 200) return bad("q");
  const oc = url.searchParams.get("outreach") || "";
  if (oc && !["any", "none", ...OUTREACH_STATUSES].includes(oc)) return bad("outreach");
  const callQ = url.searchParams.get("call") || "";
  if (callQ && callQ !== "queued") return bad("call");
  const tracking = await trackingReady(db, now.getTime());
  const callReady = await callQueueReady(db, now.getTime());
  const today = edmontonDay(now.toISOString());
  const callCols = callReady ? ", l.call_on, l.call_note, l.call_queued_at" : "";
  const trackCols = tracking ? ", l.contact_method, l.last_contact_at, l.outreach_status, l.follow_up_on, l.outreach_note" : "";
  /* where a lead stands in outreach: the logged status when there is one, else read from the lifecycle (emailed = Contacted, replied = Replied) */
  const EFF = (tracking ? "COALESCE(l.outreach_status, " : "(") + "CASE l.status WHEN 'contacted' THEN 'contacted' WHEN 'replied' THEN 'replied' END)";
  const demo = await tablesReady(db, now.getTime());
  const D = (agg, extra = "") => `(SELECT ${agg} FROM demo_journeys j WHERE j.link_id = l.demo_link_id AND j.bot = 0${extra})`;
  const demoCols = demo ? `, ${D("COUNT(*)")} AS d_visits, ${D("COALESCE(SUM(j.demo_opens), 0)")} AS d_opens, (SELECT j.company FROM demo_journeys j WHERE j.link_id = l.demo_link_id AND j.bot = 0 AND j.company IS NOT NULL ORDER BY j.last_seen_at DESC LIMIT 1) AS d_company,
    ${D("COUNT(*)", " AND j.enquired = 1")} AS d_enq, ${D("MAX(j.last_seen_at)")} AS d_last` : "";
  const seo = await seoReady(db, now.getTime());
  const seoCols = seo ? ", l.seo_score, l.seo_assessed_at, l.site_verified_at" : "";
  const byOpportunity = seo && url.searchParams.get("sort") === "opportunity";
  const where = [], params = [];
  if (st !== "all") { where.push("l.status = ?"); params.push(st); }
  if (callQ === "queued") where.push(callReady ? "l.call_on IS NOT NULL" : "0 = 1");
  if (oc === "any") where.push(`${EFF} IS NOT NULL`); else if (oc === "none") where.push(`${EFF} IS NULL`); else if (oc) { where.push(`${EFF} = ?`); params.push(oc); }
  if (q) { where.push("(l.name LIKE ? ESCAPE '\\' OR l.trade LIKE ? ESCAPE '\\' OR l.city LIKE ? ESCAPE '\\' OR l.website LIKE ? ESCAPE '\\')"); const p = `%${likeEscape(q)}%`; params.push(p, p, p, p); }
  const rows = await all(db, `SELECT l.id, l.name, l.trade, l.city, l.status, l.reason, l.website, l.site_status, l.rating, l.review_count, l.updated_at, l.contacted_at, l.replied_at, l.dismiss_reason, l.demo_link_id${seoCols}${trackCols}${callCols},
      EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.lead_id = l.id AND c.type = 'email' AND c.eligibility = 'eligible' AND c.opted_out_at IS NULL AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.email = lower(c.value))) AS has_eligible_email,
      EXISTS (SELECT 1 FROM outreach_contacts c WHERE c.lead_id = l.id AND c.type = 'email') AS has_email,
      (SELECT c.value FROM outreach_contacts c WHERE c.lead_id = l.id AND c.type = 'phone' ORDER BY c.id LIMIT 1) AS phone,
      (SELECT m.status FROM outreach_messages m WHERE m.lead_id = l.id AND m.is_test = 0 ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS msg_status,
      (SELECT m.sent_at FROM outreach_messages m WHERE m.lead_id = l.id AND m.kind = 'first' AND m.is_test = 0 AND m.status = 'sent' ORDER BY m.sent_at DESC LIMIT 1) AS first_sent_at,
      EXISTS (SELECT 1 FROM outreach_messages m WHERE m.lead_id = l.id AND m.kind = 'followup' AND m.is_test = 0 AND m.status IN ('approved', 'sending', 'sent', 'bounced', 'complained')) AS followup_live${demoCols}
    FROM outreach_leads l ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${callQ === "queued" && callReady ? "l.call_on, " : ""}${byOpportunity ? "l.seo_score IS NULL, l.seo_score DESC, " : ""}l.updated_at DESC, l.id LIMIT ${LIST_LIMIT}`, params);
  const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  for (const r of await all(db, "SELECT status, COUNT(*) AS n FROM outreach_leads GROUP BY status")) if (r.status in counts) counts[r.status] = r.n;
  const outreachCounts = { any: 0, none: 0, ...Object.fromEntries(OUTREACH_STATUSES.map((x) => [x, 0])) };
  for (const r of await all(db, `SELECT ${EFF} AS o, COUNT(*) AS n FROM outreach_leads l GROUP BY o`)) { if (r.o) { outreachCounts[r.o] = r.n; outreachCounts.any += r.n; } else outreachCounts.none += r.n; }
  const leads = rows.map((r) => {
    const optedOut = isOptedOut(r);
    const due = r.first_sent_at ? new Date(Date.parse(r.first_sent_at) + FOLLOWUP_DAYS * 86400000) : null;
    const followup = { allowed: r.status === "contacted" && !r.replied_at && !optedOut && !!due && due <= now && !flag(r.followup_live), due_at: due ? due.toISOString() : null };
    return {
      id: r.id, name: r.name, trade: r.trade, city: r.city, status: r.status, reason: r.reason, website: r.website, site_status: r.site_status, rating: r.rating, review_count: r.review_count,
      has_eligible_email: flag(r.has_eligible_email), has_email: flag(r.has_email), phone: r.phone || null,
      demo: demo && r.demo_link_id ? { visits: r.d_visits, opens: r.d_opens, company: r.d_company || null, enquired: r.d_enq > 0, last_activity: r.d_last || null } : null,
      next_action: nextAction(r, { hasEligible: flag(r.has_eligible_email), hasEmail: flag(r.has_email), msgStatus: r.msg_status, followup, followupLive: flag(r.followup_live) }),
      seo_score: seo && Number.isFinite(r.seo_score) ? r.seo_score : null, seo_level: seo ? opportunityLevel(Number.isFinite(r.seo_score) ? r.seo_score : null) : null, site_verified: seo && !!r.site_verified_at,
      updated_at: r.updated_at, contacted_at: r.contacted_at, opted_out: optedOut, outreach: outreachOf(r), call: callOf(r, now.toISOString()),
      source_note: r.reason && r.reason.includes(OLD_FINDER_NOTE) ? OLD_FINDER_NOTE : null,
    };
  });
  const callCounts = { queued: 0, overdue: 0 };
  if (callReady) { const c = await db.prepare("SELECT COUNT(*) AS queued, COALESCE(SUM(call_on < ?), 0) AS overdue FROM outreach_leads WHERE call_on IS NOT NULL").bind(today).first(); callCounts.queued = Number(c && c.queued) || 0; callCounts.overdue = Number(c && c.overdue) || 0; }
  return json({ counts, outreach_counts: outreachCounts, call_counts: callCounts, leads, limit: LIST_LIMIT, seo, tracking, call_queue: callReady });
}

/* ---------- One lead ---------- */

/** A lead row as the API returns it: every column, plus what to do next and whether it opted out. */
async function leadOut(env, lead, now) {
  const db = env.PORTAL_DB;
  const contacts = await all(db, "SELECT type, eligibility, opted_out_at, value FROM outreach_contacts WHERE lead_id = ?", [lead.id]);
  const msg = await currentMessage(db, lead.id);
  const preferred = await db.prepare("SELECT 1 AS x FROM outreach_contacts c WHERE c.lead_id = ? AND c.type = 'email' AND c.eligibility = 'eligible' AND c.opted_out_at IS NULL AND NOT EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.email = lower(c.value))").bind(lead.id).first();
  const followup = await followupState(db, lead, now);
  const live = await db.prepare("SELECT 1 AS x FROM outreach_messages WHERE lead_id = ? AND kind = 'followup' AND is_test = 0 AND status IN ('approved', 'sending', 'sent', 'bounced', 'complained')").bind(lead.id).first();
  const optedOut = isOptedOut(lead);
  const { seo_data: seoRaw, ...rest } = lead;
  const snap = parseAssessment(seoRaw);
  const sc = snap ? scoreLead(snap, lead) : null;
  const seo = sc ? { score: sc.score, level: opportunityLevel(sc.score), label: sc.label, coverage: sc.coverage, assessed_at: lead.seo_assessed_at || snap.assessedAt || null, components: sc.components.map(({ issues, ...c }) => c), report: seoView(lead) } : null;
  return { ...rest, seo, opted_out: optedOut, outreach: outreachOf(lead), call: callOf(lead, now.toISOString()), next_action: nextAction(lead, { hasEligible: !!preferred, hasEmail: contacts.some((c) => c.type === "email"), msgStatus: msg && msg.status, followup, followupLive: !!live }) };
}

async function demoSection(env, lead, origin, includeBots, now) {
  const empty = { link: null, summary: { opens: 0, visits: 0, enquiries: 0 }, journeys: [] };
  const db = env.PORTAL_DB;
  if (!lead.demo_link_id || !(await tablesReady(db, now.getTime()))) return empty;
  const link = await db.prepare("SELECT id, label, revoked_at FROM demo_links WHERE id = ?").bind(lead.demo_link_id).first();
  if (!link) return empty;
  const key = signingKey(env);
  const bots = includeBots ? 1 : 0;
  const totals = await db.prepare("SELECT COUNT(*) AS visits, COALESCE(SUM(demo_opens), 0) AS opens, COALESCE(SUM(enquired), 0) AS enquiries FROM demo_journeys WHERE link_id = ? AND (? = 1 OR bot = 0)").bind(link.id, bots).first();
  const rows = await all(db, "SELECT id, first_seen_at, last_seen_at, human, bot, discipline, vibe, colour, company, demo_opens, enquired, device, country FROM demo_journeys WHERE link_id = ? AND (? = 1 OR bot = 0) ORDER BY last_seen_at DESC, id LIMIT ?", [link.id, bots, JOURNEY_LIMIT]);
  return {
    link: { id: link.id, url: key ? `${origin}/d/${await tokenForLinkId(key, link.id)}` : null, label: link.label, revoked_at: link.revoked_at },
    summary: { opens: totals.opens, visits: totals.visits, enquiries: totals.enquiries },
    journeys: rows.map((j) => ({ id: j.id, first_seen_at: j.first_seen_at, last_seen_at: j.last_seen_at, human: flag(j.human) && !flag(j.bot), bot: flag(j.bot), discipline: j.discipline, vibe: j.vibe, colour: j.colour, company: j.company, demo_opens: j.demo_opens, enquired: flag(j.enquired), device: j.device, country: j.country })),
  };
}

async function detail(url, env, id, origin, now) {
  const db = env.PORTAL_DB;
  const lead = await getLead(db, id);
  if (!lead) return json({ error: "not_found" }, 404);
  const [contacts, messages, timeline] = await Promise.all([
    all(db, "SELECT id, type, value, source, source_url, eligibility, eligibility_note, opted_out_at FROM outreach_contacts WHERE lead_id = ? ORDER BY id", [lead.id]),
    all(db, "SELECT id, kind, approach, subject, status, is_test, sent_at, delivered_at, error FROM outreach_messages WHERE lead_id = ? ORDER BY created_at DESC, rowid DESC", [lead.id]),
    all(db, `SELECT at, type, detail FROM outreach_events WHERE lead_id = ? ORDER BY at DESC, id DESC LIMIT ${TIMELINE_LIMIT}`, [lead.id]),
  ]);
  const mode = sendingMode(env);
  return json({
    lead: await leadOut(env, lead, now), contacts,
    message: await messageView(env, lead, await currentMessage(db, lead.id), origin, now),
    messages: messages.map((m) => ({ ...m, is_test: flag(m.is_test) })),
    approaches: APPROACHES,
    demo: await demoSection(env, lead, origin, url.searchParams.get("bots") === "1", now),
    timeline, sending: { mode: mode.mode, blocked_reason: mode.blocked ? mode.blocked[1] : null },
    tracking: await trackingReady(db, now.getTime()), call_queue: await callQueueReady(db, now.getTime()),
  });
}

/* ---------- Writes ---------- */

const idList = (v, max) => Array.isArray(v) && v.length >= 1 && v.length <= max && v.every((x) => typeof x === "string" && LEAD_ID.test(x)) ? [...new Set(v)] : null;

async function bulk(body, env, principal, ctx) {
  if (!["approve", "dismiss", "queue_call", "clear_call"].includes(body.action)) return bad("action");
  const ids = idList(body.ids, 50);
  if (!ids) return bad("ids");
  if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 200)) return bad("reason");
  const results = [];
  for (const id of ids) {
    try {
      const r = body.action === "approve" ? await approveLead(env, id, principal, ctx)
        : body.action === "queue_call" ? await queueCall(env, id, { call_on: body.call_on, note: body.note }, ctx)
        : body.action === "clear_call" ? await clearCall(env, id, {}, ctx)
        : await dismissLead(env, id, body.reason, ctx);
      results.push(r.ok ? { id, ok: true } : { id, ok: false, error: r.error });
    } catch (e) {
      console.error("admin leads bulk error:", e && e.message);
      results.push({ id, ok: false, error: "server_error" });
    }
  }
  return json({ results });
}

async function patch(body, env, id, ctx) {
  const db = env.PORTAL_DB;
  const lead = await getLead(db, id);
  if (!lead) return json({ error: "not_found" }, 404);
  const sets = [], params = [];
  if ("notes" in body) {
    if (body.notes !== null && (typeof body.notes !== "string" || body.notes.length > 4000)) return bad("notes");
    sets.push("notes = ?"); params.push(body.notes === null ? null : cleanMultiline(body.notes, 4000) || null);
  }
  if ("next_action_note" in body) {
    if (body.next_action_note !== null && (typeof body.next_action_note !== "string" || body.next_action_note.length > 200)) return bad("next_action_note");
    sets.push("next_action_note = ?"); params.push(body.next_action_note === null ? null : clean(body.next_action_note, 200) || null);
  }
  if (!sets.length) return bad("notes");
  await db.prepare(`UPDATE outreach_leads SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`).bind(...params, ctx.at, lead.id).run();
  return json({ lead: await leadOut(env, await getLead(db, id), new Date(ctx.at)) });
}

/** Wraps a lifecycle result that returns a lead. */
async function leadResult(env, r, ctx, status = 200) {
  return r.ok ? json({ lead: await leadOut(env, r.lead, new Date(ctx.at)) }, status) : failure(r);
}

async function leadAction(name, body, env, principal, id, ctx) {
  switch (name) {
    case "approve": { const r = await approveLead(env, id, principal, ctx); return leadResult(env, r, ctx); }
    case "dismiss": {
      if (body.reason !== undefined && body.reason !== null && (typeof body.reason !== "string" || body.reason.length > 200)) return bad("reason");
      return leadResult(env, await dismissLead(env, id, body.reason, ctx), ctx);
    }
    case "reopen": return leadResult(env, await reopenLead(env, id, ctx), ctx);
    case "status": {
      if (!["replied", "won", "optout"].includes(body.status)) return bad("status");
      return leadResult(env, await markLead(env, id, body.status, ctx), ctx);
    }
    case "draft": {
      if (body.approach !== undefined && body.approach !== null && typeof body.approach !== "string") return bad("approach");
      const r = await draftMessage(env, id, body.approach || undefined, ctx);
      return r.ok ? json({ message: await messageView(env, await getLead(env.PORTAL_DB, id), r.message, ctx.origin, new Date(ctx.at)) }) : failure(r);
    }
    case "followup": {
      const r = await draftFollowup(env, id, ctx);
      return r.ok ? json({ message: await messageView(env, await getLead(env.PORTAL_DB, id), r.message, ctx.origin, new Date(ctx.at)) }) : failure(r);
    }
    default: return json({ error: "not_found" }, 404);
  }
}

async function contactAdd(body, env, id, ctx) {
  if (body.type !== "email" && body.type !== "phone") return bad("type");
  if (typeof body.value !== "string" || !body.value.trim() || body.value.length > 254) return bad("value");
  if (body.source_url !== undefined && body.source_url !== null && (typeof body.source_url !== "string" || body.source_url.length > 500)) return bad("source_url");
  const r = await addContact(env, id, { type: body.type, value: body.value, source_url: body.source_url }, ctx);
  return r.ok ? json({ contact: publicContact(r.contact) }, 201) : failure(r);
}
const publicContact = (c) => ({ id: c.id, type: c.type, value: c.value, source: c.source, source_url: c.source_url, eligibility: c.eligibility, eligibility_note: c.eligibility_note, opted_out_at: c.opted_out_at });

async function messageAction(name, method, body, env, id, ctx) {
  const view = async (r) => (r.ok ? json({ message: await messageView(env, await getLead(env.PORTAL_DB, id), r.message, ctx.origin, new Date(ctx.at)) }) : failure(r));
  if (name === "") {
    if (method !== "PUT") return notAllowed("PUT");
    if (typeof body.subject !== "string") return bad("subject");
    if (typeof body.body !== "string") return bad("body");
    if (body.subject.length > 300) return bad("subject");
    if (body.body.length > 8000) return bad("body");
    if (body.contact_id !== undefined && body.contact_id !== null && !Number.isInteger(body.contact_id)) return bad("contact_id");
    return view(await editMessage(env, id, body, ctx));
  }
  if (method !== "POST") return notAllowed("POST");
  return view(name === "approve" ? await approveMessage(env, id, ctx) : await unapproveMessage(env, id, ctx));
}

async function sendPreview(body, env, ctx) {
  const ids = idList(body.ids, MAX_SEND);
  if (!ids) return bad("ids");
  return json(await previewSend(env, ids, ctx));
}

async function send(body, env, ctx) {
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > MAX_SEND) return bad("items");
  const seen = new Set();
  for (const it of body.items) {
    if (!it || typeof it !== "object" || typeof it.lead_id !== "string" || !LEAD_ID.test(it.lead_id) || typeof it.hash !== "string" || !/^[0-9a-f]{64}$/.test(it.hash) || seen.has(it.lead_id)) return bad("items");
    seen.add(it.lead_id);
  }
  return json({ results: await sendMessages(env, body.items.map((i) => ({ lead_id: i.lead_id, hash: i.hash })), ctx) });
}

/**
 * @param path pathname with the "/api/admin" prefix removed, e.g. "/leads/list"
 * @returns Response, or null if the path is not a leads route
 */
/** POST /recheck-sites { ids?: [leadId, ...up to RECHECK_BATCH] }: checks those leads' websites (or, without ids, the next leads still carrying the finder's unconfirmed "doesn't load" claim). */
async function recheckBody(body, env, now, ctx) {
  let ids = null;
  if (body.ids !== undefined) {
    if (!Array.isArray(body.ids) || !body.ids.length || body.ids.length > RECHECK_BATCH || !body.ids.every((i) => typeof i === "string" && LEAD_ID.test(i))) return bad("ids");
    ids = [...new Set(body.ids)];
  }
  return json(await recheckSites(env, { ids }, { now, fetch: ctx.siteFetch }));
}

/** The parts of the report the lead page draws (no scoring here: the score and components come from scoreLead). */
function seoView(lead) {
  const r = buildSeoReport(lead);
  return r ? { visibility: r.visibility, issues: r.issues.map((i) => ({ text: i.text, fix: i.fix })), competitor: r.competitor, recommendations: r.recommendations, reputation: r.reputation, lighthouse: r.lighthouse, maps: r.maps, organic: r.organic, psi_error: r.psiError } : null;
}

/** GET /leads/:id/seo-report (JSON: the report and its Markdown) or /seo-report.pdf. 404 when the lead has no stored assessment. */
async function seoReport(env, id, pdf, now) {
  const lead = await getLead(env.PORTAL_DB, id);
  if (!lead) return json({ error: "not_found" }, 404);
  const report = buildSeoReport(lead, now);
  if (!report) return json({ error: "no_assessment" }, 404);
  if (!pdf) return json({ report, markdown: reportMarkdown(report) }, 200, { "Cache-Control": "private, no-store" });
  const slug = (report.business.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lead").slice(0, 60);
  return new Response(renderSeoPdf(report, { exportedOn: now }), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="seo-assessment-${slug}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

/** POST /leads/:id/site-working { verified?: boolean }: "Mark as Working" (default) or take the mark off. */
async function siteWorking(body, env, id, ctx) {
  if (body.verified !== undefined && typeof body.verified !== "boolean") return bad("verified");
  const r = await markSiteWorking(env, id, { verified: body.verified !== false }, { now: new Date(ctx.at) });
  return r.ok ? json({ lead: await leadOut(env, r.lead, new Date(ctx.at)) }) : failure({ ...r, status: r.error === "not_found" ? 404 : 409 });
}

/** POST /leads/:id/contacted { method, note?, follow_up_on? }: "Mark as Contacted". POST /leads/:id/outreach { status, note?, follow_up_on? }: Replied, Interested, Not interested, Follow-up needed. */
async function outreachAction(action, body, env, id, ctx) {
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000)) return bad("note");
  if (body.follow_up_on !== undefined && body.follow_up_on !== null && typeof body.follow_up_on !== "string") return bad("follow_up_on");
  const r = action === "contacted"
    ? await logContact(env, id, { method: body.method, note: body.note, follow_up_on: body.follow_up_on }, ctx)
    : await updateOutreach(env, id, { status: body.status, note: body.note, follow_up_on: body.follow_up_on }, ctx);
  return leadResult(env, r, ctx);
}

/** POST /leads/:id/call { call_on, note? }: Queue Call (or reschedule). POST /leads/:id/call-clear { done? }: remove from the call queue. Separate from outreach and approval. */
async function callAction(action, body, env, id, ctx) {
  if (body.note !== undefined && body.note !== null && (typeof body.note !== "string" || body.note.length > 1000)) return bad("note");
  if (body.done !== undefined && typeof body.done !== "boolean") return bad("done");
  const r = action === "call" ? await queueCall(env, id, { call_on: body.call_on, note: body.note }, ctx) : await clearCall(env, id, { done: body.done === true }, ctx);
  return leadResult(env, r, ctx);
}

export async function handleLeadsApi(request, env, principal, path, deps = {}) {
  const m = path.match(/^\/leads(\/.*)?$/);
  if (!m) return null;
  const sub = (m[1] || "").replace(/\/+$/, "");
  const method = request.method, now = nowOf(deps), url = new URL(request.url);
  if (!env.PORTAL_DB) return sub === "/status" && method === "GET" ? status(env, now) : json({ error: "database_unavailable" }, 503);
  try {
    if (sub === "/status") return method === "GET" ? await status(env, now) : notAllowed("GET");
    const lead = sub.match(/^\/([^/]+)(?:\/(approve|dismiss|reopen|draft|followup|status|contacts|message|site-working|contacted|outreach|call|call-clear|seo-report|seo-report\.pdf)(?:\/(\d+|approve|unapprove))?)?$/);
    const fixed = sub.match(/^\/(sync|list|bulk|recheck-sites|send\/preview|send)$/);
    if (!fixed && !(lead && LEAD_ID.test(lead[1]))) return json({ error: "not_found" }, 404);
    if (!(await leadsReady(env.PORTAL_DB, now.getTime()))) return json({ error: "not_set_up", migration: MIGRATION }, 409);
    const ctx = { at: now.toISOString(), origin: url.origin, fetch: deps.fetch, siteFetch: deps.siteFetch };

    if (fixed) {
      const name = fixed[1];
      if (name === "list") return method === "GET" ? await list(url, env, now) : notAllowed("GET");
      if (method !== "POST") return notAllowed("POST");
      if (!sameOriginWrite(request)) return forbidden();
      if (name === "sync") return json(await syncFinder(env, { now }));
      const { body, response } = await readBody(request);
      if (response) return response;
      if (name === "bulk") return await bulk(body, env, principal, ctx);
      if (name === "recheck-sites") return await recheckBody(body, env, now, ctx);
      if (name === "send/preview") return await sendPreview(body, env, ctx);
      return await send(body, env, ctx);
    }

    const [, id, action, arg] = lead;
    if (action === "seo-report" || action === "seo-report.pdf") {
      if (arg) return json({ error: "not_found" }, 404);
      if (method !== "GET") return notAllowed("GET");
      return await seoReport(env, id, action === "seo-report.pdf", now);
    }
    if (!action) {
      if (method === "GET") return await detail(url, env, id, url.origin, now);
      if (method !== "PATCH") return notAllowed("GET, PATCH");
      if (!sameOriginWrite(request)) return forbidden();
      const { body, response } = await readBody(request);
      return response || (await patch(body, env, id, ctx));
    }
    if (action === "message") {
      if (arg && arg !== "approve" && arg !== "unapprove") return json({ error: "not_found" }, 404);
      if (method !== "PUT" && method !== "POST") return notAllowed(arg ? "POST" : "PUT");
      if (!sameOriginWrite(request)) return forbidden();
      const { body, response } = await readBody(request);
      return response || (await messageAction(arg || "", method, body, env, id, ctx));
    }
    if (arg && !(action === "contacts" && /^\d+$/.test(arg))) return json({ error: "not_found" }, 404);
    if (method !== "POST") return notAllowed("POST");
    if (!sameOriginWrite(request)) return forbidden();
    const { body, response } = await readBody(request);
    if (response) return response;
    if (action === "contacts") {
      if (!arg) return await contactAdd(body, env, id, ctx);
      if (body.eligibility !== "eligible") return bad("eligibility");
      const r = await confirmContact(env, id, Number(arg), ctx);
      return r.ok ? json({ contact: publicContact(r.contact) }) : failure(r);
    }
    if (action === "site-working") return await siteWorking(body, env, id, ctx);
    if (action === "contacted" || action === "outreach") return await outreachAction(action, body, env, id, ctx);
    if (action === "call" || action === "call-clear") return await callAction(action, body, env, id, ctx);
    return await leadAction(action, body, env, principal, id, ctx);
  } catch (err) {
    console.error("admin leads api error:", err && err.message);
    forgetLeadsReady(env.PORTAL_DB);
    return json({ error: "database_unavailable" }, 503);
  }
}
