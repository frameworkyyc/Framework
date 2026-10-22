// Unit tests for the portal rate limiter's client identification and fail-open behaviour (worker/portal/ratelimit.js).
import test from "node:test";
import assert from "node:assert/strict";
import { clientNetwork, rateLimitKey, isRateLimited, checkRateLimit, RATE_LIMIT_OUTCOMES, BUCKETS } from "../portal/ratelimit.js";
import { readFileSync } from "node:fs";

const PEPPER = "Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0";
const CFG = { pepper: PEPPER };
const req = (ip) => new Request("https://staging.frameworkco.ca/portal/login?start=1", { headers: ip === undefined ? {} : { "CF-Connecting-IP": ip } });

test("IPv4 clients are identified by address; leading-zero, partial and out-of-range forms are rejected", () => {
  assert.equal(clientNetwork("203.0.113.7"), "v4:203.0.113.7");
  assert.equal(clientNetwork(" 203.0.113.7 "), "v4:203.0.113.7");
  for (const bad of ["1.2.3", "1.2.3.4.5", "256.1.1.1", "999.1.1.1", "01.2.3.4", "1.2.3.04", "1.2.3.-4", "a.b.c.d", "1.2.3.4/24", "1.2.3.4:80"]) assert.equal(clientNetwork(bad), null, bad);
});
test("IPv6 clients are identified by their /64: every spelling inside one /64 is the same client, a different /64 is another", () => {
  const same = ["2001:db8:1:2::1", "2001:DB8:1:2:ffff:ffff:ffff:ffff", "2001:db8:1:2:0:0:0:9", "2001:0db8:0001:0002:0000:0000:0000:0001", "2001:db8:1:2::", "2001:db8:1:2:3:4:5:6", "2001:db8:1:2::1%eth0"];
  const nets = new Set(same.map(clientNetwork));
  assert.deepEqual([...nets], ["v6:2001:0db8:0001:0002"]);
  assert.notEqual(clientNetwork("2001:db8:1:3::1"), clientNetwork("2001:db8:1:2::1"));
  assert.notEqual(clientNetwork("2001:db9:1:2::1"), clientNetwork("2001:db8:1:2::1"));
  assert.equal(clientNetwork("2001:db8::"), "v6:2001:0db8:0000:0000");
  assert.equal(clientNetwork("1:2:3:4:5:6:7::"), "v6:0001:0002:0003:0004");
});
test("IPv4-mapped IPv6 addresses count as the IPv4 address; embedded IPv4 is understood", () => {
  assert.equal(clientNetwork("::ffff:203.0.113.7"), "v4:203.0.113.7");
  assert.equal(clientNetwork("::ffff:cb00:7107"), "v4:203.0.113.7");
  assert.equal(clientNetwork("64:ff9b::1.2.3.4"), "v6:0064:ff9b:0000:0000");
});
test("anything that is not a real client address is rejected, never mapped to a shared value", () => {
  for (const bad of [undefined, null, 5, {}, [], "", "   ", "unknown", "not-an-ip", "localhost", "::", "::1", ":::", "1::2::3", "::g", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:7", "2001:db8::1:2:3:4:5:6:7", ":1:2:3:4:5:6:7", "1:2:3:4:5:6:7:", "::ffff:1.2.3.4.5", "2001:db8:1:2:3:4:5:1.2.3.4", "12345::1", "x".repeat(65), "<script>"]) {
    assert.equal(clientNetwork(bad), null, JSON.stringify(bad));
  }
});
test("keys are per bucket and per client network, hashed, never contain the address, and are stable", async () => {
  const a = await rateLimitKey(PEPPER, "login", "203.0.113.7");
  assert.match(a, /^login:[0-9a-f]{32}$/);
  assert.equal(a, await rateLimitKey(PEPPER, "login", "203.0.113.7"));
  assert.notEqual(a, await rateLimitKey(PEPPER, "callback", "203.0.113.7"));
  assert.notEqual(a, await rateLimitKey(PEPPER, "login", "203.0.113.8"));
  assert.notEqual(a, await rateLimitKey("q".repeat(43) + "A1b2C3", "login", "203.0.113.7"), "the hash is keyed by the pepper");
  assert.equal(await rateLimitKey(PEPPER, "login", "2001:db8:1:2::1"), await rateLimitKey(PEPPER, "login", "2001:db8:1:2:9::9"));
  for (const k of [a, await rateLimitKey(PEPPER, "logout", "2001:db8:1:2::1")]) assert.ok(!/203|2001|db8|v4|v6/.test(k.split(":")[1]), k);
  assert.equal(await rateLimitKey(PEPPER, "login", "nope"), null);
  assert.equal(await rateLimitKey(PEPPER, "admin", "203.0.113.7"), null, "unknown buckets are refused");
  assert.deepEqual([...BUCKETS], ["login", "callback", "logout", "profile", "feedback"]);
});
test("isRateLimited: only an explicit success:false limits; a missing binding, bad result, error or unattributable client never does", async () => {
  const mk = (limit) => ({ PORTAL_RATE_LIMITER: { limit } });
  assert.equal(await isRateLimited(mk(async () => ({ success: false })), req("203.0.113.7"), CFG, "login"), true);
  for (const result of [{ success: true }, undefined, null, {}, "no", 0, { success: "false" }]) assert.equal(await isRateLimited(mk(async () => result), req("203.0.113.7"), CFG, "login"), false, JSON.stringify(result));
  assert.equal(await isRateLimited(mk(async () => { throw new Error("boom"); }), req("203.0.113.7"), CFG, "login"), false, "fails open");
  assert.equal(await isRateLimited({}, req("203.0.113.7"), CFG, "login"), false, "no binding");
  assert.equal(await isRateLimited({ PORTAL_RATE_LIMITER: {} }, req("203.0.113.7"), CFG, "login"), false, "not a limiter");
  assert.equal(await isRateLimited(undefined, req("203.0.113.7"), CFG, "login"), false);
  assert.equal(await isRateLimited(mk(async () => ({ success: false })), req("203.0.113.7"), CFG, "unknown-bucket"), false);
  let calls = 0;
  for (const ip of [undefined, "", "unknown", "garbage", "::1"]) assert.equal(await isRateLimited(mk(async () => { calls++; return { success: false }; }), req(ip), CFG, "callback"), false, String(ip));
  assert.equal(calls, 0, "an unattributable client never reaches the limiter, so it cannot share (or exhaust) anyone's counter");
});
test("one client cannot use up another's allowance: counters are separate per network and per bucket", async () => {
  const seen = new Map();
  const env = { PORTAL_RATE_LIMITER: { limit: async ({ key }) => { const n = (seen.get(key) || 0) + 1; seen.set(key, n); return { success: n <= 20 }; } } };
  for (let i = 0; i < 25; i++) await isRateLimited(env, req("203.0.113.7"), CFG, "callback");
  assert.equal(await isRateLimited(env, req("203.0.113.7"), CFG, "callback"), true, "the noisy client is limited");
  assert.equal(await isRateLimited(env, req("203.0.113.8"), CFG, "callback"), false, "another client is not");
  assert.equal(await isRateLimited(env, req("203.0.113.7"), CFG, "login"), false, "another bucket is not");
  assert.equal(await isRateLimited(env, req("2001:db8:1:2::5"), CFG, "callback"), false);
});

/* ------------------------------------------------------------------ diagnostic outcomes */
const bind = (limit) => ({ PORTAL_RATE_LIMITER: { limit } });

test("checkRateLimit: the fixed outcome set is exactly the six reviewed words", () => {
  assert.deepEqual([...RATE_LIMIT_OUTCOMES], ["ok", "limited", "no_binding", "no_client_ip", "limiter_error", "unexpected_result"]);
  assert.ok(Object.isFrozen(RATE_LIMIT_OUTCOMES));
});
test("checkRateLimit: ok and limited come from the binding's explicit answer, and only limited limits", async () => {
  assert.deepEqual(await checkRateLimit(bind(async () => ({ success: true })), req("203.0.113.7"), CFG, "login"), { limited: false, outcome: "ok" });
  assert.deepEqual(await checkRateLimit(bind(async () => ({ success: false })), req("203.0.113.7"), CFG, "login"), { limited: true, outcome: "limited" });
});
test("checkRateLimit: no_binding when the binding is absent or is not a limiter", async () => {
  for (const env of [undefined, null, {}, { PORTAL_RATE_LIMITER: undefined }, { PORTAL_RATE_LIMITER: {} }, { PORTAL_RATE_LIMITER: { limit: "nope" } }, { PORTAL_RATE_LIMITER: "x" }]) {
    assert.deepEqual(await checkRateLimit(env, req("203.0.113.7"), CFG, "login"), { limited: false, outcome: "no_binding" }, JSON.stringify(env));
  }
});
test("checkRateLimit: no_client_ip when the address is missing or invalid, and the binding is never called", async () => {
  let calls = 0;
  const env = bind(async () => { calls++; return { success: false }; });
  for (const ip of [undefined, "", "unknown", "not-an-ip", "999.1.1.1", "::", "::1", "1.2.3"]) {
    assert.deepEqual(await checkRateLimit(env, req(ip), CFG, "callback"), { limited: false, outcome: "no_client_ip" }, String(ip));
  }
  assert.equal(calls, 0);
});
test("checkRateLimit: limiter_error when limit() throws (or the bucket is not ours), and nothing about the error is kept", async () => {
  const secret = "203.0.113.7 sk_test_SECRET " + PEPPER;
  const results = [
    await checkRateLimit(bind(async () => { throw new Error(secret); }), req("203.0.113.7"), CFG, "login"),
    await checkRateLimit(bind(() => { throw new TypeError(secret); }), req("203.0.113.7"), CFG, "logout"),
    await checkRateLimit(bind(() => Promise.reject(secret)), req("203.0.113.7"), CFG, "callback"),
    await checkRateLimit(bind(async () => ({ success: false })), req("203.0.113.7"), CFG, "admin"),
  ];
  for (const r of results) {
    assert.deepEqual(r, { limited: false, outcome: "limiter_error" });
    assert.deepEqual(Object.keys(r).sort(), ["limited", "outcome"], "no extra properties such as an error or key");
    assert.ok(!JSON.stringify(r).includes("SECRET") && !JSON.stringify(r).includes("203"));
  }
});
test("checkRateLimit: unexpected_result for anything but an explicit success true/false (and it fails open)", async () => {
  for (const result of [undefined, null, {}, { success: "false" }, { success: "true" }, { success: 1 }, { success: null }, "no", 0, [], true]) {
    assert.deepEqual(await checkRateLimit(bind(async () => result), req("203.0.113.7"), CFG, "login"), { limited: false, outcome: "unexpected_result" }, JSON.stringify(result));
  }
});
test("isRateLimited keeps its boolean behaviour for every outcome", async () => {
  const cases = [[async () => ({ success: false }), true], [async () => ({ success: true }), false], [async () => { throw new Error("x"); }, false], [async () => undefined, false], [async () => ({ success: "false" }), false]];
  for (const [limit, expected] of cases) assert.equal(await isRateLimited(bind(limit), req("203.0.113.7"), CFG, "login"), expected);
  assert.equal(await isRateLimited({}, req("203.0.113.7"), CFG, "login"), false);
  assert.equal(await isRateLimited(bind(async () => ({ success: false })), req(undefined), CFG, "login"), false);
});
test("the limiter module itself never writes logs and its catch block keeps no error details", () => {
  const src = readFileSync(new URL("../portal/ratelimit.js", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/console\.|logEvent/.test(src));
  assert.ok(/catch \{/.test(src) && !/catch \(/.test(src), "the exception is not even bound to a variable");
});
