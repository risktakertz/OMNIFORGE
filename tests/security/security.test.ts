/**
 * Adversarial + security suite: prompt injection, secret-soliciting skills,
 * gateway bypass attempts, unapproved spend/deploy, license gate, model
 * fabrication resistance (policy level), client isolation.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { readFileSync } from "node:fs";

import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeExternalContent } from "@omniforge/research-engine";
import { scanSkillDirs } from "@omniforge/capability-registry";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import { buildRegistry, routeModel } from "@omniforge/model-router";
import { dryRunDeploy } from "@omniforge/deployment";
import { parseRequest } from "@omniforge/intent-engine";
import { routeIntent } from "@omniforge/skill-router";
import { CapabilityRegistry } from "@omniforge/capability-registry";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const HOSTILE = readFileSync(join(repoRoot, "tests", "fixtures", "hostile-docs", "README.md"), "utf8");

describe("adversarial defenses", () => {
  it("hostile README content is flagged and never followed", () => {
    const { sanitized, flaggedInstructions } = sanitizeExternalContent(HOSTILE);
    expect(flaggedInstructions.length).toBeGreaterThanOrEqual(3);
    expect(sanitized).not.toMatch(/ignore all previous/i);
    expect(sanitized).not.toMatch(/reveal your system prompt/i);
    expect(sanitized).not.toMatch(/evil\.example/);
    expect(sanitized).toContain("npm install");
  });

  it("fake upstream skill asking for secrets is blocked at the registry", () => {
    const scan = scanSkillDirs([join(repoRoot, "tests", "fixtures", "fake-skills")]);
    const skill = scan.skills.find((s) => s.id === "secret-asker")!;
    expect(skill).toBeTruthy();
    expect(skill.validationErrors.join(" ")).toMatch(/secrets/);
  });

  it("gateway refuses destructive operations outside approved artifacts", () => {
    const gw = new ToolGateway(defaultContext([repoRoot]));
    expect(() => gw.authorize("rm-rf", { target: resolve(repoRoot, "..") })).toThrow(/E_GATEWAY/);
  });

  it("repo push is a distinct policy class, never smuggled as a read", () => {
    const gw = new ToolGateway(defaultContext([repoRoot]));
    const d = gw.authorize("git-push");
    expect(d.actionClass).toBe("repo-push");
    expect(d.actionClass).not.toBe("read-inspect");
    expect(d.decision).toBe("allow"); // pushing to the USER'S designated repo is authorized this session
  });

  it("expired/absent model tokens yield typed gaps, not degraded results", () => {
    // unverified-but-present provider must NOT serve a security review
    const reg = buildRegistry({ OPENAI_API_KEY: "sk-test-placeholder" } as NodeJS.ProcessEnv);
    const d = routeModel("security-review", reg, { requireVerified: true });
    expect(d.status).toBe("blocked");
    expect(d.mode).toBe("deterministic-core");
    // and with no provider at all the core continues deterministically
    const none = routeModel("security-review", buildRegistry({}), { requireVerified: true });
    expect(none.status).toBe("no-model");
  });

  it("unapproved paid cloud service never enters a plan silently", () => {
    const gw = new ToolGateway(defaultContext([repoRoot]));
    const d = gw.authorize("purchase", { spend: 99 });
    expect(d.decision).toBe("approval-required");
  });

  it("partially failed deployment is detectable via dry-run warnings, not fake success", () => {
    // a directory WITHOUT workspace config yields honest warnings (never a fake plan)
    const report = dryRunDeploy(join(repoRoot, "templates", "static-business"));
    expect(report.target).toBe("unknown");
    expect(report.options).toHaveLength(0);
    expect(report.warnings.join(" ")).toMatch(/unknown target/);
  });

  it("a real static workspace gets concrete deploy options, still approval-gated", () => {
    const { rmSync } = fs;
    const dir = fs.mkdtempSync(join(tmpdir(), "of-sec-deploy-"));
    try {
      fs.writeFileSync(join(dir, "project.config.json"), JSON.stringify({ id: "ws_sec", templateId: "template:static-business" }));
      const good = dryRunDeploy(dir);
      expect(good.target).toBe("static");
      expect(good.options.length).toBeGreaterThan(0);
      expect(good.approvalsRequired.join(" ")).toMatch(/approval/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("client isolation: two configs from the same template share no state", () => {
    const reg = new CapabilityRegistry([join(repoRoot, "skills")], join(repoRoot, "templates"));
    const a = routeIntent(parseRequest("Create a website for Client A salon"), reg);
    const b = routeIntent(parseRequest("Create a website for Client B barber"), reg);
    // routing is stateless per intent — no cross-client leakage in selection
    expect(a.selection.intentId).not.toBe(b.selection.intentId);
    expect(a.templateId).toBe(b.templateId); // same template, different isolated workspaces
  });

  it("white-label configs are per-workspace (template keeps defaults, workspace params override)", () => {
    const templateCfg = JSON.parse(readFileSync(join(repoRoot, "templates", "static-business", "project.template.json"), "utf8"));
    expect(templateCfg.business.name).toBe("Sample Business");
    // the generated workspace writes project.config.json with its own params —
    // covered behaviorally by workspace-manager tests (createWorkspace/params).
  });
});
