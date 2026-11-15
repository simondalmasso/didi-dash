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

function recordDay(byDay, date, collection, outcome) {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const day = byDay[date] ??= {};
  const counts = day[collection] ??= {
    received: 0, inserted: 0, updated: 0, duplicates: 0, ambiguous: 0
  };
  counts.received += 1;
  counts[outcome] += 1;
}

function mergeDayBreakdowns(...breakdowns) {
  const result = {};
  for (const breakdown of breakdowns) {
    for (const [date, collections] of Object.entries(breakdown)) {
      const day = result[date] ??= {};
      for (const [collection, counts] of Object.entries(collections)) {
        const target = day[collection] ??= {
          received: 0, inserted: 0, updated: 0, duplicates: 0, ambiguous: 0
        };
        for (const key of Object.keys(target)) target[key] += counts[key] ?? 0;
      }
    }
  }
  return result;
}

async function normaliseBatch(items, normaliser, existingRows, collection) {
  if (!Array.isArray(items)) throw new HttpError(400, "Each record collection must be an array");
  const seen = new Set(existingRows.map((row) => row.id));
  const rows = [];
  const by_day = {};
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
      recordDay(by_day, row.date, collection, "duplicates");
      continue;
    }
    seen.add(row.id);
    rows.push(row);
    recordDay(by_day, row.date, collection, "inserted");
  }
  return { rows, received: items.length, inserted: rows.length, duplicates, by_day };
}

function sameFuelIdentity(left, right) {
  const sameNullableNumber = (a, b) =>
    a == null || b == null ? a == null && b == null : Number(a) === Number(b);
  return left.date === right.date &&
    Number(left.total_ars) === Number(right.total_ars) &&
    sameNullableNumber(left.odometer_km, right.odometer_km) &&
    sameNullableNumber(left.liters, right.liters) &&
    String(left.station ?? "").trim().toLowerCase() === String(right.station ?? "").trim().toLowerCase() &&
    Number(left.full_tank ?? 0) === Number(right.full_tank ?? 0);
}

async function normaliseFuelBatch(items, existingRows) {
  if (!Array.isArray(items)) throw new HttpError(400, "Each record collection must be an array");
  const rows = [];
  const by_day = {};
  let duplicates = 0;
  let ambiguous = 0;

  for (const item of items) {
    let incoming;
    try {
      incoming = await normaliseFuelLog(item);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    const candidates = [...existingRows, ...rows];
    const idMatches = candidates.filter((row) => row.id === incoming.id);
    const identityMatches = candidates.filter((row) => sameFuelIdentity(row, incoming));

    if (idMatches.length === 1 && identityMatches.length === 1 && idMatches[0] === identityMatches[0]) {
      duplicates += 1;
      recordDay(by_day, incoming.date, "fuel", "duplicates");
      continue;
    }

    if (idMatches.length > 0 || identityMatches.length > 0) {
      ambiguous += 1;
      recordDay(by_day, incoming.date, "fuel", "ambiguous");
      continue;
    }

    rows.push(incoming);
    recordDay(by_day, incoming.date, "fuel", "inserted");
  }

  return {
    rows,
    received: items.length,
    inserted: rows.length,
    duplicates,
    ambiguous,
    by_day
  };
}

function sameTripIdentity(left, right) {
  return left.date === right.date &&
    left.start === right.start &&
    String(left.platform ?? "").toLowerCase() === String(right.platform ?? "").toLowerCase();
}

function conflictsWithDetailedRide(existing, incoming) {
  if (existing.source !== "didi_history_detail") return false;
  if (incoming.source !== "didi_history_detail") {
    return incoming.source === "didi_history" &&
      Number(incoming.amount) > 0 &&
      Number(incoming.amount) !== Number(existing.amount);
  }
  const amountChanged = Number(incoming.amount) !== Number(existing.amount);
  const kmChanged = Math.abs((Number(incoming.km) || 0) - (Number(existing.km) || 0)) > 0.01;
  const minutesChanged = Math.abs((Number(incoming.min) || 0) - (Number(existing.min) || 0)) > 0.02;
  const secondsChanged = existing.duration_seconds != null && incoming.duration_seconds != null &&
    Number(existing.duration_seconds) !== Number(incoming.duration_seconds);
  if (amountChanged || kmChanged || minutesChanged || secondsChanged) return true;

  if (existing.service_type && incoming.service_type &&
      existing.service_type.toLowerCase() !== incoming.service_type.toLowerCase()) return true;
  if (existing.modality && incoming.modality &&
      existing.modality.toLowerCase() !== incoming.modality.toLowerCase()) return true;
  if (existing.breakdown && incoming.breakdown &&
      JSON.stringify(existing.breakdown) !== JSON.stringify(incoming.breakdown)) return true;
  if (existing.fare_total_ars != null && incoming.fare_total_ars != null &&
      Number(existing.fare_total_ars) !== Number(incoming.fare_total_ars)) return true;
  if (existing.adjusted_from_ars != null && incoming.adjusted_from_ars != null &&
      Number(existing.adjusted_from_ars) !== Number(incoming.adjusted_from_ars)) return true;
  const existingFare = existing.fare_breakdown ?? {};
  const incomingFare = incoming.fare_breakdown ?? {};
  for (const key of Object.keys(incomingFare)) {
    if (existingFare[key] != null && incomingFare[key] != null &&
        Number(existingFare[key]) !== Number(incomingFare[key])) return true;
  }
  return false;
}

function mergeTripDetails(existing, incoming) {
  const next = { ...existing };
  const existingKm = Number(existing.km) || 0;
  const incomingKm = Number(incoming.km) || 0;
  const existingSource = existing.km_source ?? (existingKm > 0 ? "actual" : "unknown");
  const incomingSource = incoming.km_source ?? (incomingKm > 0 ? "actual" : "unknown");
  let updated = false;

  // The history list can show an estimated fare while Details shows the final settled driver earnings.
  // A uniquely matched DiDi detail record is authoritative for the amount.
  const existingAmount = Number(existing.amount) || 0;
  const incomingAmount = Number(incoming.amount) || 0;
  if (incoming.source === "didi_history_detail" &&
      incomingAmount > 0 && incomingAmount !== existingAmount) {
    const recordedAt = new Date().toISOString();
    next.amount_history = [
      ...(Array.isArray(existing.amount_history) ? existing.amount_history : []),
      {
        amount: existingAmount,
        recorded_at: recordedAt,
        replaced_by_source: incoming.source
      }
    ];
    next.amount = incomingAmount;
    updated = true;
  }

  if (existingKm <= 0 && incomingKm > 0) {
    next.km = incomingKm;
    next.km_source = incomingSource;
    updated = true;
  } else if (existingKm > 0 && incomingKm > 0 &&
      existingSource === "estimated" && incomingSource === "actual") {
    next.km = incomingKm;
    next.km_source = "actual";
    updated = true;
  } else if (existingKm > 0 && existing.km_source == null) {
    // Backfill the canonical source for legacy positive-distance rows.
    next.km_source = existingSource;
    updated = true;
  }

  const existingMinutes = Number(existing.min) || 0;
  const incomingMinutes = Number(incoming.min) || 0;
  if (existingMinutes <= 0 && incomingMinutes > 0) {
    next.min = incomingMinutes;
    updated = true;
  }
  if (existing.duration_seconds == null && incoming.duration_seconds != null) {
    next.duration_seconds = incoming.duration_seconds;
    updated = true;
  }

  if (incoming.service_type && !existing.service_type) {
    next.service_type = incoming.service_type;
    updated = true;
  }
  if (incoming.modality && !existing.modality) {
    next.modality = incoming.modality;
    updated = true;
  }
  if (incoming.breakdown && !existing.breakdown) {
    next.breakdown = incoming.breakdown;
    delete next.breakdown_status;
    updated = true;
  } else if (incoming.breakdown_status === "review" &&
      !existing.breakdown && !existing.breakdown_status) {
    next.breakdown_status = "review";
    next.detail_verified = false;
    updated = true;
  }

  if (incoming.fare_breakdown && typeof incoming.fare_breakdown === "object") {
    const currentFare = existing.fare_breakdown ?? {};
    const mergedFare = { ...currentFare };
    for (const [key, value] of Object.entries(incoming.fare_breakdown)) {
      if (mergedFare[key] == null && value != null) {
        mergedFare[key] = value;
        updated = true;
      } else if (!(key in mergedFare)) {
        mergedFare[key] = value;
      }
    }
    if (Object.keys(mergedFare).length) next.fare_breakdown = mergedFare;
  }

  for (const key of ["fare_total_ars", "adjusted_from_ars", "earnings_adjusted"]) {
    if (existing[key] == null && incoming[key] != null) {
      next[key] = incoming[key];
      updated = true;
    }
  }
  if (incoming.detail_verified === true && existing.detail_verified !== true) {
    next.detail_verified = true;
    updated = true;
  } else if (existing.detail_verified == null && incoming.detail_verified === false) {
    next.detail_verified = false;
    updated = true;
  }

  if (!updated) return null;
  next.km_source = (Number(next.km) || 0) > 0
    ? (next.km_source ?? existingSource)
    : "unknown";
  next.source = incoming.source;
  next.updated_at = new Date().toISOString();
  return next;
}

async function normaliseTripBatch(items, existingRows) {
  if (!Array.isArray(items)) throw new HttpError(400, "Each record collection must be an array");
  const rows = [];
  const byDay = {};
  let duplicates = 0;
  let updated = 0;
  let ambiguous = 0;

  for (const item of items) {
    let incoming;
    try {
      incoming = await normaliseTrip(item);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    const candidates = [
      ...existingRows.map((row, index) => ({ row, bucket: "existing", index })),
      ...rows.map((row, index) => ({ row, bucket: "new", index }))
    ];
    const exactMatches = candidates.filter(({ row }) => row.id === incoming.id);
    const matches = exactMatches.length
      ? exactMatches
      : candidates.filter(({ row }) => sameTripIdentity(row, incoming));

    if (matches.length > 1) {
      ambiguous += 1;
      recordDay(byDay, incoming.date, "trips", "ambiguous");
      continue;
    }
    if (matches.length === 1) {
      const match = matches[0];
      if (conflictsWithDetailedRide(match.row, incoming)) {
        ambiguous += 1;
        recordDay(byDay, incoming.date, "trips", "ambiguous");
        continue;
      }
      const enriched = mergeTripDetails(match.row, incoming);
      if (!enriched) {
        duplicates += 1;
        recordDay(byDay, incoming.date, "trips", "duplicates");
        continue;
      }
      if (match.bucket === "existing") existingRows[match.index] = enriched;
      else rows[match.index] = enriched;
      updated += 1;
      recordDay(byDay, incoming.date, "trips", "updated");
      continue;
    }

    rows.push(incoming);
    recordDay(byDay, incoming.date, "trips", "inserted");
  }

  return {
    rows,
    received: items.length,
    inserted: rows.length,
    updated,
    duplicates,
    ambiguous,
    by_day: byDay
  };
}

function sameWorkSessionIdentity(left, right) {
  return left.date === right.date &&
    String(left.platform ?? "").toLowerCase() === String(right.platform ?? "").toLowerCase() &&
    left.connected_start === right.connected_start &&
    left.connected_end === right.connected_end;
}

function mergeWorkSessionDetails(existing, incoming) {
  const existingHasOdometer = existing.odometer_start != null && existing.odometer_end != null;
  const incomingHasOdometer = incoming.odometer_start != null && incoming.odometer_end != null;
  if (!incomingHasOdometer) return { row: null, conflict: false };
  if (!existingHasOdometer) {
    return {
      row: {
        ...existing,
        odometer_start: incoming.odometer_start,
        odometer_end: incoming.odometer_end,
        odometer_km: incoming.odometer_km
      },
      conflict: false
    };
  }
  const startChanged = Math.abs(Number(existing.odometer_start) - Number(incoming.odometer_start)) > 0.05;
  const endChanged = Math.abs(Number(existing.odometer_end) - Number(incoming.odometer_end)) > 0.05;
  return { row: null, conflict: startChanged || endChanged };
}

async function normaliseSessionBatch(items, existingRows) {
  if (!Array.isArray(items)) throw new HttpError(400, "Each record collection must be an array");
  const rows = [];
  const by_day = {};
  let updated = 0;
  let duplicates = 0;
  let ambiguous = 0;

  for (const item of items) {
    let incoming;
    try {
      incoming = await normaliseWorkSession(item);
    } catch (error) {
      throw new HttpError(400, error.message);
    }

    const candidates = [
      ...existingRows.map((row, index) => ({ row, bucket: "existing", index })),
      ...rows.map((row, index) => ({ row, bucket: "new", index }))
    ];
    const identityMatches = candidates.filter(({ row }) => sameWorkSessionIdentity(row, incoming));
    const idMatches = candidates.filter(({ row }) => row.id === incoming.id);

    if (idMatches.some(({ row }) => !sameWorkSessionIdentity(row, incoming)) || identityMatches.length > 1) {
      ambiguous += 1;
      recordDay(by_day, incoming.date, "sessions", "ambiguous");
      continue;
    }
    if (identityMatches.length === 1) {
      const match = identityMatches[0];
      const merged = mergeWorkSessionDetails(match.row, incoming);
      if (merged.conflict) {
        ambiguous += 1;
        recordDay(by_day, incoming.date, "sessions", "ambiguous");
        continue;
      }
      if (!merged.row) {
        duplicates += 1;
        recordDay(by_day, incoming.date, "sessions", "duplicates");
        continue;
      }
      if (match.bucket === "existing") existingRows[match.index] = merged.row;
      else rows[match.index] = merged.row;
      updated += 1;
      recordDay(by_day, incoming.date, "sessions", "updated");
      continue;
    }

    rows.push(incoming);
    recordDay(by_day, incoming.date, "sessions", "inserted");
  }

  return {
    rows,
    received: items.length,
    inserted: rows.length,
    updated,
    duplicates,
    ambiguous,
    by_day
  };
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

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";
  const ledger = await readLedger(env);
  const trips = await normaliseTripBatch(tripsInput, ledger.trips);
  const rewards = await normaliseBatch(rewardsInput, normaliseReward, ledger.rewards, "rewards");
  const fuel = await normaliseFuelBatch(fuelInput, ledger.fuel);
  const sessions = await normaliseSessionBatch(sessionsInput, ledger.sessions);
  const by_day = mergeDayBreakdowns(trips.by_day, rewards.by_day, fuel.by_day, sessions.by_day);

  ledger.trips.push(...trips.rows);
  ledger.rewards.push(...rewards.rows);
  ledger.fuel.push(...fuel.rows);
  ledger.sessions.push(...sessions.rows);
  if (!dryRun) await writeLedger(env, ledger);

  return json({
    ok: true,
    dry_run: dryRun,
    trips: { received: trips.received, inserted: trips.inserted, updated: trips.updated, duplicates: trips.duplicates, ambiguous: trips.ambiguous },
    rewards: { received: rewards.received, inserted: rewards.inserted, duplicates: rewards.duplicates },
    fuel: { received: fuel.received, inserted: fuel.inserted, duplicates: fuel.duplicates, ambiguous: fuel.ambiguous },
    sessions: { received: sessions.received, inserted: sessions.inserted, updated: sessions.updated, duplicates: sessions.duplicates, ambiguous: sessions.ambiguous },
    by_day,
    received: total,
    inserted: trips.inserted + rewards.inserted + fuel.inserted + sessions.inserted,
    updated: trips.updated + sessions.updated,
    ambiguous: trips.ambiguous + fuel.ambiguous + sessions.ambiguous,
    duplicates: trips.duplicates + rewards.duplicates + fuel.duplicates + sessions.duplicates
  }, dryRun ? 200 : 201);
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health" && (method === "GET" || method === "HEAD")) {
    return json({ ok: true, service: "didi-dash", storage: env.DATA ? "kv" : "unavailable" });
  }

  if (path === "/api/ingest" && method === "POST") {
    return handleIngest(request, env);
  }

  if (method !== "GET" && method !== "HEAD") {
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
    return json({ trips, count: trips.length, total: filtered.length, limit, truncated: trips.length < filtered.length });
  }

  if (path === "/api/rewards") {
    const limit = safeLimit(url.searchParams.get("limit"));
    const filteredRewards = filterDateRange(ledger.rewards, url);
    const rewards = sorted(filteredRewards, limit);
    return json({ rewards, count: rewards.length, total: filteredRewards.length, limit, truncated: rewards.length < filteredRewards.length });
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
      const dashboardDirectoryRoutes = new Set(["/inputs", "/inputs/", "/trips", "/trips/"]);
      const assetRequest = dashboardDirectoryRoutes.has(url.pathname)
        ? new Request(new URL("/", url), request)
        : request;
      const asset = await env.ASSETS.fetch(assetRequest);
      const headers = new Headers(asset.headers);
      headers.set("cache-control", "no-store, max-age=0, must-revalidate");
      headers.set("cdn-cache-control", "no-store");
      headers.set("cloudflare-cdn-cache-control", "no-store");
      return new Response(asset.body, {
        status: asset.status,
        statusText: asset.statusText,
        headers
      });
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
