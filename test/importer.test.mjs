import assert from "node:assert/strict";
import test from "node:test";
import { buildImportPayload, parseImportJson } from "../public/importer.mjs";

test("import parser accepts a structured backup and whitelists server records", () => {
  const source = JSON.stringify({
    schema_version: 2,
    trips: [{
      id: "trip-1", date: "2026-11-13", start: "20:33", amount: 5100,
      km: 5.8, km_source: "actual", min: 15.9, duration_seconds: 954, platform: "didi",
      source: "didi_history_detail", service_type: "Express",
      fare_breakdown: { distance_ars: 2600, time_ars: 1500, wait_ars: 100, dynamic_base_ars: 700, differential_price_ars: 200, fare_reimbursement_ars: null, passenger_name: "private" },
      fare_total_ars: 5100, adjusted_from_ars: 5200, earnings_adjusted: true, detail_verified: true,
      passenger_name: "private", pickup_address: "private"
    }],
    rewards: [{ id: "reward-1", date: "2026-11-13", start: "16:00", amount: 1100, label: "Reembolso", source: "didi_history", phone: "private" }],
    fuel: [{ id: "fuel-1", date: "2026-11-13", total_ars: 30000, station: "YPF", card_number: "private" }],
    sessions: [{ id: "session-1", date: "2026-11-13", platform: "didi", connected_start: "08:00", connected_end: "16:00", odometer_start: 82000, odometer_end: 82035, passenger_name: "private" }],
    local_operating_settings: { monthlyCosts: { insurance: 1 }, vehicleSessions: [{ id: "local-1", date: "2026-11-14", platform: "didi", connected_start: "09:00", connected_end: "12:00", odometer_start: 82035, odometer_end: 82050, private_note: "private" }] }
  });
  const parsed = parseImportJson(source);
  const payload = buildImportPayload(parsed);

  assert.deepEqual(Object.keys(payload).sort(), ["fuel", "rewards", "sessions", "trips"]);
  assert.deepEqual(payload.trips[0], {
    id: "trip-1", date: "2026-11-13", start: "20:33", amount: 5100,
    km: 5.8, km_source: "actual", min: 15.9, duration_seconds: 954, platform: "didi", source: "didi_history_detail",
    service_type: "Express",
    fare_breakdown: { distance_ars: 2600, time_ars: 1500, wait_ars: 100, dynamic_base_ars: 700, differential_price_ars: 200, fare_reimbursement_ars: null },
    fare_total_ars: 5100, adjusted_from_ars: 5200, earnings_adjusted: true, detail_verified: true
  });
  assert.deepEqual(payload.rewards[0], {
    id: "reward-1", date: "2026-11-13", start: "16:00", amount: 1100,
    label: "Reembolso", source: "didi_history"
  });
  assert.deepEqual(payload.fuel[0], { id: "fuel-1", date: "2026-11-13", total_ars: 30000, station: "YPF" });
  assert.deepEqual(payload.sessions[0], {
    id: "session-1", date: "2026-11-13", platform: "didi",
    connected_start: "08:00", connected_end: "16:00",
    odometer_start: 82000, odometer_end: 82035
  });
  assert.equal(JSON.stringify(payload).includes("private"), false);
  assert.equal(payload.sessions.some((row) => row.id === "local-1"), false);
});

test("local browser sessions are opt-in and deduplicated against imported sessions", () => {
  const parsed = {
    sessions: [{ id: "remote-1", date: "2026-11-13", platform: "didi", connected_start: "08:00", connected_end: "16:00" }],
    local_operating_settings: {
      vehicleSessions: [
        { id: "local-duplicate", date: "2026-11-13", platform: "DiDi", connected_start: "08:00", connected_end: "16:00", odometer_start: 82000, odometer_end: 82035 },
        { id: "local-new", date: "2026-11-14", platform: "didi", connected_start: "09:00", connected_end: "12:00", odometer_start: 82035, odometer_end: 82050 }
      ]
    }
  };
  const defaultPayload = buildImportPayload(parsed);
  const optInPayload = buildImportPayload(parsed, { includeLocalSessions: true });

  assert.equal(defaultPayload.sessions.length, 1);
  assert.equal(optInPayload.sessions.length, 2);
  assert.equal(optInPayload.sessions[1].id, "local-new");
  assert.equal(optInPayload.sessions[1].odometer_end, 82050);
});

test("parser accepts the legacy bare trips array but rejects malformed or unsupported input", () => {
  assert.deepEqual(parseImportJson('[{"date":"2026-11-13"}]'), [{ date: "2026-11-13" }]);
  assert.throws(() => parseImportJson("{"), /JSON válido/i);
  assert.throws(() => parseImportJson("null"), /objeto JSON|array de viajes/i);
  assert.throws(() => parseImportJson('{"trips":{}}'), /trips debe ser un array/i);
});

test("fuel import fails closed when the purchase date is missing or invalid", () => {
  for (const row of [
    { id: "undated", date: null, total_ars: 30000 },
    { id: "missing-date", total_ars: 30000 },
    { id: "invalid-date", date: "2026-02-30", total_ars: 30000 }
  ]) {
    assert.throws(() => buildImportPayload({ fuel: [row] }), /fecha válida/i);
  }
});

test("truncated exports are rejected before an import payload can be built", () => {
  const parsed = { trips: [], rewards: [], fuel: [], sessions: [], truncated: { trips: true } };
  assert.throws(() => buildImportPayload(parsed), /truncado/i);
});

test("missing local session collection fails closed when local-session import is selected", () => {
  assert.throws(() => buildImportPayload({ trips: [] }, { includeLocalSessions: true }), /vehicleSessions/i);
});

test("importer whitelists canonical breakdown components and modality", () => {
  const payload = buildImportPayload({
    trips: [{
      date: "2026-11-14", start: "20:54", amount: 3900,
      km: 1.2, km_source: "actual", min: 6.95, duration_seconds: 417,
      platform: "didi", source: "didi_history_detail",
      modality: "DiDi Express",
      breakdown: {
        source: "actual",
        components: [
          { code: "distancia", label: "Tarifa por distancia", amount: 500, passenger_name: "private" },
          { code: "tiempo", label: "Tarifa por tiempo", amount: 900, address: "private" },
          { code: "espera", label: "Tarifa por espera", amount: 100 },
          { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
          { code: "diferencial", label: "Precio diferencial", amount: 1400 }
        ],
        passenger_phone: "private"
      },
      unknown_top_level: "private"
    }]
  });
  assert.equal(payload.trips[0].modality, "DiDi Express");
  assert.deepEqual(payload.trips[0].breakdown, {
    source: "actual",
    components: [
      { code: "distancia", label: "Tarifa por distancia", amount: 500 },
      { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
      { code: "espera", label: "Tarifa por espera", amount: 100 },
      { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
      { code: "diferencial", label: "Precio diferencial", amount: 1400 }
    ]
  });
  assert.equal(JSON.stringify(payload).includes("private"), false);
});
