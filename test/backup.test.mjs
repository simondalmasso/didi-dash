import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { validateExport, stampFor, parseArgs } from "../scripts/backup-ledger.mjs";

const goodPayload = (overrides = {}) => ({
  schema_version: 3,
  exported_at: "2026-11-16T00:00:00.000Z",
  trips: [{ id: "a" }],
  rewards: [],
  fuel: [],
  sessions: [],
  withdrawals: [],
  truncated: { trips: false, rewards: false, fuel: false, sessions: false, withdrawals: false },
  ...overrides
});

test("validateExport accepts a complete export and counts each collection", () => {
  const result = validateExport(goodPayload({ withdrawals: [{ id: "w" }] }));
  assert.equal(result.ok, true);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.counts, { trips: 1, rewards: 0, fuel: 0, sessions: 0, withdrawals: 1 });
});

test("validateExport rejects a truncated collection instead of saving a partial backup", () => {
  const result = validateExport(goodPayload({
    truncated: { trips: true, rewards: false, fuel: false, sessions: false, withdrawals: false }
  }));
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /truncada/);
});

test("validateExport rejects payloads missing a collection", () => {
  const broken = goodPayload();
  delete broken.sessions;
  const result = validateExport(broken);
  assert.equal(result.ok, false);
  assert.match(result.errors.join("; "), /sessions/);
});

test("validateExport rejects non-object responses", () => {
  assert.equal(validateExport(null).ok, false);
  assert.equal(validateExport([1, 2]).ok, false);
  assert.equal(validateExport("texto").ok, false);
});

test("stampFor formats a UTC YYYYMMDD-HHMMSS stamp", () => {
  assert.equal(stampFor(new Date("2026-11-16T01:02:03Z")), "20261116-010203");
});

test("parseArgs honours --url (stripping trailing slashes) and --out", () => {
  const args = parseArgs(["node", "backup-ledger.mjs", "--url", "https://x.example/", "--out", "copia"], {});
  assert.equal(args.url, "https://x.example");
  assert.equal(args.dir, "copia");
});

test("parseArgs fails fast on unknown or incomplete flags", () => {
  assert.throws(() => parseArgs(["node", "b.mjs", "--nada", "x"], {}), /uso:/);
  assert.throws(() => parseArgs(["node", "b.mjs", "--url"], {}), /uso:/);
});

test("serializeBackup checksum matches the exact persisted UTF-8 bytes", async () => {
  const { serializeBackup } = await import("../scripts/backup-ledger.mjs");
  assert.equal(typeof serializeBackup, "function");
  const artifact = serializeBackup(goodPayload());
  assert.equal(artifact.content.endsWith("\n"), true);
  assert.equal(
    createHash("sha256").update(Buffer.from(artifact.content, "utf8")).digest("hex"),
    artifact.sha256
  );
});