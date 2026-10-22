// Launch guard: the client portal must never be switched on in Production without the portal privacy disclosures being published.
//
// Three situations, one rule set:
//   * Staging (target branch Staging, or any branch we cannot place): the portal disclosures MUST be in privacy.html, always.
//   * Production (target branch main) with the portal OFF: the existing, website-only policy is acceptable.
//   * Production with the portal switched on, or armed (either flag set): the disclosures are mandatory.
// "Production activation" means PORTAL_ENABLED and/or PORTAL_ALLOW_PRODUCTION being "1" outside the Staging `previews` block. Both are checked: the code
// (worker/portal/config.js) needs BOTH to serve the portal on a production host, but one flag alone is one step from live, so it is treated as armed.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const root = new URL("../../../", import.meta.url);
export const read = (p) => readFileSync(new URL(p, root), "utf8");

/** wrangler.jsonc (JSON with // comments and trailing commas) -> object */
export function parseWrangler(text) {
  const noComments = text.replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
}

/** Every `vars` block that can reach Production: the top level and any named environment. The Staging `previews` block is deliberately not one of them. */
export function productionVars(config) {
  const blocks = [config.vars || {}];
  for (const env of Object.values(config.env || {})) blocks.push((env && env.vars) || {});
  return blocks;
}

/** "off" (neither flag is "1"), "armed" (exactly one flag is "1": not live yet, but one change away) or "on" (both flags in the same Production vars block). */
export function productionPortalState(config) {
  let state = "off";
  for (const vars of productionVars(config)) {
    const enabled = String(vars.PORTAL_ENABLED ?? "").trim() === "1";
    const allowed = String(vars.PORTAL_ALLOW_PRODUCTION ?? "").trim() === "1";
    if (enabled && allowed) return "on";
    if (enabled || allowed) state = "armed";
  }
  return state;
}

/** The branch these tests are guarding: an explicit override, the pull request's target, the pushed branch, or the checked-out branch. */
export function targetBranch(env = process.env, gitBranch = currentGitBranch) {
  if (env.PRIVACY_TEST_TARGET) return env.PRIVACY_TEST_TARGET.trim();
  if (env.GITHUB_BASE_REF) return env.GITHUB_BASE_REF.trim();
  if (env.GITHUB_REF_NAME && env.GITHUB_EVENT_NAME && env.GITHUB_EVENT_NAME !== "pull_request") return env.GITHUB_REF_NAME.trim();
  return gitBranch();
}
function currentGitBranch() {
  try { return execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; }
}

/** Relaxed ONLY for a Production-bound change (target main) whose Production configuration leaves the portal off. Everything else is strict. */
export function portalDisclosuresRequired({ target, state }) {
  return !(target === "main" && state === "off");
}

// What the portal part of the policy must really say. Anchors are checked against the whole policy text (the data list sits in "Information we collect",
// the rest in "The client portal"), and the portal section itself must be substantial and free of placeholders.
const ANCHORS = [
  ["names the sign-in provider", /WorkOS/],
  ["explains the one-time code sign-in", /one-time code/],
  ["lists the Business Profile information", /Business Profile information/],
  ["names the four optional project questions (budget)", /\bbudget\b/],
  ["lists portal feedback", /Portal feedback/],
  ["lists sign-in and security records", /Sign-in and security records/],
  ["lists activity records", /Activity records/],
  ["lists invitation records", /Invitation records/],
  ["names the portal cookie", /__Host-fw_portal/],
  ["says each organization sees only its own information", /Each organization can see only its own information/],
  ["says who at Framework can view client information", /Authorized Framework personnel/],
  ["states portal retention", /inactive beta accounts/],
  ["states the client sign-in factor honestly", /second sign-in step for clients/],
  ["states the purposes, including proposals", /prepare proposals/],
];
const PLACEHOLDER = /\b(TODO|TBD|lorem ipsum|placeholder|coming soon|to be added|to be confirmed)\b/i;
const MIN_SECTION_CHARS = 1500;

export const policyTextOf = (html) => html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&rsquo;|’/g, "'").replace(/\s+/g, " ").trim();

/** The visible text of <h2 id="portal"> up to the next <h2 id=...>, or "" when the policy has no portal section. */
export function portalSectionText(html) {
  const m = /<h2 id="portal">[\s\S]*?(?=<h2 id=|<\/main>|$)/.exec(html);
  return m ? policyTextOf(m[0]) : "";
}

/** [] when the policy carries meaningful portal disclosures, otherwise what is missing. */
export function portalDisclosureProblems(html) {
  const problems = [];
  const section = portalSectionText(html), text = policyTextOf(html);
  if (!section) return ['no portal section (<h2 id="portal">)'];
  if (!/client portal/i.test(section.slice(0, 60))) problems.push("the portal section is not headed as the client portal");
  if (section.length < MIN_SECTION_CHARS) problems.push(`the portal section is only ${section.length} characters (minimum ${MIN_SECTION_CHARS})`);
  if (PLACEHOLDER.test(section)) problems.push("the portal section contains placeholder wording");
  for (const [what, re] of ANCHORS) if (!re.test(text)) problems.push("the policy does not mention: " + what);
  return problems;
}

/** Throws unless the combination is safe: disclosures present whenever the situation requires them. */
export function assertPortalPrivacyReady({ config, html, target }) {
  const state = productionPortalState(config);
  if (!portalDisclosuresRequired({ target, state })) return { state, required: false, problems: [] };
  const problems = portalDisclosureProblems(html);
  if (problems.length) throw new Error(`portal privacy disclosures are required (target ${target || "unknown"}, Production portal ${state}) but: ${problems.join("; ")}`);
  return { state, required: true, problems };
}

/** For the policy tests: are the portal-specific assertions mandatory in this checkout? The tests also run them whenever a portal section exists (all or nothing). */
export function portalPolicyAssertionsApply(html = read("privacy.html")) {
  const state = productionPortalState(parseWrangler(read("wrangler.jsonc")));
  return portalDisclosuresRequired({ target: targetBranch(), state }) || /<h2 id="portal">/.test(html);
}
