const COLLECTION_FIELDS = {
  trips: [
    "id", "date", "start", "amount", "km", "km_source", "min", "duration_seconds", "platform", "source",
    "service_type", "modality", "breakdown", "breakdown_status",
    "fare_breakdown", "fare_total_ars", "adjusted_from_ars",
    "earnings_adjusted", "detail_verified"
  ],
  rewards: ["id", "date", "start", "amount", "label", "source"],
  fuel: ["id", "date", "odometer_km", "liters", "total_ars", "station", "full_tank"],
  sessions: ["id", "date", "platform", "connected_start", "connected_end", "odometer_start", "odometer_end"],
  withdrawals: ["id", "date", "amount_ars", "fee_ars", "reconciled", "source"]
};

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message) {
  throw new Error(message);
}

function isValidISODate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseImportJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(String(source));
  } catch {
    fail("El archivo no contiene JSON válido.");
  }

  if (Array.isArray(parsed)) return parsed;
  if (!isRecord(parsed)) fail("El backup debe ser un objeto JSON o un array de viajes.");

  for (const collection of Object.keys(COLLECTION_FIELDS)) {
    if (parsed[collection] !== undefined && !Array.isArray(parsed[collection])) {
      fail(collection + " debe ser un array.");
    }
  }
  if (parsed.truncated && isRecord(parsed.truncated) &&
      Object.values(parsed.truncated).some((value) => value === true)) {
    fail("El backup está truncado; no se puede importar.");
  }
  return parsed;
}

function pickFields(row, fields, collection) {
  if (!isRecord(row)) fail("Cada registro de " + collection + " debe ser un objeto.");
  const clean = {};
  for (const field of fields) {
    if (!Object.hasOwn(row, field)) continue;
    if (collection === "trips" && field === "fare_breakdown") {
      if (!isRecord(row[field])) fail("fare_breakdown debe ser un objeto.");
      const allowedFareFields = [
        "distance_ars", "time_ars", "wait_ars", "dynamic_base_ars",
        "differential_price_ars", "fare_reimbursement_ars"
      ];
      clean.fare_breakdown = Object.fromEntries(
        allowedFareFields
          .filter((fareField) => Object.hasOwn(row[field], fareField))
          .map((fareField) => [fareField, row[field][fareField]])
      );
    } else if (collection === "trips" && field === "breakdown") {
      if (!isRecord(row[field])) fail("breakdown debe ser un objeto.");
      if (!Array.isArray(row[field].components)) fail("breakdown.components debe ser un array.");
      clean.breakdown = {
        ...(Object.hasOwn(row[field], "source") ? { source: row[field].source } : {}),
        components: row[field].components.map((item) => {
          if (!isRecord(item)) fail("Cada componente del desglose debe ser un objeto.");
          return Object.fromEntries(["code", "label", "amount"]
            .filter((key) => Object.hasOwn(item, key))
            .map((key) => [key, item[key]]));
        })
      };
    } else {
      clean[field] = row[field];
    }
  }
  return clean;
}

function sessionIdentity(row) {
  return [
    row.date,
    String(row.platform ?? "").toLowerCase(),
    row.connected_start,
    row.connected_end
  ].join("|");
}

export function buildImportPayload(input, { includeLocalSessions = false } = {}) {
  const source = Array.isArray(input) ? { trips: input } : input;
  if (!isRecord(source)) fail("El backup debe ser un objeto JSON o un array de viajes.");

  if (source.truncated && isRecord(source.truncated) &&
      Object.values(source.truncated).some((value) => value === true)) {
    fail("El backup está truncado; no se puede importar.");
  }

  const payload = {};
  for (const collection of Object.keys(COLLECTION_FIELDS)) {
    const rows = source[collection] ?? [];
    if (!Array.isArray(rows)) fail(collection + " debe ser un array.");
    payload[collection] = rows.map((row) => pickFields(row, COLLECTION_FIELDS[collection], collection));
    if (collection === "fuel" && payload.fuel.some((row) => !isValidISODate(row.date))) {
      fail("Cada carga de combustible debe incluir una fecha válida (AAAA-MM-DD).");
    }
  }

  if (includeLocalSessions) {
    const localSessions = source.local_operating_settings?.vehicleSessions;
    if (!Array.isArray(localSessions)) {
      fail("No se encontró local_operating_settings.vehicleSessions para importar los turnos locales.");
    }
    const seen = new Set(payload.sessions.map(sessionIdentity));
    for (const row of localSessions) {
      const clean = pickFields(row, COLLECTION_FIELDS.sessions, "vehicleSessions");
      const identity = sessionIdentity(clean);
      if (seen.has(identity)) continue;
      seen.add(identity);
      payload.sessions.push(clean);
    }
  }

  const total = Object.values(payload).reduce((sum, rows) => sum + rows.length, 0);
  if (total < 1) fail("El archivo no contiene registros para importar.");
  return payload;
}
