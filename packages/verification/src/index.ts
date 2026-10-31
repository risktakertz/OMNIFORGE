/**
 * OMNIFORGE verification — applicable evidence or it did not happen.
 *
 * Verification contract v2 (mission D1):
 *  - Original acceptance criteria come from the persisted blueprint — never
 *    from a check list the implementer just produced.
 *  - Every criterion maps to executable evidence via a closed evidenceMethod
 *    vocabulary; outcomes distinguish passed / failed / skipped / blocked /
 *    not-run and critical vs advisory severity.
 *  - `passed` is true only when NOTHING failed AND no CRITICAL check ended
 *    skipped/blocked/not-run. Advisory checks never gate readiness.
 *  - The independent final verifier compares the ORIGINAL blueprint criteria
 *    against observed checks; implementer status strings are never trusted.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import {
  CheckResult,
  ValidationResult,
  Evidence,
  type ProductBlueprint,
  type ValidationResult as Result,
  type CheckResult as Check,
  type Evidence as EvidenceT,
} from "@omniforge/shared-types";
import { looksLikeSecret, nowIso, newId } from "@omniforge/utils";
import type { CodingBackend } from "@omniforge/agent-runtime";

export const VERIFICATION_CONTRACT_VERSION = "2.0.0";

export interface VerifyOptions {
  workspacePath: string;
  blueprint: ProductBlueprint;
  backend?: CodingBackend;
  /** extra checks to append (used by acceptance tests); severity-aware */
  extraChecks?: Array<{
    id: string;
    name: string;
    severity?: Check["severity"];
    run: () => { status: Check["status"]; message?: string };
  }>;
}

function readSafe(p: string): string | null {
  try {
    return existsSync(p) && statSync(p).isFile() ? readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

function listFiles(dir: string, base = ""): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    const rel = base ? `${base}/${e}` : e;
    if (statSync(full, { throwIfNoEntry: false })?.isDirectory()) out.push(...listFiles(full, rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Run the project's own test suite with structured process arguments (no
 * shell interpolation of project files). Distinguishes honest non-run states:
 *  - skipped  : no test script declared (nothing to run)
 *  - blocked  : script needs installed dependencies that are absent —
 *               names the exact prerequisite instead of pretending
 */
export function runProjectTests(
  workspacePath: string,
  backend: CodingBackend
): { status: Check["status"]; message: string; command?: string; logPath?: string } {
  const pkgPath = join(workspacePath, "package.json");
  const pkg = readSafe(pkgPath);
  if (!pkg) return { status: "failed", message: "package.json missing" };
  const testScript = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts?.test;
  if (!testScript) return { status: "skipped", message: "no test script declared" };

  // fast path: "node <file>" runs with plain argv, no shell, no deps needed
  const nodeDirect = testScript.match(/^node\s+(\S+)\s*$/);
  if (nodeDirect) {
    const rel = nodeDirect[1]!;
    if (!existsSync(join(workspacePath, rel))) {
      return { status: "failed", message: `test script target missing: ${rel}` };
    }
    return runArgs(workspacePath, "node", [rel], testScript);
  }

  // node --test / npm test need either the flag form or installed deps
  const nodeTest = testScript.startsWith("node --test");
  if (!nodeTest && !existsSync(join(workspacePath, "node_modules"))) {
    return {
      status: "blocked",
      message:
        "project tests need installed dependencies (npm install) — recorded as BLOCKED, not silently passed; full builds run in the integration workflow on demand",
    };
  }
  if (nodeTest) {
    const glob = testScript.match(/^node\s+--test\s+(.+)$/);
    const target = glob?.[1] ?? "tests/";
    return runArgs(workspacePath, "node", ["--test", ...target.split(/\s+/)], testScript);
  }
  // project's own npm script via npm's argv boundary (script text authored in
  // the generated workspace itself, never from user prompts)
  return runArgs(workspacePath, "npm", ["test", "--silent"], testScript);
}

function runArgs(
  cwd: string,
  cmd: string,
  args: string[],
  label: string
): { status: Check["status"]; message: string; command: string } {
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 90_000,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 4 * 1024 * 1024,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return { status: "failed", message: `tests timed out after 90s (${label})`, command: label };
  }
  if (r.status === 0) {
    return { status: "passed", message: `tests passed (${label})`, command: label };
  }
  const tail = out.split("\n").filter(Boolean).slice(-8).join(" | ").slice(0, 600);
  return {
    status: "failed",
    message: `tests failed exit=${r.status ?? "signal"} (${label}): ${tail}`,
    command: label,
  };
}

function linkCheck(workspacePath: string): { status: Check["status"]; message: string } {
  const htmlPath = join(workspacePath, "dist", "index.html");
  const html = readSafe(htmlPath);
  if (!html) return { status: "skipped", message: "no dist/index.html for link check" };
  const refs = [...html.matchAll(/(?:href|src)="([^"#?]+)(?:[#?][^"]*)?"/g)]
    .map((m) => m[1] ?? "")
    .filter((r) => r && !/^[a-z]+:\/\//i.test(r) && !r.startsWith("//") && !r.startsWith("mailto:") && !r.startsWith("tel:"));
  const missing: string[] = [];
  for (const ref of refs) {
    const candidate = ref.endsWith("/") ? join(workspacePath, "dist", ref, "index.html") : join(workspacePath, "dist", ref);
    if (!existsSync(candidate)) missing.push(ref);
  }
  return missing.length === 0
    ? { status: "passed", message: `${refs.length} internal refs resolved` }
    : { status: "failed", message: `missing link targets: ${missing.join(", ")}` };
}

function noSecrets(workspacePath: string): { status: Check["status"]; message: string } {
  const offenders: string[] = [];
  for (const rel of listFiles(workspacePath)) {
    if (/(^|\/)(node_modules|dist-export)(\/|$)/.test(rel)) continue;
    const text = readSafe(join(workspacePath, rel));
    if (text && looksLikeSecret(text)) offenders.push(rel);
  }
  return offenders.length === 0
    ? { status: "passed", message: "no secret patterns found" }
    : { status: "failed", message: `secret-like content in: ${offenders.slice(0, 5).join(", ")}` };
}

function structureCheck(workspacePath: string): { status: Check["status"]; message: string } {
  const required = ["package.json", "README.md"];
  const missing = required.filter((f) => !existsSync(join(workspacePath, f)));
  const hasTests = existsSync(join(workspacePath, "tests")) || existsSync(join(workspacePath, "test"));
  if (missing.length === 0 && hasTests) return { status: "passed", message: "structure complete" };
  return { status: "failed", message: `missing: ${[...missing, ...(hasTests ? [] : ["tests/"])].join(", ")}` };
}

const NON_RUN: Array<Check["status"]> = ["skipped", "blocked", "not-run"];

export async function verifyWorkspace(opts: VerifyOptions): Promise<Result> {
  const { workspacePath, blueprint } = opts;
  const checks: Check[] = [];
  const evidence: EvidenceT[] = [];

  for (const ac of blueprint.acceptanceCriteria) {
    const method = ac.evidenceMethod;
    let result: { status: Check["status"]; message: string };
    if (method.startsWith("file-exists:")) {
      const rel = method.slice("file-exists:".length);
      result = existsSync(join(workspacePath, rel))
        ? { status: "passed", message: `${rel} exists` }
        : { status: "failed", message: `${rel} missing` };
    } else if (method.startsWith("file-contains:")) {
      const [, rel, needle] = method.split(":");
      const content = readSafe(join(workspacePath, rel ?? ""));
      result =
        content && needle && content.toLowerCase().includes(needle.toLowerCase())
          ? { status: "passed", message: `${rel} contains "${needle}"` }
          : { status: "failed", message: `${rel} missing "${needle}"` };
    } else if (method === "run-project-tests") {
      result = opts.backend
        ? runProjectTests(workspacePath, opts.backend)
        : { status: "not-run", message: "no execution backend provided" };
    } else if (method === "no-secrets") {
      result = noSecrets(workspacePath);
    } else if (method === "link-check") {
      result = linkCheck(workspacePath);
    } else if (method === "structure-check") {
      result = structureCheck(workspacePath);
    } else {
      // unknown method: an acceptance criterion without executable evidence is
      // NOT-RUN — an honest non-run that blocks readiness (contract v2)
      result = { status: "not-run", message: `no executable evidence method for '${method}'` };
    }
    checks.push(
      CheckResult.parse({
        id: ac.id,
        name: ac.criterion,
        status: result.status,
        message: result.message,
        evidencePaths: [],
        severity: "critical",
      })
    );
    evidence.push(
      Evidence.parse({
        taskId: ac.id,
        commandOrTool: method,
        environment: `workspace:${relative(process.cwd(), workspacePath) || workspacePath}`,
        timestamp: nowIso(),
        exitStatus: result.status,
        artifactPaths: [],
        summary: result.message,
      })
    );
  }

  for (const extra of opts.extraChecks ?? []) {
    const r = extra.run();
    checks.push(
      CheckResult.parse({
        id: extra.id,
        name: extra.name,
        status: r.status,
        message: r.message ?? "",
        evidencePaths: [],
        severity: extra.severity ?? "advisory",
      })
    );
  }

  const failures = checks.filter((c) => c.status === "failed").map((c) => `${c.id}: ${c.message}`);
  const criticalNonRun = checks.filter((c) => c.severity === "critical" && NON_RUN.includes(c.status));
  // contract v2: readiness requires zero failures AND zero critical non-runs
  const passed = failures.length === 0 && criticalNonRun.length === 0;
  return ValidationResult.parse({
    target: workspacePath,
    checks,
    passed,
    failures: [...failures, ...criticalNonRun.map((c) => `${c.id}: critical check did not run (${c.status}) — ${c.message}`)],
  });
}

/* ------------------------------------------------------------------ */
/* Failure classification + bounded repair policy                      */
/* ------------------------------------------------------------------ */

export type FailureCategory =
  | "test-logic"
  | "environment"
  | "permissions"
  | "missing-tool"
  | "external-api"
  | "resources"
  | "architecture"
  | "unverifiable";

export interface FailureClassification {
  category: FailureCategory;
  retryable: boolean;
  suggestedAction: string;
}

export function classifyFailure(stderr: string, exitCode: number | null): FailureClassification {
  const s = stderr.toLowerCase();
  if (/eacces|eperm|permission denied/.test(s)) return { category: "permissions", retryable: false, suggestedAction: "request approval or fix workspace permissions; never bypass the gateway" };
  if (/enoent.*(node|npm|tsc|godot|expo|cargo)|command not found/.test(s)) return { category: "missing-tool", retryable: false, suggestedAction: "install the documented toolchain or record honest blocked status" };
  if (/etimedout|timeout|econnrefused|enotfound|rate limit/.test(s)) return { category: "external-api", retryable: exitCode !== null, suggestedAction: "bounded retry with backoff; verify network allowlist" };
  if (/enospc|no space|out of memory|heap/.test(s)) return { category: "resources", retryable: false, suggestedAction: "reduce scope or free resources; never mask by deleting tests" };
  if (/assert|expect|failed.*test|test.*failed/.test(s)) return { category: "test-logic", retryable: false, suggestedAction: "smallest scoped code fix; rerun affected + regression tests" };
  if (/syntaxerror|typeerror|cannot read|undefined is not/.test(s)) return { category: "test-logic", retryable: false, suggestedAction: "fix the defect at the cited location; no assertion deletion" };
  return { category: exitCode === 0 ? "unverifiable" : "environment", retryable: exitCode !== null, suggestedAction: "capture redacted logs; escalate diagnostics if repeated" };
}

/**
 * Independent final verification (contract v2): compare the ORIGINAL
 * blueprint's acceptance criteria against the observed checks. Any unmatched
 * criterion, failed check, or critical non-run fails the verdict. This
 * function deliberately takes the persisted original blueprint — callers must
 * not synthesize criteria from the results being judged.
 */
export function independentFinalVerification(
  blueprint: Pick<ProductBlueprint, "acceptanceCriteria">,
  result: Result
): { verdict: "pass" | "fail"; checked: number; unmatched: string[]; nonRunCritical: string[]; summary: string } {
  const criteriaIds = new Set(blueprint.acceptanceCriteria.map((a) => a.id));
  const checkIds = new Set(result.checks.map((c) => c.id));
  const unmatched = [...criteriaIds].filter((id) => !checkIds.has(id));
  const failed = result.checks.filter((c) => c.status === "failed");
  const nonRunCritical = result.checks.filter((c) => c.severity === "critical" && NON_RUN.includes(c.status));
  const extraNotInBlueprint = result.checks.filter((c) => !criteriaIds.has(c.id) && c.severity === "critical");
  const verdict =
    failed.length === 0 && unmatched.length === 0 && nonRunCritical.length === 0 && extraNotInBlueprint.length === 0
      ? "pass"
      : "fail";
  return {
    verdict,
    checked: result.checks.length,
    unmatched,
    nonRunCritical: nonRunCritical.map((c) => c.id),
    summary:
      verdict === "pass"
        ? `all ${criteriaIds.size} original acceptance criteria ran and passed with evidence (${result.checks.length} checks)`
        : `failures: ${[
            ...failed.map((f) => f.id),
            ...unmatched.map((u) => `missing:${u}`),
            ...nonRunCritical.map((s) => `critical-${s.status}:${s.id}`),
            ...extraNotInBlueprint.map((x) => `unexpected-critical:${x.id}`),
          ].join(", ")}`,
  };
}

export function makeEvidence(taskId: string, commandOrTool: string, status: string, summary: string): EvidenceT {
  return Evidence.parse({
    taskId,
    commandOrTool,
    environment: process.platform,
    timestamp: nowIso(),
    exitStatus: status,
    artifactPaths: [],
    summary,
    redactedLogRef: newId("log"),
  });
}
