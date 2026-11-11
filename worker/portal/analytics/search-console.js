/**
 * Google Search Console for one website, read through the Search Analytics API with a service account (read-only). Needs one server setting: GSC_SERVICE_ACCOUNT_JSON (the downloaded
 * key file, a Worker secret). Each client adds the service account's email as a Restricted user on their Search Console property; the property is recorded per website in Admin.
 *
 * Figures are Google's own: clicks, impressions, click-through rate (clicks / impressions) and average position. Average position is an average over every search, place and device
 * where the site appeared; it is NOT the rank for one search. Search Console figures arrive about two days late, so the newest day shown is two days ago. Nothing here is estimated.
 * Errors are reduced to short codes; no key, token or response body is ever put in an error.
 */
import { eachDay } from "./ranges.js";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://searchconsole.googleapis.com/webmasters/v3/sites";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

/** The service account from the secret, or null when it is missing or not a usable key file. */
export function credentials(env) {
  const raw = env && typeof env.GSC_SERVICE_ACCOUNT_JSON === "string" ? env.GSC_SERVICE_ACCOUNT_JSON.trim() : "";
  if (!raw) return null;
  try {
    const j = JSON.parse(raw);
    if (j && j.type === "service_account" && typeof j.client_email === "string" && /^[^\s@]+@[^\s@]+$/.test(j.client_email) && typeof j.private_key === "string" && j.private_key.includes("BEGIN PRIVATE KEY")) return { email: j.client_email, key: j.private_key };
  } catch { /* not JSON */ }
  return null;
}

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const text = (s) => b64url(new TextEncoder().encode(s));

async function importKey(pem) {
  const der = Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
}

/** The signed assertion Google exchanges for an access token (RS256, one hour). Exported for tests. */
export async function signAssertion(creds, now = new Date()) {
  const iat = Math.floor(now.getTime() / 1000);
  const head = text(JSON.stringify({ alg: "RS256", typ: "JWT" })), claims = text(JSON.stringify({ iss: creds.email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", await importKey(creds.key), new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

const tokens = new Map(); // email -> { token, until }: an access token is good for an hour, so it is reused for 50 minutes
async function accessToken(creds, doFetch, now, signal) {
  const hit = tokens.get(creds.email);
  if (hit && hit.until > now.getTime()) return hit.token;
  let res;
  try {
    res = await doFetch(TOKEN_URL, { method: "POST", signal, headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: await signAssertion(creds, now) }).toString() });
  } catch { throw new Error("unreachable"); }
  if (!res.ok) throw new Error("unauthorized");
  let j;
  try { j = await res.json(); } catch { throw new Error("unauthorized"); }
  if (!j || typeof j.access_token !== "string") throw new Error("unauthorized");
  tokens.set(creds.email, { token: j.access_token, until: now.getTime() + 50 * 60000 });
  return j.access_token;
}
export const forgetTokens = () => tokens.clear();

async function query(property, token, body, doFetch, signal) {
  let res;
  try { res = await doFetch(`${API}/${encodeURIComponent(property)}/searchAnalytics/query`, { method: "POST", signal, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
  catch { throw new Error("unreachable"); }
  if (res.status === 401 || res.status === 403) throw new Error("unauthorized"); // the service account has not been added to this property
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

/** One period's figures plus the one before it. Throws an Error whose message is one of: unauthorized, property_not_found, rate_limited, query_failed, unreachable. */
export async function fetchSearchConsole({ creds, property, period, fetch: doFetch = fetch, now = new Date(), timeoutMs = 8000 }) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const token = await accessToken(creds, doFetch, now, ctl.signal);
    const range = (p) => ({ startDate: p.from, endDate: p.to });
    const [daily, cur, prev] = await Promise.all([
      query(property, token, { ...range(period.current), dimensions: ["date"], rowLimit: 120 }, doFetch, ctl.signal),
      query(property, token, { ...range(period.current), rowLimit: 1 }, doFetch, ctl.signal), // no dimension: Google's own total for the period
      query(property, token, { ...range(period.previous), rowLimit: 1 }, doFetch, ctl.signal),
    ]);
    const byDay = new Map(daily.map((r) => [r.keys && r.keys[0], totalsOf(r)]));
    const series = eachDay(period.current.from, period.current.to).map((date) => ({ date, ...(byDay.get(date) || { clicks: 0, impressions: 0, ctr: null, position: null }) }));
    return { period: { from: period.current.from, to: period.current.to, previousFrom: period.previous.from, previousTo: period.previous.to }, totals: totalsOf(cur[0]), previous: totalsOf(prev[0]), series };
  } finally { clearTimeout(timer); }
}
