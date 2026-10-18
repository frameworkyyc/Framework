/**
 * /card: serves the static card page, but makes its link-preview metadata match the host it is opened on.
 *
 * The page's HTML carries the PRODUCTION URLs (https://frameworkco.ca/card and its preview image), which is what
 * messaging apps read. On any other host (the Staging preview, a local server) those absolute URLs are rewritten to that
 * host's own origin, so a link shared from Staging previews Staging, and Staging is told not to be indexed.
 * Production (frameworkco.ca, www.frameworkco.ca) is returned exactly as stored. If anything goes wrong the unmodified
 * page is served: the card must never fail because of this.
 */

export const PRODUCTION_HOSTS = ["frameworkco.ca", "www.frameworkco.ca"];

// Tags whose absolute URL must follow the environment.
const META_TAG = /<(?:link|meta)\b[^>]*(?:rel="canonical"|property="og:(?:url|image)"|name="twitter:image")[^>]*>/g;

export function rewriteCardHtml(html, origin) {
  return html.replace(META_TAG, (tag) => tag.replace(/https:\/\/frameworkco\.ca\//g, origin + "/"));
}

export async function handleCardPage(request, env) {
  const unmodified = () => env.ASSETS.fetch(request);
  if (request.method !== "GET" && request.method !== "HEAD") return unmodified();
  let res;
  try {
    res = await unmodified();
  } catch (err) {
    console.error("card page error", err && err.message);
    throw err;
  }
  const url = new URL(request.url);
  if (PRODUCTION_HOSTS.includes(url.hostname)) return res;
  try {
    const type = res.headers.get("Content-Type") || "";
    if (res.status !== 200 || !type.includes("text/html")) return res;
    const html = rewriteCardHtml(await res.text(), url.origin);
    const headers = new Headers(res.headers);
    headers.delete("Content-Length");
    headers.delete("ETag");
    headers.set("X-Robots-Tag", "noindex, nofollow");
    headers.set("Cache-Control", "no-cache");
    return new Response(request.method === "HEAD" ? null : html, { status: 200, headers });
  } catch (err) {
    console.error("card rewrite error", err && err.message);
    return unmodified();
  }
}
