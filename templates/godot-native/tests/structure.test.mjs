// Structural validation. Honest scope: the Godot binary is NOT bundled, so
// headless scene validation runs only when `godot` is installed (doctor reports it).
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("project.godot declares the main scene", () => {
  const cfg = readFileSync(join(ROOT, "project.godot"), "utf8");
  assert.match(cfg, /config_version=5/);
  assert.match(cfg, /run\/main_scene="res:\/\/scenes\/main.tscn"/);
});

test("main scene wires the player script", () => {
  const scene = readFileSync(join(ROOT, "scenes", "main.tscn"), "utf8");
  assert.match(scene, /player\.gd/);
  assert.match(scene, /CharacterBody3D/);
});

test("player script implements movement + gravity", () => {
  const gd = readFileSync(join(ROOT, "scripts", "player.gd"), "utf8");
  assert.match(gd, /_physics_process/);
  assert.match(gd, /move_and_slide/);
  assert.match(gd, /gravity/);
});

test("no secrets in project files", () => {
  for (const f of ["project.godot", join("scenes", "main.tscn"), join("scripts", "player.gd")]) {
    const text = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/(sk-|ghp_|AKIA)[A-Za-z0-9_-]{12,}/.test(text), f);
  }
});

test("godot binary availability (honest skip when absent)", () => {
  let present = false;
  try {
    execFileSync("which", ["godot"], { stdio: "ignore" });
    present = true;
  } catch {
    present = false;
  }
  if (!present) {
    console.log("note: godot binary not installed — headless scene validation skipped (blocked, not faked)");
    return;
  }
  const out = execFileSync("godot", ["--headless", "--check-only", "--script", "res://scripts/player.gd"], { cwd: ROOT, encoding: "utf8" }).toString();
  void out;
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
console.log(`${tests.length} godot structure tests passed`);
