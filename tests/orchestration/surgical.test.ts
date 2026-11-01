import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRun, buildJobGraphReport, modifyWithBackend, executeCodingTask, type OFState } from "@omniforge/orchestration";
import { main as cliMain } from "../../apps/cli/src/index.js";
import { spawnSync } from "node:child_process";
import { buildBlueprint } from "@omniforge/blueprint-engine";
import { writeAnalysis } from "../../packages/orchestration/src/analysis.js";
import { composeAgentMvp } from "../../packages/orchestration/src/agent-mvp.js";
import { buildGoalSpec, mergeModelGoalSpec, parseRequest, resolveGoalIntent } from "@omniforge/intent-engine";
import { LocalNodeBackend, type AgentTaskSpec } from "@omniforge/agent-runtime";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
describe("surgical integration", () => {
  it("orchestration authorizes interpretation before invoking a custom model hook", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-hook-budget-"));
    let invoked = false;
    try {
      await expect(createRun("Create a quantum flux compiler", { repoRoot, runsRoot: join(root, "runs"), checkpointRoot: join(root, "checkpoints"), modelInterpreter: async () => { invoked = true; return {}; } })).rejects.toMatchObject({ code: "E_BUDGET_EXCEEDED" });
      expect(invoked).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("composite goals return explicit per-deliverable blockers before implementation", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-composite-"));
    try {
      await expect(createRun("Create a quantum flux compiler", { repoRoot, runsRoot: join(root, "runs"), checkpointRoot: join(root, "checkpoints"), interpreterPolicy: { approvalId: "test-composite", provider: "injected", model: "goal", endpoint: "in-process:test", cost: "verified-free", approvedSpend: 0, taskBudget: 0, reservedPerCall: 0, maxCalls: 1 }, modelInterpreter: async () => ({ targetProduct: "api", requestedDeliverables: ["api-service", "website"] }) })).rejects.toMatchObject({ code: "E_DELIVERABLE_UNSUPPORTED", details: { deliverables: [{ kind: "api-service", status: "blocked" }, { kind: "website", status: "blocked" }] } });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("exported agent model planning with a key and zero approval makes zero HTTP calls", () => {
    const root = mkdtempSync(join(tmpdir(), "of-agent-budget-"));
    try {
      composeAgentMvp(root, parseRequest("Create a coding agent"), new ToolGateway(defaultContext([root])));
      const script = "import {planTask} from './src/model-adapter.mjs'; let calls=0; globalThis.fetch=async()=>{calls++;throw Error('forbidden HTTP');}; try {await planTask({instruction:'novel task',files:[]}); throw Error('expected blocker');} catch(e) {if(!e.message.includes('E_BUDGET_EXCEEDED')) throw e;} if(calls!==0) throw Error('unexpected network calls'); console.log('zero HTTP calls');";
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: root, encoding: "utf8", env: { ...process.env, OPENAI_API_KEY: "test-only-placeholder", APPROVED_SPEND: "0", MODEL_APPROVAL_FILE: "", MODEL_LEDGER_FILE: "" } });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("zero HTTP calls");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it("CLI novel and unauthorized analysis requests have typed nonzero outcomes in JSON/human modes", () => {
    const cli = join(repoRoot, "apps", "cli", "dist", "index.js");
    for (const mode of [[], ["--json"]]) {
      const result = spawnSync(process.execPath, [cli, "create", "Create an orbital constraint manifest", ...mode], { cwd: repoRoot, encoding: "utf8" });
      expect(result.status).toBe(2);
      expect(result.stdout).not.toMatch(/DONE|PASSED/);
      expect(result.stderr).toMatch(/E_NEEDS_MODEL/);
    }
    const unauthorized = spawnSync(process.execPath, [cli, "analyze", "inventory source files", "--target", join(repoRoot, "missing-secret-target"), "--json"], { cwd: repoRoot, encoding: "utf8" });
    expect(unauthorized.status).toBe(2);
    expect(unauthorized.stderr).toContain("E_AUTHORIZATION_REQUIRED");
    expect(unauthorized.stdout).not.toContain("DONE");
  });
  it("authorization and circumvention checks precede target inspection", () => {
    const absent = join(repoRoot, "does-not-exist");
    expect(() => writeAnalysis({ target: absent, rightsEvidence: "" }, absent, "inventory files")).toThrow(/E_AUTHORIZATION_REQUIRED/);
    expect(() => writeAnalysis({ target: absent, rightsEvidence: "operator-provided authorization" }, absent, "inventory files for a DRM crack")).toThrow(/E_AUTHORIZATION_REQUIRED/);
  });
  it("out-of-scope backend edits fail before application and retries preserve the budget ledger", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-scope-fault-"));
    const workspace = join(root, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "README.md"), "original");
    let calls = 0;
    let failedWorkspace = "";
    class BadFake extends LocalNodeBackend {
      override features() { return { ...super.features(), modelBacked: true }; }
      executionBoundary() { return { isolated: true, detail: "in-process fault injection only" }; }
      override async executeTask(spec: AgentTaskSpec) {
        calls++;
        writeFileSync(join(spec.cwd, "README.md"), "unauthorized edit");
        return { status: "passed" as const, detail: "untrusted claim", changedFiles: ["README.md"], scopeViolations: [], raw: null };
      }
    }
    try {
      const coding = { backend: new BadFake(new ToolGateway(defaultContext([root]))), policy: { approvalId: "test-fault", provider: "injected", model: "fault", endpoint: "in-process:test", cost: "verified-free" as const, approvedSpend: 0, taskBudget: 0, reservedPerCall: 0, maxCalls: 1 }, scope: { writable: ["src"], forbidden: ["README.md"] }, acceptanceCriteria: [], expectedOutputs: ["src/result.json"] };
      const blueprint = buildBlueprint(parseRequest("Create a bakery website"));
      await expect(executeCodingTask(coding, workspace, blueprint, "fault", join(root, "run"))).rejects.toThrow(/scope contract/);
      expect(readFileSync(join(workspace, "README.md"), "utf8")).toBe("original");
      await expect(executeCodingTask(coding, workspace, blueprint, "retry", join(root, "run"))).rejects.toThrow(/exhausted/);
      expect(calls).toBe(1);
      const failed = await createRun("Create an orbital constraint manifest", { repoRoot, runsRoot: join(root, "runs"), checkpointRoot: join(root, "checkpoints"), coding: { ...coding, acceptanceCriteria: [{ id: "F1", criterion: "Requested source artifact exists", evidenceMethod: "file-exists:src/result.json" }] } });
      failedWorkspace = failed.state.workspacePath;
      expect(failed.state.artifactPath).toBe("");
      expect(failed.report).toBeTruthy();
      expect(existsSync(join(failedWorkspace, "README.md"))).toBe(false);
      expect(JSON.parse(readFileSync(join(root, "runs", failed.runId, "state.json"), "utf8")).status).toBe("failed");
    } finally {
      if (failedWorkspace) rmSync(failedWorkspace, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("a novel goal reaches a real-writing injected backend, executes acceptance and exports", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-coding-run-"));
    let workspace = "";
    let received: AgentTaskSpec | undefined;
    let cliRunDir = "";
    class WritingFake extends LocalNodeBackend {
      override features() { return { ...super.features(), modelBacked: true }; }
      executionBoundary() { return { isolated: true, detail: "trusted in-process test double; no live model or sandbox claim" }; }
      override async executeTask(spec: AgentTaskSpec) {
        received = spec;
        mkdirSync(join(spec.cwd, "src"), { recursive: true });
        writeFileSync(join(spec.cwd, "src", "orbital.json"), JSON.stringify({ constraints: [{ period: 42, valid: true }] }));
        return { status: "passed" as const, detail: "injected original manifest", changedFiles: ["src/orbital.json"], scopeViolations: [], raw: null };
      }
    }
    try {
      const coding = {
        backend: new WritingFake(new ToolGateway(defaultContext([root]))),
        policy: { approvalId: "test-only-free-route", provider: "injected", model: "file-writer", endpoint: "in-process:test", cost: "verified-free" as const, approvedSpend: 0, taskBudget: 0, reservedPerCall: 0, maxCalls: 2 },
        scope: { writable: ["src"], forbidden: ["tests", "package.json"] },
        acceptanceCriteria: [{ id: "B1", criterion: "Orbital constraints are independently validated", evidenceMethod: "run-project-tests" }, { id: "B2", criterion: "Original manifest exists", evidenceMethod: "file-exists:src/orbital.json" }],
        expectedOutputs: ["src/orbital.json"],
        acceptanceFiles: { "package.json": JSON.stringify({ type: "module", scripts: { test: "node tests/acceptance.mjs" } }), "tests/acceptance.mjs": "import assert from 'node:assert/strict'; import {readFileSync} from 'node:fs'; const m=JSON.parse(readFileSync('src/orbital.json','utf8')); assert.equal(m.constraints[0].period,42); assert.equal(m.constraints[0].valid,true); console.log('original constraints validated');" },
      };
      let output = "";
      const writer = vi.spyOn(process.stdout, "write").mockImplementation((chunk) => { output += String(chunk); return true; });
      try { await cliMain(["create", "Create an orbital constraint manifest", "--repo", repoRoot, "--json"], { coding, interpreterPolicy: coding.policy, modelInterpreter: async () => ({ targetProduct: "api", platforms: ["server"], functionalRequirements: ["Validate orbital constraints"], requestedDeliverables: ["source-project"] }) }); }
      finally { writer.mockRestore(); }
      const payload = JSON.parse(output) as { runId: string; status: string };
      expect(payload.status).toBe("passed");
      cliRunDir = join(repoRoot, "infra", "runs", payload.runId);
      const result = { runId: payload.runId, state: JSON.parse(readFileSync(join(cliRunDir, "state.json"), "utf8")) as OFState };
      workspace = result.state.workspacePath;
      expect(received?.instruction).toContain("orbital constraint");
      expect(received?.cwd).not.toBe(repoRoot);
      expect(result.state.intent?.platforms).toEqual(["server"]);
      expect(result.state.blueprint?.scope.mvp).toContain("Validate orbital constraints");
      expect(result.state.error).toBe("");
      expect(result.state.verification?.passed).toBe(true);
      expect(existsSync(result.state.artifactPath)).toBe(true);
      const evidence = JSON.parse(readFileSync(join(cliRunDir, "t-execute-coding.json"), "utf8"));
      expect(evidence.changedFiles).toEqual(["src/orbital.json"]);
      expect(evidence.reservedCost).toBe(0);
      const originalHarness = readFileSync(join(workspace, "tests", "acceptance.mjs"), "utf8");
      const originalManifest = readFileSync(join(workspace, "src", "orbital.json"), "utf8");
      class EditFake extends WritingFake {
        override async executeTask(spec: AgentTaskSpec) {
          writeFileSync(join(spec.cwd, "src", "extra.json"), JSON.stringify({ enabled: true }));
          return { status: "passed" as const, detail: "scoped config extension", changedFiles: ["src/extra.json"], scopeViolations: [], raw: null };
        }
      }
      const modified = await modifyWithBackend({ workspacePath: workspace, repoRoot, runsRoot: join(root, "runs"), change: "Enable the optional constraint feature", coding: { ...coding, backend: new EditFake(new ToolGateway(defaultContext([root]))), acceptanceCriteria: [{ id: "B3", criterion: "Optional constraint feature is enabled", evidenceMethod: "file-contains:src/extra.json:enabled" }], scope: { writable: ["src/extra.json"], forbidden: ["src/orbital.json", "tests", "package.json"] }, expectedOutputs: ["src/extra.json"] } });
      expect(modified.verification.passed).toBe(true);
      expect(modified.verification.checks.map((c) => c.id)).toEqual(["B1", "B2", "SEC_NO_SECRETS", "B3"]);
      expect(readFileSync(join(workspace, "tests", "acceptance.mjs"), "utf8")).toBe(originalHarness);
      expect(readFileSync(join(workspace, "src", "orbital.json"), "utf8")).toBe(originalManifest);
    } finally {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
      if (cliRunDir) rmSync(cliRunDir, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("resolved goal requirements and platforms replace stale understanding while preserving authority", () => {
    const original = parseRequest("Create a quantum flux compiler");
    const goal = mergeModelGoalSpec(buildGoalSpec(original), { targetProduct: "api", platforms: ["server"], functionalRequirements: ["Compile flux graphs"], permissions: ["deploy"], operation: "deploy" });
    const intent = resolveGoalIntent(goal, original);
    expect(intent.productKinds).toEqual(["api"]);
    expect(intent.platforms).toEqual(["server"]);
    expect(intent.explicitRequirements).toContain("Compile flux graphs");
    expect(intent.novelty).toBe("known");
    expect(intent.permissions).toEqual(original.permissions);
    expect(intent.operation).toBe(original.operation);
    expect(() => resolveGoalIntent({ ...goal, sourceIntentId: "another-run" }, original)).toThrow(/identity/);
  });
  it("analysis travels through the real DAG, verifies and exports a report without website files", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-analysis-run-"));
    let workspace = "";
    try {
      const config = { repoRoot, runsRoot: join(root, "runs"), checkpointRoot: join(root, "checkpoints"), analysisSource: { target: join(repoRoot, "tests", "fixtures", "rea-sample-app"), rightsEvidence: "Repository-owned MIT acceptance fixture; structural inventory authorized" } };
      const result = await createRun("Analyze the structural inventory of the source files", config);
      workspace = result.state.workspacePath;
      expect(result.state.error).toBe("");
      expect(result.state.verification?.passed).toBe(true);
      expect(existsSync(result.state.artifactPath)).toBe(true);
      expect(existsSync(join(workspace, "dist"))).toBe(false);
      const report = readFileSync(join(workspace, "report", "ANALYSIS.md"), "utf8");
      expect(report).toContain("SHA-256");
      expect(report).toContain("## Inference");
      expect(report).toContain("inventory.json");
      const graph = buildJobGraphReport(config, result.runId)!;
      expect(graph.tasks.find((t) => t.taskId === "t:execute")?.status).toBe("passed");
      expect(graph.tasks.find((t) => t.taskId === "t:package")?.status).toBe("passed");
    } finally {
      if (workspace) rmSync(workspace, { recursive: true, force: true });
      rmSync(root, { recursive: true, force: true });
    }
  });
});
