/**
 * Composable primitives + non-code WorkBlueprints (universal-upgrade §4.5/§4.6).
 */
import { describe, expect, it } from "vitest";
import { composePrimitives, suggestAdditions, PRIMITIVES, getPrimitive } from "./primitives.js";
import { buildWorkBlueprint } from "./work.js";
import { GoalSpec } from "@omniforge/shared-types";

describe("primitive dependency/conflict graph (§4.5)", () => {
  it("requires storage for authorization", () => {
    const res = composePrimitives(["authorization"]);
    expect(res.ok).toBe(false);
    expect(res.missingDependencies[0]?.requires).toContain("storage");
    expect(suggestAdditions(["authorization"])).toEqual(["authentication", "storage"]);
  });

  it("accepts a valid composition with deterministic implementations", () => {
    const res = composePrimitives(["ui", "storage", "analytics"]);
    expect(res.ok).toBe(true);
    expect(res.modelRequired).toEqual([]); // all three have deterministic impls
  });

  it("reports honestly which primitives have no deterministic implementation", () => {
    const res = composePrimitives(["ui", "storage", "authentication", "realtime"]);
    expect(res.modelRequired).toEqual(["authentication", "realtime"]);
  });

  it("rejects unknown primitives instead of guessing", () => {
    const res = composePrimitives(["warp-drive"]);
    expect(res.ok).toBe(false);
    expect(res.unknownPrimitives).toEqual(["warp-drive"]);
  });

  it("every primitive has unique ids", () => {
    expect(PRIMITIVES.length).toBeGreaterThanOrEqual(17);
    expect(new Set(PRIMITIVES.map((p) => p.id)).size).toBe(PRIMITIVES.length);
    expect(getPrimitive("payments")?.requires).toContain("api");
  });
});

describe("WorkBlueprints for non-code deliverables (§4.6)", () => {
  const goal = (operation: string, deliverable: string) =>
    GoalSpec.parse({
      goalId: "goal_test",
      objective: `comparison study of data pipeline architectures`,
      operation,
      requestedDeliverables: [deliverable],
    });

  it("builds an analysis-report blueprint with executable evidence criteria", () => {
    const bp = buildWorkBlueprint(goal("analyze", "analysis-report"));
    expect(bp.acceptanceCriteria.length).toBeGreaterThanOrEqual(4);
    expect(bp.acceptanceCriteria.map((c) => c.evidenceMethod)).toContain("file-exists:report/ANALYSIS.md");
    expect(JSON.stringify(bp.scope.excluded)).toMatch(/unauthorized targets/);
  });

  it("builds a migration-plan blueprint with a rollback criterion", () => {
    const bp = buildWorkBlueprint(goal("analyze", "migration-plan"));
    expect(JSON.stringify(bp.acceptanceCriteria)).toMatch(/rollback/i);
  });

  it("refuses create/modify operations (they belong to product blueprints)", () => {
    expect(() => buildWorkBlueprint(goal("create", "analysis-report"))).toThrow(/buildBlueprint/);
  });

  it("typed gap for unsupported deliverable kinds — never a fake website", () => {
    // 'website' is a valid DeliverableKind but has no ANALYTICAL spec — the
    // work-blueprint layer refuses it with the typed gap (a website is a
    // product-blueprint deliverable, built by buildBlueprint instead)
    expect(() => buildWorkBlueprint(goal("analyze", "website"))).toThrow(/E_DELIVERABLE_UNSUPPORTED/);
  });
});
