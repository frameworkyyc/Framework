// Client portal Stage 1: input validation helpers.
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, validateSlug, validateName, validateText, validateHttpsUrl, validateEnum, validateKind, validateAction, ROLES, PROJECT_STATUSES } from "../portal/repo/validate.js";
import { requireId, requireOrgId, PortalDataError, UUID } from "../portal/repo/common.js";

test("email: trimmed and lower-cased; anything ambiguous or hostile is rejected", () => {
  assert.equal(normalizeEmail("  Owner.Two@Example.TEST "), "owner.two@example.test");
  assert.equal(normalizeEmail("a+tag@example.co.uk"), "a+tag@example.co.uk");
  assert.equal(normalizeEmail("a@example.com\n"), "a@example.com", "surrounding whitespace (including a trailing newline) is trimmed; inner whitespace is rejected below");
  for (const bad of ["", "a", "a@b", "@example.com", "a@", "a b@example.com", "a@exa mple.com", "a@@example.com", "a\n@example.com", "a@example.com\u0000", "x".repeat(250) + "@example.com", null, undefined, 5, {}, ["a@example.com"]]) assert.equal(normalizeEmail(bad), null, JSON.stringify(bad)?.slice(0, 30));
});

test("slug: lower-case words joined by single hyphens, 2-48 characters", () => {
  for (const good of ["ab", "acme", "aurora-surveys", "a1-b2", "x".repeat(48)]) assert.equal(validateSlug(good), good);
  for (const bad of ["", "a", "Acme", "acme_x", "-a", "a-", "a--b", "a b", "a/b", "../x", "a.b", "x".repeat(49), null, 5, "acmé"]) assert.equal(validateSlug(bad), null, String(bad));
});

test("name: single line, 1-120 characters, trimmed", () => {
  assert.equal(validateName("  Acme Surveys Ltd. "), "Acme Surveys Ltd.");
  for (const bad of ["", "   ", "a\nb", "a\u0000b", "a\u2028b", "x".repeat(121), null, 5, {}]) assert.equal(validateName(bad), null, JSON.stringify(bad)?.slice(0, 20));
  assert.equal(validateName("x".repeat(120)).length, 120);
});

test("text: optional; multi-line allowed; control characters and oversize rejected", () => {
  assert.equal(validateText(undefined), null);
  assert.equal(validateText(""), null);
  assert.equal(validateText("line one\nline two"), "line one\nline two");
  assert.equal(validateText("x".repeat(2001)), undefined);
  assert.equal(validateText("bad\u0000"), undefined);
  assert.equal(validateText(5), undefined);
});

test("https url: optional; only https, no credentials, bounded length", () => {
  assert.equal(validateHttpsUrl(undefined), null);
  assert.equal(validateHttpsUrl(""), null);
  assert.equal(validateHttpsUrl("https://example.com/path?q=1"), "https://example.com/path?q=1");
  for (const bad of ["http://example.com", "javascript:alert(1)", "//example.com", "example.com", "https://user:pw@example.com", "https://localhost", "https://exa mple.com", "https://example.com/" + "x".repeat(300), "data:text/html,x", 5, {}]) assert.equal(validateHttpsUrl(bad), undefined, String(bad).slice(0, 30));
});

test("enums, kind and action names", () => {
  assert.equal(validateEnum("owner", ROLES), "owner");
  assert.equal(validateEnum("admin", ROLES), null);
  assert.equal(validateEnum("Owner", ROLES), null);
  assert.equal(validateEnum(undefined, PROJECT_STATUSES), null);
  assert.equal(validateKind("website"), "website");
  assert.equal(validateKind("Web Site"), null);
  assert.equal(validateAction("invitation.accepted"), "invitation.accepted");
  assert.equal(validateAction("Has Space"), null);
  assert.equal(validateAction("x".repeat(61)), null);
});

test("ids: only well-formed UUIDs are accepted, and the organization id check THROWS rather than returning", () => {
  const id = crypto.randomUUID();
  assert.equal(requireOrgId(id), id);
  assert.ok(UUID.test(id));
  for (const bad of [undefined, null, "", "not-a-uuid", 5, {}, [], [id], id + " ", " " + id, id.toUpperCase(), "00000000-0000-0000-0000-000000000000", id.slice(0, 35), "' OR 1=1 --"]) {
    assert.throws(() => requireOrgId(bad), (e) => e instanceof PortalDataError && e.code === "invalid_organization_id", JSON.stringify(bad));
  }
  assert.throws(() => requireId("x", "project_id"), (e) => e.code === "invalid_project_id");
});
