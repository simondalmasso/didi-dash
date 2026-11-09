const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const PLATFORM_RE = /^[a-z][a-z0-9_-]{1,19}$/;
const SOURCE_RE = /^[a-z][a-z0-9_-]{1,31}$/;
const encoder = new TextEncoder();

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function validDate(value) {
  if (typeof value !== "string" || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireDate(value) {
  if (!validDate(value)) throw new Error("date must be a real YYYY-MM-DD date");
  return value;
}

function requireTime(value, field) {
  if (typeof value !== "string" || !TIME_RE.test(value)) {
    throw new Error(`${field} must use HH:mm (24-hour)`);
  }
  return value;
}

function finiteNumber(value, field, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    throw new Error(`${field} is outside the accepted range`);
  }
  return number;
}

function safeLabel(value, field, maxLength = 40) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") throw new Error(`${field} must be text`);
  const clean = value.trim();
  // Keep only coarse zone labels, not street addresses or numeric house details.
  if (clean.length > maxLength || !/^[\p{L}\p{M} .'-]+$/u.test(clean)) {
    throw new Error(`${field} must be a coarse zone label, not an address`);
  }
  return clean;
}

function safeId(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.length > 128 || !/^[A-Za-z0-9:_-]+$/.test(value)) {
    throw new Error("id must contain only letters, numbers, :, _ or - (max 128)");
  }
  return value;
}

function platformName(value) {
  const platform = String(value ?? "").trim().toLowerCase();
  if (!PLATFORM_RE.test(platform)) throw new Error("platform must be a short identifier such as didi or uber");
  return platform;
}

export async function stableId(parts) {
  const bytes = encoder.encode(parts.join("|"));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function normaliseTrip(input) {
  assertObject(input, "trip");
  const date = requireDate(input.date);
  const start = requireTime(input.start, "start");
  const amount = finiteNumber(input.amount, "amount", { min: 1, max: 100000000, integer: true });
  const km = finiteNumber(input.km, "km", { min: 0, max: 1000 });
  const min = finiteNumber(input.min, "min", { min: 0, max: 1440 });
  const platform = platformName(input.platform);
  const source = String(input.source ?? "sentinelx_ocr").trim().toLowerCase();
  if (!SOURCE_RE.test(source)) throw new Error("source must be a short identifier");
  const providedId = safeId(input.id);
  const id = providedId ?? await stableId([
    date, start, String(amount), km.toFixed(3), min.toFixed(2), platform
  ]);

  // Whitelist the trip contract; passenger or location fields are never persisted.
  return { id, date, start, amount, km, min, platform, source };
}

export async function normaliseFuelLog(input) {
  assertObject(input, "fuel log");
  const date = requireDate(input.date);
  const odometer_km = finiteNumber(input.odometer_km, "odometer_km", { min: 0, max: 10000000 });
  const liters = finiteNumber(input.liters, "liters", { min: 0.01, max: 200 });
  const total_ars = finiteNumber(input.total_ars, "total_ars", { min: 1, max: 100000000 });
  const station = safeLabel(input.station, "station", 60);
  const full_tank = input.full_tank === true || input.full_tank === 1 ? 1 : 0;
  const providedId = safeId(input.id);
  const id = providedId ?? await stableId([
    date, String(odometer_km), liters.toFixed(3), String(total_ars), station ?? "", String(full_tank)
  ]);
  return { id, date, odometer_km, liters, total_ars, price_per_liter: total_ars / liters, station, full_tank };
}

export async function normaliseWorkSession(input) {
  assertObject(input, "work session");
  const date = requireDate(input.date);
  const platform = platformName(input.platform);
  const connected_start = requireTime(input.connected_start, "connected_start");
  const connected_end = requireTime(input.connected_end, "connected_end");

  const toMinutes = (time) => {
    const [hour, minute] = time.split(":").map(Number);
    return hour * 60 + minute;
  };
  const start = toMinutes(connected_start);
  let end = toMinutes(connected_end);
  if (end <= start) end += 24 * 60;
  const connected_minutes = end - start;
  if (connected_minutes > 16 * 60) throw new Error("connected session cannot exceed 16 hours");

  const hasStartOdo = input.odometer_start != null && input.odometer_start !== "";
  const hasEndOdo = input.odometer_end != null && input.odometer_end !== "";
  if (hasStartOdo !== hasEndOdo) throw new Error("odometer_start and odometer_end must be supplied together");

  const odometer_start = hasStartOdo
    ? finiteNumber(input.odometer_start, "odometer_start", { min: 0, max: 10000000 })
    : null;
  const odometer_end = hasEndOdo
    ? finiteNumber(input.odometer_end, "odometer_end", { min: 0, max: 10000000 })
    : null;
  if (odometer_start != null && odometer_end < odometer_start) {
    throw new Error("odometer_end cannot be lower than odometer_start");
  }
  const odometer_km = odometer_start == null ? null : odometer_end - odometer_start;

  const providedId = safeId(input.id);
  const id = providedId ?? await stableId([
    date, platform, connected_start, connected_end,
    odometer_start == null ? "" : String(odometer_start),
    odometer_end == null ? "" : String(odometer_end)
  ]);

  return {
    id, date, platform, connected_start, connected_end, connected_minutes,
    odometer_start, odometer_end, odometer_km
  };
}
