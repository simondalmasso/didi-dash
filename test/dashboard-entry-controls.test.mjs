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


test("dashboard exposes a primary fuel-consumption KPI with its measured/reference distinction", () => {
  assert.match(dashboard, /<div class="label">Consumo nafta<\/div>/);
  assert.match(dashboard, /id="fuel-consumption"/);
  assert.match(dashboard, /id="fuel-consumption-hint"/);
  assert.match(dashboard, /financial\.consumptionSource/);
});

test("dashboard keeps undated fuel purchases in cash calculations across date filters", () => {
  assert.match(dashboard, /selectFuelPurchasesForPeriod\(allFuelLogs/);
  assert.match(dashboard, /Se incluyen en la caja neta/);
});


test("dashboard KPI markup does not contain a literal escaped newline between cards", () => {
  assert.doesNotMatch(dashboard, /\\n\s*<div class="kpi">/);
});
