// Honest structural checks. `astro build` requires node_modules (integration
// workflow covers it on demand).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("astro config + tsconfig present", () => {
  assert.ok(existsSync(join(ROOT, "astro.config.mjs")));
  const ts = JSON.parse(readFileSync(join(ROOT, "tsconfig.json"), "utf8"));
  assert.equal(ts.extends, "astro/tsconfigs/base");
});

test("layout + page structure", () => {
  const layout = readFileSync(join(ROOT, "src", "layouts", "Base.astro"), "utf8");
  assert.match(layout, /viewport/);
  const page = readFileSync(join(ROOT, "src", "pages", "index.astro"), "utf8");
  assert.match(page, /services\.map/);
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
console.log(`${tests.length} astro structure tests passed`);
