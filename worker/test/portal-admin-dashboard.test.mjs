/* Admin client detail dashboard: the pure rules (team counts, what needs attention, the monogram) and source guards for the layout, the accordions
   and the preserved management controls. Browser behaviour (keyboard, focus, axe, widths) is checked by hand on Staging; see the PR. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { teamFacts, attention, monogram, plural } from "../../admin/assets/client-dashboard.js";

const read = (f) => readFileSync(new URL("../../" + f, import.meta.url), "utf8");
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const org = { name: "Alpha Café", status: "active" };
const steps = (states) => states.map((s, i) => ({ id: "s" + i, title: "Step " + i, state: s, answered: s === "missing" ? 0 : 1, total_questions: 3, missing_required: [], fields: [] }));
const profile = (states) => { const st = steps(states); const done = st.filter((s) => s.state === "complete").length; return { done, total: st.length, percent: Math.round((done / st.length) * 100), steps: st }; };
const member = (role, o = {}) => ({ role, status: "active", user_status: "active", ...o });
const inv = (o = {}) => ({ status: "pending", ...o });
const kinds = (list) => list.map((a) => a.tone + ":" + a.go);

test("monogram: up to two initials from the name, any script, with a neutral fallback", () => {
  assert.equal(monogram("Alpha Café"), "AC");
  assert.equal(monogram("A"), "A");
  assert.equal(monogram("Supercalifragilisticexpialidocious-Consolidated-Industries"), "SI");
  assert.equal(monogram("Éric Östberg"), "ÉÖ");
  assert.equal(monogram("   "), "•");
  assert.equal(monogram(null), "•");
});

test("team facts count only what the rows say: active members and owners, pending (not expired) invitations, expired, failed, not sent, cleanup", () => {
  const f = teamFacts(
    [member("owner"), member("member"), member("member", { status: "revoked" }), member("owner", { user_status: "disabled" })],
    [inv(), inv({ past_expiry: true }), inv({ status: "expired" }), inv({ status: "accepted" }), inv({ status: "revoked", workos_cleanup: "pending" }), inv({ delivery: { state: "failed" } }), inv({ delivery: { state: "submitted" } }), inv({ delivery: { state: "not_sent" } })],
  );
  assert.deepEqual(f, { members: 2, owners: 1, pending: 4, lapsed: 1, failed: 1, unsent: 1, cleanup: 1 });
  // before delivery tracking has loaded (the detail API has none) failed and unsent are simply unknown, never invented
  const early = teamFacts([], [inv(), inv({ past_expiry: true })]);
  assert.equal(early.failed, 0); assert.equal(early.unsent, 0); assert.equal(early.pending, 1); assert.equal(early.lapsed, 1);
  assert.deepEqual(teamFacts([], []), { members: 0, owners: 0, pending: 0, lapsed: 0, failed: 0, unsent: 0, cleanup: 0 });
});

test("what needs attention: most urgent first, each with a place to go; a healthy client says so", () => {
  const none = { members: 2, owners: 1, pending: 0, lapsed: 0, failed: 0, unsent: 0, cleanup: 0 };
  assert.deepEqual(attention({ org, profile: profile(Array(7).fill("complete")), facts: none }), [], "complete profile, healthy team: nothing to do");
  const all = attention({ org: { ...org, status: "suspended" }, profile: profile(["complete", "partial", ...Array(5).fill("missing")]), facts: { ...none, failed: 1, lapsed: 2, unsent: 1, cleanup: 1 } });
  assert.deepEqual(kinds(all), ["bad:org-details", "bad:team-invitations", "warn:team-invitations", "warn:team-invitations", "warn:team-invitations", "info:profile-s1"]);
  assert.match(all[1].text, /1 invitation failed to send\. Nothing was emailed\./);
  assert.match(all[2].text, /2 invitations expired/);
  assert.match(all.at(-1).text, /6 of 7 Business Profile sections still need answers/, "the profile count agrees with the section states");
  // an empty team asks for the first owner; a team with no owner is flagged; waiting on the client is informational
  assert.deepEqual(kinds(attention({ org, profile: null, facts: { ...none, members: 0, owners: 0 } })), ["warn:team-invitations"]);
  assert.deepEqual(kinds(attention({ org, profile: null, facts: { ...none, owners: 0 } })), ["warn:team-members"]);
  assert.deepEqual(kinds(attention({ org, profile: null, facts: { ...none, members: 0, owners: 0, pending: 2 } })), ["info:team-invitations"]);
  // a profile nobody has started is its own message
  assert.match(attention({ org, profile: profile(Array(7).fill("missing")), facts: none })[0].text, /hasn’t started their Business Profile/);
  assert.equal(plural(1, "invitation"), "1 invitation"); assert.equal(plural(3, "person", "people"), "3 people");
});

test("the dashboard module only presents: text nodes, no network, no storage, no writes, and shows nothing it cannot compute from the data", () => {
  const src = strip(read("admin/assets/client-dashboard.js"));
  assert.ok(!/innerHTML|fetch\(|api\(|localStorage|sessionStorage|\.style\b|method:/.test(src));
  assert.ok(!/logo|upload|<img|"img"/i.test(src), "no logo or image infrastructure: the monogram is the only mark");
  for (const w of ["Complete", "Partial", "Missing"]) assert.ok(src.includes(`"${w}"`), w);
});

test("client detail structure: header with monogram, next step, two metric tiles, a seven-section map, collapsed accordions, quiet organization details last", () => {
  const src = strip(read("admin/assets/clients.js")), dash = strip(read("admin/assets/client-dashboard.js"));
  const detail = src.slice(src.indexOf("async function renderDetail"));
  assert.match(detail, /dash\.header,\s*dash\.overview,/, "header then overview first");
  assert.match(detail, /sectionMap\(p\.steps\)/);
  assert.match(detail, /p\.steps\.map\(stepAccordion\)/, "every section is an accordion item");
  assert.ok(detail.indexOf("access,") < detail.indexOf('id: "adm-profile"') && detail.indexOf('id: "adm-profile"') < detail.lastIndexOf("info,"), "order: team, saved answers, organization details last");
  assert.match(detail, /id: "org-details"[\s\S]*?"Portal address"[\s\S]*?"Website"[\s\S]*?"Created"/, "the low-priority details stay available inside a collapsed section");
  assert.ok(!/open: true/.test(detail), "nothing in the detail page is open by default");
  assert.match(detail, /staff cannot edit them here/, "answers stay read-only");
  assert.match(dash, /h\("details", \{ class: "adm-acc "/, "native details/summary: keyboard and expanded state come from the platform");
  assert.match(dash, /h\("summary", \{ class: "adm-acc__sum" \}/);
  assert.match(dash, /Nothing saved here yet\. The client hasn’t answered this section\./, "a missing section explains itself in one line");
  assert.match(dash, /h\("progress", \{ class: "adm-meter adm-meter--lg", max: 100, value: pct/, "the percentage is the existing server figure on a native progress element");
  assert.match(dash, /`\$\{profile\.done\} of \$\{profile\.total\} sections complete/, "x of 7 comes from the existing completion logic");
  assert.equal([...src.matchAll(/\bapi\(/g)].length, 2, "no extra requests: the list and the detail reads");
});

test("team and invitations: summary chips first, details inside labelled expandable sections, every management control still there", () => {
  const src = strip(read("admin/assets/clients-access.js"));
  assert.match(src, /id: "team-invitations", title: "Invitations"/);
  assert.match(src, /id: "team-members", title: "Members"/);
  assert.match(src, /chip\("bad", `\$\{f\.failed\} failed`/, "a failed send is visible without opening the section");
  assert.match(src, /welcomeBox \|\| \(!f\.members && !f\.pending\) \|\| f\.failed \|\| f\.lapsed \|\| f\.unsent \|\| f\.cleanup/, "sections needing action open on first look");
  assert.match(src, /toggled\("team-invitations"\)[\s\S]*toggled\("team-members"\)|onToggle: toggled\("team-members"\)/, "what the person opens stays open across refreshes");
  assert.match(src, /if \(onData\) onData\(data\);/, "the overview refreshes after every reload of the team");
  for (const keep of ["Make owner", "Make member", "Remove access", "Revoke", "Replace", "Resend", "Retry WorkOS cancel", "Create and send", "Create only",
    "The only active owner can’t be demoted", "The only active owner can’t be removed", "disabled: only && toRole === \"member\" ? true : null", "disabled: only ? true : null", "caps.writes ? inviteForm(caps) : null", "caps.writes ? memberActions(m, caps) : []", "confirmDialog"]) assert.ok(src.includes(keep) || read("admin/assets/clients-access.js").includes(keep), keep);
  assert.match(src, /\["Person", "Role", "Invitation", "Delivery", ""\]/);
  assert.match(src, /\["Person", "Role", "Access", "Last sign-in", ""\]/);
});

test("dashboard styles: semantic colours always paired with an icon and text, 44px targets, visible focus, no overflow, reduced motion", () => {
  const css = read("admin/assets/admin.css");
  const block = css.slice(css.indexOf("/* ---------- Client detail dashboard"));
  for (const t of ["--ok:", "--warn:", "--bad:", "--pend:"]) assert.ok(block.includes(t), t);
  for (const rule of [/\.adm-linkbtn \{[^}]*min-height: 44px/, /\.adm-acc__sum \{[^}]*min-height: 56px/, /\.adm-pmap__item \{[^}]*min-height: 56px/, /\.adm-acc__sum:focus-visible[^}]*outline: 2px solid var\(--ink\)/, /prefers-reduced-motion: reduce/, /\.adm-tiles \{ display: grid; grid-template-columns: minmax\(0, 1fr\)/, /@media \(max-width: 359px\) \{ \.adm-pmap \{ grid-template-columns: minmax\(0, 1fr\)/]) assert.match(block, rule);
  assert.match(block, /\.adm-idhead \.eyebrow \{ color: var\(--slate\); \}/);
  assert.deepEqual(css.split("\n").filter((l) => /color: var\(--stone\)/.test(l) && !/is-disabled/.test(l)), []);
});

test("Saved answers rows: number, flexible title, fixed-width status and count, chevron; the status can never wrap under the title", () => {
  const dash = strip(read("admin/assets/client-dashboard.js")), css = read("admin/assets/admin.css");
  assert.match(dash, /class: "adm-acc__num"[\s\S]*class: "adm-acc__name", text: s\.title/, "number and title are separate elements");
  assert.match(dash, /class: "adm-acc__label"[\s\S]*class: "adm-acc__count"/, "state label and answered count are separate elements");
  const block = css.slice(css.indexOf("/* Saved answers rows:"));
  assert.match(block, /\.adm-acc--step > \.adm-acc__sum \{ display: grid; grid-template-columns: 1\.75em minmax\(0, 1fr\) var\(--acc-state-w, 5\.75rem\)/, "a three-column grid, not wrapping flex");
  assert.match(block, /\.adm-acc__title, \.adm-acc--step \.adm-acc__stepname \{ display: contents; \}/);
  assert.match(block, /\.adm-acc--step \.adm-acc__state \{[^}]*white-space: nowrap/, "the status text never wraps");
  assert.match(block, /\.adm-acc--step \.adm-acc__name \{ min-width: 0;[^}]*overflow-wrap: break-word/, "long titles wrap and the row grows; nothing is truncated");
  assert.ok(!/text-overflow|line-clamp/.test(block), "no truncation");
  assert.match(block, /@media \(min-width: 521px\)[\s\S]*--acc-state-w: 11rem/);
  assert.match(block, /@media \(max-width: 359px\)/);
});
