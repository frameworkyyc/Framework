/**
 * Framework Admin — request router.
 *
 *   /api/admin/*   JSON API (feedback today; more modules later: add a handler file and one line below)
 *   /admin, /admin/*   the admin app: a small client-side app (admin/index.html + admin/assets/*)
 *
 * Every request is authenticated first (authenticateAdmin). Static admin files are served by the ASSETS binding
 * only AFTER that check, which is why wrangler.jsonc lists them under assets.run_worker_first.
 */

import { authenticateAdmin } from "./access.js";
import { handleFeedbackApi } from "./feedback-api.js";
import { json } from "../shared.js";

const ADMIN_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' https://api.fontshare.com",
  "font-src https://cdn.fontshare.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const withAdminHeaders = (response) => {
  const res = new Response(response.body, response);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Robots-Tag", "noindex, nofollow");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Content-Security-Policy", ADMIN_CSP);
  return res;
};

const MESSAGES = {
  unauthenticated: ["Sign in required", "Sign in with your Framework account to continue."],
  forbidden: ["Access denied", "This account doesn’t have access to Framework Admin."],
  not_configured: ["Admin unavailable", "Framework Admin isn’t available right now."],
};

/** A small branded page for denied page requests. Reveals nothing about why beyond a coarse category. */
function deniedPage(status, code) {
  const [title, copy] = MESSAGES[code] || MESSAGES.forbidden;
  const html = `<!DOCTYPE html>
<html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${title} — Framework</title>
<link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=switzer@600,700&f[]=general-sans@400,500,600&display=swap">
<link rel="stylesheet" href="/assets/css/styles.css"></head>
<body><main class="page-head"><div class="container"><span class="eyebrow">Framework Admin</span>
<h1 class="display">${title}.</h1><p class="lead">${copy}</p></div></main></body></html>`;
  return withAdminHeaders(
    new Response(html, { status, headers: { "Content-Type": "text/html; charset=utf-8", "X-Admin-Auth": code } }),
  );
}

async function handleApi(request, env, principal, path) {
  // Modules register here. Each handler returns a Response, or null when the path isn't one of its routes.
  const handlers = [handleFeedbackApi];
  for (const handler of handlers) {
    const res = await handler(request, env, principal, path);
    if (res) return res;
  }
  return json({ error: "not_found" }, 404);
}

async function handlePage(request, env, pathname) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return withAdminHeaders(new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } }));
  }
  const url = new URL(request.url);
  // Files under /admin/assets/ are served as-is; every other /admin path is the app shell (client-side routing).
  if (pathname.startsWith("/admin/assets/")) return withAdminHeaders(await env.ASSETS.fetch(request));
  return withAdminHeaders(await env.ASSETS.fetch(new Request(`${url.origin}/admin/`, { method: request.method, headers: request.headers })));
}

export async function handleAdmin(request, env, deps = {}) {
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const isApi = pathname === "/api/admin" || pathname.startsWith("/api/admin/");

  const auth = await authenticateAdmin(request, env, deps);
  if (!auth.ok) {
    if (isApi) return json({ error: auth.code }, auth.status, { "X-Admin-Auth": auth.code });
    return deniedPage(auth.status, auth.code);
  }

  if (isApi) return handleApi(request, env, auth, pathname.slice("/api/admin".length) || "/");
  return handlePage(request, env, pathname);
}
