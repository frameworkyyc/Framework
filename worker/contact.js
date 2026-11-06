/**
 * Framework — website contact form (POST /api/contact).
 *
 * The contact form used to open the visitor's own email program and always showed "sent", so a visitor without a mail program lost the message
 * and nothing could be measured. It now sends the message through the website to Framework's inbox, with the assessment form's protections:
 *   same-origin only, JSON only, size limit → honeypot → validation → Cloudflare Turnstile (when configured) → minimum fill time → rate limit
 *   → email to Framework (Reply-To is the visitor).
 * No database is used and nothing new is stored: the message lives in Framework's inbox. The visitor is told "sent" only if the email provider
 * accepted the message; otherwise the browser gets an honest error and the page falls back to showing the email address.
 * Configuration is the assessment form's (RESEND_API_KEY, ASSESSMENT_FROM, ASSESSMENT_NOTIFY_TO, TURNSTILE_SITE_KEY / TURNSTILE_SECRET).
 */
import { json } from "./shared.js";
import { recordEnquiry, optedOut, JOURNEY_ID } from "./demo-traffic.js";
import { validEmail, emailConfigured, notifyRecipient, sendEmail, turnstileState, verifyTurnstile, readTextLimited, oneLine } from "./assessment.js";

const MAX_BODY_BYTES = 16 * 1024;
const MIN_FILL_MS = 1200;
const LIMITS = { name: 120, business: 160, project_type: 120, message: 3000 };

// Control characters out (keeping line breaks in the message), line endings normalised, trimmed, length-capped.
const clean = (v, max, multiline = false) => {
  let s = String(v == null ? "" : v).replace(/\r\n?/g, "\n");
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, " ");
  return (multiline ? s.replace(/[ \t]+\n/g, "\n") : s.replace(/\s+/g, " ")).trim().slice(0, max);
};

export function validateContact(body) {
  const b = body && typeof body === "object" ? body : {};
  const data = {
    name: clean(b.name, LIMITS.name), email: clean(b.email, 254).toLowerCase(), business: clean(b.business, LIMITS.business),
    project_type: clean(b.project_type, LIMITS.project_type), message: clean(b.message, LIMITS.message, true),
    page: clean(b.page, 100).replace(/[^\w\-/.]/g, ""),
  };
  const errors = {};
  if (!data.name) errors.name = "required";
  if (!data.email || !validEmail(data.email)) errors.email = "invalid";
  if (!data.message) errors.message = "required";
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildContactEmail(data, now = new Date()) {
  const rows = [["Name", data.name], ["Email", data.email], ["Business", data.business || "—"], ["Project type", data.project_type || "—"], ["Sent from", data.page ? "frameworkco.ca" + data.page : "frameworkco.ca/contact"], ["Received", now.toISOString().replace("T", " ").slice(0, 16) + " UTC"]];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n") + "\n\n" + data.message + "\n";
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#0a0a0a"><p><strong>New website enquiry</strong></p><table cellpadding="4" style="border-collapse:collapse">${rows
    .map(([k, v]) => `<tr><td style="color:#5c5c5c;padding-right:16px">${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table><p style="white-space:pre-wrap;border-left:3px solid #0a0a0a;padding-left:12px">${esc(data.message)}</p></div>`;
  return { subject: `New website enquiry — ${data.name}`.slice(0, 150), text, html };
}

/** @param deps { fetch, now } injectable for tests */
export async function handleContactSubmit(request, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();

  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) return json({ error: "unsupported_media_type" }, 415);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const raw = await readTextLimited(request, MAX_BODY_BYTES);
  if (raw === null) return json({ error: "too_large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  // Honeypot: a real visitor never sees this field. Pretend success so bots learn nothing.
  if (body && typeof body.hp === "string" && body.hp.trim() !== "") return json({ ok: true });

  const result = validateContact(body);
  if (!result.ok) return json({ error: "validation_failed", fields: result.errors }, 422);
  const data = result.data;

  if (!emailConfigured(env)) return json({ error: "not_configured" }, 503); // nowhere to send it: the page shows the email address instead

  const ip = request.headers.get("CF-Connecting-IP") || "";
  const turnstile = turnstileState(env);
  if (turnstile === "on") {
    const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
    if (!token) return json({ error: "verification_failed" }, 403);
    const outcome = await verifyTurnstile(token, ip, env, fetchImpl);
    if (outcome === "failed") return json({ error: "verification_failed" }, 403);
    if (outcome === "unavailable") return json({ error: "verification_unavailable" }, 503);
  }

  const elapsed = Number(body.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed < MIN_FILL_MS) return json({ error: "try_again" }, 429);

  // Abuse limit per network, when the platform limiter is bound (it is on Production and Staging; absent it simply does not limit).
  if (env.PORTAL_RATE_LIMITER && ip) {
    try {
      const { success } = await env.PORTAL_RATE_LIMITER.limit({ key: "contact:" + oneLine(ip, 64) });
      if (!success) return json({ error: "try_again_later" }, 429, { "Retry-After": "60" });
    } catch { /* a limiter fault must not block a genuine enquiry */ }
  }

  const mail = buildContactEmail(data, now);
  // A retry of the same submission (double click, flaky network) is a harmless success at the provider: same idempotency key.
  const key = typeof body.submission_id === "string" && /^[\w-]{8,64}$/.test(body.submission_id) ? "contact-" + body.submission_id : undefined;
  const sent = await sendEmail(env, { to: notifyRecipient(env), replyTo: data.email, subject: mail.subject, text: mail.text, html: mail.html, idempotencyKey: key }, fetchImpl);
  if (!sent.ok) { console.error("contact email not delivered:", sent.error); return json({ error: "delivery_failed" }, 502); }
  // Demo-page traffic: note that this journey sent an enquiry (the optional `journey` id from the demo page). Stores nothing from the form, and a failure here never changes the response.
  if (typeof body.journey === "string" && JOURNEY_ID.test(body.journey)) {
    try { if (!optedOut(request)) await recordEnquiry(env, body.journey, now); } catch { /* analytics must never affect the enquiry */ }
  }
  return json({ ok: true });
}
