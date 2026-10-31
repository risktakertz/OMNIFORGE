// Honest structural checks. `next build` requires node_modules (integration
// workflow installs and builds on demand).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("app router files present", () => {
  for (const f of ["app/layout.tsx", "app/page.tsx", "app/task-list.tsx"]) {
    assert.ok(existsSync(join(ROOT, f)), f);
  }
});

test("client component marks interactivity honestly", () => {
  const src = readFileSync(join(ROOT, "app", "task-list.tsx"), "utf8");
  assert.match(src, /"use client"/);
  assert.match(src, /useState/);
});

test("metadata + skip link present", () => {
  const layout = readFileSync(join(ROOT, "app", "layout.tsx"), "utf8");
  assert.match(layout, /Metadata/);
  assert.match(layout, /Skip to content/);
});

test("no secrets in template source", () => {
  const pkg = readFileSync(join(ROOT, "package.json"), "utf8");
  assert.ok(!/(sk-|ghp_|AKIA)[A-Za-z0-9_-]{12,}/.test(pkg));
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
console.log(`${tests.length} next-web structure tests passed`);
