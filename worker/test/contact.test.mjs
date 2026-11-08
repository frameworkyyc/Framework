// The website contact form: POST /api/contact (worker/contact.js). It emails Framework through the assessment form's email provider, stores nothing,
// and reports "sent" only when the provider accepted the message.
import test from "node:test";
import assert from "node:assert/strict";
import { handleContactSubmit, validateContact, buildContactEmail } from "../contact.js";
import worker from "../index.js";

const ENV = { RESEND_API_KEY: "re_test", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", ASSESSMENT_NOTIFY_TO: "hello@frameworkco.ca" };
const good = (over = {}) => ({ name: "Alex Rivera", email: "Alex@Summit.ca", business: "Summit Fencing", project_type: "Website Only", message: "We build fences in Calgary.\nWe need a website.", elapsed_ms: 8000, submission_id: "abcdef12-3456", page: "/contact", ...over });
const req = (body, { headers = {}, origin = "https://frameworkco.ca" } = {}) =>
  new Request("https://frameworkco.ca/api/contact", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const provider = (status = 200) => { const calls = []; const f = async (url, init) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify({ id: "x" }), { status }); }; f.calls = calls; return f; };

test("a valid enquiry is emailed to Framework with the visitor as Reply-To, and nothing is stored", async () => {
  const f = provider();
  const r = await handleContactSubmit(req(good()), ENV, { fetch: f });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(f.calls.length, 1);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(sent.to, ["hello@frameworkco.ca"]); assert.equal(sent.reply_to, "alex@summit.ca");
  assert.match(sent.subject, /New website enquiry — Alex Rivera/);
  assert.match(sent.text, /Business: Summit Fencing/); assert.match(sent.text, /We build fences in Calgary\.\nWe need a website\./);
  assert.match(f.calls[0].init.headers["Idempotency-Key"], /^contact-abcdef12-3456$/, "a retry is a harmless repeat at the provider");
});

test("validation: name, a real email and a message are required; the response names the fields", async () => {
  const f = provider();
  const r = await handleContactSubmit(req(good({ name: "", email: "nope", message: "  " })), ENV, { fetch: f });
  assert.equal(r.status, 422);
  assert.deepEqual(Object.keys((await r.json()).fields).sort(), ["email", "message", "name"]);
  assert.equal(f.calls.length, 0, "nothing was sent");
  assert.equal(validateContact(good({ message: "x".repeat(5000) })).data.message.length, 3000, "long messages are capped");
});

test("the honeypot looks like success but sends nothing", async () => {
  const f = provider();
  const r = await handleContactSubmit(req(good({ hp: "http://spam.example" })), ENV, { fetch: f });
  assert.equal(r.status, 200); assert.equal(f.calls.length, 0);
});

test("same-origin JSON only, and a size limit", async () => {
  const f = provider();
  assert.equal((await handleContactSubmit(req(good(), { origin: "https://evil.example" }), ENV, { fetch: f })).status, 403);
  assert.equal((await handleContactSubmit(req(good(), { headers: { "Content-Type": "text/plain" } }), ENV, { fetch: f })).status, 415);
  assert.equal((await handleContactSubmit(req("{not json"), ENV, { fetch: f })).status, 400);
  assert.equal((await handleContactSubmit(req(good({ message: "y".repeat(40000) })), ENV, { fetch: f })).status, 413);
  assert.equal(f.calls.length, 0);
});

test("not configured: an honest 503 (the page then shows the email address); provider failure: an honest 502", async () => {
  assert.equal((await handleContactSubmit(req(good()), {}, { fetch: provider() })).status, 503);
  const bad = provider(500);
  const r = await handleContactSubmit(req(good()), ENV, { fetch: bad });
  assert.equal(r.status, 502); assert.deepEqual(await r.json(), { error: "delivery_failed" });
});

test("Turnstile: when configured a missing, failed or unavailable check stops the message", async () => {
  const env = { ...ENV, TURNSTILE_SITE_KEY: "site", TURNSTILE_SECRET: "secret" };
  const f = provider();
  assert.equal((await handleContactSubmit(req(good()), env, { fetch: f })).status, 403, "no token");
  const failing = async (url) => (String(url).includes("turnstile") ? new Response(JSON.stringify({ success: false })) : new Response("{}"));
  assert.equal((await handleContactSubmit(req(good({ turnstile_token: "t" })), env, { fetch: failing })).status, 403);
  const down = async (url) => { if (String(url).includes("turnstile")) throw new Error("down"); return new Response("{}"); };
  assert.equal((await handleContactSubmit(req(good({ turnstile_token: "t" })), env, { fetch: down })).status, 503);
  const ok = async (url) => (String(url).includes("turnstile") ? new Response(JSON.stringify({ success: true })) : new Response("{}", { status: 200 }));
  assert.equal((await handleContactSubmit(req(good({ turnstile_token: "t" })), env, { fetch: ok })).status, 200);
});

test("a form filled faster than a person can is told to try again; the platform limiter can stop abuse but its faults never block a visitor", async () => {
  const f = provider();
  assert.equal((await handleContactSubmit(req(good({ elapsed_ms: 200 })), ENV, { fetch: f })).status, 429);
  const limited = { ...ENV, PORTAL_RATE_LIMITER: { limit: async () => ({ success: false }) } };
  const r = await handleContactSubmit(req(good(), { headers: { "CF-Connecting-IP": "203.0.113.9" } }), limited, { fetch: f });
  assert.equal(r.status, 429); assert.equal(r.headers.get("Retry-After"), "60");
  const faulty = { ...ENV, PORTAL_RATE_LIMITER: { limit: async () => { throw new Error("boom"); } } };
  assert.equal((await handleContactSubmit(req(good(), { headers: { "CF-Connecting-IP": "203.0.113.9" } }), faulty, { fetch: provider() })).status, 200);
});

test("the email escapes anything a visitor types", () => {
  const m = buildContactEmail(validateContact(good({ name: "<b>x</b>", message: "<script>alert(1)</script>" })).data);
  assert.ok(!m.html.includes("<script>") && !m.html.includes("<b>x</b>"));
  assert.match(m.html, /&lt;script&gt;/);
});

test("routing: POST /api/contact is public and handled by the Worker; other methods are refused", async () => {
  const env = { ...ENV, ASSETS: { fetch: async () => new Response("asset") } };
  const get = await worker.fetch(new Request("https://frameworkco.ca/api/contact"), env, {});
  assert.equal(get.status, 405); assert.equal(get.headers.get("Allow"), "POST");
  const bad = await worker.fetch(new Request("https://frameworkco.ca/api/contact", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://frameworkco.ca" }, body: "{}" }), env, {});
  assert.equal(bad.status, 422);
});

// ---- where the enquiry came from (SEO phase 1) ----
import { cleanAttribution, describeSource } from "../contact.js";
import { readFileSync } from "node:fs";

test("attribution: only known short keys are kept, control characters are removed, and anything else is dropped", () => {
  const a = cleanAttribution({ utm_source: "goo\u0007gle", utm_medium: "x".repeat(400), _landing: "/contractor-websites?utm_campaign=a", evil: "<script>", _referrer: "https://www.google.com", gclid: "5", utm_term: { a: 1 } });
  assert.deepEqual(Object.keys(a).sort(), ["_landing", "_referrer", "gclid", "utm_medium", "utm_source"]);
  assert.equal(a.utm_source, "goo gle"); assert.equal(a.utm_medium.length, 150); assert.equal(a.gclid, "5");
  assert.deepEqual(cleanAttribution(null), {}); assert.deepEqual(cleanAttribution([1, 2]), {}); assert.deepEqual(cleanAttribution("x"), {});
});

test("attribution: the email says plainly how the visitor found the site", () => {
  assert.equal(describeSource({ utm_source: "newsletter", utm_medium: "email", utm_campaign: "fall" }), "Campaign: newsletter / email / fall");
  assert.match(describeSource({ _referrer: "https://www.google.com" }), /^Search engine \(google\.com\)/);
  assert.match(describeSource({ _referrer: "https://ca.bing.com" }), /^Search engine \(ca\.bing\.com\)/);
  assert.equal(describeSource({ _referrer: "https://www.homestars.com" }), "Link from homestars.com");
  assert.equal(describeSource({ gclid: "abc" }), "Google Ads click");
  assert.match(describeSource({}), /^Direct visit or unknown/);
  assert.match(describeSource({ _referrer: "not a url" }), /^Direct visit or unknown/);
  assert.match(describeSource({ _referrer: "https://notgoogle.example" }), /^Link from notgoogle\.example/);
});

test("attribution: an enquiry carrying it shows the source and first page in the email, escaped; one without still sends", async () => {
  const f = provider();
  const r = await handleContactSubmit(req(good({ attribution: { _referrer: "https://www.google.com", _landing: "/contractor-websites", utm_source: "<b>x</b>" } })), ENV, { fetch: f });
  assert.equal(r.status, 200);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.match(sent.text, /How they found us: Campaign: <b>x<\/b>/);
  assert.match(sent.text, /First page they saw: frameworkco\.ca\/contractor-websites/);
  assert.ok(!sent.html.includes("<b>x</b>") && sent.html.includes("&lt;b&gt;x&lt;/b&gt;"), "HTML email escapes it");
  const g = provider();
  assert.equal((await handleContactSubmit(req(good()), ENV, { fetch: g })).status, 200);
  assert.match(JSON.parse(g.calls[0].init.body).text, /How they found us: Direct visit or unknown/);
  const h = provider();
  assert.equal((await handleContactSubmit(req(good({ attribution: "garbage" })), ENV, { fetch: h })).status, 200);
});

test("attribution: stored only in this tab's sessionStorage, sent only with the contact form, never to analytics", () => {
  const main = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /sessionStorage\.setItem\("fw_attribution"/);
  assert.ok(!/localStorage|document\.cookie/.test(main));
  assert.match(main, /attribution: attribution\(\)/);
  assert.ok(!/fwTrack\([^)]*attribution/.test(main));
  assert.match(readFileSync(new URL("../../privacy.html", import.meta.url), "utf8"), /on any page of this website we keep campaign details/);
});

// ---- real host in the email; privacy signals ----
test("the email names the host the enquiry was sent from: Staging says staging, Production says frameworkco.ca", async () => {
  const send = async (host) => {
    const f = provider();
    const r = new Request(`https://${host}/api/contact`, { method: "POST", headers: { "Content-Type": "application/json", Origin: `https://${host}` }, body: JSON.stringify(good({ attribution: { _landing: "/services" } })) });
    assert.equal((await handleContactSubmit(r, ENV, { fetch: f })).status, 200);
    return JSON.parse(f.calls[0].init.body).text;
  };
  const staging = await send("staging.frameworkco.ca");
  assert.match(staging, /Sent from: staging\.frameworkco\.ca\/contact/); assert.match(staging, /First page they saw: staging\.frameworkco\.ca\/services/);
  assert.ok(!staging.includes("Sent from: frameworkco.ca"));
  const prod = await send("frameworkco.ca");
  assert.match(prod, /Sent from: frameworkco\.ca\/contact/); assert.match(prod, /First page they saw: frameworkco\.ca\/services/);
  assert.match(buildContactEmail(validateContact(good()).data).text, /Sent from: frameworkco\.ca\/contact/, "default host is the live site");
});

test("privacy signals: Global Privacy Control or Do Not Track means nothing is recorded or sent, and the forms still work", () => {
  for (const file of ["assets/js/main.js", "assets/js/assessment.js"]) {
    const src = readFileSync(new URL("../../" + file, import.meta.url), "utf8");
    assert.match(src, /navigator\.globalPrivacyControl === true \|\| navigator\.doNotTrack === "1"/, file);
    assert.match(src, /removeItem\("fw_attribution"\)/, file + " clears anything already kept");
  }
  const main = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /var attribution = function \(\) \{\s*if \(navigator\.globalPrivacyControl === true[^]*?return \{\};/, "the contact form sends an empty source");
  // behaviour: run the capture script in a fake browser
  const run = (flags) => {
    const store = { fw_attribution: '{"old":1}' };
    const win = { location: { search: "?utm_source=x", pathname: "/a", origin: "https://frameworkco.ca" }, sessionStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } } };
    const nav = { ...flags };
    const code = main.slice(0, main.indexOf("(function () {", main.indexOf("})();") ));
    new Function("window", "navigator", "document", "URLSearchParams", "URL", code)(win, nav, { referrer: "https://www.google.com/" }, URLSearchParams, URL);
    return store;
  };
  assert.deepEqual(run({ globalPrivacyControl: true }), {}, "GPC: cleared, nothing new");
  assert.deepEqual(run({ doNotTrack: "1" }), {}, "DNT: cleared, nothing new");
  const normal = JSON.parse(run({}).fw_attribution);
  assert.equal(normal.utm_source, "x"); assert.equal(normal._referrer, "https://www.google.com");
});

test("privacy policy: retention names contact-form messages and source details; the privacy signal is described", () => {
  const html = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8");
  assert.match(html, /Assessment inquiries, contact-form messages and related prospect information<\/strong> \(including contact enquiries by email, and the source details an enquiry carries/);
  assert.match(html, /If your browser sends a Global Privacy Control or Do Not Track signal, we do not record any of this/);
});
