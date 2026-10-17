/**
 * Framework — Free Online Presence Assessment request form (POST /api/assessment, GET /api/assessment/config).
 *
 * The assessment itself is prepared by hand; this only receives the request. Flow:
 *   validate → spam checks (honeypot, timing, Turnstile when configured) → rate limit → store in D1 (durable)
 *   → email Framework → email the applicant a confirmation.
 * The applicant is told "received" only if the request was stored in D1 or the notification email was accepted
 * by the email provider; if neither worked they get an honest failure and their inputs stay in the form.
 *
 * Configuration (Worker variables / secrets; none of this is ever sent to the browser except the two public IDs):
 *   RESEND_API_KEY        secret   email provider key (Resend). Email is skipped until this AND ASSESSMENT_FROM are set.
 *   ASSESSMENT_FROM       var      verified sender, e.g.  Framework <hello@frameworkco.ca>
 *   ASSESSMENT_NOTIFY_TO  var      where requests are sent (default hello@frameworkco.ca)
 *   TURNSTILE_SECRET      secret   Cloudflare Turnstile secret key (enables server-side verification)
 *   TURNSTILE_SITE_KEY    var      Turnstile site key (public; shown to the browser via /api/assessment/config)
 *   META_PIXEL_ID         var      Meta Pixel ID (public; the page loads the pixel only with visitor consent)
 *   IP_HASH_SALT          secret   optional salt for the hashed IP used by the rate limiter
 */

import { json } from "./shared.js";

const MAX_BODY_BYTES = 16 * 1024;
const MIN_FILL_MS = 1200; // faster than a human can fill the form: ask them to try again
const IP_LIMIT_PER_HOUR = 5;
const SITE_LIMIT_PER_10_MIN = 40;
const DEFAULT_NOTIFY_TO = "hello@frameworkco.ca";
const EMAIL_TIMEOUT_MS = 8000;

export const CONCERNS = [
  "Customers have trouble finding us online.",
  "Our website is outdated.",
  "We want to attract more customers.",
  "We want to understand how we compare with competitors.",
  "We’re unsure how effective our website is.",
  "Just curious about our online presence.",
  "Other.",
];

const LIMITS = {
  business_name: 160,
  contact_name: 120,
  location: 120,
  industry: 120,
  phone: 40,
  services: 600,
  service_area: 300,
  profiles: 1200,
  additional_info: 3000,
};

const TRACKING_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"];

/* ------------------------------------------------------------------ validation */

// Strip control characters (keeping line breaks in long text), normalise line endings, trim.
const clean = (value, { multiline = false } = {}) => {
  if (typeof value !== "string") return "";
  let s = value.replace(/\r\n?/g, "\n");
  s = multiline ? s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "") : s.replace(/[\u0000-\u001F\u007F]/g, " ");
  return s.replace(/[‪-‮⁦-⁩]/g, "").trim();
};

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[A-Za-z]{2,}$/;

export function validEmail(value) {
  return value.length <= 254 && EMAIL_RE.test(value) && !value.includes("..") && !/^\.|\.@|@\./.test(value);
}

/** Accepts "example.com", "www.example.com/page" or a full http(s) URL. Returns the normalised URL, or null. */
export function normaliseWebsite(input) {
  let s = clean(input);
  if (!s || s.length > 300 || /\s/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    if (!/^https?:\/\//i.test(s)) return null;
  } else if (/^(javascript|data|vbscript|file|mailto|tel|blob):/i.test(s)) {
    return null;
  } else {
    s = "https://" + s;
  }
  let url;
  try { url = new URL(s); } catch { return null; }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || /^\d+(\.\d+){3}$/.test(host) || host.includes(":")) return null; // no IPs / localhost
  const labels = host.split(".");
  if (labels.length < 2 || labels.some((l) => !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(l))) return null;
  if (!/^([a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels[labels.length - 1])) return null;
  return url.href;
}

function validPhone(value) {
  if (!/^[0-9+()\-.\s]+(ext\.?\s?\d{1,6})?$/i.test(value)) return false;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, errors: Record<string,string> }}
 */
export function validateAssessment(body) {
  const b = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const errors = {};
  const data = {};

  const required = (key, message) => {
    const v = clean(b[key]);
    if (!v) errors[key] = message;
    else if (v.length > LIMITS[key]) errors[key] = "That’s a little long. Please shorten it.";
    data[key] = v;
  };
  const optional = (key, multiline = false) => {
    const v = clean(b[key], { multiline });
    if (v.length > LIMITS[key]) errors[key] = "That’s a little long. Please shorten it.";
    data[key] = v;
  };

  required("business_name", "Enter your business name.");
  required("contact_name", "Enter your name.");
  required("location", "Enter your city and province.");
  required("industry", "Tell us what type of business you run.");

  const site = normaliseWebsite(b.website);
  if (!clean(b.website)) errors.website = "Enter your website address.";
  else if (!site) errors.website = "Enter a valid website address, like yourcompany.ca.";
  data.website = site || clean(b.website);

  const email = clean(b.email);
  if (!email) errors.email = "Enter your business email address.";
  else if (!validEmail(email)) errors.email = "Enter an email address like name@company.ca.";
  data.email = email;

  optional("phone");
  if (data.phone && !validPhone(data.phone)) errors.phone = "Enter a phone number we can reach you on, or leave this blank.";
  optional("services");
  optional("service_area");
  optional("profiles", true);
  optional("additional_info", true);

  const concern = clean(b.concern);
  if (concern && !CONCERNS.includes(concern)) errors.concern = "Choose one of the listed options, or leave this blank.";
  data.concern = concern;

  if (b.privacy_ack !== true) errors.privacy_ack = "Please confirm this so we can prepare your assessment.";
  data.privacy_ack = b.privacy_ack === true;
  data.marketing_opt_in = b.marketing_opt_in === true;

  const id = typeof b.submission_id === "string" ? b.submission_id.trim() : "";
  if (!/^[A-Za-z0-9-]{16,64}$/.test(id)) errors.submission_id = "Missing submission id.";
  data.submission_id = id;

  // Attribution (campaign tracking). Optional, length-capped, never trusted for anything but the email/records.
  const tracking = {};
  const rawTracking = b.tracking && typeof b.tracking === "object" ? b.tracking : {};
  for (const k of TRACKING_KEYS) {
    const v = clean(rawTracking[k]).slice(0, 150);
    if (v) tracking[k] = v;
  }
  data.tracking = tracking;
  data.landing = clean(b.landing).slice(0, 200);
  data.referrer = clean(b.referrer).slice(0, 200);

  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, data };
}

/* ------------------------------------------------------------------ email content */

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Subjects are single-line: strip anything that could inject headers or break the line.
const headerSafe = (s, max = 140) => String(s).replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

function formatTimestamp(date) {
  let local = "";
  try {
    local = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Edmonton",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date) + " (Calgary)";
  } catch { /* Intl unavailable: UTC only */ }
  return { iso: date.toISOString(), local };
}

/** The structured notification to Framework. `text` is laid out so it can be pasted straight into the assessment workflow. */
export function buildNotification(data, meta = {}) {
  const when = formatTimestamp(meta.now || new Date());
  const dash = (v) => (v ? v : "—");
  const t = data.tracking || {};

  const business = [
    ["Business name", data.business_name],
    ["Website", data.website],
    ["City / Province", data.location],
    ["Industry / type of business", data.industry],
    ["Primary services", dash(data.services)],
    ["Service area", dash(data.service_area)],
    ["Social / Google Business Profile links", dash(data.profiles)],
  ];
  const contact = [
    ["Contact name", data.contact_name],
    ["Email", data.email],
    ["Phone", dash(data.phone)],
  ];
  const concerns = [
    ["Main concern", dash(data.concern)],
    ["Additional information", dash(data.additional_info)],
  ];
  const source = [
    ["Submitted", when.local ? `${when.local} · ${when.iso}` : when.iso],
    ["Landing page", dash(data.landing)],
    ["Referrer", dash(data.referrer)],
    ...TRACKING_KEYS.map((k) => [k, dash(t[k])]),
  ];
  const consent = [
    ["Privacy acknowledgement", data.privacy_ack ? "Yes" : "No"],
    ["Marketing emails opt-in", data.marketing_opt_in ? "Yes (opted in)" : "No"],
    ["Request ID", data.submission_id],
  ];

  const block = (title, rows) =>
    `${title}\n${"-".repeat(title.length)}\n` +
    rows.map(([k, v]) => (String(v).includes("\n") ? `${k}:\n${String(v).replace(/^/gm, "  ")}` : `${k}: ${v}`)).join("\n");

  const workflow = [
    `Business: ${data.business_name}`,
    `Website: ${data.website}`,
    `Location: ${data.location}`,
    `Industry: ${data.industry}`,
    `Services: ${dash(data.services)}`,
    `Service area: ${dash(data.service_area)}`,
    `Profiles: ${dash(data.profiles).replace(/\n+/g, " | ")}`,
    `Main concern: ${dash(data.concern)}`,
    `Notes: ${dash(data.additional_info).replace(/\n+/g, " ")}`,
  ].join("\n");

  const text = [
    "NEW ONLINE PRESENCE ASSESSMENT REQUEST",
    "",
    block("BUSINESS", business),
    "",
    block("CONTACT", contact),
    "",
    block("CONCERNS", concerns),
    "",
    block("SOURCE & TIMING", source),
    "",
    block("CONSENT", consent),
    "",
    "COPY INTO THE ASSESSMENT WORKFLOW",
    "---------------------------------",
    workflow,
    "",
  ].join("\n");

  const table = (title, rows) =>
    `<h2 style="font:600 13px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5C5C5C;margin:28px 0 8px">${escapeHtml(title)}</h2>` +
    `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #0A0A0A">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="width:36%;padding:9px 12px 9px 0;border-bottom:1px solid #E0E0E0;font:600 13px Arial,sans-serif;vertical-align:top;color:#5C5C5C">${escapeHtml(k)}</td>` +
          `<td style="padding:9px 0;border-bottom:1px solid #E0E0E0;font:14px/1.5 Arial,sans-serif;vertical-align:top;color:#0A0A0A;white-space:pre-wrap">${escapeHtml(v)}</td></tr>`,
      )
      .join("") +
    `</table>`;

  const html =
    `<div style="max-width:640px;margin:0 auto;padding:24px;font-family:Arial,sans-serif;color:#0A0A0A">` +
    `<p style="font:700 20px Arial,sans-serif;margin:0 0 4px">New assessment request</p>` +
    `<p style="font:14px Arial,sans-serif;color:#5C5C5C;margin:0">${escapeHtml(data.business_name)}</p>` +
    table("Business", business) +
    table("Contact", contact) +
    table("Concerns", concerns) +
    table("Source & timing", source) +
    table("Consent", consent) +
    `<h2 style="font:600 13px Arial,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#5C5C5C;margin:28px 0 8px">Copy into the assessment workflow</h2>` +
    `<pre style="margin:0;padding:14px;background:#F5F5F5;border:1px solid #E0E0E0;font:13px/1.55 Menlo,Consolas,monospace;white-space:pre-wrap;word-break:break-word">${escapeHtml(workflow)}</pre>` +
    `</div>`;

  return { subject: headerSafe(`New Assessment Request | ${data.business_name}`), text, html };
}

/** The short branded confirmation sent to the applicant. No delivery deadline is promised. */
export function buildConfirmation() {
  const paragraphs = [
    "Thank you for requesting a complimentary Online Presence Assessment from Framework.",
    "We’ve received your business information.",
    "Our team will review your online presence and prepare a personalized assessment outlining your current strengths and potential opportunities for improvement.",
    "Once complete, your report will be sent to the email address you provided.",
  ];
  const text = paragraphs.join("\n\n") + "\n\nFRAMEWORK\nframeworkco.ca\n";
  const html =
    `<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,sans-serif;color:#0A0A0A;font-size:16px;line-height:1.6">` +
    paragraphs.map((p) => `<p style="margin:0 0 18px">${escapeHtml(p)}</p>`).join("") +
    `<p style="margin:32px 0 0;padding-top:20px;border-top:1px solid #0A0A0A;font:700 14px Arial,sans-serif;letter-spacing:.2em">FRAMEWORK</p>` +
    `<p style="margin:4px 0 0;font:14px Arial,sans-serif;color:#5C5C5C"><a href="https://frameworkco.ca" style="color:#5C5C5C">frameworkco.ca</a></p>` +
    `</div>`;
  return { subject: "Your Assessment Request | Framework", text, html };
}

/* ------------------------------------------------------------------ providers */

export const emailConfigured = (env) => Boolean(env.RESEND_API_KEY && env.ASSESSMENT_FROM);

/** Send one email through Resend. Resolves true only if the provider accepted it. Never throws. */
export async function sendEmail(env, { to, replyTo, subject, text, html }, fetchImpl = fetch) {
  if (!emailConfigured(env)) return false;
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.ASSESSMENT_FROM, to: [to], reply_to: replyTo, subject, text, html }),
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    if (!res.ok) console.error("assessment email rejected:", res.status);
    return res.ok;
  } catch (err) {
    console.error("assessment email failed:", err && err.name);
    return false;
  }
}

/** @returns "ok" | "failed" | "unavailable" */
async function verifyTurnstile(token, ip, env, fetchImpl) {
  try {
    const form = new FormData();
    form.append("secret", env.TURNSTILE_SECRET);
    form.append("response", token);
    if (ip) form.append("remoteip", ip);
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
    });
    if (!res.ok) return "unavailable";
    const out = await res.json();
    return out && out.success === true ? "ok" : "failed";
  } catch {
    return "unavailable";
  }
}

/* ------------------------------------------------------------------ storage */

let schemaReady = false;

export async function ensureAssessmentSchema(db) {
  if (schemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS assessment_requests (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        business_name TEXT, website TEXT, contact_name TEXT, email TEXT, location TEXT, industry TEXT,
        phone TEXT, services TEXT, service_area TEXT, profiles TEXT, concern TEXT, additional_info TEXT,
        privacy_ack INTEGER NOT NULL DEFAULT 0,
        marketing_opt_in INTEGER NOT NULL DEFAULT 0,
        tracking TEXT, landing TEXT, referrer TEXT,
        ip_hash TEXT,
        notify_status TEXT NOT NULL DEFAULT 'pending',
        confirm_status TEXT NOT NULL DEFAULT 'pending'
      )`,
    )
    .run();
  schemaReady = true;
}

export function resetAssessmentSchemaForTests() {
  schemaReady = false;
}

async function hashIp(ip, env) {
  if (!ip) return "";
  const bytes = new TextEncoder().encode(`${env.IP_HASH_SALT || "framework-assessment"}:${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------------ handlers */

export function handleAssessmentConfig(env) {
  return json(
    { turnstileSiteKey: env.TURNSTILE_SITE_KEY || null, metaPixelId: env.META_PIXEL_ID || null },
    200,
    { "Cache-Control": "public, max-age=60", "X-Robots-Tag": "noindex" },
  );
}

/**
 * @param deps  { fetch, now } — injectable for tests
 */
export async function handleAssessmentSubmit(request, env, deps = {}) {
  const fetchImpl = deps.fetch || fetch;
  const now = deps.now || new Date();

  // Same-origin only: browsers send Origin on cross-site POSTs.
  const origin = request.headers.get("Origin");
  if (origin && origin !== new URL(request.url).origin) return json({ error: "forbidden" }, 403);

  if (!(request.headers.get("Content-Type") || "").toLowerCase().includes("application/json")) {
    return json({ error: "unsupported_media_type" }, 415);
  }
  const declared = Number(request.headers.get("Content-Length") || 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "too_large" }, 413);

  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid_json" }, 400); }

  // Honeypot: real visitors never see this field. Pretend success so bots learn nothing.
  if (body && typeof body.hp === "string" && body.hp.trim() !== "") return json({ ok: true });

  const result = validateAssessment(body);
  if (!result.ok) return json({ error: "validation_failed", fields: result.errors }, 422);
  const data = result.data;

  if (!env.DB && !emailConfigured(env)) return json({ error: "not_configured" }, 503);

  const ip = request.headers.get("CF-Connecting-IP") || "";

  if (env.TURNSTILE_SECRET) {
    const token = typeof body.turnstile_token === "string" ? body.turnstile_token : "";
    if (!token) return json({ error: "verification_failed" }, 403);
    const outcome = await verifyTurnstile(token, ip, env, fetchImpl);
    if (outcome === "failed") return json({ error: "verification_failed" }, 403);
    if (outcome === "unavailable") return json({ error: "verification_unavailable" }, 503);
  }

  const elapsed = Number(body.elapsed_ms);
  if (Number.isFinite(elapsed) && elapsed < MIN_FILL_MS) return json({ error: "try_again" }, 429);

  let stored = false;
  let ipHash = "";
  if (env.DB) {
    try {
      await ensureAssessmentSchema(env.DB);

      // A retry of the same submission (double click, flaky network) is a harmless success: no second record or email.
      const existing = await env.DB.prepare("SELECT id FROM assessment_requests WHERE id = ?").bind(data.submission_id).first();
      if (existing) return json({ ok: true });

      ipHash = await hashIp(ip, env);
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
      const tenAgo = new Date(now.getTime() - 10 * 60 * 1000).toISOString();
      if (ipHash) {
        const mine = await env.DB.prepare("SELECT COUNT(*) AS n FROM assessment_requests WHERE ip_hash = ? AND created_at > ?").bind(ipHash, hourAgo).first();
        if (mine && mine.n >= IP_LIMIT_PER_HOUR) return json({ error: "try_again_later" }, 429, { "Retry-After": "3600" });
      }
      const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM assessment_requests WHERE created_at > ?").bind(tenAgo).first();
      if (recent && recent.n >= SITE_LIMIT_PER_10_MIN) return json({ error: "try_again_later" }, 429, { "Retry-After": "600" });

      await env.DB.prepare(
        `INSERT OR IGNORE INTO assessment_requests
          (id, created_at, business_name, website, contact_name, email, location, industry, phone, services, service_area,
           profiles, concern, additional_info, privacy_ack, marketing_opt_in, tracking, landing, referrer, ip_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          data.submission_id, now.toISOString(), data.business_name, data.website, data.contact_name, data.email, data.location,
          data.industry, data.phone || null, data.services || null, data.service_area || null, data.profiles || null,
          data.concern || null, data.additional_info || null, data.privacy_ack ? 1 : 0, data.marketing_opt_in ? 1 : 0,
          JSON.stringify(data.tracking), data.landing || null, data.referrer || null, ipHash || null,
        )
        .run();
      stored = true;
    } catch (err) {
      console.error("assessment store failed:", err && err.message);
    }
  }

  // Notify Framework. The confirmation to the applicant is a courtesy: its failure never fails the request.
  let notified = false;
  let confirmed = false;
  if (emailConfigured(env)) {
    const note = buildNotification(data, { now });
    notified = await sendEmail(
      env,
      { to: env.ASSESSMENT_NOTIFY_TO || DEFAULT_NOTIFY_TO, replyTo: data.email, subject: note.subject, text: note.text, html: note.html },
      fetchImpl,
    );
    const confirmation = buildConfirmation();
    confirmed = await sendEmail(
      env,
      { to: data.email, replyTo: env.ASSESSMENT_NOTIFY_TO || DEFAULT_NOTIFY_TO, subject: confirmation.subject, text: confirmation.text, html: confirmation.html },
      fetchImpl,
    );
  }

  if (stored) {
    try {
      await env.DB.prepare("UPDATE assessment_requests SET notify_status = ?, confirm_status = ? WHERE id = ?")
        .bind(emailConfigured(env) ? (notified ? "sent" : "failed") : "skipped", emailConfigured(env) ? (confirmed ? "sent" : "failed") : "skipped", data.submission_id)
        .run();
    } catch { /* status bookkeeping only */ }
  }

  // Accepted only if we truly hold the request: it is in D1, or Framework's inbox was notified.
  if (stored || notified) return json({ ok: true });
  return json({ error: "delivery_failed" }, 502);
}
