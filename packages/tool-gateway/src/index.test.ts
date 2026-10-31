import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { ToolGateway, defaultContext, isReadOnly } from "./index.js";
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

  it("approval records unlock gated actions", () => {
    const gw = new ToolGateway(defaultContext([root]));
    expect(gw.authorize("deploy").decision).toBe("approval-required");
    gw.recordApproval("apr_123");
    expect(gw.authorize("deploy").decision).toBe("allow");
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
