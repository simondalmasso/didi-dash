import test from "node:test";
import assert from "node:assert/strict";
import { buildTripTimeline } from "../public/trip-analytics.mjs";

test("buildTripTimeline sorts trips, derives ends from reported duration and leaves gaps unclassified", () => {
  const days = buildTripTimeline([
    { date: "2026-11-14", start: "12:25", amount: 3000, km: 2, km_source: "actual", min: 5, service_type: "Express" },
    { date: "2026-11-14", start: "12:00", amount: 2000, km: 3, km_source: "actual", min: 10, detail_verified: true }
  ]);
  assert.equal(days.length, 1);
  assert.equal(days[0].gross, 5000);
  assert.equal(days[0].travelMinutes, 15);
  assert.equal(days[0].actualKm, 5);
  assert.equal(days[0].trips[0].start, "12:00");
  assert.equal(days[0].trips[0].end, "12:10");
  assert.equal(days[0].trips[1].gapBeforeMinutes, 15);
  assert.equal(days[0].trips[1].gapKind, "unclassified");
  assert.equal(days[0].trips[1].serviceType, "Express");
});

test("buildTripTimeline keeps overnight trip end and excludes unknown durations from timeline math", () => {
  const days = buildTripTimeline([
    { date: "2026-11-14", start: "23:58", amount: 1500, km: 0, km_source: "unknown", min: 5, duration_seconds: 300 },
    { date: "2026-11-14", start: "23:40", amount: 1000, km: 1.2, km_source: "actual", min: 0 }
  ]);
  assert.equal(days[0].trips.length, 2);
  const overnight = days[0].trips.find((trip) => trip.start === "23:58");
  assert.equal(overnight.end, "00:03");
  assert.equal(overnight.endDayOffset, 1);
  assert.equal(overnight.durationSeconds, 300);
  assert.equal(days[0].actualKm, 1.2);
  assert.equal(days[0].travelMinutes, 5);
});
test("trip timeline reads canonical component breakdown and exact verification status", () => {
  const days = buildTripTimeline([
    {
      date: "2026-11-14", start: "20:54", amount: 3900, km: 1.2,
      km_source: "actual", min: 6.95, duration_seconds: 417,
      modality: "DiDi Express",
      breakdown: {
        source: "actual",
        components: [
          { code: "distancia", label: "Tarifa por distancia", amount: 500 },
          { code: "tiempo", label: "Tarifa por tiempo", amount: 900 },
          { code: "espera", label: "Tarifa por espera", amount: 100 },
          { code: "base_dinamica", label: "Tarifa base dinámica", amount: 1000 },
          { code: "diferencial", label: "Precio diferencial", amount: 1400 }
        ]
      }
    },
    {
      date: "2026-11-14", start: "22:25", amount: 6400, km: 4.8,
      km_source: "actual", min: 11.9167,
      fare_breakdown: { distance_ars: 1900, time_ars: 2600, dynamic_base_ars: 1000 },
      detail_verified: false
    }
  ]);
  const day = days[0];
  assert.equal(day.verifiedCount, 1);
  assert.equal(day.trips[0].serviceType, "DiDi Express");
  assert.equal(day.trips[0].fareBreakdown.status, "verified");
  assert.equal(day.trips[0].fareBreakdown.total, 3900);
  assert.equal(day.trips[1].fareBreakdown.status, "partial");
  assert.equal(day.trips[1].fareBreakdown.missingAmount, 900);
});
