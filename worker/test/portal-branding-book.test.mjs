/* The Brand Book PROTOTYPE (Staging only): the Branding content as a deck of stacked cards. Proves it is gated to Staging (PORTAL_DEMO) and the Branding flag, private to the member's own
   organization, read-only (nothing is posted from it), free of inline style and script, reuses the existing permission-checked file routes, colours its cards only from validated
   #rrggbb values with readable text, and leaves the existing Branding page alone. The scroll behaviour itself is a browser matter; the script is checked for what it must never do. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeWorld, csrfOf } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as brand from "../portal/repo/brand.js";
import * as B from "../portal/brand-files.js";
import { PORTAL_CSP_WITH_SCRIPT } from "../portal/http.js";
import { revokeStaff } from "../portal/repo/staff.js";
import { CARDS, DEFAULT_PALETTE, cardColours, cardCss, contrast, textOn } from "../portal/branding-book.js";

const ADMIN = "admin@framework.test";
const src = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const BOOK = (slug) => `/portal/o/${slug}/branding/book`;
const COLOURS = [{ name: "Harbour Blue", role: "primary", hex: "#0B3C5D", note: "" }, { name: "Sea Glass", role: "secondary", hex: "#6FB7A8", note: "" }, { name: "Marigold", role: "accent", hex: "#F2A93B", note: "" }, { name: "Chalk", role: "neutral", hex: "#F3EFE6", note: "" }];

async function setup({ demo = true, branding = true, publish = true } = {}) {
  const w = await makeWorld(); const bucket = fakeR2();
  if (branding) w.env.PORTAL_BRANDING = "1";
  if (demo) w.env.PORTAL_DEMO = "1";
  w.env.PORTAL_FILES = bucket;
  const alpha = await w.org("alpha", "Alpha Co"), beta = await w.org("beta", "Beta Co");
  await w.invite(alpha, "ann@alpha.test", "owner"); await w.invite(beta, "bob@beta.test", "owner");
  const ann = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await bob.signIn(w.user(2, "bob@beta.test"));
  const deps = { db: w.db, bucket, env: w.env, now: w.clock.now() };
  const ids = {};
  if (publish) {
    assert.ok((await brand.saveBrandKit(w.db, alpha.id, { colours: COLOURS, typography: [], brandName: "Alpha Co", sections: { tagline: { primary: "Built to last." } } }, ADMIN)).ok);
    const up = async (key, meta, name, bytes) => { const r = await B.adminUploadAsset(deps, { organizationId: alpha.id, actor: ADMIN, meta: { published: true, ...meta }, file: { name, bytes } }); assert.ok(r.ok, JSON.stringify(r)); ids[key] = r.id; };
    await up("logo", { kind: "logo", logo_role: "primary", orientation: "horizontal", tone: "light", transparent: false, title: "Alpha logo" }, "primary.svg", S.svg());
    await up("guide", { kind: "guideline", title: "Alpha guidelines" }, "guidelines.pdf", S.pdf());
    assert.ok((await brand.setBrandKitStatus(w.db, alpha.id, "published", ADMIN)).ok);
  }
  return { w, alpha, beta, ann, bob, ids };
}

test("gate: a 404 unless BOTH the Branding flag and the Staging-only demo switch are on, so it is inert on Production even if this code is released there", async () => {
  for (const [name, opts] of [["demo off", { demo: false }], ["branding off", { branding: false }], ["both off", { demo: false, branding: false }]]) {
    const s = await setup({ ...opts, publish: false });
    for (const p of [BOOK("alpha"), BOOK("alpha") + ".css"]) assert.equal((await s.ann.get(p)).status, 404, `${name}: ${p}`);
  }
  const s = await setup({ publish: false });
  assert.equal((await s.ann.get(BOOK("alpha"))).status, 200);
});

test("the page: seven cards in order with a numbered index, the published brand, downloads through the existing routes, and nothing that posts", async () => {
  const s = await setup();
  const res = await s.ann.get(BOOK("alpha")); const html = await res.text();
  assert.equal(res.status, 200);
  assert.deepEqual([...html.matchAll(/<section class="bb-card bb-card--(\d)" id="([a-z]+)"/g)].map((m) => `${m[1]}:${m[2]}`), CARDS.map((c, i) => `${i + 1}:${c.id}`));
  assert.equal([...html.matchAll(/data-bb-go="(\d)"/g)].length, 7, "the numbered index links every card");
  for (const t of ["Brand Overview", "Logo System", "Colour Palette", "Typography", "Imagery &amp; Textures", "Layout, Icons &amp; Style", "Documents &amp; Assets", "Alpha Co", "Built to last.", "Harbour Blue", "#0B3C5D"]) assert.ok(html.includes(t), t);
  assert.match(html, /\d of 9 complete/);
  assert.match(html, new RegExp(`/portal/o/alpha/branding/files/${s.ids.logo}`), "a logo preview/download is the existing permission-checked file route");
  assert.match(html, new RegExp(`/portal/o/alpha/branding/files/${s.ids.guide}`));
  const book = html.slice(html.indexOf('id="brand-book"'), html.indexOf("data-bb-live"));
  assert.ok(book.length > 5000 && !/<form|method="post"|name="csrf"|<textarea|type="file"/i.test(book), "read-only: no form, no posting from the Brand Book (the shell's own sign-out form is outside it)");
  assert.match(html, /href="\/portal\/o\/alpha\/branding"/, "the real Branding page is one link away (requests, uploads and Discovery live there)");
  assert.ok(!/ style=|<style|<script(?![^>]*\ssrc=)|javascript:|\son[a-z]+=["']/i.test(html), "no inline style, inline script or event handler (the one script tag has a same-origin src)");
  assert.match(html, /href="\/assets\/css\/portal-branding-book\.css"/); assert.match(html, /src="\/assets\/js\/portal-branding-book\.js"/); assert.match(html, /\/branding\/book\.css"/, "the generated card colours (client has 4 colours)");
  assert.equal(res.headers.get("Content-Security-Policy"), PORTAL_CSP_WITH_SCRIPT, "only same-origin script, nothing inline");
});

test("private to the member's own organization; signed out is sent to sign in; another organization's brand is never shown", async () => {
  const s = await setup();
  const bob = await (await s.bob.get(BOOK("beta"))).text();
  assert.ok(!/Alpha Co|Harbour Blue|Alpha logo/.test(bob), "another organization's brand never appears");
  assert.match(bob, /Not added yet|Example: Framework/);
  const cross = await s.bob.get(BOOK("alpha")); assert.ok(cross.status === 404 || cross.status === 403, "a member of another organization cannot open it: " + cross.status);
  const anon = await s.w.browser().get(BOOK("alpha")); assert.ok([302, 303].includes(anon.status), "signed out: " + anon.status);
  const css = await (await s.bob.get(BOOK("beta") + ".css")).text(); assert.equal(css, "", "no published colours, no generated colours");
});

test("a brand that is not published yet still renders every card, with Framework's labelled examples and no generated colours", async () => {
  const s = await setup({ publish: false });
  const html = await (await s.ann.get(BOOK("alpha"))).text();
  assert.equal([...html.matchAll(/data-bb-card/g)].length, 7);
  assert.match(html, /Example: Framework/); assert.match(html, /Your approved brand will appear here when it is ready/);
  assert.ok(!/branding\/book\.css/.test(html), "fewer than three published colours: Framework's own card colours");
});

test("the existing Branding page is unchanged and does not carry the deck", async () => {
  const s = await setup();
  const page = await (await s.ann.get(`/portal/o/alpha/branding`)).text();
  assert.ok(!/bb-card|brand-book/.test(page)); assert.match(page, /id="logo"/); assert.match(page, /bk-nav/);
});

test("card colours: the client's own validated colours (three or more), otherwise Framework's; text is always readable; nothing but #rrggbb reaches a stylesheet", async () => {
  assert.equal(cardCss(COLOURS), cardColours(COLOURS).map((c, i) => `.bb-card--${i + 1}{--bb-bg:${c.bg};--bb-fg:${c.fg}}`).join("\n") + "\n");
  assert.ok(/^(\.bb-card--[1-7]\{--bb-bg:#[0-9A-F]{6};--bb-fg:#(0A0A0A|FFFFFF|000000)\}\n){7}$/.test(cardCss(COLOURS)), "exactly seven rules of fixed shape");
  assert.equal(cardCss(COLOURS.slice(0, 2)), "", "two colours: the static defaults apply");
  assert.equal(cardCss([]), ""); assert.equal(cardCss(undefined), "");
  const evil = [{ hex: "#fff;}body{display:none}", role: "primary" }, { hex: "red", role: "primary" }, { hex: "#12345", role: "accent" }, { hex: "url(x)", role: "accent" }];
  assert.equal(cardCss(evil), "", "anything that is not #rrggbb is ignored");
  assert.deepEqual(cardColours(evil).map((c) => c.bg), CARDS.map((_, i) => DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]));
  for (const bg of [...DEFAULT_PALETTE, ...COLOURS.map((c) => c.hex), "#808080", "#777777", "#FFFFFF", "#000000", "#FF0000", "#00FF00"]) assert.ok(contrast(bg, textOn(bg)) >= 4.5, `${bg} reads with ${textOn(bg)}`);
  const order = cardColours([{ hex: "#111111", role: "neutral" }, { hex: "#222222", role: "accent" }, { hex: "#333333", role: "primary" }, { hex: "#444444", role: "secondary" }]).map((c) => c.bg);
  assert.deepEqual(order.slice(0, 4), ["#333333", "#444444", "#222222", "#111111"], "primary, secondary, accent, neutral first");
  assert.equal(CARDS.length, 7); assert.equal(new Set(DEFAULT_PALETTE).size, 7, "seven distinct default colours");
});

test("the script and stylesheet: progressive enhancement only, reduced motion respected, nothing fetched or stored, no inline-style writes", () => {
  const js = src("assets/js/portal-branding-book.js"), css = src("assets/css/portal-branding-book.css");
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|localStorage|sessionStorage|document\.cookie|innerHTML|insertAdjacentHTML|eval\(|new Function|setAttribute\(["']style/.test(js), "nothing fetched, stored or injected as HTML");
  assert.match(js, /prefers-reduced-motion: reduce/); assert.match(js, /canDeck/); assert.match(js, /removeAttribute\("inert"\)|setAttribute\("inert"/);
  assert.match(js, /preventDefault/, "only the index links are intercepted, and only while the deck is on");
  assert.ok(!/wheel|touchstart|touchmove|preventDefault\(\)\s*;?\s*\}\s*,\s*\{\s*passive:\s*false/.test(js.replace(/ev\.preventDefault\(\);/g, "")), "no wheel or touch capture, no non-passive listeners: the page scrolls natively");
  assert.match(css, /prefers-reduced-motion: reduce/); assert.ok(!/@import|url\(/.test(css));
  assert.match(css, /\.bb--deck/, "the deck is opt-in: the default is a plain stack");
});

test("wiring: the routes sit behind branding.view and the gate, and the page is registered", () => {
  const router = src("worker/portal/router.js");
  assert.match(router, /const bookOn = \(ctx\) => brandingOn\(ctx\) && demoEnabled\(ctx\.env, ctx\.cfg\)/);
  assert.match(router, /when: bookOn, re: \/\^\\\/portal\\\/o\\\/\(\[\^\/\]\+\)\\\/branding\\\/book\$\/, action: "branding\.view"/);
  assert.match(router, /when: bookOn, re: \/\^\\\/portal\\\/o\\\/\(\[\^\/\]\+\)\\\/branding\\\/book\\\.css\$\/, action: "branding\.view"/);
  assert.ok(!/postAction/.test(router.slice(router.indexOf("const bookOn"), router.indexOf("const bookOn") + 2600).split("branding\\/request")[0]), "neither Brand Book route can be posted to");
});

/* ------------------------------------------------------------------ Framework master access (the staff preview), the real grant and guard */
const STAFF = "hello@frameworkco.ca"; // the seeded Master Client Access grant (migration 0013); it binds to the account at the first verified sign-in
async function staffSetup(opts) {
  const s = await setup(opts);
  const hello = s.w.browser(); await hello.signIn(s.w.user(9, STAFF));
  return { ...s, hello };
}
const BOOK_LINK = '<a class="btn btn--small" href="/portal/o/alpha/branding/book">Preview Brand Book</a>';

test("master access: directory, client, Branding page, the Preview Brand Book button, the book: one session, the client's organization carried through, no separate client login", async () => {
  const s = await staffSetup();
  const dir = await (await s.hello.get("/portal")).text(); assert.match(dir, /Client portals/); assert.match(dir, /href="\/portal\/o\/alpha"/);
  const home = await s.hello.get("/portal/o/alpha"); assert.equal(home.status, 200); assert.match(await home.text(), /Framework master access/);
  const page = await (await s.hello.get("/portal/o/alpha/branding")).text();
  assert.ok(page.includes(BOOK_LINK), "the button is on the regular Branding page, pointing at the SAME organization's book");
  assert.equal([...page.matchAll(/Preview Brand Book/g)].length, 1);
  const href = /href="([^"]*)">Preview Brand Book/.exec(page)[1];
  const res = await s.hello.get(href); const html = await res.text();
  assert.equal(res.status, 200, "following the button opens the book (it is not sent to sign-in or the directory)");
  assert.match(html, /Viewing: <\/strong>|Viewing: Alpha Co|Viewing: <strong>Alpha Co/); assert.match(html, /Framework master access/);
  assert.match(html, /<title>Brand Book \(prototype\)/); assert.ok(html.includes("Harbour Blue") && html.includes(`/portal/o/alpha/branding/files/${s.ids.logo}`), "that client's own brand and files, read through the guard's organization");
  assert.equal(s.w.db.raw.prepare("SELECT COUNT(*) n FROM memberships WHERE organization_id = ? AND user_id = (SELECT id FROM portal_users WHERE email = ?)").get(s.alpha.id, STAFF).n, 0, "no membership row is created by looking");
  assert.ok(s.w.db.raw.prepare("SELECT COUNT(*) n FROM activity_log WHERE action = 'staff.portal.opened' AND visibility = 'internal'").get().n >= 1, "the visit is audited internally, as for every master-access page");
});

test("master access: previewing as Owner or Member keeps the button and the book (the role only chooses what is shown)", async () => {
  const s = await staffSetup();
  for (const role of ["member", "owner"]) {
    const csrf = csrfOf(await (await s.hello.get("/portal/o/alpha/branding")).text());
    const sw = await s.hello.post("/portal/staff/view-as", { csrf, role, next: "/portal/o/alpha/branding" });
    assert.ok([302, 303].includes(sw.status), "view-as " + role);
    const page = await (await s.hello.get("/portal/o/alpha/branding")).text();
    assert.ok(page.includes(BOOK_LINK), "button as " + role);
    assert.equal((await s.hello.get(BOOK("alpha"))).status, 200, "book as " + role);
  }
});

test("master access: only Framework master access sees the button; clients, strangers and revoked or unbound people get nothing new", async () => {
  const s = await staffSetup();
  assert.ok(!(await (await s.ann.get("/portal/o/alpha/branding")).text()).includes("Preview Brand Book"), "a client member does not see the prototype button");
  assert.equal((await s.ann.get(BOOK("alpha"))).status, 200, "(a member can still open their own prototype by address, as before)");
  const stranger = s.w.browser(); await stranger.signIn(s.w.user(8, "stranger@example.test"));
  assert.equal((await stranger.get(BOOK("alpha"))).status, 404, "no grant, no membership: the same 404 as for any organization page");
  assert.equal((await stranger.get(BOOK("alpha") + ".css")).status, 404);
  assert.ok((await revokeStaff(s.w.db, STAFF, "admin@framework.test")).ok);
  assert.equal((await s.hello.get(BOOK("alpha"))).status, 404, "a revoked grant loses it on the very next request (the guard re-reads it every time)");
  assert.ok(!(await (await s.hello.get("/portal/o/alpha/branding")).text()).includes("Preview Brand Book"));
});

test("master access: where the prototype is off (Production), there is no button and no route, even for master access", async () => {
  const s = await staffSetup({ demo: false });
  assert.equal((await s.hello.get("/portal/o/alpha/branding")).status, 200);
  assert.ok(!(await (await s.hello.get("/portal/o/alpha/branding")).text()).includes("Preview Brand Book"));
  assert.equal((await s.hello.get(BOOK("alpha"))).status, 404);
});

test("what a request without a live session gets (the cause of 'redirected to the client directory'): sign-in, which does not remember a deep link, so it ends on the directory", async () => {
  const s = await staffSetup();
  const out = await s.w.browser().get(BOOK("alpha"));
  assert.equal(out.status, 303); assert.equal(out.headers.get("location"), "/portal/login", "no session: to sign-in (unchanged; this prototype does not alter authentication)");
  const again = s.w.browser(); await again.signIn(s.w.user(9, STAFF));
  assert.match(await (await again.get("/portal")).text(), /Client portals/, "and signing in lands on /portal, the master-access directory");
});

test("the deck's layout accounts for what sits above the header (Framework's master-access banner)", () => {
  const js = src("assets/js/portal-branding-book.js");
  assert.match(js, /previousElementSibling/); assert.match(js, /above \+ hb/);
});
