#!/usr/bin/env node
/**
 * Framework STAGING health check (on demand, read-only).  Run:  node scripts/ops/staging-health.mjs [--json] [--no-smoke]
 *
 * What it does: asks the Cloudflare API (and the public GitHub API, and a few unauthenticated pages on the Staging host) whether the Staging Preview, its
 * configuration and its D1 database look as scripts/ops/staging-expected.json says they should, and prints a PASS / WARN / FAIL table.
 *
 * Safety rules, enforced in code and pinned by worker/test/staging-health.test.mjs:
 *   - READ ONLY. Every request is a GET, except ONE POST: the fixed statement ALLOWED_SQL (table names from sqlite_master) against the Staging portal database.
 *   - STAGING ONLY. Only the Preview named in the expected file, only the Staging databases; a Production database id is refused before any request is made.
 *   - HOST ALLOW-LIST. Requests go only to api.cloudflare.com, api.github.com and the Staging host. The Cloudflare token (CLOUDFLARE_API_TOKEN, optional: in
 *     the Claude Code cloud environment it is injected by the network proxy and this script never sees it) is sent only to api.cloudflare.com.
 *   - NO SECRETS IN OUTPUT. Only field names and types are read from Cloudflare responses. A non-secret setting's value is read only for the names listed
 *     in the expected file and is never printed (a mismatch says "differs"). Commit messages, emails and token-like strings are never printed, and a final
 *     scrub removes anything that still looks like one.
 *   - CRITICAL CHECKS FAIL CLOSED. If the configuration cannot be read, the checks that PORTAL_ADMIN_WRITES, PORTAL_INVITE_SENDING and the deprecated
 *     PORTAL_INVITE_ALLOWED_EMAILS are absent FAIL ("cannot verify") instead of passing.
 * Exit code: 1 when any check FAILs, otherwise 0.
 *
 * Behind a proxy (the Claude Code cloud environment) run Node with NODE_USE_ENV_PROXY=1. No dependencies: Node 22 built-ins only.
 */
import { readFileSync } from "node:fs";

export const ALLOWED_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
export const CF_HOST = "api.cloudflare.com";
export const GITHUB_HOST = "api.github.com";
const CF = `https://${CF_HOST}/client/v4`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HEX_ID = /^[0-9a-f]{32}$/;
const SHA = /^[0-9a-f]{7,40}$/;
const PLAIN = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/* ------------------------------------------------------------------ expected configuration */

export function loadExpected(path = new URL("./staging-expected.json", import.meta.url)) {
  return validateExpected(JSON.parse(readFileSync(path, "utf8")));
}

/** Refuses an expected file that could point the check at Production or at something malformed. */
export function validateExpected(x) {
  const bad = (m) => { throw new Error("invalid expected configuration: " + m); };
  if (!PLAIN(x) || x.schema !== 1) bad("schema");
  for (const k of ["worker", "preview", "repository", "branch", "baseUrl"]) if (typeof x[k] !== "string" || !x[k]) bad(k);
  if (!/^https:\/\/[a-z0-9.-]+$/.test(x.baseUrl)) bad("baseUrl must be a plain https origin");
  if (!PLAIN(x.d1) || !UUID.test(x.d1.id) || typeof x.d1.name !== "string" || !Array.isArray(x.d1.tables)) bad("d1");
  if (!PLAIN(x.websiteDb) || !UUID.test(x.websiteDb.id)) bad("websiteDb");
  if (!PLAIN(x.forbiddenDatabaseIds) || !Object.keys(x.forbiddenDatabaseIds).length) bad("forbiddenDatabaseIds");
  for (const id of [x.d1.id, x.websiteDb.id]) if (id in x.forbiddenDatabaseIds) bad("a Staging database id is on the Production (forbidden) list");
  if (!/staging/i.test(x.d1.name) || !/staging/i.test(x.websiteDb.name)) bad("database names must be Staging databases");
  if (!PLAIN(x.plainVars) || !PLAIN(x.secrets) || !Array.isArray(x.secrets.required) || !PLAIN(x.bindings) || !Array.isArray(x.forbiddenNames)) bad("shape");
  for (const n of ["PORTAL_ADMIN_WRITES", "PORTAL_INVITE_SENDING", "PORTAL_INVITE_ALLOWED_EMAILS"]) if (!x.forbiddenNames.includes(n)) bad("forbiddenNames must include " + n);
  const text = JSON.stringify(x);
  if (/@[a-z0-9-]+\./i.test(text)) bad("no email addresses belong in this file");
  if (/\b(sk_|re_|Bearer )/.test(text)) bad("no credentials belong in this file");
  return x;
}

/* ------------------------------------------------------------------ output hygiene */

/** Last line of defence: nothing that looks like an address or a token leaves the process. */
export function scrub(text) {
  return String(text)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[email]")
    .replace(/\bBearer\s+\S+/gi, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]");
}
const clip = (s, n = 140) => scrub(String(s)).slice(0, n);

const R = (id, status, message) => ({ id, status, message: clip(message) });
const PASS = "PASS", WARN = "WARN", FAIL = "FAIL";

/* ------------------------------------------------------------------ guarded HTTP */

export function makeHttp({ fetch, token, baseUrl, timeoutMs = 20000, log = () => {} }) {
  const baseHost = new URL(baseUrl).host;
  const allowedHosts = new Set([CF_HOST, GITHUB_HOST, baseHost]);
  async function send(url, { method = "GET", body, headers = {}, redirect = "follow" } = {}) {
    const u = new URL(url);
    if (u.protocol !== "https:" || !allowedHosts.has(u.host)) throw new Error("blocked: host not allowed");
    const h = { Accept: "application/json, text/html;q=0.8", "User-Agent": "framework-staging-health", ...headers };
    if (u.host === CF_HOST && token) h.Authorization = `Bearer ${token}`; // never to any other host, never logged
    log(`${method} ${u.host}${u.pathname.replace(/[0-9a-f]{32}|[0-9a-f-]{36}/g, ":id")}`);
    return fetch(u.toString(), { method, body, headers: h, redirect, signal: AbortSignal.timeout(timeoutMs) });
  }
  /** GET only. */
  const get = (url, opts = {}) => send(url, { ...opts, method: "GET" });
  /** The ONE write-shaped request: the fixed read-only statement, to the Staging portal database only. */
  const queryStagingTables = async (accountId, databaseId, expected) => {
    if (databaseId !== expected.d1.id || databaseId in expected.forbiddenDatabaseIds || !HEX_ID.test(accountId) || !UUID.test(databaseId)) throw new Error("blocked: not the Staging portal database");
    return send(`${CF}/accounts/${accountId}/d1/database/${databaseId}/query`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sql: ALLOWED_SQL }) });
  };
  return { get, queryStagingTables };
}

async function cfJson(resp) {
  let body = null;
  try { body = await resp.json(); } catch { /* not JSON */ }
  const errors = body && Array.isArray(body.errors) ? body.errors.map((e) => `${e.code}`).join(",") : "";
  return { ok: resp.status >= 200 && resp.status < 300 && body && body.success === true, status: resp.status, body, errors };
}
const fail403 = (c) => (c.status === 401 || c.status === 403 ? `HTTP ${c.status} (permission: ${c.errors || "none given"})` : `HTTP ${c.status}${c.errors ? ` (${c.errors})` : ""}`);
const ageOf = (iso, now) => { const m = Math.round((now - new Date(iso)) / 60000); return Number.isFinite(m) ? (m < 90 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`) + " ago" : "unknown"; };

/* ------------------------------------------------------------------ the checks */

export async function runHealthCheck({ fetch = globalThis.fetch, env = process.env, expected = loadExpected(), now = () => new Date(), skipSmoke = false, log = () => {} } = {}) {
  validateExpected(expected);
  const token = typeof env.CLOUDFLARE_API_TOKEN === "string" && env.CLOUDFLARE_API_TOKEN ? env.CLOUDFLARE_API_TOKEN : "";
  const http = makeHttp({ fetch, token, baseUrl: expected.baseUrl, log });
  const results = [];
  const add = (r) => { results.push(r); return r; };
  const safe = async (id, fn, onError) => { try { return await fn(); } catch (e) { add(R(id, onError || WARN, `could not run: ${e && e.message ? e.message : "error"}`)); return undefined; } };

  const ctx = { accountId: null, previewId: null, deployments: null, deployEnv: null, envProblem: "" };

  /* auth + account */
  await safe("cloudflare.auth", async () => {
    const c = await cfJson(await http.get(`${CF}/user/tokens/verify`));
    if (c.ok && c.body.result && c.body.result.status === "active") add(R("cloudflare.auth", PASS, "API token is valid and active (read-only checks follow)"));
    else { add(R("cloudflare.auth", FAIL, `API authentication failed: ${fail403(c)}`)); ctx.envProblem = "Cloudflare authentication failed"; }
  }, FAIL);
  if (!ctx.envProblem) {
    await safe("cloudflare.account", async () => {
      const c = await cfJson(await http.get(`${CF}/accounts`));
      const ids = c.ok && Array.isArray(c.body.result) ? c.body.result.map((a) => a && a.id).filter((i) => HEX_ID.test(i)) : [];
      if (ids.length === 1) { ctx.accountId = ids[0]; add(R("cloudflare.account", PASS, "exactly one account is visible to the token")); }
      else { add(R("cloudflare.account", FAIL, c.ok ? `expected exactly one account, found ${ids.length}` : `account lookup failed: ${fail403(c)}`)); ctx.envProblem = "account not identified"; }
    }, FAIL);
  }

  /* preview + deployments */
  if (ctx.accountId) {
    const A = `${CF}/accounts/${ctx.accountId}`;
    await safe("preview.exists", async () => {
      let found = null, total = 0;
      for (let page = 1; page <= 5 && !found; page++) {
        const c = await cfJson(await http.get(`${A}/workers/workers/${expected.worker}/previews?page=${page}&per_page=25`));
        if (!c.ok || !Array.isArray(c.body.result)) { add(R("preview.exists", FAIL, `could not list Previews: ${fail403(c)}`)); ctx.envProblem = "Previews unreadable"; return; }
        total += c.body.result.length;
        found = c.body.result.find((p) => p && p.name === expected.preview) || null;
        if (c.body.result.length === 0 || c.body.result.length < 25) break;
      }
      if (found && HEX_ID.test(found.id)) { ctx.previewId = found.id; add(R("preview.exists", PASS, `Preview "${expected.preview}" of Worker "${expected.worker}" exists`)); }
      else { add(R("preview.exists", FAIL, `Preview "${expected.preview}" was not found among ${total}`)); ctx.envProblem = "Preview not found"; }
    }, FAIL);
  }
  if (ctx.accountId && ctx.previewId) {
    const P = `${CF}/accounts/${ctx.accountId}/workers/workers/${expected.worker}/previews/${ctx.previewId}`;
    await safe("deployments.recent", async () => {
      const c = await cfJson(await http.get(`${P}/deployments`));
      if (!c.ok || !Array.isArray(c.body.result) || !c.body.result.length || !c.body.result.every((d) => PLAIN(d) && HEX_ID.test(String(d.id).replace(/-/g, "")))) {
        add(R("deployments.recent", FAIL, `deployment history unreadable or unexpected: ${fail403(c)}`)); ctx.envProblem = "deployment history unreadable"; return;
      }
      ctx.deployments = c.body.result;
      const d = c.body.result[0];
      const recent = c.body.result.slice(0, 5).map((x) => `#${Number(x.number) || "?"} ${x.source === "wrangler" ? "code" : String(x.source || "?").slice(0, 8)}`).join(", ");
      add(R("deployments.recent", PASS, `newest #${Number(d.number) || "?"}, ${ageOf(d.created_on, now())}; recent: ${recent}`));
      // the environment (names, types, non-secret values) of the NEWEST deployment: what is live right now
      const dc = await cfJson(await http.get(`${P}/deployments/${encodeURIComponent(d.id)}`));
      if (dc.ok && dc.body.result && PLAIN(dc.body.result.env)) ctx.deployEnv = dc.body.result.env;
      else { ctx.envProblem = `newest deployment's configuration unreadable: ${fail403(dc)}`; }
    }, FAIL);
  }

  /* commit deployed vs Staging head, and GitHub build/test checks */
  await safe("deploy.commit", async () => {
    const tagged = (ctx.deployments || []).find((d) => d.annotations && SHA.test(String(d.annotations["workers/tag"] || "")));
    const tag = tagged ? String(tagged.annotations["workers/tag"]) : "";
    const gh = await http.get(`https://${GITHUB_HOST}/repos/${expected.repository}/branches/${expected.branch}`);
    const body = gh.ok ? await gh.json().catch(() => null) : null;
    const head = body && body.commit && /^[0-9a-f]{40}$/.test(String(body.commit.sha)) ? body.commit.sha : "";
    if (!head) { add(R("deploy.commit", WARN, `could not read the ${expected.branch} head from GitHub (HTTP ${gh.status}); commit not compared`)); return; }
    if (!tag) add(R("deploy.commit", WARN, "no deployment with a commit tag in the recent history"));
    else if (head.startsWith(tag) || tag.startsWith(head.slice(0, tag.length))) add(R("deploy.commit", PASS, `deployed code ${tag.slice(0, 7)} is the ${expected.branch} head`));
    else add(R("deploy.commit", WARN, `deployed code ${tag.slice(0, 7)} differs from the ${expected.branch} head ${head.slice(0, 7)} (a build may be pending or failed)`));
    const cr = await http.get(`https://${GITHUB_HOST}/repos/${expected.repository}/commits/${head}/check-runs?per_page=50`);
    const runs = cr.ok ? ((await cr.json().catch(() => ({}))).check_runs || []) : null;
    if (!runs) { add(R("github.checks", WARN, `could not read check runs for ${head.slice(0, 7)} (HTTP ${cr.status})`)); return; }
    for (const name of expected.requiredGithubChecks) {
      const run = runs.find((r) => r && r.name === name);
      const id = `github.check.${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      if (!run) add(R(id, WARN, `"${name}" not reported for ${head.slice(0, 7)}`));
      else if (run.status !== "completed") add(R(id, WARN, `"${name}" is ${String(run.status).slice(0, 20)} for ${head.slice(0, 7)}`));
      else if (run.conclusion === "success") add(R(id, PASS, `"${name}" succeeded for ${head.slice(0, 7)}`));
      else add(R(id, FAIL, `"${name}" ${String(run.conclusion).slice(0, 20)} for ${head.slice(0, 7)}`));
    }
  });

  /* configuration: names, types, drift; and the critical absences */
  const envOk = Boolean(ctx.deployEnv);
  const envWhy = ctx.envProblem || "configuration unavailable";
  const names = envOk ? Object.keys(ctx.deployEnv) : [];
  const typeOf = (n) => (envOk && PLAIN(ctx.deployEnv[n]) ? String(ctx.deployEnv[n].type || "") : "");
  const critical = [
    ["critical.admin_writes_absent", "PORTAL_ADMIN_WRITES", "administrative writes are switched off"],
    ["critical.invite_sending_absent", "PORTAL_INVITE_SENDING", "invitation sending is switched off"],
    ["critical.deprecated_allowlist_absent", "PORTAL_INVITE_ALLOWED_EMAILS", "the deprecated public invitation allowlist is gone"],
  ];
  for (const [id, name, what] of critical) {
    if (!envOk) add(R(id, FAIL, `cannot verify that ${name} is absent: ${envWhy}`));
    else if (names.includes(name)) add(R(id, FAIL, `${name} IS SET on the Staging Preview (${typeOf(name) || "unknown type"}): ${what} is false`));
    else add(R(id, PASS, `${name} is absent: ${what}`));
  }
  if (envOk) {
    const missingSecrets = expected.secrets.required.filter((n) => typeOf(n) !== "secret_text");
    add(missingSecrets.length ? R("config.secrets", FAIL, `required secrets missing or not secrets: ${missingSecrets.join(", ")}`) : R("config.secrets", PASS, `all ${expected.secrets.required.length} required secret names present (values never read)`));
    const missingOptional = (expected.secrets.optional || []).filter((n) => typeOf(n) !== "secret_text");
    if (missingOptional.length) add(R("config.optional_secrets", WARN, `optional secrets absent (defaults apply): ${missingOptional.join(", ")}`));
    const varProblems = [];
    for (const [n, want] of Object.entries(expected.plainVars)) {
      const e = ctx.deployEnv[n];
      if (!PLAIN(e) || e.type !== "plain_text") varProblems.push(`${n} missing`);
      else if (want !== null && e.text !== want) varProblems.push(`${n} differs from expected`);
    }
    add(varProblems.length ? R("config.variables", FAIL, `variable drift: ${varProblems.join("; ")}`) : R("config.variables", PASS, "expected non-secret settings present and unchanged (values not shown)"));
    const bindProblems = [];
    for (const [n, want] of Object.entries(expected.bindings)) {
      const e = ctx.deployEnv[n];
      if (!PLAIN(e) || e.type !== want.type) { bindProblems.push(`${n} missing or wrong type`); continue; }
      if (want.bucket_name && e.bucket_name !== want.bucket_name) bindProblems.push(`${n} points elsewhere`);
      if (want.namespace_id && String(e.namespace_id) !== want.namespace_id) bindProblems.push(`${n} differs`);
    }
    add(bindProblems.length ? R("config.bindings", FAIL, `binding problems: ${bindProblems.join("; ")}`) : R("config.bindings", PASS, "all expected bindings present with the expected types and Staging targets"));
    const dbProblems = [];
    for (const [binding, db] of [[expected.d1.binding, expected.d1], [expected.websiteDb.binding, expected.websiteDb]]) {
      const id = PLAIN(ctx.deployEnv[binding]) ? ctx.deployEnv[binding].database_id || ctx.deployEnv[binding].id : "";
      if (id in expected.forbiddenDatabaseIds) dbProblems.push(`${binding} is bound to a PRODUCTION database`);
      else if (id !== db.id) dbProblems.push(`${binding} is bound to an unexpected database`);
    }
    add(dbProblems.length ? R("config.database_binding", FAIL, dbProblems.join("; ")) : R("config.database_binding", PASS, "both D1 bindings point at the Staging databases, not Production"));
    const known = new Set([...Object.keys(expected.plainVars), ...expected.secrets.required, ...(expected.secrets.optional || []), ...Object.keys(expected.bindings), ...expected.forbiddenNames]);
    const unexpected = names.filter((n) => !known.has(n));
    add(unexpected.length ? R("config.unexpected_names", WARN, `names not in the expected file: ${unexpected.slice(0, 8).join(", ")}${unexpected.length > 8 ? ` (+${unexpected.length - 8})` : ""}`) : R("config.unexpected_names", PASS, "no unexpected variable, secret or binding names"));
  } else {
    for (const id of ["config.secrets", "config.variables", "config.bindings", "config.database_binding"]) add(R(id, FAIL, `cannot verify: ${envWhy}`));
  }

  /* D1 */
  if (ctx.accountId) {
    const A = `${CF}/accounts/${ctx.accountId}`;
    await safe("d1.available", async () => {
      const c = await cfJson(await http.get(`${A}/d1/database/${expected.d1.id}`));
      const r = c.ok ? c.body.result : null;
      if (!r) add(R("d1.available", FAIL, `Staging portal database unreachable: ${fail403(c)}`));
      else if (r.uuid !== expected.d1.id || r.name !== expected.d1.name) add(R("d1.available", FAIL, "database id or name differs from the expected Staging database"));
      else add(R("d1.available", PASS, `${r.name} reachable: ${Number(r.num_tables) || 0} tables, ${Math.round((Number(r.file_size) || 0) / 1024)} KiB, region ${String(r.running_in_region || "?").slice(0, 8)}`));
    }, FAIL);
    await safe("d1.tables", async () => {
      const c = await cfJson(await http.queryStagingTables(ctx.accountId, expected.d1.id, expected));
      const rows = c.ok && Array.isArray(c.body.result) && c.body.result[0] && Array.isArray(c.body.result[0].results) ? c.body.result[0].results.map((x) => x && x.name).filter((n) => typeof n === "string") : null;
      if (!rows) { add(R("d1.tables", WARN, `table names not verified (the token may not allow queries): ${fail403(c)}`)); return; }
      const have = rows.filter((n) => !n.startsWith("_cf_") && !n.startsWith("sqlite_"));
      const missing = expected.d1.tables.filter((n) => !have.includes(n)), extra = have.filter((n) => !expected.d1.tables.includes(n));
      if (missing.length) add(R("d1.tables", FAIL, `expected tables missing: ${missing.join(", ")}`));
      else if (extra.length) add(R("d1.tables", WARN, `extra tables: ${extra.slice(0, 6).join(", ")}`));
      else add(R("d1.tables", PASS, `all ${have.length} expected tables present (one read-only SELECT on sqlite_master)`));
    });
    await safe("d1.timetravel", async () => {
      const c = await cfJson(await http.get(`${A}/d1/database/${expected.d1.id}/time_travel/bookmark`));
      if (c.ok && c.body.result && typeof c.body.result.bookmark === "string" && c.body.result.bookmark) add(R("d1.timetravel", PASS, "Time Travel bookmark API answers (value not shown)"));
      else add(R("d1.timetravel", WARN, `Time Travel bookmark not retrievable: ${fail403(c)}`));
    });
    add(R("d1.retention", WARN, "Time Travel retention window and a working restore cannot be verified through the API: confirm in the Cloudflare dashboard"));
  } else {
    for (const id of ["d1.available", "d1.tables", "d1.timetravel"]) add(R(id, FAIL, `not checked: ${envWhy}`));
  }

  /* unauthenticated smoke tests against the Staging host only */
  if (!skipSmoke) await smoke(http, expected, add);
  else add(R("smoke.skipped", WARN, "smoke tests skipped (--no-smoke)"));

  const counts = { PASS: 0, WARN: 0, FAIL: 0 };
  for (const r of results) counts[r.status]++;
  return { overall: counts.FAIL ? FAIL : counts.WARN ? WARN : PASS, counts, results, generatedAt: now().toISOString() };
}

async function smoke(http, expected, add) {
  const url = (p) => expected.baseUrl + p;
  const probe = async (path) => { const r = await http.get(url(path), { redirect: "manual" }); return { status: r.status, headers: r.headers, text: r.status === 200 ? await r.text().catch(() => "") : "" }; };
  let first;
  try { first = await probe("/portal/login"); } catch { add(R("smoke.reachable", WARN, `${new URL(expected.baseUrl).host} is not reachable from this environment (network policy?): smoke tests not run`)); return; }
  const loc = (r) => String(r.headers.get("location") || "");
  const h = (r, n) => String(r.headers.get(n) || "");
  add(first.status === 200
    ? R("smoke.login", PASS, "sign-in page answers 200")
    : R("smoke.login", FAIL, `sign-in page answered HTTP ${first.status}`));
  const hdr = [];
  if (!/no-store/i.test(h(first, "cache-control"))) hdr.push("Cache-Control no-store");
  if (!h(first, "content-security-policy")) hdr.push("Content-Security-Policy");
  if (!/deny/i.test(h(first, "x-frame-options"))) hdr.push("X-Frame-Options DENY");
  if (!/no-referrer/i.test(h(first, "referrer-policy"))) hdr.push("Referrer-Policy");
  add(first.status === 200 ? (hdr.length ? R("smoke.headers", FAIL, `portal security headers missing: ${hdr.join(", ")}`) : R("smoke.headers", PASS, "portal security headers present on the sign-in page")) : R("smoke.headers", WARN, "not checked"));
  const redirectsToLogin = async (id, path, label) => {
    try {
      const r = await probe(path);
      if (r.status === 200) add(R(id, FAIL, `${label} answered 200 without signing in`));
      else if (r.status >= 300 && r.status < 400 && /\/portal\/login/.test(loc(r))) add(R(id, PASS, `${label} redirects to sign-in`));
      else add(R(id, WARN, `${label} answered HTTP ${r.status} (expected a redirect to sign-in)`));
    } catch { add(R(id, WARN, `${label}: request failed`)); }
  };
  await redirectsToLogin("smoke.portal_home", "/portal", "/portal");
  await redirectsToLogin("smoke.org_page", "/portal/o/health-check-nonexistent", "an organization page");
  for (const [id, path] of [["smoke.admin_page", "/admin"], ["smoke.admin_api", "/api/admin/clients"]]) {
    try {
      const r = await probe(path);
      add(r.status === 200 ? R(id, FAIL, `${path} answered 200 without staff sign-in: it must be protected`) : R(id, PASS, `${path} is not public (HTTP ${r.status})`));
    } catch { add(R(id, WARN, `${path}: request failed`)); }
  }
  try {
    const r = await probe("/privacy");
    add(r.status === 200 && /The client portal/.test(r.text) ? R("smoke.privacy", PASS, "privacy policy page covers the client portal") : R("smoke.privacy", WARN, `privacy page HTTP ${r.status} or missing the client portal section`));
  } catch { add(R("smoke.privacy", WARN, "privacy page: request failed")); }
}

/* ------------------------------------------------------------------ report */

export function formatMarkdown(report) {
  const icon = { PASS: "PASS", WARN: "WARN", FAIL: "FAIL" };
  const rows = report.results.map((r) => `| ${icon[r.status]} | ${r.id} | ${r.message.replace(/\|/g, "/")} |`);
  return scrub([`# Framework Staging health: ${report.overall}`, `PASS ${report.counts.PASS} | WARN ${report.counts.WARN} | FAIL ${report.counts.FAIL} | ${report.generatedAt}`, "", "| Status | Check | Detail |", "| --- | --- | --- |", ...rows, ""].join("\n"));
}

export async function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.out || ((s) => process.stdout.write(s + "\n"));
  const report = await runHealthCheck({ skipSmoke: argv.includes("--no-smoke"), ...deps.run });
  out(argv.includes("--json") ? scrub(JSON.stringify(report, null, 2)) : formatMarkdown(report));
  return report.counts.FAIL ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => { process.exitCode = code; }).catch((e) => { process.stderr.write(scrub("health check could not run: " + (e && e.message ? e.message : "error")) + "\n"); process.exitCode = 2; });
}
