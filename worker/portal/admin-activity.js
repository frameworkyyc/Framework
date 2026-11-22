/**
 * Framework Admin: the client activity feed and the read/dismissed state of Admin's notifications. Behind Cloudflare Access and ADMIN_EMAILS like every Admin route.
 *
 * Events are never invented: the feed is built from rows the portal already writes to `activity_log` when a CLIENT acts (a support request or reply, a Branding request, a request in
 * the request area, a brand file upload, a website update approved or rejected, a website task answered, feedback, a profile change, a joined invitation). Staff actions, page views and
 * sign-ins are not in it. Only the events listed in EVENTS are ever read, so nothing else in the log can reach the page. Nothing older than 30 days is shown and nothing is back-filled.
 * Bursts of the same event for one client (several files uploaded in a row) are one entry with a count (the newest event stands for the group).
 *
 * State (new, read, dismissed) is kept WITHOUT a new table: Admin's own marks are appended to `activity_log` as internal, organization-less rows (actor_type 'admin'):
 * `admin.activity.read` / `admin.activity.dismissed` / `admin.activity.unread` (entity_type 'activity', entity_id = the event id) and `admin.attention.dismissed` /
 * `admin.attention.restored` (entity_type 'attention', entity_id = the notification key, detail { fp } = a fingerprint of what was dismissed). The newest mark wins; history is never
 * deleted. A dismissed "Needs attention" notification comes back as soon as its fingerprint changes (a new occurrence). Marks are shared by every admin and are never client-visible
 * (no organization, internal visibility, and not in the activity allow-list of the dashboard).
 *
 *   GET  /activity         { available, generatedAt, events: [...], unread, actionNeeded, attention: { dismissed: { key: fingerprint } } }   read-only (readOnlyDb)
 *   POST /activity/state   { scope: "event", ids: [uuid], state: "read" | "unread" | "dismissed" }  or  { scope: "attention", key, fingerprint, state: "dismissed" | "restored" }
 */
import { readOnlyDb } from "./admin-clients.js";
import { recordActivity } from "./repo/activity.js";
import { UUID } from "./repo/common.js";
import { json, err, sameOriginWrite, readJson } from "./admin-branding.js";

const enc = encodeURIComponent;
const DAY = 86400000;
const WINDOW_DAYS = 30, MAX_EVENTS = 80, GROUP_GAP_MS = 10 * 60000;

/** What each client event means for Admin: the words, whether it needs a response ("action") or is just news ("info"), and where to go. */
export const EVENTS = Object.freeze({
  "support.request.created": { label: "sent a support or change request", kind: "action", href: (e) => `/admin/support/${enc(e.org)}/${enc(e.entity)}` },
  "support.message.client": { label: "replied on a support request", kind: "action", href: (e) => `/admin/support/${enc(e.org)}/${enc(e.entity)}` },
  "service.requested": { label: "requested a Branding service", kind: "action", href: (e) => `/admin/clients/${enc(e.org)}/branding` },
  "request.created": { label: "submitted a new request", kind: "action", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "request.message.client": { label: "replied on a request", kind: "action", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "request.revision": { label: "asked for changes to a design", kind: "action", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "request.quote.declined": { label: "declined a quote", kind: "action", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "request.approved": { label: "approved a design", kind: "info", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "request.cancelled": { label: "cancelled a request", kind: "info", href: (e) => `/admin/requests/${enc(e.org)}/${enc(e.entity)}` },
  "website.update.rejected": { label: "sent revision notes on a website update", kind: "action", href: (e) => `/admin/clients/${enc(e.org)}/websites` },
  "website.update.approved": { label: "approved a website update", kind: "info", href: (e) => `/admin/clients/${enc(e.org)}/websites` },
  "website.task.responded": { label: "answered a website task", kind: "action", href: (e) => `/admin/clients/${enc(e.org)}/websites` },
  "brand.upload.created": { label: "uploaded a brand file", kind: "info", href: (e) => `/admin/clients/${enc(e.org)}/branding` },
  "feedback.submitted": { label: "sent feedback about the portal", kind: "info", href: () => "/admin/feedback/portal" },
  "profile.updated": { label: "updated their Business Profile", kind: "info", href: (e) => `/admin/clients/${enc(e.org)}/profile` },
  "invitation.accepted": { label: "joined the portal", kind: "info", href: (e) => `/admin/clients/${enc(e.org)}/access` },
});
const ACTIONS = Object.keys(EVENTS);
const KEY = /^[a-z0-9][a-z0-9._:-]{0,63}$/;
const FP = /^[A-Za-z0-9._:|,-]{0,80}$/;

/** The newest mark per entity: Map(entity_id -> { action, fp }). Marks are append-only, so the last one in time order wins. */
function foldMarks(rows) {
  const m = new Map();
  for (const r of rows) {
    let fp = ""; try { fp = (JSON.parse(r.detail || "{}").fp) || ""; } catch { /* no fingerprint */ }
    m.set(r.entity_id, { action: r.action, fp: String(fp) });
  }
  return m;
}

/** Collapses a burst: the same action for the same client (and entity, when the event has one) within ten minutes is one entry; the newest stands for the group. */
export function groupEvents(rows) {
  const out = [];
  for (const r of rows) { // newest first
    const key = `${r.organization_id}|${r.action}|${["support.request.created", "request.created"].includes(r.action) ? r.entity_id : ""}`;
    const g = out.find((x) => x._key === key && Math.abs(Date.parse(x.at) - Date.parse(r.created_at)) <= GROUP_GAP_MS);
    if (g) { g.count += 1; continue; }
    out.push({ _key: key, id: r.id, org: r.organization_id, entity: r.entity_id, action: r.action, at: r.created_at, orgName: r.org_name, count: 1 });
  }
  return out;
}

export async function handleActivityApi(request, env, principal, path) {
  if (path !== "/activity" && path !== "/activity/state") return null;
  if (path === "/activity") {
    if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (!env.PORTAL_DB) return json({ available: false });
    const rdb = readOnlyDb(env.PORTAL_DB);
    const now = new Date();
    const since = new Date(now.getTime() - WINDOW_DAYS * DAY).toISOString();
    let rows, marks;
    try {
      rows = (await rdb.prepare(
        `SELECT a.id, a.organization_id, o.name AS org_name, a.action, a.entity_id, a.created_at FROM activity_log a JOIN organizations o ON o.id = a.organization_id WHERE a.actor_type = 'client' AND a.action IN (${ACTIONS.map(() => "?").join(",")}) AND a.created_at >= ? AND o.status <> 'archived' ORDER BY a.created_at DESC, a.id LIMIT 400`,
      ).bind(...ACTIONS, since).all()).results;
      marks = (await rdb.prepare("SELECT action, entity_id, detail FROM activity_log WHERE actor_type = 'admin' AND (action LIKE 'admin.activity.%' OR action LIKE 'admin.attention.%') ORDER BY created_at, id LIMIT 5000").all()).results;
    } catch { return json({ available: false }); }
    const state = foldMarks(marks.filter((m) => m.action.startsWith("admin.activity.")));
    const events = groupEvents(rows).slice(0, MAX_EVENTS).map((g) => {
      const def = EVENTS[g.action];
      const mark = state.get(g.id);
      const st = mark && mark.action === "admin.activity.dismissed" ? "dismissed" : mark && mark.action === "admin.activity.read" ? "read" : "new";
      return { id: g.id, organizationId: g.org, clientName: g.orgName, action: g.action, label: def.label, kind: def.kind, href: def.href({ org: g.org, entity: g.entity }), at: g.at, count: g.count, state: st };
    });
    const dismissed = {};
    for (const [key, v] of foldMarks(marks.filter((m) => m.action.startsWith("admin.attention."))))
      if (v.action === "admin.attention.dismissed") dismissed[key] = v.fp;
    const live = events.filter((e) => e.state !== "dismissed");
    return json({ available: true, generatedAt: now.toISOString(), events, unread: live.filter((e) => e.state === "new").length, actionNeeded: live.filter((e) => e.state === "new" && e.kind === "action").length, attention: { dismissed } });
  }
  // POST /activity/state
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405, { Allow: "POST" });
  if (env.PORTAL_ADMIN_WRITES !== "1") return err(403, "writes_disabled", "Changes are not enabled on this deployment.");
  if (!sameOriginWrite(request)) return err(403, "forbidden", "This request was not accepted.");
  if (!env.PORTAL_DB) return err(503, "portal_unavailable", "The portal database is not available.");
  const read = await readJson(request, ["scope", "ids", "key", "fingerprint", "state"]);
  if (read.response) return read.response;
  const b = read.body, actor = principal && principal.email;
  if (!actor) return err(403, "forbidden", "This request was not accepted.");
  const mark = (action, entityType, entityId, detail) => recordActivity(env.PORTAL_DB, { organizationId: null, actorType: "admin", actorRef: actor, action, entityType, entityId, detail, visibility: "internal" });
  try {
    if (b.scope === "event") {
      const act = { read: "admin.activity.read", unread: "admin.activity.unread", dismissed: "admin.activity.dismissed" }[b.state];
      if (!act) return err(422, "invalid_state", "Choose read, unread or dismissed.");
      if (!Array.isArray(b.ids) || !b.ids.length || b.ids.length > 50 || !b.ids.every((i) => typeof i === "string" && UUID.test(i))) return err(422, "invalid_ids", "Choose up to 50 events.");
      // only an event that exists, and is one of the feed's, can be marked
      const found = (await readOnlyDb(env.PORTAL_DB).prepare(`SELECT id FROM activity_log WHERE actor_type = 'client' AND action IN (${ACTIONS.map(() => "?").join(",")}) AND id IN (${b.ids.map(() => "?").join(",")})`).bind(...ACTIONS, ...b.ids).all()).results.map((r) => r.id);
      for (const id of found) await mark(act, "activity", id);
      return json({ ok: true, marked: found.length });
    }
    if (b.scope === "attention") {
      const act = { dismissed: "admin.attention.dismissed", restored: "admin.attention.restored" }[b.state];
      if (!act) return err(422, "invalid_state", "Choose dismissed or restored.");
      if (typeof b.key !== "string" || !KEY.test(b.key)) return err(422, "invalid_key", "That notification can’t be dismissed.");
      const fp = typeof b.fingerprint === "string" ? b.fingerprint : "";
      if (!FP.test(fp)) return err(422, "invalid_fingerprint", "That notification can’t be dismissed.");
      await mark(act, "attention", b.key, { fp });
      return json({ ok: true });
    }
    return err(422, "invalid_scope", "Nothing to change.");
  } catch (e) {
    console.error("admin activity api error:", e && e.name);
    return err(500, "server_error", "Something went wrong. Nothing was changed.");
  }
}
