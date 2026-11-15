import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
export const LOOPBACK_HOST = "127.0.0.1";
export const COMPANION_PORT = 43197;
export const DASHBOARD_ORIGIN = "https://didi-dash.simondalmasso44.workers.dev";
export const WORKER_INGEST_URL = "https://didi-dash.simondalmasso44.workers.dev/api/ingest";
const NONCE_TTL_MS = 10 * 60 * 1000;
const MAX_BODY_BYTES = 1024 * 1024;
const ALLOWED_HEADERS = new Set(["content-type", "x-companion-nonce"]);

function json(res, status, body, origin = null, extraHeaders = {}) {
  const headers = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cross-origin-resource-policy": "same-site",
    ...extraHeaders
  };
  if (origin) {
    headers["access-control-allow-origin"] = origin;
    headers.vary = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}

function isLoopback(address) {
  if (typeof address !== "string") return false;
  return address === "::1" ||
    address === "::ffff:127.0.0.1" ||
    /^127(?:\.\d{1,3}){3}$/.test(address);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function reject(res, status, code, message, origin = null) {
  json(res, status, { error: code, message }, origin);
}

async function readJson(req) {
  const contentType = req.headers["content-type"] ?? "";
  if (!String(contentType).toLowerCase().startsWith("application/json")) {
    const error = new Error("Expected application/json");
    error.status = 415;
    throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Request body is not valid JSON");
    error.status = 400;
    throw error;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    const error = new Error("Request body must be a JSON object");
    error.status = 400;
    throw error;
  }
  return body;
}

function readProtectedToken() {
  if (process.platform !== "win32") {
    throw new Error("The Windows companion can only read a DPAPI credential on Windows");
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("Windows user profile is unavailable");
  const credentialPath = join(localAppData, "DidiDash", "ingest-token.dpapi");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "Import-Module -Name (Join-Path (Join-Path $PSHOME 'Modules') (Join-Path 'Microsoft.PowerShell.Security' 'Microsoft.PowerShell.Security.psd1')) -Force -ErrorAction Stop",
    "$file = $env:DIDI_DASH_TOKEN_FILE",
    "if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { exit 2 }",
    "$cipher = Get-Content -LiteralPath $file -Raw",
    "$secure = ConvertTo-SecureString -String $cipher",
    "$pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)",
    "try { [Console]::Out.Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)) }",
    "finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }"
  ].join("\n");
  return execFileAsync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
  ], {
    windowsHide: true,
    maxBuffer: 4096,
    env: { ...process.env, DIDI_DASH_TOKEN_FILE: credentialPath }
  }).then(({ stdout }) => {
    const token = String(stdout).trim();
    if (token.length < 16) throw new Error("Protected ingestion credential is missing or invalid");
    return token;
  }).catch(() => {
    throw new Error("Could not read the DPAPI-protected ingestion credential for this Windows user");
  });
}

export function createCompanionServer({
  token,
  origin = DASHBOARD_ORIGIN,
  port = COMPANION_PORT,
  fetchImpl = globalThis.fetch,
  now = Date.now
} = {}) {
  if (typeof token !== "string" || token.length < 16) {
    throw new TypeError("A protected ingestion token is required");
  }
  if (origin !== DASHBOARD_ORIGIN) {
    throw new TypeError("The production dashboard Origin is fixed and cannot be overridden");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("A fetch implementation is required");

  let activeNonce = "";
  let nonceExpiresAt = 0;

  const server = createServer(async (req, res) => {
    const requestOrigin = req.headers.origin ?? "";
    if (!isLoopback(req.socket.remoteAddress)) {
      reject(res, 403, "loopback_only", "Loopback clients only");
      return;
    }
    if (requestOrigin !== origin) {
      reject(res, 403, "origin_rejected", "Dashboard Origin is not allowed");
      return;
    }

    const address = server.address();
    const expectedHost = address && typeof address === "object"
      ? `${LOOPBACK_HOST}:${address.port}`
      : "";
    if (req.headers.host !== expectedHost) {
      reject(res, 421, "host_rejected", "Local Host header is not allowed", origin);
      return;
    }

    const requestUrl = new URL(req.url ?? "/", "http://127.0.0.1");
    const route = requestUrl.pathname;

    if (req.method === "OPTIONS" && ["/preview", "/commit"].includes(route) && !requestUrl.search) {
      const requestedMethod = req.headers["access-control-request-method"] ?? "";
      const requestedHeaders = String(req.headers["access-control-request-headers"] ?? "")
        .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
      if (requestedMethod !== "POST" || requestedHeaders.some((header) => !ALLOWED_HEADERS.has(header))) {
        reject(res, 403, "preflight_rejected", "Requested browser permissions are not allowed", origin);
        return;
      }
      res.writeHead(204, {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "POST",
        "access-control-allow-headers": "content-type,x-companion-nonce",
        "access-control-max-age": "300",
        "cache-control": "no-store",
        vary: "Origin, Access-Control-Request-Method, Access-Control-Request-Headers"
      });
      res.end();
      return;
    }

    if (route === "/health" && req.method === "GET" && !requestUrl.search) {
      activeNonce = randomBytes(32).toString("hex");
      nonceExpiresAt = now() + NONCE_TTL_MS;
      json(res, 200, {
        ok: true,
        companion: "didi-dash",
        nonce: activeNonce,
        expires_at: nonceExpiresAt
      }, origin);
      return;
    }

    if ((route !== "/preview" && route !== "/commit") || req.method !== "POST" || requestUrl.search) {
      reject(res, 404, "not_found", "Local companion route not found", origin);
      return;
    }

    const suppliedNonce = req.headers["x-companion-nonce"] ?? "";
    if (!activeNonce || now() > nonceExpiresAt || !safeEqual(suppliedNonce, activeNonce)) {
      reject(res, 403, "pairing_required", "Reconnect to the local companion and try again", origin);
      return;
    }

    let body;
    try {
      body = await readJson(req);
    } catch (error) {
      reject(res, error.status ?? 400, "request_rejected", error.message, origin);
      return;
    }

    const isPreview = route === "/preview";
    const target = isPreview ? `${WORKER_INGEST_URL}?dry=1` : WORKER_INGEST_URL;
    if (!isPreview) {
      activeNonce = "";
      nonceExpiresAt = 0;
    }

    try {
      const upstream = await fetchImpl(target, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const raw = await upstream.text();
      if (raw.includes(token)) {
        reject(res, 502, "worker_invalid_response", "Worker returned an unsafe response", origin);
        return;
      }
      let result;
      try {
        result = raw ? JSON.parse(raw) : {};
      } catch {
        reject(res, 502, "worker_invalid_response", "Worker returned an invalid response", origin);
        return;
      }
      json(res, upstream.status, result, origin);
    } catch {
      reject(res, 502, "worker_unavailable", "Could not reach the ingestion Worker", origin);
    }
  });

  return { server, host: LOOPBACK_HOST, port };
}

async function main() {
  const token = await readProtectedToken();
  const { server } = createCompanionServer({ token });
  server.listen(COMPANION_PORT, LOOPBACK_HOST, () => {
    process.stdout.write(`Didi Dash companion listening on http://${LOOPBACK_HOST}:${COMPANION_PORT}\n`);
    process.stdout.write("Credential loaded from Windows DPAPI. No secret is displayed.\n");
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("Didi Dash companion could not start. Check the local credential setup.\n");
    process.exitCode = 1;
  });
}
