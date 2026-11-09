import {
  normaliseFuelLog,
  normaliseReward,
  normaliseTrip,
  normaliseWorkSession
} from "./domain.mjs";

const LEDGER_KEY = "ledger:v1";
const MAX_BODY_BYTES = 1024 * 1024;
const MAX_LEDGER_BYTES = 25 * 1024 * 1024;
const encoder = new TextEncoder();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      ...extraHeaders
    }
  });
}

function errorResponse(status, code, message) {
  return json({ error: code, message }, status);
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left ?? ""));
  const b = encoder.encode(String(right ?? ""));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

async function readJson(request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "Send JSON using Content-Type: application/json");
  }
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large");
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, "Request body is not valid JSON");
  }
}

async function readLedger(env) {
  if (!env.DATA) throw new HttpError(503, "KV storage is not configured");
  const stored = await env.DATA.get(LEDGER_KEY, "json");
  const ledger = stored && typeof stored === "object" ? stored : {};
  return {
    trips: Array.isArray(ledger.trips) ? ledger.trips : [],
    rewards: Array.isArray(ledger.rewards) ? ledger.rewards : [],
    fuel: Array.isArray(ledger.fuel) ? ledger.fuel : [],
    sessions: Array.isArray(ledger.sessions) ? ledger.sessions : []
  };
}

async function writeLedger(env, ledger) {
  const serialized = JSON.stringify(ledger);
  if (encoder.encode(serialized).byteLength > MAX_LEDGER_BYTES) {
    throw new HttpError(413, "Ledger exceeds the KV value size limit");
  }
  await env.DATA.put(LEDGER_KEY, serialized, {
    metadata: { schema_version: 1, updated_at: new Date().toISOString() }
  });
}

function validDateFilter(value) {
  if (value == null || value === "") return false;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeLimit(value, fallback = 2000) {
  return Math.min(Math.max(Number.parseInt(value ?? String(fallback), 10) || fallback, 1), 5000);
}

function filterDateRange(rows, url) {
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from && !validDateFilter(from)) throw new HttpError(400, "Invalid from date");
  if (to && !validDateFilter(to)) throw new HttpError(400, "Invalid to date");
  return rows.filter((row) =>
    (!from || row.date >= from) && (!to || row.date <= to)
  );
}

function sorted(rows, limit) {
  return rows.slice().sort((a, b) =>
    (b.date + (b.start ?? "")).localeCompare(a.date + (a.start ?? ""))
  ).slice(0, limit);
}

async function normaliseBatch(items, normaliser, existingRows) {
  if (!Array.isArray(items)) throw new HttpError(400, "Each record collection must be an array");
  const seen = new Set(existingRows.map((row) => row.id));
  const rows = [];
  let duplicates = 0;
  for (const item of items) {
    let row;
    try {
      row = await normaliser(item);
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    if (seen.has(row.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(row.id);
    rows.push(row);
  }
  return { rows, received: items.length, inserted: rows.length, duplicates };
}

async function handleIngest(request, env) {
  if (!env.INGEST_TOKEN) throw new HttpError(503, "Ingestion is not configured");
  const authorization = request.headers.get("authorization") ?? "";
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!constantTimeEqual(supplied, env.INGEST_TOKEN)) {
    throw new HttpError(401, "Invalid ingestion token");
  }

  const body = await readJson(request);
  const legacyTripArray = Array.isArray(body);
  const tripsInput = legacyTripArray ? body : (body?.trips ?? []);
  const rewardsInput = legacyTripArray ? [] : (body?.rewards ?? []);
  const fuelInput = legacyTripArray ? [] : (body?.fuel ?? []);
  const sessionsInput = legacyTripArray ? [] : (body?.sessions ?? []);
  const collections = [tripsInput, rewardsInput, fuelInput, sessionsInput];
  if (!collections.every(Array.isArray)) {
    throw new HttpError(400, "trips, rewards, fuel and sessions must be arrays");
  }
  const total = collections.reduce((sum, value) => sum + value.length, 0);
  if (total < 1) throw new HttpError(400, "Body must contain at least one record");
  if (total > 500) throw new HttpError(400, "Send no more than 500 total records per request");

  const ledger = await readLedger(env);
  const trips = await normaliseBatch(tripsInput, normaliseTrip, ledger.trips);
  const rewards = await normaliseBatch(rewardsInput, normaliseReward, ledger.rewards);
  const fuel = await normaliseBatch(fuelInput, normaliseFuelLog, ledger.fuel);
  const sessions = await normaliseBatch(sessionsInput, normaliseWorkSession, ledger.sessions);

  ledger.trips.push(...trips.rows);
  ledger.rewards.push(...rewards.rows);
  ledger.fuel.push(...fuel.rows);
  ledger.sessions.push(...sessions.rows);
  await writeLedger(env, ledger);

  return json({
    ok: true,
    trips: { received: trips.received, inserted: trips.inserted, duplicates: trips.duplicates },
    rewards: { received: rewards.received, inserted: rewards.inserted, duplicates: rewards.duplicates },
    fuel: { received: fuel.received, inserted: fuel.inserted, duplicates: fuel.duplicates },
    sessions: { received: sessions.received, inserted: sessions.inserted, duplicates: sessions.duplicates },
    received: total,
    inserted: trips.inserted + rewards.inserted + fuel.inserted + sessions.inserted,
    duplicates: trips.duplicates + rewards.duplicates + fuel.duplicates + sessions.duplicates
  }, 201);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "didi-dash", storage: env.DATA ? "kv" : "unavailable" });
  }

  if (path === "/api/ingest" && method === "POST") {
    return handleIngest(request, env);
  }

  if (method !== "GET") {
    throw new HttpError(405, "Dashboard is public read-only; writes require the private ingestion endpoint");
  }

  const ledger = await readLedger(env);
  if (path === "/api/trips") {
    const rows = filterDateRange(ledger.trips, url);
    const platform = url.searchParams.get("platform");
    const filtered = platform
      ? rows.filter((row) => row.platform === platform.toLowerCase())
      : rows;
    const limit = safeLimit(url.searchParams.get("limit"));
    const trips = sorted(filtered, limit);
    return json({ trips, count: trips.length, limit });
  }

  if (path === "/api/rewards") {
    const limit = safeLimit(url.searchParams.get("limit"));
    const rewards = sorted(filterDateRange(ledger.rewards, url), limit);
    return json({ rewards, count: rewards.length, limit });
  }

  if (path === "/api/fuel") {
    return json({ fuel: sorted(ledger.fuel, safeLimit(url.searchParams.get("limit"), 500)) });
  }

  if (path === "/api/sessions") {
    return json({ sessions: sorted(ledger.sessions, safeLimit(url.searchParams.get("limit"), 500)) });
  }

  if (path === "/api/export") {
    const trips = sorted(ledger.trips, 5000);
    const rewards = sorted(ledger.rewards, 5000);
    const fuel = sorted(ledger.fuel, 5000);
    const sessions = sorted(ledger.sessions, 5000);
    return json({
      schema_version: 2,
      exported_at: new Date().toISOString(),
      trips,
      rewards,
      fuel,
      sessions,
      truncated: {
        trips: trips.length < ledger.trips.length,
        rewards: rewards.length < ledger.rewards.length,
        fuel: fuel.length < ledger.fuel.length,
        sessions: sessions.length < ledger.sessions.length
      }
    }, 200, {
      "content-disposition": 'attachment; filename="didi-dash-backup.json"'
    });
  }

  throw new HttpError(404, "API route not found");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    try {
      return await handleApi(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, "request_rejected", error.message);
      }
      console.error("Didi Dash API failure:", error?.name ?? "UnknownError");
      return errorResponse(500, "internal_error", "The request could not be completed");
    }
  }
};
