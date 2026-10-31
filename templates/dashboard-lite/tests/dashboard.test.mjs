// Dashboard self-tests: filters, aggregates, role boundaries, output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyFilters, kpis, revenueByDate, visibleSections, canExportCsv, toCsv } from "../dist/dashboard-logic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "project.template.json"), "utf8"));
const rows = cfg.metrics;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("region filter", () => {
  const north = applyFilters(rows, { region: "north" });
  assert.ok(north.length > 0 && north.every((r) => r.region === "north"));
});
test("channel + region combined", () => {
  const out = applyFilters(rows, { region: "north", channel: "online" });
  assert.equal(out.length, 1);
});
test("kpis computed", () => {
  const k = kpis(rows);
  assert.equal(k.revenue, rows.reduce((s, r) => s + r.revenue, 0));
  assert.equal(k.orders, rows.reduce((s, r) => s + r.orders, 0));
  assert.ok(k.avgOrderValue > 0);
});
test("revenueByDate sorted and aggregated", () => {
  const series = revenueByDate(rows);
  assert.equal(series.length, 3);
  assert.ok(series[0].date < series[1].date);
});
test("role boundary: viewer cannot export or see admin panel", () => {
  assert.equal(canExportCsv(cfg.roles, "viewer"), false);
  assert.deepEqual(visibleSections(cfg.roles, "viewer"), ["overview"]);
  assert.equal(canExportCsv(cfg.roles, "admin"), true);
  assert.ok(visibleSections(cfg.roles, "admin").includes("admin-panel"));
});
test("unknown role falls back to no access", () => {
  assert.deepEqual(visibleSections(cfg.roles, "ghost"), []);
  assert.equal(canExportCsv(cfg.roles, "ghost"), false);
});
test("csv export shape", () => {
  const csv = toCsv(rows);
  assert.match(csv, /^date,region,channel,revenue,orders\n/);
  assert.equal(csv.split("\n").length, rows.length + 1);
});
test("rendered output: no tokens, viewport, admin hidden by default", () => {
  const html = readFileSync(join(ROOT, "dist", "index.html"), "utf8");
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /id="admin-panel"[^>]*hidden/);
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
}
if (failed) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} dashboard tests passed`);
