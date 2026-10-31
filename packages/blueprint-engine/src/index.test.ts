import { describe, it, expect } from "vitest";
import { parseRequest } from "@omniforge/intent-engine";
import { buildBlueprint, classifyFamily } from "./index.js";

describe("blueprint engine", () => {
  it("bakery website blueprint has checkable acceptance criteria", () => {
    const intent = parseRequest("Create a responsive website for a local bakery");
    const bp = buildBlueprint(intent);
    expect(bp.scope.mvp.some((m) => /contact/i.test(m))).toBe(true);
    const methods = bp.acceptanceCriteria.map((a) => a.evidenceMethod);
    expect(methods).toContain("file-exists:dist/index.html");
    expect(methods).toContain("run-project-tests");
    expect(methods).toContain("no-secrets");
    expect(bp.architecture).toMatchObject({ family: "static" });
  });

  it("amazon-like request yields commerce scope with mock checkout", () => {
    const intent = parseRequest("Make a site like Amazon");
    const bp = buildBlueprint(intent);
    expect(bp.scope.mvp).toContain("Mock checkout with clear 'no real payment' labeling");
    expect(bp.scope.excluded).toContain("real payment collection");
    expect(bp.acceptanceCriteria.some((a) => a.evidenceMethod.includes("cart-logic.js"))).toBe(true);
    expect(bp.architecture).toMatchObject({ family: "static" });
  });

  it("2D game blueprint requires logic tests", () => {
    const intent = parseRequest("Create a simple 2D racing game");
    const bp = buildBlueprint(intent);
    expect(bp.acceptanceCriteria.some((a) => a.evidenceMethod === "file-exists:dist/game-logic.js")).toBe(true);
  });

  it("saas/web-app without lite tags routes to node family", () => {
    const intent = parseRequest("Build an internal web application for inventory management");
    const bp = buildBlueprint(intent);
    expect(bp.architecture).toMatchObject({ family: "node" });
  });

  it("mobile blueprint is honest about device gating", () => {
    const intent = parseRequest("Build my restaurant Android app");
    const bp = buildBlueprint(intent);
    expect(bp.architecture).toMatchObject({ family: "engine" });
    expect(bp.deploymentRequirements).toMatchObject({ approved: false });
  });

  it("family classification is stable across related prompts", () => {
    const a = classifyFamily(parseRequest("Create a website for a salon"));
    const b = classifyFamily(parseRequest("umba tovuti ya salon"));
    expect(a.family).toBe(b.family);
  });
});
