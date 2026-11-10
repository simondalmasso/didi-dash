import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfitability, ETIOS_BASELINE_L_PER_100KM } from "../public/finance.mjs";

const PRICE_HISTORY = [
  { effective_from: "2026-11-02", price_ars_per_liter: 2167, station: "YPF San Carlos Centro" }
];

test("Etios fuel cost uses 8.8 L/100km and dated YPF Super prices", () => {
  assert.equal(ETIOS_BASELINE_L_PER_100KM, 8.8);
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 10000, km: 100, km_source: "actual" }],
    rewards: [{ date: "2026-11-08", amount: 2000 }],
    sessions: [],
    fuelLogs: [],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: {},
    oneOffExpenses: [],
    periodDays: 30
  });
  assert.equal(result.gross, 12000);
  assert.equal(result.fuelMode, "passenger_km_partial");
  assert.equal(result.fuelKm, 100);
  assert.equal(result.fuelLiters, 8.8);
  assert.equal(result.fuelCost, 19069.6);
  assert.equal(result.netPartial, -7069.6);
  assert.equal(result.netOperating, null);
  assert.equal(result.netComplete, false);
});

test("odometer distance replaces passenger kilometres for total vehicle fuel", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 100000, km: 100, km_source: "actual" }],
    rewards: [],
    sessions: [{ date: "2026-11-08", odometer_km: 150 }],
    fuelLogs: [],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: {
      insurance: 20000, maintenance: 10000, tires: 5000,
      tax: 3000, other: 2000
    },
    oneOffExpenses: [{ date: "2026-11-08", category: "repair", amount_ars: 6000 }],
    periodDays: 30
  });
  assert.equal(result.fuelMode, "vehicle_odometer");
  assert.equal(result.fuelKm, 150);
  assert.equal(result.fuelLiters, 13.2);
  assert.equal(result.fuelCost, 28604.4);
  assert.equal(result.fixedCosts, 40000);
  assert.equal(result.oneOffCosts, 6000);
  assert.equal(result.netOperating, 25395.6);
});

test("blank monthly costs remain unknown, not silently treated as zero", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 5000, km: 10, km_source: "actual" }],
    rewards: [],
    sessions: [{ date: "2026-11-08", odometer_km: 20 }],
    fuelLogs: [],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: { insurance: 1000, maintenance: null, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 30
  });
  assert.equal(result.netComplete, false);
  assert.equal(result.netOperating, null);
  assert.deepEqual(result.missingCosts, ["maintenance"]);
});

test("two consecutive full-tank readings replace the Etios reference with measured consumption", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 100000, km: 100, km_source: "actual" }],
    rewards: [],
    sessions: [{ date: "2026-11-08", odometer_km: 500 }],
    fuelLogs: [
      { date: "2026-11-01", odometer_km: 100000, liters: 42, total_ars: 84000, full_tank: 1 },
      { date: "2026-11-08", odometer_km: 100500, liters: 40, total_ars: 86680, full_tank: 1 }
    ],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 7
  });
  assert.equal(result.consumptionSource, "tank_to_tank");
  assert.equal(result.consumptionLPer100Km, 8);
});

test("estimated route kilometres are not treated as vehicle fuel distance", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 1000, km: 8, km_source: "estimated" }],
    rewards: [],
    sessions: [],
    fuelLogs: [],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 1
  });
  assert.equal(result.actualPassengerKm, 0);
  assert.equal(result.fuelMode, "unavailable");
  assert.equal(result.fuelCost, null);
});


test("partial odometer coverage cannot be reported as complete net profit", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-08", amount: 100000, km: 100, km_source: "actual" }],
    rewards: [],
    sessions: [
      { date: "2026-11-08", odometer_km: 150 },
      { date: "2026-11-09", odometer_km: null }
    ],
    fuelLogs: [],
    priceHistory: PRICE_HISTORY,
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 30
  });
  assert.equal(result.fuelMode, "vehicle_odometer_partial");
  assert.equal(result.odometerComplete, false);
  assert.equal(result.netComplete, false);
  assert.equal(result.netOperating, null);
});
