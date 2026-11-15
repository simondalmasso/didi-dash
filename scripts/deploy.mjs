import { execFileSync } from "node:child_process";
import { chmodSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configPath = path.join(root, "wrangler.jsonc");
const secretsPath = path.join(root, ".wrangler-secrets.json");

function runWrangler(args) {
  const cli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
  execFileSync(process.execPath, [cli, ...args], { cwd: root, env: process.env, stdio: "inherit" });
}

async function main() {
  const credential = process.env.INGEST_TOKEN;
  if (typeof credential !== "string" || credential.length < 32) {
    throw new Error("INGEST_TOKEN must be supplied explicitly by the deployment environment.");
  }
  const dryRun = process.argv.slice(2).includes("--dry-run");
  writeFileSync(secretsPath, JSON.stringify({ INGEST_TOKEN: credential }), { mode: 0o600 });
  chmodSync(secretsPath, 0o600);
  try {
    console.log(dryRun ? "Running an authenticated Wrangler dry run; production will not be changed." : "Deploying Didi Dash Worker after the test gate...");
    const args = ["deploy", "--config", configPath, "--secrets-file", secretsPath];
    if (dryRun) args.push("--dry-run");
    runWrangler(args);
    console.log(dryRun ? "Wrangler dry run completed." : "Worker deployment command completed.");
  } finally {
    rmSync(secretsPath, { force: true });
  }
}

main().catch((error) => {
  console.error("Deployment failed:", error?.message ?? "UnknownError");
  process.exitCode = 1;
});
