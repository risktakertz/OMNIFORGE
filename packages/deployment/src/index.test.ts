import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectTarget, dryRunDeploy, executeDeploy } from "./index.js";
import { OmniforgeError } from "@omniforge/shared-types";

function workspaceWithTemplate(templateId: string): string {
  const dir = mkdtempSync(join(tmpdir(), "of-dp-"));
  writeFileSync(join(dir, "project.config.json"), JSON.stringify({ id: "ws_test", templateId }));
  return dir;
}

describe("deployment (free-first, generation never publishes)", () => {
  it("detects targets by template", () => {
    expect(detectTarget(workspaceWithTemplate("template:static-business"))).toBe("static");
    expect(detectTarget(workspaceWithTemplate("template:next-web"))).toBe("node");
    expect(detectTarget(workspaceWithTemplate("template:expo-mobile"))).toBe("expo");
    expect(detectTarget(workspaceWithTemplate("template:godot-native"))).toBe("godot");
  });

  it("dry-run produces free-first options with terms warnings, publishes nothing", () => {
    const ws = workspaceWithTemplate("template:static-business");
    try {
      const report = dryRunDeploy(ws);
      expect(report.target).toBe("static");
      expect(report.options.length).toBeGreaterThanOrEqual(2);
      expect(report.estimatedCost).toMatch(/0 USD/);
      expect(report.approvalsRequired.join(" ")).toMatch(/approval/i);
      expect(report.options.every((o) => o.commercialUse === "verify-terms" || o.commercialUse === "permitted-with-attribution")).toBe(true);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("engine targets produce honest warnings, no fake plans", () => {
    const ws = workspaceWithTemplate("template:expo-mobile");
    try {
      const report = dryRunDeploy(ws);
      expect(report.options).toHaveLength(0);
      expect(report.warnings.join(" ")).toMatch(/store accounts|signing/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });

  it("real deploy is typed-blocked until an approved adapter exists", () => {
    const ws = workspaceWithTemplate("template:static-business");
    try {
      expect(() => executeDeploy(ws)).toThrow(OmniforgeError);
      expect(() => executeDeploy(ws)).toThrow(/E_DEPLOY_BLOCKED/);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  });
});
