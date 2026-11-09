import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";

test("trip reads require an authenticated session", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/trips");
  const response = await worker.fetch(request, {
    SESSION_SECRET: "x".repeat(48),
    DB: {}
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, "request_rejected");
});

test("ingestion rejects requests without the separate bearer token", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ trips: [] })
  });
  const response = await worker.fetch(request, {
    INGEST_TOKEN: "ingest-secret-value-that-is-long-enough",
    DB: {}
  });
  assert.equal(response.status, 401);
});

test("dashboard login rejects cross-origin requests", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/session", {
    method: "POST",
    headers: {
      origin: "https://attacker.example",
      "content-type": "application/json"
    },
    body: JSON.stringify({ password: "password-that-is-long-enough" })
  });
  const response = await worker.fetch(request, {
    DASHBOARD_PASSWORD: "password-that-is-long-enough",
    SESSION_SECRET: "x".repeat(48),
    DB: {}
  });
  assert.equal(response.status, 403);
});

test("health endpoint returns status only and does not disclose trip records", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/health");
  const response = await worker.fetch(request, { DB: {} });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body, { ok: true, service: "didi-dash", storage: "d1" });
});
