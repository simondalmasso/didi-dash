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


test("dashboard exposes three distinct views and a provisional trip-net primary KPI", () => {
  assert.match(dashboard, /document\.documentElement\.dataset\.page\s*=\s*location\.pathname\.startsWith/);
  assert.match(dashboard, /href="\/"[^>]*>Panel/);
  assert.match(dashboard, /href="\/inputs\/"[^>]*>Inputs/);
  assert.match(dashboard, /href="\/trips\/"[^>]*>Historial/);
  assert.match(dashboard, /data-area="dashboard"/);
  assert.match(dashboard, /data-area="inputs"/);
  assert.match(dashboard, /data-area="history"/);
  assert.match(dashboard, /Neto provisional tras nafta/);
  assert.match(dashboard, /calculateTripNetAfterFuel\(/);
  assert.match(dashboard, /\$\(?"hero-margin"\)?\.textContent/);
});


test("page-specific toolbars and period filters stay in their own views", () => {
  assert.match(dashboard, /<div class="toolbar" data-area="dashboard">/);
  assert.match(dashboard, /<div class="toolbar" data-area="inputs">/);
  assert.match(dashboard, /<div class="toolbar" data-area="history">/);
  assert.equal((dashboard.match(/data-range="7"/g) || []).length, 2);
  assert.equal((dashboard.match(/data-range="30"/g) || []).length, 2);
  assert.ok(dashboard.includes("item.classList.toggle('active', active)"));
});


test("dashboard range filters include Today and preserve the selected period in the URL", () => {
  assert.equal((dashboard.match(/data-range="1">Hoy/g) || []).length, 2);
  assert.match(dashboard, /dashboardRangeFromSearch\(location\.search\)/);
  assert.match(dashboard, /dashboardUrlWithRange\(location\.pathname, location\.search, location\.hash, state\.range\)/);
  assert.match(dashboard, /window\.history\.replaceState/);
  assert.match(dashboard, /aria-pressed/);
  assert.match(dashboard, /activeRangeParam/);
});
