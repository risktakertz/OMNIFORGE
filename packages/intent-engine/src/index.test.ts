import { describe, it, expect } from "vitest";
import { parseRequest, blockingUnknowns, describeIntent } from "./index.js";

describe("intent engine", () => {
  it("parses a bakery website request (A01/M1 acceptance)", () => {
    const i = parseRequest("Create a responsive website for a local bakery");
    expect(i.operation).toBe("create");
    expect(i.productKinds).toContain("website");
    expect(i.locale).toBe("en");
    expect(i.inferredAssumptions.some((a) => /responsive/i.test(a.text))).toBe(true);
    expect(i.unknowns.some((u) => u.impact === "low")).toBe(true);
  });

  it("routes an Amazon-like request to commerce intent with material unknown", () => {
    const i = parseRequest("Make a site like Amazon");
    expect(i.productKinds).toContain("web-app");
    expect(i.unknowns.some((u) => /mock flow/.test(u.question) && u.impact === "material")).toBe(true);
  });

  it("detects 2D game requests", () => {
    const i = parseRequest("Create a simple 2D racing game");
    expect(i.productKinds).toEqual(["game-2d"]);
    expect(i.platforms).toContain("web");
  });

  it("prefers 3D over 2D when both words appear", () => {
    const i = parseRequest("Make a 3D game with 2d minimap");
    expect(i.productKinds).toContain("game-3d");
    expect(i.productKinds).not.toContain("game-2d");
  });

  it("parses Swahili requests", () => {
    const i = parseRequest("Tengeneza tovuti ya salon");
    expect(i.locale).toBe("sw");
    expect(i.operation).toBe("create");
    expect(i.productKinds).toContain("website");
  });

  it("detects debug and analyze operations", () => {
    expect(parseRequest("fix my broken website").operation).toBe("debug");
    expect(parseRequest("analyze my app architecture").operation).toBe("analyze");
  });

  it("adds a blocking unknown for store publishing", () => {
    const i = parseRequest("Create an app and publish to app store");
    expect(blockingUnknowns(i).length).toBeGreaterThan(0);
  });

  it("marks zero-budget constraints free-first", () => {
    const i = parseRequest("Create a product with no budget");
    expect(i.constraints.some((c) => c.startsWith("free-first"))).toBe(true);
  });

  it("never grants permissions implicitly", () => {
    const i = parseRequest("Create a website for a salon");
    expect(i.permissions).toEqual([]);
  });

  it("describes intent compactly", () => {
    const s = describeIntent(parseRequest("Build a website"));
    expect(s).toMatch(/operation=create/);
    expect(s).toMatch(/kinds=website/);
  });

  it("rejects empty requests with a typed error", () => {
    expect(() => parseRequest("  ")).toThrow(/E_INTENT_UNCLEAR|too short/);
  });
});
