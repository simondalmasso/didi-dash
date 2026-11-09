import {
  normaliseFuelLog,
  normaliseTrip,
  normaliseWorkSession
} from "./domain.mjs";

const COOKIE_NAME = "__Host-didi_dash_session";
const SESSION_TTL_SECONDS = 12 * 60 * 60;
const MAX_BODY_BYTES = 1024 * 1024;
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

function base64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(value) {
  const normalised = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalised + "=".repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function createSessionToken(secret) {
  const nonce = new Uint8Array(16);
  crypto.getRandomValues(nonce);
  const payload = base64url(encoder.encode(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: base64url(nonce)
  })));
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload));
  return `${payload}.${base64url(new Uint8Array(signature))}`;
}

async function verifySessionToken(token, secret) {
  if (!secret || typeof token !== "string" || token.length > 2048) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      fromBase64url(parts[1]),
      encoder.encode(parts[0])
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(parts[0])));
    return Number.isInteger(payload.exp) && payload.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookieValue(request, name) {
  const header = request.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookie(token) {
  return `${COOKIE_NAME}=${token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; Secure; HttpOnly; SameSite=Strict`;
}

function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Strict`;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
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

function extractArray(body, key) {
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body[key])) return body[key];
  throw new HttpError(400, `Body must be an array or contain a ${key} array`);
}

async function insertTrips(db, input) {
  if (input.length < 1 || input.length > 500) {
    throw new HttpError(400, "Send between 1 and 500 trips per request");
  }
  const trips = [];
  for (const item of input) {
    try {
      trips.push(await normaliseTrip(item));
    } catch (error) {
      throw new HttpError(400, error.message);
    }
  }

  const statements = trips.map((trip) => db.prepare(
    `INSERT OR IGNORE INTO trips
      (id, date, start, amount, km, min, platform, source, origin_zone, destination_zone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    trip.id, trip.date, trip.start, trip.amount, trip.km, trip.min,
    trip.platform, trip.source, trip.origin_zone, trip.destination_zone
  ));

  const results = await db.batch(statements);
  const inserted = results.reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
  return { received: trips.length, inserted, duplicates: trips.length - inserted };
}

async function insertFuelLog(db, input) {
  let entry;
  try {
    entry = await normaliseFuelLog(input);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const result = await db.prepare(
    `INSERT OR IGNORE INTO fuel_logs
      (id, date, odometer_km, liters, total_ars, station, full_tank)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.id, entry.date, entry.odometer_km, entry.liters,
    entry.total_ars, entry.station, entry.full_tank
  ).run();
  const inserted = Number(result.meta?.changes ?? 0);
  return { inserted, duplicate: inserted === 0, entry: { ...entry, price_per_liter: entry.price_per_liter } };
}

async function insertWorkSession(db, input) {
  let entry;
  try {
    entry = await normaliseWorkSession(input);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  const result = await db.prepare(
    `INSERT OR IGNORE INTO work_sessions
      (id, date, platform, connected_start, connected_end, connected_minutes,
       odometer_start, odometer_end, odometer_km)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    entry.id, entry.date, entry.platform, entry.connected_start, entry.connected_end,
    entry.connected_minutes, entry.odometer_start, entry.odometer_end, entry.odometer_km
  ).run();
  const inserted = Number(result.meta?.changes ?? 0);
  return { inserted, duplicate: inserted === 0, entry };
}

async function requireSession(request, env) {
  if (!env.SESSION_SECRET) throw new HttpError(503, "Dashboard authentication is not configured");
  const token = cookieValue(request, COOKIE_NAME);
  if (!(await verifySessionToken(token, env.SESSION_SECRET))) {
    throw new HttpError(401, "Sign in to view this dashboard");
  }
}

async function listRows(db, table, limit = 5000) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 500, 1), 5000);
  const result = await db.prepare(
    `SELECT * FROM ${table} ORDER BY date DESC, created_at DESC LIMIT ?`
  ).bind(safeLimit).all();
  return result.results ?? [];
}

function validDateFilter(value) {
  if (value == null || value === "") return false;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

async function getTrips(request, db) {
  const url = new URL(request.url);
  const where = [];
  const values = [];
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const platform = url.searchParams.get("platform");
  if (from) {
    if (!validDateFilter(from)) throw new HttpError(400, "Invalid from date");
    where.push("date >= ?");
    values.push(from);
  }
  if (to) {
    if (!validDateFilter(to)) throw new HttpError(400, "Invalid to date");
    where.push("date <= ?");
    values.push(to);
  }
  if (platform) {
    if (!/^[a-z][a-z0-9_-]{1,19}$/i.test(platform)) throw new HttpError(400, "Invalid platform");
    where.push("platform = ?");
    values.push(platform.toLowerCase());
  }
  const limit = Math.min(Math.max(Number.parseInt(url.searchParams.get("limit") ?? "2000", 10) || 2000, 1), 5000);
  const sql = `SELECT id, date, start, amount, km, min, platform, source, origin_zone, destination_zone, created_at
    FROM trips ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY date DESC, start DESC LIMIT ?`;
  const result = await db.prepare(sql).bind(...values, limit).all();
  return json({ trips: result.results ?? [], count: result.results?.length ?? 0, limit });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();

  if (path === "/api/health" && method === "GET") {
    return json({ ok: true, service: "didi-dash", storage: env.DB ? "d1" : "unavailable" });
  }

  if (path === "/api/session" && method === "POST") {
    if (!sameOrigin(request)) throw new HttpError(403, "Cross-origin login is not allowed");
    if (!env.DASHBOARD_PASSWORD || !env.SESSION_SECRET) {
      throw new HttpError(503, "Dashboard secrets have not been configured");
    }
    const body = await readJson(request);
    if (typeof body.password !== "string" || !constantTimeEqual(body.password, env.DASHBOARD_PASSWORD)) {
      throw new HttpError(401, "Incorrect password");
    }
    const token = await createSessionToken(env.SESSION_SECRET);
    return json({ ok: true, expires_in: SESSION_TTL_SECONDS }, 200, {
      "set-cookie": sessionCookie(token)
    });
  }

  if (path === "/api/logout" && method === "POST") {
    if (!sameOrigin(request)) throw new HttpError(403, "Cross-origin logout is not allowed");
    return json({ ok: true }, 200, { "set-cookie": clearSessionCookie() });
  }

  if (path === "/api/ingest" && method === "POST") {
    if (!env.INGEST_TOKEN) throw new HttpError(503, "Ingestion is not configured");
    const authorization = request.headers.get("authorization") ?? "";
    const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!constantTimeEqual(supplied, env.INGEST_TOKEN)) throw new HttpError(401, "Invalid ingestion token");
    const body = await readJson(request);
    const records = await insertTrips(env.DB, extractArray(body, "trips"));
    return json({ ok: true, ...records }, 201);
  }

  if (path.startsWith("/api/")) {
    await requireSession(request, env);
    if (method !== "GET" && !sameOrigin(request)) {
      throw new HttpError(403, "Cross-origin writes are not allowed");
    }

    if (path === "/api/trips" && method === "GET") return getTrips(request, env.DB);
    if (path === "/api/trips" && method === "POST") {
      const body = await readJson(request);
      const records = await insertTrips(env.DB, extractArray(body, "trips"));
      return json({ ok: true, ...records }, 201);
    }
    if (path === "/api/fuel" && method === "GET") {
      const fuel = await listRows(env.DB, "fuel_logs", url.searchParams.get("limit"));
      return json({ fuel });
    }
    if (path === "/api/fuel" && method === "POST") {
      const body = await readJson(request);
      const result = await insertFuelLog(env.DB, body);
      return json({ ok: true, ...result }, result.inserted ? 201 : 200);
    }
    if (path === "/api/sessions" && method === "GET") {
      const sessions = await listRows(env.DB, "work_sessions", url.searchParams.get("limit"));
      return json({ sessions });
    }
    if (path === "/api/sessions" && method === "POST") {
      const body = await readJson(request);
      const result = await insertWorkSession(env.DB, body);
      return json({ ok: true, ...result }, result.inserted ? 201 : 200);
    }
    throw new HttpError(404, "API route not found");
  }

  throw new HttpError(404, "Not found");
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
      // Avoid logging request bodies, tokens, passenger details or financial records.
      console.error("Didi Dash API failure:", error?.name ?? "UnknownError");
      return errorResponse(500, "internal_error", "The request could not be completed");
    }
  }
};
