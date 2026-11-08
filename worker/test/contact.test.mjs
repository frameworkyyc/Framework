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
import { cleanAttribution, describeSource, describeCampaign } from "../contact.js";
import { readFileSync } from "node:fs";

test("attribution: only known short keys are kept, control characters are removed, page paths never carry a query string, and anything else is dropped", () => {
  const a = cleanAttribution({ utm_source: "goo\u0007gle", utm_medium: "x".repeat(400), _landing: "/contractor-websites?utm_campaign=a#top", _campaign_landing: "/services?x=1", _referrer: "https://www.google.com", _campaign_referrer: "https://chatgpt.com", evil: "<script>", gclid: "5", utm_term: { a: 1 } });
  assert.deepEqual(Object.keys(a).sort(), ["_campaign_landing", "_campaign_referrer", "_landing", "_referrer", "gclid", "utm_medium", "utm_source"]);
  assert.equal(a.utm_source, "goo gle"); assert.equal(a.utm_medium.length, 150); assert.equal(a.gclid, "5");
  assert.equal(a._landing, "/contractor-websites"); assert.equal(a._campaign_landing, "/services");
  assert.deepEqual(cleanAttribution(null), {}); assert.deepEqual(cleanAttribution([1, 2]), {}); assert.deepEqual(cleanAttribution("x"), {});
});

test("attribution: the email describes the original visit and the latest campaign separately, in plain language", () => {
  assert.match(describeSource({ _referrer: "https://www.google.com" }), /^Search engine \(google\.com\)/);
  assert.match(describeSource({ _referrer: "https://ca.bing.com" }), /^Search engine \(ca\.bing\.com\)/);
  assert.equal(describeSource({ _referrer: "https://www.homestars.com" }), "Link from homestars.com");
  assert.match(describeSource({}), /^Direct visit or unknown/);
  assert.match(describeSource({ _referrer: "not a url" }), /^Direct visit or unknown/);
  assert.match(describeSource({ _referrer: "https://notgoogle.example" }), /^Link from notgoogle\.example/);
  assert.equal(describeSource({ utm_source: "x" }), "Direct visit or unknown (no referring site recorded)", "campaign tags are not part of the original-visit line");
  assert.equal(describeCampaign({}), "None");
  assert.equal(describeCampaign({ utm_source: "newsletter", utm_medium: "email", utm_campaign: "fall", _campaign_landing: "/services" }, "staging.frameworkco.ca"), "newsletter / email / fall (landed on staging.frameworkco.ca/services)");
  assert.equal(describeCampaign({ gclid: "abc", _campaign_landing: "/", _campaign_referrer: "https://www.google.com" }), "Google Ads click (landed on frameworkco.ca/, from google.com)");
  assert.equal(describeCampaign({ fbclid: "z" }), "Facebook or Instagram link");
});

test("attribution: an enquiry carrying it shows original visit, first page and latest campaign in the email, escaped; one without still sends", async () => {
  const f = provider();
  const r = await handleContactSubmit(req(good({ attribution: { _referrer: "https://www.google.com", _landing: "/contractor-websites?secret=1", utm_source: "<b>x</b>", utm_medium: "m", _campaign_landing: "/services", _campaign_referrer: "https://chatgpt.com" } })), ENV, { fetch: f });
  assert.equal(r.status, 200);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.match(sent.text, /How they found us: Search engine \(google\.com\)/);
  assert.match(sent.text, /First page they saw: frameworkco\.ca\/contractor-websites\n/, "path only");
  assert.ok(!sent.text.includes("secret=1"));
  assert.match(sent.text, /Latest campaign: <b>x<\/b> \/ m \(landed on frameworkco\.ca\/services, from chatgpt\.com\)/);
  assert.ok(!sent.html.includes("<b>x</b>") && sent.html.includes("&lt;b&gt;x&lt;/b&gt;"), "HTML email escapes it");
  const g = provider();
  assert.equal((await handleContactSubmit(req(good()), ENV, { fetch: g })).status, 200);
  const plain = JSON.parse(g.calls[0].init.body).text;
  assert.match(plain, /How they found us: Direct visit or unknown/); assert.match(plain, /Latest campaign: None/);
  const h = provider();
  assert.equal((await handleContactSubmit(req(good({ attribution: "garbage" })), ENV, { fetch: h })).status, 200);
});

// Runs the visit-recording script from assets/js/main.js in a fake browser, one page view at a time, in one tab (one sessionStorage).
function tab(flags = {}) {
  const main = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  const code = main.slice(0, main.indexOf("(function () {", main.indexOf("})();")));
  const store = {};
  const session = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } };
  return {
    store,
    visit(path, search = "", referrer = "") {
      const win = { location: { pathname: path, search, origin: "https://frameworkco.ca" }, sessionStorage: session };
      new Function("window", "navigator", "document", "URLSearchParams", "URL", code)(win, { ...flags }, { referrer }, URLSearchParams, URL);
      return store.fw_attribution === undefined ? undefined : JSON.parse(store.fw_attribution);
    },
  };
}

test("attribution (browser): the original landing page is kept without its query string and is never replaced in the tab", () => {
  const t = tab();
  const first = t.visit("/contractor-websites", "?utm_source=chatgpt.com", "https://chatgpt.com/");
  assert.equal(first._landing, "/contractor-websites"); assert.equal(first._referrer, "https://chatgpt.com");
  const later = t.visit("/about", "", "https://frameworkco.ca/contractor-websites");
  assert.equal(later._landing, "/contractor-websites", "first touch stays"); assert.equal(later._referrer, "https://chatgpt.com");
  assert.ok(!JSON.stringify(later).includes("?"), "no query string is ever stored in a path");
  assert.equal(t.visit("/contact", "", "https://frameworkco.ca/about")._landing, "/contractor-websites", "internal navigation changes nothing");
});

test("attribution (browser): the latest campaign replaces the previous one completely, with its own landing page and referrer (the owner's chatgpt.com then owner-test case)", () => {
  const t = tab();
  t.visit("/contractor-websites", "?utm_source=chatgpt.com", "https://chatgpt.com/");
  const second = t.visit("/contractor-websites", "?utm_source=owner-test&utm_medium=manual&utm_campaign=phase1-check", "");
  assert.deepEqual(
    { s: second.utm_source, m: second.utm_medium, c: second.utm_campaign, l: second._campaign_landing, r: second._campaign_referrer },
    { s: "owner-test", m: "manual", c: "phase1-check", l: "/contractor-websites", r: undefined }, "no blending with the earlier campaign or its referrer");
  assert.equal(second._landing, "/contractor-websites"); assert.equal(second._referrer, "https://chatgpt.com", "the original visit is still the original");
  // a campaign that only has some fields does not inherit the earlier campaign's other fields
  const third = t.visit("/services", "?utm_source=newsletter", "https://mail.example/");
  assert.equal(third.utm_source, "newsletter"); assert.equal(third.utm_medium, undefined); assert.equal(third.utm_campaign, undefined);
  assert.equal(third._campaign_landing, "/services"); assert.equal(third._campaign_referrer, "https://mail.example");
  // a plain page view later does not disturb the campaign
  assert.deepEqual(t.visit("/about", "", "https://frameworkco.ca/services").utm_source, "newsletter");
  // reloading the same campaign link is harmless
  assert.equal(t.visit("/services", "?utm_source=newsletter", "").utm_source, "newsletter");
});

test("attribution (browser): Google first, then a campaign link in the same tab, keeps both stories apart", () => {
  const t = tab();
  t.visit("/", "", "https://www.google.com/");
  const a = t.visit("/services", "?gclid=abc123", "https://www.googleadservices.com/");
  assert.equal(a._landing, "/"); assert.equal(a._referrer, "https://www.google.com");
  assert.equal(a.gclid, "abc123"); assert.equal(a._campaign_landing, "/services"); assert.equal(a._campaign_referrer, "https://www.googleadservices.com");
});

test("attribution (browser): Global Privacy Control or Do Not Track records nothing and clears anything kept; the contact form sends an empty source", () => {
  for (const flag of [{ globalPrivacyControl: true }, { doNotTrack: "1" }]) {
    const t = tab(flag);
    t.store.fw_attribution = '{"_landing":"/old","utm_source":"old"}';
    assert.equal(t.visit("/contact", "?utm_source=x", "https://www.google.com/"), undefined, JSON.stringify(flag));
    assert.deepEqual(t.store, {}, "nothing kept");
  }
  const main = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /var attribution = function \(\) \{\s*if \(navigator\.globalPrivacyControl === true[^]*?return \{\};/);
  const assess = readFileSync(new URL("../../assets/js/assessment.js", import.meta.url), "utf8");
  assert.match(assess, /var readAttribution = function \(\) \{\s*if \(navigator\.globalPrivacyControl === true[^]*?return \{\};/);
  assert.ok(!/sessionStorage\.setItem/.test(assess), "the assessment form only reads: main.js is the single writer");
});

test("attribution: stored only in this tab's sessionStorage, sent only with the contact form, never to analytics", () => {
  const main = readFileSync(new URL("../../assets/js/main.js", import.meta.url), "utf8");
  assert.match(main, /sessionStorage\.setItem\("fw_attribution"/);
  assert.ok(!/localStorage|document\.cookie/.test(main));
  assert.match(main, /attribution: attribution\(\)/);
  assert.ok(!/fwTrack\([^)]*attribution/.test(main));
  assert.match(readFileSync(new URL("../../privacy.html", import.meta.url), "utf8"), /on any page of this website we keep campaign details/);
});

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

test("privacy policy: retention names contact-form messages and source details; the privacy signal is described", () => {
  const html = readFileSync(new URL("../../privacy.html", import.meta.url), "utf8");
  assert.match(html, /Assessment inquiries, contact-form messages and related prospect information<\/strong> \(including contact enquiries by email, and the source details an enquiry carries/);
  assert.match(html, /If your browser sends a Global Privacy Control or Do Not Track signal, we do not record any of this/);
  assert.match(html, /the first page of this website you opened \(its address without anything after a question mark\)/);
  assert.match(html, /A newer campaign link replaces the earlier one/);
});
