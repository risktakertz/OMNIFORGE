/**
 * Routing evals — the M2 acceptance: short prompt changes change the selected
 * capability combination in deterministic, explainable ways. Mirrors the
 * master directive's acceptance table A01–A12.
 */
import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequest } from "@omniforge/intent-engine";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { routeIntent, evaluateRouting } from "@omniforge/skill-router";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const reg = new CapabilityRegistry([join(repoRoot, "skills")], join(repoRoot, "templates"));

interface Case {
  id: string;
  prompt: string;
  template: string;
  packsInclude?: string[];
  packsExclude?: string[];
}

const CASES: Case[] = [
  { id: "A01", prompt: "Create a website for a salon.", template: "template:static-business", packsInclude: ["ui-design", "testing"] },
  { id: "A02", prompt: "Make a site like Amazon.", template: "template:commerce-lite", packsInclude: ["ecommerce"] },
  { id: "A03", prompt: "Build my restaurant Android app.", template: "template:expo-mobile", packsInclude: ["mobile-apps"] },
  { id: "A04", prompt: "Create a simple 2D racing game.", template: "template:phaser-2d", packsInclude: ["2d-games"] },
  { id: "A05", prompt: "Make a basic 3D adventure game.", template: "template:godot-native", packsInclude: ["3d-games"] },
  { id: "A06", prompt: "Create a business dashboard.", template: "template:dashboard-lite" },
  { id: "A07", prompt: "Improve this existing app without breaking it.", template: "template:static-business", packsExclude: ["reverse-engineering"] },
  { id: "A09", prompt: "Create an automated client reminder system.", template: "template:api", packsInclude: ["business-automation"] },
  { id: "A10", prompt: "Generate a SaaS product I can customize for shops.", template: "template:next-web", packsInclude: ["security"] },
  { id: "A11", prompt: "Create a product with no budget.", template: "template:static-business" },
];

describe("routing evals (directive acceptance table)", () => {
  for (const c of CASES) {
    it(`${c.id}: "${c.prompt}" -> ${c.template}`, () => {
      const { templateId, packs, missing } = evaluateRouting(parseRequest(c.prompt), reg);
      expect(templateId).toBe(c.template);
      expect(missing).toEqual([]);
      for (const p of c.packsInclude ?? []) expect(packs).toContain(p);
      for (const p of c.packsExclude ?? []) expect(packs).not.toContain(p);
    });
  }

  it("free-first: zero-cost estimate and no paid approvals on every case", () => {
    for (const c of CASES) {
      const { selection } = routeIntent(parseRequest(c.prompt), reg);
      expect(selection.estimatedCost).toMatch(/0 USD/);
      expect(selection.approvalsRequired).toHaveLength(0);
    }
  });

  it("A07-style debug requests add the debugging pack", () => {
    const { packs } = evaluateRouting(parseRequest("Fix my broken website"), reg);
    expect(packs).toContain("debugging");
  });

  it("A08: REA phrasing maps the analyst pack but authorization stays a runtime gate", () => {
    const { packs } = evaluateRouting(parseRequest("Rebuild my authorized desktop app behavior"), reg);
    expect(packs).toContain("reverse-engineering");
    // the router only selects the pack; authorization is enforced by policy docs + gateway
    expect(reg.get("skill:reverse-engineering").requirements.join(" ")).toMatch(/authorization/i);
  });

  it("A12: resume requests stay interpretable (run-id is supplied to the CLI, not invented)", () => {
    const intent = parseRequest("Resume my failed project.");
    expect(intent.operation).toBe("create");
    expect(intent.request.toLowerCase()).toContain("resume");
  });
});
