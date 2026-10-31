/**
 * OMNIFORGE repair engine (mission C5) — root-cause-driven, bounded, scoped.
 *
 * The old repair stage classified a failure and re-ran the same command. This
 * engine instead:
 *  1. consumes the ACTUAL failure evidence (verification failures, test
 *     stderr, changed files, blueprint criteria);
 *  2. classifies and selects the smallest scoped strategy — deterministic
 *     fixers for known failure shapes, or delegation to an authorized coding
 *     backend for novel fixes (never silently skipped: a missing backend is a
 *     typed BLOCKED outcome);
 *  3. applies the fix only inside the target workspace;
 *  4. re-runs the targeted check AND the persisted original acceptance
 *     criteria as the regression baseline;
 *  5. stops on identical repeat failures (E_REPAIR_NONIMPROVING), budget
 *     exhaustion (E_REPAIR_BUDGET_EXCEEDED), or a missing backend
 *     (E_MODEL_UNAVAILABLE) — actionable blockers instead of loops.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OmniforgeError, type ProductBlueprint, type ValidationResult } from "@omniforge/shared-types";
import { classifyFailure, runProjectTests, verifyWorkspace, type FailureClassification } from "@omniforge/verification";
import type { CodingBackend } from "@omniforge/agent-runtime";
import { loadBlueprint } from "@omniforge/workspace-manager";
import { runGoverned } from "./dag.js";

export interface RepairContext {
  workspacePath: string;
  blueprint: ProductBlueprint | null;
  backend: CodingBackend;
  journal: { append: (node: string, level: "debug" | "info" | "warn" | "error", message: string) => void };
}

export interface RepairInput {
  verification: ValidationResult;
  attempt: number;
  maxAttempts: number;
  /** signatures of failures seen in previous attempts (for non-improving detection) */
  previousSignatures: string[];
}

export interface RepairResult {
  applied: boolean;
  strategy: string;
  classification: FailureClassification;
  changedFiles: string[];
  rerun: ValidationResult | null;
  regressionBaseline: ValidationResult | null;
  blocked?: { code: string; message: string };
}

function failureSignature(verification: ValidationResult): string {
  return verification.failures.slice().sort().join("||").slice(0, 500);
}

/**
 * Deterministic fixers for known, safe failure shapes. Each fixer receives
 * the real evidence and may only mutate the target workspace.
 */
type Fixer = (ctx: RepairContext, input: RepairInput) => { applied: boolean; strategy: string; changedFiles: string[] } | null;

const FIXERS: Array<{ when: (cls: FailureClassification, failures: string[], ctx: RepairContext) => boolean; fix: Fixer }> = [
  {
    // dist/ missing or stale → re-run the project's declared render step
    when: (_cls, failures, ctx) =>
      failures.some((f) => /dist\/index\.html missing|dist\/styles\.css missing|missing link targets/i.test(f)) &&
      existsSync(join(ctx.workspacePath, "scripts", "render.mjs")),
    fix: (ctx, _input) => {
      const cfgPath = join(ctx.workspacePath, "project.config.json");
      const hasConfig = existsSync(cfgPath);
      const r = runGoverned("node", ["scripts/render.mjs"], ctx.workspacePath, 60_000);
      if (r.exitCode !== 0) {
        ctx.journal.append("repair", "warn", `render-based repair failed: ${r.stderr.slice(0, 200)}`);
        return null;
      }
      ctx.journal.append("repair", "info", "repair: re-rendered workspace from config (dist/ rebuilt)");
      return { applied: true, strategy: `re-render${hasConfig ? " (config-driven)" : ""}`, changedFiles: ["dist/"] };
    },
  },
  {
    // project's own suite failed with an assertion — try the workspace's own
    // documented fix entrypoint (fix.mjs) if the template shipped one
    when: (cls, failures) => cls.category === "test-logic" && failures.some((f) => /tests failed/i.test(f)),
    fix: (ctx, _input) => {
      const fixer = join(ctx.workspacePath, "scripts", "fix.mjs");
      if (!existsSync(fixer)) return null;
      const r = runGoverned("node", ["scripts/fix.mjs"], ctx.workspacePath, 60_000);
      if (r.exitCode !== 0) return null;
      ctx.journal.append("repair", "info", "repair: applied workspace fix entrypoint scripts/fix.mjs");
      return { applied: true, strategy: "workspace fix entrypoint", changedFiles: ["src/"] };
    },
  },
];

/**
 * Run one bounded repair attempt. Throws typed blockers; never masks or
 * deletes tests.
 */
export async function executeRepair(ctx: RepairContext, input: RepairInput): Promise<RepairResult> {
  const failures = input.verification.failures;
  const signature = failureSignature(input.verification);

  if (input.previousSignatures.includes(signature)) {
    throw new OmniforgeError("E_REPAIR_NONIMPROVING", "identical failure repeated after repair — stopping instead of looping", {
      signature: signature.slice(0, 200),
      attempts: input.attempt,
    });
  }
  if (input.attempt > input.maxAttempts) {
    throw new OmniforgeError("E_REPAIR_BUDGET_EXCEEDED", `repair budget exhausted (${input.maxAttempts} attempts)`, { attempts: input.attempt });
  }

  const stderrBlob = failures.join("\n") + "\n" + (input.verification.checks.filter((c) => c.status === "failed").map((c) => c.message).join("\n") ?? "");
  const classification = classifyFailure(stderrBlob, failures.length > 0 ? 1 : 0);
  ctx.journal.append("repair", "warn", `repair attempt ${input.attempt}: ${classification.category} — ${classification.suggestedAction}`);

  // 1) deterministic fixers (free-first, no model needed)
  for (const f of FIXERS) {
    if (f.when(classification, failures, ctx)) {
      const outcome = f.fix(ctx, input);
      if (outcome?.applied) {
        return finishWithRerun(ctx, input, outcome.strategy, outcome.changedFiles);
      }
    }
  }

  // 2) novel fix requires an authorized coding backend with generation
  //    capability — a deterministic local executor cannot write novel fixes,
  //    so report the typed gap honestly (never fake a "fix")
  if (ctx.backend.id === "local-node") {
    throw new OmniforgeError("E_MODEL_UNAVAILABLE", "novel repair requires a model-backed coding backend (e.g. opencode); none is authorized in this environment — deterministic fixers did not apply", {
      failures: failures.slice(0, 3),
      prerequisite: "install/configure a coding backend, then re-run; the run stays resumable",
    });
  }

  // 3) delegate the scoped fix to the configured backend
  const task = [
    "Fix the failing checks in this workspace with the smallest possible scoped change.",
    `Failures: ${failures.join(" | ").slice(0, 800)}`,
    "Rules: do not delete or weaken tests; do not touch files outside this workspace; explain the change in one line.",
  ].join("\n");
  const res = await ctx.backend.runTask({ command: task, cwd: ctx.workspacePath, timeoutMs: 180_000 });
  if (res.exitCode !== 0) {
    throw new OmniforgeError("E_MODEL_UNAVAILABLE", `coding backend could not produce a fix (exit ${res.exitCode}): ${res.stderr.slice(0, 200)}`, {});
  }
  return finishWithRerun(ctx, input, "coding-backend scoped fix", []);
}

async function finishWithRerun(ctx: RepairContext, input: RepairInput, strategy: string, changedFiles: string[]): Promise<RepairResult> {
  // targeted re-run of the project's own suite first (fast signal)
  const targeted = runProjectTests(ctx.workspacePath, ctx.backend);
  ctx.journal.append("repair", targeted.status === "passed" ? "info" : "warn", `targeted re-run: ${targeted.status} — ${targeted.message.slice(0, 160)}`);

  // regression baseline: the ORIGINAL persisted acceptance criteria
  const blueprint = ctx.blueprint ?? loadBlueprint(ctx.workspacePath);
  if (!blueprint) {
    throw new OmniforgeError("E_VERIFY_FAILED", "no persisted original blueprint in workspace — regression baseline unavailable; refusing to declare repair successful without evidence", {});
  }
  const rerun = await verifyWorkspace({ workspacePath: ctx.workspacePath, blueprint, backend: ctx.backend });
  ctx.journal.append("repair", rerun.passed ? "info" : "warn", `post-repair verification against original criteria: ${rerun.passed ? "PASSED" : "FAILED"}`);
  return { applied: true, strategy, classification: classifyFailure(input.verification.failures.join("; "), 1), changedFiles, rerun, regressionBaseline: rerun };
}

/** Failures seen before — used by callers to detect non-improving loops. */
export function signatureOf(verification: ValidationResult): string {
  return failureSignature(verification);
}

export { verifyWorkspace };
