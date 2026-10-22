// Launch guard: Production portal activation must never be configured without the portal privacy disclosures in privacy.html.
// Situations: Staging (disclosures required), Production with the portal off (website-only policy acceptable), Production with the portal on or armed (mandatory).
import test from "node:test";
import assert from "node:assert/strict";
import { portalMode } from "../portal/config.js";
import {
  read, parseWrangler, productionPortalState, targetBranch, portalDisclosuresRequired, portalDisclosureProblems, portalSectionText, assertPortalPrivacyReady,
} from "./helpers/portal-privacy-guard.mjs";

const wrangler = read("wrangler.jsonc");
const config = parseWrangler(wrangler);
const html = read("privacy.html");

// ---- fixtures --------------------------------------------------------------------------------------------------------------------------------------------
// Fixtures start from a baseline with both Production flags removed, so these unit tests do not depend on what the real file says today.
const { PORTAL_ENABLED: _e, PORTAL_ALLOW_PRODUCTION: _a, ...baseVars } = config.vars;
const BASE = { ...config, vars: baseVars, env: undefined };
const withVars = (vars, extra = {}) => ({ ...BASE, vars: { ...BASE.vars, ...vars }, ...extra });
const OFF = BASE, ARMED_ENABLED = withVars({ PORTAL_ENABLED: "1" }), ARMED_ALLOW = withVars({ PORTAL_ALLOW_PRODUCTION: "1" }), ON = withVars({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1" });

const SECTION_BODY = "The client portal is available only to people we invite, and it is currently in a private beta, so some details may change as we learn. ".repeat(3)
  + "We use WorkOS to sign people in with a one-time code. Each organization can see only its own information. Authorized Framework personnel can view client information only when needed. "
  + "Clients currently sign in with an email code only; we do not currently require a second sign-in step for clients. We review inactive beta accounts after 12 months. ".repeat(2)
  + "Portal accounts, organizations, answers, feedback and records are stored in a Cloudflare database. ".repeat(9);
const COLLECT = "Business Profile information: services, timeline, your approximate budget. Portal feedback. Sign-in and security records. Activity records. Invitation records. "
  + "Cookies __Host-fw_auth and __Host-fw_portal. We use this information to understand your business, assess your needs, prepare proposals and plan projects.";
const policyWith = (section, collect = COLLECT) => `<main><h2 id="collect">Information we collect</h2><p>${collect}</p><h2 id="portal">The client portal</h2><p>${section}</p><h2 id="cookies">Cookies</h2></main>`;
const FULL = policyWith(SECTION_BODY);
const WEBSITE_ONLY = `<main><h2 id="collect">Information we collect</h2><p>Assessment requests, feedback and technical information.</p><h2 id="cookies">Cookies</h2></main>`;

// ---- how the flags behave: the guard must agree with the code, and one flag is not the whole story ---------------------------------------------------------
const fakeDb = { prepare() {}, batch() {} };
const productionEnv = (flags) => ({
  PORTAL_BASE_URL: "https://frameworkco.ca", PORTAL_AUTH_CLIENT_ID: "client_01M58C4236FYNJDQ3MM0E8V691", PORTAL_AUTH_CLIENT_SECRET: "x",
  PORTAL_AUTH_ISSUER: "https://api.workos.com/user_management/client_01M58C4236FYNJDQ3MM0E8V691", PORTAL_SESSION_PEPPER: "aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3lO6rU9xA2bD5eG8kM",
  PORTAL_DB: fakeDb, ...flags,
});

test("flag behaviour: the code needs BOTH flags to serve the portal on the live host; the guard treats either flag alone as armed and both as on", () => {
  assert.equal(portalMode(productionEnv({})), "off");
  assert.equal(portalMode(productionEnv({ PORTAL_ENABLED: "1" })), "misconfigured", "ENABLED alone is refused by the code (production host not approved) but is one flag from live");
  assert.equal(portalMode(productionEnv({ PORTAL_ALLOW_PRODUCTION: "1" })), "off", "ALLOW alone does nothing yet but is armed");
  assert.equal(portalMode(productionEnv({ PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1" })), "on");
  assert.equal(productionPortalState(OFF), "off");
  assert.equal(productionPortalState(ARMED_ENABLED), "armed");
  assert.equal(productionPortalState(ARMED_ALLOW), "armed");
  assert.equal(productionPortalState(ON), "on");
  // only exactly "1" counts, as in the code; other values do not activate
  assert.equal(productionPortalState(withVars({ PORTAL_ENABLED: "0", PORTAL_ALLOW_PRODUCTION: "true" })), "off");
  // a flag in any non-Staging environment block counts too; the two flags in DIFFERENT blocks are armed, not on
  assert.equal(productionPortalState({ ...BASE, env: { prod: { vars: { PORTAL_ENABLED: "1", PORTAL_ALLOW_PRODUCTION: "1" } } } }), "on");
  assert.equal(productionPortalState({ ...BASE, vars: { ...BASE.vars, PORTAL_ENABLED: "1" }, env: { other: { vars: { PORTAL_ALLOW_PRODUCTION: "1" } } } }), "armed");
});

test("the Staging previews block is not Production: enabling the portal there never counts as Production activation", () => {
  assert.equal(config.previews.vars.PORTAL_ENABLED, "1", "Staging serves the portal");
  assert.equal(productionPortalState({ ...BASE, previews: config.previews }), "off", "and that does not arm Production");
});

// ---- which situation are we in? --------------------------------------------------------------------------------------------------------------------------
test("target branch: an explicit override, the pull request's target, the pushed branch, then the checked-out branch", () => {
  assert.equal(targetBranch({ PRIVACY_TEST_TARGET: "main" }, () => "x"), "main");
  assert.equal(targetBranch({ GITHUB_BASE_REF: "Staging", GITHUB_REF_NAME: "12/merge", GITHUB_EVENT_NAME: "pull_request" }, () => "x"), "Staging");
  assert.equal(targetBranch({ GITHUB_REF_NAME: "main", GITHUB_EVENT_NAME: "push" }, () => "x"), "main");
  assert.equal(targetBranch({}, () => "feature/x"), "feature/x");
});

test("relaxed ONLY for a Production-bound change with the portal off: Staging, unknown branches, armed and on are all strict", () => {
  assert.equal(portalDisclosuresRequired({ target: "main", state: "off" }), false);
  for (const target of ["Staging", "", "feature/x", undefined]) assert.equal(portalDisclosuresRequired({ target, state: "off" }), true, "target " + target);
  for (const state of ["armed", "on"]) for (const target of ["main", "Staging"]) assert.equal(portalDisclosuresRequired({ target, state }), true, `${target} ${state}`);
});

// ---- the disclosure check itself: meaningful content, not a placeholder ----------------------------------------------------------------------------------
test("disclosure check: a complete portal section passes; a missing, tiny, placeholder or anchor-less one fails", () => {
  assert.deepEqual(portalDisclosureProblems(FULL), []);
  assert.ok(portalDisclosureProblems(WEBSITE_ONLY).length, "no portal section");
  assert.match(portalDisclosureProblems(policyWith("TBD"))[0], /characters|heading|placeholder/, "a placeholder section");
  assert.ok(portalDisclosureProblems(policyWith("The client portal. TODO write this.")).length);
  assert.ok(portalDisclosureProblems(`<h2 id="portal">The client portal</h2>`).length, "heading only");
  assert.ok(portalDisclosureProblems(policyWith("The client portal. " + "x ".repeat(1200))).some((p) => /does not mention/.test(p)), "long but meaningless text still fails");
  assert.ok(portalDisclosureProblems(policyWith(SECTION_BODY + " This part is TBD.")).some((p) => /placeholder/.test(p)));
  // each anchor matters: removing any one of them fails the check
  for (const [name, re] of [["WorkOS", /WorkOS/g], ["budget", /budget/g], ["Activity records", /Activity records/g], ["__Host-fw_portal", /__Host-fw_portal/g], ["prepare proposals", /prepare proposals/g], ["inactive beta accounts", /inactive beta accounts/g]])
    assert.ok(portalDisclosureProblems(FULL.replace(re, "")).length, "without " + name);
  assert.ok(portalSectionText(FULL).startsWith("The client portal"));
});

// ---- the guard in simulated safe and unsafe configurations -----------------------------------------------------------------------------------------------
test("GUARD FAILS in a simulated unsafe configuration: Production portal armed or on (either flag, or both) with a website-only policy", () => {
  for (const [label, cfg] of [["ENABLED only", ARMED_ENABLED], ["ALLOW only", ARMED_ALLOW], ["both flags", ON]]) {
    assert.throws(() => assertPortalPrivacyReady({ config: cfg, html: WEBSITE_ONLY, target: "main" }), /portal privacy disclosures are required/, label);
    assert.throws(() => assertPortalPrivacyReady({ config: cfg, html: policyWith("TBD"), target: "main" }), /required/, label + " with a placeholder section");
  }
  // the real Production policy of today fails if the flags were switched on
  const real = read("privacy.html");
  if (portalDisclosureProblems(real).length) assert.throws(() => assertPortalPrivacyReady({ config: ON, html: real, target: "main" }), /required/);
});

test("GUARD PASSES with the portal disabled (website-only policy), and passes with the portal on once the disclosures are published; Staging always needs them", () => {
  assert.equal(assertPortalPrivacyReady({ config: OFF, html: WEBSITE_ONLY, target: "main" }).required, false);
  for (const cfg of [ARMED_ENABLED, ARMED_ALLOW, ON]) assert.equal(assertPortalPrivacyReady({ config: cfg, html: FULL, target: "main" }).required, true);
  assert.equal(assertPortalPrivacyReady({ config: OFF, html: FULL, target: "Staging" }).required, true);
  assert.throws(() => assertPortalPrivacyReady({ config: OFF, html: WEBSITE_ONLY, target: "Staging" }), /required/, "Staging cannot ship without the disclosures");
  assert.throws(() => assertPortalPrivacyReady({ config: OFF, html: WEBSITE_ONLY, target: "" }), /required/, "an unknown branch is strict");
});

// ---- the real repository ----------------------------------------------------------------------------------------------------------------------------------
test("REAL REPOSITORY: the Production configuration plus privacy.html is a safe combination for the branch being tested", () => {
  const target = targetBranch();
  const state = productionPortalState(config);
  assertPortalPrivacyReady({ config, html, target }); // throws when activation is configured (or the branch is Staging) without the disclosures
  // independent of the branch: any Production activation needs the full disclosures
  if (state !== "off") assert.deepEqual(portalDisclosureProblems(html), [], "Production portal is " + state + " but privacy.html lacks the portal disclosures");
});

test("REAL REPOSITORY: the Production variables carry neither flag today, and Admin writes, invitation sending, demo and the allowlist are Staging-only", () => {
  for (const vars of productionVars()) for (const k of ["PORTAL_ENABLED", "PORTAL_ALLOW_PRODUCTION", "PORTAL_ADMIN_WRITES", "PORTAL_INVITE_SENDING", "PORTAL_DEMO", "PORTAL_INVITE_ALLOWLIST"]) assert.ok(!(k in vars), k + " must not be in Production vars yet");
  for (const k of ["PORTAL_ADMIN_WRITES", "PORTAL_INVITE_SENDING", "PORTAL_DEMO"]) assert.equal(config.previews.vars[k], "1", k + " is a Staging-only switch");
  function productionVars() { return [config.vars || {}, ...Object.values(config.env || {}).map((e) => (e && e.vars) || {})]; }
  assert.equal(config.d1_databases.find((d) => d.binding === "PORTAL_DB").database_name, "framework-portal");
});
