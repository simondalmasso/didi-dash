import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const secretsPath = path.join(root, ".wrangler-secrets.json");

function required(name, minLength = 1) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length < minLength) {
    throw new Error("Missing or too-short required environment variable: " + name);
  }
  return value;
}

function runWrangler(args) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
}

async function main() {
  const ingestToken = required("INGEST_TOKEN", 32);
  const workerSecrets = { INGEST_TOKEN: ingestToken };

  writeFileSync(secretsPath, JSON.stringify(workerSecrets), { mode: 0o600 });
  chmodSync(secretsPath, 0o600);

  try {
    console.log("Deploying Etios Earnings using the authenticated Wrangler profile...");
    runWrangler(["deploy", "--config", configPath, "--secrets-file", secretsPath]);
    console.log("Worker deployment command completed.");
  } finally {
    rmSync(secretsPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Deployment failed:", error?.message ?? "UnknownError");
  process.exitCode = 1;
});
