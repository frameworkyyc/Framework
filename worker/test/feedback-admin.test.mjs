// Client Feedback improvements: admin-only sharing and invitations, and Question 3's "I didn’t have a website before." option.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createSign } from "node:crypto";
import { handleAdmin } from "../admin/router.js";
import { resetKeyCacheForTests } from "../admin/access.js";
import { validate } from "../index.js";
import { validateInvite, buildInvite, feedbackUrl, INVITE_SUBJECT } from "../feedback-invite.js";

const TEAM = "framework.cloudflareaccess.com", AUD = "a".repeat(64), ORIGIN = "https://staging.frameworkco.ca";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64u = (b) => Buffer.from(b).toString("base64url");
const jwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" };
const now = () => Math.floor(Date.now() / 1000);
const sign = (claims) => { const head = b64u(JSON.stringify({ alg: "RS256", kid: "k1", typ: "JWT" })), body = b64u(JSON.stringify(claims)); return `${head}.${body}.${b64u(createSign("RSA-SHA256").update(head + "." + body).sign(pair.privateKey))}`; };
const claims = (over = {}) => ({ iss: `https://${TEAM}`, aud: [AUD], email: "owner@frameworkco.ca", exp: now() + 600, iat: now(), ...over });
const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");

let env, sent;
const fakeFetch = (status = 200, body = "{}") => async (url, init) => { sent.push({ url: String(url), init }); return new Response(body, { status }); };
beforeEach(() => {
  resetKeyCacheForTests(); sent = [];
  env = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_EMAILS: "owner@frameworkco.ca", ACCESS_JWKS_JSON: JSON.stringify({ keys: [jwk] }), RESEND_API_KEY: "re_secretkey", ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", DB: {} };
});
const call = (path, { method = "GET", token = sign(claims()), headers = {}, body, e = env, f = fakeFetch() } = {}) => {
  const h = { Origin: ORIGIN, "X-Framework-Admin": "1", "Content-Type": "application/json", ...headers };
  if (token) h["Cf-Access-Jwt-Assertion"] = token;
  return handleAdmin(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), e, { fetch: f });
};

/* ------------------------------------------------------------------ admin access */

test("share info and invitations are admin-only: no token, a forged token and a non-admin account are all refused, and nothing is sent", async () => {
  const forged = sign(claims({ email: "intruder@example.com" }));
  const bad = [null, "garbage", forged];
  for (const token of bad) {
    assert.ok([401, 403].includes((await call("/api/admin/feedback/share", { token })).status), "share " + token);
    const r = await call("/api/admin/feedback/invite", { method: "POST", token, body: { name: "A", email: "a@example.com" } });
    assert.ok([401, 403].includes(r.status), "invite " + token);
  }
  assert.equal(sent.length, 0);
  const ok = await call("/api/admin/feedback/share");
  assert.equal(ok.status, 200);
});
test("share info: the existing form's link, whether email can send, and a copyable template with no client data", async () => {
  const j = await (await call("/api/admin/feedback/share")).json();
  assert.equal(j.form_url, ORIGIN + "/client-feedback");
  assert.equal(j.email.can_send, true); assert.equal(j.email.from, "Framework <hello@frameworkco.ca>");
  assert.equal(j.template.subject, INVITE_SUBJECT); assert.match(j.template.text, /Hi \[Client name\],/); assert.ok(j.template.text.includes(j.form_url));
  assert.ok(!JSON.stringify(j).includes("re_secretkey"), "the API key never leaves the server");
  const none = await (await call("/api/admin/feedback/share", { e: { ...env, RESEND_API_KEY: "" } })).json();
  assert.equal(none.email.can_send, false); assert.equal(none.email.from, null);
  assert.equal((await call("/api/admin/feedback/share", { method: "POST" })).status, 405);
});
test("the share panel makes no request that sends mail: only GET reads and an explicit POST", () => {
  const ui = read("admin/assets/feedback-share.js");
  assert.equal([...ui.matchAll(/api\("\/feedback\/invite"/g)].length, 1, "one send call");
  assert.match(ui, /confirmDialog\(/); assert.ok(ui.indexOf("confirmDialog(") < ui.indexOf('api("/feedback/invite"'), "the send is behind a confirmation");
  assert.ok(!/setTimeout|setInterval|addEventListener\("(load|DOMContentLoaded)/.test(ui), "nothing runs on a timer or on load");
  assert.ok(!/style: *"/.test(ui), "no inline style attributes (the admin CSP forbids them)");
});

/* ------------------------------------------------------------------ invitations */

test("sending: explicit POST, one email through the existing provider, to the recipient only, with the form link, and a success answer", async () => {
  const f = fakeFetch(200);
  const r = await call("/api/admin/feedback/invite", { method: "POST", body: { name: " Ann  Client ", email: "Ann@Client.EXAMPLE", project: "Harbour site" }, f });
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].url, "https://api.resend.com/emails");
  const mail = JSON.parse(sent[0].init.body);
  assert.deepEqual(mail.to, ["ann@client.example"]); assert.equal(mail.from, "Framework <hello@frameworkco.ca>"); assert.equal(mail.subject, INVITE_SUBJECT);
  assert.match(mail.text, /^Hi Ann Client,/); assert.match(mail.text, /on Harbour site/); assert.ok(mail.text.includes(ORIGIN + "/client-feedback"));
  assert.ok(mail.html.includes(`href="${ORIGIN}/client-feedback"`));
  assert.equal(sent[0].init.headers.Authorization, "Bearer re_secretkey");
  assert.ok(!mail.cc && !mail.bcc, "no extra recipients");
});
test("sending is validated and escaped: bad input is refused before anything is sent; HTML is escaped; headers cannot be injected", async () => {
  for (const [body, field] of [[{ name: "", email: "a@example.com" }, "name"], [{ email: "a@example.com" }, "name"], [{ name: "A", email: "not-an-email" }, "email"], [{ name: "A", email: "a@example.com, b@example.com" }, "email"], [{ name: "A", email: "a@example.com\r\nBcc: x@y.z" }, "email"], [{ name: "x".repeat(101), email: "a@example.com" }, "name"], [{ name: "A", email: "a@example.com", project: "p".repeat(121) }, "project"], [{ name: ["A"], email: "a@example.com" }, "name"]]) {
    const r = await call("/api/admin/feedback/invite", { method: "POST", body });
    assert.equal(r.status, 422, JSON.stringify(body)); assert.equal((await r.json()).field, field);
  }
  assert.equal(sent.length, 0);
  await call("/api/admin/feedback/invite", { method: "POST", body: { name: "<script>alert(1)</script>", email: "a@example.com", project: "A & B \"site\"" } });
  const mail = JSON.parse(sent[0].init.body);
  assert.ok(!mail.html.includes("<script>")); assert.match(mail.html, /&lt;script&gt;/); assert.match(mail.html, /A &amp; B &quot;site&quot;/);
  assert.ok(!/[\r\n]/.test(mail.subject));
  const v = validateInvite({ name: "Line\nBreak\tName", email: "a@example.com" }); assert.equal(v.name, "Line Break Name");
});
test("write protections: same-origin plus the admin header are required; wrong methods and bad JSON are refused", async () => {
  const body = { name: "A", email: "a@example.com" };
  assert.equal((await call("/api/admin/feedback/invite", { method: "POST", body, headers: { Origin: "https://evil.example" } })).status, 403);
  assert.equal((await call("/api/admin/feedback/invite", { method: "POST", body, headers: { "X-Framework-Admin": "" } })).status, 403);
  assert.equal((await call("/api/admin/feedback/invite", { method: "GET" })).status, 405);
  const raw = await handleAdmin(new Request(ORIGIN + "/api/admin/feedback/invite", { method: "POST", headers: { Origin: ORIGIN, "X-Framework-Admin": "1", "Cf-Access-Jwt-Assertion": sign(claims()) }, body: "{broken" }), env, { fetch: fakeFetch() });
  assert.equal(raw.status, 400);
  assert.equal(sent.length, 0);
});
test("error handling: not configured is a clear 409 and sends nothing; a provider failure is a coarse 502 with no provider detail or secret", async () => {
  const none = await call("/api/admin/feedback/invite", { method: "POST", body: { name: "A", email: "a@example.com" }, e: { ...env, RESEND_API_KEY: "" } });
  assert.equal(none.status, 409); assert.equal((await none.json()).error, "email_not_configured"); assert.equal(sent.length, 0);
  const noFrom = await call("/api/admin/feedback/invite", { method: "POST", body: { name: "A", email: "a@example.com" }, e: { ...env, ASSESSMENT_FROM: "" } });
  assert.equal(noFrom.status, 409);
  const logs = []; const o = [console.error, console.warn]; console.error = (...a) => logs.push(a.join(" ")); console.warn = (...a) => logs.push(a.join(" "));
  let rejected, thrown;
  try {
    rejected = await call("/api/admin/feedback/invite", { method: "POST", body: { name: "A", email: "secret.person@example.com" }, f: fakeFetch(422, JSON.stringify({ message: "provider detail for secret.person@example.com" })) });
    thrown = await call("/api/admin/feedback/invite", { method: "POST", body: { name: "A", email: "a@example.com" }, f: async () => { throw new TypeError("network down"); } });
  } finally { [console.error, console.warn] = o; }
  for (const r of [rejected, thrown]) { assert.equal(r.status, 502); const t = JSON.stringify(await r.json()); assert.equal(t, '{"ok":false,"error":"send_failed"}'); }
  assert.ok(!logs.join("\n").includes("re_secretkey"), "the key is never logged");
});
test("the invitation wording is concise and professional, uses the form link, and never claims anything was sent by itself", () => {
  const m = buildInvite({ name: "Ann", project: "", url: "https://frameworkco.ca/client-feedback" });
  assert.ok(m.text.split("\n").filter(Boolean).length <= 8); assert.match(m.text, /Share your feedback: https:\/\/frameworkco\.ca\/client-feedback/);
  assert.equal(feedbackUrl("https://frameworkco.ca"), "https://frameworkco.ca/client-feedback");
  assert.ok(!/\{|\[Client/.test(m.text));
});

/* ------------------------------------------------------------------ Question 3 */

const GOOD = { id: "q3-aaaaaaaaaaaaaaaaaaaa", satisfaction: 9, ratings: { visual_design: 5, ease_of_use: 5, mobile_experience: 5, accuracy: 5, professionalism: 5, communication: 5, overall_product: 5 }, improvement: "Significant improvement", impact: ["Too early to tell"], fair_price: "Unsure", recommend: 9, liked: "Everything", testimonial_permission: "No", logo_permission: "No", services: ["None currently"] };
const NO_PRIOR = "I didn’t have a website before.";

test("Question 3: the new option is on the form with the same markup as its siblings, and every existing option is unchanged", () => {
  const html = read("client-feedback.html");
  const q3 = html.slice(html.indexOf('data-q="improvement"'), html.indexOf('id="q-improvement-err"'));
  const opts = [...q3.matchAll(/<label class="fb-opt fb-opt--radio" for="(improvement-\d)"><input type="radio" id="\1" name="improvement" value="([^"]+)"><span class="fb-opt__mark" aria-hidden="true"><\/span><span class="fb-opt__text">([^<]+)<\/span><\/label>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.deepEqual(opts, [["improvement-0", "Significant improvement", "Significant improvement"], ["improvement-1", "Moderate improvement", "Moderate improvement"], ["improvement-2", "Slight improvement", "Slight improvement"], ["improvement-3", "About the same", "About the same"], ["improvement-4", "Worse", "Worse"], ["improvement-5", NO_PRIOR, NO_PRIOR]]);
  assert.match(q3, /Compared with your previous website or online presence/, "the question wording is unchanged");
});
test("Question 3: submitting every option works, including the new one, and an existing-website answer is unaffected", () => {
  for (const v of ["Significant improvement", "Moderate improvement", "Slight improvement", "About the same", "Worse", NO_PRIOR]) {
    const r = validate({ ...GOOD, improvement: v });
    assert.equal(r.ok, true, v); assert.equal(r.row.improvement, v, "stored exactly as chosen");
  }
  assert.equal(validate({ ...GOOD, improvement: "I did not have a website" }).ok, false, "only the exact option is accepted");
  assert.equal(validate({ ...GOOD, improvement: undefined }).ok, false, "still required");
  const a = validate({ ...GOOD, improvement: NO_PRIOR }).row, b = validate({ ...GOOD, improvement: "Slight improvement" }).row;
  const { improvement: _a, id: _i, created_at: _c, ...restA } = a, { improvement: _b, id: _j, created_at: _d, ...restB } = b;
  assert.deepEqual(restA, restB, "choosing it changes no rating or other stored value");
});
test("Question 3 in admin reports: shown as not applicable, never flagged, never scored; old responses still display", async () => {
  const js = read("admin/assets/feedback.js");
  assert.match(js, /export const NO_PRIOR_WEBSITE = "I didn\\u2019t have a website before\."/);
  assert.match(js, /improvementText\(r\.improvement\)/g);
  assert.equal([...js.matchAll(/improvementText\(r\.improvement\)/g)].length, 2, "list and detail both use it");
  assert.match(js, /\(not applicable\)/);
  assert.match(js, /r\.improvement === "Worse"/, "only Worse flags a response");
  const mod = JSON.parse(`"${"I didn\\u2019t have a website before.".replace("\\u2019", "’")}"`);
  assert.equal(mod, NO_PRIOR);
  // no calculation anywhere averages or scores the improvement answer
  for (const f of ["admin/assets/overview.js", "worker/admin/feedback-api.js"]) assert.ok(!/improvement/.test(read(f).replace(/SUMMARY_COLUMNS[\s\S]*?\];/, "").replace(/"improvement",/g, "")), f + " does not compute with improvement");
});
test("existing feedback stays compatible: stored values are plain text with no constraint, so earlier rows and exports are untouched", () => {
  for (const f of ["migrations/0001_create_feedback_responses.sql", "migrations/staging-init.sql"]) assert.match(read(f), /improvement TEXT NOT NULL,/);
  assert.ok(!/CHECK \(improvement/.test(read("migrations/0001_create_feedback_responses.sql")));
  assert.match(read("worker/index.js"), /"Significant improvement", "Moderate improvement", "Slight improvement", "About the same", "Worse", "I didn\\u2019t have a website before\."/);
});
test("the admin navigation entry is Client Feedback and the page offers the share panel", () => {
  assert.match(read("admin/assets/modules.js"), /id: "feedback", label: "Client Feedback", path: "\/admin\/feedback", enabled: true/);
  const js = read("admin/assets/feedback.js");
  assert.match(js, /"Client Feedback"/); assert.match(js, /await sharePanel\(\)/);
  const ui = read("admin/assets/feedback-share.js");
  assert.match(ui, /Copy feedback link/); assert.match(ui, /Open feedback form/); assert.match(ui, /Send feedback request/); assert.match(ui, /Invitation template/);
});
