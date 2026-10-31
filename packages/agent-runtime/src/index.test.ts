import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalNodeBackend, OpenCodeBackend } from "./index.js";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";

describe("agent runtime", () => {
  it("local backend executes commands inside approved cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-rt-"));
    try {
      const gw = new ToolGateway(defaultContext([root]));
      const be = new LocalNodeBackend(gw);
      const r = await be.runTask({ command: "echo hello-omniforge", cwd: root });
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("hello-omniforge");
      expect((await be.health()).status).toBe("verified");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("local backend refuses execution outside approved roots", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-rt2-"));
    const other = mkdtempSync(join(tmpdir(), "of-rt3-"));
    try {
      const gw = new ToolGateway(defaultContext([root]));
      const be = new LocalNodeBackend(gw);
      await expect(be.runTask({ command: "echo pwned", cwd: other })).rejects.toThrow(/E_GATEWAY/);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(other, { recursive: true, force: true });
    }
  });

  it("local backend enforces timeouts", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-rt4-"));
    try {
      const gw = new ToolGateway(defaultContext([root]));
      const be = new LocalNodeBackend(gw);
      const r = await be.runTask({ command: "sleep 5", cwd: root, timeoutMs: 300 });
      expect(r.timedOut).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("local backend redacts secrets in captured output", async () => {
    const root = mkdtempSync(join(tmpdir(), "of-rt5-"));
    try {
      writeFileSync(join(root, "leak.sh"), "#!/bin/sh\necho 'token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ12'\n", "utf8");
      const gw = new ToolGateway(defaultContext([root]));
      const be = new LocalNodeBackend(gw);
      const r = await be.runTask({ command: "sh leak.sh", cwd: root });
      expect(r.stdout).not.toContain("ghp_ABCD");
      expect(r.stdout).toContain("[REDACTED");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("opencode backend reports honest unavailability", async () => {
    const gw = new ToolGateway(defaultContext([process.cwd()]));
    const be = new OpenCodeBackend(gw, null);
    expect(be.available).toBe(false);
    expect(be.availabilityNote).toMatch(/not found|disabled/);
    await expect(be.runTask({ command: "x", cwd: process.cwd() })).rejects.toThrow(/E_BACKEND_UNAVAILABLE/);
    expect(be.capabilities()).toHaveLength(0);
  });
});
