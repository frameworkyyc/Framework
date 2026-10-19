// Run with:  node --test worker/test/*.mjs
// Guards the database wiring in wrangler.jsonc: Production must stay on framework-feedback, Staging (the Preview)
// must stay on its own framework-staging database, and the two must never be mixed up.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { emailConfig } from "../assessment.js";

const raw = readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8");
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")); // the file only uses whole-line comments

const PRODUCTION = { binding: "DB", database_name: "framework-feedback", database_id: "47d90f94-3846-4711-9495-ab3479431a6f" };
const STAGING = { binding: "DB", database_name: "framework-staging", database_id: "c4815cdc-8948-4561-92a3-65e4860cdb94" };

test("Production: exactly one D1 binding, DB -> framework-feedback, original ID unchanged", () => {
  assert.deepEqual(config.d1_databases, [PRODUCTION]);
});

const PORTAL_STAGING = { binding: "PORTAL_DB", database_name: "framework-portal-staging", database_id: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8" };

test("Staging (Preview): DB -> framework-staging is preserved, plus PORTAL_DB -> framework-portal-staging", () => {
  assert.deepEqual(config.previews.d1_databases, [STAGING, PORTAL_STAGING]);
});

test("the client portal resources exist ONLY in the Preview block, never in Production's top-level config", () => {
  assert.deepEqual(config.previews.r2_buckets, [{ binding: "PORTAL_FILES", bucket_name: "framework-portal-files-staging" }]);
  assert.equal(config.r2_buckets, undefined);
  assert.ok(!JSON.stringify(config.d1_databases).includes("portal"));
  assert.ok(!Object.keys(config.vars).some((k) => k.startsWith("PORTAL_")));
  assert.ok(!raw.slice(0, raw.indexOf('"previews"')).replace(/^\s*\/\/.*$/gm, "").includes("PORTAL_"), "nothing portal-related before the previews block except the shared route list");
});

test("the two environments use the same binding name but different databases", () => {
  const stagingDb = config.previews.d1_databases.find((d) => d.binding === "DB");
  assert.equal(config.d1_databases[0].binding, stagingDb.binding);
  assert.notEqual(config.d1_databases[0].database_id, stagingDb.database_id);
  assert.notEqual(config.d1_databases[0].database_name, stagingDb.database_name);
});

test("the Production ID appears exactly once in the file (never inside the previews block)", () => {
  assert.equal(raw.split(PRODUCTION.database_id).length - 1, 1);
  assert.ok(!JSON.stringify(config.previews).includes(PRODUCTION.database_id));
  assert.ok(!JSON.stringify(config.previews).includes("framework-feedback"));
});

test("Production (top-level vars) and Staging (previews.vars) each carry the sender and the same public Turnstile site key; Staging adds the portal settings and enables the portal", () => {
  const shared = { ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", TURNSTILE_SITE_KEY: "0x4AAAAAAFZzTbJqfnTzJNss" };
  assert.deepEqual(config.vars, shared);
  assert.deepEqual(config.previews.vars, { ...shared, PORTAL_AUTH_CLIENT_ID: "client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_BASE_URL: "https://staging.frameworkco.ca", PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_ENABLED: "1" });
});

test("the verified WorkOS issuer is pinned and belongs to the configured client id (not the bare api.workos.com base)", () => {
  const { PORTAL_AUTH_ISSUER, PORTAL_AUTH_CLIENT_ID } = config.previews.vars;
  assert.equal(PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + PORTAL_AUTH_CLIENT_ID);
  assert.notEqual(PORTAL_AUTH_ISSUER, "https://api.workos.com");
});

test("the WorkOS client id is a public id (client_…), is Staging-only, and no secret-shaped value sits beside it", () => {
  assert.match(config.previews.vars.PORTAL_AUTH_CLIENT_ID, /^client_[0-9A-Z]{20,40}$/);
  assert.equal(config.vars.PORTAL_AUTH_CLIENT_ID, undefined);
  assert.ok(!/sk_(test|live)_/.test(raw));
});

test("every portal setting the portal needs is either declared in previews or listed as a Cloudflare secret", () => {
  const needed = ["PORTAL_BASE_URL", "PORTAL_AUTH_CLIENT_ID", "PORTAL_AUTH_ISSUER"];
  for (const name of needed) assert.ok(name in config.previews.vars, name + " must be in previews.vars or the next deploy deletes it");
  const secrets = ["PORTAL_AUTH_CLIENT_SECRET", "PORTAL_SESSION_PEPPER"];
  for (const name of secrets) assert.ok(!(name in config.previews.vars) && !raw.replace(/^\s*\/\/.*$/gm, "").includes(name), name + " is a secret and must not be in the file");
});

test("the Staging portal base URL is the Staging host, not the live site", () => {
  assert.equal(new URL(config.previews.vars.PORTAL_BASE_URL).hostname, "staging.frameworkco.ca");
  assert.ok(!JSON.stringify(config.vars).includes("frameworkco.ca/portal"));
});

test("shared routes: the existing worker routes are unchanged and /portal + /portal/* were added in place of the three probe paths", () => {
  assert.deepEqual(config.assets.run_worker_first, ["/api/*", "/admin", "/admin/*", "/card", "/portal", "/portal/*"]);
  assert.ok(!config.assets.run_worker_first.some((p) => p === "/*" || p === "/portal/login"), "no catch-all, no leftover probe paths");
});

test("the portal is enabled for Staging ONLY: PORTAL_ENABLED is \"1\" in previews.vars and exists nowhere else", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(config.previews.vars.PORTAL_ENABLED, "1");
  assert.equal([...code.matchAll(/PORTAL_ENABLED/g)].length, 1, "exactly one occurrence in the whole file");
  assert.ok(code.indexOf("PORTAL_ENABLED") > code.indexOf('"previews"'), "and it is inside the previews block");
  assert.ok(!("PORTAL_ENABLED" in config.vars), "Production vars do not enable the portal");
  assert.ok(!Object.keys(config.vars).some((k) => k.startsWith("PORTAL_")), "Production vars carry no portal setting at all");
  assert.ok(!code.includes("PORTAL_PROBE") && !code.includes("PORTAL_ALLOW_PRODUCTION"), "no probe flag, and no override that would let the portal run on the live hosts");
  assert.ok(!/PORTAL_RATE_LIMITER|ratelimits/.test(code));
});

test("the Preview environment has everything the portal needs: PORTAL_DB (Staging portal database) and the non-secret WorkOS settings; secrets are not in the file", () => {
  assert.deepEqual(config.previews.d1_databases.find((d) => d.binding === "PORTAL_DB"), PORTAL_STAGING);
  const v = config.previews.vars;
  assert.match(v.PORTAL_AUTH_CLIENT_ID, /^client_/);
  assert.equal(v.PORTAL_BASE_URL, "https://staging.frameworkco.ca");
  assert.equal(v.PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + v.PORTAL_AUTH_CLIENT_ID);
  assert.ok(!config.d1_databases.some((d) => d.binding === "PORTAL_DB"), "Production has no portal database");
});

test("the sender is a valid From value that the Worker accepts as-is (no correction needed)", () => {
  for (const vars of [config.vars, config.previews.vars]) {
    const cfg = emailConfig({ RESEND_API_KEY: "placeholder", ASSESSMENT_FROM: vars.ASSESSMENT_FROM });
    assert.equal(cfg.ok, true);
    assert.equal(cfg.fromCorrected, false);
    assert.equal(cfg.from, "Framework <hello@frameworkco.ca>");
  }
});

test("only whitelisted NON-secret names may ever appear under vars", () => {
  const allowed = new Set(["ASSESSMENT_FROM", "ASSESSMENT_NOTIFY_TO", "TURNSTILE_SITE_KEY", "META_PIXEL_ID", "PORTAL_BASE_URL", "PORTAL_AUTH_ISSUER", "PORTAL_AUTH_CLIENT_ID", "PORTAL_ENABLED"]);
  for (const vars of [config.vars, config.previews.vars]) for (const name of Object.keys(vars)) assert.ok(allowed.has(name), name + " is not an approved non-secret variable");
});

test("no secrets are committed in wrangler.jsonc", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/RESEND_API_KEY|TURNSTILE_SECRET|ACCESS_AUD|ACCESS_TEAM_DOMAIN|ADMIN_EMAILS|IP_HASH_SALT|PORTAL_AUTH_CLIENT_SECRET|PORTAL_SESSION_PEPPER|sk_(test|live)_|re_[A-Za-z0-9]{10,}/.test(code));
});

test("Staging: query strings redacted, application logs on, automatic invocation logs OFF; Production observability is unchanged", () => {
  assert.deepEqual(config.previews.observability, { enabled: true, redact_query_string: true, logs: { enabled: true, invocation_logs: false } });
  assert.deepEqual(config.observability, { enabled: true }, "Production observability must stay exactly as it was");
  assert.equal(config.observability.redact_query_string, undefined);
  assert.equal(config.observability.logs, undefined, "Production keeps its automatic invocation logs untouched");
});

test("Staging observability does not otherwise reduce monitoring: no sampling override, logs persisted, tracing and destinations untouched", () => {
  const o = config.previews.observability;
  assert.equal(o.enabled, true);
  assert.equal(o.logs.enabled, true, "application logs and errors stay on");
  assert.equal(o.head_sampling_rate, undefined);
  assert.equal(o.logs.head_sampling_rate, undefined, "default 100% sampling");
  assert.equal(o.logs.persist, undefined);
  assert.equal(o.logs.destinations, undefined);
  assert.equal(o.traces, undefined);
  assert.deepEqual(Object.keys(o.logs).sort(), ["enabled", "invocation_logs"]);
});
