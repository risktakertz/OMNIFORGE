/**
 * OMNIFORGE observability: structured logging with secret redaction and a
 * durable run journal (JSONL) used for progress, status and resume.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { redactSecrets, newId, nowIso, atomicWriteFile } from "@omniforge/utils";
import { RunEvent, type RunEvent as RunEventT } from "@omniforge/shared-types";

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogSink {
  write(line: string): void;
}

export const consoleSink: LogSink = {
  write: (line) => process.stdout.write(line + "\n"),
};

export function createLogger(
  sink: LogSink = consoleSink,
  level: LogLevel = (process.env.OMNIFORGE_LOG_LEVEL as LogLevel) ?? "info"
) {
  const threshold = ORDER[level];
  function log(l: LogLevel, component: string, message: string, data?: Record<string, unknown>) {
    if (ORDER[l] < threshold) return;
    const record = {
      ts: nowIso(),
      level: l,
      component,
      message: redactSecrets(message),
      ...(data ? { data: JSON.parse(redactSecrets(JSON.stringify(data))) } : {}),
    };
    sink.write(JSON.stringify(record));
  }
  return {
    debug: (c: string, m: string, d?: Record<string, unknown>) => log("debug", c, m, d),
    info: (c: string, m: string, d?: Record<string, unknown>) => log("info", c, m, d),
    warn: (c: string, m: string, d?: Record<string, unknown>) => log("warn", c, m, d),
    error: (c: string, m: string, d?: Record<string, unknown>) => log("error", c, m, d),
  };
}

export type Logger = ReturnType<typeof createLogger>;

/**
 * RunJournal: append-only JSONL event log per run under
 * `<runsRoot>/<runId>/journal.jsonl`. Powers `status`, progress reporting and
 * durable resume (replayed by the orchestration layer to skip finished nodes).
 */
export class RunJournal {
  readonly runId: string;
  readonly dir: string;
  private readonly file: string;

  constructor(runsRoot: string, runId: string) {
    this.runId = runId;
    this.dir = join(runsRoot, runId);
    this.file = join(this.dir, "journal.jsonl");
    mkdirSync(this.dir, { recursive: true });
  }

  append(node: string, level: RunEventT["level"], message: string, data?: Record<string, unknown>): RunEventT {
    const event: RunEventT = {
      id: newId("evt"),
      runId: this.runId,
      threadId: this.runId,
      node,
      level,
      message: redactSecrets(message),
      data: data ?? {},
      timestamp: nowIso(),
    };
    appendFileSync(this.file, JSON.stringify(event) + "\n", "utf8");
    return event;
  }

  read(): RunEventT[] {
    if (!existsSync(this.file)) return [];
    const text = readFileSync(this.file, "utf8");
    return text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => RunEvent.parse(JSON.parse(l)));
  }

  completedNodes(): string[] {
    const done = new Set<string>();
    for (const e of this.read()) {
      if (e.level === "info" && e.message.startsWith("node:done:")) {
        done.add(e.message.slice("node:done:".length));
      }
    }
    return [...done];
  }

  saveState(state: unknown): void {
    const target = join(this.dir, "state.json");
    atomicWriteFile(target, redactSecrets(JSON.stringify(state, null, 2)));
  }

  loadState<T>(): T | null {
    const p = join(this.dir, "state.json");
    return existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as T) : null;
  }

  addEvidence(record: unknown): void {
    appendFileSync(join(this.dir, "evidence.jsonl"), JSON.stringify(record) + "\n", "utf8");
  }
}
