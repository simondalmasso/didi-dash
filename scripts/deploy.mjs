import { execFileSync } from "node:child_process";
import { chmodSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configTemplatePath = path.join(root, "wrangler.jsonc");
const generatedConfigPath = path.join(root, ".wrangler.generated.jsonc");
const secretsPath = path.join(root, ".wrangler-secrets.json");
const databaseName = "didi-dash";

function required(name, minLength = 1) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < minLength) {
    throw new Error(`Missing or too-short required environment variable: ${name}`);
  }
  return value;
}

async function cloudflareRequest(accountId, apiToken, endpoint, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}${endpoint}`, {
    ...options,
    headers: {
      authorization: `Bearer ${apiToken}`,
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare API returned an unreadable response (${response.status})`);
  }
  if (!response.ok || payload.success !== true) {
    const detail = Array.isArray(payload.errors)
      ? payload.errors.map((item) => item.message).filter(Boolean).join("; ")
      : "";
    throw new Error(`Cloudflare API failed (${response.status})${detail ? `: ${detail}` : ""}`);
  }
  return payload.result;
}

async function ensureDatabase(accountId, apiToken) {
  const query = new URLSearchParams({ name: databaseName, page: "1", per_page: "100" });
  const existing = await cloudflareRequest(accountId, apiToken, `/d1/database?${query}`);
  if (Array.isArray(existing) && existing.length > 1) {
    throw new Error(`More than one D1 database is named ${databaseName}; resolve the duplicate in Cloudflare first.`);
  }
  if (Array.isArray(existing) && existing.length === 1) {
    const id = existing[0].uuid ?? existing[0].id;
    if (!id) throw new Error("Cloudflare returned a D1 database without a UUID");
    console.log(`Using existing D1 database: ${databaseName}`);
    return id;
  }

  const created = await cloudflareRequest(accountId, apiToken, "/d1/database", {
    method: "POST",
    body: JSON.stringify({ name: databaseName })
  });
  const id = created?.uuid ?? created?.id;
  if (!id) throw new Error("Cloudflare created the D1 database but did not return its UUID");
  console.log(`Created D1 database: ${databaseName}`);
  return id;
}

function runWrangler(args, env) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    stdio: "inherit"
  });
}

async function main() {
  const accountId = required("CLOUDFLARE_ACCOUNT_ID", 20);
  const apiToken = required("CLOUDFLARE_API_TOKEN", 20);
  const dashboardPassword = required("DASHBOARD_PASSWORD", 18);
  const ingestToken = required("INGEST_TOKEN", 32);
  const sessionSecret = required("SESSION_SECRET", 32);

  const databaseId = await ensureDatabase(accountId, apiToken);
  const config = JSON.parse(readFileSync(configTemplatePath, "utf8"));
  config.d1_databases[0].database_id = databaseId;

  const workerSecrets = {
    DASHBOARD_PASSWORD: dashboardPassword,
    INGEST_TOKEN: ingestToken,
    SESSION_SECRET: sessionSecret
  };

  writeFileSync(generatedConfigPath, JSON.stringify(config, null, 2), { mode: 0o600 });
  writeFileSync(secretsPath, JSON.stringify(workerSecrets), { mode: 0o600 });
  chmodSync(generatedConfigPath, 0o600);
  chmodSync(secretsPath, 0o600);

  const env = {
    ...process.env,
    CLOUDFLARE_ACCOUNT_ID: accountId,
    CLOUDFLARE_API_TOKEN: apiToken
  };

  try {
    console.log("Applying remote D1 migrations...");
    runWrangler([
      "d1", "migrations", "apply", databaseName,
      "--remote", "--config", generatedConfigPath
    ], env);

    console.log("Deploying Worker and private secrets...");
    runWrangler([
      "deploy",
      "--config", generatedConfigPath,
      "--secrets-file", secretsPath
    ], env);

    console.log("Deployment command completed.");
  } finally {
    rmSync(generatedConfigPath, { force: true });
    rmSync(secretsPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Deployment failed:", error?.message ?? "Unknown error");
  process.exitCode = 1;
});
