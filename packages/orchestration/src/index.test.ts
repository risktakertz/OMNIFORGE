import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, resumeRun, runStatus, buildGraph, FileCheckpointSaver } from "./index.js";
import { MemorySaver } from "@langchain/langgraph";
import { RunJournal } from "@omniforge/observability";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const runsRoot = mkdtempSync(join(tmpdir(), "of-orc-runs-"));
const checkpointRoot = mkdtempSync(join(tmpdir(), "of-orc-ckpt-"));

const config = { repoRoot, runsRoot, checkpointRoot, logger: undefined };

afterAll(() => {
  rmSync(runsRoot, { recursive: true, force: true });
  rmSync(checkpointRoot, { recursive: true, force: true });
  // clean generated workspaces from the repo projects/ dir
  const projects = join(repoRoot, "projects");
  if (existsSync(projects)) {
    for (const d of readdirSync(projects)) {
      if (d !== ".gitkeep") rmSync(join(projects, d), { recursive: true, force: true });
    }
  }
});

describe("orchestration (LangGraph + durable checkpoints)", () => {
  it("runs the full pipeline and passes all acceptance checks", async () => {
    const result = await createRun("Create a responsive website for a local bakery", config);
    expect(result.state.verification?.passed).toBe(true);
    expect(result.state.blueprint?.acceptanceCriteria.length).toBeGreaterThan(3);
    expect(existsSync(join(result.state.workspacePath, "dist", "index.html"))).toBe(true);
    expect(existsSync(result.state.artifactPath)).toBe(true);
    const journal = new RunJournal(runsRoot, result.runId);
    const nodes = new Set(journal.read().map((e) => e.node));
    for (const n of ["intake", "interpret", "specify", "select", "plan", "prepare-workspace", "execute", "verify", "report"]) {
      expect(nodes.has(n)).toBe(true);
    }
  }, 60_000);

  it("persists checkpoints for every thread", async () => {
    const result = await createRun("Create a website for a salon", { ...config, skipExport: true });
    const status = runStatus(config, result.runId);
    expect((status.state as { hasCheckpoint: boolean }).hasCheckpoint).toBe(true);
  }, 60_000);

  it("resumes interrupted runs exactly-once from the durable store", async () => {
    const failing = { ...config, failOnceAt: "execute" as const };
    let runId: string | null = null;
    try {
      await createRun("Create a website for a barbershop", failing);
      throw new Error("expected injected failure");
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/injected failure/);
      // find the run whose journal contains the injected failure marker
      const { readFileSync: rf } = await import("node:fs");
      for (const d of readdirSync(runsRoot)) {
        const j = join(runsRoot, d, "journal.jsonl");
        if (existsSync(j) && rf(j, "utf8").includes("injected failure")) runId = d;
      }
    }
    expect(runId).toBeTruthy();
    const before = runStatus(config, runId!);
    expect((before.state as { hasCheckpoint: boolean }).hasCheckpoint).toBe(true);

    const resumed = await resumeRun(runId!, { ...config, skipExport: true });
    expect(resumed.state.verification?.passed).toBe(true);
    // exactly-once: the workspace created pre-interruption is reused, not duplicated
    const projects = readdirSync(join(repoRoot, "projects")).filter((d) => d.includes("barbershop"));
    expect(projects.length).toBeLessThanOrEqual(1);
  }, 90_000);

  it("compiles a graph with the file checkpointer and memory saver", () => {
    expect(() => buildGraph(config)).not.toThrow();
    expect(() => buildGraph(config, new MemorySaver())).not.toThrow();
  });

  it("file checkpointer round-trips checkpoints", async () => {
    const saver = new FileCheckpointSaver(mkdtempSync(join(tmpdir(), "of-ckpt-unit-")));
    const cfg = { configurable: { thread_id: "thread_unit" } } as never;
    const checkpoint = {
      v: 1,
      id: "ckpt_1",
      ts: new Date().toISOString(),
      channel_values: { request: "hello" },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    } as never;
    await saver.put(cfg as never, checkpoint, { source: "loop", step: 1, writes: {} } as never, {} as never);
    const tuple = await saver.getTuple(cfg as never);
    expect(tuple).toBeTruthy();
    expect((tuple!.checkpoint as { channel_values: { request: string } }).channel_values.request).toBe("hello");
    await saver.putWrites(cfg as never, [["test", 1]] as never, "task1");
    await saver.deleteThread("thread_unit");
    expect(await saver.getTuple(cfg as never)).toBeUndefined();
  });
});
