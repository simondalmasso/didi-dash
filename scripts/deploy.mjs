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

function readDpapiCredential() {
  if (process.platform !== "win32" || !process.env.LOCALAPPDATA) return "";
  const credentialPath = path.join(process.env.LOCALAPPDATA, "DidiDash", "ingest-token.dpapi");
  if (!existsSync(credentialPath)) return "";
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
  try {
    const token = execFileSync("powershell.exe", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script
    ], {
      encoding: "utf8",
      windowsHide: true,
      maxBuffer: 4096,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, DIDI_DASH_TOKEN_FILE: credentialPath }
    }).trim();
    if (token.length < 32) throw new Error("invalid");
    return token;
  } catch {
    throw new Error("The DidiDash DPAPI credential exists but could not be decrypted for this Windows user.");
  }
}

function readLegacyCredential() {
  const legacyPath = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "EtiosEarnings", "ingest-token.txt")
    : "";
  return legacyPath && existsSync(legacyPath) ? readFileSync(legacyPath, "utf8").trim() : "";
}

async function main() {
  // Prefer the DPAPI-protected credential used by the local Companion.
  // An explicitly supplied environment token remains an intentional override.
  const ingestToken = process.env.INGEST_TOKEN || readDpapiCredential() || readLegacyCredential();
  if (typeof ingestToken !== "string" || ingestToken.length < 32) {
    throw new Error("INGEST_TOKEN is unavailable. Configure the Windows DPAPI credential or the protected local fallback.");
  }
  const workerSecrets = { INGEST_TOKEN: ingestToken };
  const dryRun = process.argv.slice(2).includes("--dry-run");

  writeFileSync(secretsPath, JSON.stringify(workerSecrets), { mode: 0o600 });
  chmodSync(secretsPath, 0o600);
  try {
    console.log(dryRun
      ? "Running an authenticated Wrangler dry run; production will not be changed."
      : "Deploying Didi Dash Worker using the authenticated Wrangler profile...");
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
