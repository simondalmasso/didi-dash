import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { createCompanionServer } from "../companion/server.mjs";

const TOKEN = "secret-token-that-must-never-leave-companion";
const ORIGIN = "https://didi-dash.simondalmasso44.workers.dev";
const WORKER_URL = "https://didi-dash.simondalmasso44.workers.dev/api/ingest";

function requestWithRawHost(url, path, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, url), {
      method: "GET",
      headers
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function fixture(t, options = {}) {
  const upstreamCalls = [];
  const fetchImpl = options.fetchImpl ?? (async (url, init) => {
    upstreamCalls.push({ url: String(url), init });
    return new Response(JSON.stringify({
      ok: true,
      dry_run: String(url).includes("dry=1"),
      trips: { received: 1, inserted: 1 }
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  const app = createCompanionServer({
    token: TOKEN,
    origin: ORIGIN,
    port: 0,
    fetchImpl,
    now: options.now ?? (() => 1_800_000_000_000)
  });
  await new Promise((resolve, reject) => {
    app.server.once("error", reject);
    app.server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => app.server.close(resolve)));
  const address = app.server.address();
  return {
    app,
    upstreamCalls,
    url: `http://127.0.0.1:${address.port}`,
    host: `127.0.0.1:${address.port}`,
    request(path, init = {}) {
      return fetch(`${this.url}${path}`, {
        ...init,
        headers: {
          origin: ORIGIN,
          ...(init.headers ?? {})
        }
      });
    }
  };
}

async function pair(fx) {
  const response = await fx.request("/health");
  assert.equal(response.status, 200);
  return response.json();
}

test("companion binds only to IPv4 loopback and health returns an expiring nonce, never the token", async (t) => {
  const fx = await fixture(t);
  assert.equal(fx.app.server.address().address, "127.0.0.1");
  const response = await fx.request("/health");
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.companion, "didi-dash");
  assert.match(body.nonce, /^[a-f0-9]{64}$/);
  assert.equal(typeof body.expires_at, "number");
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(fx.upstreamCalls.length, 0);
});

test("wrong Origin and wrong Host are rejected before reaching the Worker", async (t) => {
  const fx = await fixture(t);
  const wrongOrigin = await fetch(fx.url + "/health", {
    headers: { origin: "https://evil.example" }
  });
  assert.equal(wrongOrigin.status, 403);

  const wrongHost = await requestWithRawHost(fx.url, "/health", {
    origin: ORIGIN,
    host: "evil.example"
  });
  assert.equal(wrongHost.status, 421);
  assert.equal(fx.upstreamCalls.length, 0);
});

test("CORS preflight is limited to the dashboard origin and the two import POST routes", async (t) => {
  const fx = await fixture(t);
  const allowed = await fx.request("/preview", {
    method: "OPTIONS",
    headers: {
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-companion-nonce"
    }
  });
  assert.equal(allowed.status, 204);
  assert.equal(allowed.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(allowed.headers.get("access-control-allow-methods"), "POST");
  assert.equal(
    allowed.headers.get("access-control-allow-headers"),
    "content-type,x-companion-nonce"
  );

  const denied = await fetch(fx.url + "/preview", {
    method: "OPTIONS",
    headers: {
      origin: "https://evil.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-companion-nonce"
    }
  });
  assert.equal(denied.status, 403);
});

test("preview forwards only to the fixed Worker dry-run URL with Bearer held by companion", async (t) => {
  const fx = await fixture(t);
  const { nonce } = await pair(fx);
  const payload = {
    trips: [{ date: "2026-11-11", start: "10:00", amount: 1000, km: 1, min: 4, platform: "didi" }],
    attacker_url: "https://evil.example/steal"
  };
  const response = await fx.request("/preview", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-companion-nonce": nonce
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dry_run, true);
  assert.equal(fx.upstreamCalls.length, 1);
  assert.equal(fx.upstreamCalls[0].url, WORKER_URL + "?dry=1");
  assert.equal(fx.upstreamCalls[0].init.method, "POST");
  assert.equal(fx.upstreamCalls[0].init.headers.authorization, "Bearer " + TOKEN);
  assert.deepEqual(JSON.parse(fx.upstreamCalls[0].init.body), payload);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("commit forwards only to the fixed Worker write URL and returns the Worker receipt", async (t) => {
  const fx = await fixture(t);
  const { nonce } = await pair(fx);
  const payload = { sessions: [{
    date: "2026-11-11", platform: "didi",
    connected_start: "08:00", connected_end: "16:00"
  }] };
  const response = await fx.request("/commit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-companion-nonce": nonce
    },
    body: JSON.stringify(payload)
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(fx.upstreamCalls.length, 1);
  assert.equal(fx.upstreamCalls[0].url, WORKER_URL);
  assert.equal(fx.upstreamCalls[0].init.headers.authorization, "Bearer " + TOKEN);
  assert.deepEqual(JSON.parse(fx.upstreamCalls[0].init.body), payload);
  assert.equal(JSON.stringify(body).includes(TOKEN), false);
});

test("invalid or expired pairing nonce and unknown routes never contact the Worker", async (t) => {
  let now = 1_800_000_000_000;
  const fx = await fixture(t, { now: () => now });
  const { nonce } = await pair(fx);
  const payload = JSON.stringify({ trips: [{ date: "2026-11-11" }] });
  const badNonce = await fx.request("/preview", {
    method: "POST",
    headers: { "content-type": "application/json", "x-companion-nonce": "wrong" },
    body: payload
  });
  assert.equal(badNonce.status, 403);

  now += 11 * 60 * 1000;
  const expired = await fx.request("/commit", {
    method: "POST",
    headers: { "content-type": "application/json", "x-companion-nonce": nonce },
    body: payload
  });
  assert.equal(expired.status, 403);

  const unknown = await fx.request("/arbitrary", { method: "POST", body: payload });
  assert.equal(unknown.status, 404);
  assert.equal(fx.upstreamCalls.length, 0);
});

test("malformed JSON, wrong content type, and oversized payloads are rejected", async (t) => {
  const fx = await fixture(t);
  const { nonce } = await pair(fx);
  const headers = { "x-companion-nonce": nonce };

  const wrongType = await fx.request("/preview", {
    method: "POST", headers: { ...headers, "content-type": "text/plain" }, body: "{}"
  });
  assert.equal(wrongType.status, 415);

  const malformed = await fx.request("/preview", {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: "{"
  });
  assert.equal(malformed.status, 400);

  const oversized = await fx.request("/preview", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024) })
  });
  assert.equal(oversized.status, 413);
  assert.equal(fx.upstreamCalls.length, 0);
});

test("upstream failure is sanitized and does not leak the token", async (t) => {
  const fx = await fixture(t, {
    fetchImpl: async () => { throw new Error("network error containing " + TOKEN); }
  });
  const { nonce } = await pair(fx);
  const response = await fx.request("/preview", {
    method: "POST",
    headers: { "content-type": "application/json", "x-companion-nonce": nonce },
    body: JSON.stringify({ trips: [{}] })
  });
  const body = await response.text();

  assert.equal(response.status, 502);
  assert.equal(body.includes(TOKEN), false);
  assert.equal(body.includes("network error"), false);
});
