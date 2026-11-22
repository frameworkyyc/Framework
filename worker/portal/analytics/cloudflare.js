/**
 * Cloudflare Web Analytics for one website, read through Cloudflare's GraphQL Analytics API (account dataset rumPageloadEventsAdaptiveGroups, filtered by the site's own site tag).
 * Framework's own account needs two server settings: CF_ANALYTICS_API_TOKEN (a token with Account > Account Analytics > Read; a Worker secret) and CF_ANALYTICS_ACCOUNT_ID.
 * A website whose site lives in the client's own Cloudflare account carries that account id and its own read-only token (encrypted at rest; see service.js and secret-box.js):
 * this module only ever receives { token, account } and does not know which kind it is.
 *
 * What Web Analytics counts: a "page view" is one page load (count) and a "visit" (sum.visits) is one visit, which ends after a period of inactivity or when the visitor leaves. It does NOT
 * count unique people, so this module never calls anything "visitors". Bot traffic is excluded (bot = 0), the same default as Cloudflare's own dashboard. Nothing here is estimated.
 * Errors are reduced to short codes; the response body, the token and the site tag are never put in an error.
 */
import { eachDay } from "./ranges.js";

export const ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";
const BASE = "siteTag: $tag, bot: 0";
export const QUERY = `query ($account: String!, $tag: string!, $from: Date!, $to: Date!, $prevFrom: Date!, $prevTo: Date!) { viewer { accounts(filter: { accountTag: $account }) {
  totals: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $from, date_leq: $to }, limit: 1) { count sum { visits } }
  previous: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $prevFrom, date_leq: $prevTo }, limit: 1) { count sum { visits } }
  series: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $from, date_leq: $to }, limit: 120, orderBy: [date_ASC]) { count sum { visits } dimensions { date } }
  sources: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $from, date_leq: $to }, limit: 10, orderBy: [sum_visits_DESC]) { count sum { visits } dimensions { refererHost } }
  pages: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $from, date_leq: $to }, limit: 10, orderBy: [count_DESC]) { count sum { visits } dimensions { requestPath } }
  devices: rumPageloadEventsAdaptiveGroups(filter: { ${BASE}, date_geq: $from, date_leq: $to }, limit: 10, orderBy: [count_DESC]) { count sum { visits } dimensions { deviceType } }
} } }`;

/** Server settings for this source, or null when they are not both there. */
export function credentials(env) {
  const token = env && typeof env.CF_ANALYTICS_API_TOKEN === "string" ? env.CF_ANALYTICS_API_TOKEN.trim() : "";
  const account = env && typeof env.CF_ANALYTICS_ACCOUNT_ID === "string" ? env.CF_ANALYTICS_ACCOUNT_ID.trim() : "";
  return token && /^[0-9a-f]{32}$/i.test(account) ? { token, account } : null;
}

/** A Cloudflare account id: 32 hex characters (lower case), else null. */
export const validAccountId = (v) => (typeof v === "string" && /^[0-9a-f]{32}$/i.test(v.trim()) ? v.trim().toLowerCase() : null);
/** A Cloudflare API token as pasted: 20 to 200 URL-safe characters with no spaces, else null. The format is only a sanity check; Admin's Test is what proves it works. */
export const validApiToken = (v) => (typeof v === "string" && /^[A-Za-z0-9_.-]{20,200}$/.test(v.trim()) ? v.trim() : null);

const int = (n) => (Number.isFinite(Number(n)) && Number(n) >= 0 ? Math.round(Number(n)) : 0);
const cleanPath = (p) => { const s = String(p || "/").split(/[?#]/)[0].replace(/[\u0000-\u001f\u007f]/g, ""); return (s.startsWith("/") ? s : `/${s}`).slice(0, 120); };
const cleanHost = (h) => String(h || "").toLowerCase().replace(/[^a-z0-9.:-]/g, "").slice(0, 100);
const DEVICE = { desktop: "Desktop", mobile: "Mobile", tablet: "Tablet" };

/** The API's answer reduced to the figures the page shows. Days with no recorded page loads are real zeros. */
export function parse(account, period) {
  const sum = (g) => ({ visits: int(g && g.sum && g.sum.visits), pageViews: int(g && g.count) });
  const byDay = new Map((account.series || []).map((g) => [g.dimensions && g.dimensions.date, sum(g)]));
  const series = eachDay(period.current.from, period.current.to).map((date) => ({ date, ...(byDay.get(date) || { visits: 0, pageViews: 0 }) }));
  const totals = sum((account.totals || [])[0]), previous = sum((account.previous || [])[0]);
  const rows = (list, label) => (list || []).map((g) => ({ label: label(g.dimensions || {}), ...sum(g) }));
  const sources = rows(account.sources, (d) => cleanHost(d.refererHost) || "");
  const pages = rows(account.pages, (d) => cleanPath(d.requestPath));
  const devices = rows(account.devices, (d) => String(d.deviceType || "").toLowerCase()).map((r) => ({ ...r, label: DEVICE[r.label] || (r.label ? r.label.slice(0, 20) : "Other") }));
  return {
    period: { from: period.current.from, to: period.current.to, previousFrom: period.previous.from, previousTo: period.previous.to },
    totals, previous, series,
    sources: sources.map((r) => ({ host: r.label, visits: r.visits, pageViews: r.pageViews })),
    pages: pages.map((r) => ({ path: r.label, pageViews: r.pageViews, visits: r.visits })),
    devices: devices.map((r) => ({ device: r.label, pageViews: r.pageViews, visits: r.visits })),
  };
}

/** One request for everything. Throws an Error whose message is one of: unauthorized, query_failed, unreachable. */
export async function fetchWebAnalytics({ creds, siteTag, period, fetch: doFetch = fetch, timeoutMs = 8000 }) {
  const account = await graphql({ creds, query: QUERY, variables: { tag: siteTag, from: period.current.from, to: period.current.to, prevFrom: period.previous.from, prevTo: period.previous.to }, fetch: doFetch, timeoutMs });
  if (!account) throw new Error("unauthorized"); // an account the token cannot read comes back empty
  return parse(account, period);
}

/* ---------- Admin's "Test Cloudflare": tells a refused token, an unreadable account, a site tag with no data and real zero traffic apart ---------- */
// The GraphQL API answers a site tag it does not know (or one in another account) with empty, error-free results, exactly as it answers a real site with no traffic.
// So the test asks three things, using only the dataset and filters the page already uses (Account Analytics: Read is enough):
//   recent   page loads (bots excluded) for this tag in the period the client page shows (the last 7 complete days)
//   history  any page load for this tag (bots included) in the last 90 days, today included: proof the snippet has ever reported to this account under this tag
//   account  (only when history is empty; a separate request) any page load for ANY site in the account in the last 90 days
export const DIAG_QUERY = `query ($account: String!, $tag: string!, $from: Date!, $to: Date!, $historyFrom: Date!, $today: Date!) { viewer { accounts(filter: { accountTag: $account }) {
  recent: rumPageloadEventsAdaptiveGroups(filter: { siteTag: $tag, bot: 0, date_geq: $from, date_leq: $to }, limit: 1) { count }
  history: rumPageloadEventsAdaptiveGroups(filter: { siteTag: $tag, date_geq: $historyFrom, date_leq: $today }, limit: 1) { count }
} } }`;
export const PROBE_QUERY = `query ($account: String!, $historyFrom: Date!, $today: Date!) { viewer { accounts(filter: { accountTag: $account }) {
  account: rumPageloadEventsAdaptiveGroups(filter: { date_geq: $historyFrom, date_leq: $today }, limit: 1) { count }
} } }`;

/** One GraphQL request. Resolves to the account object, or null when the token cannot read that account. Throws unauthorized, query_failed or unreachable. */
async function graphql({ creds, query, variables, fetch: doFetch, timeoutMs }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(ENDPOINT, { method: "POST", signal: ctl.signal, headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { account: creds.account, ...variables } }) });
  } catch { throw new Error("unreachable"); } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("query_failed");
  let body;
  try { body = await res.json(); } catch { throw new Error("query_failed"); }
  if (body && Array.isArray(body.errors) && body.errors.length) {
    const first = body.errors[0] || {}, code = String((first.extensions && first.extensions.code) || "");
    throw new Error(/authz|authn|auth|permission|forbidden/i.test(code) || /not authorized|permission|access|authenticat/i.test(String(first.message)) ? "unauthorized" : "query_failed");
  }
  const accounts = body && body.data && body.data.viewer && body.data.viewer.accounts;
  return Array.isArray(accounts) && accounts[0] ? accounts[0] : null;
}
const countOf = (list) => int(list && list[0] && list[0].count);

/**
 * The result of a test:
 *   { ok: true,  status: "receiving", through, pageViews }      page loads in the last 7 complete days: everything works
 *   { ok: true,  status: "no_recent_traffic", through }         the tag has reported to this account in the last 90 days, but nothing in the last 7: the setup is right, traffic is genuinely zero
 *   { ok: false, code: "site_tag_no_data" }                      the account has Web Analytics data, but none ever arrived for this tag: the tag is wrong (perhaps the snippet's token
 *                                                                was copied instead of the site tag, or the site is in another account), or this site's snippet is missing
 *   { ok: false, code: "account_no_data" }                       no site in this account has reported anything in 90 days: the snippet is not on the site, or this is the wrong account
 *   { ok: false, code: "no_data" }                               no data for this tag, and the account-wide check could not be made
 *   { ok: false, code: "unauthorized" | "account_not_accessible" | "query_failed" | "unreachable" }
 * account_not_accessible: Cloudflare accepted the token but it cannot read this account id (a wrong account id, or a token limited to another account).
 */
export async function diagnose({ creds, siteTag, period, today, historyFrom, fetch: doFetch = fetch, timeoutMs = 8000 }) {
  let acct;
  try { acct = await graphql({ creds, query: DIAG_QUERY, variables: { tag: siteTag, from: period.current.from, to: period.current.to, historyFrom, today }, fetch: doFetch, timeoutMs }); }
  catch (e) { return { ok: false, code: e.message }; }
  if (!acct) return { ok: false, code: "account_not_accessible" };
  const recent = countOf(acct.recent), history = countOf(acct.history);
  if (recent > 0) return { ok: true, status: "receiving", through: period.current.to, pageViews: recent };
  if (history > 0) return { ok: true, status: "no_recent_traffic", through: period.current.to };
  let probe;
  try { probe = await graphql({ creds, query: PROBE_QUERY, variables: { historyFrom, today }, fetch: doFetch, timeoutMs }); } catch { return { ok: false, code: "no_data" }; }
  if (!probe) return { ok: false, code: "no_data" };
  return { ok: false, code: countOf(probe.account) > 0 ? "site_tag_no_data" : "account_no_data" };
}
