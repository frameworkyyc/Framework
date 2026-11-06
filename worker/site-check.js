/**
 * Website availability check for Admin -> Leads. Answers one question honestly: does this business's website load for a person? Three answers, never two:
 *
 *   online      a normal page was served (after any redirects, http -> https, www <-> apex).
 *   offline     the site itself is missing or broken, with hard evidence: the domain does not exist (DNS), the home page is a real 404/410, the server (or the CDN in
 *               front of it) reports its origin unreachable or answers a 5xx on every try.
 *   unverified  we could NOT tell. Bot protection and rate limits (401/403/405/406/429/999, challenge pages, "Just a moment"), a redirect loop that needs cookies, or a
 *               failure to connect that could just as well be our address being refused. A blocked request is NEVER offline: it says nothing about whether people can open it.
 *
 * Every check records what happened (HTTP status, redirects, protection seen, timings, the failure reason) so a person can see why. Pure apart from the injected
 * fetch: pass `fetchImpl` in tests. The address comes from finder data (untrusted), so only public http(s) hosts on ports 80/443 are ever requested.
 */

export const SITE_STATES = Object.freeze(["online", "offline", "unverified"]);
export const CHECK_TIMEOUT_MS = 9000;
export const MAX_HOPS = 6;
const READ_LIMIT = 24 * 1024; // enough to recognise a challenge page; the rest of the body is never read
// A browser-compatible agent (many sites refuse anything else) that still says who is asking.
export const CHECK_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 FrameworkSiteCheck/1.0 (+https://frameworkco.ca)";
const HEADERS = { "User-Agent": CHECK_UA, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8", "Accept-Language": "en-CA,en;q=0.9", "Upgrade-Insecure-Requests": "1" };

/* ---------- which addresses may be requested ---------- */

const PRIVATE_SUFFIX = /\.(local|localhost|internal|lan|home|corp|intranet|test|invalid|onion)$/i;
/** A public host name only: no IP literals, no single-label or internal names. */
export function publicHost(host) {
  const h = String(host || "").toLowerCase().replace(/\.$/, "");
  if (!h || h.length > 253 || /[^a-z0-9.-]/.test(h) || h.startsWith(".") || h.includes("..")) return false;
  if (/^[\d.]+$/.test(h) || h.includes(":")) return false; // IPv4 / IPv6 literal
  if (!h.includes(".") || h === "localhost" || PRIVATE_SUFFIX.test(h)) return false;
  return h.split(".").every((l) => l.length > 0 && l.length <= 63 && !l.startsWith("-") && !l.endsWith("-")) && /[a-z]/.test(h.split(".").pop());
}

/** The URL to check, or null when it is not a public web address. Tracking parameters and fragments are dropped: the question is about the site, not one campaign link. */
export function normaliseTarget(input) {
  let raw = String(input || "").trim();
  if (!raw) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = "https://" + raw;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password || !publicHost(u.hostname)) return null;
  if (u.port && u.port !== "80" && u.port !== "443") return null;
  u.hash = "";
  u.search = "";
  return u;
}

const swapWww = (host) => (host.startsWith("www.") ? host.slice(4) : "www." + host);
/** The addresses a visitor might reach the site by, most likely first: as given, www <-> apex, then plain http (a site with a broken certificate still loads that way). */
export function candidates(url) {
  const out = [];
  const add = (protocol, host) => { const u = new URL(url.href); u.protocol = protocol; u.hostname = host; u.port = ""; if (!out.some((x) => x.href === u.href)) out.push(u); };
  add("https:", url.hostname);
  add("https:", swapWww(url.hostname));
  add("http:", url.hostname);
  return out;
}

/* ---------- what a response means ---------- */

/** Bot protection a response betrays, or null. Headers first; the page text only for the markers a challenge page carries. */
export function detectProtection(status, headers, body = "") {
  const h = (n) => String(headers.get(n) || "");
  const server = h("server").toLowerCase();
  const text = String(body).slice(0, READ_LIMIT);
  if (h("cf-mitigated").toLowerCase() === "challenge" || /Just a moment\.\.\.|cf-chl-|challenge-platform|cf_chl_opt|Attention Required! \| Cloudflare|Checking your browser before accessing/i.test(text)) return "Cloudflare challenge";
  if (h("x-datadome") || /datadome/i.test(server) || /captcha-delivery\.com|geo\.captcha-delivery/i.test(text)) return "DataDome";
  if (h("x-sucuri-id") || /sucuri/i.test(server) || /Sucuri WebSite Firewall/i.test(text)) return "Sucuri firewall";
  if (h("x-iinfo") || /incapsula|imperva/i.test(h("x-cdn")) || /_Incapsula_Resource|Incapsula incident|Pardon Our Interruption/i.test(text)) return "Imperva / Incapsula";
  if (/px-captcha|PerimeterX|_pxhd|Press & Hold to confirm you are a human/i.test(text + h("set-cookie"))) return "PerimeterX / HUMAN";
  if (/akamai/i.test(server) && [403, 429, 503].includes(status) || /errors\.edgesuite\.net|Reference&#32;&#35;|Access Denied.{0,80}You don't have permission/is.test(text)) return "Akamai";
  if (/awswaf|aws-waf/i.test(h("x-amzn-waf-action") + h("x-amz-cf-pop") + text.slice(0, 2000)) && [202, 403, 405].includes(status)) return "AWS WAF";
  if (/please verify you are a human|verify you are not a robot|unusual traffic|are you a robot|bot detection|access denied.*automated/i.test(text)) return "Bot check page";
  if (h("cf-ray") && /cloudflare/i.test(server) && [403, 429, 503].includes(status)) return "Cloudflare (blocked)";
  return null;
}

const BLOCKED_STATUS = new Set([401, 403, 405, 406, 407, 409, 412, 418, 423, 429, 451, 999]);
const ORIGIN_DOWN = new Set([521, 522, 523, 524, 530]); // Cloudflare: the web server behind it is down or unreachable
const TEMPORARY = new Set([500, 502, 503, 504, 520, 525, 526, 527]);

const short = (s, n) => String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").slice(0, n);

/** Names a failed fetch in plain words. Workers do not expose DNS/TLS codes, so this is the message text only; the DNS question is asked separately (see dnsMissing). */
export function describeError(e) {
  const name = (e && e.name) || "Error", msg = short(e && e.message, 120);
  if (name === "AbortError" || name === "TimeoutError" || /timed? ?out|aborted/i.test(msg)) return "timed out";
  if (/certificate|ssl|tls|handshake|self.signed/i.test(msg)) return "TLS/certificate error";
  if (/redirect/i.test(msg)) return "too many redirects";
  if (/connection (was )?(reset|refused|closed|lost)|ECONN|network connection/i.test(msg)) return "connection refused or reset";
  return msg ? `request failed (${msg})` : "request failed";
}

/* ---------- the requests ---------- */

async function readStart(res) {
  try {
    if (!res.body) return "";
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let text = "";
    while (text.length < READ_LIMIT) {
      const { value, done } = await reader.read();
      if (done) break;
      text += dec.decode(value, { stream: true });
    }
    reader.cancel().catch(() => {}); // the rest is not wanted; never wait for it
    return text.slice(0, READ_LIMIT);
  } catch { return ""; }
}

const cookiesOf = (res) => {
  let list = [];
  try { list = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : []; } catch { /* none */ }
  return list.map((c) => String(c).split(";")[0]).filter((c) => c.includes("="));
};

/**
 * One address, following redirects by hand (each hop is checked to be a public web address, and cookies are carried so a cookie-setting redirect is not mistaken
 * for a loop). Returns { ok, status, finalUrl, hops, ms, protection, body, headers } or { ok: false, error, hops, ms }.
 */
async function attempt(url, fetchImpl, timeoutMs, now) {
  const started = now();
  const jar = new Map();
  let current = new URL(url.href), hops = 0;
  const seen = new Set();
  for (;;) {
    const headers = { ...HEADERS };
    if (jar.size) headers.Cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    let res;
    try {
      res = await fetchImpl(current.href, { method: "GET", redirect: "manual", headers, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
    } catch (e) {
      return { ok: false, error: describeError(e), hops, ms: now() - started, at: current.href };
    }
    for (const c of cookiesOf(res)) { const i = c.indexOf("="); jar.set(c.slice(0, i), c.slice(i + 1)); }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      try { res.body?.cancel().catch(() => {}); } catch { /* ignore */ }
      let next;
      try { next = new URL(res.headers.get("location"), current); } catch { return { ok: false, error: "redirect to an invalid address", hops, ms: now() - started, at: current.href, status: res.status }; }
      if (!normaliseTarget(next.href) && !(next.search || next.hash)) return { ok: false, error: "redirect to a non-public address", hops, ms: now() - started, at: current.href, status: res.status };
      const key = next.href;
      if (++hops > MAX_HOPS || seen.has(key)) return { ok: false, error: seen.has(key) ? "redirect loop" : "too many redirects", hops, ms: now() - started, at: current.href, status: res.status, loop: true };
      seen.add(key);
      current = next;
      continue;
    }
    const body = res.status >= 200 && res.status < 600 ? await readStart(res) : "";
    return { ok: true, status: res.status, finalUrl: current.href, hops, ms: now() - started, headers: res.headers, protection: detectProtection(res.status, res.headers, body), body, bytes: body.length };
  }
}

/** True only when DNS says the name does not exist (NXDOMAIN) for the host AND its www/apex twin: the one network failure that proves a site is gone. */
export async function dnsMissing(host, fetchImpl, timeoutMs = 4000) {
  const ask = async (name) => {
    try {
      const r = await fetchImpl(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=A`, { headers: { Accept: "application/dns-json" }, signal: typeof AbortSignal !== "undefined" && AbortSignal.timeout ? AbortSignal.timeout(timeoutMs) : undefined });
      if (!r.ok) return null;
      const j = await r.json();
      return typeof j.Status === "number" ? j.Status : null;
    } catch { return null; }
  };
  const [a, b] = await Promise.all([ask(host), ask(swapWww(host))]);
  return a === 3 && (b === 3 || b === null);
}

const out = (state, reason, extra) => ({ state, reason, ...extra });

/** Judges one finished attempt: online | offline | unverified, with the reason. */
function judge(a) {
  if (!a.ok) return out("unverified", a.error, { status: a.status || null });
  const s = a.status;
  if (s >= 200 && s < 300) return a.protection ? out("unverified", `challenge page (${a.protection})`, { status: s }) : out("online", s === 200 ? "ok" : `ok (${s})`, { status: s });
  if (s >= 300 && s < 400) return out("unverified", `redirect without a destination (${s})`, { status: s });
  if (a.protection || BLOCKED_STATUS.has(s)) return out("unverified", `blocked or protected (HTTP ${s}${a.protection ? `, ${a.protection}` : ""})`, { status: s, protected: true });
  if (s === 404 || s === 410) return out("offline", `home page not found (HTTP ${s})`, { status: s });
  if (ORIGIN_DOWN.has(s)) return out("offline", `web server unreachable (HTTP ${s})`, { status: s });
  if (TEMPORARY.has(s)) return out("unverified", `server error (HTTP ${s})`, { status: s, temporary: true });
  return out("unverified", `unexpected response (HTTP ${s})`, { status: s });
}

const RANK = { online: 3, offline: 2, unverified: 1 };

/**
 * Checks a website. Tries each address a visitor might use until one proves the site online; a protected site is reported unverified (never offline); a
 * temporary server error is retried once; offline needs hard evidence. Returns
 *   { state, reason, httpStatus, finalUrl, redirects, protection, attempts: [{ url, status, error, ms }], summary, checkedAt }
 * or { state: "unverified", reason: "not a public web address" } for an address that must not be requested.
 */
export async function checkSite(website, { fetchImpl = globalThis.fetch, timeoutMs = CHECK_TIMEOUT_MS, now = () => Date.now(), pause = (ms) => new Promise((r) => setTimeout(r, ms)), at = new Date() } = {}) {
  const checkedAt = at.toISOString();
  const target = normaliseTarget(website);
  if (!target) return { state: "unverified", reason: "not a public web address", httpStatus: null, finalUrl: null, redirects: 0, protection: null, attempts: [], summary: "Unverified: the address on file is not a public web address.", checkedAt };
  if (typeof fetchImpl !== "function") return { state: "unverified", reason: "no network access to check from", httpStatus: null, finalUrl: null, redirects: 0, protection: null, attempts: [], summary: "Unverified: no network access to check from.", checkedAt };

  const attempts = [];
  let best = null, bestAttempt = null, sawProtection = null, connectFailures = 0, tried = 0;
  for (const url of candidates(target)) {
    let a = await attempt(url, fetchImpl, timeoutMs, now);
    tried++;
    let verdict = judge(a);
    if (verdict.temporary) { await pause(1200); const again = await attempt(url, fetchImpl, timeoutMs, now); tried++; const v2 = judge(again); attempts.push(rec(url, a, verdict)); a = again; verdict = v2.state === "online" ? v2 : { ...verdict, ...(v2.status ? { status: v2.status, reason: v2.reason } : {}), state: v2.state === "unverified" && v2.temporary ? "offline" : v2.state, reason: v2.state === "unverified" && v2.temporary ? `server error on every try (HTTP ${v2.status})` : v2.reason }; }
    attempts.push(rec(url, a, verdict));
    if (verdict.protected || (a.ok && a.protection)) sawProtection = a.protection || sawProtection || "bot protection";
    if (!a.ok && !a.loop) connectFailures++;
    if (!best || RANK[verdict.state] > RANK[best.state]) { best = verdict; bestAttempt = a; }
    if (verdict.state === "online") break;
  }
  // Nothing answered at all: only a DNS "no such domain" proves the site is gone; refused/timeouts from here prove nothing about visitors.
  if (best && best.state === "unverified" && !bestAttempt.ok && connectFailures === tried && !best.protected) {
    if (await dnsMissing(target.hostname, fetchImpl)) best = out("offline", "domain does not exist (DNS)", { status: null });
    else best = out("unverified", `could not connect from here (${best.reason})`, { status: null });
  }
  const finalUrl = bestAttempt && bestAttempt.finalUrl ? bestAttempt.finalUrl : null;
  const result = {
    state: best.state, reason: best.reason, httpStatus: best.status || null, finalUrl, redirects: bestAttempt ? bestAttempt.hops || 0 : 0,
    protection: sawProtection || (best.protected ? "bot protection" : null), attempts, checkedAt,
  };
  result.summary = summarise(result);
  return result;
}

const rec = (url, a, v) => ({ url: url.href, status: a.ok ? a.status : a.status || null, error: a.ok ? null : a.error, ms: Math.round(a.ms || 0), hops: a.hops || 0, result: v.state });

/** One plain sentence for the timeline (300 characters at most; no addresses of people, only the site's own host). */
export function summarise(r) {
  const word = { online: "Online", offline: "Offline", unverified: "Unverified" }[r.state];
  const bits = [r.httpStatus && !/HTTP \d/.test(r.reason) ? `HTTP ${r.httpStatus}` : null, r.redirects ? `${r.redirects} redirect${r.redirects === 1 ? "" : "s"}` : null, r.protection && !/protected|challenge/i.test(r.reason) ? `protected by ${r.protection}` : null].filter(Boolean);
  let host = "";
  try { host = r.finalUrl ? ` at ${new URL(r.finalUrl).host}` : ""; } catch { /* none */ }
  const note = r.state === "unverified" ? " Not treated as offline." : "";
  return short(`${word}: ${r.reason}${bits.length ? ` (${bits.join(", ")})` : ""}${host}.${note}`, 300);
}

/** The short diagnostic lines stored with the lead (the same strings the review screen lists), at most 4. */
export function diagnosticLines(r) {
  const lines = [`Checked ${r.checkedAt.slice(0, 10)}: ${r.state}, ${r.reason}`];
  if (r.httpStatus) lines.push(`HTTP status ${r.httpStatus}${r.redirects ? ` after ${r.redirects} redirect${r.redirects === 1 ? "" : "s"}` : ""}`);
  if (r.protection) lines.push(`Bot protection seen: ${r.protection}`);
  const failed = r.attempts.filter((a) => a.error).slice(0, 1);
  for (const a of failed) lines.push(`Could not connect to ${new URL(a.url).host}: ${a.error}`);
  return lines.map((l) => short(l, 120)).slice(0, 4);
}
