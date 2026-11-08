/**
 * /api/card/wallet.pkpass: serves the pre-signed Apple Wallet pass for the digital business card.
 *
 * The pass is signed ahead of time on the owner's computer (scripts/wallet/) and committed as a static file, so this Worker never
 * holds a private key or certificate. It only serves the file, and only when assets/wallet/pass-meta.json says the pass is ready
 * AND was signed with an Apple-issued certificate: a missing, unfinished or test-signed pass answers 404, never a broken download.
 *
 * Reserved for later: /api/card/wallet/ (with a trailing path) is where Apple's automatic-update web service would live
 * (registrations, pass refresh, logs). It answers 404 until that exists. See worker/WALLET.md.
 */
import { PRODUCTION_HOSTS } from "./card.js";

export const WALLET_PASS_PATH = "/api/card/wallet.pkpass";
const PASS_ASSET = "/assets/wallet/Framework-card.pkpass";
const META_ASSET = "/assets/wallet/pass-meta.json";
const PASS_TYPE_ID = "pass.ca.frameworkco.card";

const notFound = () =>
  new Response(JSON.stringify({ error: "not_found" }), {
    status: 404,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export async function passIsReady(env, origin) {
  try {
    const res = await env.ASSETS.fetch(new Request(origin + META_ASSET));
    if (res.status !== 200) return false;
    const meta = await res.json();
    return meta.status === "ready" && meta.signing === "apple" && meta.passTypeIdentifier === PASS_TYPE_ID;
  } catch {
    return false;
  }
}

export async function handleWalletPass(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "GET, HEAD" },
    });
  }
  const url = new URL(request.url);
  if (!(await passIsReady(env, url.origin))) return notFound();
  let res;
  try {
    res = await env.ASSETS.fetch(new Request(url.origin + PASS_ASSET));
  } catch (err) {
    console.error("wallet pass error", err && err.message);
    return notFound();
  }
  if (res.status !== 200) return notFound();
  const headers = new Headers({
    "Content-Type": "application/vnd.apple.pkpass",
    "Content-Disposition": 'inline; filename="Framework-JJ-Brick.pkpass"',
    "X-Content-Type-Options": "nosniff",
    // Short cache: a rebuilt pass (new details or a renewed certificate) reaches phones within minutes.
    "Cache-Control": "public, max-age=300, must-revalidate",
  });
  if (!PRODUCTION_HOSTS.includes(url.hostname)) headers.set("X-Robots-Tag", "noindex, nofollow");
  return new Response(request.method === "HEAD" ? null : res.body, { status: 200, headers });
}
