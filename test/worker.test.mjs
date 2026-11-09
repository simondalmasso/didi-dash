import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function memoryKV(initial = null) {
  let stored = clone(initial);
  const calls = [];
  return {
    calls,
    async get(key, type) {
      calls.push({ method: "get", key, type });
      assert.equal(key, "ledger:v1");
      return clone(stored);
    },
    async put(key, value, options) {
      calls.push({ method: "put", key, options });
      assert.equal(key, "ledger:v1");
      stored = JSON.parse(value);
    },
    value() {
      return clone(stored);
    }
  };
}

function apiRequest(path, { method = "GET", headers = {}, body } = {}) {
  return new Request("https://didi-dash.example.workers.dev" + path, {
    method,
    headers,
    body
  });
}

function jsonHeaders(extra = {}) {
  return { "content-type": "application/json", ...extra };
}

function bearer(token = "i".repeat(64)) {
  return { authorization: "Bearer " + token };
}

const INGEST_TOKEN = "i".repeat(64);

test("health endpoint identifies the dedicated KV store", async () => {
  const response = await worker.fetch(apiRequest("/api/health"), { DATA: memoryKV() });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    ok: true, service: "didi-dash", storage: "kv"
  });
});

test("trip reads are public and return sanitized records without a session", async () => {
  const trip = {
    id: "trip-1", date: "2026-11-06", start: "09:10",
    amount: 2300, km: 2.5, min: 8, platform: "didi", source: "sentinelx_ocr"
  };
  const DATA = memoryKV({ trips: [trip], rewards: [], fuel: [], sessions: [] });
  const response = await worker.fetch(apiRequest("/api/trips"), { DATA });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).trips, [trip]);
});

test("trip reads filter by date range and platform", async () => {
  const DATA = memoryKV({
    trips: [
      { id: "a", date: "2026-11-03", start: "09:00", platform: "didi" },
      { id: "b", date: "2026-11-04", start: "10:00", platform: "uber" },
      { id: "c", date: "2026-11-05", start: "11:00", platform: "didi" }
    ],
    rewards: [], fuel: [], sessions: []
  });
  const response = await worker.fetch(
    apiRequest("/api/trips?from=2026-11-04&to=2026-11-05&platform=didi"),
    { DATA }
  );
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body.trips.map((row) => row.id), ["c"]);
});

test("reward reads are public and isolated from ride records", async () => {
  const reward = {
    id: "reward-1", date: "2026-11-06", start: "21:33",
    amount: 35000, label: "Recompensa", source: "sentinelx_ocr"
  };
  const DATA = memoryKV({ trips: [], rewards: [reward], fuel: [], sessions: [] });
  const response = await worker.fetch(apiRequest("/api/rewards"), { DATA });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).rewards, [reward]);
});

test("fuel and work-session reads are public", async () => {
  const fuelRow = { id: "fuel-1", date: "2026-11-06", total_ars: 70000 };
  const session = { id: "session-1", date: "2026-11-06", connected_minutes: 360 };
  const DATA = memoryKV({ trips: [], rewards: [], fuel: [fuelRow], sessions: [session] });
  const fuel = await worker.fetch(apiRequest("/api/fuel"), { DATA });
  const sessions = await worker.fetch(apiRequest("/api/sessions"), { DATA });
  assert.deepEqual((await fuel.json()).fuel, [fuelRow]);
  assert.deepEqual((await sessions.json()).sessions, [session]);
});

test("public JSON backup includes every ledger category without authentication", async () => {
  const DATA = memoryKV({
    trips: [{ id: "t" }], rewards: [{ id: "r" }],
    fuel: [{ id: "f" }], sessions: [{ id: "s" }]
  });
  const response = await worker.fetch(apiRequest("/api/export"), { DATA });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema_version, 2);
  assert.deepEqual(body.trips, [{ id: "t" }]);
  assert.deepEqual(body.rewards, [{ id: "r" }]);
  assert.deepEqual(body.fuel, [{ id: "f" }]);
  assert.deepEqual(body.sessions, [{ id: "s" }]);
  assert.deepEqual(body.truncated, {
    trips: false, rewards: false, fuel: false, sessions: false
  });
  assert.match(response.headers.get("content-disposition"), /didi-dash-backup\.json/);
});

test("ingestion rejects requests without the separate bearer token", async () => {
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ trips: [{ date: "2026-11-06" }] })
  }), { INGEST_TOKEN, DATA: memoryKV() });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "request_rejected");
});

test("ingestion rejects invalid tokens and malformed content types", async () => {
  const DATA = memoryKV();
  const badToken = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer("wrong")),
    body: JSON.stringify({ trips: [{ date: "2026-11-06" }] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(badToken.status, 401);

  const badContentType = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: bearer(),
    body: "{}"
  }), { INGEST_TOKEN, DATA });
  assert.equal(badContentType.status, 415);
});

test("trusted ingestion stores trips, deduplicates and counts repeated trips once", async () => {
  const DATA = memoryKV();
  const trip = {
    date: "2026-11-03", start: "17:35", amount: 2300,
    km: 2.7, min: 9.9, platform: "didi"
  };
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [trip, trip] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.trips, { received: 2, inserted: 1, updated: 0, duplicates: 1, ambiguous: 0 });
  assert.equal(body.inserted, 1);
  assert.equal(DATA.value().trips.length, 1);
});

test("trusted ingestion stores rewards separately and discards passenger/location fields", async () => {
  const DATA = memoryKV();
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({
      trips: [{
        date: "2026-11-06", start: "21:30", amount: 5900,
        km: 3.1, min: 8.5, platform: "didi",
        passenger_name: "not persisted", pickup_address: "not persisted"
      }],
      rewards: [{
        date: "2026-11-06", start: "21:33", amount: 35000,
        label: "Recompensa", passenger_name: "not persisted",
        pickup_address: "not persisted"
      }]
    })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.trips.inserted, 1);
  assert.equal(body.rewards.inserted, 1);
  assert.equal(DATA.value().trips[0].amount, 5900);
  assert.equal(DATA.value().rewards[0].amount, 35000);
  assert.equal("passenger_name" in DATA.value().trips[0], false);
  assert.equal("pickup_address" in DATA.value().rewards[0], false);
});

test("trusted ingestion stores fuel tickets and work sessions in separate collections", async () => {
  const DATA = memoryKV();
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({
      fuel: [{
        date: "2026-11-06", odometer_km: 82500,
        liters: 32, total_ars: 68000, station: "YPF", full_tank: true
      }],
      sessions: [{
        date: "2026-11-06", platform: "didi",
        connected_start: "09:00", connected_end: "15:00"
      }]
    })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.fuel.inserted, 1);
  assert.equal(body.sessions.inserted, 1);
  assert.equal(DATA.value().fuel.length, 1);
  assert.equal(DATA.value().sessions[0].connected_minutes, 360);
});

test("ingestion is idempotent across separate requests", async () => {
  const DATA = memoryKV();
  const trip = {
    date: "2026-11-03", start: "17:35", amount: 2300,
    km: 2.7, min: 9.9, platform: "didi"
  };
  for (let i = 0; i < 2; i += 1) {
    await worker.fetch(apiRequest("/api/ingest", {
      method: "POST",
      headers: jsonHeaders(bearer()),
      body: JSON.stringify({ trips: [trip] })
    }), { INGEST_TOKEN, DATA });
  }
  assert.equal(DATA.value().trips.length, 1);
});

test("browser write methods are rejected on all public dashboard routes", async () => {
  for (const path of ["/api/trips", "/api/rewards", "/api/fuel", "/api/sessions", "/api/export"]) {
    const response = await worker.fetch(apiRequest(path, {
      method: "POST",
      headers: jsonHeaders({ origin: "https://didi-dash.example.workers.dev" }),
      body: "{}"
    }), { INGEST_TOKEN, DATA: memoryKV() });
    assert.equal(response.status, 405, path);
  }
});

test("ingestion refuses more than 500 combined records", async () => {
  const DATA = memoryKV();
  const trips = Array.from({ length: 501 }, (_, i) => ({
    date: "2026-11-03", start: "17:35", amount: 1000 + i,
    km: 1, min: 5, platform: "didi"
  }));
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 400);
  assert.equal(DATA.value(), null);
});

test("invalid routes return 404 and missing KV returns 503", async () => {
  const missingStorage = await worker.fetch(apiRequest("/api/trips"), {});
  assert.equal(missingStorage.status, 503);
  const notFound = await worker.fetch(apiRequest("/api/nope"), { DATA: memoryKV() });
  assert.equal(notFound.status, 404);
});


test("re-ingesting a ride with newly captured detail enriches the existing row instead of duplicating it", async () => {
  const DATA = memoryKV();
  const summary = { date: "2026-11-03", start: "17:35", amount: 2300, km: 0, min: 0, platform: "didi", source: "didi_history" };
  const detail = { ...summary, km: 2.7, km_source: "actual", min: 9.9, source: "didi_history_detail" };

  const first = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [summary] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(first.status, 201);
  const originalId = DATA.value().trips[0].id;

  const second = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(second.status, 201);
  assert.deepEqual((await second.json()).trips, { received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0 });
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].id, originalId);
  assert.equal(DATA.value().trips[0].km, 2.7);
  assert.equal(DATA.value().trips[0].km_source, "actual");
  assert.equal(DATA.value().trips[0].min, 9.9);

  const third = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await third.json()).trips, { received: 1, inserted: 0, updated: 0, duplicates: 1, ambiguous: 0 });
  assert.equal(DATA.value().trips.length, 1);
});

test("ambiguous trip identity never merges or inserts an enriched ride silently", async () => {
  const base = { date: "2026-11-03", start: "17:35", amount: 2300, min: 0, platform: "didi" };
  const DATA = memoryKV({
    trips: [
      { id: "legacy-1", ...base, km: 0, source: "didi_history" },
      { id: "legacy-2", ...base, km: 0.5, km_source: "estimated", source: "route_estimate" }
    ],
    rewards: [], fuel: [], sessions: []
  });

  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [{ ...base, km: 2.7, km_source: "actual", min: 9.9 }] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).trips, { received: 1, inserted: 0, updated: 0, duplicates: 0, ambiguous: 1 });
  assert.equal(DATA.value().trips.length, 2);
});


test("actual trip kilometres are never downgraded by a later route estimate", async () => {
  const DATA = memoryKV();
  const actual = { date: "2026-11-04", start: "10:20", amount: 2100, km: 3.4, km_source: "actual", min: 11, platform: "didi" };
  const estimated = { ...actual, km: 4.1, km_source: "estimated", source: "route_estimate" };
  for (const trip of [actual, estimated]) {
    await worker.fetch(apiRequest("/api/ingest", {
      method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [trip] })
    }), { INGEST_TOKEN, DATA });
  }
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].km, 3.4);
  assert.equal(DATA.value().trips[0].km_source, "actual");
});
