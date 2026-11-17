#!/usr/bin/env node
// Backup del ledger vivo de didi-dash: GET /api/export → validación → JSON con timestamp.
//
// El archivo queda en backups/ (gitignored): el repo es público y el backup es la
// información financiera completa. Copiarlo también a otro soporte (nube/PC).
// Procedimiento completo de restauración: docs/BACKUP-RESTORE.md
//
// Uso:
//   npm run backup
//   node scripts/backup-ledger.mjs --url https://didi-dash.simondalmasso44.workers.dev --out backups
//   npm run backup -- --url http://localhost:8787        (contra wrangler dev)

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";

export const DEFAULT_URL = "https://didi-dash.simondalmasso44.workers.dev";
export const COLLECTIONS = ["trips", "rewards", "fuel", "sessions", "withdrawals"];

/** Valida un payload de /api/export. Nunca lanza: devuelve {ok, errors, counts}. */
export function validateExport(payload) {
  const errors = [];
  const counts = {};
  if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, errors: ["la respuesta no es un objeto JSON"], counts: null };
  }
  for (const name of COLLECTIONS) {
    if (!Array.isArray(payload[name])) {
      errors.push(`colección "${name}" ausente o no es un array`);
    } else {
      counts[name] = payload[name].length;
    }
  }
  const truncated = payload.truncated ?? {};
  for (const name of COLLECTIONS) {
    if (truncated[name] === true) {
      errors.push(`colección "${name}" truncada: el backup sería incompleto`);
    }
  }
  if (typeof payload.exported_at !== "string") {
    errors.push("falta exported_at: la respuesta no parece un export del ledger");
  }
  return { ok: errors.length === 0, errors, counts };
}

/** Marca UTC YYYYMMDD-HHMMSS para el nombre de archivo. */
export function stampFor(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return String(now.getUTCFullYear()) + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate())
    + "-" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds());
}

export function parseArgs(argv, env = process.env) {
  const out = { url: env.DIDI_DASH_URL ?? DEFAULT_URL, dir: "backups" };
  for (let i = 2; i < argv.length; i += 2) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--url" && value) out.url = value.replace(/\/+$/, "");
    else if (flag === "--out" && value) out.dir = value;
    else throw new Error("uso: node scripts/backup-ledger.mjs [--url URL] [--out DIR]");
  }
  return out;
}

async function main() {
  const { url, dir } = parseArgs(process.argv, process.env);
  const response = await fetch(`${url}/api/export?_=${Date.now()}`, {
    headers: { accept: "application/json", "cache-control": "no-cache" }
  });
  if (!response.ok) {
    throw new Error(`GET ${url}/api/export respondió ${response.status} ${response.statusText}`);
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("la respuesta no es JSON válido (¿valor KV dañado?): NO se escribió nada");
  }
  const { ok, errors, counts } = validateExport(payload);
  if (!ok) {
    throw new Error("el export no pasó la validación — NO se escribió ningún archivo:\n  - " + errors.join("\n  - "));
  }
  const file = path.join(dir, `ledger-${stampFor()}.json`);
  const body = JSON.stringify(payload, null, 2);
  await mkdir(dir, { recursive: true });
  await writeFile(file, body + "\n");
  const sha256 = createHash("sha256").update(body).digest("hex");
  console.log(`[ok] ${file}`);
  console.log(`     ${COLLECTIONS.map((name) => `${name}: ${counts[name]}`).join(" · ")}`);
  console.log(`     exported_at ${payload.exported_at} · sha256 ${sha256.slice(0, 16)}…`);
  console.log("[i] backups/ no se commitea: copiar el archivo a otro soporte (regla 3-2-1).");
}

const invokedDirectly = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[error] ${error.message}`);
    process.exitCode = 1;
  });
}
