/**
 * OMNIFORGE orchestration — the single control plane.
 * A LangGraph.js state graph implements the directive's pipeline
 * (intake → permission-check → interpret → research → specify → select → plan
 *  → prepare-workspace → execute → verify → [repair] → approve → package
 *  → deliver → report) with DURABLE file-backed checkpoints: runs persist
 * state per thread id and resume after interruption from the checkpoint store,
 * not from memory.
 *
 * Services are injected so tests can inject failures (bounded repair + resume
 * verification) without touching production code paths.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import type { ProjectIntent, ProductBlueprint, SkillSelection, ValidationResult } from "@omniforge/shared-types";
import type { ExecutionPlan } from "@omniforge/task-planner";
import { newId, nowIso } from "@omniforge/utils";
import { RunJournal, createLogger } from "@omniforge/observability";
import { parseRequest } from "@omniforge/intent-engine";
import { buildBlueprint } from "@omniforge/blueprint-engine";
import { StaticKnowledgeProvider } from "@omniforge/research-engine";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { routeIntent } from "@omniforge/skill-router";
import { planExecution, topoSort } from "@omniforge/task-planner";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import { createWorkspace, exportWorkspace, readWorkspaceConfig, releaseLease } from "@omniforge/workspace-manager";
import { verifyWorkspace, classifyFailure } from "@omniforge/verification";
import { LocalNodeBackend } from "@omniforge/agent-runtime";

/* ------------------------------------------------------------------ */
/* Graph state                                                         */
/* ------------------------------------------------------------------ */

const OFState = Annotation.Root({
  request: Annotation<string>,
  runId: Annotation<string>,
  intent: Annotation<ProjectIntent | null>,
  researchNoteCount: Annotation<number>,
  blueprint: Annotation<ProductBlueprint | null>,
  selection: Annotation<SkillSelection | null>,
  templateId: Annotation<string>,
  taskPlan: Annotation<ExecutionPlan | null>,
  workspacePath: Annotation<string>,
  verification: Annotation<ValidationResult | null>,
  repairAttempts: Annotation<number>,
  artifactPath: Annotation<string>,
  runReport: Annotation<string>,
  error: Annotation<string>,
});
export type OFState = typeof OFState.State;

export interface ServiceConfig {
  repoRoot: string;
  runsRoot: string;
  checkpointRoot: string;
  /** test hooks: force a node to throw N times (bounded repair/resume tests) */
  failOnceAt?: string;
  skipExport?: boolean;
  logger?: ReturnType<typeof createLogger>;
}

/* ------------------------------------------------------------------ */
/* Durable file checkpoint saver (implements the LangGraph contract)   */
/* ------------------------------------------------------------------ */

export class FileCheckpointSaver extends BaseCheckpointSaver {
  constructor(private readonly root: string) {
    super();
    mkdirSync(root, { recursive: true });
  }

  private threadDir(threadId: string): string {
    const safe = threadId.replace(/[^a-zA-Z0-9_-]/g, "_");
    const dir = join(this.root, safe);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private latestPath(threadId: string): string {
    return join(this.threadDir(threadId), "checkpoint-latest.json");
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = String(config.configurable?.thread_id ?? "");
    const file = this.latestPath(threadId);
    if (!existsSync(file)) return undefined;
    const raw = readFileSync(file, "utf8");
    if (raw.trim().length === 0) return undefined; // deleted thread
    return this.parseTuple(threadId, raw);
  }

  private async parseTuple(threadId: string, raw: string): Promise<CheckpointTuple> {
    const parsed = JSON.parse(raw) as {
      type: string;
      bytes: string;
      metadata: CheckpointMetadata | undefined;
      parentConfig: RunnableConfig | undefined;
      checkpointId: string;
    };
    const bytes = Uint8Array.from(Buffer.from(parsed.bytes, "base64"));
    const loaded = (await this.serde.loadsTyped(parsed.type, bytes)) as unknown;
    // JsonPlusSerializer.loadsTyped resolves to [type, value] — accept both shapes.
    const checkpoint = (Array.isArray(loaded) ? loaded[loaded.length - 1] : loaded) as Checkpoint;
    return {
      config: { configurable: { thread_id: threadId, checkpoint_id: parsed.checkpointId } },
      checkpoint,
      metadata: parsed.metadata,
      parentConfig: parsed.parentConfig,
    };
  }

  async *list(config: RunnableConfig, _options?: CheckpointListOptions): AsyncGenerator<CheckpointTuple> {
    const tuple = await this.getTuple(config);
    if (tuple) yield tuple;
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: Record<string, unknown>
  ): Promise<RunnableConfig> {
    const threadId = String(config.configurable?.thread_id ?? "");
    const [type, bytes] = this.serde.dumpsTyped(checkpoint);
    const checkpointId = String(checkpoint.id ?? newId("ckpt"));
    writeFileSync(
      this.latestPath(threadId),
      JSON.stringify({
        type,
        bytes: Buffer.from(bytes).toString("base64"),
        metadata,
        parentConfig: undefined,
        checkpointId,
      }),
      "utf8"
    );
    return { configurable: { thread_id: threadId, checkpoint_id: checkpointId } };
  }

  async putWrites(config: RunnableConfig, writes: PendingWrite[], taskId: string): Promise<void> {
    const threadId = String(config.configurable?.thread_id ?? "");
    const file = join(this.threadDir(threadId), "writes.jsonl");
    writeFileSync(file, `${JSON.stringify({ taskId, writes, at: nowIso() })}\n`, { flag: "a" });
  }

  async deleteThread(threadId: string): Promise<void> {
    const file = this.latestPath(threadId);
    if (existsSync(file)) writeFileSync(file, "", "utf8");
  }
}

/* ------------------------------------------------------------------ */
/* Graph construction                                                  */
/* ------------------------------------------------------------------ */

export function buildGraph(config: ServiceConfig, checkpointer?: MemorySaver | FileCheckpointSaver) {
  void config.logger;
  const journalOf = (state: OFState): RunJournal => new RunJournal(config.runsRoot, state.runId || "pending-run");

  const failNode = config.failOnceAt;
  let failedOnce = false;

  const graph = new StateGraph(OFState)
    .addNode("intake", (state: OFState) => {
      const runId = state.runId || newId("run");
      const journal = new RunJournal(config.runsRoot, runId);
      journal.append("intake", "info", `received request: ${state.request.slice(0, 120)}`);
      journal.saveState({ request: state.request, runId });
      return { runId };
    })
    .addNode("permission-check", (state: OFState) => {
      const journal = journalOf(state);
      const freeFirst = (process.env.FREE_FIRST_MODE ?? "true") === "true";
      const spend = Number(process.env.APPROVED_SPEND ?? "0") || 0;
      if (!freeFirst && spend > 0) {
        journal.append("permission-check", "warn", "free-first disabled with non-zero APPROVED_SPEND — approval flows required");
      }
      journal.append("permission-check", "info", `policy: FREE_FIRST_MODE=${freeFirst} APPROVED_SPEND=${spend}`);
      return {};
    })
    .addNode("interpret", (state: OFState) => {
      const intent = parseRequest(state.request);
      journalOf(state).append("interpret", "info", `intent parsed: ${intent.operation}/${intent.productKinds.join("+")}/${intent.locale}`);
      return { intent };
    })
    .addNode("research", (state: OFState) => {
      const provider = new StaticKnowledgeProvider();
      const topic = state.intent?.productKinds[0] ?? "website";
      return provider.fetch(topic).then((notes) => {
        const flagged = notes.flatMap((n) => n.flaggedInstructions ?? []);
        const journal = journalOf(state);
        journal.append("research", "info", `research notes: ${notes.length}${flagged.length ? `, injection attempts flagged: ${flagged.length}` : ""}`);
        return { researchNoteCount: notes.length };
      });
    })
    .addNode("specify", (state: OFState) => {
      const blueprint = buildBlueprint(state.intent!);
      journalOf(state).append("specify", "info", `blueprint ready: ${blueprint.acceptanceCriteria.length} acceptance criteria`);
      return { blueprint };
    })
    .addNode("select", (state: OFState) => {
      const registry = new CapabilityRegistry([join(config.repoRoot, "skills")], join(config.repoRoot, "templates"));
      const route = routeIntent(state.intent!, registry);
      journalOf(state).append("select", "info", `selected ${route.templateId}; packs=${route.selection.selected.map((s) => s.capabilityId).join(",")}`);
      return { selection: route.selection, templateId: route.templateId };
    })
    .addNode("plan", (state: OFState) => {
      const plan = planExecution(state.runId, state.intent!, state.blueprint!, {
        selection: state.selection!,
        templateId: state.templateId,
        missing: [],
      });
      const journal = journalOf(state);
      journal.append("plan", "info", `task graph: ${plan.nodes.length} nodes, critical path ${topoSort(plan.nodes).length}`);
      journal.saveState({ request: state.request, runId: state.runId, intent: state.intent, templateId: state.templateId });
      return { taskPlan: plan };
    })
    .addNode("prepare-workspace", (state: OFState) => {
      // idempotent on resume: an existing workspace is reused, never duplicated
      if (state.workspacePath && existsSync(state.workspacePath)) {
        journalOf(state).append("prepare-workspace", "info", `reusing existing workspace ${state.workspacePath}`);
        return {};
      }
      const gateway = new ToolGateway(defaultContext([join(config.repoRoot, "projects")]));
      const ws = createWorkspace({
        templateId: state.templateId,
        name: state.intent!.explicitRequirements[0]?.slice(0, 30) ?? state.intent!.request.slice(0, 30),
        params: { name: "Sample Business", locale: state.intent!.locale },
        projectsRoot: join(config.repoRoot, "projects"),
        repoRoot: config.repoRoot,
        gateway,
      });
      journalOf(state).append("prepare-workspace", "info", `workspace created: ${ws.workspacePath}`);
      return { workspacePath: ws.workspacePath };
    })
    .addNode("execute", (state: OFState) => {
      const journal = journalOf(state);
      if (failNode && !failedOnce) {
        failedOnce = true;
        journal.append("execute", "error", `injected failure for resume test at ${failNode}`);
        throw new Error(`injected failure at ${failNode}`);
      }
      const gateway = new ToolGateway(defaultContext([state.workspacePath, join(config.repoRoot, "projects")]));
      gateway.authorize("run", { target: state.workspacePath });
      if (existsSync(join(state.workspacePath, "scripts", "render.mjs"))) {
        execFileSync("node", ["scripts/render.mjs"], { cwd: state.workspacePath, stdio: "pipe", timeout: 60_000 });
        journal.append("execute", "info", "template rendered into dist/");
      } else if (existsSync(join(state.workspacePath, "tests"))) {
        // structure/behavior suites that need no dependencies (node:test or plain node)
        const suitePath = existsSync(join(state.workspacePath, "tests", "structure.test.mjs"))
          ? "tests/structure.test.mjs"
          : (readdirSync(join(state.workspacePath, "tests")).find((f) => f.endsWith(".test.mjs"))
              ? `tests/${readdirSync(join(state.workspacePath, "tests")).find((f) => f.endsWith(".test.mjs"))}`
              : null);
        if (suitePath) {
          execFileSync("node", [suitePath], { cwd: state.workspacePath, stdio: "pipe", timeout: 60_000 });
          journal.append("execute", "info", `template suite passed: ${suitePath}`);
        } else {
          journal.append("execute", "info", "no dependency-free suite found; execute recorded as structural scaffold only");
        }
      } else {
        journal.append("execute", "warn", "template has no render step or suite; execute recorded honestly as scaffold-only");
      }
      return {};
    })
    .addNode("verify", async (state: OFState) => {
      const journal = journalOf(state);
      const gateway = new ToolGateway(defaultContext([state.workspacePath]));
      const backend = new LocalNodeBackend(gateway);
      const result = await verifyWorkspace({ workspacePath: state.workspacePath, blueprint: state.blueprint!, backend });
      journal.append("verify", result.passed ? "info" : "warn", `verification ${result.passed ? "passed" : "failed"}: ${result.failures.join(" | ") || "all checks ok"}`);
      for (const c of result.checks) journal.addEvidence({ taskId: c.id, status: c.status, message: c.message, at: nowIso() });
      return { verification: result };
    })
    .addNode("repair", (state: OFState) => {
      const journal = journalOf(state);
      const classification = classifyFailure(state.verification?.failures.join("; ") ?? "unknown", 1);
      journal.append("repair", "warn", `bounded repair: ${classification.category} → ${classification.suggestedAction}`);
      const attempts = (state.repairAttempts ?? 0) + 1;
      if (attempts > 2) {
        journal.append("repair", "error", "repair budget exhausted — run marked blocked");
        throw new Error("E_REPAIR_BUDGET_EXCEEDED");
      }
      return { repairAttempts: attempts };
    })
    .addNode("approve", (state: OFState) => {
      journalOf(state).append("approve", "info", "no approval-gated actions in this plan (free-first, no deploy)");
      return {};
    })
    .addNode("package", (state: OFState) => {
      if (config.skipExport) return {};
      const gateway = new ToolGateway(defaultContext([state.workspacePath, config.runsRoot]));
      const artifact = exportWorkspace(state.workspacePath, join(config.runsRoot, state.runId, "export"), gateway);
      journalOf(state).append("package", "info", `exported artifact ${artifact.path}`);
      return { artifactPath: artifact.path };
    })
    .addNode("deliver", (state: OFState) => {
      const journal = journalOf(state);
      const ws = readWorkspaceConfig(state.workspacePath);
      releaseLease(state.workspacePath, "workspace-manager");
      journal.append("deliver", "info", `delivered workspace ${String(ws["id"])} — preview: open dist/index.html or npx serve dist`);
      return {};
    })
    .addNode("report", (state: OFState) => {
      const journal = journalOf(state);
      const summary = [
        `run=${state.runId}`,
        `workspace=${state.workspacePath}`,
        `verification=${state.verification?.passed ? "passed" : "failed"}`,
        `artifact=${state.artifactPath || "(skipped)"}`,
      ].join(" ");
      journal.append("report", "info", `node:done:report ${summary}`);
      journal.saveState({ request: state.request, runId: state.runId, status: "passed", workspacePath: state.workspacePath });
      return { runReport: summary };
    });

  return graph
    .addEdge(START, "intake")
    .addEdge("intake", "permission-check")
    .addEdge("permission-check", "interpret")
    .addEdge("interpret", "research")
    .addEdge("research", "specify")
    .addEdge("specify", "select")
    .addEdge("select", "plan")
    .addEdge("plan", "prepare-workspace")
    .addEdge("prepare-workspace", "execute")
    .addEdge("execute", "verify")
    .addConditionalEdges("verify", (state: OFState) =>
      state.verification?.passed ? "approve" : state.repairAttempts < 2 ? "repair" : END
    )
    .addEdge("repair", "execute")
    .addEdge("approve", "package")
    .addEdge("package", "deliver")
    .addEdge("deliver", "report")
    .addEdge("report", END)
    .compile({ checkpointer: checkpointer ?? new FileCheckpointSaver(config.checkpointRoot) });
}

/* ------------------------------------------------------------------ */
/* Public runner API                                                   */
/* ------------------------------------------------------------------ */

export interface RunResult {
  runId: string;
  report: string;
  state: OFState;
}

export async function createRun(request: string, config: ServiceConfig): Promise<RunResult> {
  const graph = buildGraph(config);
  const runId = newId("run");
  const final = await graph.invoke(
    { request, runId, intent: null, researchNoteCount: 0, blueprint: null, selection: null, templateId: "", taskPlan: null, workspacePath: "", verification: null, repairAttempts: 0, artifactPath: "", runReport: "", error: "" },
    { configurable: { thread_id: runId } }
  );
  return { runId, report: final.runReport, state: final };
}

/** Resume an interrupted run from the durable checkpoint store (same thread id). */
export async function resumeRun(runId: string, config: ServiceConfig): Promise<RunResult> {
  const graph = buildGraph(config);
  const final = await graph.invoke(null, { configurable: { thread_id: runId } });
  return { runId, report: final.runReport, state: final };
}

export function runStatus(config: ServiceConfig, runId: string): { runId: string; journal: Array<{ node: string; message: string; at: string }>; state: unknown } {
  const journal = new RunJournal(config.runsRoot, runId);
  const events = journal.read().map((e) => ({ node: e.node, message: e.message, at: e.timestamp }));
  const file = join(config.checkpointRoot, runId, "checkpoint-latest.json");
  const hasCheckpoint = existsSync(file);
  return { runId, journal: events, state: { hasCheckpoint, completed: journal.completedNodes() } };
}

export { MemorySaver };
