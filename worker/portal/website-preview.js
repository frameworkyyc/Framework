/**
 * Live website previews for the client Website page. Decides, from the website's own response HEADERS, whether it may be shown in a frame on the portal. Nothing is proxied or
 * rewritten: the visitor's browser loads the website itself, and a website that forbids framing (X-Frame-Options, or a CSP frame-ancestors that leaves the portal out) is simply not
 * previewed: the page falls back to the optional screenshot or a plain card with a Visit Website button. The body of the response is never read.
 *
 * The check is one plain GET per website (redirects followed by hand, at most MAX_HOPS, every hop https and a public-looking host), with a short timeout, cached for a while so
 * a page view does not hit the website each time. The result also lists every origin the frame passes through, because the page's Content-Security-Policy names exactly those
 * (and only on the Website page) in frame-src.
 */
const MAX_HOPS = 4;
const TIMEOUT_MS = 3000;
const TTL_OK = 3600, TTL_NO = 600;
const PRIVATE_SUFFIX = /\.(local|localhost|internal|lan|home|corp|test|invalid|example)$/i;

/** A website address this check is willing to contact: https, a public-looking DNS name (never an IP address, localhost or an internal name), default port, no credentials. */
export function previewableUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return null;
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[0-9.]+$/.test(host) || host.length > 253 || PRIVATE_SUFFIX.test(host) || /[^a-z0-9.-]/.test(host)) return null;
  return u;
}

/** The sources of a CSP frame-ancestors directive that let `portalOrigin` frame the page; `siteOrigin` is the page's own origin (for 'self'). */
function ancestorsAllow(tokens, portalOrigin, siteOrigin) {
  const portal = new URL(portalOrigin);
  return tokens.some((raw) => {
    const t = raw.toLowerCase();
    if (t === "*" || t === "https:") return true;
    if (t === "'self'") return siteOrigin === portalOrigin;
    if (t === "'none'") return false;
    const m = /^(?:https:\/\/)?(\*\.)?([a-z0-9.-]+)(?::(\d+|\*))?$/.exec(t);
    if (!m) return false;
    if (m[3] && m[3] !== "*" && m[3] !== "443") return false;
    return m[1] ? portal.hostname.endsWith("." + m[2]) : portal.hostname === m[2];
  });
}

/** Does this response's header set let the portal frame it? Both the CSP and the older X-Frame-Options must agree (a browser that understands the CSP ignores the other, but being strict costs nothing). */
export function framingAllowed(headers, portalOrigin, siteOrigin) {
  const xfo = (headers.get("x-frame-options") || "").toLowerCase();
  if (xfo) {
    for (const v of xfo.split(",").map((x) => x.trim())) {
      if (v === "sameorigin") { if (siteOrigin !== portalOrigin) return false; }
      else return false; // deny, allow-from (no longer honoured) or anything unrecognised
    }
  }
  const csp = headers.get("content-security-policy") || "";
  for (const policy of csp.split(",")) {
    const dir = policy.split(";").map((x) => x.trim()).find((x) => /^frame-ancestors(\s|$)/i.test(x));
    if (!dir) continue;
    const tokens = dir.split(/\s+/).slice(1);
    if (!tokens.length || !ancestorsAllow(tokens, portalOrigin, siteOrigin)) return false;
  }
  return true;
}

/** The framing-relevant parts of a response, for the Admin check and the logs: only these headers, nothing else is kept. */
function framingSummary(res) {
  const csp = res.headers.get("content-security-policy") || "";
  const ancestors = csp.split(",").map((p) => p.split(";").map((x) => x.trim()).find((x) => /^frame-ancestors(\s|$)/i.test(x))).filter(Boolean);
  return { xFrameOptions: res.headers.get("x-frame-options") || null, frameAncestors: ancestors, contentType: (res.headers.get("content-type") || "").split(";")[0].trim() || null };
}

async function inspectSite(rawUrl, { fetch: doFetch, portalOrigin }) {
  const origins = [], hops = [];
  let url = previewableUrl(rawUrl);
  const done = (embeddable, reason, extra = {}) => ({ embeddable, reason, frameOrigins: embeddable ? origins : [], status: hops.length ? hops[hops.length - 1].status : null, hops, ...extra });
  for (let hop = 0; url && hop <= MAX_HOPS; hop++) {
    if (!origins.includes(url.origin)) origins.push(url.origin);
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res;
    try { res = await doFetch(url.href, { method: "GET", redirect: "manual", signal: ctl.signal, headers: { Accept: "text/html", "User-Agent": "Framework-Portal-Preview-Check/1.0 (+https://frameworkco.ca)" } }); }
    catch (e) { hops.push({ host: url.hostname, status: null }); return done(false, "unreachable", { error: e && e.name ? String(e.name) : "Error" }); }
    finally { clearTimeout(timer); }
    hops.push({ host: url.hostname, status: res.status });
    if (res.status >= 300 && res.status < 400) {
      try { await res.body?.cancel(); } catch { /* nothing to read */ }
      let next = null;
      try { next = previewableUrl(new URL(res.headers.get("location") || "", url).href); } catch { next = null; }
      if (!next) return done(false, "redirect");
      url = next;
      continue;
    }
    try { await res.body?.cancel(); } catch { /* the body is never read */ }
    const summary = framingSummary(res);
    if (res.status < 200 || res.status > 299) return done(false, "status", { summary });
    if (!/^text\/html\b/i.test(res.headers.get("content-type") || "")) return done(false, "not_html", { summary });
    if (!framingAllowed(res.headers, portalOrigin, url.origin)) return done(false, "blocked", { summary });
    return done(true, "ok", { summary });
  }
  return done(false, "redirect");
}

/**
 * { embeddable, reason, frameOrigins } for a website address. Never throws and never reads the page. `fetch` absent (or an address this check will not contact) means "not embeddable":
 * the page then shows its fallback. `cache` is the Workers Cache API default cache (or any object with match/put); absent means no caching.
 */
export async function checkEmbeddable(rawUrl, { fetch: doFetch, portalOrigin, cache } = {}) {
  const none = (reason) => ({ embeddable: false, reason, frameOrigins: [], status: null });
  if (typeof doFetch !== "function" || !portalOrigin || !previewableUrl(rawUrl)) return none("unavailable");
  const key = cache ? new Request(`https://preview-check.framework.invalid/v1/${encodeURIComponent(portalOrigin)}/${encodeURIComponent(rawUrl)}`) : null;
  try {
    if (key) { const hit = await cache.match(key); if (hit) { const j = await hit.json(); if (j && typeof j.embeddable === "boolean" && Array.isArray(j.frameOrigins)) return { status: null, ...j, cached: true }; } }
  } catch { /* a cache miss is fine */ }
  let result;
  try { const r = await inspectSite(rawUrl, { fetch: doFetch, portalOrigin }); result = { embeddable: r.embeddable, reason: r.reason, frameOrigins: r.frameOrigins, status: r.status }; } catch { result = none("unreachable"); }
  try { if (key) await cache.put(key, new Response(JSON.stringify(result), { headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${result.embeddable ? TTL_OK : TTL_NO}` } })); } catch { /* caching is best effort */ }
  return result;
}

/** The frame-src sources to add to the page's CSP: only https origins this module itself produced. */
export const frameSources = (preview) => (preview && preview.embeddable ? preview.frameOrigins.filter((o) => /^https:\/\/[a-z0-9.-]+$/.test(o)) : []);

/**
 * The full, UNCACHED picture of one website for Framework Admin ("Check live preview"): the verdict, why, the redirect chain (host and status only) and the framing-relevant headers the
 * website sent. Used to see exactly what the portal's check sees from the Worker, since that is not what a visitor's browser or a developer's laptop sees.
 */
export async function diagnoseEmbeddable(rawUrl, { fetch: doFetch, portalOrigin } = {}) {
  if (typeof doFetch !== "function" || !portalOrigin) return { embeddable: false, reason: "unavailable", frameOrigins: [], status: null, hops: [] };
  if (!previewableUrl(rawUrl)) return { embeddable: false, reason: "address_not_checkable", frameOrigins: [], status: null, hops: [] };
  try { return await inspectSite(rawUrl, { fetch: doFetch, portalOrigin }); } catch { return { embeddable: false, reason: "unreachable", frameOrigins: [], status: null, hops: [] }; }
}
