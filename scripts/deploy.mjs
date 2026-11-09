import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const secretsPath = path.join(root, ".wrangler-secrets.json");

function runWrangler(args) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
}

async function main() {
  const localTokenPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "EtiosEarnings", "ingest-token.txt")
    : "";
  const ingestToken = process.env.INGEST_TOKEN
    ?? (localTokenPath && existsSync(localTokenPath) ? readFileSync(localTokenPath, "utf8").trim() : "");
  if (typeof ingestToken !== "string" || ingestToken.length < 32) {
    throw new Error("INGEST_TOKEN is missing; configure it in the environment or the protected local EtiosEarnings token file.");
  }
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
