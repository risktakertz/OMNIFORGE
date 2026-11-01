import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, lstatSync, readdirSync } from "node:fs";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { OmniforgeError, ProductBlueprint as BlueprintSchema, type AcceptanceCriterion, type ProductBlueprint, type GoalSpec } from "@omniforge/shared-types";
import { snapshotManifest, diffManifests, scopeViolationsOf, type CodingBackend, type FileScope, type AgentTaskSpec } from "@omniforge/agent-runtime";
import { reserveModelCall, type ModelCallPolicy } from "@omniforge/model-router";
import { verifyWorkspace, independentFinalVerification } from "@omniforge/verification";
import { LocalNodeBackend } from "@omniforge/agent-runtime";
import { ToolGateway, defaultContext, scriptTrust, registerProvenanceAuthority } from "@omniforge/tool-gateway";

export interface CodingExecution {
  backend: CodingBackend;
  policy: ModelCallPolicy;
  scope: FileScope;
  acceptanceCriteria: AcceptanceCriterion[];
  expectedOutputs: string[];
  /** Trusted acceptance harness, frozen by the operator before implementation. */
  acceptanceFiles?: Record<string, string>;
}

function boundedTree(root: string): void {
  let files = 0;
  let bytes = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 8) throw new OmniforgeError("E_BUDGET_EXCEEDED", "coding workspace exceeds depth 8");
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git"].includes(name)) throw new OmniforgeError("E_BACKEND_BLOCKED", "coding workspace must exclude dependency and Git metadata");
      const path = join(dir, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "coding workspace symlinks are refused");
      if (stat.isDirectory()) walk(path, depth + 1);
      else if (stat.isFile()) {
        files++; bytes += stat.size;
        if (files >= 5000 || bytes > 32_000_000) throw new OmniforgeError("E_BUDGET_EXCEEDED", "coding workspace exceeds 4999 files/32MB");
      } else throw new OmniforgeError("E_GATEWAY_DENIED", "coding workspace contains a non-regular file");
    }
  };
  walk(root, 0);
}

export function executionBlueprint(goal: GoalSpec, coding: CodingExecution | undefined, originalRequest = goal.objective): ProductBlueprint {
  if (!coding) throw new OmniforgeError("E_NEEDS_MODEL", "novel work requires a healthy authorized coding backend, bounded scope and original acceptance criteria");
  if (!coding.acceptanceCriteria.length || !coding.expectedOutputs.length || !coding.scope.writable.length) throw new OmniforgeError("E_INTENT_UNCLEAR", "coding execution needs frozen acceptance criteria, expected outputs and writable paths");
  if (new Set(coding.acceptanceCriteria.map((c) => c.id)).size !== coding.acceptanceCriteria.length) throw new OmniforgeError("E_INTENT_UNCLEAR", "acceptance criterion IDs must be unique");
  if (coding.acceptanceCriteria.some((c) => c.id === "SEC_NO_SECRETS" && c.evidenceMethod !== "no-secrets")) throw new OmniforgeError("E_INTENT_UNCLEAR", "SEC_NO_SECRETS is reserved for the policy guard");
  const baseline = {
    intentId: goal.sourceIntentId!, contractVersion: "1.1.0", productBrief: `Original request: ${originalRequest}\nResolved objective: ${goal.objective}`,
    scope: { mvp: goal.functionalRequirements.length ? goal.functionalRequirements : [goal.objective], later: [], excluded: ["publication without approval", "out-of-scope writes"] },
    rolesAndFlows: [{ role: "engineer", flow: "implement scoped goal → independent acceptance → export" }],
    architecture: { family: "backend-engineered", platforms: goal.platforms, isolation: "adapter-enforced sandbox + staged workspace" },
    dataModel: {}, contracts: [], threatModel: { risks: goal.risks },
    acceptanceCriteria: coding.acceptanceCriteria.some((c) => c.evidenceMethod === "no-secrets") ? coding.acceptanceCriteria : [...coding.acceptanceCriteria, { id: "SEC_NO_SECRETS", criterion: "No credentials in backend output", evidenceMethod: "no-secrets" }],
    deploymentRequirements: { approved: false },
  };
  return BlueprintSchema.parse(baseline);
}

/** Transactional engine shared by creation and modification; never commits an unverified edit. */
export async function executeCodingTask(coding: CodingExecution, workspace: string, blueprint: ProductBlueprint, taskId: string, runDir: string): Promise<{ changedFiles: string[]; evidencePath: string }> {
  const backend = coding.backend;
  const health = await backend.health();
  if (health.status !== "verified" || !backend.available || !backend.features().modelBacked || !backend.executeTask) throw new OmniforgeError("E_BACKEND_BLOCKED", `backend ${backend.id} is not verified: ${health.detail}`);
  if (!backend.executionBoundary?.().isolated) throw new OmniforgeError("E_SANDBOX_UNAVAILABLE", "coding backend must enforce workspace writes, process resources and egress isolation before execution");
  for (const p of [...coding.scope.writable, ...(coding.scope.forbidden ?? []), ...coding.expectedOutputs]) {
    if (!p || isAbsolute(p) || p.replaceAll("\\", "/").split("/").includes("..")) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "coding scope must contain bounded workspace-relative paths");
  }
  const ledgerPath = join(runDir, "model-budget.json");
  mkdirSync(runDir, { recursive: true });
  const stage = mkdtempSync(join(dirname(workspace), ".coding-task-"));
  try {
    boundedTree(workspace);
    cpSync(workspace, stage, { recursive: true });
    const provenancePath = join(workspace, ".omniforge", "provenance.json");
    if (existsSync(provenancePath)) {
      const manifest = JSON.parse(readFileSync(provenancePath, "utf8")) as { files: Record<string, string>; authorityId?: string };
      if (Object.keys(manifest.files).every((rel) => scriptTrust({ workspacePath: workspace, scriptRelPath: rel, provenancePath }).trusted)) {
        writeFileSync(join(stage, ".omniforge", "provenance.json"), JSON.stringify({ ...manifest, authorityId: registerProvenanceAuthority(stage, manifest.files) }));
      }
    }
    if (existsSync(join(stage, "node_modules")) || existsSync(join(stage, ".git"))) throw new OmniforgeError("E_BACKEND_BLOCKED", "coding stage must exclude dependency and Git metadata; use a clean source workspace");
    const before = snapshotManifest(stage);
    const spec: AgentTaskSpec = { taskId, instruction: blueprint.productBrief, cwd: stage, projectContext: JSON.stringify({ requirements: blueprint.scope, contracts: blueprint.contracts }), fileScope: { writable: coding.scope.writable, forbidden: [...(coding.scope.forbidden ?? []), "project.config.json", "project.blueprint.json", ".omniforge", ".omniforge-lock.json", ".git", "node_modules"] }, acceptanceCriteria: blueprint.acceptanceCriteria.map((c) => `${c.id}: ${c.criterion} (${c.evidenceMethod})`), expectedArtifacts: coding.expectedOutputs, allowedTools: [], model: coding.policy.model, timeoutMs: 120_000, budgetMs: 120_000, risk: "medium" };
    const prepared = await backend.prepare?.(spec);
    if (prepared && !prepared.ok) throw new OmniforgeError("E_BACKEND_BLOCKED", prepared.note);
    const ledger = reserveModelCall(coding.policy, { provider: coding.policy.provider, model: coding.policy.model, endpoint: coding.policy.endpoint }, ledgerPath);
    let timer: NodeJS.Timeout | undefined;
    const result = await Promise.race([backend.executeTask(spec), new Promise<never>((_, reject) => { timer = setTimeout(() => { void backend.cancel?.(taskId); reject(new OmniforgeError("E_BACKEND_BLOCKED", "coding task timed out; sandbox must terminate child processes")); }, 120_000); })]).finally(() => { if (timer) clearTimeout(timer); });
    boundedTree(stage);
    const diff = diffManifests(before, snapshotManifest(stage));
    const changedFiles = [...diff.changed, ...diff.added, ...diff.removed].sort();
    const violations = scopeViolationsOf(diff, spec.fileScope);
    const reported = [...result.changedFiles].sort();
    const evidencePath = join(runDir, `${taskId.replaceAll(":", "-")}-coding.json`);
    writeFileSync(evidencePath, JSON.stringify({ backend: backend.id, status: result.status, changedFiles, reportedFiles: reported, violations, approvalId: coding.policy.approvalId, reservedCost: ledger.reserved }, null, 2));
    if (result.status !== "passed") throw new OmniforgeError(result.status === "failed" ? "E_VERIFY_FAILED" : "E_BACKEND_BLOCKED", "coding backend did not pass; original workspace preserved");
    if (violations.length || result.scopeViolations.length || JSON.stringify(changedFiles) !== JSON.stringify(reported) || !changedFiles.length) throw new OmniforgeError("E_GATEWAY_DENIED", "backend diff evidence or scope contract failed; original workspace preserved");
    if (coding.expectedOutputs.some((p) => !existsSync(resolve(stage, p)))) throw new OmniforgeError("E_VERIFY_FAILED", "expected backend outputs are missing");
    const verification = await verifyWorkspace({ workspacePath: stage, blueprint, backend: new LocalNodeBackend(new ToolGateway(defaultContext([stage]))) });
    writeFileSync(join(runDir, "coding-verification.json"), JSON.stringify(verification, null, 2));
    if (!verification.passed || independentFinalVerification(blueprint, verification).verdict !== "pass") throw new OmniforgeError("E_VERIFY_FAILED", "backend acceptance failed; original workspace preserved");
    await backend.collectDiff?.(stage);
    // Apply only observed authorized files after independent verification.
    const backups = new Map(changedFiles.map((rel) => [rel, existsSync(join(workspace, rel)) ? readFileSync(join(workspace, rel)) : null]));
    try { for (const rel of changedFiles) {
      const dest = resolve(workspace, rel);
      if (isAbsolute(relative(workspace, dest)) || relative(workspace, dest).startsWith("..")) throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "diff path escaped workspace");
      if (diff.removed.includes(rel)) rmSync(dest);
      else { mkdirSync(dirname(dest), { recursive: true }); cpSync(join(stage, rel), dest); }
    } } catch (error) {
      for (const [rel, data] of backups) {
        const path = join(workspace, rel);
        if (data === null) rmSync(path, { force: true });
        else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); }
      }
      throw error;
    }
    return { changedFiles, evidencePath };
  } finally {
    rmSync(stage, { recursive: true, force: true });
    await backend.close();
  }
}
