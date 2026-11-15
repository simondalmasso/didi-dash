import { readTripBreakdown } from "./data-fina.mjs";

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const FARE_KEYS = [
  "distance_ars", "time_ars", "wait_ars", "dynamic_base_ars",
  "differential_price_ars", "fare_reimbursement_ars"
];

function timeToMinutes(value) {
  const match = typeof value === "string" ? TIME_RE.exec(value) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function formatTime(totalMinutes) {
  const minutes = ((totalMinutes % 1440) + 1440) % 1440;
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" +
    String(minutes % 60).padStart(2, "0");
}

function safeFareBreakdown(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.fromEntries(FARE_KEYS.map((key) => {
    const amount = Number(value[key]);
    return [key, Number.isFinite(amount) && amount >= 0 ? amount : null];
  }));
}

export function buildTripTimeline(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const startMinutes = timeToMinutes(row.start);
    if (startMinutes == null) continue;
    if (!grouped.has(row.date)) grouped.set(row.date, []);
    grouped.get(row.date).push({ row, startMinutes });
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([date, entries]) => {
      entries.sort((left, right) =>
        left.startMinutes - right.startMinutes ||
        String(left.row.id ?? "").localeCompare(String(right.row.id ?? ""))
      );
      let previousKnownEnd = null;
      const trips = entries.map(({ row, startMinutes }) => {
        const durationSeconds = Number.isInteger(Number(row.duration_seconds)) && Number(row.duration_seconds) > 0
          ? Number(row.duration_seconds)
          : finitePositive(row.min) > 0 ? Math.round(finitePositive(row.min) * 60) : null;
        const durationMinutes = durationSeconds == null ? null : durationSeconds / 60;
        const endAbsolute = durationMinutes == null ? null : startMinutes + durationMinutes;
        const gapBeforeMinutes = previousKnownEnd != null && startMinutes > previousKnownEnd
          ? Math.round((startMinutes - previousKnownEnd) * 100) / 100
          : null;
        const fareBreakdown = readTripBreakdown(row);
        const trip = {
          id: row.id ?? null,
          date,
          start: row.start,
          end: endAbsolute == null ? null : formatTime(endAbsolute),
          endDayOffset: endAbsolute == null ? null : Math.floor(endAbsolute / 1440),
          durationMinutes,
          durationSeconds,
          amount: finitePositive(row.amount),
          km: finitePositive(row.km),
          kmSource: row.km_source ?? (finitePositive(row.km) ? "actual" : "unknown"),
          serviceType: typeof row.modality === "string"
            ? row.modality
            : typeof row.service_type === "string" ? row.service_type : null,
          fareBreakdown,
          fareTotal: row.fare_total_ars == null ? null : finitePositive(row.fare_total_ars),
          detailVerified: fareBreakdown.status === "verified",
          gapBeforeMinutes,
          gapKind: gapBeforeMinutes == null ? null : "unclassified"
        };
        if (endAbsolute != null) {
          previousKnownEnd = Math.max(previousKnownEnd ?? 0, endAbsolute);
        }
        return trip;
      });
      return {
        date,
        tripCount: trips.length,
        gross: trips.reduce((sum, trip) => sum + trip.amount, 0),
        actualKm: trips.reduce((sum, trip) =>
          sum + (trip.kmSource === "actual" ? trip.km : 0), 0),
        travelMinutes: trips.reduce((sum, trip) => sum + (trip.durationMinutes ?? 0), 0),
        detailedCount: trips.filter((trip) => trip.fareBreakdown != null).length,
        verifiedCount: trips.filter((trip) => trip.detailVerified).length,
        trips
      };
    });
}
