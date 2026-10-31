import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifyWorkspace, classifyFailure, independentFinalVerification, runProjectTests } from "./index.js";
import { LocalNodeBackend } from "@omniforge/agent-runtime";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import type { ProductBlueprint } from "@omniforge/shared-types";

function bp(criteria: Array<{ id: string; criterion: string; evidenceMethod: string }>): ProductBlueprint {
  return {
    intentId: "i",
    contractVersion: "1.0.0",
    productBrief: "test brief",
    scope: { mvp: [], later: [], excluded: [] },
    rolesAndFlows: [],
    architecture: {},
    dataModel: {},
    contracts: [],
    threatModel: {},
    acceptanceCriteria: criteria,
    deploymentRequirements: {},
  } as ProductBlueprint;
}

function makeSite(dir: string): string {
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "tests"), { recursive: true });
  writeFileSync(join(dir, "dist", "index.html"), '<html><head><meta name="viewport" content="width=device-width"></head><body><a href="about.html">x</a></body></html>', "utf8");
  writeFileSync(join(dir, "dist", "styles.css"), "body{}", "utf8");
  writeFileSync(join(dir, "dist", "about.html"), "<html></html>", "utf8");
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "fixture", scripts: { test: "node tests/ok.test.mjs" } }), "utf8");
  writeFileSync(join(dir, "README.md"), "# fixture site\n", "utf8");
  writeFileSync(join(dir, "tests", "ok.test.mjs"), "console.log('fixture ok');\n", "utf8");
  return dir;
}

describe("verification", () => {
  it("passes all evidence methods on a good workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "of-vf-"));
    try {
      makeSite(dir);
      const gateway = new ToolGateway(defaultContext([dir]));
      const backend = new LocalNodeBackend(gateway);
      const result = await verifyWorkspace({
        workspacePath: dir,
        backend,
        blueprint: bp([
          { id: "AC1", criterion: "index exists", evidenceMethod: "file-exists:dist/index.html" },
          { id: "AC2", criterion: "viewport", evidenceMethod: "file-contains:dist/index.html:viewport" },
          { id: "AC3", criterion: "tests", evidenceMethod: "run-project-tests" },
          { id: "AC4", criterion: "no secrets", evidenceMethod: "no-secrets" },
          { id: "AC5", criterion: "links", evidenceMethod: "link-check" },
          { id: "AC6", criterion: "structure", evidenceMethod: "structure-check" },
        ]),
      });
      expect(result.passed).toBe(true);
      expect(result.checks.every((c) => c.status === "passed")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails honestly with messages on a broken workspace", async () => {
    const dir = mkdtempSync(join(tmpdir(), "of-vf2-"));
    try {
      const result = await verifyWorkspace({
        workspacePath: dir,
        blueprint: bp([{ id: "AC1", criterion: "index exists", evidenceMethod: "file-exists:dist/index.html" }]),
      });
      expect(result.passed).toBe(false);
      expect(result.failures[0]).toMatch(/AC1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects secrets in output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "of-vf3-"));
    try {
      makeSite(dir);
      writeFileSync(join(dir, "dist", "config.js"), "const t = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12';");
      const result = await verifyWorkspace({
        workspacePath: dir,
        blueprint: bp([{ id: "AC9", criterion: "no secrets", evidenceMethod: "no-secrets" }]),
      });
      expect(result.passed).toBe(false);
      expect(result.failures.join(" ")).toMatch(/secret/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("project test runner reports failures truthfully", () => {
    const dir = mkdtempSync(join(tmpdir(), "of-vf4-"));
    try {
      mkdirSync(join(dir, "tests"), { recursive: true });
      writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node tests/bad.test.mjs" } }));
      writeFileSync(join(dir, "tests", "bad.test.mjs"), "process.exit(1);");
      const r = runProjectTests(dir, undefined as never);
      expect(r.status).toBe("failed");
      void existsSync;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("classifies failures into actionable categories", () => {
    expect(classifyFailure("Error: EACCES: permission denied", 1).category).toBe("permissions");
    expect(classifyFailure("sh: godot: command not found", 127).category).toBe("missing-tool");
    expect(classifyFailure("AssertionError: expected 1 to be 2", 1).category).toBe("test-logic");
    expect(classifyFailure("connect ETIMEDOUT", 1).retryable).toBe(true);
    expect(classifyFailure("heap out of memory", 1).retryable).toBe(false);
  });

  it("independent verifier distrusts empty evidence", () => {
    const verdict = independentFinalVerification(bp([{ id: "AC1", criterion: "x", evidenceMethod: "file-exists:a" }]), {
      target: "t",
      checks: [],
      passed: true,
      failures: [],
    });
    expect(verdict.verdict).toBe("fail");
    expect(verdict.unmatched).toContain("AC1");
  });

  it("independent verifier passes only on full matching evidence", () => {
    const blueprint = bp([
      { id: "AC1", criterion: "a", evidenceMethod: "file-exists:a" },
      { id: "AC2", criterion: "b", evidenceMethod: "no-secrets" },
    ]);
    const result = {
      target: "t",
      checks: [
        { id: "AC1", name: "a", status: "passed", message: "", evidencePaths: [] },
        { id: "AC2", name: "b", status: "passed", message: "", evidencePaths: [] },
      ],
      passed: true,
      failures: [],
    };
    expect(independentFinalVerification(blueprint, result).verdict).toBe("pass");
  });
});
