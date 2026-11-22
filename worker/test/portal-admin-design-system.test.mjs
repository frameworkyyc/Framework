// Guards for the Admin design system (worker/admin/DESIGN-SYSTEM.md): the document, the tokens, the shared kit, the grouped navigation and the rules new pages must keep.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODULES } from "../../admin/assets/modules.js";

const read = (p) => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the design system is documented and the development instructions require it", () => {
  const doc = read("worker/admin/DESIGN-SYSTEM.md"), rules = read("CLAUDE.md");
  for (const heading of ["## Admin identity", "## Usability standards", "## Tokens", "## Components", "## Navigation", "## Page patterns", "## Rules that are tested", "## Adding a page"]) assert.ok(doc.includes(heading), heading);
  assert.match(rules, /admin\/DESIGN-SYSTEM\.md/);
  assert.match(rules, /Admin UI: every Admin screen follows/);
});

test("every documented kit component exists and the status and spacing tokens are defined at :root", () => {
  const doc = read("worker/admin/DESIGN-SYSTEM.md"), kit = read("admin/assets/kit.js"), css = read("admin/assets/admin.css");
  for (const name of ["statCard", "badge", "card", "fold", "foldControls", "barList", "choiceGroups", "choice", "visual", "attentionList", "emptyState", "linkCard", "navIcon", "searchBox"]) {
    assert.ok(new RegExp(`export (function|const) ${name}\\b`).test(kit), `kit exports ${name}`);
    assert.ok(doc.includes("`" + name) || doc.includes(name + "("), `documented: ${name}`);
  }
  const layer = css.slice(css.indexOf("ADMIN KIT (admin/assets/kit.js)"));
  assert.ok(layer.length > 1000, "the kit layer exists");
  for (const token of ["--ok:", "--warn:", "--bad:", "--pend:", "--adm-space-1:", "--adm-space-6:"]) assert.ok(layer.includes(token), token);
});

test("Admin identity: soft cards from tokens (radius, depth, motion), a reduced-motion rule, no third-party assets, and the Admin-only scope is stated", () => {
  const ds = read("admin/assets/ds.css"), doc = read("worker/admin/DESIGN-SYSTEM.md"), rules = read("CLAUDE.md");
  for (const token of ["--ds-ground:", "--ds-card:", "--ds-r:", "--ds-r-lg:", "--ds-pill:", "--ds-shadow-1:", "--ds-shadow-2:", "--ds-ease:", "--ds-dur:", "--ds-ok:", "--ds-warn:", "--ds-bad:", "--ds-info:"]) assert.ok(ds.includes(token), token);
  assert.match(ds, /@media \(prefers-reduced-motion: reduce\)[^}]*\{[^}]*animation: none !important; transition: none !important/s, "every animation and transition is switched off under reduced motion");
  assert.ok(!/@import|url\(|https?:\/\//.test(strip(ds)), "no third-party fonts, images or imports in the design-system layer");
  const shadows = strip(ds).split("\n").filter((l) => /box-shadow:/.test(l) && !/^\s*--/.test(l) && !/var\(--ds-shadow|inset|none|0 1px 2px rgba\(0, 0, 0, \.25\)/.test(l));
  assert.deepEqual(shadows, [], "depth comes from the shadow tokens");
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(strip(read("admin/assets/ds.js"))) && !/setAttribute\(["']style|\.style\./.test(strip(read("admin/assets/ds.js"))), "the components set text and attributes only");
  for (const phrase of ["## Admin identity", "soft grey ground", "Gentle corners", "always with words", "Admin only", "prefers-reduced-motion", "Switzer"]) assert.ok(doc.includes(phrase), phrase);
  assert.match(rules, /premium, card-based design system/); assert.match(rules, /applies to Admin only/);
});

test("six navigation sections, every enabled module has a section and an icon, and no address is dropped", async () => {
  const { NAV, sectionOf } = await import("../../admin/assets/nav.js");
  assert.deepEqual(NAV.map((n) => n.id), ["overview", "clients", "websites", "analytics", "operations", "settings"]);
  const kit = read("admin/assets/kit.js"), ds = read("admin/assets/ds.js");
  for (const n of NAV) assert.ok(new RegExp(`(^|[\\s,{])"?${n.icon}"?: "M`).test(kit + ds), `${n.id} has an icon`);
  for (const m of MODULES.filter((x) => x.enabled)) assert.ok(sectionOf(m.path), `${m.id} (${m.path}) belongs to a section`);
  for (const [, path] of NAV.flatMap((n) => n.children || [])) assert.ok(sectionOf(path), `${path} is in a section`);
  const admin = read("admin/assets/admin.js");
  assert.match(admin, /NAV\.filter\(\(n\) => MODULES\.some\(\(m\) => m\.enabled && m\.id === n\.id\)\)/, "a section shows only when its module exists");
  for (const old of ["/admin/leads", "/admin/assessments", "/admin/discovery", "/admin/requests", "/admin/support", "/admin/feedback", "/admin/approved-emails", "/admin/settings/service-pricing", "/admin/settings/additional-services", "/admin/clients"]) assert.ok(MODULES.some((m) => m.enabled && (old === m.path || old.startsWith(m.path + "/"))), `${old} still resolves to a page`);
});

test("the kit and the review pages keep the rules: text only, no inline styles, no markup insertion, no low-contrast text", () => {
  for (const file of ["admin/assets/kit.js", "admin/assets/discovery.js"]) {
    const src = strip(read(file));
    assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(src), file + ": no markup insertion");
    assert.ok(!/setAttribute\(["']style|\.style\./.test(src), file + ": no inline styles");
  }
  const css = read("admin/assets/admin.css");
  assert.deepEqual(css.split("\n").filter((l) => /color: var\(--stone\)/.test(l) && !/is-disabled/.test(l)), []);
});

test("status colours in the design-system layer always have a text or icon partner", () => {
  const kit = read("admin/assets/kit.js");
  assert.match(kit, /export const badge = \(text, tone/, "a badge always carries text");
  assert.match(kit, /rk-sr/, "tiles name their state to screen readers");
});

test("the rebuilt pages use the shared kit instead of their own markup for summaries, folds and empty states", () => {
  const uses = { "overview.js": ["navIcon", "badge"], "feedback.js": ["statCard", "badge", "fold"], "support-global.js": ["statCard"], "assessments.js": ["badge", "fold", "statCard"], "discovery.js": ["statCard", "emptyState", "fold"],
    "clients.js": ["statCard", "searchBox"], "invoices.js": ["statCard"], "approved-emails.js": ["fold"], "settings.js": ["linkCard", "fold"], "client-services.js": ["fold"] };
  for (const [file, names] of Object.entries(uses)) {
    const src = read("admin/assets/" + file);
    const imp = src.match(/import \{([^}]*)\} from "\.\/kit\.js";/);
    assert.ok(imp, file + " imports the kit");
    for (const n of names) assert.ok(imp[1].split(",").map((x) => x.trim()).includes(n), `${file} uses ${n}`);
  }
});

test("pages that must stay read-only or form-free keep their controls in the kit, and the support conversation no longer collides with the requirements grid", () => {
  assert.ok(!/h\("input"/.test(strip(read("admin/assets/clients.js"))), "clients.js has no form control of its own");
  assert.match(read("admin/assets/support.js"), /class: "adm-acc adm-sreq"/);
  assert.ok(!/class: "adm-acc adm-req"/.test(read("admin/assets/support.js")));
});
