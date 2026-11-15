import test from "node:test";
import assert from "node:assert/strict";
import { buildDataFina, readTripBreakdown } from "../public/data-fina.mjs";

const components = [
  { code: "distancia", label: "Tarifa por distancia", amount: 1000 },
  { code: "tiempo", label: "Tarifa por tiempo", amount: 500 }
];

test("canonical actual breakdown is read as verified only when its components reconcile", () => {
  const valid = readTripBreakdown({
    amount: 1500,
    breakdown: { source: "actual", components }
  });
  assert.equal(valid.status, "verified");
  assert.equal(valid.total, 1500);
  assert.equal(valid.missingAmount, 0);

  const mismatch = readTripBreakdown({
    amount: 1800,
    breakdown: { source: "actual", components }
  });
  assert.equal(mismatch.status, "partial");
  assert.equal(mismatch.total, 1500);
  assert.equal(mismatch.missingAmount, 300);
});

test("legacy flat fare_breakdown preserves the wait component and requires detail verification", () => {
  const verified = readTripBreakdown({
    amount: 1600,
    detail_verified: true,
    fare_breakdown: {
      distance_ars: 500, time_ars: 500, wait_ars: 100,
      dynamic_base_ars: 300, differential_price_ars: 100,
      fare_reimbursement_ars: 100
    }
  });
  assert.equal(verified.status, "verified");
  assert.equal(verified.components.find((x) => x.code === "espera").amount, 100);
  assert.equal(verified.total, 1600);

  const partial = readTripBreakdown({
    amount: 1600, detail_verified: false,
    fare_breakdown: { distance_ars: 500, time_ars: 500, dynamic_base_ars: 300 }
  });
  assert.equal(partial.status, "partial");
  assert.equal(partial.missingAmount, 300);
});

test("aggregate uses real reconciled breakdowns only and keeps partial/unobserved gross unallocated", () => {
  const trips = [
    { id: "a", date: "2026-11-14", start: "18:00", amount: 1500, km: 2, km_source: "actual", min: 3, duration_seconds: 180, breakdown: { source: "actual", components } },
    { id: "b", date: "2026-11-14", start: "19:00", amount: 1600, km: 3, km_source: "actual", min: 2, duration_seconds: 120, detail_verified: true, fare_breakdown: { distance_ars: 500, time_ars: 500, wait_ars: 100, dynamic_base_ars: 300, differential_price_ars: 100, fare_reimbursement_ars: 100 } },
    { id: "c", date: "2026-11-14", start: "20:00", amount: 900, km: 1, km_source: "actual", min: 1, duration_seconds: 60, detail_verified: false, fare_breakdown: { distance_ars: 300, time_ars: 300, dynamic_base_ars: 300 } },
    { id: "d", date: "2026-11-13", start: "18:30", amount: 700, km: 1, km_source: "actual", min: 2, duration_seconds: 120 }
  ];
  const result = buildDataFina({
    trips,
    rewards: [{ date: "2026-11-14", amount: 200 }],
    fuel: [
      { date: "2026-11-14", total_ars: 100 },
      { date: null, total_ars: 30 },
      { date: "2026-11-01", total_ars: 50 }
    ],
    from: "2026-11-14",
    to: "2026-11-14",
    dailyGoal: 1500
  });
  assert.equal(result.tripCount, 3);
  assert.equal(result.gross, 4000);
  assert.equal(result.rewardGross, 200);
  assert.equal(result.fuelSpend, 130);
  assert.equal(result.cashNet, 4070);
  assert.equal(result.breakdown.verifiedTrips, 2);
  assert.equal(result.breakdown.partialTrips, 1);
  assert.equal(result.breakdown.missingTrips, 0);
  assert.equal(result.breakdown.verifiedGross, 3100);
  assert.equal(result.breakdown.unallocatedGross, 900);
  assert.equal(result.components.find((x) => x.code === "espera").amount, 100);
  assert.equal(result.actualKm, 6);
  assert.equal(result.reportedSeconds, 360);
  assert.equal(result.grossPerPassengerHour, 40000);
  assert.equal(result.undatedFuelCount, 1);
  assert.equal(result.days.length, 1);
  assert.equal(result.days[0].metGoal, true);
});

test("all-time aggregation keeps undated fuel in cash but not in a dated bucket", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-14", start: "18:00", amount: 1000, km: 1, km_source: "actual", min: 2 }],
    rewards: [],
    fuel: [{ date: null, total_ars: 30000 }, { date: "2026-11-13", total_ars: 20000 }],
    dailyGoal: 80000
  });
  assert.equal(result.fuelSpend, 50000);
  assert.equal(result.cashNet, -49000);
  assert.equal(result.undatedFuelSpend, 30000);
  assert.equal(result.days.length, 1);
  assert.equal(result.dailyAverage, 1000);
});

test("hour buckets use trip start time and mark prime bands without inferring connected hours", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-14", start: "08:10", amount: 1000, min: 10 },
      { date: "2026-11-14", start: "18:10", amount: 2000, min: 10 },
      { date: "2026-11-14", start: "23:10", amount: 500, min: 10 }
    ],
    rewards: [], fuel: [], dailyGoal: 10000
  });
  assert.equal(result.primeGross, 3000);
  assert.equal(result.primeSharePercent, 85.71428571428571);
  assert.equal(result.bestHour, 18);
  assert.equal(result.grossPerPassengerHour, 7000);
  assert.equal(result.connectedHours, null);
});

test("null legacy fare components remain absent instead of becoming zero-valued components", () => {
  const breakdown = readTripBreakdown({
    amount: 6000,
    detail_verified: true,
    fare_breakdown: {
      distance_ars: 2900,
      time_ars: 1600,
      wait_ars: null,
      dynamic_base_ars: 1500,
      differential_price_ars: null,
      fare_reimbursement_ars: null
    }
  });
  assert.equal(breakdown.status, "verified");
  assert.deepEqual(breakdown.components.map((item) => item.code), [
    "distancia", "tiempo", "base_dinamica"
  ]);
});

test("live 14 November fare component counts reflect observed non-null detail lines", () => {
  const trips = [
    { date:"2026-11-14", start:"17:44", amount:6000, detail_verified:true, fare_breakdown:{distance_ars:2900,time_ars:1600,wait_ars:null,dynamic_base_ars:1500,differential_price_ars:null,fare_reimbursement_ars:null} },
    { date:"2026-11-14", start:"18:02", amount:6400, detail_verified:true, fare_breakdown:{distance_ars:3000,time_ars:1900,wait_ars:null,dynamic_base_ars:900,differential_price_ars:600,fare_reimbursement_ars:null} },
    { date:"2026-11-14", start:"19:56", amount:7600, detail_verified:true, fare_breakdown:{distance_ars:3300,time_ars:1600,wait_ars:200,dynamic_base_ars:1800,differential_price_ars:700,fare_reimbursement_ars:null} },
    { date:"2026-11-14", start:"20:54", amount:3900, detail_verified:true, fare_breakdown:{distance_ars:500,time_ars:900,wait_ars:100,dynamic_base_ars:1000,differential_price_ars:1400,fare_reimbursement_ars:null} },
    { date:"2026-11-14", start:"21:43", amount:4400, detail_verified:true, fare_breakdown:{distance_ars:1100,time_ars:1200,wait_ars:100,dynamic_base_ars:1000,differential_price_ars:700,fare_reimbursement_ars:300} },
    { date:"2026-11-14", start:"22:25", amount:6400, detail_verified:false, fare_breakdown:{distance_ars:1900,time_ars:2600,wait_ars:null,dynamic_base_ars:1000,differential_price_ars:null,fare_reimbursement_ars:null} }
  ];
  const result=buildDataFina({trips,rewards:[],fuel:[],from:"2026-11-14",to:"2026-11-14"});
  const counts=Object.fromEntries(result.components.map((item)=>[item.code,item.trips]));
  assert.equal(counts.distancia,5);
  assert.equal(counts.tiempo,5);
  assert.equal(counts.espera,3);
  assert.equal(counts.base_dinamica,5);
  assert.equal(counts.diferencial,4);
  assert.equal(counts.reembolso_tarifario,1);
});

test("per-hour and per-km rates use only trip gross with matching observed duration or km coverage", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-14", start: "18:00", amount: 1000, km: 2, km_source: "actual", min: 10, duration_seconds: 600 },
      { date: "2026-11-14", start: "19:00", amount: 4000, km: 0, km_source: "unknown", min: 0 }
    ],
    rewards: [],
    fuel: [],
    dailyGoal: 80000
  });
  assert.equal(result.gross, 5000);
  assert.equal(result.durationCoveredGross, 1000);
  assert.equal(result.actualKmGross, 1000);
  assert.equal(result.grossPerPassengerHour, 6000);
  assert.equal(result.grossPerKm, 500);
});

test("withdrawal fees reduce cash net only for the selected dates and are reported separately", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-14", start: "18:00", amount: 10000, min: 10 }],
    rewards: [{ date: "2026-11-14", amount: 500 }],
    fuel: [{ date: "2026-11-14", total_ars: 1000 }],
    withdrawalFees: [
      { date: "2026-11-14", amount_ars: 500 },
      { date: "2026-11-01", amount_ars: 500 },
      { date: null, amount_ars: 500 }
    ],
    from: "2026-11-14",
    to: "2026-11-14"
  });
  assert.equal(result.withdrawalFeeSpend, 500);
  assert.equal(result.cashNet, 9000);
});

test("service category coverage exposes classified and unclassified trips without inference", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-14", start: "18:00", amount: 1000, service_type: "Express" },
      { date: "2026-11-14", start: "19:00", amount: 1500, service_type: "Pone tu precio" },
      { date: "2026-11-14", start: "20:00", amount: 2000 }
    ],
    rewards: [], fuel: []
  });
  assert.equal(result.categoryCoverage.classifiedTrips, 2);
  assert.equal(result.categoryCoverage.unclassifiedTrips, 1);
  assert.equal(result.categoryCoverage.coveragePercent, 2 / 3 * 100);
  assert.deepEqual(result.categoryCoverage.byType, [
    { serviceType: "Express", trips: 1, gross: 1000 },
    { serviceType: "Pone tu precio", trips: 1, gross: 1500 }
  ]);
});
