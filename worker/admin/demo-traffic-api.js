/**
 * Framework Admin — demo traffic API (/api/admin/demo-traffic/…). Private reporting on the demo landing page's tracking links and visits
 * (worker/demo-traffic.js, worker/DEMO-TRAFFIC.md). Only ever called after authenticateAdmin() succeeded (see router.js).
 * Reads and writes the three demo_* tables of PORTAL_DB (proposed migration 0021; "not set up" until it is applied). All SQL is parameterised.
 * Link labels and company names are user text: they are returned as data (the admin app sets them as text) and neutralised in the CSV.
 */
import { json, csvCell } from "../shared.js";
import { RETENTION_DAYS, LINK_ID, JOURNEY_ID, signingKey, tokenForLinkId, newLinkId, tablesReady, forgetReady } from "../demo-traffic.js";

const MAX_ROWS_EXPORT = 50000;
const DEFAULT_DAYS = 30;
const JOURNEY_LIMIT = 200;

const clean = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const bad = (field) => json({ error: "validation_failed", field }, 422);
const notAllowed = (allow) => json({ error: "method_not_allowed" }, 405, { Allow: allow });

/** State-changing requests must come from our own pages: same Origin plus a custom header (CSRF defence). */
function sameOriginWrite(request) {
  const origin = request.headers.get("Origin");
  return !!origin && origin === new URL(request.url).origin && request.headers.get("X-Framework-Admin") === "1";
}

/** days (1 to 180, default 30), bots (0|1, default 0), link (all | direct | 16-hex id), limit. Returns { filter } or { error }. */
function readFilter(url, now) {
  const q = url.searchParams;
  let days = DEFAULT_DAYS;
  if (q.has("days")) { if (!/^\d{1,3}$/.test(q.get("days")) || Number(q.get("days")) < 1 || Number(q.get("days")) > RETENTION_DAYS) return { error: "days" }; days = Number(q.get("days")); }
  const botsRaw = q.get("bots");
  if (botsRaw !== null && botsRaw !== "0" && botsRaw !== "1") return { error: "bots" };
  const link = q.get("link") || "all";
  if (link !== "all" && link !== "direct" && !LINK_ID.test(link)) return { error: "link" };
  let limit = 100;
  if (q.has("limit")) { if (!/^\d{1,3}$/.test(q.get("limit")) || Number(q.get("limit")) < 1) return { error: "limit" }; limit = Math.min(JOURNEY_LIMIT, Number(q.get("limit"))); }
  return { filter: { since: new Date(now.getTime() - days * 86400000).toISOString(), bots: botsRaw === "1" ? 1 : 0, link, limit, days } };
}

// The journey-level WHERE: period (last seen), bots, and which link. `j` is the demo_journeys alias.
const journeyWhere = (f) => {
  const sql = ["j.last_seen_at >= ?", "(? = 1 OR j.bot = 0)"], params = [f.since, f.bots];
  if (f.link === "direct") sql.push("j.link_id IS NULL");
  else if (f.link !== "all") { sql.push("j.link_id = ?"); params.push(f.link); }
  return { sql: sql.join(" AND "), params };
};

const flag = (v) => v === 1 || v === true;
const journeyOut = (r) => ({ id: r.id, source: r.source, link_id: r.link_id, link_label: r.link_label ?? null, first_seen_at: r.first_seen_at, last_seen_at: r.last_seen_at, human: flag(r.human) && !flag(r.bot), bot: flag(r.bot), bot_reason: r.bot_reason, country: r.country, device: r.device, discipline: r.discipline, vibe: r.vibe, colour: r.colour, company: r.company, demo_opens: r.demo_opens, enquired: flag(r.enquired) });

const all = async (db, sql, params = []) => (await db.prepare(sql).bind(...params).all()).results || [];

async function status(env) {
  return json({ ready: await tablesReady(env.PORTAL_DB), secret: !!signingKey(env), retention_days: RETENTION_DAYS, migration: "0021_demo_traffic.sql" });
}

async function top(db, column, w) {
  const rows = await all(db, `SELECT j.${column} AS label, COUNT(*) AS count FROM demo_journeys j WHERE ${w.sql} AND j.${column} IS NOT NULL AND (? = 1 OR j.human = 1) GROUP BY j.${column} ORDER BY count DESC, label LIMIT 10`, [...w.params, w.bots]);
  return rows.map((r) => ({ label: r.label, count: r.count }));
}

async function summary(env, f) {
  const db = env.PORTAL_DB, w = journeyWhere(f);
  const opens = await db.prepare("SELECT COALESCE(SUM(CASE WHEN e.bot = 0 THEN 1 ELSE 0 END), 0) AS human, COALESCE(SUM(CASE WHEN e.bot = 1 THEN 1 ELSE 0 END), 0) AS bots FROM demo_events e WHERE e.type = 'link_open' AND e.at >= ?" + (f.link === "all" ? "" : f.link === "direct" ? " AND 0" : " AND e.journey_id IN (SELECT id FROM demo_journeys WHERE link_id = ?)"))
    .bind(...(f.link === "all" || f.link === "direct" ? [f.since] : [f.since, f.link])).first();
  const totals = await db.prepare(`SELECT COUNT(*) AS journeys, COALESCE(SUM(CASE WHEN j.human = 1 AND j.bot = 0 THEN 1 ELSE 0 END), 0) AS verified, COALESCE(SUM(CASE WHEN j.company IS NOT NULL THEN 1 ELSE 0 END), 0) AS companies, COALESCE(SUM(j.demo_opens), 0) AS opens, COALESCE(SUM(j.enquired), 0) AS enquiries FROM demo_journeys j WHERE ${w.sql}`).bind(...w.params).first();
  return json({
    days: f.days, bots: f.bots,
    link_opens: opens.human + opens.bots, likely_bots: opens.bots,
    journeys: totals.journeys, verified: totals.verified, companies_applied: totals.companies, demo_opens: totals.opens, enquiries: totals.enquiries,
    discipline: await top(db, "discipline", { ...w, bots: f.bots }), vibe: await top(db, "vibe", { ...w, bots: f.bots }), colour: await top(db, "colour", { ...w, bots: f.bots }),
  });
}

async function linkRows(env, request, bots) {
  const key = signingKey(env), origin = new URL(request.url).origin;
  const count = (extra) => `(SELECT COUNT(*) FROM demo_events e JOIN demo_journeys j ON j.id = e.journey_id WHERE j.link_id = l.id AND e.type = 'link_open' AND ${extra})`;
  const rows = await all(env.PORTAL_DB,
    `SELECT l.id, l.label, l.note, l.created_at, l.created_by, l.revoked_at,
      ${count("(? = 1 OR e.bot = 0)")} AS link_opens, ${count("e.bot = 1")} AS link_opens_bots,
      (SELECT COUNT(*) FROM demo_journeys j WHERE j.link_id = l.id AND j.human = 1 AND j.bot = 0) AS verified_visits,
      (SELECT COUNT(*) FROM demo_journeys j WHERE j.link_id = l.id AND j.enquired = 1 AND (? = 1 OR j.bot = 0)) AS enquiries,
      (SELECT MAX(j.last_seen_at) FROM demo_journeys j WHERE j.link_id = l.id AND (? = 1 OR j.bot = 0)) AS last_activity
     FROM demo_links l ORDER BY l.created_at DESC, l.id LIMIT 500`, [bots, bots, bots]);
  return Promise.all(rows.map(async (r) => ({ ...r, url: key ? `${origin}/d/${await tokenForLinkId(key, r.id)}` : null })));
}

async function createLink(request, env, principal) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  const label = clean(body && body.label, 120);
  if (!label) return bad("label");
  const note = clean(body && body.note, 500) || null;
  const key = signingKey(env);
  if (!key) return json({ error: "secret_missing" }, 409);
  const id = newLinkId(), at = new Date().toISOString();
  await env.PORTAL_DB.prepare("INSERT INTO demo_links (id, label, note, created_at, created_by) VALUES (?, ?, ?, ?, ?)").bind(id, label, note, at, String(principal && principal.email || "admin").slice(0, 254)).run();
  return json({ link: { id, label, note, created_at: at, created_by: principal && principal.email || "admin", revoked_at: null, url: `${new URL(request.url).origin}/d/${await tokenForLinkId(key, id)}`, link_opens: 0, link_opens_bots: 0, verified_visits: 0, enquiries: 0, last_activity: null } }, 201);
}

async function revokeLink(env, id) {
  const row = await env.PORTAL_DB.prepare("SELECT id, revoked_at FROM demo_links WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  const at = row.revoked_at || new Date().toISOString();
  if (!row.revoked_at) await env.PORTAL_DB.prepare("UPDATE demo_links SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(at, id).run();
  return json({ ok: true, revoked_at: at });
}

// The privacy-request path: removes the link, every journey that came through it and their events. Events are deleted explicitly as well as by the cascade.
async function deleteLink(request, env, id) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid_json" }, 400); }
  if (!body || body.confirm !== true) return bad("confirm");
  const row = await env.PORTAL_DB.prepare("SELECT id FROM demo_links WHERE id = ?").bind(id).first();
  if (!row) return json({ error: "not_found" }, 404);
  const n = await env.PORTAL_DB.prepare("SELECT COUNT(*) AS journeys, (SELECT COUNT(*) FROM demo_events WHERE journey_id IN (SELECT id FROM demo_journeys WHERE link_id = ?)) AS events FROM demo_journeys WHERE link_id = ?").bind(id, id).first();
  await env.PORTAL_DB.batch([
    env.PORTAL_DB.prepare("DELETE FROM demo_events WHERE journey_id IN (SELECT id FROM demo_journeys WHERE link_id = ?)").bind(id),
    env.PORTAL_DB.prepare("DELETE FROM demo_journeys WHERE link_id = ?").bind(id),
    env.PORTAL_DB.prepare("DELETE FROM demo_links WHERE id = ?").bind(id),
  ]);
  return json({ ok: true, deleted: { journeys: n.journeys, events: n.events } });
}

async function journeys(env, f) {
  const w = journeyWhere(f);
  const rows = await all(env.PORTAL_DB, `SELECT j.*, l.label AS link_label FROM demo_journeys j LEFT JOIN demo_links l ON l.id = j.link_id WHERE ${w.sql} ORDER BY j.last_seen_at DESC, j.id LIMIT ?`, [...w.params, f.limit]);
  return json({ journeys: rows.map(journeyOut), limit: f.limit });
}

async function oneJourney(env, id) {
  const j = await env.PORTAL_DB.prepare("SELECT j.*, l.label AS link_label FROM demo_journeys j LEFT JOIN demo_links l ON l.id = j.link_id WHERE j.id = ?").bind(id).first();
  if (!j) return json({ error: "not_found" }, 404);
  const events = await all(env.PORTAL_DB, "SELECT at, type, value, bot FROM demo_events WHERE journey_id = ? ORDER BY at, id", [id]);
  return json({ journey: journeyOut(j), events: events.map((e) => ({ at: e.at, type: e.type, value: e.value, bot: flag(e.bot) })) });
}

const CSV_COLUMNS = ["timestamp_utc", "journey_id", "source", "prospect_label", "verified_human", "likely_bot", "bot_reason", "country", "device", "event", "value", "discipline", "vibe", "colour", "company"];

async function exportCsv(env, f) {
  // Here the period applies to the event time (not the journey's last visit), and a bot journey or a bot event is left out unless asked for.
  const where = `e.at >= ? AND (? = 1 OR (j.bot = 0 AND e.bot = 0))` + (f.link === "direct" ? " AND j.link_id IS NULL" : f.link !== "all" ? " AND j.link_id = ?" : "");
  const params = [f.since, f.bots, ...(f.link !== "all" && f.link !== "direct" ? [f.link] : [])];
  const counted = await env.PORTAL_DB.prepare(`SELECT COUNT(*) AS n FROM demo_events e JOIN demo_journeys j ON j.id = e.journey_id WHERE ${where}`).bind(...params).first();
  const rows = await all(env.PORTAL_DB, `SELECT e.at, e.type, e.value, j.id AS journey_id, j.source, j.human, j.bot, j.bot_reason, j.country, j.device, j.discipline, j.vibe, j.colour, j.company, l.label AS prospect_label
    FROM demo_events e JOIN demo_journeys j ON j.id = e.journey_id LEFT JOIN demo_links l ON l.id = j.link_id WHERE ${where} ORDER BY e.at DESC, e.id DESC LIMIT ${MAX_ROWS_EXPORT}`, params);
  const yes = (v) => (v ? "yes" : "no");
  const lines = [CSV_COLUMNS.join(",")].concat(rows.map((r) => [r.at, r.journey_id, r.source, r.prospect_label, yes(flag(r.human) && !flag(r.bot)), yes(flag(r.bot)), r.bot_reason, r.country, r.device, r.type, r.value, r.discipline, r.vibe, r.colour, r.company].map(csvCell).join(",")));
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="framework-demo-traffic-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
      "X-Content-Type-Options": "nosniff",
      ...(counted.n > MAX_ROWS_EXPORT ? { "X-Export-Truncated": "1" } : {}),
    },
  });
}

/**
 * @param path pathname with the "/api/admin" prefix removed, e.g. "/demo-traffic/links"
 * @returns Response, or null if the path is not a demo-traffic route
 */
export async function handleDemoTrafficApi(request, env, principal, path, deps = {}) {
  const m = path.match(/^\/demo-traffic(\/.*)?$/);
  if (!m) return null;
  const sub = (m[1] || "").replace(/\/+$/, "");
  const method = request.method, now = deps.now || new Date();
  if (!env.PORTAL_DB) return sub === "/status" && method === "GET" ? json({ ready: false, secret: !!signingKey(env), retention_days: RETENTION_DAYS, migration: "0021_demo_traffic.sql" }) : json({ error: "database_unavailable" }, 503);
  try {
    if (sub === "/status") return method === "GET" ? await status(env) : notAllowed("GET");
    const route = sub.match(/^\/(summary|links|journeys|export\.csv)(?:\/([^/]+?)(\/revoke)?)?$/);
    if (!route) return json({ error: "not_found" }, 404);
    const [, name, id, revoke] = route;
    if (!(await tablesReady(env.PORTAL_DB, now.getTime()))) return json({ error: "not_set_up", migration: "0021_demo_traffic.sql" }, 409);

    if (name === "links") {
      if (!id) {
        if (method === "GET") { const f = readFilter(new URL(request.url), now); return f.error ? bad(f.error) : json({ links: await linkRows(env, request, f.filter.bots) }); }
        if (method === "POST") return sameOriginWrite(request) ? await createLink(request, env, principal) : json({ error: "forbidden" }, 403);
        return notAllowed("GET, POST");
      }
      if (!LINK_ID.test(id)) return json({ error: "not_found" }, 404);
      if (revoke) return method !== "POST" ? notAllowed("POST") : sameOriginWrite(request) ? await revokeLink(env, id) : json({ error: "forbidden" }, 403);
      if (method === "DELETE") return sameOriginWrite(request) ? await deleteLink(request, env, id) : json({ error: "forbidden" }, 403);
      return notAllowed("DELETE");
    }
    if (method !== "GET") return notAllowed("GET");
    if (name === "journeys" && id) return JOURNEY_ID.test(id) ? await oneJourney(env, id) : json({ error: "not_found" }, 404);
    if (id) return json({ error: "not_found" }, 404);
    const f = readFilter(new URL(request.url), now);
    if (f.error) return bad(f.error);
    if (name === "summary") return await summary(env, f.filter);
    if (name === "journeys") return await journeys(env, f.filter);
    return await exportCsv(env, f.filter);
  } catch (err) {
    console.error("admin demo traffic api error:", err && err.message);
    forgetReady(env.PORTAL_DB);
    return json({ error: "database_unavailable" }, 503);
  }
}
