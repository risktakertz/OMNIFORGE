#!/usr/bin/env node
/**
 * OMNIFORGE e2e — runs the BUILT CLI through the one-sentence website path
 * (M1 acceptance) and asserts real artifacts + verification. Requires
 * `pnpm build` first. Browser-based E2E (Playwright) runs only when a browser
 * is installed; otherwise this suite reports the skip honestly.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(repoRoot, "apps", "cli", "dist", "index.js");
const failures = [];
const step = (name, fn) => {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failures.push(name);
    console.error(`FAIL - ${name}: ${e.message}`);
  }
};

console.log("omniforge e2e — built-CLI acceptance run\n");

step("doctor --json exits 0 with verified node", () => {
  const out = execFileSync("node", [CLI, "doctor", "--json"], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
  const rows = JSON.parse(out);
  if (!rows.some((r) => r.name === "node" && r.status === "verified")) throw new Error("node not verified");
});

step("create 'Create a responsive website for a local bakery' produces a verified site", () => {
  const out = execFileSync("node", [CLI, "create", "Create a responsive website for a local bakery"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 120_000,
  });
  if (!/verification: PASSED/.test(out)) throw new Error(`verification not passed:\n${out.slice(-400)}`);
  if (!/independent verifier: PASS/.test(out)) throw new Error("independent verifier did not pass");
});

step("generated site renders brand + contact and passes its own tests", () => {
  const projects = join(repoRoot, "projects");
  const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
  if (dirs.length === 0) throw new Error("no workspace created");
  const ws = join(projects, dirs[dirs.length - 1]);
  const html = readFileSync(join(ws, "dist", "index.html"), "utf8");
  if (!/Contact/.test(html)) throw new Error("no contact section");
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error("unrendered tokens");
  execFileSync("node", ["tests/site.test.mjs"], { cwd: ws, stdio: "pipe" });
});

step("export produces a downloadable artifact", () => {
  const projects = join(repoRoot, "projects");
  const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
  const ws = join(projects, dirs[dirs.length - 1]);
  const cfg = JSON.parse(readFileSync(join(ws, "project.config.json"), "utf8"));
  const out = execFileSync("node", [CLI, "export", cfg.id], { cwd: repoRoot, encoding: "utf8", timeout: 60_000 });
  if (!/\.tar\.gz/.test(out)) throw new Error(out);
});

step("deploy stays gated: dry-run works, real deploy typed-blocked", () => {
  const projects = join(repoRoot, "projects");
  const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
  const ws = join(projects, dirs[dirs.length - 1]);
  const cfg = JSON.parse(readFileSync(join(ws, "project.config.json"), "utf8"));
  const out = execFileSync("node", [CLI, "deploy", cfg.id, "--dry-run"], { cwd: repoRoot, encoding: "utf8" });
  if (!/NOTHING was published/.test(out)) throw new Error("dry-run must not publish");
  try {
    execFileSync("node", [CLI, "deploy", cfg.id], { cwd: repoRoot, encoding: "utf8", stdio: "pipe" });
    throw new Error("real deploy should have been blocked");
  } catch (e) {
    const err = e;
    const stderr = String(err.stderr || "");
    if (!stderr.includes("E_DEPLOY_BLOCKED")) throw new Error(`expected E_DEPLOY_BLOCKED, got: ${stderr.slice(0, 200)}`);
  }
});

// real browser E2E: runs when a browser is available; BLOCKED (exit 0, honest
// label) when not — never counted as a pass without a browser
{
  console.log("\nbrowser E2E phase:");
  const r = spawnSync(process.execPath, [join(repoRoot, "tests", "e2e", "browser.e2e.mjs")], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 300_000,
    stdio: "inherit",
  });
  if (r.status !== 0) failures.push("browser E2E");
}

// cleanup generated workspaces (they are git-ignored anyway)
const dir = join(repoRoot, "projects");
if (existsSync(dir)) {
  for (const d of readdirSync(dir)) {
    if (d !== ".gitkeep") rmSync(join(dir, d), { recursive: true, force: true });
  }
}
rmSync(join(repoRoot, "infra", "runs"), { recursive: true, force: true });
rmSync(join(repoRoot, "infra", "checkpoint-db", "graph"), { recursive: true, force: true });

if (failures.length > 0) {
  console.error(`\n${failures.length} e2e step(s) failed: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("\ne2e passed");
