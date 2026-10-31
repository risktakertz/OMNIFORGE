import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRequest } from "@omniforge/intent-engine";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { routeIntent, evaluateRouting } from "./index.js";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const reg = new CapabilityRegistry([join(repoRoot, "skills")], join(repoRoot, "templates"));

describe("skill router (deterministic, explainable)", () => {
  const cases: Array<[string, string]> = [
    ["Create a website for a salon.", "template:static-business"],
    ["Make a site like Amazon.", "template:commerce-lite"],
    ["Build my restaurant Android app.", "template:expo-mobile"],
    ["Create a simple 2D racing game.", "template:phaser-2d"],
    ["Make a basic 3D adventure game.", "template:godot-native"],
    ["Create a business dashboard.", "template:dashboard-lite"],
    ["Book appointments for my barbershop.", "template:booking-lite"],
    ["Generate a SaaS product I can customize for shops.", "template:next-web"],
    ["Create a REST API for orders.", "template:api"],
  ];

  for (const [prompt, template] of cases) {
    it(`routes "${prompt}" -> ${template}`, () => {
      const { templateId } = routeIntent(parseRequest(prompt), reg);
      expect(templateId).toBe(template);
    });
  }

  it("M2 acceptance: changing the prompt changes the selection deterministically", () => {
    const a = evaluateRouting(parseRequest("Create a website for a salon."), reg);
    const b = evaluateRouting(parseRequest("Create a simple 2D racing game."), reg);
    expect(a.templateId).not.toBe(b.templateId);
    expect(a.packs).not.toEqual(b.packs);
    expect(a.templateId).toBe("template:static-business");
    expect(b.templateId).toBe("template:phaser-2d");
    expect(b.packs).toContain("2d-games");
  });

  it("records reverse-engineering pack only for authorized-analysis phrasing", () => {
    const a = evaluateRouting(parseRequest("Create a website"), reg);
    expect(a.packs).not.toContain("reverse-engineering");
    const b = evaluateRouting(parseRequest("Rebuild my authorized desktop app behavior"), reg);
    expect(b.packs).toContain("reverse-engineering");
  });

  it("missing skills produce typed gaps, never simulations", () => {
    const empty = new CapabilityRegistry([join(__dirname, "does-not-exist")], join(repoRoot, "templates"));
    const { missing } = routeIntent(parseRequest("Create a website for a salon."), empty);
    expect(missing.some((m) => m.startsWith("skill:"))).toBe(true);
  });

  it("missing template is reported as a typed gap", () => {
    const noTemplates = new CapabilityRegistry([join(repoRoot, "skills")], fileURLToPath(new URL("./no-templates-dir", import.meta.url)));
    const { missing } = routeIntent(parseRequest("Create a website"), noTemplates);
    expect(missing).toContain("template:static-business");
  });

  it("selection evidence explains exclusions", () => {
    const { selection } = routeIntent(parseRequest("Create a website for a bakery"), reg);
    expect(selection.evidence.join(" ")).toMatch(/template rule/);
    expect(selection.excluded.length).toBeGreaterThan(3);
    expect(selection.estimatedCost).toMatch(/0 USD/);
  });
});
