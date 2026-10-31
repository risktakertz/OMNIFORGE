/**
 * OMNIFORGE agent runtime — typed coding-backend adapters.
 * The first verified backend is the local executor: the current host already
 * can run code, so spawning another agent inside it is avoided (per directive).
 * OpenCode/OpenHands adapters report honest availability and are wired only
 * when their CLIs actually exist.
 */
import { spawn } from "node:child_process";
import { OmniforgeError, type ModelCapability } from "@omniforge/shared-types";
import { redactSecrets } from "@omniforge/utils";
import { ToolGateway } from "@omniforge/tool-gateway";

export interface RunTaskSpec {
  command: string;
  cwd: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  maxBufferBytes?: number;
}

export interface BackendResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  signal: NodeJS.Signals | null;
}

export interface CodingBackend {
  readonly id: string;
  readonly available: boolean;
  readonly availabilityNote: string;
  capabilities(): ModelCapability[];
  health(): Promise<{ status: "verified" | "unavailable" | "blocked"; detail: string }>;
  runTask(spec: RunTaskSpec): Promise<BackendResult>;
  close(): Promise<void>;
}

export class LocalNodeBackend implements CodingBackend {
  readonly id = "local-node";
  readonly available = true;
  readonly availabilityNote = "executes on the current host via child processes";

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
        notes: "deterministic shell/file execution inside gateway-approved workspaces",
      },
    ];
  }

  async health(): Promise<{ status: "verified" | "unavailable" | "blocked"; detail: string }> {
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
    const started = Date.now();
    return await new Promise<BackendResult>((resolveP) => {
      const child = spawn("sh", ["-c", spec.command], {
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

  async close(): Promise<void> {
    /* nothing to release for local execution */
  }
}

/**
 * OpenCode adapter — reports truthfully. It becomes selectable only after the
 * `opencode` CLI is detected and a live smoke task succeeds (verified by
 * doctor/health, never assumed).
 */
export class OpenCodeBackend implements CodingBackend {
  readonly id = "opencode";
  available: boolean;
  availabilityNote: string;

  constructor(private readonly gateway: ToolGateway, cliPath: string | null) {
    this.available = cliPath !== null;
    this.availabilityNote = cliPath
      ? `opencode CLI detected at ${cliPath}; smoke task pending`
      : "opencode CLI not found on PATH — adapter disabled (honest unavailable, not simulated)";
  }

  capabilities(): ModelCapability[] {
    return this.available
      ? [
          {
            provider: "opencode",
            model: "opencode-agent",
            availability: "untested",
            structuredOutput: false,
            toolCalling: true,
            notes: "requires live smoke test before 'verified'",
          },
        ]
      : [];
  }

  async health() {
    return this.available
      ? ({ status: "blocked", detail: "CLI present; run omniforge doctor for a live smoke task" } as const)
      : ({ status: "unavailable", detail: this.availabilityNote } as const);
  }

  async runTask(_spec: RunTaskSpec): Promise<BackendResult> {
    throw new OmniforgeError("E_BACKEND_UNAVAILABLE", this.availabilityNote);
  }

  async close(): Promise<void> {}
}

export async function detectOpenCode(): Promise<string | null> {
  const { execFile } = await import("node:child_process");
  return new Promise((res) => {
    execFile("which", ["opencode"], (err, stdout) => {
      res(err ? null : (stdout.trim() || null));
    });
  });
}
