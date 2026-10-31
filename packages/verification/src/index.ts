/**
 * OMNIFORGE verification — applicable evidence or it did not happen.
 * Implements the closed evidenceMethod vocabulary produced by the blueprint
 * engine, collects Evidence records, classifies failures for bounded repair,
 * and provides an independent final verifier that re-checks the blueprint's
 * acceptance criteria against collected evidence (never the implementer's
 * own claims).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { CheckResult, ValidationResult, Evidence, OmniforgeError, type ProductBlueprint, type ValidationResult as Result, type CheckResult as Check, type Evidence as EvidenceT } from "@omniforge/shared-types";
import { looksLikeSecret, nowIso, newId } from "@omniforge/utils";
import type { CodingBackend } from "@omniforge/agent-runtime";

export interface VerifyOptions {
  workspacePath: string;
  blueprint: ProductBlueprint;
  backend?: CodingBackend;
  /** extra checks to append (used by acceptance tests) */
  extraChecks?: Array<{ id: string; name: string; run: () => { status: Check["status"]; message?: string } }>;
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

export function runProjectTests(workspacePath: string, backend: CodingBackend): { status: Check["status"]; message: string; logPath?: string } {
  const pkgPath = join(workspacePath, "package.json");
  const pkg = readSafe(pkgPath);
  if (!pkg) return { status: "failed", message: "package.json missing" };
  const testScript = (JSON.parse(pkg) as { scripts?: Record<string, string> }).scripts?.test;
  if (!testScript) return { status: "skipped", message: "no test script declared" };
  if (!testScript.startsWith("node ") && !existsSync(join(workspacePath, "node_modules"))) {
    return { status: "skipped", message: "dependencies not installed in this workspace; run npm install locally (integration workflow verifies full builds on demand)" };
  }
  const command = testScript.startsWith("node ") ? testScript : "npm test --silent";
  void backend;
  // tests run synchronously via child_process for determinism
  try {
    const out = execFileSync("sh", ["-c", command], {
      cwd: workspacePath,
      encoding: "utf8",
      timeout: 90_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "passed", message: `tests passed (${command})`, logPath: undefined, ...{ output: out.slice(0, 2000) } };
  } catch (e) {
    const err = e as { status?: number; stderr?: string; message?: string };
    return { status: "failed", message: `tests failed (${command}): ${(err.stderr ?? err.message ?? "").slice(0, 500)}` };
  }
}

function linkCheck(workspacePath: string): { status: Check["status"]; message: string } {
  const htmlPath = join(workspacePath, "dist", "index.html");
  const html = readSafe(htmlPath);
  if (!html) return { status: "skipped", message: "no dist/index.html for link check" };
  const refs = [...html.matchAll(/(?:href|src)="([^"#?]+)(?:[#?][^"]*)?"/g)].map((m) => m[1] ?? "").filter((r) => r && !/^[a-z]+:\/\//i.test(r) && !r.startsWith("//") && !r.startsWith("mailto:") && !r.startsWith("tel:"));
  const missing: string[] = [];
  for (const ref of refs) {
    const target = join(workspacePath, "dist", ref.replace(/^\.\//, "").replace(/\/$/, "") === ref ? ref : ref, "");
    const candidate = ref.endsWith("/") ? join(workspacePath, "dist", ref, "index.html") : join(workspacePath, "dist", ref);
    void target;
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
        : { status: "skipped", message: "no execution backend provided" };
    } else if (method === "no-secrets") {
      result = noSecrets(workspacePath);
    } else if (method === "link-check") {
      result = linkCheck(workspacePath);
    } else if (method === "structure-check") {
      result = structureCheck(workspacePath);
    } else {
      result = { status: "skipped", message: `evidence method '${method}' handled by acceptance suite` };
    }
    checks.push(
      CheckResult.parse({ id: ac.id, name: ac.criterion, status: result.status, message: result.message, evidencePaths: [] })
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
    checks.push(CheckResult.parse({ id: extra.id, name: extra.name, status: r.status, message: r.message ?? "", evidencePaths: [] }));
  }

  const failures = checks.filter((c) => c.status === "failed").map((c) => `${c.id}: ${c.message}`);
  return ValidationResult.parse({
    target: workspacePath,
    checks,
    passed: failures.length === 0,
    failures,
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
 * Independent final verification: re-derives the verdict from the collected
 * check results against the blueprint — deliberately not trusting any
 * implementer-provided status string.
 */
export function independentFinalVerification(
  blueprint: ProductBlueprint,
  result: Result
): { verdict: "pass" | "fail"; checked: number; unmatched: string[]; summary: string } {
  const criteriaIds = new Set(blueprint.acceptanceCriteria.map((a) => a.id));
  const checkIds = new Set(result.checks.map((c) => c.id));
  const unmatched = [...criteriaIds].filter((id) => !checkIds.has(id));
  const failed = result.checks.filter((c) => c.status === "failed");
  const skippedCritical = result.checks.filter((c) => c.status === "skipped" && criteriaIds.has(c.id));
  const verdict = result.passed && unmatched.length === 0 && failed.length === 0 && skippedCritical.length === 0 ? "pass" : "fail";
  return {
    verdict,
    checked: result.checks.length,
    unmatched,
    summary:
      verdict === "pass"
        ? `all ${result.checks.length} acceptance checks passed with evidence`
        : `failures: ${[...failed.map((f) => f.id), ...unmatched.map((u) => `missing:${u}`), ...skippedCritical.map((s) => `skipped:${s.id}`)].join(", ")}`,
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

void OmniforgeError; // reserved for typed repair failures in M5 repair engine
