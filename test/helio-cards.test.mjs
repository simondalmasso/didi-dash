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

test("the history dashboard mounts Helio from the current Data Fina and profitability results", () => {
  assert.match(dashboard, /id="helio-cards"/);
  assert.match(dashboard, /from "\/helio-cards\.mjs"/);
  assert.match(
    dashboard,
    /renderHelioCards\(\$\("helio-cards"\),\s*result,\s*financial\s*\)/
  );
});
