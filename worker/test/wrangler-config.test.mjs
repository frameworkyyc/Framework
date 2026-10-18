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

test("Staging (Preview): exactly one D1 binding, DB -> framework-staging", () => {
  assert.deepEqual(config.previews.d1_databases, [STAGING]);
});

test("the two environments use the same binding name but different databases", () => {
  assert.equal(config.d1_databases[0].binding, config.previews.d1_databases[0].binding);
  assert.notEqual(config.d1_databases[0].database_id, config.previews.d1_databases[0].database_id);
  assert.notEqual(config.d1_databases[0].database_name, config.previews.d1_databases[0].database_name);
});

test("the Production ID appears exactly once in the file (never inside the previews block)", () => {
  assert.equal(raw.split(PRODUCTION.database_id).length - 1, 1);
  assert.ok(!JSON.stringify(config.previews).includes(PRODUCTION.database_id));
  assert.ok(!JSON.stringify(config.previews).includes("framework-feedback"));
});

test("Production has no vars in the config (untouched by this change); Staging's only config variable is the non-secret sender", () => {
  assert.equal(config.vars, undefined);
  assert.deepEqual(Object.keys(config.previews.vars), ["ASSESSMENT_FROM"]);
});

test("the Staging sender is a valid From value that the Worker accepts as-is (no correction needed)", () => {
  const cfg = emailConfig({ RESEND_API_KEY: "placeholder", ASSESSMENT_FROM: config.previews.vars.ASSESSMENT_FROM });
  assert.equal(cfg.ok, true);
  assert.equal(cfg.fromCorrected, false);
  assert.equal(cfg.from, "Framework <hello@frameworkco.ca>");
});

test("no secrets are committed in wrangler.jsonc", () => {
  const code = raw.replace(/^\s*\/\/.*$/gm, "");
  assert.ok(!/RESEND_API_KEY|TURNSTILE_SECRET|ACCESS_AUD|ACCESS_TEAM_DOMAIN|ADMIN_EMAILS|IP_HASH_SALT|re_[A-Za-z0-9]{10,}/.test(code));
});
