import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helioModuleUrl = new URL("../public/helio-cards.mjs", import.meta.url);
const helioModulePath = fileURLToPath(helioModuleUrl);
const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

function hourlyRows(values) {
  return values.map((gross, hour) => ({ hour, gross, trips: gross > 0 ? 1 : 0, prime: false }));
}

test("Helio view model preserves the canonical Data Fina prime rule and separates unassigned hours", async () => {
  assert.equal(existsSync(helioModulePath), true, "public/helio-cards.mjs is missing");
  const { buildHelioViewModel } = await import(helioModuleUrl);
  assert.equal(typeof buildHelioViewModel, "function");

  const hours = Array(24).fill(0);
  hours[0] = 300;
  hours[7] = 100;
  hours[8] = 200;
  hours[9] = 300;
  hours[12] = 400;
  hours[17] = 500;
  hours[18] = 600;
  hours[22] = 700;
  hours[23] = 800;

  const result = {
    tripCount: 9,
    gross: 4000,
    rewardGross: 500,
    fuelSpend: 500,
    cashNet: 3800,
    days: [{ date: "2026-11-14", gross: 4000, trips: 9 }],
    hours: hourlyRows(hours),
    primeGross: 2400,
    primeSharePercent: 60,
    bestHour: 23,
    bestHourGross: 800,
    actualKm: 40,
    actualKmTrips: 5,
    durationTrips: 6,
    passengerHours: 2,
    connectedHours: null,
    grossPerPassengerHour: 2000
  };
  const financial = {
    netCashAfterFuelPurchases: 3500,
    netCashAssumesZeroWithdrawalFees: true,
    withdrawalEvidence: false,
    withdrawalFeeSpend: null,
    fuelPurchaseSpend: 700,
    netOperating: null,
    netComplete: false,
    fuelCost: 12000,
    fuelMode: "passenger_km_partial",
    otherCosts: 0,
    missingCosts: ["insurance"]
  };

  const model = buildHelioViewModel(result, financial);
  assert.equal(model.primeGross, 2400, "prime gross must come from Data Fina (07–09 and 17–22)");
  assert.equal(model.primeSharePercent, 60);
  assert.equal(model.hourGross, 3900);
  assert.equal(model.unassignedHourGross, 100);
  assert.deepEqual(model.bands.map((band) => band.gross), [300, 600, 900, 2100, 100]);
  assert.equal(model.cashAfterRecordedCosts, 3500);
  assert.equal(model.cashAssumesZeroWithdrawalFees, true);
  assert.equal(model.withdrawalFeeSpend, null);
  assert.equal(model.operatingProfit, null, "incomplete operating result must stay unknown");
  assert.equal(model.fuelPurchaseSpend, 700, "purchase cash total must come from profitability, including local entries");
  assert.equal(model.fuelCostEstimate, 12000);
  assert.equal(model.fuelMode, "passenger_km_partial");
  assert.equal(model.connectedHours, null);
});


test("Helio flip controls transfer keyboard focus to the visible face", () => {
  const source = readFileSync(helioModuleUrl, "utf8");
  assert.ok(source.includes("const visibleFlip = card.querySelector"));
  assert.ok(source.includes("visibleFlip?.focus()"));
});

test("the history dashboard mounts Helio from the current Data Fina and profitability results", () => {
  assert.match(dashboard, /id="helio-cards"/);
  assert.match(dashboard, /from "\/helio-cards\.mjs"/);
  assert.match(
    dashboard,
    /renderHelioCards\(\$\("helio-cards"\),\s*result,\s*financial\s*\)/
  );
});


test("Helio view model passes weekday, six time-band and real-distance intelligence without manufacturing rankings", async () => {
  const { buildHelioViewModel } = await import(helioModuleUrl);
  const result = {
    tripCount: 4,
    gross: 5000,
    hours: hourlyRows([1000]),
    days: [],
    weekdays: [{ day: 0, label: "Domingo", gross: 5000, grossPerActiveDate: 2500, tripCount: 4, dateCount: 2, durationTrips: 4, coveragePercent: 100, grossPerPassengerHour: 18000, ranked: false, reason: "menos de 3 fechas con actividad" }],
    timeBands: [{ key: "morning", label: "06–12", gross: 3000, tripCount: 3, dateCount: 1, durationTrips: 2, coveragePercent: 66.7, grossPerPassengerHour: 18000, ranked: false, reason: "menos de 2 fechas con actividad" }],
    distanceBands: [{ key: "short", label: "Corto ≤3 km", gross: 3000, actualKm: 3, grossPerKm: 1000, tripCount: 3, dateCount: 2, durationTrips: 3, coveragePercent: 100, grossPerPassengerHour: 18000, ranked: true }],
    distanceCoverage: { actualKmTrips: 3, unknownOrEstimatedTrips: 1, actualKmPercent: 75 },
    unassignedStartTimeTrips: 1,
    unassignedStartTimeGross: 2000
  };
  const model = buildHelioViewModel(result, {});
  assert.equal(model.weekdays[0].ranked, false);
  assert.equal(model.weekdays[0].dateCount, 2);
  assert.equal(model.timeBands[0].reason, "menos de 2 fechas con actividad");
  assert.equal(model.distanceBands[0].grossPerKm, 1000);
  assert.equal(model.distanceCoverage.unknownOrEstimatedTrips, 1);
  assert.equal(model.unassignedStartTimeGross, 2000);
});

test("Helio dashboard renders operational evidence and explicitly refuses daily profit claims", () => {
  const module = readFileSync(helioModuleUrl, "utf8");
  const css = readFileSync(new URL("../public/helio-cards.css", import.meta.url), "utf8");
  assert.match(module, /Decisiones operativas/);
  assert.match(module, /Días de semana/);
  assert.match(module, /Horario de inicio/);
  assert.match(module, /Distancia del viaje/);
  assert.match(module, /No clasificable con la evidencia actual/);
  assert.match(module, /no por hora conectada ni por turno completo/);
  assert.match(css, /\.helio-back\{overflow-x:hidden;overflow-y:auto/);
  assert.match(css, /\.helio-insights-grid\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
});

test("the daily ledger audit is contained in its own mobile horizontal scroller", () => {
  assert.match(dashboard, /#ledger-audit-days\{[^}]*overflow-x:auto/s);
  assert.match(dashboard, /#ledger-audit-days table\{width:max-content;min-width:860px\}/);
});


test("mobile timeline events occupy one full-width column and cannot widen the document", () => {
  const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(dashboard, /\.timeline-list\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(dashboard, /\.timeline-item\{[^}]*grid-column:1\/-1/);
  assert.match(dashboard, /\.timeline-card\{[^}]*min-width:0/);
});

test("Helio card backs have enough mobile-first height for the complete recorded content", () => {
  const css = readFileSync(new URL("../public/helio-cards.css", import.meta.url), "utf8");
  assert.match(css, /\.helio-card\{position:relative;min-width:0;min-height:452px;height:452px/);
  assert.match(css, /\.helio-card,\.helio-card:last-child\{[^}]*height:444px;min-height:444px\}/);
});


test("Helio global coverage exposes the observed denominator and flip controls meet touch target size", async () => {
  const { buildHelioViewModel } = await import(helioModuleUrl);
  const model = buildHelioViewModel({ tripCount: 10, durationTrips: 6, distanceCoverage: { actualKmTrips: 4, unknownOrEstimatedTrips: 6, actualKmPercent: 40 } }, {});
  const css = readFileSync(new URL("../public/helio-cards.css", import.meta.url), "utf8");
  assert.equal(model.durationCoveragePercent, 60);
  assert.match(css, /min-block-size:44px;min-inline-size:44px/);
});
