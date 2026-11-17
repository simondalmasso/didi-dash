import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("trip history exposes search, sort, pagination and keyboard focus controls", () => {
  for (const id of ["trip-search", "trip-sort", "trip-pagination", "trip-page-status", "trip-prev", "trip-next"]) {
    assert.ok(dashboard.includes('id="' + id + '"'), "missing " + id);
  }
  assert.match(dashboard, /queryTripRows\(trips/);
  assert.match(dashboard, /pageSize: 25/);
  assert.match(dashboard, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(dashboard, /event\.key === "Escape"/);
  assert.match(dashboard, /from "\/trip-table\.mjs"/);
});
