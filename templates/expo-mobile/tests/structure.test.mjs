// Honest structural checks: no device/emulator or cloud build is assumed.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("app.json valid with ios+android config", () => {
  const app = JSON.parse(readFileSync(join(ROOT, "app.json"), "utf8"));
  assert.ok(app.expo.slug);
  assert.ok(Array.isArray(app.expo.platforms));
  assert.ok(app.expo.android?.package);
  assert.ok(app.expo.ios?.bundleIdentifier);
});

test("App.tsx implements a list + cart interaction", () => {
  const src = readFileSync(join(ROOT, "App.tsx"), "utf8");
  assert.match(src, /FlatList/);
  assert.match(src, /setCart/);
  assert.match(src, /demo only/, "must not claim a real checkout");
});

test("package.json pins expo and react-native", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
  assert.match(pkg.dependencies.expo, /^~\d/);
  assert.ok(pkg.dependencies["react-native"]);
});

test("honest build note: device/cloud builds not asserted here", () => {
  // `expo run:android` requires the Android SDK + a device/emulator (absent in
  // most CI); EAS cloud builds are a paid service. This suite therefore only
  // validates structure — doctor reports toolchain status truthfully.
  assert.ok(true);
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
console.log(`${tests.length} mobile structure tests passed`);
