/**
 * Cloudflare Web Analytics for one website, read through Cloudflare's GraphQL Analytics API (account dataset rumPageloadEventsAdaptiveGroups, filtered by the site's own site tag).
 * Needs two server settings: CF_ANALYTICS_API_TOKEN (a token with Account > Account Analytics > Read; a Worker secret) and CF_ANALYTICS_ACCOUNT_ID.
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
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await doFetch(ENDPOINT, {
      method: "POST", signal: ctl.signal,
      headers: { Authorization: `Bearer ${creds.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUERY, variables: { account: creds.account, tag: siteTag, from: period.current.from, to: period.current.to, prevFrom: period.previous.from, prevTo: period.previous.to } }),
    });
  } catch { throw new Error("unreachable"); } finally { clearTimeout(timer); }
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized");
  if (!res.ok) throw new Error("query_failed");
  let body;
  try { body = await res.json(); } catch { throw new Error("query_failed"); }
  if (body && Array.isArray(body.errors) && body.errors.length) {
    const code = String((body.errors[0] && body.errors[0].extensions && body.errors[0].extensions.code) || "");
    throw new Error(/authz|auth|permission|forbidden/i.test(code) || /not authorized|permission|access/i.test(String(body.errors[0] && body.errors[0].message)) ? "unauthorized" : "query_failed");
  }
  const account = body && body.data && body.data.viewer && body.data.viewer.accounts && body.data.viewer.accounts[0];
  if (!account) throw new Error("unauthorized"); // an account the token cannot read comes back empty
  return parse(account, period);
}
