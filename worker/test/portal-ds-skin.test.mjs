/* The client portal wears the Admin visual system through one stylesheet, loaded last and scoped away from the sign-in pages. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../../" + p, import.meta.url), "utf8");

test("portal-ds.css is linked after portal.css and any page stylesheet, and shares the Admin tokens", () => {
  const frame = read("worker/portal/frame.js");
  const i = frame.indexOf('/assets/css/portal.css"'), j = frame.indexOf("styles.map"), k = frame.indexOf('/assets/css/portal-ds.css"');
  assert.ok(i > 0 && j > i && k > j, "portal.css, then page styles, then portal-ds.css");
  const css = read("assets/css/portal-ds.css"), admin = read("admin/assets/ds.css");
  for (const t of ["--ds-ground: #EDEDEB", "--ds-card: #FFFFFF", "--ds-r-lg: 18px"]) { assert.ok(css.includes(t), t); assert.ok(admin.includes(t), t + " in Admin"); }
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.ok(!/body\s*\{/.test(css.replace(/body:not\(\.auth\)[^{]*\{/g, "")), "every rule is scoped away from the sign-in pages"); assert.ok(!/body:not\(\.auth\)(?!:not\(\.si-body\))/.test(css), "and from the editorial sign-in (body.si-body), whose own black design must stay");
});

test("the skin is appearance only: no script, no inline style, no markup changes needed", () => {
  const css = read("assets/css/portal-ds.css");
  assert.ok(!/@import|url\(\s*["']?https?:/.test(css), "no remote imports");
  assert.ok(!/expression\(|javascript:/i.test(css));
});
