import { describe, it, expect } from "vitest";
import { parseRequest } from "@omniforge/intent-engine";
import { buildBlueprint } from "@omniforge/blueprint-engine";
import { planExecution, assertAcyclic, topoSort, readyNodes, criticalPath } from "./index.js";
import type { Node } from "@omniforge/shared-types";

const route = { selection: { intentId: "i", selected: [], excluded: [], estimatedCost: "0" } as never, templateId: "template:static-business", missing: [] };

describe("task planner", () => {
  it("plans a full create graph with budgets and idempotency keys", () => {
    const intent = parseRequest("Create a website for a bakery");
    const bp = buildBlueprint(intent);
    const plan = planExecution("run_1", intent, bp, route);
    const ids = plan.nodes.map((n) => n.id);
    expect(ids).toContain("t:execute");
    expect(ids).toContain("t:verify");
    for (const n of plan.nodes) {
      expect(n.timeoutMs).toBeGreaterThan(0);
      expect(n.idempotencyKey).toHaveLength(8);
    }
  });

  it("idempotency keys are stable across identical plans", () => {
    const intent = parseRequest("Create a website for a bakery");
    const bp = buildBlueprint(intent);
    const a = planExecution("run_x", intent, bp, route);
    const b = planExecution("run_y", intent, bp, route);
    const ka = a.nodes.map((n) => n.idempotencyKey).join(",");
    const kb = b.nodes.map((n) => n.idempotencyKey).join(",");
    expect(ka).toBe(kb);
  });

  it("detects dependency cycles with a typed error", () => {
    const nodes = [
      { id: "a", dependencies: ["b"], status: "pending", capabilityIds: [], expectedArtifacts: [], inputs: {}, operation: "x", timeoutMs: 1, retryBudget: 0, idempotencyKey: "k1", approvalRequired: false },
      { id: "b", dependencies: ["a"], status: "pending", capabilityIds: [], expectedArtifacts: [], inputs: {}, operation: "x", timeoutMs: 1, retryBudget: 0, idempotencyKey: "k2", approvalRequired: false },
    ] as unknown as Node[];
    expect(() => assertAcyclic(nodes)).toThrow(/E_PLAN_CYCLE/);
  });

  it("topoSort respects dependencies", () => {
    const intent = parseRequest("Create a website for a bakery");
    const plan = planExecution("run_2", intent, buildBlueprint(intent), route);
    const order = topoSort(plan.nodes).map((n) => n.id);
    expect(order.indexOf("t:intake")).toBeLessThan(order.indexOf("t:execute"));
    expect(order.indexOf("t:execute")).toBeLessThan(order.indexOf("t:verify"));
    expect(order.indexOf("t:verify")).toBeLessThan(order.indexOf("t:report"));
  });

  it("critical path spans intake to report", () => {
    const intent = parseRequest("Create a website for a bakery");
    const plan = planExecution("run_3", intent, buildBlueprint(intent), route);
    const cp = criticalPath(plan.nodes);
    expect(cp[0]).toBe("t:intake");
    expect(cp.at(-1)).toBe("t:report");
  });

  it("readyNodes only yields nodes whose deps passed", () => {
    const intent = parseRequest("Create a website for a bakery");
    const plan = planExecution("run_4", intent, buildBlueprint(intent), route);
    const ready = readyNodes(plan.nodes).map((n) => n.id);
    expect(ready).toEqual(["t:intake"]);
    plan.nodes.find((n) => n.id === "t:intake")!.status = "passed";
    const next = readyNodes(plan.nodes).map((n) => n.id);
    expect(next).toEqual(["t:permission-check", "t:interpret"]);
  });
});
