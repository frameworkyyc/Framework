// End-to-end harness for the portal router: a fake WorkOS (real RS256 signatures, JWKS, single-use codes, PKCE check), a cookie jar,
// and a D1-shaped database with the real migration. No network is ever used.
import { openPortalDb } from "./portal-db.mjs";
import { handlePortal } from "../../portal/router.js";
import { bytesToB64url, sha256b64url } from "../../portal/crypto.js";
import * as repo from "../../portal/repo/index.js";

export const ORIGIN = "https://staging.frameworkco.ca";
export const CLIENT_ID = "client_01M58C412YHC548S5JXP1TJ2ED";
export const ISSUER = `https://api.workos.com/user_management/${CLIENT_ID}`;
export const API_KEY = "sk_test_FAKE_KEY_FOR_TESTS_ONLY";
export const PEPPER = "Zk3xQ9vB7mLr2TnW8yHcA5dJfG1sPuE4oXiK6bNtMe0";
export const T0 = new Date("2026-10-20T12:00:00.000Z");

const enc = new TextEncoder();
const b64u = (obj) => bytesToB64url(enc.encode(JSON.stringify(obj)));

export async function makeKeys(kid = "key_test_1") {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { kid, pair, jwks: { keys: [{ kty: "RSA", n: jwk.n, e: jwk.e, kid, alg: "RS256", use: "sig" }] } };
}
export async function signJwt(keys, payload, header = {}) {
  const input = `${b64u({ alg: "RS256", typ: "JWT", kid: keys.kid, ...header })}.${b64u(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", keys.pair.privateKey, enc.encode(input)));
  return `${input}.${bytesToB64url(sig)}`;
}

export class FakeWorkos {
  constructor(keys, clock) {
    this.keys = keys;
    this.clock = clock;
    this.codes = new Map();
    this.down = false; // network failure
    this.jwksDown = false;
    this.exchangeStatus = null; // force an HTTP status from /authenticate
    this.calls = [];
    this.fetch = this.fetch.bind(this);
  }
  /** Register what the NEXT code exchange should return; returns the one-time code. */
  async issueCode({ challenge, user, sid = "session_01WORKOSAA", claims = {}, signWith = this.keys, authMethod = "MagicAuth", mutateUser = {} }) {
    const code = "code_" + bytesToB64url(crypto.getRandomValues(new Uint8Array(12)));
    const now = Math.floor(this.clock.now().getTime() / 1000);
    const payload = { iss: ISSUER, client_id: CLIENT_ID, sub: user.id, iat: now, exp: now + 300, ...(sid === null ? {} : { sid }), ...claims };
    const accessToken = await signJwt(signWith, payload);
    this.codes.set(code, { challenge, body: { access_token: accessToken, refresh_token: "refresh_FAKE", authentication_method: authMethod, user: { object: "user", email_verified: true, ...user, ...mutateUser } } });
    return code;
  }
  async fetch(url, init = {}) {
    if (this.down) throw new TypeError("network down");
    const u = new URL(url);
    this.calls.push(`${init.method || "GET"} ${u.origin}${u.pathname}`);
    const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.origin !== "https://api.workos.com") return json(404, {});
    if (u.pathname === `/user_management/${CLIENT_ID}/.well-known/openid-configuration`) return json(200, { issuer: ISSUER, jwks_uri: `https://api.workos.com/sso/jwks/${CLIENT_ID}` });
    if (u.pathname === `/sso/jwks/${CLIENT_ID}`) return this.jwksDown ? json(503, {}) : json(200, this.keys.jwks);
    if (u.pathname === "/user_management/authenticate" && init.method === "POST") {
      if (this.exchangeStatus) return json(this.exchangeStatus, { code: "forced", message: "UPSTREAM SECRET DETAIL" });
      const body = JSON.parse(init.body);
      const rec = this.codes.get(body.code);
      if (body.client_id !== CLIENT_ID || body.client_secret !== API_KEY || body.grant_type !== "authorization_code" || !rec || (await sha256b64url(body.code_verifier)) !== rec.challenge) return json(400, { code: "invalid_grant", message: "UPSTREAM SECRET DETAIL" });
      this.codes.delete(body.code); // single use
      return json(200, rec.body);
    }
    return json(404, {});
  }
}

export class Browser {
  constructor(env) {
    this.env = env;
    this.jar = new Map();
  }
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  async send(path, { method = "GET", body, headers = {}, cookies = true } = {}) {
    const h = { ...headers };
    if (cookies && this.jar.size) h.Cookie = this.cookieHeader();
    const res = await handlePortal(new Request(ORIGIN + path, { method, headers: h, body, redirect: "manual" }), this.env.env, { now: this.env.clock.now(), fetch: this.env.workos.fetch, previewFetch: this.env.previewFetch, previewCache: this.env.previewCache === undefined ? null : this.env.previewCache });
    if (res) for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(";").map((x) => x.trim());
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (attrs.some((a) => /^Max-Age=0$/i.test(a))) this.jar.delete(name);
      else this.jar.set(name, value);
    }
    return res;
  }
  get(path, opts) { return this.send(path, opts); }
  post(path, fields, extra = {}) {
    return this.send(path, { method: "POST", body: new URLSearchParams(fields).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded", "Sec-Fetch-Site": "same-origin", Origin: "null", ...extra } });
  }
  /** Run the whole sign-in as `user`; returns the callback response. Options let a test sabotage a step. */
  async signIn(user, opts = {}) {
    const start = await this.get("/portal/login?start=1" + (opts.query || ""));
    const authorize = new URL(start.headers.get("Location"));
    const code = await this.env.workos.issueCode({ challenge: authorize.searchParams.get("code_challenge"), user, ...(opts.issue || {}) });
    const state = opts.state ?? authorize.searchParams.get("state");
    return this.get(`/portal/auth/callback?code=${encodeURIComponent(opts.code ?? code)}&state=${encodeURIComponent(state)}`);
  }
}

export async function makeWorld({ clock } = {}) {
  const c = clock || { t: T0, now() { return this.t; }, advance(s) { this.t = new Date(this.t.getTime() + s * 1000); } };
  const db = openPortalDb();
  const keys = await makeKeys();
  const workos = new FakeWorkos(keys, c);
  const env = {
    PORTAL_ENABLED: "1", PORTAL_BASE_URL: ORIGIN, PORTAL_AUTH_CLIENT_ID: CLIENT_ID, PORTAL_AUTH_CLIENT_SECRET: API_KEY,
    PORTAL_AUTH_ISSUER: ISSUER, PORTAL_SESSION_PEPPER: PEPPER, PORTAL_DB: db,
  };
  const world = { env, db, workos, clock: c, keys };
  world.browser = () => new Browser(world);
  world.org = async (slug, name = slug) => (await repo.createOrganization(db, { slug, name }, { now: c.now() })).organization;
  world.invite = async (org, email, role = "member") => (await repo.createInvitation(db, org.id, { email, role, createdBy: "admin@frameworkco.ca" }, { now: c.now() })).invitation;
  world.user = (n, email) => ({ id: `user_01TEST${String(n).padStart(6, "0")}`, email, first_name: "Test", last_name: "User" + n });
  return world;
}

export const csrfOf = (html) => /name="csrf" value="([^"]+)"/.exec(html)?.[1];
/** The Business Profile step revision a rendered form carries (see repo/business-profile.js): a real browser posts it back with the form. */
export const revOf = (html) => /name="rev" value="([^"]*)"/.exec(html)?.[1];
export const stripRef = (html) => html.replace(/Reference: <strong>[^<]*<\/strong>/, "Reference: X");
