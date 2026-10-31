/**
 * Executable skill invocation (mission C3).
 * A SKILL.md is instructions; the entrypoint is the integration. Selected
 * skills that declare `entrypoint: scripts/<name>.mjs` are actually executed
 * here — with typed JSON stdin/stdout, gateway-gated argv execution, timeouts
 * and evidence. A missing/failed invocation is a typed outcome, never a
 * log-only mention.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { OmniforgeError, type Evidence } from "@omniforge/shared-types";
import { nowIso } from "@omniforge/utils";
import { ToolGateway } from "@omniforge/tool-gateway";
import type { CapabilityRegistry } from "@omniforge/capability-registry";

export interface SkillInvocationResult {
  skillId: string;
  entrypoint: string;
  status: "passed" | "failed" | "skipped" | "blocked";
  message: string;
  exitCode: number | null;
  durationMs: number;
  evidence: Evidence;
}

/**
 * Invoke a skill's declared entrypoint with a typed JSON contract.
 * The entrypoint receives `input` on stdin and answers with JSON on stdout.
 */
export function invokeSkill(
  gateway: ToolGateway,
  repoRoot: string,
  registry: CapabilityRegistry,
  skillId: string,
  input: unknown,
  opts: { timeoutMs?: number } = {}
): SkillInvocationResult {
  registry.ensure();
  const entrypoint = registry.entrypointOf(skillId);
  if (!entrypoint) {
    throw new OmniforgeError("E_CAPABILITY_MISSING", `skill ${skillId} declares no executable entrypoint`, { skillId });
  }
  const abs = join(repoRoot, "skills", skillId.replace(/^skill:/, ""), entrypoint);
  if (!existsSync(abs)) {
    throw new OmniforgeError("E_CAPABILITY_MISSING", `skill ${skillId} entrypoint missing on disk: ${entrypoint}`, { skillId });
  }
  gateway.authorizeExec("node", [abs], { cwd: repoRoot, tool: "run" });
  const started = Date.now();
  const r = spawnSync("node", [abs], {
    input: JSON.stringify(input),
    encoding: "utf8",
    timeout: opts.timeoutMs ?? 90_000,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const durationMs = Date.now() - started;
  let parsed: { skill?: string; status?: string; message?: string } = {};
  try {
    parsed = JSON.parse(String(r.stdout ?? "").trim().split("\n").filter(Boolean).pop() ?? "{}");
  } catch {
    /* malformed output handled below */
  }
  const status = r.status === 0 && parsed.status ? (parsed.status as SkillInvocationResult["status"]) : r.status === 0 ? "passed" : "failed";
  return {
    skillId,
    entrypoint,
    status,
    message: parsed.message ?? (String(r.stderr ?? "").slice(0, 300) || `exit ${r.status}`),
    exitCode: r.status,
    durationMs,
    evidence: {
      taskId: skillId,
      commandOrTool: `node ${entrypoint}`,
      environment: `${process.platform}/skill-invocation`,
      timestamp: nowIso(),
      exitStatus: String(r.status),
      artifactPaths: [],
      summary: parsed.message ?? `skill invocation exit ${r.status}`,
    },
  };
}
