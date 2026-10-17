// Run with:  node --test worker/test/*.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { combinedRevenue, formatTotal } from "../revenue.js";
import worker from "../index.js";

/** A minimal stand-in for the D1 binding: the Worker runs one SUM query over client_revenue. */
const fakeDb = (rows, fail) => ({
  prepare: () => ({
    first: async () => {
      if (fail) throw new Error(fail);
      const nums = rows.filter((r) => r > 0);
      return { total: nums.length ? nums.reduce((a, b) => a + b, 0) : null };
    },
  }),
});

test("no database, no rows, or a missing table gives no total", async () => {
  assert.equal(await combinedRevenue(undefined), null);
  assert.equal(await combinedRevenue(fakeDb([])), null);
  assert.equal(await combinedRevenue(fakeDb([], "D1_ERROR: no such table: client_revenue")), null);
});
test("other database errors propagate", async () => {
  await assert.rejects(combinedRevenue(fakeDb([], "boom")));
});
test("one figure shows $2.5M+ and later figures add to it", async () => {
  assert.deepEqual(await combinedRevenue(fakeDb([2500000])), { total: "$2.5M+", value: 2500000 });
  assert.deepEqual(await combinedRevenue(fakeDb([2500000, 1250000])), { total: "$3.7M+", value: 3750000 });
  assert.deepEqual(await combinedRevenue(fakeDb([2500000, 1250000, 750000])), { total: "$4.5M+", value: 4500000 });
});
test("rounds down, never up", async () => {
  assert.deepEqual(await combinedRevenue(fakeDb([2499999])), { total: "$2.4M+", value: 2499999 });
  assert.equal(formatTotal(999999), "$999K+");
  assert.equal(formatTotal(1999999), "$1.9M+");
  assert.equal(formatTotal(3000000), "$3M+");
});
test("public API returns only the total: no client, no figure, no count", async () => {
  const res = await worker.fetch(new Request("https://x/api/client-revenue"), { DB: fakeDb([2500000]) });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { total: "$2.5M+", value: 2500000 });
  assert.deepEqual(Object.keys(JSON.parse(text)), ["total", "value"]);
  assert.ok(!/aurora|client|count/i.test(text));
});
test("public API fails closed on a database error and is not cached", async () => {
  const res = await worker.fetch(new Request("https://x/api/client-revenue"), { DB: fakeDb([], "boom") });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { total: null, value: null });
  assert.notEqual(res.headers.get("cache-control"), "public, max-age=300");
});
test("only GET is allowed", async () => {
  const res = await worker.fetch(new Request("https://x/api/client-revenue", { method: "POST" }), { DB: fakeDb([1]) });
  assert.equal(res.status, 405);
});
