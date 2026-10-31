import { describe, it, expect } from "vitest";
import {
  ProjectIntent,
  Capability,
  ProductBlueprint,
  TaskNode,
  Evidence,
  SkillSelection,
  OmniforgeError,
  GRAPH_NODES,
} from "./index.js";

describe("shared-types contracts", () => {
  it("validates a minimal ProjectIntent", () => {
    const intent = ProjectIntent.parse({
      id: "intent_test",
      request: "create a website",
      locale: "en",
      operation: "create",
      productKinds: ["website"],
    });
    expect(intent.platforms).toEqual([]);
    expect(intent.explicitRequirements).toEqual([]);
  });

  it("rejects an invalid operation", () => {
    expect(() =>
      ProjectIntent.parse({ id: "x", request: "r", locale: "en", operation: "teleport", productKinds: ["website"] })
    ).toThrow();
  });

  it("requires at least one product kind", () => {
    expect(() =>
      ProjectIntent.parse({ id: "x", request: "r", locale: "en", operation: "create", productKinds: [] })
    ).toThrow();
  });

  it("validates Capability availability vocabulary", () => {
    const cap = Capability.parse({
      id: "cap1",
      kind: "template",
      source: "templates/x",
      version: "0.1.0",
      availability: "verified",
      risk: "low",
      cost: "free",
    });
    expect(cap.healthCheck).toBe("none");
    expect(() =>
      Capability.parse({
        id: "cap2",
        kind: "template",
        source: "x",
        version: "0.1.0",
        availability: "kind-of-works",
        risk: "low",
        cost: "free",
      })
    ).toThrow();
  });

  it("validates blueprint + task node + evidence + selection", () => {
    const bp = ProductBlueprint.parse({
      intentId: "i",
      productBrief: "A very brief product brief.",
      scope: { mvp: ["a"], later: [], excluded: [] },
      rolesAndFlows: [],
      architecture: {},
      dataModel: {},
      contracts: [],
      threatModel: {},
      acceptanceCriteria: [{ id: "AC1", criterion: "site renders", evidenceMethod: "file-exists:dist/index.html" }],
      deploymentRequirements: {},
    });
    expect(bp.contractVersion).toBe("1.0.0");
    const node = TaskNode.parse({
      id: "t1",
      operation: "execute",
      inputs: {},
      timeoutMs: 1000,
      retryBudget: 1,
      idempotencyKey: "k",
    });
    expect(node.status).toBe("pending");
    const ev = Evidence.parse({
      taskId: "t1",
      commandOrTool: "node",
      environment: "test",
      timestamp: new Date().toISOString(),
      exitStatus: "passed",
      summary: "ok",
    });
    expect(ev.artifactPaths).toEqual([]);
    const sel = SkillSelection.parse({ intentId: "i", selected: [], excluded: [], estimatedCost: "0" });
    expect(sel.fallback).toBeNull();
  });

  it("exposes typed failures and graph nodes", () => {
    const err = new OmniforgeError("E_PLAN_CYCLE", "cycle!", { cycle: ["a", "b"] });
    expect(err.code).toBe("E_PLAN_CYCLE");
    expect(err.toJSON().code).toBe("E_PLAN_CYCLE");
    expect(GRAPH_NODES).toContain("verify");
    expect(GRAPH_NODES).toHaveLength(15);
  });
});
