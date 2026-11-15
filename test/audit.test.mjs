import assert from "node:assert/strict";
import test from "node:test";
import { auditLedger } from "../public/audit.mjs";

test("ledger audit marks a day complete only when every trip has actual distance and positive duration", () => {
  const audit = auditLedger({
    trips: [
      { id: "a", date: "2026-11-13", km: 5, km_source: "actual", min: 12 },
      { id: "b", date: "2026-11-13", km: 2, km_source: "actual", min: 6 }
    ],
    rewards: [], fuel: [], sessions: [],
    truncated: { trips: false, rewards: false, fuel: false, sessions: false }
  });
  assert.equal(audit.days[0].status, "Completo en ledger");
  assert.equal(audit.days[0].trips, 2);
  assert.equal(audit.days[0].actualKm, 2);
  assert.equal(audit.globalTruncated, false);
});

test("partial distance, estimated distance, or missing duration prevents a complete label", () => {
  const audit = auditLedger({
    trips: [
      { id: "a", date: "2026-11-12", km: 4, km_source: "actual", min: 10 },
      { id: "b", date: "2026-11-12", km: 0, km_source: "unknown", min: 0 },
      { id: "c", date: "2026-11-12", km: 3, km_source: "estimated", min: 8 }
    ],
    rewards: [], fuel: [], sessions: [], truncated: {}
  });
  assert.equal(audit.days[0].status, "Parcial en ledger");
  assert.equal(audit.days[0].actualKm, 1);
  assert.equal(audit.days[0].estimatedKm, 1);
  assert.equal(audit.days[0].unknownKm, 1);
  assert.equal(audit.days[0].missingDuration, 1);
});

test("any truncated collection prevents complete-ledger claims", () => {
  const audit = auditLedger({
    trips: [{ id: "a", date: "2026-11-13", km: 5, km_source: "actual", min: 12 }],
    rewards: [], fuel: [], sessions: [],
    truncated: { rewards: true }
  });
  assert.equal(audit.globalTruncated, true);
  assert.equal(audit.days[0].status, "Parcial en ledger");
  assert.match(audit.summary, /truncada/i);
});

test("zero synced Worker sessions is not interpreted as zero shifts worked", () => {
  const audit = auditLedger({ trips: [], rewards: [], fuel: [], sessions: [], truncated: {} });
  assert.equal(audit.sessionSyncStatus, "Sin turnos sincronizados");
  assert.notEqual(audit.sessionSyncStatus, "Sin turnos trabajados");
});

test("audit reports only counts and provenance, never claims comparison with A22", () => {
  const audit = auditLedger({
    trips: [{ id: "a", date: "2026-11-13", km: 5, km_source: "actual", min: 12, passenger_name: "secret", pickup_address: "secret" }],
    rewards: [{ id: "r", date: "2026-11-13", amount: 500 }],
    fuel: [], sessions: [], truncated: {}
  });
  assert.equal(audit.a22Comparison, "No comparado contra A22");
  assert.equal(audit.days[0].actualKm, 1);
  assert.equal(JSON.stringify(audit).includes("secret"), false);
});
