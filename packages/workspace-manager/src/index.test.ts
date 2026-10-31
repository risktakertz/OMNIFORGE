import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorkspace, acquireLease, releaseLease, listTemplates, listWorkspaces, readWorkspaceConfig, exportWorkspace } from "./index.js";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import { OmniforgeError } from "@omniforge/shared-types";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

describe("workspace manager", () => {
  it("lists shipped templates", () => {
    const templates = listTemplates(repoRoot);
    expect(templates).toContain("static-business");
    expect(templates).toContain("commerce-lite");
    expect(templates).toContain("godot-native");
  });

  it("creates an isolated workspace from a template with config", () => {
    const projects = mkdtempSync(join(tmpdir(), "of-ws-"));
    try {
      const gw = new ToolGateway(defaultContext([projects]));
      const ws = createWorkspace({
        templateId: "template:static-business",
        name: "Kali Salon",
        params: { business: { name: "Kali Salon" } },
        projectsRoot: projects,
        repoRoot,
        gateway: gw,
      });
      expect(existsSync(join(ws.workspacePath, "project.config.json"))).toBe(true);
      expect(existsSync(join(ws.workspacePath, "src", "index.html"))).toBe(true);
      const cfg = readWorkspaceConfig(ws.workspacePath);
      expect(cfg["templateId"]).toBe("template:static-business");
      expect(listWorkspaces(projects)).toHaveLength(1);
    } finally {
      rmSync(projects, { recursive: true, force: true });
    }
  });

  it("locks workspaces against concurrent writers", () => {
    const projects = mkdtempSync(join(tmpdir(), "of-ws2-"));
    try {
      const gw = new ToolGateway(defaultContext([projects]));
      const ws = createWorkspace({
        templateId: "template:static-business",
        name: "Lock Test",
        params: {},
        projectsRoot: projects,
        repoRoot,
        gateway: gw,
      });
      expect(() => acquireLease(ws.workspacePath, "other-writer")).toThrow(/E_WORKSPACE_LOCKED/);
      releaseLease(ws.workspacePath, "workspace-manager");
      const again = acquireLease(ws.workspacePath, "other-writer");
      expect(again.holder).toBe("other-writer");
    } finally {
      rmSync(projects, { recursive: true, force: true });
    }
  });

  it("refuses to export non-OMNIFORGE directories", () => {
    const dir = mkdtempSync(join(tmpdir(), "of-ws3-"));
    const out = mkdtempSync(join(tmpdir(), "of-ws3out-"));
    try {
      writeFileSync(join(dir, "random.txt"), "not a workspace");
      const gw = new ToolGateway(defaultContext([dir, out]));
      expect(() => exportWorkspace(dir, out, gw)).toThrow(/not an OMNIFORGE workspace/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("exports a standalone artifact with provenance + checksum", () => {
    const projects = mkdtempSync(join(tmpdir(), "of-ws4-"));
    const out = mkdtempSync(join(tmpdir(), "of-ws4out-"));
    try {
      const gw = new ToolGateway(defaultContext([projects, out]));
      const ws = createWorkspace({
        templateId: "template:static-business",
        name: "Export Test",
        params: {},
        projectsRoot: projects,
        repoRoot,
        gateway: gw,
      });
      const artifact = exportWorkspace(ws.workspacePath, out, gw);
      expect(existsSync(artifact.path)).toBe(true);
      expect(artifact.checksum).toHaveLength(64);
      expect(existsSync(artifact.provenanceRef)).toBe(true);
    } finally {
      rmSync(projects, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses workspaces outside approved roots", () => {
    const projects = mkdtempSync(join(tmpdir(), "of-ws5-"));
    try {
      const gw = new ToolGateway(defaultContext([join(tmpdir(), "elsewhere")]));
      expect(() =>
        createWorkspace({
          templateId: "template:static-business",
          name: "Escape",
          params: {},
          projectsRoot: projects,
          repoRoot,
          gateway: gw,
        })
      ).toThrow(OmniforgeError);
    } finally {
      rmSync(projects, { recursive: true, force: true });
    }
  });
});
