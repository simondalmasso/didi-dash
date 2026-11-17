import test from "node:test";
import assert from "node:assert/strict";
import { queryTripRows } from "../public/trip-table.mjs";

const trips = [
  { id: "a", date: "2026-11-16", start: "10:00", amount: 4200, platform: "didi", km: 3 },
  { id: "b", date: "2026-11-17", start: "11:00", amount: 8500, platform: "didi", km: 8 },
  { id: "c", date: "2026-11-15", start: "09:00", amount: 3100, platform: "uber", km: 2 }
];

test("queryTripRows searches date, platform and amount, sorts, and paginates deterministically", () => {
  const result = queryTripRows(trips, { query: "didi", sort: "amount", direction: "desc", page: 1, pageSize: 1 });
  assert.equal(result.total, 2);
  assert.equal(result.pageCount, 2);
  assert.equal(result.rows[0].id, "b");
  assert.equal(result.page, 1);
});

test("queryTripRows matches amount and date text and clamps an out-of-range page", () => {
  const result = queryTripRows(trips, { query: "2026-11-15", sort: "date", direction: "asc", page: 99, pageSize: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.rows[0].id, "c");
  assert.equal(result.page, 1);
});

test("queryTripRows returns all rows for an empty query and never mutates its input", () => {
  const original = trips.map((trip) => trip.id);
  const result = queryTripRows(trips, { query: "", sort: "date", direction: "desc", page: 1, pageSize: 25 });
  assert.equal(result.total, 3);
  assert.deepEqual(trips.map((trip) => trip.id), original);
});
