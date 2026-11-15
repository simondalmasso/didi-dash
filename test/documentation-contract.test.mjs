import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const agents = read("../AGENTS.md");
const status = read("../docs/DATA-STATUS.md");
const readme = read("../README.md");
const schema = read("../docs/DATA-FINA-SCHEMA.md");

test("agent contract records privacy, safe preview/commit, fuel and verification boundaries", () => {
  assert.match(agents, /docs\/DATA-STATUS\.md/);
  assert.match(agents, /passenger names, phone numbers, pickup\/drop-off addresses/i);
  assert.match(agents, /\?dry=1/);
  assert.match(agents, /127\.0\.0\.1:43197/);
  assert.match(agents, /fuel record requires a valid date/i);
  assert.match(agents, /npm test/);
});

test("data status records the A22 2026-11-14 production reconciliation without passenger data", () => {
  assert.match(status, /18/);
  assert.match(status, /ARS 106,400/);
  assert.match(status, /96\.0 km/);
  assert.match(status, /14,135 s/);
  assert.match(status, /17 \/ 18/);
  assert.match(status, /22:25/);
  assert.match(status, /ARS 900 remains unexplained/);
  assert.match(status, /2026-11-14/);
  assert.match(status, /ARS 30,000/);
  assert.match(status, /three pre-existing undated/i);
  assert.match(status, /zero synced work sessions/i);
  assert.doesNotMatch(status, /\b\d{2,4} [A-Z][a-z]+ \d{1,4},/);
});

test("README documents detailed trip fields, timeline limits, DPAPI companion and preview", () => {
  assert.match(readme, /duration_seconds/);
  assert.match(readme, /fare_breakdown/);
  assert.match(readme, /daily journey timeline/i);
  assert.match(readme, /unclassified/i);
  assert.match(readme, /DPAPI-protected credential/i);
  assert.match(readme, /dry-run preview/i);
});
test("data-fina documentation records current live snapshot and six observed components", () => {
  assert.match(status, /209/);
  assert.match(status, /ARS 800,900/);
  assert.match(status, /ARS 109,300/);
  assert.match(status, /ARS 710,200/);
  assert.match(status, /668\.2 km/);
  assert.match(status, /109,811 seconds/);
  assert.match(status, /86\.9%/);
  assert.match(status, /17 reconciled detail screens/);
  assert.match(status, /ARS 100,000/);
  assert.match(status, /ARS 700,900/);
  for (const code of ["distancia", "tiempo", "espera", "base_dinamica", "diferencial", "reembolso_tarifario"]) {
    assert.match(schema, new RegExp(code));
    assert.match(agents, new RegExp(code));
  }
  assert.match(schema, /no equivale a cero/i);
  assert.match(schema, /tolerancia máxima de ARS 2/);
  assert.match(readme, /DATA-FINA-SCHEMA/);
});
