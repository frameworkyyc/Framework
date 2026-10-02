// Run with:  node --test worker/test
import test from "node:test";
import assert from "node:assert/strict";
import { combinedRevenue, formatTotal } from "../revenue.js";

const c = (...revenues) => ({ clients: revenues.map((revenue, i) => ({ id: "c" + i, revenue })) });

test("no figures, or bad data, gives no total", () => {
  assert.equal(combinedRevenue(c(null, null)), null);
  assert.equal(combinedRevenue(c("5", 0, -1, NaN)), null);
  assert.equal(combinedRevenue(null), null);
  assert.equal(combinedRevenue({ clients: "x" }), null);
});
test("sums only usable figures and rounds down", () => {
  assert.equal(combinedRevenue(c(2500000, 1250000, null)), "$3.7M+");
  assert.equal(combinedRevenue(c(2499999)), "$2.4M+");
  assert.equal(combinedRevenue(c(3000000)), "$3M+");
  assert.equal(combinedRevenue(c(750000)), "$750K+");
});
test("formatTotal never rounds up", () => {
  assert.equal(formatTotal(999999), "$999K+");
  assert.equal(formatTotal(1999999), "$1.9M+");
});
test("the public total contains no per-client data", () => {
  assert.equal(typeof combinedRevenue(c(1250000)), "string");
});
