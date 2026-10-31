import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ToolGateway, defaultContext, isReadOnly, resolveSandbox } from "./index.js";
import { OmniforgeError } from "@omniforge/shared-types";

describe("tool gateway (deterministic policy)", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "of-gw-"));
    mkdirSync(join(root, "workspace"), { recursive: true });
  });

  it("allows reads and workspace writes inside approved roots", () => {
    const gw = new ToolGateway(defaultContext([join(root, "workspace")]));
    expect(gw.authorize("inspect").decision).toBe("allow");
    expect(gw.authorize("scaffold", { target: join(root, "workspace", "new-project") }).decision).toBe("allow");
  });

  it("blocks path escapes with typed errors", () => {
    const gw = new ToolGateway(defaultContext([join(root, "workspace")]));
    expect(() => gw.authorize("write", { target: join(root, "outside") })).toThrow(/E_GATEWAY_PATH_ESCAPE/);
    expect(() => gw.checkPath("/etc/passwd")).toThrow(/E_GATEWAY_PATH_ESCAPE/);
  });

  it("blocks symlink escapes", () => {
    const outside = join(root, "outside");
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, join(root, "workspace", "evil"));
    const gw = new ToolGateway(defaultContext([join(root, "workspace")]));
    expect(() => gw.authorize("write", { target: join(root, "workspace", "evil", "file.txt") })).toThrow();
  });

  it("requires approval for payment with APPROVED_SPEND=0", () => {
    const gw = new ToolGateway(defaultContext([root]));
    const d = gw.authorize("charge", { spend: 10 });
    expect(d.decision).toBe("approval-required");
  });

  it("approvals are action- and scope-specific (no blanket apr_* tokens)", () => {
    const gw = new ToolGateway(defaultContext([root]));
    expect(gw.authorize("deploy").decision).toBe("approval-required");
    // a bare apr_* id matches nothing — blanket permission is dead
    gw.recordApproval("apr_123");
    expect(gw.authorize("deploy").decision).toBe("approval-required");
    // correct action unlocks it
    gw.recordApproval({ id: "apr_ok", action: "deploy" });
    expect(gw.authorize("deploy").decision).toBe("allow");
    // but the same approval never unlocks a DIFFERENT gated action
    const gw2 = new ToolGateway(defaultContext([root]));
    gw2.recordApproval({ id: "apr_x", action: "deploy" });
    expect(gw2.authorize("payment", { spend: 5 }).decision).toBe("approval-required");
  });

  it("approvals with targets do not authorize other targets", () => {
    const alpha = join(root, "workspace-client-a");
    const beta = join(root, "workspace-client-b");
    mkdirSync(alpha, { recursive: true });
    mkdirSync(beta, { recursive: true });
    const gw = new ToolGateway(defaultContext([alpha, beta]));
    gw.recordApproval({ id: "apr_a", action: "rm-rf", targets: [join(alpha, "stale")] });
    expect(gw.authorize("rm-rf", { target: join(alpha, "stale") }).decision).toBe("allow");
    expect(gw.authorize("rm-rf", { target: join(beta, "stale") }).decision).toBe("approval-required");
  });

  it("authorizeExec refuses shell strings, metacharacters and untrusted binaries without a sandbox", () => {
    // inject the policy explicitly so the test is deterministic on hosts WITH
    // and WITHOUT docker (CI runners have a container runtime)
    const ctx = { ...defaultContext([root]), sandbox: { mode: "host-allowlist" as const, runtime: null, detail: "test policy" } };
    const gw = new ToolGateway(ctx);
    // argv + allowlisted binary: allowed on the host
    expect(() => gw.authorizeExec("node", ["scripts/render.mjs"], { cwd: root })).not.toThrow();
    // curl is NOT on the host allowlist and the policy has no container
    try {
      gw.authorizeExec("curl", ["https://example.invalid"], { cwd: root });
      throw new Error("expected refusal");
    } catch (e) {
      expect(String((e as Error).message)).toMatch(/E_SANDBOX_UNAVAILABLE|sandbox/i);
    }
    // shell metacharacters in argv are refused outright
    expect(() => gw.authorizeExec("node", ["-e", "process.exit(0)"], { cwd: root })).toThrow(/E_GATEWAY_DENIED|metachar/i);
  });

  it("authorizeExec permits non-allowlisted binaries only in container mode", () => {
    const ctx = { ...defaultContext([root]), sandbox: { mode: "container" as const, runtime: "docker", detail: "test policy" } };
    const gw = new ToolGateway(ctx);
    expect(() => gw.authorizeExec("curl", ["https://example.invalid"], { cwd: root })).not.toThrow();
  });

  it("resolveSandbox reports the honest mode for this host", () => {
    const real = resolveSandbox();
    expect(["container", "host-allowlist"]).toContain(real.mode);
    // injected probe: docker healthy -> container mode
    const injected = resolveSandbox(() => ({ status: 0 }));
    expect(injected.mode).toBe("container");
    expect(injected.runtime).toBe("docker");
    const none = resolveSandbox(() => ({ status: 1 }));
    expect(none.mode).toBe("host-allowlist");
    expect(none.runtime).toBeNull();
  });

  it("hard-denies destructive fs outside artifacts", () => {
    const gw = new ToolGateway(defaultContext([join(root, "workspace")]));
    expect(() => gw.authorize("rm-rf", { target: resolve(root, "..") })).toThrow(/E_GATEWAY/);
    // inside the workspace it is not denied, but still approval-gated
    const d = new ToolGateway(defaultContext([join(root, "workspace")])).authorize("rm-rf", {
      target: join(root, "workspace", "stale-artifacts"),
    });
    expect(d.decision).toBe("approval-required");
  });

  it("audits every decision", () => {
    const gw = new ToolGateway(defaultContext([root]));
    gw.authorize("inspect");
    try {
      gw.authorize("write", { target: "/outside" });
    } catch {
      /* denied decisions are audited too */
    }
    const audit = gw.audit();
    expect(audit).toHaveLength(2);
    expect(audit[1].policyDecision).toBe("deny");
    expect(existsSync(join(root, "workspace"))).toBe(true);
  });

  it("classifies known tools", () => {
    expect(isReadOnly("inspect")).toBe(true);
    expect(isReadOnly("charge")).toBe(false);
  });

  it("relative paths are rejected for write checks", () => {
    const gw = new ToolGateway(defaultContext([root]));
    expect(() => gw.checkPath("relative/path")).toThrow(/absolute/);
  });

  it("spend above approved budget requires approval even for installs", () => {
    const gw = new ToolGateway(defaultContext([root]));
    const d = gw.authorize("install", { spend: 5 });
    expect(d.decision).toBe("approval-required");
    void OmniforgeError;
  });
});
