import test from "node:test";
import assert from "node:assert/strict";
import { calculateProfitability, ETIOS_BASELINE_L_PER_100KM, summarizeEarnings, createWorkSession, createFuelEntry } from "../public/finance.mjs";

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


test("fuel estimates apply the YPF Super price snapshot in force on each trip date", () => {
  const result = calculateProfitability({
    trips: [
      { date: "2026-11-02", amount: 4000, km: 100, km_source: "actual" },
      { date: "2026-11-08", amount: 5000, km: 100, km_source: "actual" }
    ],
    rewards: [],
    sessions: [],
    fuelLogs: [],
    priceHistory: [
      { effective_from: "2026-11-02", price_ars_per_liter: 2000 },
      { effective_from: "2026-11-06", price_ars_per_liter: 2200 }
    ],
    monthlyCosts: {},
    oneOffExpenses: [],
    periodDays: 7
  });
  assert.equal(result.fuelLiters, 17.6);
  assert.equal(result.fuelCost, 36960);
});


test("a future YPF price is not applied retroactively to earlier trip dates", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-10-31", amount: 5000, km: 10, km_source: "actual" }],
    rewards: [],
    sessions: [],
    fuelLogs: [],
    priceHistory: [{ effective_from: "2026-11-02", price_ars_per_liter: 2167 }],
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 1
  });
  assert.equal(result.fuelCost, null);
  assert.equal(result.missingPriceDates, 1);
  assert.equal(result.netPartial, null);
  assert.equal(result.netComplete, false);
});

test("daily and monthly summaries split gross, passenger and vehicle kilometres, and dated YPF fuel", () => {
  const summary = summarizeEarnings({
    trips: [
      { date: "2026-11-02", amount: 10000, km: 10, km_source: "actual" },
      { date: "2026-11-02", amount: 5000, km: 8, km_source: "estimated" },
      { date: "2026-11-03", amount: 8000, km: 20, km_source: "actual" }
    ],
    rewards: [{ date: "2026-11-02", amount: 2000 }],
    sessions: [
      { date: "2026-11-02", odometer_km: 30 },
      { date: "2026-11-03", odometer_km: null }
    ],
    priceHistory: [
      { effective_from: "2026-11-02", price_ars_per_liter: 2000 },
      { effective_from: "2026-11-03", price_ars_per_liter: 2200 }
    ]
  });
  assert.equal(summary.daily.length, 2);
  assert.equal(summary.daily[0].date, "2026-11-02");
  assert.equal(summary.daily[0].tripGross, 15000);
  assert.equal(summary.daily[0].rewardGross, 2000);
  assert.equal(summary.daily[0].gross, 17000);
  assert.equal(summary.daily[0].actualPassengerKm, 10);
  assert.equal(summary.daily[0].estimatedRouteKm, 8);
  assert.equal(summary.daily[0].vehicleKm, 30);
  assert.equal(summary.daily[0].fuelCost, 5280);
  assert.equal(summary.daily[1].fuelMode, "passenger_km_partial");
  assert.equal(summary.daily[1].fuelCost, 3872);
  assert.equal(summary.monthly.length, 1);
  assert.equal(summary.monthly[0].gross, 25000);
  assert.equal(summary.monthly[0].actualPassengerKm, 30);
  assert.equal(summary.monthly[0].estimatedRouteKm, 8);
  assert.equal(summary.monthly[0].vehicleKm, 30);
  assert.equal(summary.monthly[0].fuelCost, 9152);
  assert.equal(summary.monthly[0].netAfterFuelPartial, 15848);
});


test("work session entry computes odometer kilometres and handles overnight shifts", () => {
  const row = createWorkSession({
    id: "session-test-1",
    date: "2026-11-09",
    platform: "didi",
    connected_start: "22:00",
    connected_end: "01:30",
    odometer_start: 12000,
    odometer_end: 12065
  });
  assert.equal(row.connected_minutes, 210);
  assert.equal(row.odometer_km, 65);
  assert.equal(row.odometer_start, 12000);
  assert.equal(row.odometer_end, 12065);
});

test("work session entry rejects reversed odometer and sessions over 16 hours", () => {
  assert.throws(() => createWorkSession({
    date: "2026-11-09", connected_start: "08:00", connected_end: "10:00",
    odometer_start: 12065, odometer_end: 12000
  }), /odometer_end/);
  assert.throws(() => createWorkSession({
    date: "2026-11-09", connected_start: "05:00", connected_end: "22:00",
    odometer_start: 12000, odometer_end: 12100
  }), /16 hours/);
});

test("fuel ticket entry stores litres, amount, odometer and full tank flag", () => {
  const row = createFuelEntry({
    id: "fuel-test-1", date: "2026-11-09", odometer_km: 12065,
    liters: 35.5, total_ars: 77000, station: "YPF", full_tank: true
  });
  assert.ok(Math.abs(row.price_per_liter - 2169.014084507042) < 1e-9);
  assert.equal(row.full_tank, 1);
  assert.equal(row.odometer_km, 12065);
});

test("fuel ticket entry rejects invalid amounts, litres and odometer", () => {
  assert.throws(() => createFuelEntry({
    date: "2026-11-09", odometer_km: -1, liters: 35, total_ars: 70000
  }), /odometer/);
  assert.throws(() => createFuelEntry({
    date: "2026-11-09", odometer_km: 12000, liters: 0, total_ars: 70000
  }), /liters/);
});


test("odometer on only one of several active trip dates cannot produce complete operating net", () => {
  const result = calculateProfitability({
    trips: [
      { date: "2026-11-08", amount: 12000, km: 10, km_source: "actual" },
      { date: "2026-11-09", amount: 9000, km: 12, km_source: "actual" }
    ],
    rewards: [],
    sessions: [{ date: "2026-11-08", odometer_km: 50 }],
    fuelLogs: [],
    priceHistory: [{ effective_from: "2026-11-02", price_ars_per_liter: 2167 }],
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 2
  });
  assert.equal(result.odometerComplete, false);
  assert.equal(result.fuelMode, "vehicle_odometer_partial");
  assert.equal(result.netComplete, false);
  assert.equal(result.netOperating, null);
});


test("daily and monthly summaries use measured tank-to-tank consumption like the main profitability KPI", () => {
  const summary = summarizeEarnings({
    trips: [{ date: "2026-11-05", amount: 20000, km: 15, km_source: "actual" }],
    rewards: [],
    sessions: [{ date: "2026-11-05", odometer_km: 100 }],
    fuelLogs: [
      { date: "2026-11-01", odometer_km: 1000, liters: 30, full_tank: 1 },
      { date: "2026-11-05", odometer_km: 1100, liters: 10, full_tank: 1 }
    ],
    priceHistory: [{ effective_from: "2026-11-02", price_ars_per_liter: 2000 }]
  });

  assert.equal(summary.daily[0].fuelLiters, 10);
  assert.equal(summary.daily[0].fuelCost, 20000);
  assert.equal(summary.daily[0].consumptionLPer100Km, 10);
  assert.equal(summary.daily[0].consumptionSource, "tank_to_tank");
  assert.equal(summary.monthly[0].fuelLiters, 10);
  assert.equal(summary.monthly[0].fuelCost, 20000);
  assert.equal(summary.monthly[0].consumptionLPer100Km, 10);
  assert.equal(summary.monthly[0].consumptionSource, "tank_to_tank");
});


test("incomplete fuel purchase can be recorded from its known total first", () => {
  const row = createFuelEntry({
    id: "fuel-pending-30000",
    total_ars: 30000
  });
  assert.equal(row.date, null);
  assert.equal(row.odometer_km, null);
  assert.equal(row.liters, null);
  assert.equal(row.price_per_liter, null);
  assert.equal(row.total_ars, 30000);
});

test("cash net subtracts the three known 30000 ARS fuel purchases without mixing consumed fuel", () => {
  const result = calculateProfitability({
    trips: [{ date: "2026-11-10", amount: 443600, km: 0, km_source: "unknown" }],
    rewards: [],
    sessions: [],
    fuelLogs: [],
    fuelPurchases: [
      { total_ars: 30000 },
      { total_ars: 30000 },
      { total_ars: 30000 }
    ],
    priceHistory: [],
    monthlyCosts: { insurance: 0, maintenance: 0, tires: 0, tax: 0, other: 0 },
    oneOffExpenses: [],
    periodDays: 30
  });
  assert.equal(result.fuelPurchaseSpend, 90000);
  assert.equal(result.netCashAfterFuelPurchases, 353600);
  assert.equal(result.fuelCost, null);
});
