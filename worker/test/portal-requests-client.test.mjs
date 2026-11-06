/* The request area as a client uses it: the real portal Worker, the real migrations (0020 applied), fake storage. Flag-off behaviour is unchanged, the navigation and Home carry the
   services, the guided form validates and stores, a request is followed through proof review and delivery, and nothing of another organization, a private note or a draft reaches anyone. */
import test from "node:test";
import assert from "node:assert/strict";
import { makeWorld, ORIGIN as PORTAL_ORIGIN } from "./helpers/portal-e2e.mjs";
import { fakeR2 } from "./helpers/fake-r2.mjs";
import * as S from "./helpers/sample-files.mjs";
import * as repo from "../portal/requests/repo.js";
import * as svc from "../portal/requests/service.js";
import { processNotifications, buildEmail } from "../portal/service-notifications.js";
import { rows, count } from "./helpers/portal-db.mjs";

const STAFF = "Framework Staff";
async function setup({ requests = true, services = true } = {}) {
  const w = await makeWorld({});
  const bucket = fakeR2();
  Object.assign(w.env, { PORTAL_FILES: bucket, ...(requests ? { PORTAL_REQUESTS: "1" } : {}), ...(services ? { PORTAL_SERVICES: "1" } : {}), PORTAL_BRANDING: "1", PORTAL_WEBSITE: "1" });
  const A = await w.org("alpha", "Alpha Co"); await w.invite(A, "ann@alpha.test", "owner"); await w.invite(A, "mia@alpha.test", "member");
  const Bo = await w.org("beta", "Beta Co"); await w.invite(Bo, "bob@beta.test", "owner");
  const ann = w.browser(), mia = w.browser(), bob = w.browser();
  await ann.signIn(w.user(1, "ann@alpha.test")); await mia.signIn(w.user(2, "mia@alpha.test")); await bob.signIn(w.user(3, "bob@beta.test"));
  const csrf = async (b, path, slug = "alpha") => /name="csrf" value="([^"]+)"/.exec(await (await b.get(`/portal/o/${slug}${path}`)).text())[1];
  const text = async (b, path, slug = "alpha") => (await b.get(`/portal/o/${slug}${path}`)).text();
  const post = async (b, path, fields, { slug = "alpha", files = [], multipart = false, csrfFrom = "/requests", headers = {}, token } = {}) => {
    const t = token ?? (await csrf(b, csrfFrom, slug));
    const sameSite = { "Sec-Fetch-Site": "same-origin", Origin: PORTAL_ORIGIN, ...headers };
    if (multipart || files.length) {
      const fd = new FormData(); fd.set("csrf", t);
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      for (const [name, bytes] of files) fd.append("file", new Blob([bytes]), name);
      return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: fd, headers: sameSite });
    }
    return b.send(`/portal/o/${slug}${path}`, { method: "POST", body: new URLSearchParams({ csrf: t, ...fields }), headers: { ...sameSite, "Content-Type": "application/x-www-form-urlencoded" } });
  };
  const CARD = { type: "business_card", title: "Spring business cards", d_person: "Ann Lee, Owner", d_contact: "403 555 0100", d_purpose: "Trade shows", d_sides: "two" };
  const create = async (b = ann, over = {}, files = []) => {
    const r = await post(b, "/requests", { ...CARD, ...over }, { files, multipart: true, csrfFrom: "/requests/new?type=business_card" });
    assert.equal(r.status, 303, "create -> " + r.status);
    return /requests\/([0-9a-f-]{36})/.exec(r.headers.get("Location"))[1];
  };
  const org = A; const userOf = (email) => w.db.raw.prepare("SELECT id FROM portal_users WHERE email = ?").get(email).id;
  const d = () => ({ db: w.db, bucket, env: w.env, now: new Date() });
  return { w, A, Bo, bucket, ann, mia, bob, csrf, text, post, create, CARD, userOf, d, org };
}
const png = () => S.png();
const NAV_LABELS = ["Home", "Websites", "Branding", "Deliverables", "SEO", "Custom Development", "My Requests", "Support", "Invoices", "Settings"];
const navOf = (html) => [...(/<ul class="primary__list">([\s\S]*?)<\/ul>/.exec(html) || [, ""])[1].matchAll(/<a href="[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
const sql = (db, q, ...p) => db.raw.prepare(q).all(...p).map((r) => ({ ...r }));

test("flag off: nothing changes. The new routes are plain 404s, the header is still Home and Account, Home has no services block", async () => {
  const { ann, text } = await setup({ requests: false });
  for (const p of ["/deliverables", "/seo", "/development", "/requests", "/requests/new?type=poster"]) assert.equal((await ann.get(`/portal/o/alpha${p}`)).status, 404, p);
  const home = await text(ann, "");
  assert.ok(!/primary--wide|My Requests|Your services/.test(home));
  assert.match(home, /aria-label="Portal"><ul><li><a href="\/portal\/o\/alpha" aria-current="page">Home<\/a>/);
  assert.ok(!home.includes("portal-requests.css"));
});

test("flag on: the full navigation (ten entries for an owner, Invoices only for owners), Settings, a mobile menu with the same entries, and the right entry is current", async () => {
  const { ann, mia, text } = await setup();
  const home = await text(ann, "");
  assert.deepEqual(navOf(home), NAV_LABELS);
  assert.deepEqual(navOf(await text(mia, "")), NAV_LABELS.filter((l) => l !== "Invoices"), "a member has no Invoices entry");
  assert.match(home, /<details class="primary__menu"><summary>Menu<\/summary>/);
  assert.equal([...home.matchAll(/<details class="primary__menu">[\s\S]*?<\/details>/g)][0][0].match(/<a /g).length, NAV_LABELS.length, "the menu lists every entry");
  assert.match(home, /href="\/assets\/css\/portal-requests\.css"/);
  const cur = async (p) => /<ul class="primary__list">[\s\S]*?<a href="[^"]*" aria-current="page">([^<]+)<\/a>/.exec(await text(ann, p))[1];
  assert.equal(await cur(""), "Home"); assert.equal(await cur("/deliverables"), "Deliverables"); assert.equal(await cur("/seo"), "SEO"); assert.equal(await cur("/development"), "Custom Development");
  assert.equal(await cur("/requests"), "My Requests"); assert.equal(await cur("/services/requests"), "Support"); assert.equal(await cur("/services/invoices"), "Invoices"); assert.equal(await cur("/account"), "Settings"); assert.equal(await cur("/members"), "Settings");
  const acct = await text(ann, "/account"); assert.match(acct, /<h1 class="h1">Settings<\/h1>/); assert.match(acct, /href="\/portal\/o\/alpha\/members">Manage your team/);
  assert.ok(!/Manage your team/.test(await text(mia, "/account")), "members have no team link");
  const noSvc = await setup({ services: false });
  assert.deepEqual(navOf(await noSvc.text(noSvc.ann, "")), NAV_LABELS.filter((l) => l !== "Support" && l !== "Invoices"), "Support and Invoices appear only where Client Services is on");
});

test("Home: services as active or available, and what needs the person's action", async () => {
  const { w, ann, mia, text, create, d, userOf } = await setup();
  let home = await text(ann, "");
  // one design: greeting, six equal blocks in order, Business Profile band, then six equal blocks in order, then (only when something waits) the needs block; nothing from the older layout
  const blocks = [...home.matchAll(/<a class="hm-block" href="([^"]+)"><span class="hm-block__top">[\s\S]*?<span class="hm-block__title">([^<]+)</g)].map((m) => [m[2], m[1].replace("/portal/o/alpha", "")]);
  assert.deepEqual(blocks, [["Branding", "/branding"], ["Websites", "/website"], ["SEO", "/seo"], ["Deliverables", "/deliverables"], ["Custom Development", "/development"], ["Support", "/services/requests"]]);
  assert.equal((home.match(/class="hm-block"/g) || []).length, 6);
  assert.equal((home.match(/Your services/g) || []).length, 1, "only the screen-reader heading of the grid"); assert.match(home, /class="visually-hidden" id="hm-svc-h">Your services/);
  for (const gone of ["Coming soon", "Client Services", 'class="hubs"', 'class="onboard"', "Getting started"]) assert.ok(!home.includes(gone), gone + " is gone from Home");
  assert.ok(home.indexOf("hm-profile") < home.indexOf("hm-grid"), "the Business Profile band sits above the six blocks"); assert.ok(home.indexOf("page-head--home") < home.indexOf("hm-profile"), "and under the greeting"); assert.match(home, /class="hm-profile"/); assert.match(home, /hm-profile__left">\d+ required answers? left/);
  assert.ok(home.indexOf("page-head--home") < home.indexOf("hm-grid"), "the greeting comes first");
  assert.ok(!/Needs your action/.test(home), "no empty needs block");
  assert.match(home, /status--idle">Available to request/);
  const id = await create(ann);
  home = await text(ann, ""); assert.match(home, /status--live">Active · 1 request in progress/);
  await repo.setStatus(w.db, (await w.org("x1")).id ?? "", id, "in_review", STAFF).catch(() => {});
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  await repo.setStatus(w.db, orgId, id, "in_review", STAFF);
  await repo.approveRequest(w.db, orgId, id, { via: "staff_record", actorLabel: STAFF }); await repo.setStatus(w.db, orgId, id, "in_progress", STAFF);
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "proof", file: { bytes: png(), name: "p.png" }, actor: STAFF });
  await repo.setStatus(w.db, orgId, id, "client_review", STAFF);
  home = await text(mia, ""); assert.match(home, /Needs your action/); assert.match(home, /Review the design/); assert.match(home, /status--attention">1 waiting for you/);
  assert.ok(home.indexOf("hm-profile") < home.indexOf("hm-grid") && home.indexOf("hm-grid") < home.indexOf("hm-need"), "order: greeting, profile, blocks, needs");
  assert.match(await text(mia, "/requests"), /Needs your action/);
});

test("the sections: Deliverables lists eight services with 'Custom quote' and two included rounds and no invented price; SEO shows no analytics; Development lists eight", async () => {
  const { ann, text } = await setup();
  const dl = await text(ann, "/deliverables");
  const tiles = [...dl.matchAll(/href="\/portal\/o\/alpha\/requests\/new\?type=([a-z_]+)"/g)].map((m) => m[1]);
  const EIGHT = ["business_card", "digital_business_card", "poster", "flyer", "social_graphics", "letterhead", "email_signature", "custom_branded"];
  assert.deepEqual(tiles, EIGHT, "one Request this service action per service, in order");
  assert.deepEqual([...dl.matchAll(/class="sc-block" href="#svc-([a-z_]+)"/g)].map((m) => m[1]), EIGHT, "eight blocks in the grid, each linking to its section");
  assert.deepEqual([...dl.matchAll(/<section class="sc-sec" id="svc-([a-z_]+)"/g)].map((m) => m[1]), EIGHT, "and one showcase section each");
  assert.ok(dl.indexOf('class="sc-grid"') < dl.indexOf('class="sc-showcase"'), "the showcase sits below the grid");
  assert.equal((dl.match(/\/assets\/img\/portal\/[a-z-]+\.svg/g) || []).length, 8); assert.equal((dl.match(/An illustration of the idea, not a client project/g) || []).length, 8, "every picture says it is a concept");
  assert.match(dl, /Real example/); assert.match(dl, /href="https:\/\/frameworkco\.ca\/card" target="_blank" rel="noopener noreferrer"/);
  assert.ok(!/type=brochure/.test(dl) && !/Brochure</.test(dl), "the old brochure option is folded into Flyer or brochure");
  assert.match(dl, /A flyer \(one sheet\), A bi-fold brochure/);
  assert.equal((dl.match(/Custom quote/g) || []).length, 8); assert.equal((dl.match(/2 revision rounds included/g) || []).length, 8);
  assert.ok(!/\$\s?\d/.test(dl), "no price is shown anywhere unless Admin entered one");
  assert.match(dl, /Nothing in progress/); assert.match(dl, /Sending a request does not authorize any paid work/);
  const seo = await text(ann, "/seo");
  assert.match(seo, /Search performance/); assert.match(seo, /Not connected/); assert.match(seo, /Not tracked/); assert.match(seo, /Keyword rankings/); assert.match(seo, /not your ranking for one particular search/);
  assert.ok(seo.indexOf("Search performance") < seo.indexOf("Available to request"), "performance comes first on SEO");
  assert.ok(!/\d+ (clicks|impressions)|position \d|ranking #/i.test(seo), "no analytics or rankings are invented");
  assert.equal([...seo.matchAll(/requests\/new\?type=/g)].length, 5);
  const dev = await text(ann, "/development");
  assert.equal([...dev.matchAll(/class="btn btn--primary sc-cta" href="[^"]*requests\/new\?type=/g)].length, 8);
  assert.deepEqual([...dev.matchAll(/class="sc-block" href="#svc-([a-z_]+)"/g)].map((m) => m[1]), ["custom_web_app", "business_dashboard", "business_portal", "ai_automation", "workflow_automation", "api_integration", "custom_tool", "other_development"]);
  assert.match(dev, /Typical uses/); assert.ok(!/Revision round/.test(dev), "development has no design revision rounds");
  for (const p of ["/deliverables", "/seo", "/development", "/requests"]) assert.ok(!/style=|<script/.test(await text(ann, p)), p + " has no inline style or script");
});

test("a Framework-entered price and revision count are shown (and only then); a disabled service disappears", async () => {
  const { w, ann, text } = await setup();
  await repo.saveTypeSettings(w.db, "flyer", { revisionsIncluded: 3, pricingMode: "fixed", fixedPriceCents: 9500, turnaroundNote: "Five working days" }, STAFF);
  await repo.saveTypeSettings(w.db, "letterhead", { enabled: false }, STAFF);
  const dl = await text(ann, "/deliverables");
  assert.match(dl, /Fixed price: \$95\.00 CAD/); assert.match(dl, /3 revision rounds included/); assert.match(dl, /Five working days/);
  assert.ok(!dl.includes("type=letterhead") && !dl.includes("svc-letterhead"));
  assert.equal((await ann.get("/portal/o/alpha/requests/new?type=letterhead")).status, 303, "a disabled type redirects to its section");
  assert.equal((await ann.get("/portal/o/alpha/requests/new?type=brochure")).status, 303, "the retired brochure type is never offered");
});

test("the guided form: every question, the notice, brand and reference upload; refusals come back filled in and nothing is stored", async () => {
  const { w, ann, text, post } = await setup();
  const form = await text(ann, "/requests/new?type=business_card");
  assert.match(form, /enctype="multipart\/form-data"/); assert.match(form, /name="file" type="file" multiple/); assert.match(form, /name="type" value="business_card"/);
  for (const n of ["title", "d_person", "d_contact", "d_sides", "d_purpose", "d_copy", "d_style", "needed_by"]) assert.match(form, new RegExp(`name="${n}"`), n);
  assert.match(form, /Your brand isn't published yet/); assert.match(form, /Sending a request does not authorize any paid work/);
  assert.match(form, /2 revision rounds included/); assert.match(form, /Framework does not print or ship materials/);
  assert.ok(!/style=|<script/.test(form));
  const dev = await text(ann, "/requests/new?type=ai_automation");
  assert.match(dev, /Budget range, if known/); assert.match(dev, /Software and systems you already use/); assert.match(dev, /When do you need it\?/); assert.ok(!/revision round/.test(dev), "revision rounds are a design-proof idea");
  const bad = await post(ann, "/requests", { type: "business_card", title: "", d_person: "", d_contact: "x" }, { multipart: true, csrfFrom: "/requests/new?type=business_card" });
  assert.equal(bad.status, 422); const html = await bad.text();
  assert.match(html, /Give the request a short name/); assert.match(html, /name="d_contact"[^>]*>x</, "what was typed comes back"); assert.match(html, /role="alert"/);
  assert.equal(count(w.db, "requests"), 0);
  const noType = await post(ann, "/requests", { type: "nonsense", title: "t" }, { multipart: true });
  assert.equal(noType.status, 404);
  assert.equal(count(w.db, "requests"), 0);
});

test("submitting: stored with its references privately, the thread shows the stage track, and the staff are queued to be told", async () => {
  const { w, A, bucket, ann, text, create } = await setup();
  const id = await create(ann, {}, [["logo.png", png()]]);
  const r = sql(w.db, "SELECT * FROM requests")[0];
  assert.equal(r.organization_id, A.id); assert.equal(r.status, "new"); assert.equal(r.kind, "deliverable");
  assert.ok([...bucket.store.keys()].every((k) => k.startsWith(`org/${A.id}/requests/`)) && bucket.store.size === 1);
  assert.equal(count(w.db, "service_notifications", "event = 'request_submitted' AND audience = 'staff'"), 1);
  const page = await text(ann, `/requests/${id}?flash=sent`);
  assert.match(page, /Your request was sent/); assert.match(page, /Spring business cards/); assert.match(page, /aria-label="Progress: Submitted"/); assert.equal((page.match(/rq-stages__n/g) || []).length, 7);
  assert.match(page, /Ann Lee, Owner/); assert.match(page, /logo\.png/); assert.match(page, /Framework has your request and will review it/);
  assert.match(await text(ann, "/requests"), new RegExp(`requests/${id}`));
  assert.match(await text(ann, "/deliverables"), new RegExp(`requests/${id}`));
});

test("a request and its files belong to the organization: another organization, a stranger and an invented id see the same 404", async () => {
  const { w, ann, bob, text, create, post } = await setup();
  const id = await create(ann, {}, [["logo.png", png()]]);
  const fid = sql(w.db, "SELECT id FROM request_files")[0].id;
  for (const p of [`/requests/${id}`, `/requests/${id}/files/${fid}`, `/requests/${id}/files/${fid}/view`]) assert.equal((await bob.get(`/portal/o/beta${p}`)).status, 404, p);
  assert.equal((await bob.get(`/portal/o/alpha/requests/${id}`)).status, 404, "bob is not a member of alpha: the guard refuses");
  assert.equal((await ann.get(`/portal/o/alpha/requests/99999999-9999-4999-8999-999999999999`)).status, 404);
  assert.equal((await ann.get(`/portal/o/alpha/requests/not-an-id`)).status, 404);
  const tok = await (async () => /name="csrf" value="([^"]+)"/.exec(await text(bob, "/requests", "beta"))[1])();
  for (const a of ["reply", "cancel", "approve", "revise"]) { const r = await post(bob, `/requests/${id}/${a}`, { note: "x", body: "x" }, { slug: "beta", token: tok }); assert.ok([404, 403].includes(r.status), `${a} -> ${r.status}`); }
  assert.equal(sql(w.db, "SELECT status FROM requests")[0].status, "new");
  assert.equal(count(w.db, "request_events"), 1);
});

test("POST protection: no token, a wrong token, a cross-site post and a wrong type of body are all refused and change nothing", async () => {
  const { w, ann, create, post } = await setup();
  const id = await create(ann);
  const before = count(w.db, "request_events");
  assert.equal((await post(ann, `/requests/${id}/cancel`, {}, { token: "wrong" })).status, 403);
  assert.equal((await post(ann, `/requests/${id}/cancel`, {}, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await post(ann, "/requests", { type: "business_card", title: "x" }, { multipart: true, headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  assert.equal((await post(ann, `/requests/${id}/reply`, { body: "hi" }, { multipart: true, token: "wrong" })).status, 403);
  assert.equal(count(w.db, "request_events"), before); assert.equal(sql(w.db, "SELECT status FROM requests")[0].status, "new");
  assert.equal((await ann.send(`/portal/o/alpha/requests/${id}/cancel`, { method: "PUT" })).status, 405);
});

test("following a request: replies with a file, private notes never shown, unread markers, and the closed state", async () => {
  const { w, ann, mia, text, create, post, csrf } = await setup();
  const id = await create(mia);
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  await repo.addStaffMessage(w.db, orgId, id, "INTERNAL do not show", STAFF, { internal: true });
  await repo.addStaffMessage(w.db, orgId, id, "Thanks, we have it.", STAFF);
  const page = await text(mia, `/requests/${id}`);
  assert.match(page, /Thanks, we have it\./); assert.ok(!page.includes("INTERNAL do not show"));
  assert.ok(!(await text(mia, "/requests")).includes("INTERNAL"));
  const r = await post(mia, `/requests/${id}/reply`, { body: "Here is the logo" }, { files: [["logo.png", png()]], csrfFrom: `/requests/${id}` });
  assert.equal(r.status, 303); assert.match(r.headers.get("Location"), /flash=replied/);
  assert.match(await text(ann, `/requests/${id}`), /Here is the logo/);
  assert.equal(count(w.db, "request_files", "role = 'attachment'"), 1);
  const empty = await post(mia, `/requests/${id}/reply`, { body: "   " }, { multipart: true, csrfFrom: `/requests/${id}` });
  assert.equal(empty.status, 422); assert.match(await empty.text(), /Please write a message first/);
  await repo.setStatus(w.db, orgId, id, "declined", STAFF, { note: "Out of scope" });
  const closed = await text(mia, `/requests/${id}`);
  assert.match(closed, /Declined/); assert.ok(!/Write to Framework/.test(closed)); assert.ok(!/aria-label="Progress/.test(closed), "no track for a request that ended without delivery");
  assert.equal((await post(mia, `/requests/${id}/reply`, { body: "late" }, { multipart: true, csrfFrom: `/requests` })).status, 409);
});

test("design review in the portal: draft proofs hidden, proof viewed as a picture, revision limit shown, approval releases the final files, downloads are hardened", async () => {
  const { w, ann, mia, text, create, post, d } = await setup();
  const id = await create(ann);
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  await repo.setStatus(w.db, orgId, id, "in_review", STAFF); await repo.approveRequest(w.db, orgId, id, { via: "staff_record", actorLabel: STAFF }); await repo.setStatus(w.db, orgId, id, "in_progress", STAFF);
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "proof", file: { bytes: png(), name: "card-v1.png" }, actor: STAFF });
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "final", file: { bytes: S.pdf(), name: "cards-final.pdf" }, actor: STAFF });
  assert.ok(!/Design proofs|Review your design|files\//.test(await text(ann, `/requests/${id}`)), "drafts and early finals are invisible");
  await repo.setStatus(w.db, orgId, id, "client_review", STAFF);
  const page = await text(mia, `/requests/${id}`);
  assert.match(page, /Review your design/); assert.match(page, /Your design is ready/); assert.match(page, /aria-label="Progress: Ready for your review"/);
  assert.match(page, /2 revision rounds left of 2/); assert.match(page, /Approve this design/); assert.match(page, /Request revisions/);
  const viewHref = /src="(\/portal\/o\/alpha\/requests\/[^"]+\/view)"/.exec(page)[1];
  const img = await mia.get(viewHref);
  assert.equal(img.status, 200); assert.equal(img.headers.get("Content-Type"), "image/png"); assert.equal(img.headers.get("Content-Disposition"), "inline"); assert.equal(img.headers.get("X-Content-Type-Options"), "nosniff");
  assert.match(img.headers.get("Content-Security-Policy"), /sandbox/); assert.equal(img.headers.get("Cache-Control"), "private, no-store");
  assert.equal((await mia.get(viewHref.replace(/\/view$/, ""))).status, 404, "a proof is not downloadable");
  // a revision needs a comment; then Framework works again
  const noComment = await post(mia, `/requests/${id}/revise`, { note: "" }, { csrfFrom: `/requests/${id}` });
  assert.equal(noComment.status, 422); assert.match(await noComment.text(), /Please write a message first/);
  const rev = await post(mia, `/requests/${id}/revise`, { note: "Bigger logo please" }, { csrfFrom: `/requests/${id}` });
  assert.equal(rev.status, 303); assert.match(rev.headers.get("Location"), /flash=revised/);
  const after = await text(ann, `/requests/${id}`);
  assert.match(after, /Revision requested/); assert.match(after, /Bigger logo please/); assert.ok(!/Approve this design/.test(after));
  await repo.setStatus(w.db, orgId, id, "in_progress", STAFF);
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "proof", file: { bytes: png(), name: "card-v2.png" }, actor: STAFF });
  await repo.setStatus(w.db, orgId, id, "client_review", STAFF);
  const second = await text(ann, `/requests/${id}`);
  assert.match(second, /1 revision round left of 2/); assert.match(second, /Earlier versions \(1\)/); assert.match(second, /Version 2/);
  const approve = await post(ann, `/requests/${id}/approve`, { note: "Perfect" }, { csrfFrom: `/requests/${id}` });
  assert.equal(approve.status, 303); assert.match(approve.headers.get("Location"), /flash=approved/);
  const done = await text(ann, `/requests/${id}?flash=approved`);
  assert.match(done, /You approved the design/); assert.match(done, /Final files/); assert.match(done, /cards-final\.pdf/); assert.match(done, /aria-label="Progress: Completed"/);
  const dlHref = /href="(\/portal\/o\/alpha\/requests\/[^"]+\/files\/[^"]+)">Download/.exec(done)[1];
  const dl = await ann.get(dlHref);
  assert.equal(dl.status, 200); assert.match(dl.headers.get("Content-Disposition"), /^attachment/); assert.equal(dl.headers.get("Content-Type"), "application/octet-stream"); assert.equal(dl.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(sql(w.db, "SELECT count(*) n FROM activity_log WHERE action = 'request.file.download'")[0].n >= 1, true);
});

test("when every revision round is used the form is replaced by an honest message; extra rounds Framework grants bring it back", async () => {
  const { w, ann, text, create, d } = await setup();
  const id = await create(ann);
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  w.db.raw.prepare("UPDATE requests SET revisions_included = 0 WHERE id = ?").run(id);
  await repo.setStatus(w.db, orgId, id, "in_review", STAFF); await repo.approveRequest(w.db, orgId, id, { via: "staff_record", actorLabel: STAFF }); await repo.setStatus(w.db, orgId, id, "in_progress", STAFF);
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "proof", file: { bytes: png(), name: "p.png" }, actor: STAFF }); await repo.setStatus(w.db, orgId, id, "client_review", STAFF);
  let page = await text(ann, `/requests/${id}`);
  assert.match(page, /All 0 revision rounds have been used/); assert.ok(!/Request revisions/.test(page)); assert.match(page, /Approve this design/);
  await repo.grantRevisions(w.db, orgId, id, 1, STAFF);
  page = await text(ann, `/requests/${id}`); assert.match(page, /Request revisions/); assert.match(page, /including 1 added by Framework/);
});

test("quotes: shown to the client; owners may decline; accepting stays closed (nothing binding) and members are not offered the decision", async () => {
  const { w, ann, mia, text, create, post } = await setup();
  const id = await create(ann);
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  const q = await repo.createQuote(w.db, orgId, id, { title: "Business cards", scope: "Design of a two-sided card, delivered digitally.", amountCents: 18000, validUntil: "2026-12-31" }, STAFF);
  const owner = await text(ann, `/requests/${id}`);
  assert.match(owner, /\$180\.00 CAD/); assert.match(owner, /Design of a two-sided card/); assert.match(owner, /Awaiting your decision/); assert.match(owner, /To go ahead, reply below\. No work starts until Framework confirms your approval/);
  assert.ok(!/Accept this quote/.test(owner), "no accept button while the gate is closed"); assert.match(owner, /Decline this quote/);
  const member = await text(mia, `/requests/${id}`);
  assert.match(member, /An owner of your organization decides on quotes/); assert.ok(!/Decline this quote/.test(member));
  const acc = await post(ann, `/requests/${id}/quote/${q.id}/accept`, { name: "Ann Lee" }, { csrfFrom: `/requests/${id}` });
  assert.equal(acc.status, 409); assert.match(await acc.text(), /isn(?:'|&#39;)t available yet/);
  assert.equal(sql(w.db, "SELECT status FROM requests")[0].status, "quoted"); assert.equal(sql(w.db, "SELECT status FROM request_quotes")[0].status, "sent");
  assert.equal((await post(mia, `/requests/${id}/quote/${q.id}/accept`, { name: "Mia" }, { csrfFrom: `/requests/${id}` })).status, 403, "a member is refused by the permission check");
  const dec = await post(ann, `/requests/${id}/quote/${q.id}/decline`, { note: "Too high" }, { csrfFrom: `/requests/${id}` });
  assert.equal(dec.status, 303); assert.equal(sql(w.db, "SELECT status FROM requests")[0].status, "in_review");
});

test("withdrawing: members only their own, owners any; nobody after approval", async () => {
  const { w, ann, mia, create, post, text } = await setup();
  const mine = await create(mia), owners = await create(ann, { title: "Owner card" });
  assert.equal((await post(mia, `/requests/${owners}/cancel`, {}, { csrfFrom: `/requests/${mine}` })).status, 403);
  assert.equal((await post(mia, `/requests/${mine}/cancel`, { note: "Changed my mind" }, { csrfFrom: `/requests/${mine}` })).status, 303);
  assert.equal((await post(ann, `/requests/${owners}/cancel`, {}, { csrfFrom: `/requests/${owners}` })).status, 303);
  assert.deepEqual(sql(w.db, "SELECT status FROM requests ORDER BY title").map((r) => r.status), ["cancelled", "cancelled"]);
  assert.match(await text(ann, `/requests/${mine}`), /This request was withdrawn/);
  const later = await create(ann, { title: "Later" }); const orgId = sql(w.db, "SELECT organization_id o FROM requests WHERE title = 'Later'")[0].o;
  await repo.setStatus(w.db, orgId, later, "in_review", STAFF); await repo.approveRequest(w.db, orgId, later, { via: "staff_record", actorLabel: STAFF });
  assert.ok(!/Withdraw this request/.test(await text(ann, `/requests/${later}`)));
  assert.equal((await post(ann, `/requests/${later}/cancel`, {}, { csrfFrom: `/requests/${later}` })).status, 409);
});

test("My Requests: filters by service and lists existing support requests alongside, linking to their own pages", async () => {
  const { w, ann, text, create, post } = await setup();
  await create(ann);
  const dev = await post(ann, "/requests", { type: "ai_automation", title: "Quote follow-ups", d_problem: "We chase quotes by hand", d_outcomes: "Reminders" }, { multipart: true, csrfFrom: "/requests/new?type=ai_automation" });
  assert.equal(dev.status, 303);
  const sup = await post(ann, "/services/requests", { category: "technical_issue", title: "Form broken", description: "The contact form errors." }, { multipart: true, csrfFrom: "/services/requests/new" });
  assert.equal(sup.status, 303);
  const all = await text(ann, "/requests");
  assert.match(all, /Spring business cards/); assert.match(all, /Quote follow-ups/); assert.match(all, /Support and change requests/); assert.match(all, /Form broken/);
  assert.match(all, /href="\/portal\/o\/alpha\/services\/requests\/[0-9a-f-]{36}"/);
  const onlyDev = await text(ann, "/requests?kind=development");
  assert.match(onlyDev, /Quote follow-ups/); assert.ok(!/Spring business cards/.test(onlyDev)); assert.ok(!/Form broken/.test(onlyDev));
  assert.match(onlyDev, /aria-current="page">Custom Development/);
});

test("a request about a website: only the organization's published websites are offered and accepted", async () => {
  const { w, A, ann, text, post, CARD } = await setup();
  const site = (id, org, name, pub) => w.db.raw.prepare("INSERT INTO websites (id, organization_id, name, url, origin, status, published) VALUES (?, ?, ?, 'https://example.com', 'client', 'live', ?)").run(id, org, name, pub);
  const B = sql(w.db, "SELECT id FROM organizations WHERE slug = 'beta'")[0].id;
  site("a1111111-1111-4111-8111-111111111111", A.id, "Alpha Site", 1); site("b1111111-1111-4111-8111-111111111111", B, "Beta Site", 1); site("a2222222-2222-4222-8222-222222222222", A.id, "Hidden Draft", 0);
  const form = await text(ann, "/requests/new?type=seo_audit");
  assert.match(form, /Alpha Site/); assert.ok(!/Beta Site|Hidden Draft/.test(form));
  const bad = await post(ann, "/requests", { type: "seo_audit", title: "Audit", d_goals: "More calls", website_id: "b1111111-1111-4111-8111-111111111111" }, { multipart: true, csrfFrom: "/requests/new?type=seo_audit" });
  assert.equal(bad.status, 422); assert.equal(count(w.db, "requests"), 0);
  const good = await post(ann, "/requests", { type: "seo_audit", title: "Audit", d_goals: "More calls", website_id: "a1111111-1111-4111-8111-111111111111" }, { multipart: true, csrfFrom: "/requests/new?type=seo_audit" });
  assert.equal(good.status, 303); assert.equal(sql(w.db, "SELECT website_id FROM requests")[0].website_id, "a1111111-1111-4111-8111-111111111111");
});

test("SEO page shows only what exists: published website SEO data, and says plainly what is not connected", async () => {
  const { w, A, ann, text } = await setup();
  w.db.raw.prepare("INSERT INTO websites (id, organization_id, name, url, origin, status, published) VALUES ('a1111111-1111-4111-8111-111111111111', ?, 'Alpha Site', 'https://alpha.example', 'client', 'live', 1)").run(A.id);
  let seo = await text(ann, "/seo");
  assert.match(seo, /Alpha Site/); assert.match(seo, /Not set up/); assert.match(seo, /No SEO work is recorded for this website yet/);
  w.db.raw.prepare("INSERT INTO website_seo (website_id, organization_id, status, summary, published, updated_at, updated_by) VALUES ('a1111111-1111-4111-8111-111111111111', ?, 'in_progress', 'Fixing titles first.', 1, 't', 'a')").run(A.id);
  w.db.raw.prepare("INSERT INTO website_seo_metrics (id, organization_id, website_id, period_start, period_end, source, clicks, impressions, published, updated_at, updated_by) VALUES ('c1111111-1111-4111-8111-111111111111', ?, 'a1111111-1111-4111-8111-111111111111', '2026-10-01', '2026-10-31', 'manual', 42, 900, 1, 't', 'a')").run(A.id);
  w.db.raw.prepare("INSERT INTO website_seo_metrics (id, organization_id, website_id, period_start, period_end, source, clicks, published, updated_at, updated_by) VALUES ('c2222222-2222-4222-8222-222222222222', ?, 'a1111111-1111-4111-8111-111111111111', '2026-11-01', '2026-11-30', 'manual', 9999, 0, 't', 'a')").run(A.id);
  seo = await text(ann, "/seo");
  assert.match(seo, /Fixing titles first\./); assert.match(seo, /42 clicks, 900 impressions/); assert.match(seo, /entered by Framework/); assert.ok(!seo.includes("9999"), "an unpublished figure is never shown");
  assert.match(seo, /href="\/portal\/o\/alpha\/website\/a1111111-1111-4111-8111-111111111111\/seo"/);
});

test("emails: Framework is told about a new request with its type; the client is told a quote or design is waiting without any request text or amount; links go to the request", async () => {
  const { w, ann, create, d } = await setup();
  w.env.RESEND_API_KEY = "re_test"; w.env.ASSESSMENT_FROM = "Framework <hello@frameworkco.ca>"; w.env.ASSESSMENT_NOTIFY_TO = "staff@frameworkco.ca"; w.env.TURNSTILE_SITE_KEY = "x"; w.env.TURNSTILE_SECRET = "y";
  w.db.raw.prepare("INSERT INTO approved_emails (email, added_at, added_by) VALUES ('ann@alpha.test', 't', 'a')").run();
  const id = await create(ann, { title: "Secret launch cards" });
  const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ id: "m1" }), { status: 200 }); };
  await processNotifications(w.env, { db: w.db, now: new Date(), fetch: fetchImpl, force: true });
  assert.equal(sent.length, 1); assert.equal(sent[0].to[0] ?? sent[0].to, "staff@frameworkco.ca");
  assert.match(sent[0].subject, /New request from Alpha Co/); assert.match(sent[0].text, /Business card: Secret launch cards/); assert.match(sent[0].text, /\/admin\/requests\//);
  await repo.createQuote(w.db, orgId, id, { title: "Secret launch cards", scope: "Private scope words", amountCents: 12345 }, STAFF);
  await processNotifications(w.env, { db: w.db, now: new Date(Date.now() + 1000), fetch: fetchImpl, force: true });
  const clientMail = sent.find((m) => /quote/i.test(m.subject));
  assert.ok(clientMail, "the client is told a quote is ready");
  assert.ok(!/Secret launch cards|Private scope|123\.45|12345/.test(JSON.stringify(clientMail)), "no request text or amount in the email");
  assert.match(clientMail.text, new RegExp(`/portal/o/alpha/requests/${id}`));
  assert.match(buildEmail({ audience: "client", event: "request_status" }, { org: { slug: "alpha", name: "Alpha Co" }, request: { id, unified: true, status: "client_review" } }, "https://x.test").subject, /design is ready for your review/);
  assert.match(buildEmail({ audience: "client", event: "request_status" }, { org: { slug: "alpha", name: "Alpha Co" }, request: { id, unified: true, status: "completed" } }, "https://x.test").subject, /request is complete/);
  assert.match(buildEmail({ audience: "client", event: "request_status" }, { org: { slug: "alpha", name: "Alpha Co" }, request: { id, unified: true, status: "quoted" }, quoteOpen: true }, "https://x.test").text, /Open it in your portal to review it/);
});

test("Business Profile band: prominent while answers are missing, one quiet line when complete, honest when unreadable", async () => {
  const { unifiedHome } = await import("../portal/requests/views.js");
  const vm = { base: "/portal/o/alpha", now: new Date() }, base = { summary: { actions: [], actionCount: 0, open: 0 }, counts: {}, needs: {}, support: null, brand: null, website: null };
  const band = (status, next) => unifiedHome(vm, "<header></header>", { ...base, profile: { status, next } });
  const missing = band({ state: "ready", percent: 40, requiredRemaining: 5, actionRequired: true }, { state: "continue", path: "/profile/x" });
  assert.match(missing, /class="hm-profile"/); assert.match(missing, /40%<\/span>/); assert.match(missing, /5 required answers left/); assert.match(missing, /Continue your profile/); assert.match(missing, /<progress class="meter" max="100" value="40"/);
  const done = band({ state: "ready", percent: 100, requiredRemaining: 0 }, { state: "complete" });
  assert.match(done, /hm-profile hm-profile--done/); assert.match(done, /Review your profile/); assert.ok(!/required answer/.test(done));
  const broken = band({ state: "unavailable" }, null);
  assert.match(broken, /Progress unavailable right now/); assert.ok(!/<progress/.test(broken), "no bar and no invented number when progress cannot be read");
});

test("Production configuration: requests on, Client Services OFF. Five blocks link, Support says it is not available yet, no Support or Invoices entry, and the whole request workflow works", async () => {
  const { w, ann, mia, text, create, post, d, userOf } = await setup({ services: false });
  const home = await text(ann, "");
  assert.deepEqual([...home.matchAll(/<a class="hm-block" href="[^"]+"><span class="hm-block__top">[\s\S]*?<span class="hm-block__title">([^<]+)</g)].map((m) => m[1]), ["Branding", "Websites", "SEO", "Deliverables", "Custom Development"]);
  assert.match(home, /<div class="hm-block hm-block--off" role="group" aria-label="Support, not available yet">/); assert.match(home, /Not available yet/);
  assert.equal((home.match(/class="hm-block"/g) || []).length + (home.match(/class="hm-block hm-block--off"/g) || []).length, 6, "still six equal blocks");
  assert.ok(!/\/services\//.test(home), "nothing on Home points into Client Services");
  const nav = navOf(home); assert.deepEqual(nav, ["Home", "Websites", "Branding", "Deliverables", "SEO", "Custom Development", "My Requests", "Settings"]);
  for (const gone of ["/services/requests", "/services/invoices", "/services/requests/new"]) assert.equal((await ann.get(`/portal/o/alpha${gone}`)).status, 404, gone + " does not exist while Services is off");
  // the request workflow does not depend on Services: submit, follow, reply, review, approve, download
  const id = await create(ann); const orgId = sql(w.db, "SELECT organization_id o FROM requests")[0].o;
  assert.equal((await post(mia, `/requests/${id}/reply`, { body: "A question" }, { multipart: true, csrfFrom: `/requests/${id}` })).status, 303);
  await repo.setStatus(w.db, orgId, id, "in_review", STAFF); await repo.approveRequest(w.db, orgId, id, { via: "staff_record", actorLabel: STAFF }); await repo.setStatus(w.db, orgId, id, "in_progress", STAFF);
  await svc.adminUpload(d(), { organizationId: orgId, requestId: id, role: "proof", file: { bytes: png(), name: "p.png" }, actor: STAFF }); await repo.setStatus(w.db, orgId, id, "client_review", STAFF);
  assert.match(await text(mia, `/requests/${id}`), /Review your design/);
  assert.equal((await post(ann, `/requests/${id}/approve`, { note: "ok" }, { csrfFrom: `/requests/${id}` })).status, 303);
  assert.match(await text(ann, `/requests/${id}`), /aria-label="Progress: Completed"/);
  // staff are told about the new request (the outbox does not need Client Services)
  assert.ok(sql(w.db, "SELECT count(*) n FROM service_notifications WHERE event = 'request_submitted' AND audience = 'staff'")[0].n >= 1); void userOf;
});
