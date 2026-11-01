/**
 * OMNIFORGE orchestration — the single control plane.
 *
 * Mission upgrades (C4/C5/D1):
 *  - The task plan now GOVERNS execution: the `execute` node drives the
 *    project DAG through `executeDag` with real executors; task statuses live
 *    in one durable ledger (`dag-state.json` + journal) shared by CLI,
 *    graph and resume.
 *  - The repair node consumes REAL failure evidence via the bounded repair
 *    engine (`repair.ts`) and re-runs only failed tasks + regressions.
 *  - The verify phase compares against the ORIGINAL persisted blueprint
 *    (saved into the workspace before implementation), never against
 *    criteria derived from results.
 *  - `FileCheckpointSaver` writes atomically, keeps a versioned history with
 *    parent links, and falls back to the last valid checkpoint if the latest
 *    file is corrupt or truncated.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync, openSync, closeSync } from "node:fs";
import { join, resolve, dirname, relative, isAbsolute } from "node:path";
import {
  Annotation,
  END,
  MemorySaver,
  START,
  StateGraph,
} from "@langchain/langgraph";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
  type CheckpointListOptions,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  type ProjectIntent,
  type ProductBlueprint,
  type SkillSelection,
  type ValidationResult,
  type TaskNode,
  type GoalSpec,
} from "@omniforge/shared-types";
import { OmniforgeError } from "@omniforge/shared-types";
import type { ExecutionPlan } from "@omniforge/task-planner";
import { planExecution, topoSort } from "@omniforge/task-planner";
import { newId, nowIso, atomicWriteFile } from "@omniforge/utils";
import { RunJournal, createLogger } from "@omniforge/observability";
import { parseRequest } from "@omniforge/intent-engine";
import { buildGoalSpec, decomposeComposite, mergeModelGoalSpec, resolveGoalIntent } from "@omniforge/intent-engine";
import { buildBlueprint, buildWorkBlueprint } from "@omniforge/blueprint-engine";
import { StaticKnowledgeProvider } from "@omniforge/research-engine";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { routeIntent } from "@omniforge/skill-router";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import {
  createWorkspace,
  exportWorkspace,
  readWorkspaceConfig,
  recordProvenance,
  releaseLease,
  saveBlueprint,
} from "@omniforge/workspace-manager";
import { verifyWorkspace, independentFinalVerification } from "@omniforge/verification";
import { LocalNodeBackend, detectCodingBackend } from "@omniforge/agent-runtime";
import {
  executeDag,
  loadDagState,
  registerArtifact,
  requireArtifacts,
  resetFailedTasks,
  runWorkspaceScript,
  type DagContext,
  type TaskExecutor,
} from "./dag.js";
import { executeRepair, signatureOf } from "./repair.js";
import { composeAgentMvp } from "./agent-mvp.js";
import { invokeSkill } from "./skills.js";
import { writeAnalysis, type AnalysisSource } from "./analysis.js";
import { executionBlueprint, executeCodingTask, type CodingExecution } from "./coding.js";
import { selectExecutionRoute } from "@omniforge/agent-runtime";
import { reserveModelCall, type ModelCallPolicy } from "@omniforge/model-router";

/* ------------------------------------------------------------------ */
/* Graph state                                                         */
/* ------------------------------------------------------------------ */

const OFState = Annotation.Root({
  request: Annotation<string>,
  runId: Annotation<string>,
  intent: Annotation<ProjectIntent | null>,
  goalSpec: Annotation<GoalSpec | null>,
  needsBackend: Annotation<boolean>,
  researchNoteCount: Annotation<number>,
  blueprint: Annotation<ProductBlueprint | null>,
  selection: Annotation<SkillSelection | null>,
  templateId: Annotation<string>,
  taskPlan: Annotation<ExecutionPlan | null>,
  workspacePath: Annotation<string>,
  verification: Annotation<ValidationResult | null>,
  repairAttempts: Annotation<number>,
  repairHistory: Annotation<string[]>,
  artifactPath: Annotation<string>,
  runReport: Annotation<string>,
  error: Annotation<string>,
  dagSummary: Annotation<string>,
});
export type OFState = typeof OFState.State;

/**
 * Optional model-assisted interpreter hook (§4.2): when the operator has
 * authorized a model, the CLI wires it here; the deterministic core never
 * requires it. The hook receives the raw request and returns structured
 * goal fields — POLICY fields are merged only from the deterministic side
 * (mergeModelGoalSpec enforces this).
 */
export type ModelInterpreter = (request: string) => Promise<unknown>;

export interface ServiceConfig {
  interpreterPolicy?: ModelCallPolicy;
  coding?: CodingExecution;
  analysisSource?: AnalysisSource;
  repoRoot: string;
  runsRoot: string;
  checkpointRoot: string;
  /** test hooks: force a node to throw N times (bounded repair/resume tests) */
  failOnceAt?: string;
  skipExport?: boolean;
  logger?: ReturnType<typeof createLogger>;
  /** authorized model-assisted interpretation (absent ⇒ honest NEEDS_MODEL) */
  modelInterpreter?: ModelInterpreter;
}

/* ------------------------------------------------------------------ */
/* Durable file checkpoint saver v2 (atomic, versioned, parent-linked) */
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

  private historyPath(threadId: string): string {
    return join(this.threadDir(threadId), "history.json");
  }

  private readHistory(threadId: string): Array<{ id: string; parent: string | undefined; at: string }> {
    const p = this.historyPath(threadId);
    if (!existsSync(p)) return [];
    try {
      return JSON.parse(readFileSync(p, "utf8")) as Array<{ id: string; parent: string | undefined; at: string }>;
    } catch {
      return [];
    }
  }

  private atomicWrite(file: string, data: string): void {
    atomicWriteFile(file, data);
  }

  private async loadFile(file: string): Promise<CheckpointTuple | undefined> {
    if (!existsSync(file)) return undefined;
    const raw = readFileSync(file, "utf8");
    if (raw.trim().length === 0) return undefined; // deleted/empty thread
    try {
      return await this.parseTuple(raw);
    } catch {
      return undefined; // corrupt entry — caller falls back through history
    }
  }

  private async parseTuple(raw: string): Promise<CheckpointTuple> {
    const parsed = JSON.parse(raw) as {
      type: string;
      bytes: string;
      metadata: CheckpointMetadata | undefined;
      parentConfig: RunnableConfig | undefined;
      checkpointId: string;
      threadId?: string;
    };
    const bytes = Uint8Array.from(Buffer.from(parsed.bytes, "base64"));
    const loaded = (await this.serde.loadsTyped(parsed.type, bytes)) as unknown;
    // JsonPlusSerializer.loadsTyped resolves to [type, value] — accept both shapes.
    const checkpoint = (Array.isArray(loaded) ? loaded[loaded.length - 1] : loaded) as Checkpoint;
    return {
      config: { configurable: { thread_id: parsed.threadId ?? "", checkpoint_id: parsed.checkpointId } },
      checkpoint,
      metadata: parsed.metadata,
      parentConfig: parsed.parentConfig,
    };
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = String(config.configurable?.thread_id ?? "");
    const latest = await this.loadFile(this.latestPath(threadId));
    if (latest) return latest;
    // fall back through versioned history (latest-only files must never
    // silently lose the last valid state)
    const history = this.readHistory(threadId);
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i]!;
      const file = join(this.threadDir(threadId), `checkpoint-${entry.id}.json`);
      const tuple = await this.loadFile(file);
      if (tuple) return { ...tuple, config: { configurable: { thread_id: threadId, checkpoint_id: entry.id } } };
    }
    return undefined;
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
    const parentConfig = (checkpoint as { parent_config?: RunnableConfig }).parent_config;
    const payload = JSON.stringify({
      type,
      bytes: Buffer.from(bytes).toString("base64"),
      metadata,
      parentConfig,
      checkpointId,
      threadId,
    });
    // atomic latest + versioned copy (crash between them loses nothing:
    // history keeps the previous valid entry and latest is rename-atomic)
    this.atomicWrite(this.latestPath(threadId), payload);
    const versioned = join(this.threadDir(threadId), `checkpoint-${checkpointId}.json`);
    writeFileSync(versioned, payload, "utf8");
    const history = this.readHistory(threadId).filter((h) => h.id !== checkpointId);
    history.push({ id: checkpointId, parent: parentConfig ? String((parentConfig.configurable as { checkpoint_id?: string })?.checkpoint_id ?? "") : undefined, at: nowIso() });
    this.atomicWrite(this.historyPath(threadId), JSON.stringify(history.slice(-50), null, 2));
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
    const dir = this.threadDir(threadId);
    for (const f of readdirSync(dir)) {
      if (f.startsWith("checkpoint-") && f !== "checkpoint-latest.json") {
        try {
          unlinkSync(join(dir, f));
        } catch {
          /* best-effort cleanup */
        }
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Graph construction                                                  */
/* ------------------------------------------------------------------ */

const GRAPH_PHASE_TASKS = ["t:intake", "t:permission-check", "t:interpret", "t:research", "t:specify", "t:select", "t:plan", "t:prepare-workspace"];

export function buildGraph(config: ServiceConfig, checkpointer?: MemorySaver | FileCheckpointSaver) {
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
    .addNode("interpret", async (state: OFState) => {
      const intent = parseRequest(state.request);
      const journal = journalOf(state);
      journal.append("interpret", "info", `intent parsed: ${intent.operation}/${intent.productKinds.join("+")}/${intent.locale} novelty=${intent.novelty}`);
      // universal GoalSpec (§4.1) — the extensible contract the rest of the
      // pipeline reads; deterministic mapping keeps every field traceable
      let goalSpec = buildGoalSpec(intent);
      if (intent.novelty === "novel" && intent.operation !== "analyze") {
        if (config.modelInterpreter) {
          // §4.2: model-assisted structured extraction for unfamiliar domains.
          // Policy fields are NEVER taken from model output (merge enforces).
          try {
            const policy = config.interpreterPolicy;
            reserveModelCall(policy, { provider: policy?.provider ?? "", model: policy?.model ?? "", endpoint: policy?.endpoint ?? "" }, join(config.runsRoot, state.runId, "model-budget.json"));
            const modelFields = await config.modelInterpreter(state.request);
            goalSpec = mergeModelGoalSpec(goalSpec, modelFields);
            journal.append("interpret", "info", `model-assisted interpretation applied (hybrid, confidence=${goalSpec.confidence.toFixed(2)})`);
          } catch (e) {
            if (e instanceof OmniforgeError) throw e;
            journal.append("interpret", "warn", `model interpretation failed: ${(e as Error).message.slice(0, 140)} — typed blocker stands`);
            throw new OmniforgeError("E_INTENT_NOVEL", `model-assisted interpretation failed: ${(e as Error).message.slice(0, 140)}`, {
              request: state.request.slice(0, 200),
              hints: intent.domainHints,
              prerequisite: "verify the model interpreter is reachable and schema-compliant, then re-run",
            });
          }
        } else if (!config.coding) {
          // honest typed outcome: a novel request must NOT silently become a
          // known template — it needs model-assisted interpretation
          throw new OmniforgeError("E_NEEDS_MODEL", "request matches no known product capability — needs model-assisted interpretation (NEEDS_MODEL)", {
            request: state.request.slice(0, 200),
            hints: intent.domainHints,
            prerequisite: "configure an authorized model provider (see docs/MODEL_ROUTING.md), then re-run",
          });
        }
      }
      // §4.8 composite decomposition: multi-deliverable goals are split into
      // per-deliverable sub-goals, recorded for planning — never collapsed
      const parts = decomposeComposite(goalSpec);
      if (parts) {
        journal.append("interpret", "info", `composite goal decomposed into ${parts.length} sub-goals: ${parts.map((p) => p.requestedDeliverables[0]).join(" + ")}`);
      }
      return { intent: resolveGoalIntent(goalSpec, intent), goalSpec, needsBackend: intent.operation !== "analyze" && intent.novelty === "novel" };
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
      if (state.goalSpec!.requestedDeliverables.length > 1 || state.intent!.productKinds.length > 1) {
        throw new OmniforgeError("E_DELIVERABLE_UNSUPPORTED", "composite execution requires explicit dependency contracts for each deliverable; no component will be silently dropped", {
          deliverables: state.goalSpec!.requestedDeliverables.map((kind) => ({ kind, status: "blocked", prerequisite: "provide per-deliverable acceptance, inputs/outputs and dependency edges" })),
          productKinds: state.intent!.productKinds,
        });
      }
      let needsBackend = state.needsBackend;
      if (state.goalSpec!.operation !== "analyze" && !needsBackend) {
        try { routeIntent(state.intent!, new CapabilityRegistry([join(config.repoRoot, "skills")], join(config.repoRoot, "templates"))); }
        catch (error) {
          if (error instanceof OmniforgeError && ["E_SCOPE_EXCEEDS_DETERMINISTIC", "E_INTENT_NOVEL", "E_CAPABILITY_MISSING"].includes(error.code) && config.coding) needsBackend = true;
          else throw error;
        }
      }
      const blueprint = state.goalSpec!.operation === "analyze" ? buildWorkBlueprint(state.goalSpec!) : needsBackend ? executionBlueprint({ ...state.goalSpec!, functionalRequirements: state.intent!.explicitRequirements }, config.coding, state.request) : buildBlueprint(state.intent!);
      journalOf(state).append("specify", "info", `blueprint ready: ${blueprint.acceptanceCriteria.length} acceptance criteria (original requirements persisted at verify time)`);
      return { blueprint, needsBackend };
    })
    .addNode("select", async (state: OFState) => {
      if (state.needsBackend) {
        const route = selectExecutionRoute({ templateSufficient: false, requiresNovelCode: true, reason: state.goalSpec!.objective }, config.coding?.backend ?? null);
        if (route.route !== "backend") throw new OmniforgeError("code" in route ? route.code : "E_BACKEND_BLOCKED", route.reason);
        const health = await route.backend.health();
        if (health.status !== "verified") throw new OmniforgeError("E_BACKEND_BLOCKED", health.detail);
        return { templateId: "generator:backend", selection: { intentId: state.intent!.id, selected: [{ capabilityId: route.backend.id, role: "coding", reason: route.reason }], excluded: [], fallback: null, estimatedCost: "explicit task budget", approvalsRequired: [], evidence: [health.detail] } };
      }
      if (state.goalSpec!.operation === "analyze") {
        return { templateId: "generator:analysis", selection: { intentId: state.intent!.id, selected: [{ capabilityId: "skill:research", role: "analysis", reason: "authorized structural inventory" }], excluded: [], fallback: null, estimatedCost: "0 USD", approvalsRequired: [], evidence: [] } };
      }
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
      journal.append("plan", "info", `task graph: ${plan.nodes.length} nodes, critical path ${topoSort(plan.nodes).length} — DAG will govern execution`);
      journal.saveState({ request: state.request, runId: state.runId, intent: state.intent, templateId: state.templateId, selection: state.selection });
      return { taskPlan: plan };
    })
    .addNode("prepare-workspace", (state: OFState) => {
      // idempotent on resume: an existing workspace is reused, never duplicated
      if (state.workspacePath && existsSync(state.workspacePath)) {
        journalOf(state).append("prepare-workspace", "info", `reusing existing workspace ${state.workspacePath}`);
        // ensure the ORIGINAL blueprint is persisted (legacy workspace repair)
        const ws = { workspacePath: state.workspacePath };
        const gateway = new ToolGateway(defaultContext([state.workspacePath, join(config.repoRoot, "projects")]));
        saveBlueprint(ws.workspacePath, state.blueprint!, gateway);
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
      // persist the ORIGINAL acceptance criteria BEFORE implementation
      const bpPath = saveBlueprint(ws.workspacePath, state.blueprint!, gateway);
      if (state.needsBackend && config.coding?.acceptanceFiles) {
        for (const [rel, content] of Object.entries(config.coding.acceptanceFiles)) {
          const path = resolve(ws.workspacePath, rel);
          const within = relative(ws.workspacePath, path);
          if (isAbsolute(within) || within.startsWith("..")) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "acceptance fixture path escaped workspace");
          gateway.checkPath(path);
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, content);
        }
        recordProvenance(ws.workspacePath, Object.keys(config.coding.acceptanceFiles), gateway);
      }
      // generator-mode products are composed, not copied from a template
      if (state.templateId === "generator:agent-mvp") {
        const composed = composeAgentMvp(ws.workspacePath, state.intent!, gateway);
        // compose-time provenance manifest: the execution trust boundary later
        // compares workspace scripts against these hashes (§6.2)
        const prov = recordProvenance(ws.workspacePath, composed.files, gateway);
        journalOf(state).append("prepare-workspace", "info", `agent-MVP composed: ${composed.files.length} original files written; provenance manifest: ${prov}`);
      }
      journalOf(state).append("prepare-workspace", "info", `workspace created: ${ws.workspacePath}; original blueprint persisted: ${bpPath}`);
      return { workspacePath: ws.workspacePath };
    })
    .addNode("execute", async (state: OFState) => {
      const journal = journalOf(state);
      if (failNode && !failedOnce) {
        failedOnce = true;
        journal.append("execute", "error", `injected failure for resume test at ${failNode}`);
        throw new Error(`injected failure at ${failNode}`);
      }
      const plan = state.taskPlan!;
      const dagCtx: DagContext = { journal, runsRoot: config.runsRoot, runId: state.runId, env: { workspacePath: state.workspacePath }, artifactLedger: new Map() };
      const templatesRoot = join(config.repoRoot, "templates");

      const executors: Record<string, TaskExecutor> = {
        execute: async (node: TaskNode) => {
          const ws = state.workspacePath;
          if (state.needsBackend) {
            const result = await executeCodingTask(config.coding!, ws, state.blueprint!, node.id, join(config.runsRoot, state.runId));
            registerArtifact(dagCtx, { taskId: node.id, kind: "coding-diff", path: result.evidencePath, summary: result.changedFiles.join(", ") });
            return { status: "passed", message: "scoped backend implementation independently verified", artifacts: [result.evidencePath], evidence: [{ taskId: node.id, commandOrTool: "CodingBackend.executeTask", environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [result.evidencePath], summary: result.changedFiles.join(", ") }] };
          }
          if (state.goalSpec!.operation === "analyze") {
            const report = writeAnalysis(config.analysisSource, ws, state.request);
            registerArtifact(dagCtx, { taskId: node.id, kind: "analysis-report", path: report, summary: "bounded source inventory with hash evidence" });
            return { status: "passed", message: "analysis report written", artifacts: [report], evidence: [{ taskId: node.id, commandOrTool: "writeAnalysis:read-only-inventory", environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [report], summary: "source inventory, observations and limitations recorded" }] };
          }
          const gateway = new ToolGateway(defaultContext([ws, join(config.repoRoot, "projects")]));
          gateway.authorize("run", { target: ws });
          if (existsSync(join(ws, "scripts", "render.mjs"))) {
            // trust boundary: template-provenance scripts run on the host;
            // modified/foreign scripts need a container or are refused
            const r = runWorkspaceScript({
              workspacePath: ws,
              scriptRelPath: "scripts/render.mjs",
              templateRoot: templatesRoot,
              templateId: state.templateId,
            });
            if (r.blocked) return { status: "blocked", message: r.blocked, artifacts: [], evidence: [] };
            if (r.exitCode !== 0) return { status: "failed", message: `render failed: ${r.stderr.slice(0, 300)}`, artifacts: [], evidence: [] };
            journal.append("execute", "info", `template rendered into dist/ (trusted=${!r.isolated}: ${r.trustReason.slice(0, 80)})`);
            registerArtifact(dagCtx, { taskId: node.id, kind: "workspace-render", path: "dist/", summary: `render ok; trust: ${r.trustReason.slice(0, 120)}` });
            return {
              status: "passed",
              message: "template rendered",
              artifacts: ["dist/"],
              evidence: [{ taskId: node.id, commandOrTool: `node scripts/render.mjs${r.isolated ? " (containerized)" : ""}`, environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: ["dist/"], summary: `render ok; trust: ${r.trustReason.slice(0, 120)}` }],
            };
          }
          if (existsSync(join(ws, "tests"))) {
            const suite = existsSync(join(ws, "tests", "structure.test.mjs"))
              ? "tests/structure.test.mjs"
              : (readdirSync(join(ws, "tests")).find((f) => f.endsWith(".test.mjs"))
                  ? `tests/${readdirSync(join(ws, "tests")).find((f) => f.endsWith(".test.mjs"))}`
                  : null);
            if (suite) {
              const r = runWorkspaceScript({
                workspacePath: ws,
                scriptRelPath: suite,
                templateRoot: templatesRoot,
                templateId: state.templateId,
              });
              if (r.blocked) return { status: "blocked", message: r.blocked, artifacts: [], evidence: [] };
              if (r.exitCode !== 0) return { status: "failed", message: `suite failed: ${r.stderr.slice(0, 300)}`, artifacts: [], evidence: [] };
              journal.append("execute", "info", `template suite passed: ${suite} (trusted=${!r.isolated})`);
              registerArtifact(dagCtx, { taskId: node.id, kind: "workspace-suite", path: suite, summary: `suite ok; trust: ${r.trustReason.slice(0, 120)}` });
              return {
                status: "passed",
                message: `suite passed: ${suite}`,
                artifacts: [suite],
                evidence: [{ taskId: node.id, commandOrTool: `node ${suite}${r.isolated ? " (containerized)" : ""}`, environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [], summary: `suite ok; trust: ${r.trustReason.slice(0, 120)}` }],
              };
            }
          }
          journal.append("execute", "warn", "no render step or suite; recorded honestly as scaffold-only");
          registerArtifact(dagCtx, { taskId: node.id, kind: "workspace-scaffold", summary: "no executable step — recorded honestly as scaffold-only" });
          return { status: "passed", message: "scaffold-only (no executable step)", artifacts: [], evidence: [] };
        },
        verify: async () => {
          // typed handoff: verification requires the workspace artifact from
          // prepare-workspace/execute — missing upstream evidence fails loudly
          requireArtifacts(dagCtx, ["t:execute"]);
          // repoRoot included: repo-owned skill entrypoints execute in the
          // trusted repo domain (they are versioned with the codebase)
          const gateway = new ToolGateway(defaultContext([state.workspacePath, config.repoRoot]));
          const backend = new LocalNodeBackend(gateway);
          const result = await verifyWorkspace({ workspacePath: state.workspacePath, blueprint: state.blueprint!, backend });
          dagCtx.env["verification"] = JSON.stringify(result);
          journal.append("verify", result.passed ? "info" : "warn", `verification vs ORIGINAL criteria: ${result.passed ? "passed" : "failed"} — ${result.failures.join(" | ").slice(0, 200) || "all checks ok"}`);
          const evidence: Array<{ taskId: string; commandOrTool: string; environment: string; timestamp: string; exitStatus: string; artifactPaths: string[]; summary: string }> = result.checks.map((c) => ({
            taskId: c.id,
            commandOrTool: "verifyWorkspace",
            environment: process.platform,
            timestamp: nowIso(),
            exitStatus: c.status,
            artifactPaths: [],
            summary: c.message,
          }));
          // C3: selected skills with executable entrypoints REALLY run — the
          // testing skill's own suite gate executes through the gateway with
          // typed JSON I/O; a failure fails the task (never log-only)
          let skillFailure: string | null = null;
          try {
            const registry = new CapabilityRegistry([join(config.repoRoot, "skills")], join(config.repoRoot, "templates"));
            if (!state.needsBackend && state.goalSpec!.operation !== "analyze" && registry.has("skill:testing") && registry.entrypointOf("skill:testing")) {
              const inv = invokeSkill(gateway, config.repoRoot, registry, "skill:testing", { workspacePath: state.workspacePath }, { timeoutMs: 120_000 });
              evidence.push(inv.evidence);
              journal.append("verify", inv.status === "passed" ? "info" : "warn", `skill:testing entrypoint executed (exit ${inv.exitCode}, ${inv.durationMs}ms): ${inv.message.slice(0, 140)}`);
              if (inv.status !== "passed") skillFailure = `skill:testing entrypoint ${inv.status}: ${inv.message.slice(0, 200)}`;
            }
          } catch (e) {
            // a broken skill integration is a typed failure, not silence
            skillFailure = `skill invocation error: ${(e as Error).message.slice(0, 200)}`;
          }
          if (skillFailure) {
            return { status: "failed" as const, message: skillFailure, artifacts: [], evidence };
          }
          const independent = independentFinalVerification(state.blueprint!, result);
          if (independent.verdict !== "pass") {
            return { status: "failed" as const, message: independent.summary, artifacts: [], evidence };
          }
          if (result.passed) {
            registerArtifact(dagCtx, { taskId: "t:verify", kind: "verification", schema: "omniforge://schemas/validation-result", summary: `${result.checks.length} checks passed vs original criteria` });
          }
          return {
            status: result.passed ? ("passed" as const) : ("failed" as const),
            message: result.passed ? "all acceptance criteria passed" : result.failures.join(" | ").slice(0, 300),
            artifacts: [],
            evidence,
          };
        },
        package: async (node: TaskNode) => {
          if (config.skipExport) return { status: "skipped" as const, message: "export skipped by config", artifacts: [], evidence: [] };
          // typed handoff: packaging consumes the verification artifact
          requireArtifacts(dagCtx, ["t:verify"]);
          const gateway = new ToolGateway(defaultContext([state.workspacePath, config.runsRoot]));
          const artifact = exportWorkspace(state.workspacePath, join(config.runsRoot, state.runId, "export"), gateway);
          dagCtx.env["artifactPath"] = artifact.path;
          registerArtifact(dagCtx, { taskId: "t:package", kind: "export-artifact", path: artifact.path, summary: `sha256 ${artifact.checksum.slice(0, 16)}` });
          journal.append("package", "info", `exported artifact ${artifact.path}`);
          return {
            status: "passed" as const,
            message: `exported ${artifact.path}`,
            artifacts: [artifact.path],
            evidence: [{ taskId: node.id, commandOrTool: "exportWorkspace", environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [artifact.path], summary: `sha256 ${artifact.checksum.slice(0, 16)}` }],
          };
        },
        deliver: async (node: TaskNode) => {
          // typed handoff: delivery requires the verification artifact, plus
          // the package artifact whenever packaging was not skipped
          const required = config.skipExport ? ["t:verify"] : ["t:verify", "t:package"];
          const handoffs = requireArtifacts(dagCtx, required);
          const ws = readWorkspaceConfig(state.workspacePath);
          releaseLease(state.workspacePath, "workspace-manager");
          journal.append("deliver", "info", `delivered workspace ${String(ws["id"])} — preview: open dist/index.html or npx serve dist`);
          return {
            status: "passed" as const,
            message: `delivered ${String(ws["id"])} (handoffs: ${handoffs.map((h) => h.kind).join(" + ")})`,
            artifacts: [],
            evidence: [{ taskId: node.id, commandOrTool: "releaseLease", environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [], summary: "delivery recorded with typed upstream handoffs" }],
          };
        },
        report: async (node: TaskNode) => {
          // real executor (never passthrough): record the per-task status
          // table from the durable ledger as the run's job-graph artifact
          const s = loadDagState(dagCtx);
          const rows = Object.entries(s?.tasks ?? {})
            .filter(([id]) => id !== node.id)
            .map(([id, t]) => `${id}:${t.status}`)
            .join(" ");
          const runDir = join(config.runsRoot, state.runId);
          mkdirSync(runDir, { recursive: true });
          const reportPath = join(runDir, "dag-report.txt");
          writeFileSync(reportPath, `run=${state.runId}\nworkspace=${state.workspacePath}\ntasks=${rows}\n`, "utf8");
          registerArtifact(dagCtx, { taskId: node.id, kind: "job-report", path: reportPath, summary: rows });
          journal.append("report", "info", `DAG job summary recorded: ${rows}`);
          return {
            status: "passed" as const,
            message: `job graph recorded (${rows})`,
            artifacts: ["dag-report.txt"],
            evidence: [{ taskId: node.id, commandOrTool: "dag-ledger-report", environment: process.platform, timestamp: nowIso(), exitStatus: "0", artifactPaths: [reportPath], summary: rows.slice(0, 160) }],
          };
        },
      };

      // Bind every plan task to its executor. Graph-phase tasks (intake..plan,
      // prepare-workspace) already ran as graph nodes just before — they get a
      // recording executor with honest evidence. ANY OTHER task without a
      // real executor is blocked, never passed (passthrough must never mark
      // an unevaluated engineering task successful).
      const graphPhaseExecutor: TaskExecutor = (node) =>
        Promise.resolve({
          status: "passed" as const,
          message: "completed by graph phase",
          artifacts: [],
          evidence: [
            {
              taskId: node.id,
              commandOrTool: `graph-node:${node.operation}`,
              environment: process.platform,
              timestamp: nowIso(),
              exitStatus: "passed",
              artifactPaths: [],
              summary: "executed as an orchestration graph node",
            },
          ],
        });
      const bound: Record<string, TaskExecutor> = {};
      for (const n of plan.nodes) {
        const opExecutor = executors[n.operation];
        if (opExecutor) {
          bound[n.id] = opExecutor;
        } else if (GRAPH_PHASE_TASKS.includes(n.id)) {
          bound[n.id] = graphPhaseExecutor;
        }
        // else: deliberately unbound — executeDag records it as blocked
      }
      // graph-phase tasks recorded as already passed so the DAG skips them
      // (their real execution happened as graph nodes just before)
      const dag = await executeDag(
        { ...plan, nodes: plan.nodes.map((n) => (GRAPH_PHASE_TASKS.includes(n.id) ? { ...n, status: "passed" as const } : n)) },
        bound,
        dagCtx
      );
      const savedVerification = join(config.runsRoot, state.runId, "verification.json");
      const verification = dagCtx.env["verification"] ? (JSON.parse(dagCtx.env["verification"]) as ValidationResult) : state.verification ?? (existsSync(savedVerification) ? JSON.parse(readFileSync(savedVerification, "utf8")) as ValidationResult : null);
      // durable job-graph inputs for the §5.8 report (human + JSON)
      const runDir = join(config.runsRoot, state.runId);
      mkdirSync(runDir, { recursive: true });
      writeFileSync(join(runDir, "artifact-ledger.json"), JSON.stringify([...(dagCtx.artifactLedger?.entries() ?? [])].map(([taskId, a]) => ({ taskId, kind: a.kind, path: a.path ?? null, summary: a.summary })), null, 2), "utf8");
      if (verification) writeFileSync(join(runDir, "verification.json"), JSON.stringify(verification, null, 2), "utf8");
      const summary = Object.entries(dag.outcomes)
        .map(([id, o]) => `${id}:${o.status}`)
        .join(" ");
      journal.append("execute", dag.allPassed ? "info" : "warn", `DAG ${dag.allPassed ? "completed" : "finished with failures"}: ${summary}`);
      return {
        verification,
        artifactPath: dagCtx.env["artifactPath"] ?? dag.state.tasks["t:package"]?.artifacts[0] ?? "",
        dagSummary: summary,
        error: dag.allPassed ? "" : Object.values(dag.state.tasks).some((t) => t.status === "blocked") ? "E_BACKEND_BLOCKED" : "dag-failures",
      };
    })
    .addNode("verify", async (state: OFState) => {
      const journal = journalOf(state);
      if (state.verification) {
        for (const c of state.verification.checks) journal.addEvidence({ taskId: c.id, status: c.status, message: c.message, at: nowIso() });
        journal.append("verify", "info", "verify phase: DAG evidence recorded");
        return {};
      }
      // no verification available (DAG blocked before verify) — honest gap
      journal.append("verify", "warn", "no verification evidence produced by the DAG");
      return {};
    })
    .addNode("repair", async (state: OFState) => {
      const journal = journalOf(state);
      if (!state.verification) {
        // nothing to repair from — a DAG that never produced verification
        // evidence is a blocker, not a repairable failure
        journal.append("repair", "error", "no verification evidence available — repair requires real failure input");
        return { error: "E_VERIFY_FAILED" };
      }
      const attempts = (state.repairAttempts ?? 0) + 1;
      const gateway = new ToolGateway(defaultContext([state.workspacePath, join(config.repoRoot, "projects")]));
      const backend = new LocalNodeBackend(gateway);
      const previous = state.repairHistory ?? [];
      let outcome: { repairAttempts: number; repairHistory: string[]; verification: ValidationResult | null; error: string } | null = null;
      try {
        const result = await executeRepair(
          {
            workspacePath: state.workspacePath,
            blueprint: state.blueprint,
            backend,
            ...(config.coding ? { coding: config.coding, runDir: join(config.runsRoot, state.runId) } : {}),
            journal: { append: (node, level, message) => journal.append(node, level, message) },
          },
          { verification: state.verification!, attempt: attempts, maxAttempts: 2, previousSignatures: previous }
        );
        journal.append("repair", "info", `repair applied via '${result.strategy}'; regression baseline: ${result.rerun?.passed ? "PASSED" : "FAILED"}`);
        outcome = {
          repairAttempts: attempts,
          repairHistory: [...previous, signatureOf(state.verification!)],
          verification: result.rerun,
          error: result.rerun?.passed ? "" : "dag-failures",
        };
      } catch (e) {
        const code = e instanceof OmniforgeError ? e.code : "E_REPAIR_BUDGET_EXCEEDED";
        journal.append("repair", "error", `repair blocked: ${code} — ${(e as Error).message.slice(0, 200)}`);
        return {
          repairAttempts: attempts,
          repairHistory: [...previous, signatureOf(state.verification!)],
          error: code,
        };
      }
      // successful repair: reset failed DAG tasks so the next execute pass
      // re-runs exactly the failed tasks + dependents (never passed tasks)
      const dagCtx: DagContext = { journal, runsRoot: config.runsRoot, runId: state.runId, env: { workspacePath: state.workspacePath } };
      const reset = resetFailedTasks(dagCtx);
      journal.append("repair", "info", `reset ${reset} failed DAG task(s) for targeted re-execution`);
      return outcome;
    })
    .addNode("approve", (state: OFState) => {
      journalOf(state).append("approve", "info", "no approval-gated actions in this plan (free-first, no deploy)");
      return {};
    })
    .addNode("package", (state: OFState) => {
      const journal = journalOf(state);
      if (state.artifactPath) {
        journal.append("package", "info", `package phase: artifact from DAG ${state.artifactPath}`);
        return {};
      }
      if (config.skipExport) return {};
      const gateway = new ToolGateway(defaultContext([state.workspacePath, config.runsRoot]));
      const artifact = exportWorkspace(state.workspacePath, join(config.runsRoot, state.runId, "export"), gateway);
      journal.append("package", "info", `exported artifact ${artifact.path}`);
      return { artifactPath: artifact.path };
    })
    .addNode("deliver", (state: OFState) => {
      const journal = journalOf(state);
      if (!state.artifactPath && config.skipExport) {
        const ws = readWorkspaceConfig(state.workspacePath);
        releaseLease(state.workspacePath, "workspace-manager");
        journal.append("deliver", "info", `delivered workspace ${String(ws["id"])} (no export by config)`);
        return {};
      }
      const ws = readWorkspaceConfig(state.workspacePath);
      releaseLease(state.workspacePath, "workspace-manager");
      journal.append("deliver", "info", `delivered workspace ${String(ws["id"])} — preview: open dist/index.html or npx serve dist`);
      return {};
    })
    .addNode("report", (state: OFState) => {
      const journal = journalOf(state);
      if (state.workspacePath) releaseLease(state.workspacePath, "workspace-manager");
      const summary = [
        `run=${state.runId}`,
        `workspace=${state.workspacePath}`,
        `verification=${state.verification?.passed ? "passed" : "failed"}`,
        `artifact=${state.artifactPath || "(skipped)"}`,
        `dag=${state.dagSummary || "(none)"}`,
        ...(state.error ? [`blocked=${state.error}`] : []),
      ].join(" ");
      journal.append("report", "info", `node:done:report ${summary}`);
      const status = state.error ? state.error === "dag-failures" ? "failed" : "blocked" : state.blueprint && state.verification && independentFinalVerification(state.blueprint, state.verification).verdict === "pass" ? "passed" : "failed";
      journal.saveState({ ...state, status, workspacePath: state.workspacePath });
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
    .addConditionalEdges("verify", (state: OFState) => {
      if (state.error && state.error !== "dag-failures") return "report";
      if (state.error === "dag-failures") {
        // a DAG task failed. If the workspace defects are repairable
        // (verification has real failures), repair; otherwise the failure is
        // environmental/integration — blocked honestly, never swallowed.
        if (state.verification && !state.verification.passed) return (state.repairAttempts ?? 0) < 2 ? "repair" : "report";
        return "report";
      }
      if (state.verification?.passed) return "approve";
      return (state.repairAttempts ?? 0) < 2 ? "repair" : "report";
    })
    .addConditionalEdges("repair", (state: OFState) => {
      // repair that fixed verification cycles back through the DAG; a typed
      // blocker (non-improving/budget/model-unavailable) ends the run
      if (state.error && state.error !== "dag-failures") return "report";
      return "execute";
    })
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

const INITIAL_STATE = {
  request: "",
  runId: "",
  intent: null,
  goalSpec: null,
  needsBackend: false,
  researchNoteCount: 0,
  blueprint: null,
  selection: null,
  templateId: "",
  taskPlan: null,
  workspacePath: "",
  verification: null,
  repairAttempts: 0,
  repairHistory: [] as string[],
  artifactPath: "",
  runReport: "",
  error: "",
  dagSummary: "",
};

async function withRunLock<T>(runId: string, config: ServiceConfig, action: () => Promise<T>): Promise<T> {
  if (!/^run_[a-f0-9]+$/.test(runId)) throw new OmniforgeError("E_INTENT_UNCLEAR", "invalid run identity");
  const dir = join(config.runsRoot, runId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "execution.lock");
  let fd: number;
  try { fd = openSync(path, "wx"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const lock = JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    try { process.kill(lock.pid, 0); throw new OmniforgeError("E_WORKSPACE_LOCKED", "run is already executing in another process"); }
    catch (probeError) {
      if ((probeError as NodeJS.ErrnoException).code !== "ESRCH") throw probeError;
    }
    unlinkSync(path);
    fd = openSync(path, "wx");
  }
  writeFileSync(fd, JSON.stringify({ pid: process.pid, runId }));
  try { return await action(); }
  finally { closeSync(fd); unlinkSync(path); }
}

export async function createRun(request: string, config: ServiceConfig): Promise<RunResult> {
  const graph = buildGraph(config);
  const runId = newId("run");
  let final: OFState;
  try { final = await withRunLock(runId, config, () => graph.invoke(
    { ...INITIAL_STATE, request, runId },
    { configurable: { thread_id: runId } }
  )); } catch (error) {
    const journal = new RunJournal(config.runsRoot, runId);
    const code = error instanceof OmniforgeError ? error.code : "E_BACKEND_BLOCKED";
    journal.append("report", "error", `${code}: ${(error as Error).message}`);
    journal.saveState({ request, runId, status: "blocked", error: code });
    throw error;
  }
  return { runId, report: final.runReport, state: final };
}

/** Resume an interrupted run from the durable checkpoint store (same thread id). */
export async function resumeRun(runId: string, config: ServiceConfig): Promise<RunResult> {
  const graph = buildGraph(config);
  const final = await withRunLock(runId, config, () => graph.invoke(null, { configurable: { thread_id: runId } }));
  return { runId, report: final.runReport, state: final };
}

export function runStatus(config: ServiceConfig, runId: string): { runId: string; journal: Array<{ node: string; message: string; at: string }>; state: unknown } {
  const journal = new RunJournal(config.runsRoot, runId);
  const events = journal.read().map((e) => ({ node: e.node, message: e.message, at: e.timestamp }));
  const file = join(config.checkpointRoot, runId, "checkpoint-latest.json");
  const hasCheckpoint = existsSync(file);
  return { runId, journal: events, state: { hasCheckpoint, completed: journal.completedNodes() } };
}

export { MemorySaver, detectCodingBackend };
export { invokeSkill } from "./skills.js";
export { executeDag, loadDagState, resetFailedTasks } from "./dag.js";
export { executeRepair, signatureOf } from "./repair.js";

/* ------------------------------------------------------------------ */
/* Job graph report (§5.8): what actually ran, with evidence            */
/* ------------------------------------------------------------------ */

export interface JobGraphReport {
  runId: string;
  request: string;
  selectedCapabilities: Array<{ capabilityId: string; role: string; reason: string }>;
  tasks: Array<{ taskId: string; status: string; message: string; artifacts: string[] }>;
  handoffs: Array<{ taskId: string; kind: string; path: string | null; summary: string }>;
  verification: { passed: boolean; checks: Array<{ id: string; status: string; message: string }> } | null;
  blockers: string[];
  artifactPath: string;
}

/**
 * Build the human + JSON job graph report from a finished run's durable state.
 * Shows the capabilities selected, per-task outcomes, typed handoffs produced,
 * verification evidence and precise blockers — never a plan-only view.
 */
export function buildJobGraphReport(config: ServiceConfig, runId: string): JobGraphReport | null {
  const runDir = join(config.runsRoot, runId);
  const journal = new RunJournal(config.runsRoot, runId);
  const saved = journal.loadState<{
    request?: string;
    selection?: SkillSelection;
    status?: string;
  } | null>();
  const dagState = loadDagState({ journal, runsRoot: config.runsRoot, runId, env: {} });
  if (!dagState && !saved) return null;
  let handoffs: JobGraphReport["handoffs"] = [];
  const ledgerPath = join(runDir, "artifact-ledger.json");
  if (existsSync(ledgerPath)) {
    try {
      handoffs = JSON.parse(readFileSync(ledgerPath, "utf8")) as JobGraphReport["handoffs"];
    } catch {
      handoffs = [];
    }
  }
  let verification: JobGraphReport["verification"] = null;
  const verifPath = join(runDir, "verification.json");
  if (existsSync(verifPath)) {
    try {
      verification = JSON.parse(readFileSync(verifPath, "utf8")) as JobGraphReport["verification"];
    } catch {
      verification = null;
    }
  }
  const blockers = [...journal.read()]
    .filter((e) => e.level === "error" || /blocked|BLOCKED/i.test(e.message))
    .slice(-5)
    .map((e) => `[${e.node}] ${e.message.slice(0, 160)}`);
  const packageTask = Object.entries(dagState?.tasks ?? {}).find(([id]) => id === "t:package");
  return {
    runId,
    request: saved?.request ?? "",
    selectedCapabilities: (saved?.selection?.selected ?? []).map((s) => ({ capabilityId: s.capabilityId, role: s.role, reason: s.reason })),
    tasks: Object.entries(dagState?.tasks ?? {}).map(([taskId, t]) => ({ taskId, status: String(t.status), message: t.message, artifacts: t.artifacts })),
    handoffs,
    verification,
    blockers,
    artifactPath: packageTask?.[1]?.artifacts[0] ?? "",
  };
}
export { understandWorkspace, applyDeterministicChange, changeManifest, modifyWithBackend } from "./modify.js";
export { executeCodingTask, type CodingExecution } from "./coding.js";
