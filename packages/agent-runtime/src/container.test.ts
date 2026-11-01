import { describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import * as gateway from "@omniforge/tool-gateway";
import { createContainerOpenCodeBackend } from "./index.js";

describe("concrete OpenCode container driver (injected runtime; not a live model smoke)", () => {
  it("passes the full task contract to an isolated no-network runtime and detects its actual file write", async () => {
    const root = mkdtempSync(join(tmpdir(), ".coding-task-driver-"));
    let authorizations = 0;
    const runner = vi.spyOn(gateway, "runIsolated").mockImplementation((spec) => {
      if (!spec.argv.includes("--version")) writeFileSync(join(spec.workdir, "original.txt"), "new task output");
      return { exitCode: 0, stdout: "injected runtime", stderr: "", durationMs: 1, timedOut: false, runtime: "injected", containerRef: "test-only" };
    });
    try {
      const backend = createContainerOpenCodeBackend(new gateway.ToolGateway(gateway.defaultContext([root])), { image: "local/preloaded-test", model: "local/approved-model", authorizeModelCall: () => { authorizations++; } });
      expect((await backend.health()).status).toBe("configured");
      const result = await backend.executeTask({ taskId: "unit", instruction: "write original output", cwd: root, fileScope: { writable: ["original.txt"] }, acceptanceCriteria: ["output exists"], expectedArtifacts: ["original.txt"] });
      expect(result.status).toBe("passed");
      expect(result.changedFiles).toEqual(["original.txt"]);
      expect(authorizations).toBe(1);
      const invocation = runner.mock.calls[1]![0];
      expect(invocation.allowNetwork).toBe(false);
      expect(invocation.argv.slice(0, 4)).toEqual(["opencode", "run", "--model", "local/approved-model"]);
      expect(JSON.parse(invocation.argv[4]!).fileScope.writable).toEqual(["original.txt"]);
    } finally { runner.mockRestore(); rmSync(root, { recursive: true, force: true }); }
  });
});
