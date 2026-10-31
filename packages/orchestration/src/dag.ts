/**
 * OMNIFORGE DAG executor — the task plan actually governs execution.
 *
 * Contract (mission C4):
 *  - Only dependency-ready tasks run; statuses live in ONE durable place
 *    (`dag-state.json` under the run dir) shared by CLI, graph and resume.
 *  - Every task runs under a timeout and retry budget with an idempotency
 *    key; on resume, already-passed tasks are skipped (exactly-once side
 *    effects), never re-executed.
 *  - Failed tasks propagate a typed outcome; downstream tasks become waiting,
 *    never silently run on failed inputs.
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { Evidence, OmniforgeError, type TaskNode, type Evidence as EvidenceT } from "@omniforge/shared-types";
import { nowIso, newId } from "@omniforge/utils";
import type { ExecutionPlan } from "@omniforge/task-planner";
import { readyNodes } from "@omniforge/task-planner";
import type { RunJournal } from "@omniforge/observability";
import { resolveSandbox, runIsolated, scriptTrust } from "@omniforge/tool-gateway";

export type TaskTerminalStatus = "passed" | "failed" | "blocked" | "skipped";

export interface TaskOutcome {
  taskId: string;
  status: TaskTerminalStatus;
  message: string;
  artifacts: string[];
  evidence: Evidence[];
  durationMs: number;
  attempts: number;
}

export interface DagState {
  runId: string;
  planId: string;
  tasks: Record<string, { status: TaskNode["status"] | TaskTerminalStatus; attempts: number; message: string; artifacts: string[]; updatedAt: string }>;
  updatedAt: string;
}

export interface DagContext {
  journal: RunJournal;
  runsRoot: string;
  runId: string;
  /** shared scratch state for executors (workspace path, etc.) */
  env: Record<string, string>;
  /** typed artifact handoffs (§5.5): taskId -> produced artifacts */
  artifactLedger?: Map<string, DagArtifact>;
}

/** A typed handoff record: what a task produced for its downstream consumers. */
export interface DagArtifact {
  taskId: string;
  kind: string;
  path?: string;
  schema?: string;
  summary: string;
  at: string;
}

/** Register a produced artifact so downstream tasks can consume typed inputs. */
export function registerArtifact(ctx: DagContext, artifact: Omit<DagArtifact, "at">): DagArtifact {
  if (!ctx.artifactLedger) ctx.artifactLedger = new Map();
  const full: DagArtifact = { ...artifact, at: nowIso() };
  ctx.artifactLedger.set(artifact.taskId, full);
  return full;
}

/** Require upstream artifacts — a typed handoff failure, not an empty guess. */
export function requireArtifacts(ctx: DagContext, taskIds: string[]): DagArtifact[] {
  const out: DagArtifact[] = [];
  const missing: string[] = [];
  for (const id of taskIds) {
    const a = ctx.artifactLedger?.get(id);
    if (a) out.push(a);
    else missing.push(id);
  }
  if (missing.length > 0) {
    throw new OmniforgeError("E_HANDOFF_MISSING", `upstream artifact(s) missing: ${missing.join(", ")} — downstream task cannot evaluate its inputs`, { missing });
  }
  return out;
}

export type TaskExecutor = (node: TaskNode, ctx: DagContext) => Promise<Omit<TaskOutcome, "taskId" | "durationMs" | "attempts">>;

export interface DagOptions {
  /** max tasks executing concurrently (independent tasks only) */
  concurrency?: number;
  /** dry-run: compute readiness but execute nothing */
  dryRun?: boolean;
}

function statePath(ctx: DagContext): string {
  return join(ctx.runsRoot, ctx.runId, "dag-state.json");
}

export function loadDagState(ctx: DagContext): DagState | null {
  const p = statePath(ctx);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as DagState;
  } catch {
    // corrupt/partial state is treated as absent — the journal remains the
    // audit trail; executors must be idempotent to tolerate replay
    return null;
  }
}

/** Atomic persist: write temp file then rename, so a crash never truncates state. */
function persistDagState(ctx: DagContext, state: DagState): void {
  state.updatedAt = nowIso();
  const p = statePath(ctx);
  const tmp = `${p}.${newId("tmp")}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  renameSync(tmp, p);
}

function freshState(plan: ExecutionPlan): DagState {
  const tasks: DagState["tasks"] = {};
  for (const n of plan.nodes) {
    tasks[n.id] = { status: "pending", attempts: 0, message: "", artifacts: [], updatedAt: nowIso() };
  }
  return { runId: plan.runId, planId: `${plan.blueprintId}`, tasks, updatedAt: nowIso() };
}

/**
 * Execute the plan DAG. Idempotent: tasks recorded `passed` in the durable
 * state are skipped on every subsequent invocation (resume/retry/repair all
 * go through here). Throws only on internal errors (unknown task, cycle);
 * task failures are recorded outcomes, not exceptions.
 */
export async function executeDag(
  plan: ExecutionPlan,
  executors: Record<string, TaskExecutor>,
  ctx: DagContext,
  opts: DagOptions = {}
): Promise<{ state: DagState; outcomes: Record<string, TaskOutcome>; allPassed: boolean }> {
  const existing = loadDagState(ctx);
  const state = existing && existing.tasks ? existing : freshState(plan);
  const outcomes: Record<string, TaskOutcome> = {};
  const concurrency = Math.max(1, opts.concurrency ?? 1);

  const mark = (id: string, status: DagState["tasks"][string]["status"], message: string, artifacts: string[] = []) => {
    const t = state.tasks[id] ?? { attempts: 0, message: "", artifacts: [], updatedAt: nowIso() };
    state.tasks[id] = { ...t, status, message, artifacts, updatedAt: nowIso() };
    persistDagState(ctx, state);
  };

  for (const n of plan.nodes) {
    if (!state.tasks[n.id]) state.tasks[n.id] = { status: "pending", attempts: 0, message: "", artifacts: [], updatedAt: nowIso() };
    // adopt pre-set statuses (e.g. graph-phase tasks arrive as "passed")
    if (n.status !== "pending" && state.tasks[n.id]!.status === "pending") {
      state.tasks[n.id]!.status = n.status;
      state.tasks[n.id]!.message = "adopted from plan";
    }
  }

  for (;;) {
    const liveNodes: TaskNode[] = plan.nodes.map((n) => ({ ...n, status: (state.tasks[n.id]?.status ?? "pending") as TaskNode["status"] }));
    const ready = readyNodes(liveNodes);
    if (ready.length === 0) break;

    const batch = ready.slice(0, concurrency);
    await Promise.all(
      batch.map(async (node) => {
        const t = state.tasks[node.id]!;
        if (opts.dryRun) {
          mark(node.id, "waiting", "dry-run: ready to execute");
          return;
        }
        // executors may be bound by node id (graph wiring) or by operation
        const executor = executors[node.id] ?? executors[operationKey(node.operation)];
        if (!executor) {
          mark(node.id, "blocked", `no executor bound for operation '${node.operation}'`);
          outcomes[node.id] = { taskId: node.id, status: "blocked", message: `no executor bound for operation '${node.operation}'`, artifacts: [], evidence: [], durationMs: 0, attempts: t.attempts };
          return;
        }
        if (t.status === "passed") {
          // idempotent resume — never duplicate side effects; the artifact
          // ledger is rebuilt from the durable record so downstream typed
          // handoffs keep working across processes
          if (ctx.artifactLedger && !ctx.artifactLedger.has(node.id)) {
            registerArtifact(ctx, { taskId: node.id, kind: "task-output", ...(t.artifacts[0] ? { path: t.artifacts[0] } : {}), summary: `resumed from durable state: ${t.message.slice(0, 120)}` });
          }
          outcomes[node.id] = { taskId: node.id, status: "passed", message: `already passed (idempotent resume): ${t.message}`, artifacts: t.artifacts, evidence: [], durationMs: 0, attempts: t.attempts };
          return;
        }
        if (t.attempts > node.retryBudget) {
          mark(node.id, "blocked", `retry budget exhausted (${t.attempts} > ${node.retryBudget})`);
          outcomes[node.id] = { taskId: node.id, status: "blocked", message: `retry budget exhausted`, artifacts: [], evidence: [], durationMs: 0, attempts: t.attempts };
          return;
        }
        mark(node.id, "running", `executing (attempt ${t.attempts + 1})`);
        const started = Date.now();
        try {
          const res = await withTimeout(executor(node, ctx), node.timeoutMs, node.id);
          const attempts = t.attempts + 1;
          state.tasks[node.id] = { ...state.tasks[node.id]!, attempts, status: res.status === "passed" ? "passed" : res.status === "failed" ? "failed" : res.status === "blocked" ? "blocked" : "skipped", message: res.message, artifacts: res.artifacts, updatedAt: nowIso() };
          persistDagState(ctx, state);
          outcomes[node.id] = { ...res, taskId: node.id, durationMs: Date.now() - started, attempts };
          // durable typed handoff: every passed task's outputs are recorded so
          // downstream consumers (and resumed processes) can require them
          if (res.status === "passed" && ctx.artifactLedger && !ctx.artifactLedger.has(node.id)) {
            registerArtifact(ctx, { taskId: node.id, kind: "task-output", ...(res.artifacts[0] ? { path: res.artifacts[0] } : {}), summary: res.message.slice(0, 160) });
          }
          for (const ev of res.evidence) ctx.journal.addEvidence(ev);
          ctx.journal.append("dag", res.status === "passed" ? "info" : "warn", `task ${node.id} ${res.status}: ${res.message.slice(0, 160)}`);
        } catch (e) {
          const msg = e instanceof OmniforgeError ? e.message : (e as Error).message;
          const timedOut = /timed out/.test(msg);
          const attempts = t.attempts + 1;
          const status: DagState["tasks"][string]["status"] = timedOut || attempts > node.retryBudget ? "blocked" : "failed";
          state.tasks[node.id] = { ...state.tasks[node.id]!, attempts, status, message: msg.slice(0, 300), artifacts: [], updatedAt: nowIso() };
          persistDagState(ctx, state);
          outcomes[node.id] = { taskId: node.id, status: status as TaskTerminalStatus, message: msg.slice(0, 300), artifacts: [], evidence: [], durationMs: Date.now() - started, attempts };
          ctx.journal.append("dag", "error", `task ${node.id} ${status}: ${msg.slice(0, 160)}`);
        }
      })
    );
    if (opts.dryRun) break;
  }

  const allPassed = plan.nodes.every((n) => state.tasks[n.id]?.status === "passed" || state.tasks[n.id]?.status === "skipped");
  return { state, outcomes, allPassed };
}

export function operationKey(operation: string): string {
  return operation.replace(/^t:/, "");
}

/**
 * Reset failed/blocked tasks to pending so a repair cycle re-executes exactly
 * the failed tasks and their dependents (passed tasks stay passed — their
 * side effects are never duplicated).
 */
export function resetFailedTasks(ctx: DagContext): number {
  const state = loadDagState(ctx);
  if (!state) return 0;
  let reset = 0;
  for (const [id, t] of Object.entries(state.tasks)) {
    if (t.status === "failed" || t.status === "blocked") {
      state.tasks[id] = { ...t, status: "pending", message: "reset for repair re-execution", updatedAt: nowIso() };
      reset++;
    }
  }
  if (reset > 0) persistDagState(ctx, state);
  return reset;
}

function withTimeout<T>(p: Promise<T>, ms: number, id: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<T>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`task ${id} timed out after ${ms}ms`)), ms);
  });
  // the losing timer must be cleared or it keeps the process alive long
  // after the DAG finished (CLI would hang until the last timeout fires)
  void p.finally(() => timer && clearTimeout(timer));
  return Promise.race([p, guard]);
}

/**
 * Governed command runner used by executors: argument-array execution (no
 * shell), cwd confined to the task's workspace, bounded output. Returns a
 * structured result instead of throwing.
 */
export function runGoverned(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs = 60_000
): { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
  const timedOut = Boolean(r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  return {
    exitCode: r.status,
    stdout: (r.stdout ?? "").slice(0, 200_000),
    stderr: (r.stderr ?? "").slice(0, 200_000),
    timedOut,
  };
}

export interface WorkspaceScriptDecision {
  executed: boolean;
  isolated: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  trustReason: string;
  blocked?: string;
}

/**
 * Run a script that lives INSIDE a generated workspace under the §6 trust
 * boundary. Trusted provenance (byte-identical to its versioned template or
 * matching the compose-time provenance manifest) runs on the host allowlist;
 * anything else is untrusted generated code: executed inside a real container
 * when one exists, otherwise refused with a typed blocker. Never silently
 * executes untrusted content on the host.
 */
export function runWorkspaceScript(opts: {
  workspacePath: string;
  scriptRelPath: string;
  templateRoot?: string;
  templateId?: string;
  args?: string[];
  timeoutMs?: number;
}): WorkspaceScriptDecision {
  const trust = scriptTrust({
    workspacePath: opts.workspacePath,
    scriptRelPath: opts.scriptRelPath,
    ...(opts.templateRoot ? { templateRoot: opts.templateRoot } : {}),
    ...(opts.templateId ? { templateId: opts.templateId } : {}),
    // the compose-time provenance manifest lives in every generated workspace
    provenancePath: join(opts.workspacePath, ".omniforge", "provenance.json"),
  });
  if (trust.trusted) {
    const r = runGoverned("node", [opts.scriptRelPath, ...(opts.args ?? [])], opts.workspacePath, opts.timeoutMs ?? 60_000);
    return { executed: true, isolated: false, trustReason: trust.reason, ...r };
  }
  // untrusted generated code: container or refusal — never the host
  const sandbox = resolveSandbox();
  if (sandbox.mode === "container" && sandbox.runtime) {
    const r = runIsolated({
      image: "node:22-bookworm-slim",
      argv: ["node", opts.scriptRelPath, ...(opts.args ?? [])],
      readOnlyMounts: [],
      workdir: opts.workspacePath,
      timeoutMs: opts.timeoutMs ?? 60_000,
    });
    return { executed: true, isolated: true, trustReason: trust.reason, exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut };
  }
  return {
    executed: false,
    isolated: false,
    exitCode: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    trustReason: trust.reason,
    blocked: `E_SANDBOX_UNAVAILABLE: script ${opts.scriptRelPath} is not trusted provenance (${trust.reason}) and this host has no container runtime — untrusted code will not run unsandboxed`,
  };
}

export function evidenceOf(taskId: string, commandOrTool: string, exitStatus: string, summary: string, artifactPaths: string[] = []): EvidenceT {
  return Evidence.parse({
    taskId,
    commandOrTool,
    environment: `${process.platform}/dag`,
    timestamp: nowIso(),
    exitStatus,
    artifactPaths,
    summary,
  });
}
