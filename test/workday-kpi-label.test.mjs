import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("Data Fina labels connected-session duration as recorded connected hours, not all work hours", () => {
  assert.ok(dashboard.includes('["Horas conectadas registradas",'));
  assert.ok(dashboard.includes("tiempo de conexi\u00f3n anotado; no equivale a tiempo efectivo conduciendo"));
  assert.ok(!dashboard.includes('["Total de horas trabajadas",'));
});
