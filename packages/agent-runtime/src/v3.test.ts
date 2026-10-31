/**
 * agent-runtime v3 contract tests (universal-upgrade §3) — fake backends only.
 * These prove the CONTRACT and the routing logic; live model autonomy is a
 * separate opt-in smoke (BLOCKED_HOST: no opencode binary / model creds here),
 * and is reported separately from these deterministic results (§12 rule).
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  snapshotManifest,
  diffManifests,
  scopeViolationsOf,
  selectExecutionRoute,
  LocalNodeBackend,
  OpenCodeBackend,
  type CodingBackend,
  type AgentTaskSpec,
  type AgentTaskResult,
  type BackendFeatureFlags,
} from "./index.js";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";

describe("baseline-manifest change detection (§3.3)", () => {
  it("counts untracked/new file changes WITHOUT a git repo", () => {
    const ws = mkdtempSync(join(tmpdir(), "of-manifest-"));
    writeFileSync(join(ws, "a.txt"), "one");
    const before = snapshotManifest(ws);
    writeFileSync(join(ws, "b.txt"), "two"); // brand-new untracked file
    writeFileSync(join(ws, "a.txt"), "one-edited");
    const diff = diffManifests(before, snapshotManifest(ws));
    expect(diff.added).toContain("b.txt");
    expect(diff.changed).toContain("a.txt");
    expect(diff.removed).toHaveLength(0);
    expect(existsSync(join(ws, ".git"))).toBe(false); // git was never required
  });

  it("detects removals and skips node_modules", () => {
    const ws = mkdtempSync(join(tmpdir(), "of-manifest-"));
    writeFileSync(join(ws, "keep.js"), "x");
    writeFileSync(join(ws, "gone.js"), "y");
    const before = snapshotManifest(ws);
    mkdirSync(join(ws, "node_modules"), { recursive: true });
    writeFileSync(join(ws, "node_modules", "pkg.js"), "dep");
    rmSync(join(ws, "gone.js"));
    const diff = diffManifests(before, snapshotManifest(ws));
    expect(diff.removed).toContain("gone.js");
    expect(diff.added.filter((f) => f.includes("node_modules"))).toHaveLength(0);
  });
});

describe("bounded file scope enforcement (§3.1/§3.6)", () => {
  it("flags writes outside the declared writable scope", () => {
    const violations = scopeViolationsOf({ changed: [], added: ["src/ok.js", "etc/passwd"], removed: ["tests/must-not-change.test.mjs"] }, { writable: ["src/"], forbidden: ["tests/"] });
    expect(violations).toContain("etc/passwd");
    expect(violations.join(" ")).toMatch(/forbidden path touched/);
    expect(violations).not.toContain("src/ok.js");
  });
  it("no scope declared → no violations (honest default)", () => {
    expect(scopeViolationsOf({ changed: ["anything"], added: [], removed: [] }, undefined)).toHaveLength(0);
  });
});

describe("capability-aware execution routing (§3.5)", () => {
  const fakeModelBackend: CodingBackend = {
    id: "fake-model",
    available: true,
    availabilityNote: "fake model backend for contract tests",
    capabilities: () => [],
    features: (): BackendFeatureFlags => ({ prepare: true, streamEvents: false, cancel: false, collectDiff: true, collectEvidence: false, modelBacked: true }),
    health: async () => ({ status: "verified", detail: "fake" }),
    runTask: async () => ({ exitCode: 0, stdout: "", stderr: "", durationMs: 0, timedOut: false, signal: null }),
    executeTask: async (_spec: AgentTaskSpec): Promise<AgentTaskResult> => ({ status: "passed", detail: "fake edit", changedFiles: ["src/x.js"], scopeViolations: [], raw: null }),
    close: async () => {},
  };

  it("reuses a deterministic template when it fully meets the requirement", () => {
    const d = selectExecutionRoute({ templateSufficient: true, templateId: "template:commerce-lite", requiresNovelCode: false, reason: "storefront" }, null);
    expect(d.route).toBe("template");
    if (d.route === "template") expect(d.templateId).toBe("template:commerce-lite");
  });

  it("hands novel requirements to an available model-backed backend", () => {
    const d = selectExecutionRoute({ templateSufficient: false, requiresNovelCode: true, reason: "unseen domain" }, fakeModelBackend);
    expect(d.route).toBe("backend");
  });

  it("returns typed NEEDS_MODEL when no backend exists — never a fake substitute", () => {
    const d = selectExecutionRoute({ templateSufficient: false, requiresNovelCode: true, reason: "unseen domain" }, null);
    expect(d.route).toBe("needs-model");
    if (d.route === "needs-model") expect(d.code).toBe("E_NEEDS_MODEL");
  });

  it("returns typed BACKEND_BLOCKED for a deterministic backend facing novel work", () => {
    const gw = new ToolGateway(defaultContext([tmpdir()]));
    const local = new LocalNodeBackend(gw);
    const d = selectExecutionRoute({ templateSufficient: false, requiresNovelCode: true, reason: "novel app" }, local);
    expect(d.route).toBe("backend-blocked");
    if (d.route === "backend-blocked") expect(d.code).toBe("E_BACKEND_BLOCKED");
  });

  it("reports truthful feature flags (deterministic backend is NOT model-backed)", () => {
    const gw = new ToolGateway(defaultContext([tmpdir()]));
    expect(new LocalNodeBackend(gw).features().modelBacked).toBe(false);
    const oc = new OpenCodeBackend(gw, null);
    expect(oc.available).toBe(false);
    expect(oc.features().modelBacked).toBe(true); // adapter supports models when the CLI exists
    expect(oc.features().streamEvents).toBe(false); // honest: no stable event contract
  });
});
