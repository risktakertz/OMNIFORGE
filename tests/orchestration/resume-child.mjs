#!/usr/bin/env node
/**
 * Cross-process resume test child (M4). Modes:
 *   start <repoRoot> <runsRoot> <checkpointRoot>  — start a run, die at the
 *     injected execute-node failure (simulating a killed process)
 *   resume <repoRoot> <runsRoot> <checkpointRoot> <runId> — resume the same
 *     thread id in THIS new process from the durable checkpoint store
 * Prints a JSON line as the last stdout line.
 */
import { createRun, resumeRun } from "../../packages/orchestration/dist/index.js";

const [mode, repoRoot, runsRoot, checkpointRoot, runIdIn] = process.argv.slice(2);
const config = { repoRoot, runsRoot, checkpointRoot };

if (mode === "start") {
  try {
    await createRun("Create a website for a cross-process barbershop", { ...config, failOnceAt: "execute" });
    console.log(JSON.stringify({ threw: false }));
  } catch (e) {
    const m = String(e.message);
    const runId = m.includes("injected failure") ? await findRunId(runsRoot) : null;
    console.log(JSON.stringify({ threw: true, runId, message: m.slice(0, 120) }));
  }
} else if (mode === "resume") {
  const result = await resumeRun(runIdIn, config);
  console.log(JSON.stringify({ passed: Boolean(result.state.verification?.passed), workspacePath: result.state.workspacePath }));
} else {
  console.error("usage: resume-child.mjs start|resume ...");
  process.exit(2);
}

async function findRunId(runsRoot) {
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const d of readdirSync(runsRoot)) {
    const j = join(runsRoot, d, "journal.jsonl");
    if (existsSync(j) && readFileSync(j, "utf8").includes("injected failure")) return d;
  }
  return null;
}
