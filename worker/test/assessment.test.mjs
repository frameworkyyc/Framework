// Run with:  node --test worker/test/*.mjs
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  validateAssessment, normaliseWebsite, validEmail, buildNotification, buildConfirmation,
  handleAssessmentSubmit, handleAssessmentConfig, resetAssessmentSchemaForTests,
} from "../assessment.js";

/** A D1-shaped wrapper over node:sqlite so the real SQL runs. */
const makeDb = () => {
  const db = new DatabaseSync(":memory:");
  return {
    raw: db,
    prepare(sql) {
      let args = [];
      const stmt = {
        bind: (...a) => { args = a; return stmt; },
        run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; },
        first: async () => db.prepare(sql).get(...args) ?? null,
        all: async () => ({ results: db.prepare(sql).all(...args) }),
      };
      return stmt;
    },
  };
};

const good = (over = {}) => ({
  business_name: "Summit Concrete Ltd.",
  website: "summitconcrete.ca",
  contact_name: "Alex Rivera",
  email: "alex@summitconcrete.ca",
  location: "Calgary, AB",
  industry: "Concrete contractor",
  phone: "(403) 555-0142",
  services: "Foundations, flatwork",
  service_area: "Calgary and area",
  profiles: "https://g.page/summit\nhttps://instagram.com/summit",
  concern: "Customers have trouble finding us online.",
  additional_info: "Mostly referrals so far.",
  privacy_ack: true,
  marketing_opt_in: false,
  submission_id: "11111111-2222-3333-4444-555555555555",
  elapsed_ms: 30000,
  hp: "",
  tracking: { utm_source: "instagram", utm_campaign: "assessment-oct" },
  landing: "/assessment?utm_source=instagram",
  referrer: "https://l.instagram.com",
  ...over,
});

const post = (body, headers = {}) =>
  new Request("https://frameworkco.ca/api/assessment", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://frameworkco.ca", "CF-Connecting-IP": "203.0.113.7", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** Records every outbound call (Resend / Turnstile) and answers per the supplied behaviour. */
const makeFetch = ({ resend = 200, turnstile = { success: true } } = {}) => {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("resend.com")) {
      const status = typeof resend === "function" ? resend(calls.filter((c) => c.url.includes("resend")).length) : resend;
      return new Response(JSON.stringify({ id: "x" }), { status });
    }
    if (String(url).includes("turnstile")) {
      if (turnstile === "down") throw new Error("network");
      return new Response(JSON.stringify(turnstile), { status: 200 });
    }
    throw new Error("unexpected fetch " + url);
  };
  impl.calls = calls;
  impl.emails = () => calls.filter((c) => c.url.includes("resend")).map((c) => JSON.parse(c.init.body));
  return impl;
};

const emailEnv = (over = {}) => ({ RESEND_API_KEY: "re_test_key", ASSESSMENT_FROM: "Framework <assessments@frameworkco.ca>", ...over });

beforeEach(() => resetAssessmentSchemaForTests());

/* ---------------------------------------------------------------- validation */

test("a complete valid request passes and normalises the website", () => {
  const r = validateAssessment(good());
  assert.equal(r.ok, true);
  assert.equal(r.data.website, "https://summitconcrete.ca/");
  assert.equal(r.data.marketing_opt_in, false);
});

test("required fields are enforced with inline messages", () => {
  const r = validateAssessment({ privacy_ack: false });
  assert.equal(r.ok, false);
  for (const k of ["business_name", "website", "contact_name", "email", "location", "industry", "privacy_ack", "submission_id"]) {
    assert.ok(r.errors[k], `expected an error for ${k}`);
  }
  assert.equal(r.errors.phone, undefined); // optional
});

test("email validation", () => {
  for (const ok of ["a@b.co", "first.last@sub.example.ca", "a+tag@example.com"]) assert.equal(validEmail(ok), true, ok);
  for (const bad of ["a@b", "a b@c.com", "@c.com", "a@.com", "a..b@c.com", "a@b..com", "<x>@c.com", "a@b.c", "x".repeat(250) + "@c.com"]) {
    assert.equal(validEmail(bad), false, bad);
  }
});

test("website normalisation accepts real addresses and rejects unsafe or invalid ones", () => {
  assert.equal(normaliseWebsite("example.com"), "https://example.com/");
  assert.equal(normaliseWebsite("www.example.ca/services"), "https://www.example.ca/services");
  assert.equal(normaliseWebsite("http://example.com"), "http://example.com/");
  assert.equal(normaliseWebsite("HTTPS://Example.COM:8443/x?y=1"), "https://example.com:8443/x?y=1");
  for (const bad of ["", "nodots", "javascript:alert(1)", "ftp://example.com", "https://localhost", "http://127.0.0.1", "http://[::1]",
    "exa mple.com", "https://user:pw@example.com", "example.c", "-bad.com", "a..b.com", "data:text/html,hi", "mailto:a@b.com"]) {
    assert.equal(normaliseWebsite(bad), null, bad);
  }
});

test("invalid optional values and over-long text are rejected; concern must be a listed option", () => {
  assert.ok(validateAssessment(good({ phone: "call me" })).errors.phone);
  assert.ok(validateAssessment(good({ concern: "Something else" })).errors.concern);
  assert.ok(validateAssessment(good({ business_name: "x".repeat(500) })).errors.business_name);
  assert.equal(validateAssessment(good({ concern: "", phone: "" })).ok, true);
});

test("control characters are stripped and tracking is capped to known keys", () => {
  const r = validateAssessment(good({ business_name: "Acme\r\nBcc: evil@x.com", tracking: { utm_source: "a".repeat(400), evil: "x" } }));
  assert.equal(r.ok, true);
  assert.ok(!/[\r\n]/.test(r.data.business_name));
  assert.equal(r.data.tracking.utm_source.length, 150);
  assert.equal(r.data.tracking.evil, undefined);
});

/* ---------------------------------------------------------------- emails */

test("notification email contains every field, timing, tracking and a copyable block", () => {
  const d = validateAssessment(good({ marketing_opt_in: true })).data;
  const n = buildNotification(d, { now: new Date("2026-10-20T20:03:00Z") });
  assert.equal(n.subject, "New Assessment Request | Summit Concrete Ltd.");
  for (const needle of ["Summit Concrete Ltd.", "https://summitconcrete.ca/", "Alex Rivera", "alex@summitconcrete.ca", "Calgary, AB",
    "Concrete contractor", "(403) 555-0142", "Foundations, flatwork", "Calgary and area", "g.page/summit", "trouble finding us",
    "Mostly referrals", "2026-10-20T20:03:00.000Z", "utm_source: instagram", "utm_campaign: assessment-oct", "/assessment?utm_source=instagram",
    "Yes (opted in)", "COPY INTO THE ASSESSMENT WORKFLOW"]) {
    assert.ok(n.text.includes(needle), "text missing: " + needle);
  }
  assert.ok(n.html.includes("Summit Concrete Ltd."));
});

test("notification escapes HTML and cannot inject subject headers", () => {
  const d = validateAssessment(good({ business_name: "<script>alert(1)</script>\nBcc: x@evil.com", additional_info: "<img src=x onerror=1>" })).data;
  const n = buildNotification(d);
  assert.ok(!n.html.includes("<script>") && !n.html.includes("<img"));
  assert.ok(n.html.includes("&lt;script&gt;"));
  assert.ok(!/[\r\n]/.test(n.subject));
});

test("confirmation email matches the approved copy and promises no deadline", () => {
  const c = buildConfirmation();
  assert.equal(c.subject, "Your Assessment Request | Framework");
  assert.ok(c.text.startsWith("Thank you for requesting a complimentary Online Presence Assessment from Framework."));
  assert.ok(c.text.includes("We’ve received your business information."));
  assert.ok(c.text.trimEnd().endsWith("FRAMEWORK\nframeworkco.ca"));
  assert.ok(!/\b(hours?|days?|within|by (monday|friday)|business day)\b/i.test(c.text));
});

/* ---------------------------------------------------------------- endpoint */

test("success: stored in D1, Framework notified at info@, applicant confirmed", async () => {
  const db = makeDb(); const f = makeFetch();
  const res = await handleAssessmentSubmit(post(good()), { DB: db, ...emailEnv() }, { fetch: f, now: new Date("2026-10-20T20:03:00Z") });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  const row = db.raw.prepare("SELECT * FROM assessment_requests").get();
  assert.equal(row.business_name, "Summit Concrete Ltd.");
  assert.equal(row.notify_status, "sent");
  assert.equal(row.confirm_status, "sent");
  assert.ok(row.ip_hash && !row.ip_hash.includes("203.0.113.7"));
  const [note, confirm] = f.emails();
  assert.deepEqual(note.to, ["info@frameworkco.ca"]);
  assert.equal(note.reply_to, "alex@summitconcrete.ca");
  assert.equal(note.from, "Framework <assessments@frameworkco.ca>");
  assert.match(note.subject, /^New Assessment Request \| Summit Concrete Ltd\.$/);
  assert.deepEqual(confirm.to, ["alex@summitconcrete.ca"]);
  assert.equal(confirm.subject, "Your Assessment Request | Framework");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer re_test_key");
});

test("notify address is configurable", async () => {
  const f = makeFetch();
  await handleAssessmentSubmit(post(good()), { DB: makeDb(), ...emailEnv({ ASSESSMENT_NOTIFY_TO: "team@frameworkco.ca" }) }, { fetch: f });
  assert.deepEqual(f.emails()[0].to, ["team@frameworkco.ca"]);
});

test("a repeated submission id is a harmless success: one record, one set of emails", async () => {
  const db = makeDb(); const f = makeFetch();
  const env = { DB: db, ...emailEnv() };
  assert.equal((await handleAssessmentSubmit(post(good()), env, { fetch: f })).status, 200);
  assert.equal((await handleAssessmentSubmit(post(good()), env, { fetch: f })).status, 200);
  assert.equal(db.raw.prepare("SELECT COUNT(*) AS n FROM assessment_requests").get().n, 1);
  assert.equal(f.emails().length, 2);
});

test("email not configured: request is stored and reported as received", async () => {
  const db = makeDb(); const f = makeFetch();
  const res = await handleAssessmentSubmit(post(good()), { DB: db }, { fetch: f });
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 0);
  assert.equal(db.raw.prepare("SELECT notify_status FROM assessment_requests").get().notify_status, "skipped");
});

test("email provider fails but the request is safely stored: accepted, flagged for follow-up", async () => {
  const db = makeDb();
  const res = await handleAssessmentSubmit(post(good()), { DB: db, ...emailEnv() }, { fetch: makeFetch({ resend: 500 }) });
  assert.equal(res.status, 200);
  const row = db.raw.prepare("SELECT notify_status, confirm_status FROM assessment_requests").get();
  assert.equal(row.notify_status, "failed");
});

test("nothing could be saved or sent: honest failure, never a false success", async () => {
  // email-only deployment whose provider is down
  let res = await handleAssessmentSubmit(post(good()), emailEnv(), { fetch: makeFetch({ resend: 500 }) });
  assert.equal(res.status, 502);
  assert.deepEqual(await res.json(), { error: "delivery_failed" });
  // D1 broken AND email down
  const broken = { prepare: () => ({ bind() { return this; }, run: async () => { throw new Error("d1 down"); }, first: async () => { throw new Error("d1 down"); } }) };
  res = await handleAssessmentSubmit(post(good()), { DB: broken, ...emailEnv() }, { fetch: makeFetch({ resend: 500 }) });
  assert.equal(res.status, 502);
});

test("D1 broken but the email goes through: accepted (Framework's inbox has it)", async () => {
  const broken = { prepare: () => ({ bind() { return this; }, run: async () => { throw new Error("d1 down"); }, first: async () => { throw new Error("d1 down"); } }) };
  const res = await handleAssessmentSubmit(post(good()), { DB: broken, ...emailEnv() }, { fetch: makeFetch() });
  assert.equal(res.status, 200);
});

test("a failed confirmation email never fails the request", async () => {
  const f = makeFetch({ resend: (n) => (n === 1 ? 200 : 500) });
  const db = makeDb();
  const res = await handleAssessmentSubmit(post(good()), { DB: db, ...emailEnv() }, { fetch: f });
  assert.equal(res.status, 200);
  const row = db.raw.prepare("SELECT notify_status, confirm_status FROM assessment_requests").get();
  assert.deepEqual({ ...row }, { notify_status: "sent", confirm_status: "failed" });
});

test("no storage and no email configured: 503 not_configured", async () => {
  const res = await handleAssessmentSubmit(post(good()), {}, { fetch: makeFetch() });
  assert.equal(res.status, 503);
});

test("server-side validation errors come back per field and nothing is stored", async () => {
  const db = makeDb();
  const res = await handleAssessmentSubmit(post(good({ email: "nope", website: "javascript:alert(1)", business_name: "" })), { DB: db, ...emailEnv() }, { fetch: makeFetch() });
  assert.equal(res.status, 422);
  const out = await res.json();
  assert.deepEqual(Object.keys(out.fields).sort(), ["business_name", "email", "website"]);
  assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'assessment_requests'").get(), undefined);
});

test("request hygiene: cross-origin, wrong content type, bad JSON and oversize are refused", async () => {
  const env = { DB: makeDb(), ...emailEnv() }; const f = makeFetch();
  assert.equal((await handleAssessmentSubmit(post(good(), { Origin: "https://evil.example" }), env, { fetch: f })).status, 403);
  assert.equal((await handleAssessmentSubmit(post(good(), { "Content-Type": "text/plain" }), env, { fetch: f })).status, 415);
  assert.equal((await handleAssessmentSubmit(post("{not json"), env, { fetch: f })).status, 400);
  assert.equal((await handleAssessmentSubmit(post(good({ additional_info: "x".repeat(20000) })), env, { fetch: f })).status, 413);
  assert.equal(f.calls.length, 0);
});

test("honeypot: bots get a fake success and nothing is stored or sent", async () => {
  const db = makeDb(); const f = makeFetch();
  const res = await handleAssessmentSubmit(post(good({ hp: "http://spam.example" })), { DB: db, ...emailEnv() }, { fetch: f });
  assert.equal(res.status, 200);
  assert.equal(f.calls.length, 0);
  assert.equal(db.raw.prepare("SELECT name FROM sqlite_master WHERE name = 'assessment_requests'").get(), undefined);
});

test("too-fast submissions are asked to try again; slow ones pass", async () => {
  const env = { DB: makeDb(), ...emailEnv() };
  assert.equal((await handleAssessmentSubmit(post(good({ elapsed_ms: 200 })), env, { fetch: makeFetch() })).status, 429);
  assert.equal((await handleAssessmentSubmit(post(good({ elapsed_ms: 5000 })), env, { fetch: makeFetch() })).status, 200);
});

test("rate limit: the 6th request from one address in an hour is refused", async () => {
  const db = makeDb(); const env = { DB: db, ...emailEnv() };
  for (let i = 0; i < 5; i++) {
    const r = await handleAssessmentSubmit(post(good({ submission_id: "aaaaaaaa-0000-0000-0000-00000000000" + i })), env, { fetch: makeFetch() });
    assert.equal(r.status, 200, "request " + i);
  }
  const blocked = await handleAssessmentSubmit(post(good({ submission_id: "bbbbbbbb-0000-0000-0000-000000000000" })), env, { fetch: makeFetch() });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("Retry-After"), "3600");
  // a different address is unaffected
  const other = await handleAssessmentSubmit(post(good({ submission_id: "cccccccc-0000-0000-0000-000000000000" }), { "CF-Connecting-IP": "198.51.100.9" }), env, { fetch: makeFetch() });
  assert.equal(other.status, 200);
});

test("Turnstile: enforced server-side when a secret is set", async () => {
  const env = { DB: makeDb(), TURNSTILE_SECRET: "ts_secret", ...emailEnv() };
  assert.equal((await handleAssessmentSubmit(post(good()), env, { fetch: makeFetch() })).status, 403); // no token
  assert.equal((await handleAssessmentSubmit(post(good({ turnstile_token: "t" })), env, { fetch: makeFetch({ turnstile: { success: false } }) })).status, 403);
  assert.equal((await handleAssessmentSubmit(post(good({ turnstile_token: "t" })), env, { fetch: makeFetch({ turnstile: "down" }) })).status, 503);
  const f = makeFetch();
  assert.equal((await handleAssessmentSubmit(post(good({ turnstile_token: "good" })), env, { fetch: f })).status, 200);
  const verify = f.calls.find((c) => c.url.includes("turnstile"));
  assert.equal(verify.init.body.get("secret"), "ts_secret");
  assert.equal(verify.init.body.get("response"), "good");
});

test("config endpoint exposes only the two public IDs, never secrets", async () => {
  const res = handleAssessmentConfig({ TURNSTILE_SITE_KEY: "0xSITE", META_PIXEL_ID: "123", TURNSTILE_SECRET: "s", RESEND_API_KEY: "k" });
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { turnstileSiteKey: "0xSITE", metaPixelId: "123" });
  assert.ok(!text.includes("s\"") && !text.includes("re_"));
  assert.deepEqual(await handleAssessmentConfig({}).json(), { turnstileSiteKey: null, metaPixelId: null });
});
