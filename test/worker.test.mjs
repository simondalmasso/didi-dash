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


test("detail amount corrections enrich the uniquely identified ride instead of inserting duplicates", async () => {
  const DATA = memoryKV();
  const summary = { date: "2026-11-07", start: "22:09", amount: 5100, km: 0, min: 0, platform: "didi", source: "didi_history" };
  const detail = { ...summary, amount: 4800, km: 3.8, km_source: "actual", min: 8 + 53/60, source: "didi_history_detail" };
  await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [summary] })
  }), { INGEST_TOKEN, DATA });
  const originalId = DATA.value().trips[0].id;

  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await response.json()).trips, { received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0 });
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].id, originalId);
  assert.equal(DATA.value().trips[0].amount, 4800);
  assert.equal(DATA.value().trips[0].km, 3.8);
  assert.equal(DATA.value().trips[0].min, 8 + 53/60);

  const replay = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await replay.json()).trips, { received: 1, inserted: 0, updated: 0, duplicates: 1, ambiguous: 0 });
  assert.equal(DATA.value().trips.length, 1);
});

test("a detail with changed amount is not merged when date, time and platform are ambiguous", async () => {
  const base = { date: "2026-11-07", start: "22:09", min: 0, platform: "didi" };
  const DATA = memoryKV({
    trips: [
      { id: "legacy-a", ...base, amount: 5100, km: 0, source: "didi_history" },
      { id: "legacy-b", ...base, amount: 5200, km: 0, source: "didi_history" }
    ],
    rewards: [], fuel: [], sessions: []
  });
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [{ ...base, amount: 4800, km: 3.8, km_source: "actual", min: 8.9, source: "didi_history_detail" }] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await response.json()).trips, { received: 1, inserted: 0, updated: 0, duplicates: 0, ambiguous: 1 });
  assert.equal(DATA.value().trips.length, 2);
  assert.equal(DATA.value().trips[0].amount, 5100);
  assert.equal(DATA.value().trips[1].amount, 5200);
});


test("a changed detail never overwrites an already detailed same-minute trip", async () => {
  const DATA = memoryKV({
    trips: [{
      id: "verified-existing", date: "2026-11-07", start: "21:03", amount: 3500,
      km: 1.4, km_source: "actual", min: 7.8, platform: "didi", source: "didi_history_detail"
    }],
    rewards: [], fuel: [], sessions: []
  });
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [{
      date: "2026-11-07", start: "21:03", amount: 4800,
      km: 3.8, km_source: "actual", min: 8.9, platform: "didi", source: "didi_history_detail"
    }] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await response.json()).trips, { received: 1, inserted: 0, updated: 0, duplicates: 0, ambiguous: 1 });
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].amount, 3500);
  assert.equal(DATA.value().trips[0].km, 1.4);
});

test("fare corrections retain a timestamped audit trail", async () => {
  const DATA = memoryKV();
  const summary = { date: "2026-11-07", start: "22:09", amount: 5100, km: 0, min: 0, platform: "didi", source: "didi_history" };
  const detail = { ...summary, amount: 4800, km: 3.8, km_source: "actual", min: 8 + 53/60, source: "didi_history_detail" };
  await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [summary] })
  }), { INGEST_TOKEN, DATA });
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await response.json()).trips, { received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0 });
  const row = DATA.value().trips[0];
  assert.equal(row.amount, 4800);
  assert.equal(row.amount_history.length, 1);
  assert.equal(row.amount_history[0].amount, 5100);
  assert.equal(row.amount_history[0].replaced_by_source, "didi_history_detail");
  assert.ok(Number.isFinite(Date.parse(row.amount_history[0].recorded_at)));
  assert.ok(Number.isFinite(Date.parse(row.updated_at)));
});

test("static dashboard assets explicitly disable browser and CDN caching", async () => {
  const response = await worker.fetch(apiRequest("/"), {
    ASSETS: {
      fetch: async () => new Response("<main>Etios</main>", {
        headers: { "cache-control": "public, max-age=3600" }
      })
    }
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") || "", /no-store/i);
  assert.match(response.headers.get("cdn-cache-control") || "", /no-store/i);
});


test("ingestion rejects fuel without a date and leaves KV unchanged", async () => {
  const DATA = memoryKV();
  const before = DATA.value();
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({
      fuel: [
        {
          id: "fuel-ticket-without-odometer",
          date: "2026-11-10",
          odometer_km: null,
          liters: 9.18,
          total_ars: 20000,
          station: "YPF Super",
          full_tank: false
        },
        {
          id: "fuel-cash-only",
          date: null,
          odometer_km: null,
          liters: null,
          total_ars: 30000,
          station: null,
          full_tank: false
        }
      ]
    })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 400);
  assert.deepEqual(DATA.value(), before);
});

test("fuel replays with a different id are held as ambiguous instead of double-counted", async () => {
  const existing = {
    id: "fuel-existing",
    date: "2026-11-13",
    odometer_km: null,
    liters: null,
    total_ars: 30000,
    price_per_liter: null,
    station: "YPF",
    full_tank: 0
  };
  const DATA = memoryKV({ trips: [], rewards: [], fuel: [existing], sessions: [] });
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({
      fuel: [{ ...existing, id: "fuel-replayed-with-new-id" }]
    })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.fuel, {
    received: 1, inserted: 0, duplicates: 0, ambiguous: 1
  });
  assert.deepEqual(DATA.value().fuel, [existing]);
});

test("ingestion normalizes a legacy positive-km trip that is missing km_source", async () => {
  const DATA = memoryKV({
    trips: [{
      id: "legacy-positive-km-no-source",
      date: "2026-11-10",
      start: "22:35",
      amount: 3000,
      km: 3.4,
      min: 9.6,
      platform: "didi",
      source: "didi_history_detail"
    }],
    rewards: [],
    fuel: [],
    sessions: []
  });
  const detail = {
    date: "2026-11-10",
    start: "22:35",
    amount: 3000,
    km: 3.4,
    km_source: "actual",
    min: 9.6,
    platform: "didi",
    source: "didi_history_detail"
  };

  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).trips, {
    received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0
  });
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].km_source, "actual");
  assert.equal(DATA.value().trips[0].amount, 3000);
  assert.equal(DATA.value().trips[0].km, 3.4);
  assert.equal(DATA.value().trips[0].min, 9.6);

  const replay = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await replay.json()).trips, {
    received: 1, inserted: 0, updated: 0, duplicates: 1, ambiguous: 0
  });
  assert.equal(DATA.value().trips.length, 1);
});


test("dashboard directory routes serve the shared index asset", async () => {
  const paths = [];
  const ASSETS = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      if (path === "/index.html") {
        return new Response(null, { status: 307, headers: { location: "/" } });
      }
      return new Response("<!doctype html><html></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    }
  };

  for (const path of ["/inputs/", "/trips/"]) {
    const response = await worker.fetch(apiRequest(path), { ASSETS });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/html/);
  }
  assert.deepEqual(paths, ["/", "/"]);
});


test("authenticated ingestion dry-run classifies changes by day without writing KV", async () => {
  const date = "2026-11-06";
  const summary = {
    id: "summary-trip", date, start: "08:00", amount: 2000,
    km: 0, km_source: "unknown", min: 0, platform: "didi", source: "didi_history"
  };
  const ambiguousA = {
    id: "ambiguous-a", date, start: "09:00", amount: 1500,
    km: 2, km_source: "actual", min: 5, platform: "didi", source: "didi_history_detail"
  };
  const ambiguousB = { ...ambiguousA, id: "ambiguous-b" };
  const duplicate = {
    id: "duplicate-trip", date, start: "10:00", amount: 1800,
    km: 1.2, km_source: "actual", min: 4, platform: "didi", source: "didi_history_detail"
  };
  const before = { trips: [summary, ambiguousA, ambiguousB, duplicate], rewards: [], fuel: [], sessions: [] };
  const DATA = memoryKV(before);
  const response = await worker.fetch(apiRequest("/api/ingest?dry=1", {
    method: "POST",
    headers: jsonHeaders(bearer()),
    body: JSON.stringify({
      trips: [
        { date, start: "11:00", amount: 1200, km: 1.5, min: 5, platform: "didi", passenger_name: "never return" },
        { date, start: "08:00", amount: 2000, km: 3, min: 9, platform: "didi", source: "didi_history_detail" },
        { date, start: "09:00", amount: 1500, km: 2, min: 5, platform: "didi" },
        duplicate
      ]
    })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.dry_run, true);
  assert.deepEqual(body.trips, {
    received: 4, inserted: 1, updated: 1, duplicates: 1, ambiguous: 1
  });
  assert.equal(body.by_day[date].trips.inserted, 1);
  assert.equal(body.by_day[date].trips.updated, 1);
  assert.equal(body.by_day[date].trips.duplicates, 1);
  assert.equal(body.by_day[date].trips.ambiguous, 1);
  assert.equal(JSON.stringify(body).includes("never return"), false);
  assert.deepEqual(DATA.value(), before);
  assert.equal(DATA.calls.filter((call) => call.method === "put").length, 0);
});

test("dry-run requires the ingestion token and never writes on rejection", async () => {
  const DATA = memoryKV();
  const response = await worker.fetch(apiRequest("/api/ingest?dry=1", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ trips: [{
      date: "2026-11-06", start: "11:00", amount: 1200, km: 1, min: 5, platform: "didi"
    }] })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 401);
  assert.equal(DATA.calls.filter((call) => call.method === "put").length, 0);
  assert.equal(DATA.value(), null);
});

test("work-session ingestion deduplicates by shift identity and enriches odometer once", async () => {
  const DATA = memoryKV();
  const base = {
    date: "2026-11-06", platform: "didi",
    connected_start: "09:00", connected_end: "15:00"
  };
  const first = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ sessions: [{ ...base, id: "browser-session-1" }] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(first.status, 201);
  const retainedId = DATA.value().sessions[0].id;

  const enrichedInput = {
    ...base, id: "browser-session-2", odometer_start: 82000, odometer_end: 82012.5
  };
  const enriched = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ sessions: [enrichedInput] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(enriched.status, 201);
  assert.deepEqual((await enriched.json()).sessions, {
    received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0
  });
  assert.equal(DATA.value().sessions.length, 1);
  assert.equal(DATA.value().sessions[0].id, retainedId);
  assert.equal(DATA.value().sessions[0].odometer_km, 12.5);

  const repeated = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ sessions: [enrichedInput] })
  }), { INGEST_TOKEN, DATA });
  assert.deepEqual((await repeated.json()).sessions, {
    received: 1, inserted: 0, updated: 0, duplicates: 1, ambiguous: 0
  });
  assert.equal(DATA.value().sessions.length, 1);
});

test("conflicting odometer data for the same work session is ambiguous and preserved", async () => {
  const existing = {
    id: "session-original", date: "2026-11-06", platform: "didi",
    connected_start: "09:00", connected_end: "15:00", connected_minutes: 360,
    odometer_start: 82000, odometer_end: 82012, odometer_km: 12
  };
  const DATA = memoryKV({ trips: [], rewards: [], fuel: [], sessions: [existing] });
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ sessions: [{
      date: existing.date, platform: existing.platform,
      connected_start: existing.connected_start, connected_end: existing.connected_end,
      odometer_start: 82001, odometer_end: 82013
    }] })
  }), { INGEST_TOKEN, DATA });

  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).sessions, {
    received: 1, inserted: 0, updated: 0, duplicates: 0, ambiguous: 1
  });
  assert.deepEqual(DATA.value().sessions, [existing]);
});


test("dry-run and commit use the same classification for every collection", async () => {
  const DATA = memoryKV();
  const payload = {
    trips: [{
      date: "2026-11-07", start: "08:10", amount: 2500,
      km: 3.2, min: 11, platform: "didi"
    }],
    rewards: [{
      date: "2026-11-07", start: "20:00", amount: 7000, label: "Recompensa"
    }],
    fuel: [{
      date: "2026-11-07", total_ars: 30000, station: "YPF"
    }],
    sessions: [{
      date: "2026-11-07", platform: "didi",
      connected_start: "08:00", connected_end: "17:00",
      odometer_start: 82000, odometer_end: 82035
    }]
  };
  const preview = await worker.fetch(apiRequest("/api/ingest?dry=1", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify(payload)
  }), { INGEST_TOKEN, DATA });
  const previewBody = await preview.json();

  assert.equal(preview.status, 200);
  assert.equal(DATA.calls.filter((call) => call.method === "put").length, 0);

  const commit = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()), body: JSON.stringify(payload)
  }), { INGEST_TOKEN, DATA });
  const commitBody = await commit.json();

  assert.equal(commit.status, 201);
  assert.equal(commitBody.dry_run, false);
  assert.deepEqual(previewBody.trips, commitBody.trips);
  assert.deepEqual(previewBody.rewards, commitBody.rewards);
  assert.deepEqual(previewBody.fuel, commitBody.fuel);
  assert.deepEqual(previewBody.sessions, commitBody.sessions);
  assert.deepEqual(previewBody.by_day, commitBody.by_day);
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().rewards.length, 1);
  assert.equal(DATA.value().fuel.length, 1);
  assert.equal(DATA.value().sessions.length, 1);
});

test("detail ingestion enriches an existing ride with whitelisted DiDi fare components", async () => {
  const DATA = memoryKV();
  const summary = {
    date: "2026-11-14", start: "18:02", amount: 6400,
    km: 0, min: 0, platform: "didi", source: "didi_history"
  };
  const detail = {
    ...summary, km: 7, km_source: "actual", min: 18 + 37 / 60,
    source: "didi_history_detail", service_type: "Express",
    fare_breakdown: {
      distance_ars: 3000, time_ars: 1900, wait_ars: null,
      dynamic_base_ars: 900, differential_price_ars: 600,
      fare_reimbursement_ars: null, origin_address: "not persisted"
    },
    fare_total_ars: 6400, adjusted_from_ars: 6600,
    earnings_adjusted: true, detail_verified: true,
    passenger_phone: "not persisted"
  };

  const first = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [summary] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(first.status, 201);
  const stableId = DATA.value().trips[0].id;

  const enriched = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(enriched.status, 201);
  assert.deepEqual((await enriched.json()).trips, {
    received: 1, inserted: 0, updated: 1, duplicates: 0, ambiguous: 0
  });
  const stored = DATA.value().trips[0];
  assert.equal(stored.id, stableId);
  assert.equal(stored.service_type, "Express");
  assert.deepEqual(stored.fare_breakdown, {
    distance_ars: 3000, time_ars: 1900, wait_ars: null,
    dynamic_base_ars: 900, differential_price_ars: 600,
    fare_reimbursement_ars: null
  });
  assert.equal(stored.fare_total_ars, 6400);
  assert.equal(stored.adjusted_from_ars, 6600);
  assert.equal(stored.earnings_adjusted, true);
  assert.equal(stored.detail_verified, true);
  assert.equal("passenger_phone" in stored, false);
  assert.equal("origin_address" in stored.fare_breakdown, false);
});

test("conflicting DiDi fare detail is ambiguous and never overwrites an existing breakdown", async () => {
  const existing = {
    id: "detail-ride-1", date: "2026-11-14", start: "18:02", amount: 6400,
    km: 7, km_source: "actual", min: 18 + 37 / 60,
    platform: "didi", source: "didi_history_detail",
    service_type: "Express", fare_total_ars: 6400,
    fare_breakdown: {
      distance_ars: 3000, time_ars: 1900, wait_ars: null,
      dynamic_base_ars: 900, differential_price_ars: 600,
      fare_reimbursement_ars: null
    }
  };
  const DATA = memoryKV({ trips: [existing], rewards: [], fuel: [], sessions: [] });
  const conflict = {
    ...existing, id: "detail-ride-2",
    fare_breakdown: { ...existing.fare_breakdown, distance_ars: 2900 }
  };
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [conflict] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  assert.deepEqual((await response.json()).trips, {
    received: 1, inserted: 0, updated: 0, duplicates: 0, ambiguous: 1
  });
  assert.deepEqual(DATA.value().trips, [existing]);
});
test("detail ingestion enriches a trip with exact duration seconds", async () => {
  const DATA = memoryKV();
  const base = {
    date: "2026-11-14", start: "20:37", amount: 3500, km: 0,
    min: 0, platform: "didi", source: "didi_history"
  };
  await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [base] })
  }), { INGEST_TOKEN, DATA });
  const detail = {
    ...base, km: 2.5, km_source: "actual", min: 8.4167,
    duration_seconds: 505, source: "didi_history_detail"
  };
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [detail] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).trips.updated, 1);
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].duration_seconds, 505);
});
test("canonical breakdown enriches a matching trip without changing its identity", async () => {
  const DATA = memoryKV();
  const base = {
    date: "2026-11-14", start: "20:54", amount: 3900, km: 0,
    min: 0, platform: "didi", source: "didi_history"
  };
  await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [base] })
  }), { INGEST_TOKEN, DATA });
  const id = DATA.value().trips[0].id;
  const detailed = {
    ...base, km: 1.2, km_source: "actual", min: 6.95,
    duration_seconds: 417, source: "didi_history_detail",
    modality: "DiDi Express",
    breakdown: { source: "actual", components: [
      { code: "distancia", label: "Tarifa por distancia", amount: 500 },
      { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
      { code: "espera", label: "Tarifa por espera", amount: 100 },
      { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
      { code: "diferencial", label: "Precio diferencial", amount: 1400 }
    ]}
  };
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [detailed] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).trips.updated, 1);
  assert.equal(DATA.value().trips.length, 1);
  assert.equal(DATA.value().trips[0].id, id);
  assert.equal(DATA.value().trips[0].breakdown.components.length, 5);
  assert.equal(DATA.value().trips[0].modality, "DiDi Express");
});

test("canonical breakdown conflicts are ambiguous and cannot overwrite recorded components", async () => {
  const existing = {
    id: "canonical-trip-1", date: "2026-11-14", start: "20:54",
    amount: 3900, km: 1.2, km_source: "actual", min: 6.95,
    duration_seconds: 417, platform: "didi", source: "didi_history_detail",
    breakdown: { source: "actual", components: [
      { code: "distancia", label: "Tarifa por distancia", amount: 500 },
      { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
      { code: "espera", label: "Tarifa por espera", amount: 100 },
      { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
      { code: "diferencial", label: "Precio diferencial", amount: 1400 }
    ]}
  };
  const DATA = memoryKV({ trips: [existing], rewards: [], fuel: [], sessions: [] });
  const incoming = {
    ...existing, id: "canonical-trip-2",
    breakdown: { ...existing.breakdown, components: existing.breakdown.components.map((item, i) =>
      i === 0 ? { ...item, amount: 600 } :
      i === 4 ? { ...item, amount: 1300 } : item
    )}
  };
  const response = await worker.fetch(apiRequest("/api/ingest", {
    method: "POST", headers: jsonHeaders(bearer()),
    body: JSON.stringify({ trips: [incoming] })
  }), { INGEST_TOKEN, DATA });
  assert.equal(response.status, 201);
  assert.equal((await response.json()).trips.ambiguous, 1);
  assert.deepEqual(DATA.value().trips, [existing]);
});
