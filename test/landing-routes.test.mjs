import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { dashboardPageFromPath } from "../public/finance.mjs";
const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
test("Helio is the root and the legacy panel is preserved at /panel/", () => {
  assert.equal(dashboardPageFromPath("/"), "trips");
  assert.equal(dashboardPageFromPath("/panel/"), "home");
  assert.equal(dashboardPageFromPath("/inputs/"), "inputs");
  assert.ok(html.includes('href="/" data-nav="trips">Helio'));
  assert.ok(html.includes('href="/panel/" data-nav="home">Panel'));
  assert.ok(html.includes('pathname.startsWith("/panel")'));
});

test("fuel dashboard route is distinct and linked from primary navigation", () => {
  assert.equal(dashboardPageFromPath("/fuel/"), "fuel");
  assert.ok(html.includes('href="/fuel/" data-nav="fuel">Nafta'));
  assert.ok(html.includes('data-area="fuel"'));
});
