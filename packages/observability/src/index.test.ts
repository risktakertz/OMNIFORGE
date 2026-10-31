import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLogger, RunJournal } from "./index.js";

describe("observability", () => {
  it("redacts secrets in log output", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }, "debug");
    log.info("test", "deploy with token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12");
    expect(lines[0]).not.toContain("ghp_ABCD");
    expect(lines[0]).toContain("[REDACTED");
  });

  it("honors level thresholds", () => {
    const lines: string[] = [];
    const log = createLogger({ write: (l) => lines.push(l) }, "warn");
    log.debug("t", "hidden");
    log.error("t", "shown");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).level).toBe("error");
  });

  it("run journal records, replays and tracks completion", () => {
    const dir = mkdtempSync(join(tmpdir(), "of-journal-"));
    try {
      const j = new RunJournal(dir, "run_test");
      j.append("intake", "info", "node:done:intake");
      j.append("verify", "info", "node:done:verify");
      j.append("execute", "warn", "injected");
      expect(j.read()).toHaveLength(3);
      expect(j.completedNodes().sort()).toEqual(["intake", "verify"]);
      j.saveState({ runId: "run_test", status: "passed" });
      expect(j.loadState<{ status: string }>()?.status).toBe("passed");
      j.addEvidence({ taskId: "AC1", status: "passed" });
      expect(j.read()).toHaveLength(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
