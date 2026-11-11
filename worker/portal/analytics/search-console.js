/**
 * Google Search Console for one website, read through the Search Analytics API (read-only). Framework signs in to Google once as a dedicated Google account (OAuth, scope webmasters.readonly) and
 * keeps the resulting refresh token as a Worker secret; no service account key exists. Three server settings, all Worker secrets: GSC_OAUTH_CLIENT_ID, GSC_OAUTH_CLIENT_SECRET, GSC_OAUTH_REFRESH_TOKEN.
 * That Google account is added as a Restricted (read-only) user on each client's Search Console property; the property is recorded per website in Admin.
 *
 * Figures are Google's own: clicks, impressions, click-through rate (clicks / impressions) and average position. Average position is an average over every search, place and device
 * where the site appeared; it is NOT the rank for one search. Search Console figures arrive about two days late, so the newest day shown is two days ago. Nothing here is estimated.
 * Errors are reduced to short codes; no secret, token or response body is ever put in an error. `reconnect_needed` means Google no longer accepts the refresh token (revoked, expired, or the
 * client settings are wrong): Framework has to authorise again (see worker/portal/WEBSITE-ANALYTICS.md).
 */
import { eachDay } from "./ranges.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const clean = (v, min, max) => { const t = typeof v === "string" ? v.trim() : ""; return t.length >= min && t.length <= max && !/\s/.test(t) ? t : ""; };

/** The three OAuth settings, or null unless all three are present and plausible. */
export function credentials(env) {
  const clientId = clean(env && env.GSC_OAUTH_CLIENT_ID, 10, 200), clientSecret = clean(env && env.GSC_OAUTH_CLIENT_SECRET, 8, 200), refreshToken = clean(env && env.GSC_OAUTH_REFRESH_TOKEN, 20, 1000);
  return clientId && clientSecret && refreshToken ? { clientId, clientSecret, refreshToken } : null;
}

const tokens = new Map(); // client id -> { token, until }: an access token is good for an hour, so it is reused for 50 minutes
/** An access token for the stored refresh token. 400/401 from Google (revoked, expired or wrong client) is `reconnect_needed`; anything else is `unreachable`. */
async function accessToken(creds, doFetch, now, signal) {
  const hit = tokens.get(creds.clientId);
  if (hit && hit.until > now.getTime()) return hit.token;
  let res;
  try {
    res = await doFetch(TOKEN_URL, { method: "POST", signal, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: creds.refreshToken, client_id: creds.clientId, client_secret: creds.clientSecret }).toString() });
  } catch { throw new Error("unreachable"); }
  if (res.status === 400 || res.status === 401) { tokens.delete(creds.clientId); throw new Error("reconnect_needed"); }
  if (!res.ok) throw new Error("unreachable");
  let j;
  try { j = await res.json(); } catch { throw new Error("unreachable"); }
  if (!j || typeof j.access_token !== "string" || !j.access_token) throw new Error("reconnect_needed");
  tokens.set(creds.clientId, { token: j.access_token, until: now.getTime() + 50 * 60000 });
  return j.access_token;
}
export const forgetTokens = () => tokens.clear();

async function query(property, token, body, doFetch, signal, creds) {
  let res;
  try { res = await doFetch(`${API}/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("unreachable"); }
  if (res.status === 401) { tokens.delete(creds.clientId); throw new Error("reconnect_needed"); } // the access token was refused: it is dropped, and the next read exchanges the refresh token again
  if (res.status === 403) throw new Error("no_access"); // the connected Google account is not a user on this property (or the Search Console API is off in the Google project)
  if (res.status === 404) throw new Error("property_not_found");
  if (res.status === 429) throw new Error("rate_limited");
  if (!res.ok) throw new Error("query_failed");
  let j;
  try { j = await res.json(); } catch { throw new Error("query_failed"); }
  return Array.isArray(j && j.rows) ? j.rows : [];
}

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);
const round = (n, d) => { const f = 10 ** d; return Math.round(n * f) / f; };
const totalsOf = (row) => {
  if (!row) return { clicks: 0, impressions: 0, ctr: null, position: null };
  const clicks = Math.round(num(row.clicks)), impressions = Math.round(num(row.impressions));
  return { clicks, impressions, ctr: impressions > 0 ? round(clicks / impressions, 4) : null, position: impressions > 0 && Number.isFinite(Number(row.position)) ? round(Number(row.position), 1) : null };
};

/** One period's figures plus the one before it. Throws an Error whose message is one of: reconnect_needed, no_access, property_not_found, rate_limited, query_failed, unreachable. */
export async function fetchSearchConsole({ creds, property, period, fetch: doFetch = fetch, now = new Date(), timeoutMs = 8000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const token = await accessToken(creds, doFetch, now, ctl.signal);
    const range = (p) => ({ startDate: p.from, endDate: p.to });
    const [daily, cur, prev] = await Promise.all([
      query(property, token, { ...range(period.current), dimensions: ["date"], rowLimit: 120 }, doFetch, ctl.signal, creds),
      query(property, token, { ...range(period.current), rowLimit: 1 }, doFetch, ctl.signal, creds), // no dimension: Google's own total for the period
      query(property, token, { ...range(period.previous), rowLimit: 1 }, doFetch, ctl.signal, creds),
    ]);
    const byDay = new Map(daily.map((r) => [r.keys && r.keys[0], totalsOf(r)]));
    const series = eachDay(period.current.from, period.current.to).map((date) => ({ date, ...(byDay.get(date) || { clicks: 0, impressions: 0, ctr: null, position: null }) }));
    return { period: { from: period.current.from, to: period.current.to, previousFrom: period.previous.from, previousTo: period.previous.to }, totals: totalsOf(cur[0]), previous: totalsOf(prev[0]), series };
  } finally { clearTimeout(timer); }
}
