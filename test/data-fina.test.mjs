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
      { date: "2026-11-14", amount_ars: 50000, fee_ars: 500, reconciled: true },
      { date: "2026-11-01", amount_ars: 50000, fee_ars: 500, reconciled: true },
      { date: null, amount_ars: 50000, fee_ars: 500, reconciled: true }
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

test("missing withdrawal evidence remains null while cash arithmetic marks its zero-fee assumption", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-15", amount: 1000 }], rewards: [], fuel: [], withdrawalFees: []
  });
  assert.equal(result.withdrawalEvidence, false);
  assert.equal(result.withdrawalFeeSpend, null);
  assert.equal(result.withdrawalFeeCount, null);
  assert.equal(result.withdrawalRecordCount, 0);
  assert.equal(result.cashNet, 1000);
  assert.equal(result.cashNetAssumesZeroWithdrawalFees, true);
});

test("withdrawal principal is never treated as a fee", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-15", amount: 1000 }], rewards: [], fuel: [],
    withdrawalFees: [{ date: "2026-11-15", amount_ars: 900, fee_ars: 0, reconciled: true }]
  });
  assert.equal(result.withdrawalEvidence, true);
  assert.equal(result.withdrawalFeeSpend, 0);
  assert.equal(result.cashNet, 1000);
});

test("operational time bands use duration-covered gross and duration for the same trips", () => {
  const trips = [];
  const makeBand = (startHours, totalTrips, knownTrips, grossPerHour) => {
    const start = startHours[0];
    for (let i = 0; i < totalTrips; i += 1) {
      const known = i < knownTrips;
      trips.push({
        date: i % 2 ? "2026-11-14" : "2026-11-13",
        start: String(start).padStart(2, "0") + ":" + String(i % 2 ? 30 : 10).padStart(2, "0"),
        amount: known ? (i === 0 ? Math.round(grossPerHour) : 0) : 9000,
        duration_seconds: known ? (i === 0 ? 3600 - (knownTrips - 1) : 1) : null,
        min: known ? (i === 0 ? (3600 - (knownTrips - 1)) / 60 : 1 / 60) : 0
      });
    }
  };
  makeBand([18, 19], 70, 66, 22003);
  makeBand([20, 21], 10, 9, 26026);
  makeBand([22, 23], 5, 4, 26405);
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  const byLabel = Object.fromEntries(result.timeBands.map((band) => [band.label, band]));
  assert.equal(byLabel["18–20"].tripCount, 70);
  assert.equal(byLabel["18–20"].durationTrips, 66);
  assert.ok(Math.abs(byLabel["18–20"].coveragePercent - 66 / 70 * 100) < 0.001);
  assert.equal(byLabel["18–20"].grossPerPassengerHour, 22003);
  assert.equal(byLabel["20–22"].tripCount, 10);
  assert.equal(byLabel["20–22"].durationTrips, 9);
  assert.equal(byLabel["20–22"].grossPerPassengerHour, 26026);
  assert.equal(byLabel["20–22"].ranked, true);
  assert.equal(byLabel["22–24"].tripCount, 5);
  assert.equal(byLabel["22–24"].durationTrips, 4);
  assert.equal(byLabel["22–24"].coveragePercent, 80);
  assert.equal(byLabel["22–24"].grossPerPassengerHour, 26405);
  assert.equal(byLabel["22–24"].ranked, false);
  assert.equal(result.connectedHours, null);
});

test("time-band hourly rate stays null when duration coverage is absent", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-03", start: "18:10", amount: 10000, min: 0 }],
    rewards: [], fuel: []
  });
  assert.equal(result.timeBands.find((x) => x.label === "18–20").grossPerPassengerHour, null);
  assert.equal(result.timeBands.find((x) => x.label === "18–20").ranked, false);
});


test("work totals merge active trip dates with recorded work sessions without double-counting days", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-14", start: "18:00", amount: 1000, min: 30 },
      { date: "2026-11-13", start: "19:00", amount: 1000, min: 15 }
    ],
    sessions: [
      { date: "2026-11-14", connected_minutes: 90 },
      { date: "2026-11-12", connected_minutes: 120 },
      { date: "2026-11-11", connected_minutes: 60 },
      { date: "2026-11-12", connected_minutes: 0 }
    ],
    rewards: [],
    fuel: [],
    from: "2026-11-12",
    to: "2026-11-14"
  });

  assert.equal(result.workDays, 3);
  assert.equal(result.workSessionCount, 2);
  assert.equal(result.connectedMinutes, 210);
  assert.equal(result.connectedHours, 3.5);
  assert.equal(result.activeDays, 2);
  assert.equal(result.passengerHours, 0.75);
});

test("work-hour total stays unknown when no connected work sessions are recorded", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-14", start: "18:00", amount: 1000, min: 10 }],
    sessions: [],
    rewards: [],
    fuel: []
  });

  assert.equal(result.workDays, 1);
  assert.equal(result.workSessionCount, 0);
  assert.equal(result.connectedMinutes, 0);
  assert.equal(result.connectedHours, null);
  assert.equal(result.passengerHours, 10 / 60);
});


test("recorded work sessions count once when a local session is also present in the synced ledger", () => {
  const synced = {
    id: "server-session-1",
    date: "2026-11-14",
    platform: "didi",
    connected_start: "17:00",
    connected_end: "18:30",
    connected_minutes: 90,
    odometer_start: 1000,
    odometer_end: 1010,
    odometer_km: 10
  };
  const localCopy = {
    ...synced,
    id: "local-session-1",
    odometer_start: null,
    odometer_end: null,
    odometer_km: null
  };
  const result = buildDataFina({
    trips: [],
    sessions: [synced, localCopy],
    rewards: [],
    fuel: []
  });

  assert.equal(result.workDays, 1);
  assert.equal(result.workSessionCount, 1);
  assert.equal(result.connectedMinutes, 90);
  assert.equal(result.connectedHours, 1.5);
});

test("weekday intelligence uses recorded trip dates and refuses to rank fewer than three active dates", () => {
  const trips = [
    { date: "2026-11-07", start: "18:10", amount: 1000, duration_seconds: 600 },
    { date: "2026-11-07", start: "19:10", amount: 1000, duration_seconds: 600 },
    { date: "2026-11-14", start: "18:10", amount: 1000, duration_seconds: 600 },
    { date: "2026-11-14", start: "19:10", amount: 1000, duration_seconds: 600 },
    { date: "2026-11-21", start: "18:10", amount: 1000, duration_seconds: 600 }
  ];
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  const saturday = result.weekdays.find((row) => row.day === 6);

  assert.equal(saturday.tripCount, 5);
  assert.equal(saturday.dateCount, 3);
  assert.equal(saturday.durationTrips, 5);
  assert.equal(saturday.coveragePercent, 100);
  assert.equal(saturday.grossPerPassengerHour, 6000);
  assert.equal(saturday.ranked, true);
});

test("weekday with only two active dates remains descriptive even with full duration coverage", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-07", start: "18:10", amount: 1000, duration_seconds: 600 },
      { date: "2026-11-07", start: "19:10", amount: 1000, duration_seconds: 600 },
      { date: "2026-11-14", start: "18:10", amount: 1000, duration_seconds: 600 },
      { date: "2026-11-14", start: "19:10", amount: 1000, duration_seconds: 600 },
      { date: "2026-11-14", start: "20:10", amount: 1000, duration_seconds: 600 }
    ],
    rewards: [], fuel: []
  });
  const saturday = result.weekdays.find((row) => row.day === 6);
  assert.equal(saturday.coveragePercent, 100);
  assert.equal(saturday.ranked, false);
  assert.match(saturday.reason, /3 fechas/);
});

test("operational time bands cover madrugada, mañana, tarde and split night using matched duration samples", () => {
  const trips = [];
  const starts = ["01:10", "07:10", "13:10", "18:10", "20:10", "22:10"];
  for (const date of ["2026-11-13", "2026-11-14"]) {
    for (const start of starts) {
      for (let i = 0; i < 3; i += 1) {
        trips.push({ date, start, amount: 1000, duration_seconds: 600 });
      }
    }
  }
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  assert.deepEqual(result.timeBands.map((row) => row.label), [
    "00–06", "06–12", "12–18", "18–20", "20–22", "22–24"
  ]);
  assert.equal(result.timeBands.every((row) => row.ranked), true);
  assert.equal(result.timeBands.find((row) => row.label === "06–12").grossPerPassengerHour, 6000);
});

test("trip-distance intelligence uses actual kilometres only and keeps insufficient long-trip coverage unranked", () => {
  const trips = [];
  for (const date of ["2026-11-13", "2026-11-14"]) {
    for (let i = 0; i < 5; i += 1) {
      trips.push({ date, start: "18:10", amount: 1000, km: 2, km_source: "actual", duration_seconds: 600 });
      trips.push({ date, start: "19:10", amount: 1000, km: 5, km_source: "actual", duration_seconds: 600 });
      trips.push({ date, start: "20:10", amount: 1000, km: 10, km_source: "actual", duration_seconds: i < 4 ? 600 : null });
    }
    trips.push({ date, start: "21:10", amount: 9000, km: 2, km_source: "estimated", duration_seconds: 600 });
    trips.push({ date, start: "22:10", amount: 9000, km: null, km_source: "unknown", duration_seconds: 600 });
  }
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  const short = result.distanceBands.find((row) => row.key === "short");
  const medium = result.distanceBands.find((row) => row.key === "medium");
  const long = result.distanceBands.find((row) => row.key === "long");

  assert.equal(short.tripCount, 10);
  assert.equal(short.grossPerKm, 500);
  assert.equal(short.ranked, true);
  assert.equal(medium.ranked, true);
  assert.equal(long.tripCount, 10);
  assert.equal(long.coveragePercent, 80);
  assert.equal(long.ranked, false);
  assert.equal(result.distanceCoverage.actualKmTrips, 30);
  assert.equal(result.distanceCoverage.unknownOrEstimatedTrips, 4);
});


test("invalid or missing start times remain unassigned in hourly intelligence", () => {
  const result = buildDataFina({
    trips: [
      { date: "2026-11-14", start: "08:10", amount: 1000, duration_seconds: 600 },
      { date: "2026-11-14", start: "08:bad", amount: 2000, duration_seconds: 600 },
      { date: "2026-11-14", start: null, amount: 3000, duration_seconds: 600 }
    ],
    rewards: [], fuel: []
  });
  assert.equal(result.hours[8].gross, 1000);
  assert.equal(result.timeBands.find((row) => row.label === "06–12").tripCount, 1);
  assert.equal(result.unassignedStartTimeTrips, 2);
  assert.equal(result.unassignedStartTimeGross, 5000);
  assert.equal(result.hours.reduce((sum, row) => sum + row.gross, 0), 1000);
});

test("weekly prime-time matrix contains all seven weekdays and keeps low-coverage cells unranked", () => {
  const trips = [];
  for (const date of ["2026-11-13", "2026-11-20"]) {
    for (let i = 0; i < 3; i += 1) {
      trips.push({ date, start: "19:10", amount: 1000, duration_seconds: 600 });
    }
  }
  trips.push({ date: "2026-11-20", start: "22:10", amount: 9000, duration_seconds: null });
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  assert.equal(result.weekdayPrimeBands.length, 7);
  const friday = result.weekdayPrimeBands.find((row) => row.day === 5);
  const evening = friday.bands.find((row) => row.key === "19-22");
  assert.equal(evening.tripCount, 6);
  assert.equal(evening.durationTrips, 6);
  assert.equal(evening.coveragePercent, 100);
  assert.equal(evening.ranked, true);
  const late = friday.bands.find((row) => row.key === "22-24");
  assert.equal(late.tripCount, 1);
  assert.equal(late.ranked, false);
  assert.match(late.reason, /5 viajes/);
});

test("distance recommendation prefers only eligible distance bands and labels its rate as gross passenger-hour", () => {
  const trips = [];
  for (const date of ["2026-11-13", "2026-11-14"]) {
    for (let i = 0; i < 5; i += 1) {
      trips.push({ date, start: "18:10", amount: 1200, km: 2, km_source: "actual", duration_seconds: 600 });
      trips.push({ date, start: "19:10", amount: 1000, km: 5, km_source: "actual", duration_seconds: 600 });
      trips.push({ date, start: "20:10", amount: 1800, km: 10, km_source: "actual", duration_seconds: i < 4 ? 600 : null });
    }
  }
  const result = buildDataFina({ trips, rewards: [], fuel: [] });
  assert.equal(result.distanceRecommendation.status, "ranked");
  assert.equal(result.distanceRecommendation.preferred.key, "short");
  assert.equal(result.distanceRecommendation.alternative.key, "medium");
  assert.equal(result.distanceRecommendation.metric, "grossPerPassengerHour");
  assert.equal(result.distanceRecommendation.excluded.length, 1);
  assert.equal(result.distanceRecommendation.excluded[0].key, "long");
  assert.equal(result.distanceRecommendation.excluded[0].ranked, false);
});

test("distance recommendation stays insufficient when fewer than two distance bands qualify", () => {
  const result = buildDataFina({
    trips: [{ date: "2026-11-14", start: "18:10", amount: 1000, km: 2, km_source: "actual", duration_seconds: 600 }],
    rewards: [], fuel: []
  });
  assert.equal(result.distanceRecommendation.status, "insufficient");
  assert.equal(result.distanceRecommendation.preferred, null);
});
