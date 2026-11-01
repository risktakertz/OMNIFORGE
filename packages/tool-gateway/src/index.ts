/**
 * OMNIFORGE tool gateway — deterministic policy in front of ALL tools and
 * external actions. Nothing here consults a model. Classes of action are
 * separated; filesystem writes are confined to approved roots; spend above
 * APPROVED_SPEND (default 0) requires approval; destructive operations require
 * approval. Every decision is auditable.
 */
import { existsSync, readFileSync, realpathSync, readdirSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { resolve, isAbsolute, join, sep, dirname, relative } from "node:path";
import { createHash } from "node:crypto";
import { OmniforgeError, ToolInvocation, type ToolInvocation as Invocation } from "@omniforge/shared-types";
import { newId, nowIso, redactSecrets } from "@omniforge/utils";

export type ActionClass =
  | "read-inspect"
  | "workspace-write"
  | "dependency-install"
  | "execute-code"
  | "network-fetch"
  | "repo-push"
  | "third-party-login"
  | "production-modify"
  | "public-post"
  | "payment"
  | "destructive-fs"
  | "deploy";

export const ACTION_RISK: Record<ActionClass, { risk: "low" | "medium" | "high"; needsApproval: boolean }> = {
  "read-inspect": { risk: "low", needsApproval: false },
  "workspace-write": { risk: "low", needsApproval: false },
  "dependency-install": { risk: "medium", needsApproval: false },
  "execute-code": { risk: "medium", needsApproval: false },
  "network-fetch": { risk: "low", needsApproval: false },
  // universal-upgrade §6.5: pushes to remote repositories are externally
  // visible actions and require an explicit, scope-specific approval
  "repo-push": { risk: "high", needsApproval: true },
  "third-party-login": { risk: "high", needsApproval: true },
  "production-modify": { risk: "high", needsApproval: true },
  "public-post": { risk: "high", needsApproval: true },
  payment: { risk: "high", needsApproval: true },
  "destructive-fs": { risk: "high", needsApproval: true },
  deploy: { risk: "high", needsApproval: true },
};

export interface ApprovalRecord {
  id: string;
  /** the exact tool/action this approval unlocks (e.g. "deploy", "git-push") */
  action: string;
  /** absolute paths this approval is scoped to (empty = action-wide) */
  targets?: string[];
  /** run this approval belongs to */
  runId?: string;
  decidedAt?: string;
}

export interface PolicyContext {
  /** Approved writable roots (workspace path(s), temp dirs). */
  writableRoots: string[];
  /** APPROVED_SPEND value (default 0). */
  approvedSpend: number;
  /** Permissions explicitly granted for this run. */
  permissions: string[];
  /** Approvals already recorded — action- and scope-specific. */
  approvals: Map<string, ApprovalRecord>;
  /** Resolved execution-isolation policy (lazily probed when absent). */
  sandbox?: SandboxPolicy;
}

export function defaultContext(writableRoots: string[]): PolicyContext {
  return {
    writableRoots,
    approvedSpend: Number(process.env.APPROVED_SPEND ?? "0") || 0,
    permissions: [],
    approvals: new Map(),
  };
}

/* ------------------------------------------------------------------ */
/* Execution isolation (mission D2)                                    */
/* ------------------------------------------------------------------ */

export type SandboxMode = "container" | "host-allowlist" | "none";

export interface SandboxPolicy {
  mode: SandboxMode;
  runtime: string | null;
  detail: string;
}

/**
 * Probe for a host-enforced sandbox (Docker/Podman). argv-based, cached by
 * the caller. "host-allowlist" means: only known-safe argv commands may run
 * on the host; anything untrusted requires a real container.
 */
export function resolveSandbox(probe: (bin: string, args: string[]) => { status: number | null } = defaultProbe): SandboxPolicy {
  for (const rt of ["docker", "podman"]) {
    const r = probe(rt, ["info", "--format", "{{.ServerVersion}}"]);
    if (r.status === 0) {
      return { mode: "container", runtime: rt, detail: `${rt} available — untrusted code can run in an isolated container` };
    }
  }
  return {
    mode: "host-allowlist",
    runtime: null,
    detail: "no container runtime on this host — only allowlisted known-safe commands (template render/tests, node/git argv) may execute; untrusted generated code is refused (E_SANDBOX_UNAVAILABLE)",
  };
}

function defaultProbe(bin: string, args: string[]): { status: number | null } {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 5_000, stdio: "ignore" });
  return { status: r.status };
}

/* ------------------------------------------------------------------ */
/* Container isolation provider (universal-upgrade §6.3)              */
/* ------------------------------------------------------------------ */

export interface IsolatedExecSpec {
  image: string;
  argv: string[];
  /** absolute host paths mounted read-only into the container */
  readOnlyMounts: string[];
  /** absolute host path mounted read-write (the bounded workspace) */
  workdir: string;
  /** workdir path INSIDE the container (default /workspace) */
  containerWorkdir?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxBufferBytes?: number;
  /** network policy: containers default to NO network (§6.3 egress) */
  allowNetwork?: boolean;
}

export interface IsolatedExecResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** the exact container runtime used — proof the job ran isolated */
  runtime: string;
  containerRef: string;
}

/**
 * Execute untrusted code in a REAL container (docker/podman). This is not a
 * probe: the job actually launches inside the runtime, with bounded mounts,
 * no network by default, a non-root identity and a hard timeout. When no
 * runtime exists the typed E_SANDBOX_UNAVAILABLE is thrown — untrusted code
 * never falls back to host execution (§6.2/6.3).
 */
export function runIsolated(spec: IsolatedExecSpec, probe: (bin: string, args: string[]) => { status: number | null } = defaultProbe): IsolatedExecResult {
  const sandbox = resolveSandbox(probe);
  if (sandbox.mode !== "container" || !sandbox.runtime) {
    throw new OmniforgeError(
      "E_SANDBOX_UNAVAILABLE",
      `isolated execution requires a container runtime (docker/podman); this host reports: ${sandbox.detail}`,
      { image: spec.image }
    );
  }
  const runtime = sandbox.runtime;
  const containerRef = newId("of");
  const innerWorkdir = spec.containerWorkdir ?? "/workspace";
  const argv = [
    runtime,
    "run",
    "--rm",
    "--name", containerRef,
    "--pull", "never",
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--network", spec.allowNetwork ? "bridge" : "none",
    "--user", "nobody",
    "--cpus", "1",
    "--memory", "512m",
    "--pids-limit", "64",
    "--read-only",
    "-v", `${resolve(spec.workdir)}:${innerWorkdir}`,
    ...spec.readOnlyMounts.flatMap((m, i) => ["-v", `${resolve(m)}:/mnt/ro-${i}:ro`]),
    "-w", innerWorkdir,
    ...Object.entries(spec.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
    spec.image,
    ...spec.argv,
  ];
  const started = Date.now();
  const timeoutMs = spec.timeoutMs ?? 120_000;
  const max = spec.maxBufferBytes ?? 512 * 1024;
  const r = spawnSync(argv[0]!, argv.slice(1), {
    encoding: "utf8",
    timeout: timeoutMs,
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 8 * 1024 * 1024,
  });
  const timedOut = Boolean(r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT");
  if (timedOut) spawnSync(runtime, ["rm", "-f", containerRef], { encoding: "utf8", timeout: 10_000, stdio: "ignore" });
  return {
    exitCode: r.status,
    stdout: redactSecrets(String(r.stdout ?? "").slice(0, max)),
    stderr: redactSecrets(String(r.stderr ?? "").slice(0, max)),
    durationMs: Date.now() - started,
    timedOut,
    runtime,
    containerRef,
  };
}

/* ------------------------------------------------------------------ */
/* Script provenance trust boundary (§6.1/6.2)                          */
/* ------------------------------------------------------------------ */

/**
 * Decide whether a workspace script is trusted repository-owned content.
 * A script is trusted ONLY when its bytes are identical to the versioned
 * template it was scaffolded from (provenance by hash, not by assumption).
 * Anything the agent, a model, or a third party wrote is untrusted and must
 * not run on the host without a container (§6.2: an allowlisted interpreter
 * executing arbitrary content is NOT a sandbox).
 */
export function scriptTrust(opts: {
  workspacePath: string;
  scriptRelPath: string;
  templateRoot?: string;
  templateId?: string;
  /** explicit trust declarations (repo-owned tests, gateway-invoked skills) */
  trustedPaths?: string[];
  /** compose-time provenance manifest (.omniforge/provenance.json) to check */
  provenancePath?: string;
}): { trusted: boolean; reason: string; hash: string } {
  const hashOf = (p: string): string => {
    try {
      return createHash("sha256").update(readFileSync(p)).digest("hex");
    } catch {
      return "absent";
    }
  };
  const abs = join(resolve(opts.workspacePath), opts.scriptRelPath);
  const rel = relative(resolve(opts.workspacePath), abs);
  if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return { trusted: false, reason: "script escapes workspace", hash: "absent" };
  const hash = hashOf(abs);
  if (hash === "absent") return { trusted: false, reason: "script missing", hash };
  if ((opts.trustedPaths ?? []).some((t) => abs === resolve(t) || abs.startsWith(resolve(t) + sep))) {
    return { trusted: true, reason: "explicitly trusted path (repo-owned)", hash };
  }
  if (opts.templateRoot && opts.templateId && /^template:[a-z0-9-]+$/.test(opts.templateId)) {
    const candidate = join(resolve(opts.templateRoot), opts.templateId.replace(/^template:/, ""), opts.scriptRelPath);
    if (hashOf(candidate) === hash) {
      return { trusted: true, reason: `byte-identical to versioned template ${opts.templateId}`, hash };
    }
  }
  if (opts.provenancePath && existsSync(opts.provenancePath)) {
    try {
      const manifest = JSON.parse(readFileSync(opts.provenancePath, "utf8")) as { files?: Record<string, string>; authorityId?: string };
      const authority = manifest.authorityId && /^prov_[a-f0-9]+$/.test(manifest.authorityId) ? JSON.parse(readFileSync(join(tmpdir(), "omniforge-trust", `${manifest.authorityId}.json`), "utf8")) as { files?: Record<string, string>; workspace: string } : null;
      if (authority && resolve(authority.workspace) === resolve(opts.workspacePath) && authority.files?.[opts.scriptRelPath] === hash && manifest.files?.[opts.scriptRelPath] === hash) {
        return { trusted: true, reason: "matches compose-time provenance manifest", hash };
      }
    } catch {
      /* corrupt manifest → not trusted */
    }
  }
  return { trusted: false, reason: "no provenance match — treat as untrusted generated code (container required)", hash };
}

/** Detached host authority is outside all generated workspace/container mounts. */
export function registerProvenanceAuthority(workspace: string, files: Record<string, string>): string {
  const root = join(tmpdir(), "omniforge-trust");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const authorityId = newId("prov");
  writeFileSync(join(root, `${authorityId}.json`), JSON.stringify({ workspace: resolve(workspace), files }), { flag: "wx", mode: 0o600 });
  return authorityId;
}

/** One boundary for workspace commands, including imports and npm lifecycle scripts. */
export function runWorkspaceCommand(opts: {
  workspacePath: string;
  argv: string[];
  templateRoot?: string;
  templateId?: string;
  timeoutMs?: number;
  probeSandbox?: (bin: string, args: string[]) => { status: number | null };
}): { exitCode: number | null; stdout: string; stderr: string; timedOut: boolean; blocked?: string; isolated: boolean } {
  let trusted = true;
  let count = 0;
  const walk = (dir: string, depth: number): void => {
    if (depth > 8 || count > 5000) { trusted = false; return; }
    for (const name of readdirSync(dir)) {
      if (["node_modules", ".git", ".omniforge", "dist-export"].includes(name)) continue;
      const path = join(dir, name);
      const st = lstatSync(path);
      if (st.isSymbolicLink()) { trusted = false; continue; }
      if (st.isDirectory()) walk(path, depth + 1);
      else if (/\.(?:[cm]?js|[cm]?ts)$/i.test(name) || name === "package.json") {
        count++;
        let scriptRelPath = relative(opts.workspacePath, path).split(sep).join("/");
        if (scriptRelPath.startsWith("dist/")) {
          const source = scriptRelPath.replace(/^dist\//, "src/");
          if (existsSync(join(opts.workspacePath, source)) && readFileSync(path).equals(readFileSync(join(opts.workspacePath, source)))) scriptRelPath = source;
        }
        const trust = scriptTrust({ workspacePath: opts.workspacePath, scriptRelPath, ...(opts.templateRoot ? { templateRoot: opts.templateRoot } : {}), ...(opts.templateId ? { templateId: opts.templateId } : {}), provenancePath: join(opts.workspacePath, ".omniforge", "provenance.json") });
        if (!trust.trusted) trusted = false;
      }
    }
  };
  walk(opts.workspacePath, 0);
  // npm can invoke lifecycle hooks/dependencies: it always needs isolation.
  if (opts.argv[0] !== "node") trusted = false;
  const targets = opts.argv.slice(opts.argv[1] === "--test" ? 2 : 1);
  if (!targets.length || targets.some((p) => p.startsWith("-") || isAbsolute(p) || relative(resolve(opts.workspacePath), resolve(opts.workspacePath, p)).startsWith(".."))) trusted = false;
  if (!trusted) {
    try {
      const r = runIsolated({ image: "node:22-bookworm-slim", argv: opts.argv, readOnlyMounts: [], workdir: opts.workspacePath, timeoutMs: opts.timeoutMs ?? 90_000 }, opts.probeSandbox);
      return { ...r, isolated: true };
    } catch (error) {
      if (!(error instanceof OmniforgeError) || error.code !== "E_SANDBOX_UNAVAILABLE") throw error;
      return { exitCode: null, stdout: "", stderr: "", timedOut: false, isolated: false, blocked: "E_SANDBOX_UNAVAILABLE: workspace code lacks trusted provenance; install Docker/Podman and the node:22-bookworm-slim image" };
    }
  }
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, opts.argv.slice(1), { cwd: opts.workspacePath, env, encoding: "utf8", timeout: opts.timeoutMs ?? 90_000, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 4 * 1024 * 1024 });
  return { exitCode: r.status, stdout: redactSecrets(String(r.stdout ?? "")), stderr: redactSecrets(String(r.stderr ?? "")), timedOut: (r.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT", isolated: false };
}

/** Binaries that may execute on the host under the allowlist policy. */
export const HOST_ALLOWLIST = new Set([
  "node", "npm", "npx", "pnpm", "git", "tar", "ls", "cat", "pwd", "echo",
  "sleep", "head", "tail", "wc", "sh", "bash", "cmd", "docker", "podman",
]);

/** Shell metacharacters that disqualify an argument from argv execution. */
export const ARGV_UNSAFE = /[|&;<>()$`'\"*?[\]{}~\n\r]/;

export interface Decision {
  decision: "allow" | "deny" | "approval-required";
  actionClass: ActionClass;
  reason: string;
  invocation: Invocation;
}

export class ToolGateway {
  private readonly auditLog: Invocation[] = [];

  constructor(private readonly ctx: PolicyContext) {}

  classify(tool: string): ActionClass {
    if (/^(read|inspect|list|stat|grep|doctor|status)$/.test(tool)) return "read-inspect";
    if (/^(write|render|scaffold|copy|generate)$/.test(tool)) return "workspace-write";
    if (/^(install|pnpm-install|npm-install)$/.test(tool)) return "dependency-install";
    if (/^(run|exec|test|build)$/.test(tool)) return "execute-code";
    if (/^(fetch|download)$/.test(tool)) return "network-fetch";
    if (/^(git-push|push)$/.test(tool)) return "repo-push";
    if (/^(oauth|login)$/.test(tool)) return "third-party-login";
    if (/^(db-migrate|prod-write)$/.test(tool)) return "production-modify";
    if (/^(post|send-message|email|whatsapp)$/.test(tool)) return "public-post";
    if (/^(charge|pay|purchase|subscribe)$/.test(tool)) return "payment";
    if (/^(rm-rf|delete|format|force-push)$/.test(tool)) return "destructive-fs";
    if (/^(deploy|publish-site)$/.test(tool)) return "deploy";
    return "execute-code";
  }

  private confinedToRoots(target: string): boolean {
    const abs = resolve(target);
    return this.ctx.writableRoots.some((root) => {
      const absRoot = resolve(root);
      if (!existsSync(absRoot)) return false;
      let real: string;
      try {
        real = realpathSync(absRoot);
      } catch {
        return false;
      }
      // realpath the nearest EXISTING ancestor of the target so dangling
      // symlinks along the path cannot escape the root
      let probe = abs;
      while (dirname(probe) !== probe && !existsSync(probe)) {
        probe = dirname(probe);
      }
      let realTarget: string;
      try {
        realTarget = existsSync(probe) ? join(realpathSync(probe), relative(probe, abs)) : abs;
      } catch {
        return false;
      }
      return realTarget === real || realTarget.startsWith(real + sep);
    });
  }

  /**
   * Path safety for any write. Rejects escapes, symlink tricks and nonexistent
   * roots before an operation is allowed anywhere near the filesystem.
   */
  checkPath(target: string): void {
    if (!isAbsolute(target)) {
      throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "path must be absolute for gateway check", { target });
    }
    if (!this.confinedToRoots(target)) {
      throw new OmniforgeError("E_GATEWAY_PATH_ESCAPE", "target path is outside approved writable roots", { target: redactSecrets(target) });
    }
  }

  authorize(tool: string, detail: Record<string, unknown> = {}): Decision {
    const actionClass = this.classify(tool);
    const policy = ACTION_RISK[actionClass];
    let decision: Decision["decision"] = "allow";
    let reason = "policy allow";

    if (policy.needsApproval) {
      const granted = this.hasScopedApproval(tool, detail.target !== undefined ? String(detail.target) : undefined);
      decision = granted ? "allow" : "approval-required";
      reason = granted ? "scoped approval on record for this action/target" : `${actionClass} requires human approval (action+scope specific)`;
    }
    if (detail.spend !== undefined && Number(detail.spend) > this.ctx.approvedSpend) {
      decision = "approval-required";
      reason = `spend ${detail.spend} exceeds APPROVED_SPEND=${this.ctx.approvedSpend}`;
    }
    if (detail.target !== undefined && ["workspace-write", "destructive-fs", "execute-code"].includes(actionClass)) {
      try {
        this.checkPath(String(detail.target));
        if (actionClass === "workspace-write") reason = "path within approved roots";
      } catch (e) {
        decision = "deny";
        reason = (e as Error).message;
      }
    }
    if (actionClass === "payment" && this.ctx.approvedSpend === 0) {
      decision = decision === "allow" ? "approval-required" : decision;
      reason = "payment with APPROVED_SPEND=0 requires explicit human approval";
    }

    const invocation = ToolInvocation.parse({
      id: newId("ti"),
      tool,
      actionClass,
      policyDecision: decision,
      timestamp: nowIso(),
      ...(detail.durationMs !== undefined ? { durationMs: Number(detail.durationMs) } : {}),
      ...(detail.exit !== undefined ? { exit: String(detail.exit) } : {}),
    });
    this.auditLog.push(invocation);
    if (decision === "deny") {
      throw new OmniforgeError("E_GATEWAY_DENIED", reason, { tool, actionClass });
    }
    return { decision, actionClass, reason, invocation };
  }

  /**
   * Records a human approval. Approvals are action- and scope-specific: an
   * apr_* id alone never grants blanket permission (mission D2).
   */
  recordApproval(approval: ApprovalRecord | string): void {
    if (typeof approval === "string") {
      // explicit legacy auto-approvals (auto:<tool>) remain self-scoped;
      // bare ids are recorded with action "unknown" and match nothing
      const auto = approval.startsWith("auto:");
      this.ctx.approvals.set(approval, { id: approval, action: auto ? approval.slice(5) : "unknown", decidedAt: nowIso() });
      return;
    }
    this.ctx.approvals.set(approval.id, { ...approval, decidedAt: approval.decidedAt ?? nowIso() });
  }

  private hasScopedApproval(tool: string, target?: string): boolean {
    for (const rec of this.ctx.approvals.values()) {
      if (rec.action !== tool) continue;
      if (rec.targets && rec.targets.length > 0) {
        if (!target) continue;
        // normalize BOTH sides before prefix comparison — a raw string like
        // "<root>/../elsewhere" must never satisfy a scoped approval
        const abs = resolve(target);
        const covered = rec.targets.some((t) => {
          const absT = resolve(t);
          return abs === absT || abs.startsWith(absT.endsWith(sep) ? absT : absT + sep);
        });
        if (!covered) continue;
      }
      return true;
    }
    return false;
  }

  /**
   * Governed execution decision for a command (mission D2): argv-only (no
   * shell strings), host allowlist enforcement, and a hard requirement for a
   * container runtime when the code is not a known-safe shape.
   */
  authorizeExec(cmd: string, args: string[], opts: { cwd: string; trusted?: boolean; tool?: string } = { cwd: process.cwd() }): Decision {
    if (typeof cmd !== "string" || args.some((a) => typeof a !== "string")) {
      throw new OmniforgeError("E_SANDBOX_UNAVAILABLE", "commands must be string argv (no shell strings)", {});
    }
    if (ARGV_UNSAFE.test(cmd) || args.some((a) => ARGV_UNSAFE.test(a))) {
      throw new OmniforgeError("E_GATEWAY_DENIED", "shell metacharacters in argv refused — use structured arguments", { cmd });
    }
    const sandbox = this.ctx.sandbox ?? (this.ctx.sandbox = resolveSandbox());
    const safe = HOST_ALLOWLIST.has(cmd);
    if (!safe && sandbox.mode !== "container") {
      throw new OmniforgeError(
        "E_SANDBOX_UNAVAILABLE",
        `executing '${cmd}' on the host requires a container sandbox (docker/podman); none is available — untrusted code will not run unsandboxed`,
        { sandbox: sandbox.detail }
      );
    }
    return this.authorize(opts.tool ?? (safe ? "run" : "exec"), { target: opts.cwd, command: redactSecrets([cmd, ...args].join(" ")) });
  }

  audit(): Invocation[] {
    return [...this.auditLog];
  }

  /** First approved writable root — a safe cwd for read-only probes. */
  cwd(): string | null {
    return this.ctx.writableRoots[0] ?? null;
  }
}

/** Convenience: is this action allowed at all without approval? */
export function isReadOnly(tool: string): boolean {
  return ToolGateway.prototype.classify(tool) === "read-inspect";
}
