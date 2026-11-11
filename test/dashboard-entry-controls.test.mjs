import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("dashboard exposes the local financial-entry forms", () => {
  for (const formId of [
    "monthly-cost-form",
    "one-off-cost-form",
    "local-session-form",
    "local-fuel-form"
  ]) {
    assert.match(dashboard, new RegExp('id="' + formId + '"'));
  }
  assert.match(dashboard, /localStorage\.setItem/);
  assert.match(dashboard, /createWorkSession/);
  assert.match(dashboard, /createFuelEntry/);
  assert.doesNotMatch(dashboard, /Modo solo lectura/i);
});

test("daily and monthly profitability views remain available alongside manual entry", () => {
  assert.match(dashboard, /id="daily-summary"/);
  assert.match(dashboard, /id="monthly-summary"/);
  assert.match(dashboard, /calculateProfitability\(/);
});
