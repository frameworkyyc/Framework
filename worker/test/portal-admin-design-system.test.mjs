// Guards for the Admin design system (worker/admin/DESIGN-SYSTEM.md): the document, the tokens, the shared kit, the grouped navigation and the rules new pages must keep.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MODULES } from "../../admin/assets/modules.js";

const read = (p) => fs.readFileSync(new URL("../../" + p, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the design system is documented and the development instructions require it", () => {
  const doc = read("worker/admin/DESIGN-SYSTEM.md"), rules = read("CLAUDE.md");
  for (const heading of ["## Principles", "## Tokens", "## Components", "## Navigation", "## Page patterns", "## Rules that are tested", "## Adding a page"]) assert.ok(doc.includes(heading), heading);
  assert.match(rules, /admin\/DESIGN-SYSTEM\.md/);
  assert.match(rules, /Admin UI: every Admin screen follows/);
});

test("every documented kit component exists and every documented token is defined once, at :root", () => {
  const doc = read("worker/admin/DESIGN-SYSTEM.md"), kit = read("admin/assets/kit.js"), css = read("admin/assets/admin.css");
  for (const name of ["statCard", "badge", "card", "fold", "foldControls", "barList", "choiceGroups", "choice", "visual", "attentionList", "emptyState", "linkCard", "navIcon"]) {
    assert.ok(new RegExp(`export (function|const) ${name}\\b`).test(kit), `kit exports ${name}`);
    assert.ok(doc.includes("`" + name) || doc.includes(name + "("), `documented: ${name}`);
  }
  const root = css.slice(css.indexOf("ADMIN DESIGN SYSTEM, layer 2"));
  for (const token of ["--ok:", "--warn:", "--bad:", "--pend:", "--adm-radius:", "--adm-radius-sm:", "--adm-card-pad:", "--adm-card-border:", "--adm-space-1:", "--adm-space-6:"]) assert.ok(root.includes(token), token);
});

test("the sidebar is grouped, every enabled module has an icon and a place, and nothing is dropped", () => {
  const admin = read("admin/assets/admin.js"), kit = read("admin/assets/kit.js");
  const groups = admin.match(/const NAV_GROUPS = (\[\[[\s\S]*?\]\]);/);
  assert.ok(groups, "NAV_GROUPS exists");
  const ids = [...groups[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  for (const m of MODULES.filter((x) => x.enabled)) {
    assert.ok(ids.includes(m.id), `${m.id} is in a navigation group`);
    assert.ok(new RegExp(`(^|[\\s,{])"?${m.id}"?: "M`).test(kit), `${m.id} has an icon`);
  }
  assert.match(admin, /live\.filter\(\(m\) => !NAV_GROUPS\.some/, "a module not in a group still appears");
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
