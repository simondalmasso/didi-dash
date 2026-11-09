import test from "node:test";
import assert from "node:assert/strict";
import { normaliseTrip, normaliseFuelLog, normaliseWorkSession } from "../src/domain.mjs";

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
  assert.equal(first.min, 9.9);
  assert.equal(first.platform, "didi");
  assert.match(first.id, /^[a-f0-9]{64}$/);
  assert.equal(first.id, second.id);
});

test("normaliseTrip rejects impossible dates, negative amounts and address-like zones", async () => {
  await assert.rejects(() => normaliseTrip({
    date: "2026-02-30", start: "09:10", amount: 2300, km: 2, min: 5, platform: "didi"
  }), /date/i);

  await assert.rejects(() => normaliseTrip({
    date: "2026-11-03", start: "09:10", amount: -1, km: 2, min: 5, platform: "didi"
  }), /amount/i);

  await assert.rejects(() => normaliseTrip({
    date: "2026-11-03", start: "09:10", amount: 2300, km: 2, min: 5,
    platform: "didi", origin_zone: "San Martin 1234"
  }), /zone/i);
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
    "amount", "date", "id", "km", "min", "platform", "source", "start"
  ]);
  assert.equal("origin_zone" in trip, false);
  assert.equal("destination_zone" in trip, false);
  assert.equal("passenger_name" in trip, false);
  assert.equal("phone" in trip, false);
});
