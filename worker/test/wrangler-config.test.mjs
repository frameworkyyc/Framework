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

const PORTAL_PRODUCTION = { binding: "PORTAL_DB", database_name: "framework-portal", database_id: "b213b7db-ed29-4ab6-946c-0728dd6709e8", migrations_dir: "migrations/portal" };

test("Production: exactly two D1 bindings: DB -> framework-feedback (original ID unchanged) and PORTAL_DB -> framework-portal", () => {
  assert.deepEqual(config.d1_databases, [PRODUCTION, PORTAL_PRODUCTION]);
});

const PORTAL_STAGING = { binding: "PORTAL_DB", database_name: "framework-portal-staging", database_id: "1edda8a2-5249-4f40-9dbc-d29aa44e21f8", migrations_dir: "migrations/portal" };

test("Staging (Preview): DB -> framework-staging is preserved, plus PORTAL_DB -> framework-portal-staging", () => {
  assert.deepEqual(config.previews.d1_databases, [STAGING, PORTAL_STAGING]);
});

test("Production's portal resources are exactly: its own portal database, the WorkOS settings, the four launch switches, the limiter; the two private R2 buckets (Stage 3) and no probe flag, and no client-feature switch", () => {
  assert.deepEqual(config.previews.r2_buckets, [{ binding: "PORTAL_FILES", bucket_name: "framework-portal-files-staging" }, { binding: "PORTAL_FILES_BACKUP", bucket_name: "framework-portal-files-staging-backup" }]);
  assert.deepEqual(config.r2_buckets, [{ binding: "PORTAL_FILES", bucket_name: "framework-portal-files" }, { binding: "PORTAL_FILES_BACKUP", bucket_name: "framework-portal-files-backup" }]);
  assert.equal(config.vars.PORTAL_BRANDING, undefined, "Branding stays off for Production clients until Stage 4");
  assert.equal(config.vars.PORTAL_SERVICES, undefined, "Client Services stay off for Production clients until Stage 4");
  assert.equal(config.vars.ASSESSMENT_NOTIFY_TO, "hello@frameworkco.ca");
  assert.deepEqual(config.triggers, { crons: ["0-59/5 * * * *"] }, "the Stage 5 schedule: Production only");
  assert.equal(config.previews.triggers, undefined);
  assert.deepEqual(Object.keys(config.vars).filter((k) => k.startsWith("PORTAL_")).sort(), ["PORTAL_ADMIN_WRITES", "PORTAL_ALLOW_PRODUCTION", "PORTAL_AUTH_CLIENT_ID", "PORTAL_AUTH_ISSUER", "PORTAL_BASE_URL", "PORTAL_ENABLED", "PORTAL_INVITE_SENDING"]);
  const before = raw.slice(0, raw.indexOf('"previews"')).replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/PORTAL_PROBE|PORTAL_DEMO/.test(before), "no probe flag and no demo switch before the previews block");
  assert.equal(before.split('"bucket_name": "framework-portal-files"').length - 1, 1, "the Production files bucket is bound exactly once, outside previews");
});

test("the Production and Staging portal databases are different, and neither is the feedback or Staging assessment database", () => {
  const prod = config.d1_databases.find((d) => d.binding === "PORTAL_DB"), stag = config.previews.d1_databases.find((d) => d.binding === "PORTAL_DB");
  assert.notEqual(prod.database_id, stag.database_id);
  assert.notEqual(prod.database_name, stag.database_name);
  assert.equal(prod.database_name, "framework-portal");
  const feedbackIds = [PRODUCTION.database_id, STAGING.database_id];
  assert.ok(!feedbackIds.includes(prod.database_id) && !feedbackIds.includes(stag.database_id));
  assert.equal(raw.split(prod.database_id).length - 1, 1, "the Production portal id appears exactly once, never inside previews");
  assert.ok(!JSON.stringify(config.previews).includes(prod.database_id));
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

test("Production (top-level vars) and Staging (previews.vars) each carry the sender, the same public Turnstile site key and their OWN WorkOS settings; both enable the portal (Production since launch), only Staging also has the demo", () => {
  const shared = { ASSESSMENT_FROM: "Framework <hello@frameworkco.ca>", TURNSTILE_SITE_KEY: "0x4AAAAAAFZzTbJqfnTzJNss" };
  assert.deepEqual(config.vars, { ...shared, ASSESSMENT_NOTIFY_TO: "hello@frameworkco.ca", PORTAL_AUTH_CLIENT_ID: "client_01M58C4236FYNJDQ3MM0E8V691", PORTAL_BASE_URL: "https://frameworkco.ca", PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C4236FYNJDQ3MM0E8V691", PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1", PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1" });
  assert.deepEqual(config.previews.vars, { ...shared, PORTAL_AUTH_CLIENT_ID: "client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_BASE_URL: "https://staging.frameworkco.ca", PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C412YHC548S5JXP1TJ2ED", PORTAL_ENABLED: "1", PORTAL_DEMO: "1", PORTAL_ADMIN_WRITES: "1", PORTAL_INVITE_SENDING: "1", PORTAL_BRANDING: "1", PORTAL_SERVICES: "1" });
});

test("the verified WorkOS issuer is pinned and belongs to the configured client id (not the bare api.workos.com base)", () => {
  const { PORTAL_AUTH_ISSUER, PORTAL_AUTH_CLIENT_ID } = config.previews.vars;
  assert.equal(PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + PORTAL_AUTH_CLIENT_ID);
  assert.notEqual(PORTAL_AUTH_ISSUER, "https://api.workos.com");
});

test("the WorkOS client ids are public ids (client_…), differ between Staging and Production, and no secret-shaped value sits beside them", () => {
  assert.match(config.previews.vars.PORTAL_AUTH_CLIENT_ID, /^client_[0-9A-Z]{20,40}$/);
  assert.match(config.vars.PORTAL_AUTH_CLIENT_ID, /^client_[0-9A-Z]{20,40}$/);
  assert.notEqual(config.vars.PORTAL_AUTH_CLIENT_ID, config.previews.vars.PORTAL_AUTH_CLIENT_ID);
  assert.equal(config.vars.PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + config.vars.PORTAL_AUTH_CLIENT_ID);
  assert.ok(!/sk_(test|live)_/.test(raw));
});

test("every portal setting the portal needs is either declared in the file (both environments) or listed as a Cloudflare secret", () => {
  const needed = ["PORTAL_BASE_URL", "PORTAL_AUTH_CLIENT_ID", "PORTAL_AUTH_ISSUER"];
  for (const name of needed) assert.ok(name in config.previews.vars && name in config.vars, name + " must be in previews.vars AND vars or the next deploy deletes it");
  const secrets = ["PORTAL_AUTH_CLIENT_SECRET", "PORTAL_SESSION_PEPPER"];
  for (const name of secrets) assert.ok(!(name in config.previews.vars) && !raw.replace(/^\s*\/\/.*$/gm, "").includes(name), name + " is a secret and must not be in the file");
});

test("the Staging portal base URL is the Staging host, not the live site", () => {
  assert.equal(new URL(config.previews.vars.PORTAL_BASE_URL).hostname, "staging.frameworkco.ca");
  assert.notEqual(new URL(config.vars.PORTAL_BASE_URL).hostname, new URL(config.previews.vars.PORTAL_BASE_URL).hostname);
});

test("shared routes: the existing worker routes are unchanged and /portal + /portal/* were added in place of the three probe paths", () => {
  assert.deepEqual(config.assets.run_worker_first, ["/api/*", "/admin", "/admin/*", "/card", "/portal", "/portal/*"]);
  assert.ok(!config.assets.run_worker_first.some((p) => p === "/*" || p === "/portal/login"), "no catch-all, no leftover probe paths");
});

test("launch configuration: Production enables the portal with BOTH PORTAL_ENABLED and PORTAL_ALLOW_PRODUCTION (each exactly \"1\"); the override and the demo are never in the Staging block's place", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(config.previews.vars.PORTAL_ENABLED, "1", "Staging serves the portal");
  assert.equal(config.vars.PORTAL_ENABLED, "1");
  assert.equal(config.vars.PORTAL_ALLOW_PRODUCTION, "1", "the production override: the code refuses a production host without it");
  assert.equal([...code.matchAll(/PORTAL_ENABLED/g)].length, 2, "once per environment");
  assert.equal([...code.matchAll(/PORTAL_ALLOW_PRODUCTION/g)].length, 1, "the override is only in Production's vars");
  assert.ok(code.indexOf("PORTAL_ALLOW_PRODUCTION") < code.indexOf('"previews"'));
  assert.equal(config.vars.PORTAL_DEMO, undefined, "the demo is Staging-only (the code also refuses it on the live hosts)");
  assert.equal(config.previews.vars.PORTAL_DEMO, "1");
  assert.ok(!code.includes("PORTAL_PROBE"), "no probe flag");
});

test("each environment has its OWN portal rate limiter (same binding name, 20 requests per 60 seconds, different namespace ids)", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.deepEqual(config.previews.ratelimits, [{ name: "PORTAL_RATE_LIMITER", namespace_id: "4101", simple: { limit: 20, period: 60 } }]);
  assert.deepEqual(config.ratelimits, [{ name: "PORTAL_RATE_LIMITER", namespace_id: "4201", simple: { limit: 20, period: 60 } }]);
  assert.notEqual(config.ratelimits[0].namespace_id, config.previews.ratelimits[0].namespace_id, "equal namespace ids would share counters");
  assert.equal([...code.matchAll(/"ratelimits"/g)].length, 2, "declared once per environment");
  assert.equal([...code.matchAll(/PORTAL_RATE_LIMITER/g)].length, 2);
  assert.ok(code.indexOf('"ratelimits"') < code.indexOf('"previews"'), "Production's limiter is outside the previews block");
  assert.ok(!/\bunsafe\b/.test(code), "the supported binding type is used, not the legacy unsafe block");
  assert.ok([10, 60].includes(config.previews.ratelimits[0].simple.period), "Cloudflare only allows 10 or 60 second periods");
});

test("the Preview environment has everything the portal needs: PORTAL_DB (Staging portal database) and the non-secret WorkOS settings; secrets are not in the file", () => {
  assert.deepEqual(config.previews.d1_databases.find((d) => d.binding === "PORTAL_DB"), PORTAL_STAGING);
  const v = config.previews.vars;
  assert.match(v.PORTAL_AUTH_CLIENT_ID, /^client_/);
  assert.equal(v.PORTAL_BASE_URL, "https://staging.frameworkco.ca");
  assert.equal(v.PORTAL_AUTH_ISSUER, "https://api.workos.com/user_management/" + v.PORTAL_AUTH_CLIENT_ID);
  assert.deepEqual(config.d1_databases.find((d) => d.binding === "PORTAL_DB"), PORTAL_PRODUCTION, "Production has its own, different portal database");
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
  const allowed = new Set(["ASSESSMENT_FROM", "ASSESSMENT_NOTIFY_TO", "TURNSTILE_SITE_KEY", "META_PIXEL_ID", "PORTAL_BASE_URL", "PORTAL_AUTH_ISSUER", "PORTAL_AUTH_CLIENT_ID", "PORTAL_ENABLED", "PORTAL_ALLOW_PRODUCTION", "PORTAL_BRANDING", "PORTAL_SERVICES", "PORTAL_ADMIN_WRITES", "PORTAL_INVITE_SENDING", "PORTAL_DEMO"]);
  for (const name of ["PORTAL_ADMIN_WRITES", "PORTAL_INVITE_SENDING"]) {
    assert.equal(config.vars[name], "1", name + " is on in Production since launch (invitations are still limited to the allowlist secret)");
    assert.equal(config.previews.vars[name], "1", name + " is on for Staging (invitations are still limited to the allowlist secret)");
  }
  assert.equal(config.vars.PORTAL_DEMO, undefined, "the demo is never a Production setting");
  assert.equal(config.previews.vars.PORTAL_ALLOW_PRODUCTION, undefined, "the production override is never a Staging setting");
  for (const vars of [config.vars, config.previews.vars]) for (const name of ["PORTAL_INVITE_ALLOWLIST", "PORTAL_INVITE_ALLOWED_EMAILS"]) assert.equal(vars[name], undefined, name + " is a Cloudflare secret, never a checked-in variable (the repository is public)");
  for (const vars of [config.vars, config.previews.vars]) for (const name of Object.keys(vars)) assert.ok(allowed.has(name), name + " is not an approved non-secret variable");
});

test("no secrets are committed in wrangler.jsonc", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/RESEND_API_KEY|TURNSTILE_SECRET|ACCESS_AUD|ACCESS_TEAM_DOMAIN|ADMIN_EMAILS|IP_HASH_SALT|PORTAL_AUTH_CLIENT_SECRET|PORTAL_SESSION_PEPPER|sk_(test|live)_|re_[A-Za-z0-9]{10,}/.test(code));
});

test("Staging AND Production: query strings redacted (no ?code= or ?invitation_token= in platform logs), application logs on, automatic invocation logs OFF", () => {
  const expected = { enabled: true, redact_query_string: true, logs: { enabled: true, invocation_logs: false } };
  assert.deepEqual(config.previews.observability, expected);
  assert.deepEqual(config.observability, expected, "Production gets the same log protection BEFORE the portal can be enabled");
});

test("observability does not otherwise reduce monitoring (either environment): no sampling override, logs persisted, tracing and destinations untouched", () => {
 for (const o of [config.previews.observability, config.observability]) {
  assert.equal(o.enabled, true);
  assert.equal(o.logs.enabled, true, "application logs and errors stay on");
  assert.equal(o.head_sampling_rate, undefined);
  assert.equal(o.logs.head_sampling_rate, undefined, "default 100% sampling");
  assert.equal(o.logs.persist, undefined);
  assert.equal(o.logs.destinations, undefined);
  assert.equal(o.traces, undefined);
  assert.deepEqual(Object.keys(o.logs).sort(), ["enabled", "invocation_logs"]);
 }
});

test("migrations_dir safeguard: both PORTAL_DB bindings point at migrations/portal (portal migrations only); the feedback DB bindings keep their default", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const portal = [config.d1_databases.find((d) => d.binding === "PORTAL_DB"), config.previews.d1_databases.find((d) => d.binding === "PORTAL_DB")];
  for (const d of portal) assert.equal(d.migrations_dir, "migrations/portal", d.database_name);
  for (const d of [...config.d1_databases, ...config.previews.d1_databases].filter((d) => d.binding === "DB")) assert.equal(d.migrations_dir, undefined, d.database_name + ": the feedback binding is unchanged (default ./migrations)");
  const dir = new URL("../../migrations/portal/", import.meta.url);
  assert.ok(existsSync(dir));
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".sql")), ["0001_portal_foundation.sql", "0002_business_profile.sql", "0003_portal_feedback.sql", "0004_invitation_delivery.sql", "0005_branding.sql", "0006_brand_name.sql", "0007_client_services.sql", "0008_approved_emails.sql"], "exactly the four reviewed portal migrations are visible through that directory");
  const feedback = readdirSync(new URL("../../migrations/", import.meta.url)).filter((f) => f.endsWith(".sql"));
  assert.ok(feedback.length >= 6 && !feedback.some((f) => /portal/.test(f)), "the feedback migrations stay in ./migrations and are never visible to PORTAL_DB");
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.equal([...code.matchAll(/migrations_dir/g)].length, 2, "only the two portal bindings declare one");
});

test("the static demo portal is switched on for Staging ONLY: PORTAL_DEMO is in previews.vars and nowhere else", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.equal(config.previews.vars.PORTAL_DEMO, "1");
  assert.ok(!("PORTAL_DEMO" in config.vars), "Production vars do not carry the demo flag");
  assert.equal([...code.matchAll(/PORTAL_DEMO/g)].length, 1);
  assert.ok(code.indexOf("PORTAL_DEMO") > code.indexOf('"previews"'));
});
