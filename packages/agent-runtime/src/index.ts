/**
 * OMNIFORGE agent runtime — typed coding-backend adapters (mission C1).
 *
 * Contract v2:
 *  - `CodingBackend` exposes probe/health/prepare/executeTask/collectDiff/
 *    collectEvidence/close. Backends that cannot support a capability return
 *    a typed `unsupported` result — they never fake it.
 *  - `LocalNodeBackend` is the deterministic fallback: it executes allowlisted
 *    commands with argument arrays (no shell interpolation of untrusted
 *    strings) inside gateway-approved workspaces. It is NOT an AI coding
 *    agent and refuses agent-style novel coding tasks honestly.
 *  - `OpenCodeBackend` invokes the real `opencode run` CLI (non-interactive
 *    mode) with structured arguments, cwd scoping, timeouts and redaction.
 *    It stays `unavailable` until the binary is detected AND a live smoke
 *    task succeeds — doctor/health evidence, never assumptions.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OmniforgeError, type ModelCapability } from "@omniforge/shared-types";
import { redactSecrets } from "@omniforge/utils";
import { ToolGateway } from "@omniforge/tool-gateway";

/* ------------------------------------------------------------------ */
/* Shared types                                                        */
/* ------------------------------------------------------------------ */

export interface RunTaskSpec {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxBufferBytes?: number;
}

/** Bounded file scope for an agent task (paths are workspace-relative globs). */
export interface FileScope {
  /** files the task may create or modify (workspace-relative) */
  writable: string[];
  /** files that must never change (regression guard) */
  forbidden?: string[];
}

/**
 * AgentTaskSpec v3 (§3.1): everything a coding backend needs for an auditable,
 * bounded, verifiable task — never just a bare instruction.
 */
export interface AgentTaskSpec {
  /** natural-language coding instruction — passed to the backend verbatim */
  instruction: string;
  cwd: string;
  /** unique task id for evidence, idempotency and ledger correlation */
  taskId: string;
  /** structured project context (manifest summary, stack, relevant docs) */
  projectContext?: string;
  /** bounded writable/forbidden file scope — validated against the diff */
  fileScope?: FileScope;
  /** original acceptance criteria the patch must satisfy */
  acceptanceCriteria?: string[];
  /** tools the backend may use (e.g. "npm", "git") — never implied */
  allowedTools?: string[];
  /** artifacts the task is expected to produce */
  expectedArtifacts?: string[];
  /** model preference (backend honors when it can, reports otherwise) */
  model?: string;
  timeoutMs?: number;
  /** hard wall-clock budget for the whole task incl. retries */
  budgetMs?: number;
  /** risk label drives gateway policy (high-risk tasks need approvals) */
  risk?: "low" | "medium" | "high";
}

export interface BackendResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export interface AgentTaskResult {
  status: "passed" | "failed" | "unsupported" | "blocked";
  detail: string;
  changedFiles: string[];
  /** files changed OUTSIDE the declared writable scope — hard contract violation */
  scopeViolations: string[];
  raw: BackendResult | null;
}

export interface BackendHealth {
  status: "verified" | "configured" | "unavailable" | "blocked";
  detail: string;
}

/**
 * Capability flags (§3.1): backends declare what they ACTUALLY support.
 * Callers must consult these instead of assuming a uniform interface.
 */
export interface BackendFeatureFlags {
  prepare: boolean;
  streamEvents: boolean;
  cancel: boolean;
  collectDiff: boolean;
  collectEvidence: boolean;
  modelBacked: boolean;
}

export interface CodingBackend {
  readonly id: string;
  readonly available: boolean;
  readonly availabilityNote: string;
  /** model/executor capabilities this backend exposes (may be empty) */
  capabilities(): ModelCapability[];
  /** §3.1 feature flags — the truthful interface contract */
  features(): BackendFeatureFlags;
  health(): Promise<BackendHealth>;
  /** low-level governed command execution (allowlisted, argv-based) */
  runTask(spec: RunTaskSpec): Promise<BackendResult>;
  /** §3.1: idempotent pre-flight (workspace manifest, env sanity) — optional */
  prepare?(spec: AgentTaskSpec): Promise<{ manifest: Record<string, string>; ok: boolean; note: string }>;
  /** agent-level novel coding task — the real autonomy boundary */
  executeTask?(spec: AgentTaskSpec): Promise<AgentTaskResult>;
  /** §3.1: event stream where supported — backends that cannot stream say so */
  streamEvents?(spec: AgentTaskSpec): AsyncGenerator<{ type: string; data: string }>;
  /** §3.1: cooperative cancellation where supported */
  cancel?(taskId: string): Promise<boolean>;
  /** git diff summary of the workspace (args-array git, redacted) */
  collectDiff?(workspacePath: string): Promise<{ stat: string; files: string[] }>;
  /** evidence records for the last executed task */
  collectEvidence?(workspacePath: string): Promise<Array<{ command: string; exit: string; at: string; summary: string }>>;
  close(): Promise<void>;
}

/* ------------------------------------------------------------------ */
/* Cross-platform binary detection                                     */
/* ------------------------------------------------------------------ */

/** Locate a binary on PATH across Windows/Linux/macOS using argv exec. */
export function probeBinary(name: string): string | null {
  const isWindows = process.platform === "win32";
  const r = spawnSync(isWindows ? "where" : "which", [name], {
    encoding: "utf8",
    timeout: 5_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
  return first && existsSync(first) ? first : first || null;
}

/* ------------------------------------------------------------------ */
/* Baseline-manifest change detection (§3.3)                            */
/* ------------------------------------------------------------------ */

import { createHash } from "node:crypto";

const MANIFEST_SKIP = new Set(["node_modules", ".git", "dist-export"]);

/** Hash every file under a workspace (recursive, bounded depth). No .git required. */
export function snapshotManifest(root: string, maxFiles = 5_000): Record<string, string> {
  const manifest: Record<string, string> = {};
  const walk = (dir: string, base: string, depth: number): void => {
    if (depth > 8 || Object.keys(manifest).length >= maxFiles) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (MANIFEST_SKIP.has(e)) continue;
      const full = join(dir, e);
      const rel = base ? `${base}/${e}` : e;
      let st;
      try {
        st = statSync(full, { throwIfNoEntry: false });
      } catch {
        continue;
      }
      if (!st) continue;
      if (st.isDirectory()) walk(full, rel, depth + 1);
      else if (st.isFile()) {
        try {
          manifest[rel] = createHash("sha256").update(readFileSync(full)).digest("hex");
        } catch {
          manifest[rel] = "unreadable";
        }
      }
    }
  };
  walk(root, "", 0);
  return manifest;
}

/** Diff two manifests: changed + added + removed, all counted (§3.3: untracked counts). */
export function diffManifests(
  before: Record<string, string>,
  after: Record<string, string>
): { changed: string[]; added: string[]; removed: string[] } {
  const changed: string[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  for (const [f, h] of Object.entries(after)) {
    if (!(f in before)) added.push(f);
    else if (before[f] !== h) changed.push(f);
  }
  for (const f of Object.keys(before)) if (!(f in after)) removed.push(f);
  return { changed, added, removed };
}

/** Validate a diff against the declared bounded file scope (§3.1/§3.6). */
export function scopeViolationsOf(
  diff: { changed: string[]; added: string[]; removed: string[] },
  scope: FileScope | undefined
): string[] {
  if (!scope) return [];
  const touched = [...diff.changed, ...diff.added, ...diff.removed];
  const violations: string[] = [];
  for (const f of touched) {
    const inScope = scope.writable.some((w) => f === w || f.startsWith(w.endsWith("/") ? w : `${w}/`));
    if (!inScope) violations.push(f);
  }
  for (const f of scope.forbidden ?? []) {
    // prefix-aware: touching anything UNDER a forbidden path is a violation
    if (touched.some((t) => t === f || t.startsWith(f.endsWith("/") ? f : `${f}/`))) {
      violations.push(`${f} (forbidden path touched)`);
    }
  }
  return violations;
}

/* ------------------------------------------------------------------ */
/* Local deterministic backend                                         */
/* ------------------------------------------------------------------ */

/** Commands the deterministic local backend may execute without a shell. */
const ALLOWED_BINARIES = new Set([
  "node", "npm", "npx", "pnpm", "git", "tar", "ls", "cat", "pwd", "echo",
  "sleep", "head", "tail", "wc", "sh", "bash", "cmd",
]);

/** Shell metacharacters that make a composed command unsafe for argv splitting. */
const SHELL_META = /[|&;<>()$`\\'"*?[\]{}~\n\r]/;

function tokenizeCommand(command: string): string[] | null {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (!ALLOWED_BINARIES.has(parts[0]!)) return null;
  for (const p of parts) if (SHELL_META.test(p)) return null;
  return parts;
}

export class LocalNodeBackend implements CodingBackend {
  readonly id = "local-node";
  readonly available = true;
  readonly availabilityNote = "deterministic executor on the current host (argv-based, gateway-gated); NOT an AI coding agent";

  constructor(
    private readonly gateway: ToolGateway,
    private readonly opts: { maxBufferBytes?: number } = {}
  ) {}

  capabilities(): ModelCapability[] {
    return [
      {
        provider: "omniforge",
        model: "local-node-executor",
        availability: "verified",
        structuredOutput: true,
        toolCalling: false,
        notes: "deterministic shell/file execution inside gateway-approved workspaces; cannot author novel code",
      },
    ];
  }

  features(): BackendFeatureFlags {
    return {
      prepare: true,
      streamEvents: false,
      cancel: false,
      collectDiff: true,
      collectEvidence: false,
      modelBacked: false,
    };
  }

  /** §3.1 pre-flight: capture the workspace baseline manifest. */
  async prepare(spec: AgentTaskSpec): Promise<{ manifest: Record<string, string>; ok: boolean; note: string }> {
    return {
      manifest: snapshotManifest(spec.cwd),
      ok: true,
      note: "baseline manifest captured (no git repo required)",
    };
  }

  async health(): Promise<BackendHealth> {
    try {
      const probe = await this.runTask({ command: "node --version", cwd: this.gateway.cwd() ?? process.cwd(), timeoutMs: 10_000 });
      return probe.exitCode === 0
        ? { status: "verified", detail: `node ${probe.stdout.trim()}` }
        : { status: "blocked", detail: `probe failed: ${probe.stderr.slice(0, 200)}` };
    } catch (e) {
      return { status: "unavailable", detail: `probe denied or failed: ${(e as Error).message.slice(0, 160)}` };
    }
  }

  async runTask(spec: RunTaskSpec): Promise<BackendResult> {
    // least privilege: argv-tokenize first, then the gateway enforces the
    // sandbox policy (D2) — non-allowlisted binaries need a container runtime
    const argv = tokenizeCommand(spec.command);
    if (!argv) {
      return {
        exitCode: -1,
        stdout: "",
        stderr: redactSecrets(`command rejected by policy (allowlist/argv): ${spec.command.slice(0, 120)}`),
        durationMs: 0,
        timedOut: false,
        signal: null,
      };
    }
    // policy denial fails LOUD (typed error) — escapes/injection/sandbox gaps
    // must never be surfaced as a mere non-zero exit
    this.gateway.authorizeExec(argv[0]!, argv.slice(1), { cwd: spec.cwd, tool: "run" });
    const timeoutMs = spec.timeoutMs ?? 120_000;
    const max = spec.maxBufferBytes ?? this.opts.maxBufferBytes ?? 512 * 1024;
    const started = Date.now();
    return await new Promise<BackendResult>((resolveP) => {
      const child = spawn(argv[0]!, argv.slice(1), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => {
        if (stdout.length < max) stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (stderr.length < max) stderr += d.toString();
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        resolveP({
          exitCode: code,
          stdout: redactSecrets(stdout.slice(0, max)),
          stderr: redactSecrets(stderr.slice(0, max)),
          durationMs: Date.now() - started,
          timedOut,
          signal: signal ?? null,
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolveP({
          exitCode: -1,
          stdout: "",
          stderr: redactSecrets(err.message),
          durationMs: Date.now() - started,
          timedOut: false,
          signal: null,
        });
      });
    });
  }

  /** The deterministic backend is not an AI agent: novel coding is refused. */
  async executeTask(spec: AgentTaskSpec): Promise<AgentTaskResult> {
    void spec;
    return {
      status: "unsupported",
      detail:
        "local-node is a deterministic executor, not a coding agent — novel code generation requires a model-backed backend (e.g. opencode). Configure one to enable autonomous generation.",
      changedFiles: [],
      scopeViolations: [],
      raw: null,
    };
  }

  async collectDiff(workspacePath: string): Promise<{ stat: string; files: string[] }> {
    if (!existsSync(join(workspacePath, ".git"))) return { stat: "", files: [] };
    const stat = await this.runTask({ command: "git diff --stat", cwd: workspacePath, timeoutMs: 15_000 });
    const status = await this.runTask({ command: "git status --porcelain", cwd: workspacePath, timeoutMs: 15_000 });
    const files = status.stdout.split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    return { stat: stat.stdout.slice(0, 4_000), files };
  }

  async collectEvidence(): Promise<Array<{ command: string; exit: string; at: string; summary: string }>> {
    return []; // local backend keeps no per-task evidence beyond gateway audit
  }

  async close(): Promise<void> {
    /* nothing to release for local execution */
  }
}

/* ------------------------------------------------------------------ */
/* OpenCode adapter — real CLI invocation, honest availability          */
/* ------------------------------------------------------------------ */

export class OpenCodeBackend implements CodingBackend {
  readonly id = "opencode";
  available: boolean;
  availabilityNote: string;
  /** set to true after a live smoke task succeeds (never assumed) */
  private smokeVerified = false;
  private lastResult: BackendResult | null = null;
  /** running child processes by taskId — cooperative cancellation (§3.1) */
  private readonly running = new Map<string, ReturnType<typeof spawn>>();

  constructor(
    private readonly gateway: ToolGateway,
    private readonly cliPath: string | null,
    private readonly opts: { model?: string; maxBufferBytes?: number } = {}
  ) {
    this.available = cliPath !== null;
    this.availabilityNote = cliPath
      ? `opencode CLI detected at ${cliPath}; live smoke task pending before 'verified'`
      : "opencode CLI not found on PATH — adapter disabled (honest unavailable, not simulated)";
  }

  capabilities(): ModelCapability[] {
    if (!this.available) return [];
    return [
      {
        provider: "opencode",
        model: this.opts.model ?? "opencode-agent",
        availability: this.smokeVerified ? "verified" : "configured",
        structuredOutput: false,
        toolCalling: true,
        notes: this.smokeVerified
          ? "live smoke task passed on this host"
          : "CLI present but not yet smoke-tested on this host; doctor runs the live probe",
      },
    ];
  }

  features(): BackendFeatureFlags {
    return {
      prepare: true,
      streamEvents: false, // opencode run is non-interactive; no stable event stream contract
      cancel: true,
      collectDiff: true,
      collectEvidence: true,
      modelBacked: true,
    };
  }

  /** §3.1 pre-flight: baseline manifest WITHOUT requiring a git repo. */
  async prepare(spec: AgentTaskSpec): Promise<{ manifest: Record<string, string>; ok: boolean; note: string }> {
    if (!this.available) return { manifest: {}, ok: false, note: this.availabilityNote };
    return {
      manifest: snapshotManifest(spec.cwd),
      ok: true,
      note: `baseline manifest captured (${Object.keys(snapshotManifest(spec.cwd)).length} files; git not required)`,
    };
  }

  /** §3.1 cooperative cancellation of a running task. */
  async cancel(taskId: string): Promise<boolean> {
    const child = this.running.get(taskId);
    if (!child) return false;
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 3_000);
    return true;
  }

  async health(): Promise<BackendHealth> {
    if (!this.available) return { status: "unavailable", detail: this.availabilityNote };
    if (this.smokeVerified) return { status: "verified", detail: `opencode smoke task passed (${this.cliPath})` };
    // CLI present: run the harmless version probe now; full smoke on demand
    const probe = spawnSync(this.cliPath!, ["--version"], { encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"] });
    if (probe.status !== 0) {
      return { status: "blocked", detail: `opencode --version failed: ${String(probe.stderr ?? "").slice(0, 160)}` };
    }
    return { status: "configured", detail: `opencode ${String(probe.stdout ?? "").trim() || "?"} — run the smoke task to verify agent execution` };
  }

  async runTask(spec: RunTaskSpec): Promise<BackendResult> {
    if (!this.available) {
      throw new OmniforgeError("E_BACKEND_UNAVAILABLE", this.availabilityNote);
    }
    this.gateway.authorize("run", { target: spec.cwd, command: redactSecrets(spec.command) });
    const timeoutMs = spec.timeoutMs ?? 120_000;
    const max = spec.maxBufferBytes ?? this.opts.maxBufferBytes ?? 512 * 1024;
    const started = Date.now();
    return await new Promise<BackendResult>((resolveP) => {
      const child = spawn(this.cliPath!, spec.command.split(/\s+/), {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => {
        if (stdout.length < max) stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (stderr.length < max) stderr += d.toString();
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.lastResult = {
          exitCode: code,
          stdout: redactSecrets(stdout.slice(0, max)),
          stderr: redactSecrets(stderr.slice(0, max)),
          durationMs: Date.now() - started,
          timedOut,
          signal: signal ?? null,
        };
        resolveP(this.lastResult);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolveP({
          exitCode: -1,
          stdout: "",
          stderr: redactSecrets(err.message),
          durationMs: Date.now() - started,
          timedOut: false,
          signal: null,
        });
      });
    });
  }

  /**
   * Real agent execution via `opencode run "<instruction>"` (non-interactive):
   *  - the FULL instruction text travels as ONE structured argv element (§3.2:
   *    never whitespace-split, never routed through a shell);
   *  - async spawn with cooperative cancel + wall-clock timeout;
   *  - change detection by baseline manifest hash — a git repo is NOT
   *    required and untracked/new files always count (§3.3);
   *  - the declared bounded file scope is enforced against the observed diff
   *    (§3.6: agent output is untrusted until verified).
   */
  async executeTask(spec: AgentTaskSpec): Promise<AgentTaskResult> {
    if (!this.available) {
      return {
        status: "unsupported",
        detail: this.availabilityNote,
        changedFiles: [],
        scopeViolations: [],
        raw: null,
      };
    }
    this.gateway.authorize("run", { target: spec.cwd, command: redactSecrets(`opencode run ${spec.instruction.slice(0, 80)}`) });
    const before = snapshotManifest(spec.cwd);
    const args = ["run"];
    if (spec.model) args.push("--model", spec.model);
    args.push(spec.instruction);
    const started = Date.now();
    const timeoutMs = spec.timeoutMs ?? 300_000;
    const raw = await new Promise<BackendResult>((resolveP) => {
      const child = spawn(this.cliPath!, args, {
        cwd: spec.cwd,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      this.running.set(spec.taskId, child);
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout?.on("data", (d: Buffer) => {
        if (stdout.length < 400_000) stdout += d.toString();
      });
      child.stderr?.on("data", (d: Buffer) => {
        if (stderr.length < 200_000) stderr += d.toString();
      });
      child.on("close", (code, signal) => {
        clearTimeout(timer);
        this.running.delete(spec.taskId);
        resolveP({
          exitCode: code,
          stdout: redactSecrets(stdout.slice(0, 400_000)),
          stderr: redactSecrets(stderr.slice(0, 200_000)),
          durationMs: Date.now() - started,
          timedOut,
          signal: signal ?? null,
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        this.running.delete(spec.taskId);
        resolveP({
          exitCode: -1,
          stdout: "",
          stderr: redactSecrets(err.message),
          durationMs: Date.now() - started,
          timedOut: false,
          signal: null,
        });
      });
    });
    this.lastResult = raw;
    const after = snapshotManifest(spec.cwd);
    const diff = diffManifests(before, after);
    const changedFiles = [...diff.changed, ...diff.added, ...diff.removed];
    const violations = scopeViolationsOf(diff, spec.fileScope);
    if (raw.exitCode !== 0) {
      return {
        status: raw.timedOut ? "blocked" : "failed",
        detail: `opencode run failed (exit ${raw.exitCode}): ${raw.stderr.slice(0, 200)}`,
        changedFiles,
        scopeViolations: violations,
        raw,
      };
    }
    if (violations.length > 0) {
      // §3.6: treat agent output as untrusted — scope violations fail the task
      return {
        status: "failed",
        detail: `scope contract violated: changed files outside declared writable scope: ${violations.slice(0, 8).join(", ")}`,
        changedFiles,
        scopeViolations: violations,
        raw,
      };
    }
    return {
      status: "passed",
      detail: raw.stdout.slice(0, 400) || "opencode task completed",
      changedFiles,
      scopeViolations: [],
      raw,
    };
  }

  async collectDiff(workspacePath: string): Promise<{ stat: string; files: string[] }> {
    if (!existsSync(join(workspacePath, ".git"))) return { stat: "", files: [] };
    const stat = spawnSync("git", ["-C", workspacePath, "diff", "--stat"], { encoding: "utf8", timeout: 15_000 });
    const status = spawnSync("git", ["-C", workspacePath, "status", "--porcelain"], { encoding: "utf8", timeout: 15_000 });
    const files = String(status.stdout ?? "").split("\n").map((l) => l.slice(3).trim()).filter(Boolean);
    return { stat: redactSecrets(String(stat.stdout ?? "")).slice(0, 4_000), files };
  }

  async collectEvidence(): Promise<Array<{ command: string; exit: string; at: string; summary: string }>> {
    if (!this.lastResult) return [];
    return [
      {
        command: "opencode run",
        exit: String(this.lastResult.exitCode),
        at: new Date().toISOString(),
        summary: this.lastResult.stdout.slice(0, 200) || this.lastResult.stderr.slice(0, 200),
      },
    ];
  }

  /**
   * Live smoke test (C1 gate): a deliberately novel small coding task —
   * create a module with a seeded bug, fix it, run its test. Verifies actual
   * file changes and a passing test. Requires the CLI + an authorized model
   * configured inside opencode itself.
   */
  async smoke(workspacePath?: string): Promise<AgentTaskResult> {
    if (!this.available) {
      return { status: "unsupported", detail: this.availabilityNote, changedFiles: [], scopeViolations: [], raw: null };
    }
    const ws = workspacePath ?? mkdtempSync(join(tmpdir(), "of-opencode-smoke-"));
    const owned = !workspacePath;
    try {
      writeFileSync(join(ws, "math.js"), "export function add(a, b) { return a - b; }\n", "utf8");
      writeFileSync(
        join(ws, "math.test.mjs"),
        "import test from 'node:test';\nimport assert from 'node:assert';\nimport { add } from './math.js';\ntest('add adds', () => { assert.equal(add(2, 3), 5); });\n",
        "utf8"
      );
      writeFileSync(join(ws, "package.json"), JSON.stringify({ name: "smoke", type: "module", scripts: { test: "node --test math.test.mjs" } }, null, 2), "utf8");
      const res = await this.executeTask({
        taskId: "smoke-seeded-bug",
        instruction:
          "The file math.js has a bug: add() subtracts instead of adding. Fix add() so the test passes, then run `npm test` and confirm it exits 0. Change nothing else.",
        cwd: ws,
        timeoutMs: 240_000,
        fileScope: { writable: ["math.js"], forbidden: ["math.test.mjs", "package.json"] },
        acceptanceCriteria: ["node --test math.test.mjs exits 0", "add(2,3) === 5"],
        allowedTools: ["npm"],
        expectedArtifacts: ["math.js"],
        risk: "low",
      });
      const verify = spawnSync("node", ["--test", "math.test.mjs"], { cwd: ws, encoding: "utf8", timeout: 30_000 });
      const verified = verify.status === 0 && res.changedFiles.includes("math.js") && res.scopeViolations.length === 0;
      // a real observed smoke pass is the ONLY path to 'verified' (never assumed)
      if (verified) this.smokeVerified = true;
      return {
        ...res,
        status: verified ? "passed" : "failed",
        detail: verified
          ? "smoke passed: real file edit + passing test observed"
          : `smoke failed: changedFiles=${res.changedFiles.join(",") || "none"}, test exit=${verify.status}`,
      };
    } finally {
      if (owned) rmSync(ws, { recursive: true, force: true });
    }
  }

  async close(): Promise<void> {}
}

/* ------------------------------------------------------------------ */
/* Capability-aware execution routing (§3.5)                            */
/* ------------------------------------------------------------------ */

/** What the caller needs from the implementation layer for this requirement. */
export interface RequirementProfile {
  /** a deterministic template fully covers this requirement? */
  templateSufficient: boolean;
  /** templateId when templateSufficient (for reuse, never re-routing) */
  templateId?: string;
  /** does the requirement need novel source code a template cannot produce? */
  requiresNovelCode: boolean;
  /** human-readable reason recorded in evidence */
  reason: string;
}

export type ExecutionRouteDecision =
  | { route: "template"; templateId: string; backend: CodingBackend | null; reason: string }
  | { route: "backend"; backend: CodingBackend; reason: string }
  | { route: "needs-model"; code: "E_NEEDS_MODEL"; reason: string; prerequisite: string }
  | { route: "backend-blocked"; code: "E_BACKEND_BLOCKED"; reason: string; prerequisite: string };

/**
 * §3.5 capability-aware selection, as a pure typed decision:
 *  - a deterministic template that fully meets the requirement is REUSED;
 *  - requirements beyond it are handed to an available model-backed backend;
 *  - no backend/model available ⇒ typed NEEDS_MODEL / BACKEND_BLOCKED with
 *    setup instructions — never a generic website or an invented success.
 */
export function selectExecutionRoute(
  profile: RequirementProfile,
  backend: CodingBackend | null
): ExecutionRouteDecision {
  if (profile.templateSufficient && profile.templateId) {
    return { route: "template", templateId: profile.templateId, backend: null, reason: profile.reason };
  }
  if (!profile.requiresNovelCode) {
    // nothing novel needed but no template either — deterministic planning only
    return {
      route: "needs-model",
      code: "E_NEEDS_MODEL",
      reason: `requirement matches no deterministic capability: ${profile.reason}`,
      prerequisite: "configure an authorized model-backed coding backend (docs/MODEL_ROUTING.md) or use a supported template",
    };
  }
  if (!backend) {
    return {
      route: "needs-model",
      code: "E_NEEDS_MODEL",
      reason: `novel implementation required (${profile.reason}) but no coding backend is configured`,
      prerequisite: "install a supported coding backend (e.g. opencode) and authorize a model",
    };
  }
  const flags = backend.features();
  if (!flags.modelBacked || !backend.available) {
    return {
      route: "backend-blocked",
      code: "E_BACKEND_BLOCKED",
      reason: `backend '${backend.id}' cannot execute novel coding tasks: ${backend.availabilityNote}`,
      prerequisite: backend.available ? "authorize a model for this backend" : "install the backend binary and authorize a model",
    };
  }
  return { route: "backend", backend, reason: profile.reason };
}

/** Detect the best coding backend honestly: opencode if present, else local. */
export function detectCodingBackend(gateway: ToolGateway): CodingBackend {
  const cli = probeBinary("opencode");
  if (cli) return new OpenCodeBackend(gateway, cli);
  return new LocalNodeBackend(gateway);
}

export async function detectOpenCode(): Promise<string | null> {
  return probeBinary("opencode");
}
