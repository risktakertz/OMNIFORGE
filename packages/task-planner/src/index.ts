/**
 * OMNIFORGE task planner — dependency-aware DAG with budgets, idempotency keys
 * and cycle detection. Plans are pure data: the orchestrator executes them,
 * the verifier evidences them.
 */
import { TaskNode, OmniforgeError, type TaskNode as Node, type ProductBlueprint, type ProjectIntent, type SkillSelection } from "@omniforge/shared-types";
import { shortHash, nowIso } from "@omniforge/utils";

export interface RouteInput {
  selection: SkillSelection;
  templateId: string;
  missing: string[];
}

export interface PlanOptions {
  timeoutMs?: number;
  retryBudget?: number;
  resumeOf?: string;
}

export interface ExecutionPlan {
  runId: string;
  intentId: string;
  blueprintId: string;
  nodes: Node[];
  createdAt: string;
}

function node(
  id: string,
  operation: string,
  dependencies: string[],
  capabilityIds: string[],
  expectedArtifacts: string[],
  opts: PlanOptions,
  approvalRequired = false
): Node {
  return TaskNode.parse({
    id,
    operation,
    dependencies,
    capabilityIds,
    inputs: {},
    expectedArtifacts,
    timeoutMs: opts.timeoutMs ?? 120_000,
    retryBudget: opts.retryBudget ?? 2,
    idempotencyKey: shortHash(`${id}|${operation}|${capabilityIds.join(",")}`),
    approvalRequired,
    status: "pending",
  });
}

export function planExecution(
  runId: string,
  intent: ProjectIntent,
  blueprint: ProductBlueprint,
  route: RouteInput,
  opts: PlanOptions = {}
): ExecutionPlan {
  const nodes: Node[] = [];
  const needsWorkspace = intent.operation !== "analyze";
  nodes.push(node("t:intake", "intake", [], ["skill:omniforge"], ["journal"], opts));
  nodes.push(node("t:permission-check", "permission-check", ["t:intake"], [], ["policy-decision"], opts));
  nodes.push(node("t:interpret", "interpret", ["t:intake"], ["skill:omniforge"], ["intent"], opts));
  nodes.push(node("t:research", "research", ["t:interpret"], ["skill:research"], ["research-notes"], opts));
  nodes.push(node("t:specify", "specify", ["t:interpret"], ["skill:architecture"], ["blueprint"], opts));
  nodes.push(node("t:select", "select", ["t:specify"], ["skill:omniforge"], ["skill-selection"], opts));
  nodes.push(node("t:plan", "plan", ["t:select"], ["skill:architecture"], ["task-graph"], opts));
  if (needsWorkspace) {
    nodes.push(node("t:prepare-workspace", "prepare-workspace", ["t:plan"], [route.templateId], ["workspace"], opts));
    nodes.push(node("t:execute", "execute", ["t:prepare-workspace"], [route.templateId, "skill:omniforge"], ["generated-project"], opts));
    nodes.push(node("t:verify", "verify", ["t:execute"], ["skill:testing"], blueprint.acceptanceCriteria.map((a) => `evidence:${a.id}`), opts));
    nodes.push(node("t:package", "package", ["t:verify"], ["skill:release"], ["export-manifest"], opts));
    nodes.push(node("t:deliver", "deliver", ["t:package"], ["skill:documentation"], ["delivery-report"], opts));
  } else {
    nodes.push(node("t:verify", "verify", ["t:plan"], ["skill:research"], ["analysis-report"], opts));
  }
  nodes.push(node("t:report", "report", [nodes[nodes.length - 1]!.id], ["skill:documentation"], ["report"], opts));

  assertAcyclic(nodes);
  return { runId, intentId: intent.id, blueprintId: `${blueprint.intentId}:bp`, nodes, createdAt: nowIso() };
}

export function assertAcyclic(nodes: Node[]): void {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const state = new Map<string, 0 | 1 | 2>();
  const visit = (id: string, stack: string[]): void => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) {
      throw new OmniforgeError("E_PLAN_CYCLE", `dependency cycle detected: ${[...stack, id].join(" -> ")}`, { cycle: [...stack, id] });
    }
    state.set(id, 1);
    const n = byId.get(id);
    if (!n) throw new OmniforgeError("E_PLAN_CYCLE", `unknown dependency ${id}`);
    for (const d of n.dependencies) visit(d, [...stack, id]);
    state.set(id, 2);
  };
  for (const n of nodes) visit(n.id, []);
}

export function topoSort(nodes: Node[]): Node[] {
  assertAcyclic(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const done = new Set<string>();
  const out: Node[] = [];
  const visit = (id: string): void => {
    if (done.has(id)) return;
    done.add(id);
    const n = byId.get(id);
    if (!n) return;
    for (const d of n.dependencies) visit(d);
    out.push(n);
  };
  for (const n of nodes) visit(n.id);
  return out;
}

export function readyNodes(nodes: Node[]): Node[] {
  const status = new Map(nodes.map((n) => [n.id, n.status]));
  return nodes.filter(
    (n) => n.status === "pending" && n.dependencies.every((d) => status.get(d) === "passed")
  );
}

export function criticalPath(nodes: Node[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const memo = new Map<string, { len: number; path: string[] }>();
  const visit = (id: string): { len: number; path: string[] } => {
    if (memo.has(id)) return memo.get(id)!;
    const n = byId.get(id);
    let best: { len: number; path: string[] } = { len: 0, path: [] };
    for (const d of n?.dependencies ?? []) {
      const r = visit(d);
      if (r.len > best.len) best = r;
    }
    const res = { len: best.len + 1, path: [...best.path, id] };
    memo.set(id, res);
    return res;
  };
  let best: { len: number; path: string[] } = { len: 0, path: [] };
  for (const n of nodes) {
    const r = visit(n.id);
    if (r.len > best.len) best = r;
  }
  return best.path;
}
