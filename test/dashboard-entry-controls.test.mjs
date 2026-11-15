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


test("navigation sets aria-current from the actual path and labels cash with rewards explicitly", () => {
  assert.match(dashboard, /dashboardPageFromPath\(location\.pathname\)/);
  assert.match(dashboard, /document\.documentElement\.dataset\.page = currentPage/);
  assert.match(dashboard, /document\.querySelectorAll\("\.app-nav a"\)/);
  assert.match(dashboard, /link\.setAttribute\("aria-current", "page"\)/);
  assert.match(dashboard, /link\.removeAttribute\("aria-current"\)/);
  assert.match(dashboard, /Caja disponible \(recompensas incluidas\)/);
  assert.match(dashboard, /Viajes \+ recompensas − nafta comprada − otros costos/);
});

test("inputs guide the driver to active trip days missing odometer coverage", () => {
  assert.match(dashboard, /id="missing-odometer-days"/);
  assert.match(dashboard, /missingOdometerDates/);
  assert.match(dashboard, /Carg\\u00e1 un turno con od\\u00f3metro para cada d\\u00eda/);
});


test("dashboard API requests bypass browser caches and use unique URLs", () => {
  assert.match(dashboard, /dashboardApiUrl\(path, Date\.now\(\) \+ "-" \+ \(\+\+apiRequestSequence\)\)/);
  assert.match(dashboard, /cache: "no-store"/);
  assert.match(dashboard, /"Cache-Control": "no-store, max-age=0"/);
  assert.match(dashboard, /"Pragma": "no-cache"/);
});

test("history exposes a safe loopback import flow with separate preview and commit", () => {
  assert.match(dashboard, /connect-src 'self' http:\/\/127\.0\.0\.1:43197/);
  assert.match(dashboard, /importer\.mjs/);
  assert.match(dashboard, /id="import-dialog"/);
  assert.match(dashboard, /id="import-file"/);
  assert.match(dashboard, /id="include-local-sessions"/);
  assert.match(dashboard, /id="connect-companion"/);
  assert.match(dashboard, /id="preview-import"/);
  assert.match(dashboard, /id="commit-import"/);
  assert.match(dashboard, /commit-import"[^>]*disabled/);
  assert.match(dashboard, /targetAddressSpace:\s*"loopback"/);
  assert.match(dashboard, /loopback-network/);
  assert.doesNotMatch(dashboard, /INGEST_TOKEN/);
  assert.match(dashboard, /id="import-status"/);
});

test("ledger coverage UI distinguishes partial data, truncation, and unsynced shifts", () => {
  assert.match(dashboard, /audit\.mjs/);
  assert.match(dashboard, /id="ledger-coverage"/);
  assert.match(dashboard, /id="ledger-audit-summary"/);
  assert.match(dashboard, /id="ledger-audit-days"/);
  assert.match(dashboard, /Sin turnos sincronizados/);
  assert.match(dashboard, /No comparado contra A22/);
});
test("dashboard renders fare detail and a per-day trip timeline without claiming gaps as wait time", () => {
  assert.match(dashboard, /id="daily-trip-timeline"/);
  assert.match(dashboard, /id="trip-timeline"/);
  assert.match(dashboard, /buildTripTimeline/);
  assert.match(dashboard, /renderTripTimeline\(trips\)/);
  assert.match(dashboard, /espera/);
  assert.match(dashboard, /breakdown\.status === "verified"/);
  assert.match(dashboard, /conexion no registrada/);
  assert.match(dashboard, /duration_seconds/);
});
test("data-fina dashboard uses the live canonical aggregator and keeps finance evidence labelled", () => {
  assert.match(dashboard, /import \{ buildDataFina \} from "\/data-fina\.mjs"/);
  assert.match(dashboard, /function renderDataFina\(trips, rewards, ledgerFuel\)/);
  assert.match(dashboard, /buildDataFina\(/);
  for (const id of [
    "data-fina-hero", "data-fina-cash-net", "data-fina-daily-target",
    "data-fina-detail-pct", "data-fina-allocation-bar",
    "data-fina-components", "data-fina-days-chart",
    "data-fina-hours-chart", "data-fina-efficiency"
  ]) assert.match(dashboard, new RegExp('id="' + id + '"'));
  assert.match(dashboard, /comprado/);
  assert.match(dashboard, /no beneficio operativo/);
  assert.match(dashboard, /no se consideran espera ni tiempo conectado/);
  assert.match(dashboard, /solo se incluyen importes observados en pantallas reales/i);
});

test("daily gross goal is user-editable and persisted locally, not written to the public ledger", () => {
  assert.match(dashboard, /dailyGrossTarget: 80000/);
  assert.match(dashboard, /localSettings\.dailyGrossTarget/);
  assert.match(dashboard, /saveLocalSettings\(\)/);
  assert.match(dashboard, /initDataFinaControls\(\)/);
});
