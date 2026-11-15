import test from "node:test";
import assert from "node:assert/strict";
import { normaliseTrip, normaliseReward, normaliseFuelLog, normaliseWithdrawal, normaliseWorkSession } from "../src/domain.mjs";

test("normaliseTrip preserves the agreed ingestion contract and generates a deterministic id", async () => {
  const input = {
    date: "2026-11-03",
    start: "17:35",
    amount: 2300,
    km: 2.7,
    min: 9.9,
    platform: "DiDi",
    source: "sentinelx_ocr"
  };

  const first = await normaliseTrip(input);
  const second = await normaliseTrip(input);

  assert.equal(first.date, "2026-11-03");
  assert.equal(first.start, "17:35");
  assert.equal(first.amount, 2300);
  assert.equal(first.km, 2.7);
  assert.equal(first.km_source, "actual");
  assert.equal(first.min, 9.9);
  assert.equal(first.platform, "didi");
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.equal(first.id, second.id);
});

test("normaliseTrip rejects impossible dates and negative amounts", async () => {
  await assert.rejects(() => normaliseTrip({
    date: "2026-02-30", start: "09:10", amount: 2300, km: 2, min: 5, platform: "didi"
  }), /date/i);

  await assert.rejects(() => normaliseTrip({
    date: "2026-11-03", start: "09:10", amount: -1, km: 2, min: 5, platform: "didi"
  }), /amount/i);

});

test("normaliseFuelLog accepts a ticket record without storing payment or personal data", async () => {
  const entry = await normaliseFuelLog({
    date: "2026-11-09",
    odometer_km: 82500,
    liters: 32.4,
    total_ars: 69228,
    station: "YPF",
    full_tank: true
  });

  assert.equal(entry.station, "YPF");
  assert.ok(Math.abs(entry.price_per_liter - 2136.6666666666665) < 1e-9);
  assert.equal(entry.full_tank, 1);
  assert.match(entry.id, /^[a-f0-9]{64}$/);
});

test("normaliseWorkSession requires paired odometer readings and valid connected times", async () => {
  await assert.rejects(() => normaliseWorkSession({
    date: "2026-11-09", platform: "didi", connected_start: "09:00",
    connected_end: "15:00", odometer_start: 82500
  }), /odometer/i);

  const session = await normaliseWorkSession({
    date: "2026-11-09", platform: "didi", connected_start: "09:00",
    connected_end: "15:00", odometer_start: 82500, odometer_end: 82572.4
  });

  assert.ok(Math.abs(session.odometer_km - 72.4) < 1e-8);
  assert.equal(session.connected_minutes, 360);
});


test("normaliseTrip discards location and any unrecognised passenger fields", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-03", start: "17:35", amount: 2300, km: 2.7, min: 9.9,
    platform: "didi", origin_zone: "Centro", destination_zone: "Candioti",
    passenger_name: "Private Passenger", phone: "0000000000"
  });
  assert.deepEqual(Object.keys(trip).sort(), [
    "amount", "date", "id", "km", "km_source", "min", "platform", "source", "start"
  ]);
  assert.equal("origin_zone" in trip, false);
  assert.equal("destination_zone" in trip, false);
  assert.equal("passenger_name" in trip, false);
  assert.equal("phone" in trip, false);
});


test("normaliseReward stores a bonus separately and strips passenger location data", async () => {
  const input = {
    date: "2026-11-06",
    start: "21:33",
    amount: 35000,
    label: "Recompensa",
    source: "sentinelx_ocr",
    passenger_name: "not stored",
    origin_address: "not stored"
  };
  const first = await normaliseReward(input);
  const second = await normaliseReward(input);
  assert.equal(first.date, "2026-11-06");
  assert.equal(first.start, "21:33");
  assert.equal(first.amount, 35000);
  assert.equal(first.label, "Recompensa");
  assert.equal(first.source, "sentinelx_ocr");
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.equal(first.id, second.id);
  assert.equal("passenger_name" in first, false);
  assert.equal("origin_address" in first, false);
});

test("normaliseReward rejects invalid dates, times, and non-positive amounts", async () => {
  await assert.rejects(() => normaliseReward({
    date: "2026-02-30", start: "09:10", amount: 1200
  }), /date/i);
  await assert.rejects(() => normaliseReward({
    date: "2026-11-06", start: "25:10", amount: 1200
  }), /start/i);
  await assert.rejects(() => normaliseReward({
    date: "2026-11-06", start: "09:10", amount: 0
  }), /amount/i);
});


test("normaliseTrip keeps estimated kilometres explicitly separate from actual kilometres", async () => {
  const trip = await normaliseTrip({ date: "2026-11-03", start: "18:10", amount: 1800, km: 4.2, km_source: "estimated", min: 12, platform: "didi" });
  assert.equal(trip.km_source, "estimated");
});

test("normaliseTrip marks zero kilometres as unknown", async () => {
  const trip = await normaliseTrip({ date: "2026-11-03", start: "18:20", amount: 1800, km: 0, min: 0, platform: "didi" });
  assert.equal(trip.km_source, "unknown");
});


test("normaliseFuelLog accepts a dated ticket when the odometer is not known", async () => {
  const row = await normaliseFuelLog({
    date: "2026-11-10",
    odometer_km: null,
    liters: 9.18,
    total_ars: 20000,
    station: "YPF Super",
    full_tank: false
  });
  assert.equal(row.date, "2026-11-10");
  assert.equal(row.odometer_km, null);
  assert.equal(row.liters, 9.18);
  assert.equal(row.total_ars, 20000);
  assert.equal(row.price_per_liter, 20000 / 9.18);
});

test("normaliseFuelLog rejects a cash-only fuel purchase without a date", async () => {
  await assert.rejects(() => normaliseFuelLog({
    id: "fuel-purchase-30k-test",
    date: null,
    odometer_km: null,
    liters: null,
    total_ars: 30000,
    station: null,
    full_tank: false
  }), /date/i);
});


test("work-session generated identity is independent of odometer enrichment", async () => {
  const base = {
    date: "2026-11-06",
    platform: "didi",
    connected_start: "09:00",
    connected_end: "15:00"
  };
  const withoutOdometer = await normaliseWorkSession(base);
  const withOdometer = await normaliseWorkSession({
    ...base,
    odometer_start: 82000,
    odometer_end: 82012.5
  });

  assert.equal(withoutOdometer.id, withOdometer.id);
  assert.equal(withOdometer.odometer_km, 12.5);
});

test("normaliseTrip keeps DiDi fare breakdown, service type and adjustment evidence", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-14", start: "18:02", amount: 6400, km: 7, min: 18 + 37 / 60,
    platform: "didi", source: "didi_history_detail", service_type: "Express",
    fare_breakdown: {
      distance_ars: 3000, time_ars: 1900, wait_ars: null,
      dynamic_base_ars: 900, differential_price_ars: 600,
      fare_reimbursement_ars: null, passenger_name: "must not persist"
    },
    fare_total_ars: 6400, adjusted_from_ars: 6600, earnings_adjusted: true,
    detail_verified: true, passenger_address: "must not persist"
  });
  assert.equal(trip.service_type, "Express");
  assert.deepEqual(trip.fare_breakdown, {
    distance_ars: 3000, time_ars: 1900, wait_ars: null,
    dynamic_base_ars: 900, differential_price_ars: 600,
    fare_reimbursement_ars: null
  });
  assert.equal(trip.fare_total_ars, 6400);
  assert.equal(trip.adjusted_from_ars, 6600);
  assert.equal(trip.earnings_adjusted, true);
  assert.equal(trip.detail_verified, true);
  assert.equal("passenger_name" in trip, false);
  assert.equal("passenger_address" in trip, false);
  assert.equal("passenger_name" in trip.fare_breakdown, false);
});

test("normaliseTrip rejects invalid fare components and non-boolean verification flags", async () => {
  const base = {
    date: "2026-11-14", start: "18:02", amount: 6400,
    km: 7, min: 18, platform: "didi", source: "didi_history_detail"
  };
  await assert.rejects(() => normaliseTrip({
    ...base, fare_breakdown: { distance_ars: -1 }
  }), /fare_breakdown/i);
  await assert.rejects(() => normaliseTrip({
    ...base, detail_verified: "true"
  }), /detail_verified/i);
});
test("normaliseTrip preserves exact DiDi duration seconds independently from rounded minutes", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-14", start: "20:37", amount: 3500, km: 2.5,
    min: 8.4167, duration_seconds: 505, platform: "didi",
    source: "didi_history_detail"
  });
  assert.equal(trip.duration_seconds, 505);
  await assert.rejects(() => normaliseTrip({
    date: "2026-11-14", start: "20:37", amount: 3500, km: 2.5,
    min: 8.4167, duration_seconds: 505.5, platform: "didi"
  }), /duration_seconds/i);
});
test("normaliseTrip accepts the canonical actual breakdown and modality", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-14", start: "20:54", amount: 3900, km: 1.2,
    min: 6.95, duration_seconds: 417, platform: "didi",
    source: "didi_history_detail", modality: "DiDi Express",
    breakdown: {
      source: "actual",
      components: [
        { code: "distancia", label: "Tarifa por distancia", amount: 500 },
        { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
        { code: "espera", label: "Tarifa por espera", amount: 100 },
        { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
        { code: "diferencial", label: "Precio diferencial", amount: 1400 }
      ]
    },
    passenger_name: "must not persist"
  });
  assert.equal(trip.modality, "DiDi Express");
  assert.deepEqual(trip.breakdown, {
    source: "actual",
    components: [
      { code: "distancia", label: "Tarifa por distancia", amount: 500 },
      { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
      { code: "espera", label: "Tarifa por espera", amount: 100 },
      { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
      { code: "diferencial", label: "Precio diferencial", amount: 1400 }
    ]
  });
  assert.equal("passenger_name" in trip, false);
});

test("normaliseTrip discards a non-reconciling breakdown but retains the trip for review", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-14", start: "22:25", amount: 6400, km: 4.8,
    min: 11.9167, duration_seconds: 715, platform: "didi",
    source: "didi_history_detail",
    breakdown: {
      source: "actual",
      components: [
        { code: "distancia", label: "Tarifa por distancia", amount: 1900 },
        { code: "tiempo", label: "Tarifa por tiempo", amount: 2600 },
        { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 }
      ]
    }
  });
  assert.equal(trip.amount, 6400);
  assert.equal("breakdown" in trip, false);
  assert.equal(trip.breakdown_status, "review");
  assert.equal(trip.detail_verified, false);
});

test("normaliseTrip groups unknown component codes as otro and rejects estimated breakdown sources", async () => {
  const trip = await normaliseTrip({
    date: "2026-11-14", start: "18:00", amount: 1000, km: 1,
    min: 2, platform: "didi",
    breakdown: {
      source: "actual",
      components: [{ code: "unknown_screen_line", label: "Ajuste de tarifa", amount: 1000 }]
    }
  });
  assert.equal(trip.breakdown.components[0].code, "otro");
  assert.equal(trip.breakdown.components[0].label, "Ajuste de tarifa");
  await assert.rejects(() => normaliseTrip({
    date: "2026-11-14", start: "18:00", amount: 1000, km: 1,
    min: 2, platform: "didi",
    breakdown: { source: "estimated", components: [{ code: "distancia", amount: 1000 }] }
  }), /breakdown\.source/i);
});


test("normaliseWithdrawal stores only financial evidence and never treats principal as a fee", async () => {
  const row = await normaliseWithdrawal({
    date: "2026-11-15", amount_ars: 50000, fee_ars: 0, reconciled: true,
    source: "didi_wallet", bank_account: "must not persist"
  });
  assert.equal(row.amount_ars, 50000);
  assert.equal(row.fee_ars, 0);
  assert.equal(row.reconciled, true);
  assert.equal("bank_account" in row, false);
  await assert.rejects(() => normaliseWithdrawal({
    date: "2026-02-30", amount_ars: 1, fee_ars: 0
  }), /date/i);
});
