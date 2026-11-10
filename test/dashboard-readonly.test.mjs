import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("dashboard exposes no manual-entry controls", () => {
  assert.doesNotMatch(dashboard, /<\s*(?:form|input|select|textarea)\b/i);
  assert.doesNotMatch(dashboard, /addEventListener\(\s*["']submit["']/i);
  assert.doesNotMatch(dashboard, /\$\(["'][^"']+["']\)\.value\b/);
  assert.doesNotMatch(dashboard, /data-remove-(?:expense|local-session|local-fuel)/);
  assert.match(dashboard, /Solo lectura/i);
});

test("read-only dashboard keeps previously saved browser data and financial calculations", () => {
  assert.match(dashboard, /localStorage\.getItem\(LOCAL_SETTINGS_KEY\)/);
  assert.match(dashboard, /calculateProfitability\(/);
  assert.match(dashboard, /api\("\/api\/fuel\?limit=/);
  assert.match(dashboard, /api\("\/api\/sessions\?limit=/);
});
