// Run with:  node --test worker/test/*.mjs
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  validateAssessment, normaliseWebsite, validEmail, buildNotification, buildConfirmation,
  handleAssessmentSubmit, handleAssessmentConfig, resetAssessmentSchemaForTests,
  normaliseFrom, emailConfig, emailHealth, resendUnsent, ensureAssessmentSchema,
} from "../assessment.js";
import { handleAssessmentsApi } from "../admin/assessments-api.js";

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

const emailEnv = (over = {}) => ({ RESEND_API_KEY: "re_test_key", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ...over });

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

test("success: stored in D1, Framework notified at hello@, applicant confirmed", async () => {
  const db = makeDb(); const f = makeFetch();
  const res = await handleAssessmentSubmit(post(good()), { DB: db, ...emailEnv() }, { fetch: f, now: new Date("2026-10-20T20:03:00Z") });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, notification: "sent" });
  const row = db.raw.prepare("SELECT * FROM assessment_requests").get();
  assert.equal(row.business_name, "Summit Concrete Ltd.");
  assert.equal(row.notify_status, "sent");
  assert.equal(row.confirm_status, "sent");
  assert.ok(row.ip_hash && !row.ip_hash.includes("203.0.113.7"));
  const [note, confirm] = f.emails();
  assert.deepEqual(note.to, ["hello@frameworkco.ca"]); // default recipient
  assert.ok(!JSON.stringify(f.emails()).includes("info@frameworkco.ca")); // the old address is gone from every email
  assert.equal(note.reply_to, "alex@summitconcrete.ca");
  assert.equal(note.from, "Framework <hello@frameworkco.ca>");
  assert.equal(confirm.reply_to, "hello@frameworkco.ca");
  assert.match(note.subject, /^New Assessment Request \| Summit Concrete Ltd\.$/);
  assert.deepEqual(confirm.to, ["alex@summitconcrete.ca"]);
  assert.equal(confirm.subject, "Your Assessment Request | Framework");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer re_test_key");
});

test("notify address is configurable", async () => {
  const f = makeFetch();
  await handleAssessmentSubmit(post(good()), { DB: makeDb(), ...emailEnv({ ASSESSMENT_NOTIFY_TO: "team@frameworkco.ca" }) }, { fetch: f });
  assert.deepEqual(f.emails()[0].to, ["team@frameworkco.ca"]);
  assert.equal(f.emails()[1].reply_to, "team@frameworkco.ca");
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
  const row = db.raw.prepare("SELECT notify_status, notify_error FROM assessment_requests").get();
  assert.equal(row.notify_status, "not_configured");
  assert.equal(row.notify_error, "config:missing_api_key");
  assert.equal((await res.clone().json()).notification, "not_sent"); // the browser can tell the email did not go out
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
  assert.equal((await handleAssessmentSubmit(post(good({ additional_info: "x".repeat(40000) })), env, { fetch: f })).status, 413);
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
  const env = { DB: makeDb(), TURNSTILE_SECRET: "ts_secret", TURNSTILE_SITE_KEY: "0xSITE", ...emailEnv() };
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


/* ================================================================ email must never be skipped silently */

const rowOf = (db) => db.raw.prepare("SELECT * FROM assessment_requests").get();
const submit = (env, f, over = {}, now) => handleAssessmentSubmit(post(good(over)), env, { fetch: f || makeFetch(), now });

test("ASSESSMENT_FROM: the bracket-less value from the dashboard is repaired, other shapes are handled", () => {
  assert.deepEqual(normaliseFrom("Framework hello@frameworkco.ca"), { value: "Framework <hello@frameworkco.ca>", corrected: true });
  assert.deepEqual(normaliseFrom("Framework <hello@frameworkco.ca>"), { value: "Framework <hello@frameworkco.ca>", corrected: false });
  assert.deepEqual(normaliseFrom('"Framework <hello@frameworkco.ca>"'), { value: "Framework <hello@frameworkco.ca>", corrected: true });
  assert.deepEqual(normaliseFrom("  hello@frameworkco.ca \n"), { value: "hello@frameworkco.ca", corrected: false }); // whitespace only: not a real correction
  assert.deepEqual(normaliseFrom("Framework Studio hello@frameworkco.ca"), { value: "Framework Studio <hello@frameworkco.ca>", corrected: true });
  for (const bad of ["", "Framework", "hello@", "Framework <hello>", "<<a@b.co>>", "a@b", null, undefined]) assert.equal(normaliseFrom(bad), null, String(bad));
});

test("emailConfig names the exact problem and tolerates pasted whitespace", () => {
  assert.deepEqual(emailConfig({}), { ok: false, reason: "missing_api_key" });
  assert.deepEqual(emailConfig({ RESEND_API_KEY: "   " }), { ok: false, reason: "missing_api_key" });
  assert.deepEqual(emailConfig({ RESEND_API_KEY: "k" }), { ok: false, reason: "missing_from" });
  assert.deepEqual(emailConfig({ RESEND_API_KEY: "k", ASSESSMENT_FROM: "nonsense" }), { ok: false, reason: "invalid_from" });
  const c = emailConfig({ RESEND_API_KEY: "re_key\n", ASSESSMENT_FROM: "Framework hello@frameworkco.ca" });
  assert.equal(c.ok, true);
  assert.equal(c.apiKey, "re_key");
  assert.equal(c.from, "Framework <hello@frameworkco.ca>");
  assert.equal(c.fromCorrected, true);
});

test("REGRESSION: a bracket-less ASSESSMENT_FROM now sends (with a valid From header) instead of failing silently", async () => {
  const db = makeDb(); const f = makeFetch();
  const res = await submit({ DB: db, RESEND_API_KEY: "re_key", ASSESSMENT_FROM: "Framework hello@frameworkco.ca" }, f);
  assert.deepEqual(await res.json(), { ok: true, notification: "sent" });
  assert.deepEqual(f.emails().map((e) => e.from), ["Framework <hello@frameworkco.ca>", "Framework <hello@frameworkco.ca>"]);
  assert.equal(rowOf(db).notify_status, "sent");
});

test("REGRESSION: an API key pasted with a trailing newline still authenticates", async () => {
  const f = makeFetch();
  await submit({ DB: makeDb(), RESEND_API_KEY: "re_key\n", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" }, f);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer re_key");
});

test("skipped delivery is recorded with its reason, never hidden: missing key, missing sender, invalid sender", async () => {
  for (const [env, reason] of [
    [{}, "config:missing_api_key"],
    [{ RESEND_API_KEY: "k" }, "config:missing_from"],
    [{ RESEND_API_KEY: "k", ASSESSMENT_FROM: "nonsense" }, "config:invalid_from"],
  ]) {
    resetAssessmentSchemaForTests();
    const db = makeDb(); const f = makeFetch();
    const res = await submit({ DB: db, ...env }, f, { submission_id: "skip" + reason.length + "00000000000000" });
    const r = rowOf(db);
    assert.equal((await res.json()).notification, "not_sent");
    assert.equal(r.notify_status, "not_configured");
    assert.equal(r.notify_error, reason);
    assert.equal(f.calls.length, 0);
  }
});

test("a provider rejection is stored with the provider's own message", async () => {
  const db = makeDb();
  const f = async () => new Response(JSON.stringify({ name: "validation_error", message: "Invalid `from` field.\nUse email@example.com or Name <email@example.com>" }), { status: 422 });
  const res = await submit({ DB: db, RESEND_API_KEY: "k", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" }, f);
  const r = rowOf(db);
  assert.equal((await res.json()).notification, "not_sent");
  assert.equal(r.notify_status, "failed");
  assert.match(r.notify_error, /^provider 422: Invalid `from` field\. Use email@example\.com/);
  assert.ok(!r.notify_error.includes("\n"));
  assert.equal(r.notify_attempts, 1);
});

test("a network error or timeout is stored as such", async () => {
  const db = makeDb();
  const f = async () => { throw Object.assign(new Error("boom"), { name: "TimeoutError" }); };
  await submit({ DB: db, RESEND_API_KEY: "k", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" }, f);
  assert.equal(rowOf(db).notify_error, "network:TimeoutError");
});

test("no secret ever reaches D1, logs or responses", async () => {
  const logged = [];
  const orig = { e: console.error, w: console.warn };
  console.error = (...a) => logged.push(a.join(" ")); console.warn = (...a) => logged.push(a.join(" "));
  try {
    const db = makeDb();
    const f = async () => new Response(JSON.stringify({ message: "nope" }), { status: 401 });
    const res = await submit({ DB: db, RESEND_API_KEY: "re_SUPERSECRET123", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" }, f);
    const everything = JSON.stringify(rowOf(db)) + (await res.text()) + logged.join("\n") + JSON.stringify(emailHealth({ RESEND_API_KEY: "re_SUPERSECRET123", ASSESSMENT_FROM: "x y@z.co" }));
    assert.ok(!everything.includes("SUPERSECRET"));
  } finally { console.error = orig.e; console.warn = orig.w; }
});

test("an existing Staging table from the first release is upgraded in place (columns added, 'skipped' migrated)", async () => {
  const db = makeDb();
  db.raw.exec(`CREATE TABLE assessment_requests (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, business_name TEXT, website TEXT, contact_name TEXT, email TEXT,
    location TEXT, industry TEXT, phone TEXT, services TEXT, service_area TEXT, profiles TEXT, concern TEXT, additional_info TEXT,
    privacy_ack INTEGER NOT NULL DEFAULT 0, marketing_opt_in INTEGER NOT NULL DEFAULT 0, tracking TEXT, landing TEXT, referrer TEXT, ip_hash TEXT,
    notify_status TEXT NOT NULL DEFAULT 'pending', confirm_status TEXT NOT NULL DEFAULT 'pending')`);
  db.raw.prepare("INSERT INTO assessment_requests (id, created_at, business_name, notify_status, confirm_status) VALUES ('old-1111111111111111', '2026-10-20T00:00:00Z', 'Old Co', 'skipped', 'skipped')").run();
  await ensureAssessmentSchema(db);
  const cols = db.raw.prepare("PRAGMA table_info(assessment_requests)").all().map((c) => c.name);
  for (const c of ["notify_error", "notified_at", "notify_attempts", "confirm_error"]) assert.ok(cols.includes(c), c);
  const r = rowOf(db);
  assert.equal(r.notify_status, "not_configured");
  assert.equal(r.notify_attempts, 0);
  await ensureAssessmentSchema(db); // idempotent
});

test("RECOVERY: saved-but-unsent requests are found and resent once email works; sent ones are never resent", async () => {
  const db = makeDb();
  // two requests arrive while email is broken, one while it works
  await submit({ DB: db }, null, { submission_id: "recover-aaaaaaaaaaaaaaaa", business_name: "Alpha Ltd." }, new Date("2026-10-20T10:00:00Z"));
  await submit({ DB: db }, null, { submission_id: "recover-bbbbbbbbbbbbbbbb", business_name: "Beta Ltd.", elapsed_ms: 9000 }, new Date("2026-10-20T11:00:00Z"));
  const working = { DB: db, ...emailEnv() };
  await handleAssessmentSubmit(post(good({ submission_id: "recover-cccccccccccccccc", business_name: "Gamma Ltd." }), { "CF-Connecting-IP": "198.51.100.9" }), working, { fetch: makeFetch() });
  const unsent = () => db.raw.prepare("SELECT business_name FROM assessment_requests WHERE notify_status != 'sent' ORDER BY created_at").all().map((r) => r.business_name);
  assert.deepEqual(unsent(), ["Alpha Ltd.", "Beta Ltd."]);

  const f = makeFetch();
  const out = await resendUnsent(working, {}, { fetch: f, now: new Date("2026-10-21T09:00:00Z") });
  assert.deepEqual({ attempted: out.attempted, sent: out.sent, failed: out.failed }, { attempted: 2, sent: 2, failed: 0 });
  assert.deepEqual(unsent(), []);
  const notes = f.emails().filter((e) => e.subject.startsWith("New Assessment Request"));
  assert.deepEqual(notes.map((e) => e.subject), ["New Assessment Request | Alpha Ltd.", "New Assessment Request | Beta Ltd."]);
  assert.ok(notes.every((e) => e.to[0] === "hello@frameworkco.ca" && e.text.includes("Resent: the original notification")));
  assert.ok(notes[0].text.includes("2026-10-20T10:00:00.000Z")); // original submission time preserved
  assert.equal(f.emails().filter((e) => e.subject === "Your Assessment Request | Framework").length, 2); // applicants finally get their confirmation
  const alpha = db.raw.prepare("SELECT * FROM assessment_requests WHERE business_name = 'Alpha Ltd.'").get();
  assert.equal(alpha.notify_status, "sent"); assert.equal(alpha.notify_error, null); assert.equal(alpha.notify_attempts, 2); assert.ok(alpha.notified_at); // one failed attempt at submission, one successful resend
  assert.equal(alpha.confirm_status, "sent");

  const again = await resendUnsent(working, {}, { fetch: makeFetch() });
  assert.equal(again.attempted, 0); // nothing left; delivered requests are never touched
});

test("RECOVERY: a resend that still fails keeps the request flagged with the new reason; one request can be targeted", async () => {
  const db = makeDb();
  await submit({ DB: db }, null, { submission_id: "retry-aaaaaaaaaaaaaaaaa" });
  const env = { DB: db, RESEND_API_KEY: "k", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>" };
  const bad = async () => new Response(JSON.stringify({ message: "domain not verified" }), { status: 403 });
  const out = await resendUnsent(env, { id: "retry-aaaaaaaaaaaaaaaaa" }, { fetch: bad });
  assert.deepEqual({ attempted: out.attempted, sent: out.sent, failed: out.failed }, { attempted: 1, sent: 0, failed: 1 });
  assert.equal(out.results[0].error, "provider 403: domain not verified");
  const r = rowOf(db);
  assert.equal(r.notify_status, "failed"); assert.equal(r.notify_error, "provider 403: domain not verified"); assert.equal(r.notify_attempts, 2);
  assert.equal((await resendUnsent(env, { id: "no-such-id-0000000000" }, { fetch: bad })).attempted, 0);
});

/* ---------------------------------------------------------------- admin API */

const admin = (path, { method = "GET", env, body, headers = {}, fetch: f } = {}) => {
  const req = new Request("https://frameworkco.ca/api/admin" + path, {
    method,
    headers: { Origin: "https://frameworkco.ca", "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return handleAssessmentsApi(req, env, { email: "owner@example.com" }, path, { fetch: f || makeFetch() });
};

test("admin list shows requests, counts and email health; hides internals and secrets", async () => {
  const db = makeDb();
  await submit({ DB: db }, null, { submission_id: "adm-aaaaaaaaaaaaaaaaaaa" });
  const res = await admin("/assessments", { env: { DB: db, RESEND_API_KEY: "re_SECRETKEY", ASSESSMENT_FROM: "Framework hello@frameworkco.ca" } });
  const text = await res.text(); const out = JSON.parse(text);
  assert.deepEqual({ total: out.total, sent: out.sent, unsent: out.unsent }, { total: 1, sent: 0, unsent: 1 });
  assert.equal(out.requests[0].notify_status, "not_configured");
  assert.ok(!("ip_hash" in out.requests[0]));
  assert.deepEqual(out.email, { can_send: true, api_key: "set", from: "corrected", from_used: "Framework <hello@frameworkco.ca>", notify_to: "hello@frameworkco.ca", problem: null });
  assert.ok(!text.includes("SECRETKEY"));
  const none = JSON.parse(await (await admin("/assessments", { env: { DB: db } })).text()).email;
  assert.deepEqual({ can_send: none.can_send, problem: none.problem, api_key: none.api_key }, { can_send: false, problem: "missing_api_key", api_key: "missing" });
});

test("admin summary, resend and test-email work; writes need the same-origin header", async () => {
  const db = makeDb(); const env = { DB: db, ...emailEnv() };
  await submit({ DB: db }, null, { submission_id: "adm-bbbbbbbbbbbbbbbbbbb" });
  assert.deepEqual(await (await admin("/assessments/summary", { env })).json(), { total: 1, unsent: 1 });
  assert.equal((await admin("/assessments/resend", { method: "POST", env, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal((await admin("/assessments/resend", { method: "POST", env, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await admin("/assessments/test-email", { method: "POST", env, headers: { "X-Framework-Admin": "" } })).status, 403);
  const f = makeFetch();
  const sent = await (await admin("/assessments/resend", { method: "POST", env, body: {}, fetch: f })).json();
  assert.equal(sent.sent, 1);
  assert.deepEqual(await (await admin("/assessments/summary", { env })).json(), { total: 1, unsent: 0 });
  const t = await (await admin("/assessments/test-email", { method: "POST", env, body: {}, fetch: makeFetch() })).json();
  assert.deepEqual({ ok: t.ok, to: t.to }, { ok: true, to: "hello@frameworkco.ca" });
  const bad = await (await admin("/assessments/test-email", { method: "POST", env: { DB: db }, body: {} })).json();
  assert.deepEqual({ ok: bad.ok, error: bad.error }, { ok: false, error: "config:missing_api_key" });
});

test("admin API: wrong methods, unknown paths and a missing database", async () => {
  const env = { DB: makeDb(), ...emailEnv() };
  assert.equal((await admin("/assessments", { method: "POST", env })).status, 405);
  assert.equal((await admin("/assessments/resend", { method: "GET", env })).status, 405);
  assert.equal(await admin("/feedback", { env }), null);
  assert.equal((await admin("/assessments", { env: {} })).status, 503);
});

/* ================================================================ deletion (admin) */

const ID_A = "del-aaaaaaaaaaaaaaaaaaaa", ID_B = "del-bbbbbbbbbbbbbbbbbbbb", ID_C = "del-cccccccccccccccccccc";
const seed = async (db, env = {}) => {
  let n = 0;
  for (const [id, name] of [[ID_A, "Alpha Ltd."], [ID_B, "Beta Ltd."], [ID_C, "Gamma Ltd."]]) {
    await handleAssessmentSubmit(post(good({ submission_id: id, business_name: name }), { "CF-Connecting-IP": `198.51.100.${++n}` }), { DB: db, ...env }, { fetch: makeFetch() });
  }
};
const count = (db) => db.raw.prepare("SELECT COUNT(*) AS n FROM assessment_requests").get().n;
const names = (db) => db.raw.prepare("SELECT business_name FROM assessment_requests ORDER BY business_name").all().map((r) => r.business_name);
const del = (id, over = {}) => admin("/assessments/" + id, { method: "DELETE", ...over });

test("DELETE removes exactly one request, returns updated counts, and leaves the others untouched", async () => {
  const db = makeDb(); await seed(db);
  const res = await del(ID_B, { env: { DB: db } });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, total: 2, sent: 0, unsent: 2 });
  assert.deepEqual(names(db), ["Alpha Ltd.", "Gamma Ltd."]);
});

test("DELETE counts reflect delivered vs unsent correctly", async () => {
  const db = makeDb(); await seed(db, emailEnv()); // all three emailed
  const res = await del(ID_A, { env: { DB: db } });
  assert.deepEqual(await res.json(), { ok: true, total: 2, sent: 2, unsent: 0 });
});

test("DELETE without the same-origin admin header or with a foreign Origin is refused and deletes nothing", async () => {
  const db = makeDb(); await seed(db);
  assert.equal((await del(ID_A, { env: { DB: db }, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal((await del(ID_A, { env: { DB: db }, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await del(ID_A, { env: { DB: db }, headers: { Origin: "" } })).status, 403);
  assert.equal(count(db), 3);
});

test("DELETE with a malformed identifier is a 400 and never reaches the database", async () => {
  const db = makeDb(); await seed(db);
  let touched = false;
  const spy = { prepare: (sql) => { if (/DELETE/i.test(sql)) touched = true; return db.prepare(sql); } };
  for (const bad of ["short", "x".repeat(65), "has%20space-0000000000", "a'%3B--0000000000000", "%E0%A4%A", "..%2F..%2Fetc-0000000", "1%27%20OR%20%271%27%3D%271", "*"]) {
    const res = await del(bad, { env: { DB: spy } });
    assert.equal(res.status, 400, bad);
    assert.deepEqual(await res.json(), { error: "invalid_id" });
  }
  assert.equal(touched, false);
  assert.equal(count(db), 3);
});

test("DELETE of a nonexistent request is a 404 and changes nothing", async () => {
  const db = makeDb(); await seed(db);
  const res = await del("nope-nope-nope-nope-0000", { env: { DB: db } });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "not_found" });
  assert.equal(count(db), 3);
  // deleting the same one twice: second attempt is a clean 404, not an error
  assert.equal((await del(ID_C, { env: { DB: db } })).status, 200);
  assert.equal((await del(ID_C, { env: { DB: db } })).status, 404);
  assert.equal(count(db), 2);
});

test("DELETE during a database failure is a 503 with no details, and the record survives", async () => {
  const db = makeDb(); await seed(db);
  const failing = { prepare: (sql) => {
    if (/DELETE/i.test(sql)) return { bind() { return this; }, run: async () => { throw new Error("D1_ERROR: secret internal detail /var/db"); } };
    return db.prepare(sql);
  } };
  const res = await del(ID_A, { env: { DB: failing } });
  const text = await res.text();
  assert.equal(res.status, 503);
  assert.deepEqual(JSON.parse(text), { error: "database_unavailable" });
  assert.ok(!/secret|var\/db|D1_ERROR/.test(text));
  assert.equal(count(db), 3);
});

test("there is no bulk delete: the collection, summary, resend and test-email paths refuse DELETE", async () => {
  const db = makeDb(); await seed(db);
  for (const path of ["/assessments", "/assessments/summary", "/assessments/resend", "/assessments/test-email"]) {
    assert.equal((await admin(path, { method: "DELETE", env: { DB: db } })).status, 405, path);
  }
  assert.equal((await admin("/assessments/" + ID_A, { method: "GET", env: { DB: db } })).status, 405); // GET/POST on an id: not allowed
  assert.equal((await admin("/assessments/" + ID_A, { method: "POST", env: { DB: db }, body: {} })).status, 405);
  assert.equal(count(db), 3);
});

test("a deleted request can no longer be resent or listed", async () => {
  const db = makeDb(); await seed(db);
  await del(ID_A, { env: { DB: db } });
  const list = await (await admin("/assessments", { env: { DB: db } })).json();
  assert.deepEqual(list.requests.map((r) => r.id).sort(), [ID_B, ID_C]);
  const out = await resendUnsent({ DB: db, ...emailEnv() }, { id: ID_A }, { fetch: makeFetch() });
  assert.equal(out.attempted, 0);
});

/* ================================================================ hardening found in the audit */

test("AUDIT: a body is capped while it is being read, even with no Content-Length (chunked)", async () => {
  let pulled = 0;
  const stream = new ReadableStream({ pull(c) { pulled += 1; c.enqueue(new TextEncoder().encode("x".repeat(8192))); if (pulled > 200) c.close(); } });
  const req = new Request("https://frameworkco.ca/api/assessment", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://frameworkco.ca" }, body: stream, duplex: "half" });
  const res = await handleAssessmentSubmit(req, { DB: makeDb(), ...emailEnv() }, { fetch: makeFetch() });
  assert.equal(res.status, 413);
  assert.ok(pulled < 20, "stopped reading early: pulled " + pulled);
});

test("AUDIT: the confirmation email is sent once per address per day (no mail-bombing a third party)", async () => {
  const db = makeDb(); const f = makeFetch(); const env = { DB: db, ...emailEnv() };
  const t0 = new Date("2026-10-20T10:00:00Z");
  const go = (id, ip, when, email = "victim@example.com") => handleAssessmentSubmit(post(good({ submission_id: id, email }), { "CF-Connecting-IP": ip }), env, { fetch: f, now: when });
  await go("conf-aaaaaaaaaaaaaaaaaaaa", "1.1.1.1", t0);
  await go("conf-bbbbbbbbbbbbbbbbbbbb", "1.1.1.2", new Date(t0.getTime() + 3600e3), "VICTIM@example.com");
  const sentTo = (addr) => f.emails().filter((e) => e.subject.startsWith("Your Assessment") && e.to[0].toLowerCase() === addr).length;
  assert.equal(sentTo("victim@example.com"), 1);
  assert.equal(f.emails().filter((e) => e.subject.startsWith("New Assessment")).length, 2); // Framework still hears about both
  const rows = db.raw.prepare("SELECT confirm_status FROM assessment_requests ORDER BY created_at").all().map((r) => r.confirm_status);
  assert.deepEqual(rows, ["sent", "suppressed"]);
  await go("conf-cccccccccccccccccccc", "1.1.1.3", new Date(t0.getTime() + 25 * 3600e3)); // next day: allowed again
  assert.equal(sentTo("victim@example.com"), 2);
  // a suppressed confirmation is never "recovered" later by a resend
  db.raw.prepare("UPDATE assessment_requests SET notify_status = 'failed'").run();
  const f2 = makeFetch();
  await resendUnsent(env, {}, { fetch: f2 });
  assert.equal(f2.emails().filter((e) => e.subject.startsWith("Your Assessment")).length, 0); // all three already sent/suppressed
});

test("AUDIT: concurrent resends never email the same request twice", async () => {
  const db = makeDb(); await seed(db); // seeded with no email configured: all unsent
  const f = makeFetch(); const env = { DB: db, ...emailEnv() };
  const [a, b] = await Promise.all([resendUnsent(env, {}, { fetch: f }), resendUnsent(env, {}, { fetch: f })]);
  assert.equal(a.sent + b.sent, 3);
  assert.equal(f.emails().filter((e) => e.subject.startsWith("New Assessment")).length, 3);
});

test("AUDIT: a resend is capped per click and reports how many remain", async () => {
  const db = makeDb(); const env = { DB: db, ...emailEnv() };
  await ensureAssessmentSchema(db);
  for (let i = 0; i < 13; i++) db.raw.prepare("INSERT INTO assessment_requests (id, created_at, business_name, email, notify_status) VALUES (?, ?, ?, 'a@b.co', 'failed')").run("cap-" + String(i).padStart(20, "0"), `2026-10-20T10:${String(i).padStart(2, "0")}:00Z`, "Co " + i);
  const first = await resendUnsent(env, {}, { fetch: makeFetch() });
  assert.deepEqual({ attempted: first.attempted, sent: first.sent, remaining: first.remaining }, { attempted: 10, sent: 10, remaining: 3 });
  const second = await resendUnsent(env, {}, { fetch: makeFetch() });
  assert.deepEqual({ attempted: second.attempted, remaining: second.remaining }, { attempted: 3, remaining: 0 });
});

test("AUDIT: two identical submissions racing past the duplicate check produce one record and one email pair", async () => {
  const db = makeDb(); const f = makeFetch(); const env = { DB: db, ...emailEnv() };
  const [a, b] = await Promise.all([submit(env, f), submit(env, f)]);
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.equal(count(db), 1);
  assert.equal(f.emails().filter((e) => e.subject.startsWith("New Assessment")).length, 1);
});

test("AUDIT: applicant-supplied HTML/script never survives into the notification email or the admin JSON as markup", async () => {
  const db = makeDb(); const f = makeFetch();
  const evil = `<img src=x onerror=alert(1)><script>alert(2)</script>"'&`;
  await submit({ DB: db, ...emailEnv() }, f, { business_name: evil, additional_info: evil, profiles: evil });
  const note = f.emails().find((e) => e.subject.startsWith("New Assessment"));
  assert.ok(!/<img|<script/i.test(note.html));
  assert.ok(!/[\r\n]/.test(note.subject));
  assert.ok(note.text.includes(evil)); // plain-text part carries the raw text, harmlessly
});

test("AUDIT: SQL metacharacters in every field are stored as data", async () => {
  const db = makeDb();
  const sqli = "x'); DROP TABLE assessment_requests;--";
  const res = await submit({ DB: db }, null, { business_name: sqli, contact_name: sqli, industry: sqli, location: sqli, additional_info: sqli });
  assert.equal(res.status, 200);
  assert.equal(db.raw.prepare("SELECT business_name FROM assessment_requests").get().business_name, sqli);
});

test("AUDIT: Turnstile is enforced only when secret AND site key are both set (a half-set config must not lock out every lead)", async () => {
  assert.equal((await import("../assessment.js")).turnstileState({}), "off");
  const { turnstileState } = await import("../assessment.js");
  assert.equal(turnstileState({ TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" }), "on");
  assert.equal(turnstileState({ TURNSTILE_SECRET: "s" }), "misconfigured");
  assert.equal(turnstileState({ TURNSTILE_SITE_KEY: "k" }), "misconfigured");
  const warned = []; const w = console.warn; console.warn = (...a) => warned.push(a.join(" "));
  try {
    const res = await handleAssessmentSubmit(post(good()), { DB: makeDb(), TURNSTILE_SECRET: "s", ...emailEnv() }, { fetch: makeFetch() });
    assert.equal(res.status, 200); // not blocked: no widget could have been shown
    assert.ok(warned.some((m) => /BOTH TURNSTILE_SITE_KEY and TURNSTILE_SECRET/.test(m)));
  } finally { console.warn = w; }
});

test("admin list reports the spam-check state", async () => {
  const db = makeDb(); await ensureAssessmentSchema(db);
  assert.equal((await (await admin("/assessments", { env: { DB: db } })).json()).spam_check, "off");
  assert.equal((await (await admin("/assessments", { env: { DB: db, TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" } })).json()).spam_check, "on");
});
