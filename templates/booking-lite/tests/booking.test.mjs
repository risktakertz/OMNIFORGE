// Booking self-tests: slot logic + rendered output.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSlots, nextOpenDays, availableSlots, isSlotAvailable, summarizeBooking } from "../dist/slots-logic.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = JSON.parse(readFileSync(join(ROOT, "project.template.json"), "utf8"));

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const monday = new Date(Date.UTC(2026, 10, 2, 0, 0, 0)); // a Monday

test("slots generated per open hours and slot length", () => {
  const slots = generateSlots(cfg.hours, monday.toISOString());
  // 9:00..17:00, 30-minute slots; the 16:30 slot ends exactly at close -> 16 slots
  assert.equal(slots.length, 16);
  assert.equal(new Date(slots[0]).getHours(), 9);
  assert.equal(new Date(slots[0]).getMinutes(), 0);
  assert.equal(new Date(slots.at(-1)).getHours(), 16);
  assert.equal(new Date(slots.at(-1)).getMinutes(), 30);
});

test("weekends excluded when configured", () => {
  const days = nextOpenDays(cfg.hours, monday.toISOString(), 10);
  for (const d of days) {
    const dow = new Date(d).getDay();
    assert.ok(dow !== 0 && dow !== 6);
  }
});

test("taken slots are not available", () => {
  const all = generateSlots(cfg.hours, monday.toISOString());
  const taken = [all[0], all[2]];
  const free = availableSlots(all, taken);
  assert.equal(free.length, all.length - 2);
  assert.equal(isSlotAvailable(all[0], taken), false);
  assert.equal(isSlotAvailable(all[1], taken), true);
});

test("booking summary is human readable and mentions business", () => {
  const all = generateSlots(cfg.hours, monday.toISOString());
  const s = summarizeBooking(cfg.services[1], all[0], cfg.business.name);
  assert.match(s, /Sample Studio/);
  assert.match(s, /Standard session/);
});

test("rendered page has viewport, a11y and no tokens", () => {
  const html = readFileSync(join(ROOT, "dist", "index.html"), "utf8");
  assert.doesNotMatch(html, /\{\{[A-Z_]+\}\}/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /role="status"/);
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
console.log(`${tests.length} booking tests passed`);
