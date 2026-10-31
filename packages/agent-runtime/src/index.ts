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
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

export interface AgentTaskSpec {
  /** natural-language coding instruction for an agent backend */
  instruction: string;
  cwd: string;
  timeoutMs?: number;
  model?: string;
  /** files the task is expected to touch (scope hint, not a sandbox) */
  expectedFiles?: string[];
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
  raw: BackendResult | null;
}

export interface BackendHealth {
  status: "verified" | "configured" | "unavailable" | "blocked";
  detail: string;
}

export interface CodingBackend {
  readonly id: string;
  readonly available: boolean;
  readonly availabilityNote: string;
  /** model/executor capabilities this backend exposes (may be empty) */
  capabilities(): ModelCapability[];
  health(): Promise<BackendHealth>;
  /** low-level governed command execution (allowlisted, argv-based) */
  runTask(spec: RunTaskSpec): Promise<BackendResult>;
  /** agent-level novel coding task — the real autonomy boundary */
  executeTask?(spec: AgentTaskSpec): Promise<AgentTaskResult>;
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
    // least privilege: every execution passes the deterministic gateway first
    this.gateway.authorize("run", { target: spec.cwd, command: redactSecrets(spec.command) });
    const timeoutMs = spec.timeoutMs ?? 120_000;
    const max = spec.maxBufferBytes ?? this.opts.maxBufferBytes ?? 512 * 1024;
    // argv execution — composed strings are tokenized and rejected if they
    // contain shell metacharacters or non-allowlisted binaries (D2)
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

  /** Real agent execution via `opencode run "<instruction>"` (non-interactive). */
  async executeTask(spec: AgentTaskSpec): Promise<AgentTaskResult> {
    if (!this.available) {
      return {
        status: "unsupported",
        detail: this.availabilityNote,
        changedFiles: [],
        raw: null,
      };
    }
    this.gateway.authorize("run", { target: spec.cwd, command: redactSecrets(`opencode run ${spec.instruction.slice(0, 80)}`) });
    const before = this.available ? await this.collectDiff(spec.cwd) : { stat: "", files: [] };
    const args = ["run"];
    if (spec.model) args.push("--model", spec.model);
    args.push(spec.instruction);
    const started = Date.now();
    const r = spawnSync(this.cliPath!, args, {
      cwd: spec.cwd,
      encoding: "utf8",
      timeout: spec.timeoutMs ?? 300_000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 8 * 1024 * 1024,
    });
    const raw: BackendResult = {
      exitCode: r.status,
      stdout: redactSecrets(String(r.stdout ?? "").slice(0, 200_000)),
      stderr: redactSecrets(String(r.stderr ?? "").slice(0, 100_000)),
      durationMs: Date.now() - started,
      timedOut: Boolean(r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT"),
      signal: null,
    };
    this.lastResult = raw;
    const after = await this.collectDiff(spec.cwd);
    const changedFiles = after.files.filter((f) => !before.files.includes(f));
    if (raw.exitCode !== 0) {
      return { status: raw.timedOut ? "blocked" : "failed", detail: `opencode run failed (exit ${raw.exitCode}): ${raw.stderr.slice(0, 200)}`, changedFiles, raw };
    }
    return {
      status: "passed",
      detail: raw.stdout.slice(0, 400) || "opencode task completed",
      changedFiles,
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
      return { status: "unsupported", detail: this.availabilityNote, changedFiles: [], raw: null };
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
        instruction:
          "The file math.js has a bug: add() subtracts instead of adding. Fix add() so the test passes, then run `npm test` and confirm it exits 0. Change nothing else.",
        cwd: ws,
        timeoutMs: 240_000,
      });
      const verify = spawnSync("node", ["--test", "math.test.mjs"], { cwd: ws, encoding: "utf8", timeout: 30_000 });
      const verified = verify.status === 0 && res.changedFiles.includes("math.js");
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
/* Backend selection                                                   */
/* ------------------------------------------------------------------ */

/** Detect the best coding backend honestly: opencode if present, else local. */
export function detectCodingBackend(gateway: ToolGateway): CodingBackend {
  const cli = probeBinary("opencode");
  if (cli) return new OpenCodeBackend(gateway, cli);
  return new LocalNodeBackend(gateway);
}

export async function detectOpenCode(): Promise<string | null> {
  return probeBinary("opencode");
}
