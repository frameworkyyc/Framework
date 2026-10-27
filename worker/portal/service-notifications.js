/**
 * Client Services email notifications. The data layers queue a row in service_notifications in the SAME transaction as the change that deserves an email
 * (repo/support.js, repo/invoices.js); this module sends them. The order of things is what keeps the two safe from each other:
 *
 *   - Saving never waits for, or depends on, an email. Dispatch runs after the change is committed, never throws, and a failure only updates the queued row.
 *   - No duplicates: a row is CLAIMED with a compare-and-swap on its attempt counter (only one worker can win), at most one pending row exists per
 *     (organization, audience, event, request) so a burst is one email, every provider call carries an idempotency key derived from the row, and a sent row is
 *     never touched again.
 *   - Quick replies are throttled: at most one reply email per request, per side, every REPLY_THROTTLE_MS.
 *   - Delivery is automatic: each change dispatches right after it is saved, and every Admin page load and client Home visit sweeps anything still unsent (with a growing
 *     wait between attempts), so no one has to press a button. (A scheduled trigger cannot do this job: cron triggers run only on the production deployment.)
 *   - Retries are bounded (MAX_ATTEMPTS). A row that cannot be sent because email is not configured is left pending without using an attempt.
 *
 * Who is emailed: Framework (ASSESSMENT_NOTIFY_TO, default hello@frameworkco.ca) when a client sends a request or replies; the client when Framework replies, sends
 * a quote, or publishes an invoice (invoices: owners only; requests: the person who sent it and the owners). Never for private notes or routine status changes.
 * Client emails only go to addresses on the same approved-recipient list as invitations (PORTAL_INVITE_ALLOWLIST) while that controlled test is in force.
 * Client emails never contain request text, amounts or invoice numbers: they say that something is waiting and link to the portal.
 */
import { sendEmail, emailConfig, notifyRecipient } from "../assessment.js";
import { checkRecipient } from "./invite-recipients.js";
import { isoTime } from "./repo/common.js";
import { CATEGORY_LABEL } from "./repo/support.js";

export const MAX_ATTEMPTS = 5;
/** A conversation emails each side at most once in this window: a burst of quick replies is one email, and the portal (and the Admin badge) show the rest. */
export const REPLY_THROTTLE_MS = 10 * 60 * 1000;
const THROTTLED = ["request_client_reply", "request_staff_reply"];
const BATCH = 10;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const oneLine = (s, n = 120) => String(s ?? "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, n);

/* ------------------------------------------------------------------ message building (pure) */

/** @param n {event, audience}  @param d {org: {name, slug, id}, request?: {id, title, category}, invoice?: {id}}  @param origin the portal origin */
export function buildEmail(n, d, origin) {
  const portal = `${origin}/portal/o/${encodeURIComponent(d.org.slug)}`;
  const admin = (p) => `${origin}/admin${p}`;
  let subject, lines, link, why;
  if (n.audience === "staff") {
    const who = oneLine(d.org.name, 80), what = d.request ? `${CATEGORY_LABEL[d.request.category] || "Request"}: ${oneLine(d.request.title, 120)}` : "";
    link = admin(`/support/${d.org.id}/${d.request.id}`);
    if (n.event === "request_submitted") { subject = `New support request from ${who}`; lines = [`${who} sent a new request.`, what]; }
    else { subject = `${who} replied to a support request`; lines = [`${who} replied to a request.`, what]; }
    why = "You receive this because you are on Framework's support notifications.";
  } else if (n.event === "invoice_published") {
    subject = "A new invoice is ready in your Framework portal"; lines = ["A new invoice has been added to your Framework client portal."]; link = `${portal}/services/invoices`;
    why = `You receive this because you are an owner of ${oneLine(d.org.name, 80)} in the Framework client portal.`;
  } else if (n.event === "request_status") {
    subject = "Framework sent you a quote"; lines = ["Framework has sent a quote for one of your requests.", "Nothing goes ahead until you approve it."]; link = `${portal}/services/requests/${d.request.id}`;
    why = `You receive this because you sent, or are an owner of the organization that sent, a request in the Framework client portal (${oneLine(d.org.name, 80)}).`;
  } else {
    subject = "Framework replied to your request"; lines = ["There is a new reply on one of your requests."]; link = `${portal}/services/requests/${d.request.id}`;
    why = `You receive this because you sent, or are an owner of the organization that sent, a request in the Framework client portal (${oneLine(d.org.name, 80)}).`;
  }
  lines = lines.filter(Boolean);
  const text = `${lines.join("\n")}\n\nOpen it: ${link}\n\n${why}\nFramework · Calgary, Alberta`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;color:#0a0a0a;line-height:1.5">${lines.map((l) => `<p>${esc(l)}</p>`).join("")}<p><a href="${esc(link)}" style="color:#0a0a0a;font-weight:bold">Open it in the portal</a></p><p style="color:#5c5c5c;font-size:13px">${esc(why)}<br>Framework · Calgary, Alberta</p></div>`;
  return { subject, text, html, link };
}

/* ------------------------------------------------------------------ data the message needs */

async function context(db, n) {
  const org = await db.prepare("SELECT id, name, slug FROM organizations WHERE id = ?").bind(n.organization_id).first();
  if (!org) return null;
  if (n.entity_type === "support_request") {
    const r = await db.prepare("SELECT id, title, category, submitted_by FROM support_requests WHERE id = ? AND organization_id = ?").bind(n.entity_id, n.organization_id).first();
    return r ? { org, request: r } : null;
  }
  const i = await db.prepare("SELECT id FROM invoices WHERE id = ? AND organization_id = ? AND archived_at IS NULL AND published_at IS NOT NULL").bind(n.entity_id, n.organization_id).first();
  return i ? { org, invoice: i } : null;
}

/** The addresses a CLIENT notice may go to: active owners (and, for a request, the person who sent it), filtered by the approved-recipient list. Sorted, so idempotency keys are stable. */
async function clientRecipients(env, db, n, ctx) {
  const submitter = ctx.request ? ctx.request.submitted_by : "";
  const rows = (await db.prepare("SELECT DISTINCT u.email FROM memberships m JOIN portal_users u ON u.id = m.user_id WHERE m.organization_id = ? AND m.status = 'active' AND u.status = 'active' AND (m.role = 'owner' OR u.id = ?) ORDER BY u.email").bind(n.organization_id, submitter).all()).results;
  return rows.map((r) => r.email).filter((e) => checkRecipient(env, e).ok);
}

/* ------------------------------------------------------------------ sending */

const mark = (db, id, status, error, at) => db.prepare("UPDATE service_notifications SET status = ?, last_error = ?, sent_at = ? WHERE id = ?").bind(status, error ? String(error).slice(0, 200) : null, status === "sent" ? at : null, id).run();

/**
 * Sends up to `limit` pending notices. Never throws. Returns counts: { sent, failed, retry, skipped, pending, configured }.
 * A notice that failed before is retried only after a growing wait (attempt number squared, in minutes, counted from when it was queued), unless `force` is set
 * (the Admin "send now" button). Fresh notices are always eligible at once.
 * @param o { db, now?, fetch?, limit?, force? }
 */
export async function processNotifications(env, { db, now = new Date(), fetch: fetchImpl = fetch, limit = BATCH, force = false } = {}) {
  const out = { sent: 0, failed: 0, retry: 0, skipped: 0, pending: 0, configured: true };
  try {
    if (!db) return out;
    if (!emailConfig(env).ok) {
      out.configured = false; // leave everything pending: nothing burns an attempt until email can actually be sent
      out.pending = (await db.prepare("SELECT count(*) AS n FROM service_notifications WHERE status = 'pending'").first()).n;
      return out;
    }
    const origin = new URL(String(env.PORTAL_BASE_URL || "")).origin;
    const rows = (await db.prepare("SELECT id, organization_id, audience, event, entity_type, entity_id, attempts FROM service_notifications WHERE status = 'pending' AND attempts < ? AND (? = 1 OR attempts = 0 OR (julianday(?) - julianday(created_at)) * 1440.0 >= attempts * attempts) ORDER BY created_at, id LIMIT ?").bind(MAX_ATTEMPTS, force ? 1 : 0, isoTime(now), limit).all()).results;
    for (const n of rows) {
      // claim: only the worker whose UPDATE changes the row may send it
      const claim = await db.prepare("UPDATE service_notifications SET attempts = attempts + 1 WHERE id = ? AND status = 'pending' AND attempts = ?").bind(n.id, n.attempts).run();
      if (!claim.meta || claim.meta.changes !== 1) continue;
      const at = isoTime(now);
      if (THROTTLED.includes(n.event)) {
        const recent = await db.prepare("SELECT 1 AS x FROM service_notifications WHERE organization_id = ? AND audience = ? AND event = ? AND entity_id = ? AND status = 'sent' AND sent_at > ? AND id <> ? LIMIT 1").bind(n.organization_id, n.audience, n.event, n.entity_id, isoTime(new Date(now.getTime() - REPLY_THROTTLE_MS)), n.id).first();
        if (recent) { await mark(db, n.id, "skipped", "throttled", at); out.skipped++; continue; }
      }
      const ctx = await context(db, n);
      if (!ctx) { await mark(db, n.id, "skipped", "entity_missing", at); out.skipped++; continue; }
      const to = n.audience === "staff" ? [notifyRecipient(env)] : await clientRecipients(env, db, n, ctx);
      if (!to.length) { await mark(db, n.id, "skipped", "no_allowed_recipient", at); out.skipped++; continue; }
      const mail = buildEmail(n, { org: ctx.org, request: ctx.request, invoice: ctx.invoice }, origin);
      let problem = null;
      for (let i = 0; i < to.length && !problem; i++) {
        const r = await sendEmail(env, { to: to[i], subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: `svc-${n.id}-${i}` }, fetchImpl);
        if (!r.ok) problem = r.error;
      }
      if (!problem) { await mark(db, n.id, "sent", null, at); out.sent++; }
      else if (n.attempts + 1 >= MAX_ATTEMPTS) { await mark(db, n.id, "failed", problem, at); out.failed++; }
      else { await db.prepare("UPDATE service_notifications SET last_error = ? WHERE id = ?").bind(String(problem).slice(0, 200), n.id).run(); out.retry++; }
    }
    out.pending = (await db.prepare("SELECT count(*) AS n FROM service_notifications WHERE status = 'pending'").first()).n;
  } catch (err) {
    console.error("service notifications error:", err && err.name); // never the message
  }
  return out;
}

/**
 * Runs the sender after the response is decided. With a platform waitUntil the request is not held up at all; without one (tests) it is awaited. Either way
 * a failure here can only ever change a notification row.
 */
export function dispatchNotifications(env, deps = {}) {
  const p = Promise.resolve().then(() => processNotifications(env, { db: env.PORTAL_DB, now: deps.now, fetch: deps.fetch })).catch(() => {});
  if (typeof deps.waitUntil === "function") { try { deps.waitUntil(p); } catch { /* the platform refused: the row stays pending for the next dispatch */ } return Promise.resolve(); }
  return p;
}

/** Counts for Admin: how many notices wait, failed for good, or were skipped. Cross-tenant by design (Framework Admin only). */
export async function notificationTotals(db) {
  const r = await db.prepare("SELECT COALESCE(sum(status = 'pending'), 0) AS pending, COALESCE(sum(status = 'failed'), 0) AS failed, COALESCE(sum(status = 'skipped'), 0) AS skipped, COALESCE(sum(status = 'sent'), 0) AS sent FROM service_notifications").first();
  return { pending: r.pending, failed: r.failed, skipped: r.skipped, sent: r.sent };
}
