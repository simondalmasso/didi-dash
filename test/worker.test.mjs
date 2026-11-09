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


test("dashboard login issues an HttpOnly, Secure, Strict session cookie", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/session", {
    method: "POST",
    headers: {
      origin: "https://didi-dash.example.workers.dev",
      "content-type": "application/json"
    },
    body: JSON.stringify({ password: "correct-horse-battery-staple" })
  });
  const response = await worker.fetch(request, {
    DASHBOARD_PASSWORD: "correct-horse-battery-staple",
    SESSION_SECRET: "s".repeat(48),
    DB: {
      prepare() {
        return { bind() { return {
          first: async () => null,
          run: async () => ({ success: true })
        }; } };
      }
    }
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.expires_in, 12 * 60 * 60);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /Max-Age=43200/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\//);
  assert.match(cookie, /__Host-didi_dash_session=/);
});

test("JSON backup is private and refuses unauthenticated access", async () => {
  const request = new Request("https://didi-dash.example.workers.dev/api/export");
  const response = await worker.fetch(request, {
    SESSION_SECRET: "s".repeat(48),
    DB: {}
  });
  assert.equal(response.status, 401);
});

test("ingestion inserts a repeated trip once and reports the duplicate", async () => {
  const inserted = new Set();
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          return { sql, values };
        }
      };
    },
    async batch(statements) {
      return statements.map((statement) => {
        const id = statement.values[0];
        if (inserted.has(id)) return { meta: { changes: 0 } };
        inserted.add(id);
        return { meta: { changes: 1 } };
      });
    }
  };
  const trip = {
    date: "2026-11-03",
    start: "17:35",
    amount: 2300,
    km: 2.7,
    min: 9.9,
    platform: "didi"
  };
  const request = new Request("https://didi-dash.example.workers.dev/api/ingest", {
    method: "POST",
    headers: {
      authorization: "Bearer " + "i".repeat(40),
      "content-type": "application/json"
    },
    body: JSON.stringify({ trips: [trip, trip] })
  });
  const response = await worker.fetch(request, {
    INGEST_TOKEN: "i".repeat(40),
    DB: db
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    ok: true, received: 2, inserted: 1, duplicates: 1
  });
});


test("login blocks an IP after five incorrect passwords", async () => {
  let failures = 0;
  let blockedUntil = 0;
  const db = {
    prepare(sql) {
      return {
        bind(...values) {
          if (sql.includes("SELECT blocked_until FROM login_attempts")) {
            return { first: async () => ({ blocked_until: blockedUntil }) };
          }
          if (sql.includes("INSERT INTO login_attempts")) {
            return { run: async () => {
              failures += 1;
              if (failures >= 5) blockedUntil = Math.floor(Date.now() / 1000) + 900;
            } };
          }
          if (sql.includes("DELETE FROM login_attempts")) {
            return { run: async () => { failures = 0; blockedUntil = 0; } };
          }
          throw new Error("Unexpected SQL in login rate-limit test");
        }
      };
    }
  };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const request = new Request("https://didi-dash.example.workers.dev/api/session", {
      method: "POST",
      headers: {
        origin: "https://didi-dash.example.workers.dev",
        "cf-connecting-ip": "203.0.113.7",
        "content-type": "application/json"
      },
      body: JSON.stringify({ password: "wrong-password-value" })
    });
    const response = await worker.fetch(request, {
      DASHBOARD_PASSWORD: "correct-password-value",
      SESSION_SECRET: "s".repeat(48), DB: db
    });
    assert.equal(response.status, 401);
  }
  const blockedRequest = new Request("https://didi-dash.example.workers.dev/api/session", {
    method: "POST",
    headers: {
      origin: "https://didi-dash.example.workers.dev",
      "cf-connecting-ip": "203.0.113.7",
      "content-type": "application/json"
    },
    body: JSON.stringify({ password: "wrong-password-value" })
  });
  const blocked = await worker.fetch(blockedRequest, {
    DASHBOARD_PASSWORD: "correct-password-value",
    SESSION_SECRET: "s".repeat(48), DB: db
  });
  assert.equal(blocked.status, 429);
});


test("remember me keeps the dashboard session for 30 days without storing the password", async () => {
  const db = {
    prepare(sql) {
      return { bind() { return {
        first: async () => null,
        run: async () => ({ success: true })
      }; } };
    }
  };
  const request = new Request("https://didi-dash.example.workers.dev/api/session", {
    method: "POST",
    headers: {
      origin: "https://didi-dash.example.workers.dev",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      password: "correct-horse-battery-staple",
      remember: true
    })
  });
  const response = await worker.fetch(request, {
    DASHBOARD_PASSWORD: "correct-horse-battery-staple",
    SESSION_SECRET: "s".repeat(48),
    DB: db
  });

  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.expires_in, 30 * 24 * 60 * 60);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /Max-Age=2592000/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes("correct-horse-battery-staple"), false);
});
