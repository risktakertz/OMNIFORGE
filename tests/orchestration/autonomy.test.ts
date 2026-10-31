/**
 * Autonomy integration tests (mission C3 + M4):
 *  - executable skill entrypoints: validated, actually invoked, evidenced
 *  - cross-process resume: a killed run resumes in a NEW process from the
 *    durable checkpoint store with exactly-once side effects
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import { invokeSkill } from "@omniforge/orchestration";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("C3: executable skill registry", () => {
  const reg = new CapabilityRegistry([join(repoRoot, "skills")], join(repoRoot, "templates"));

  it("testing skill declares an executable entrypoint that exists on disk", () => {
    reg.rescan();
    const ep = reg.entrypointOf("skill:testing");
    expect(ep).toBe("scripts/run-project-tests.mjs");
    expect(existsSync(join(repoRoot, "skills", "testing", ep!))).toBe(true);
    expect(reg.get("skill:testing").availability).toBe("configured");
  });

  it("a skill declaring a MISSING entrypoint file is blocked (never simulated)", () => {
    const root = mkdtempSync(join(tmpdir(), "of-skill-ep-"));
    try {
      const dir = join(root, "ghost-skill");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "SKILL.md"),
        "---\nname: ghost-skill\ndescription: \"declares an entrypoint that does not exist on disk\"\nentrypoint: scripts/ghost.mjs\n---\n\nbody\n",
        "utf8"
      );
      const r2 = new CapabilityRegistry([root], null);
      const scan = r2.rescan();
      const meta = scan.skills.find((sk) => sk.id === "ghost-skill")!;
      expect(meta.validationErrors.join(" ")).toMatch(/entrypoint missing/);
      expect(r2.get("skill:ghost-skill").availability).toBe("blocked");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("invokeSkill actually executes the entrypoint and returns typed evidence", () => {
    // build a minimal workspace whose suite passes
    const ws = mkdtempSync(join(tmpdir(), "of-skill-ws-"));
    try {
      writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test ok.test.mjs" } }, null, 2));
      writeFileSync(join(ws, "ok.test.mjs"), "import test from 'node:test';\ntest('ok', () => {});\n", "utf8");
      const gateway = new ToolGateway(defaultContext([ws, repoRoot]));
      const inv = invokeSkill(gateway, repoRoot, reg, "skill:testing", { workspacePath: ws }, { timeoutMs: 60_000 });
      expect(inv.status).toBe("passed");
      expect(inv.exitCode).toBe(0);
      expect(inv.evidence.commandOrTool).toContain("run-project-tests.mjs");
      expect(inv.evidence.exitStatus).toBe("0");
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("invokeSkill reports a failing suite as a typed failure (with the real output)", () => {
    const ws = mkdtempSync(join(tmpdir(), "of-skill-ws2-"));
    try {
      writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "t", type: "module", scripts: { test: "node --test bad.test.mjs" } }, null, 2));
      writeFileSync(join(ws, "bad.test.mjs"), "import test from 'node:test';\nimport assert from 'node:assert';\ntest('nope', () => { assert.equal(1, 2); });\n", "utf8");
      const gateway = new ToolGateway(defaultContext([ws, repoRoot]));
      const inv = invokeSkill(gateway, repoRoot, reg, "skill:testing", { workspacePath: ws }, { timeoutMs: 60_000 });
      expect(inv.status).toBe("failed");
      expect(inv.exitCode).not.toBe(0);
      expect(inv.message).toMatch(/nope|assert/i);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("invokeSkill refuses skills without an entrypoint (typed gap, not simulation)", () => {
    const gateway = new ToolGateway(defaultContext([repoRoot]));
    expect(() => invokeSkill(gateway, repoRoot, reg, "skill:architecture", {})).toThrow(/E_CAPABILITY_MISSING/);
  });
});

describe("M4: cross-process resume from durable state", () => {
  it("a run killed mid-flight resumes in a NEW process with exactly-once workspace effects", async () => {
    const runsRoot = mkdtempSync(join(tmpdir(), "of-xproc-runs-"));
    const checkpointRoot = mkdtempSync(join(tmpdir(), "of-xproc-ckpt-"));
    const child = join(repoRoot, "tests", "orchestration", "resume-child.mjs");
    try {
      // process 1: start a run and die hard (SIGKILL mid-execute via injected failure)
      const first = spawnSync(process.execPath, [child, "start", repoRoot, runsRoot, checkpointRoot], {
        encoding: "utf8",
        timeout: 120_000,
      });
      const firstOut = JSON.parse(String(first.stdout ?? "").trim().split("\n").pop() ?? "{}") as { runId: string; threw: boolean };
      expect(firstOut.threw).toBe(true);
      const runId = firstOut.runId!;
      expect(runId).toMatch(/^run_/);

      // snapshot workspace count for the request BEFORE resume
      const projectsBefore = readdirSync(join(repoRoot, "projects")).filter((d) => d.startsWith("cross-proc"));

      // process 2: resume the SAME thread id from the durable store
      const second = spawnSync(process.execPath, [child, "resume", repoRoot, runsRoot, checkpointRoot, runId], {
        encoding: "utf8",
        timeout: 120_000,
      });
      expect(second.status).toBe(0);
      const secondOut = JSON.parse(String(second.stdout ?? "").trim().split("\n").pop() ?? "{}") as { passed: boolean; workspacePath: string };
      expect(secondOut.passed).toBe(true);

      // exactly-once: no duplicate workspaces were created across processes
      const projectsAfter = readdirSync(join(repoRoot, "projects")).filter((d) => d.startsWith("cross-proc"));
      expect(projectsAfter.length).toBeLessThanOrEqual(projectsBefore.length + 1);
      expect(existsSync(join(secondOut.workspacePath, "dist", "index.html"))).toBe(true);
      // durable evidence: journal + dag state exist
      expect(existsSync(join(runsRoot, runId, "journal.jsonl"))).toBe(true);
      expect(existsSync(join(runsRoot, runId, "dag-state.json"))).toBe(true);
      const dag = JSON.parse(readFileSync(join(runsRoot, runId, "dag-state.json"), "utf8")) as { tasks: Record<string, { status: string }> };
      const statuses = Object.values(dag.tasks).map((t) => t.status);
      expect(statuses.filter((s) => s === "passed").length).toBeGreaterThanOrEqual(10);
    } finally {
      rmSync(runsRoot, { recursive: true, force: true });
      rmSync(checkpointRoot, { recursive: true, force: true });
      for (const d of readdirSync(join(repoRoot, "projects"))) {
        if (d.startsWith("cross-proc")) rmSync(join(repoRoot, "projects", d), { recursive: true, force: true });
      }
    }
  }, 240_000);
});

void execFileSync;
