// Honest structural checks. Building/signing requires the Rust toolchain and
// platform SDKs — never asserted here.
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("tauri.conf.json valid with identifier + bundle", () => {
  const conf = JSON.parse(readFileSync(join(ROOT, "src-tauri", "tauri.conf.json"), "utf8"));
  assert.match(conf.identifier, /^com\.[a-z]+\.[a-z]+/);
  assert.equal(conf.build.frontendDist, "../ui");
  assert.ok(conf.app.security.csp.includes("default-src 'self'"), "CSP must be restrictive");
});

test("Rust shell wires tauri::Builder", () => {
  const rs = readFileSync(join(ROOT, "src-tauri", "src", "main.rs"), "utf8");
  assert.match(rs, /tauri::Builder/);
  assert.match(rs, /generate_context/);
});

test("Cargo.toml pins tauri 2", () => {
  const toml = readFileSync(join(ROOT, "src-tauri", "Cargo.toml"), "utf8");
  assert.match(toml, /tauri = \{ version = "2"/);
});

test("ui entry exists with no external scripts", () => {
  const html = readFileSync(join(ROOT, "ui", "index.html"), "utf8");
  assert.ok(existsSync(join(ROOT, "ui", "index.html")));
  assert.doesNotMatch(html, /src="http/);
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
console.log(`${tests.length} tauri structure tests passed`);
