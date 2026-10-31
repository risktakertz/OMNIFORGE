#!/usr/bin/env node
/**
 * testing skill — executable entrypoint (mission C3).
 * Reads a JSON job from stdin: { workspacePath: string, timeoutMs?: number }
 * Runs the workspace's own declared test suite with argument-array execution
 * (no shell) and emits a JSON result on stdout:
 *   { skill: "testing", status: "passed|failed|skipped|blocked", exitCode,
 *     command, message }
 * A SKILL.md alone is instructions — this file is the actual integration.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return null;
  }
}

const job = readStdin();
if (!job || typeof job.workspacePath !== "string") {
  process.stdout.write(JSON.stringify({ skill: "testing", status: "failed", message: "input must be JSON {workspacePath}" }) + "\n");
  process.exit(2);
}
const ws = job.workspacePath;
const pkgPath = join(ws, "package.json");
if (!existsSync(pkgPath)) {
  process.stdout.write(JSON.stringify({ skill: "testing", status: "failed", message: "package.json missing" }) + "\n");
  process.exit(2);
}
const testScript = (JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {}).test;
if (!testScript) {
  process.stdout.write(JSON.stringify({ skill: "testing", status: "skipped", message: "no test script declared" }) + "\n");
  process.exit(0);
}
const direct = testScript.match(/^node\s+(\S+)\s*$/);
const nodeTest = testScript.startsWith("node --test");
let cmd, args;
if (direct) {
  cmd = "node";
  args = [direct[1]];
} else if (nodeTest) {
  cmd = "node";
  args = ["--test", ...testScript.replace(/^node\s+--test\s*/, "").split(/\s+/)];
} else if (existsSync(join(ws, "node_modules"))) {
  cmd = "npm";
  args = ["test", "--silent"];
} else {
  process.stdout.write(JSON.stringify({ skill: "testing", status: "blocked", message: "needs installed dependencies (npm install) — recorded BLOCKED, not passed" }) + "\n");
  process.exit(0);
}
const r = spawnSync(cmd, args, { cwd: ws, encoding: "utf8", timeout: job.timeoutMs ?? 90_000, stdio: ["ignore", "pipe", "pipe"] });
const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
const lines = out.split("\n").map((l) => l.trim()).filter(Boolean);
// carry the RELEVANT failure content in the typed message (formatting
// differs across node versions: failure markers first, summary as fallback)
const interesting = lines.filter((l) => /\u2716|not ok|AssertionError|failing tests|# fail|Error:/i.test(l)).slice(0, 4);
const failureMessage = (interesting.join(" | ") || lines.slice(-4).join(" | ")).slice(0, 500);
process.stdout.write(
  JSON.stringify({
    skill: "testing",
    status: r.status === 0 ? "passed" : "failed",
    exitCode: r.status,
    command: [cmd, ...args].join(" "),
    message: r.status === 0 ? "project suite passed" : failureMessage,
  }) + "\n"
);
process.exit(r.status === 0 ? 0 : 1);
