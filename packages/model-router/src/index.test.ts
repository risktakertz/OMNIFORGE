import { describe, it, expect } from "vitest";
import { buildRegistry, routeModel } from "./index.js";

const NO_ENV: NodeJS.ProcessEnv = {};

describe("model router", () => {
  it("reports unavailable without credentials (no assumptions)", () => {
    const reg = buildRegistry(NO_ENV);
    expect(reg.every((m) => m.availability === "unavailable" || m.provider === "ollama")).toBe(true);
    const d = routeModel("code-generation", reg);
    expect(d.status).toBe("no-model");
    expect(d.mode).toBe("deterministic-core");
  });

  it("marks providers configured when keys exist, still unverified", () => {
    const reg = buildRegistry({ OPENAI_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
    const openai = reg.filter((m) => m.provider === "openai");
    expect(openai.every((m) => m.availability === "configured")).toBe(true);
    expect(openai[0].notes).toMatch(/untested/);
  });

  it("routes cheap profiles to lighter models first", () => {
    const reg = buildRegistry({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-test" } as NodeJS.ProcessEnv).map(
      (m) => ({ ...m, availability: "verified" as const })
    );
    const cheap = routeModel("cheap-summarization", reg);
    expect(cheap.model?.model).toBe("gpt-4o-mini");
    const heavy = routeModel("architecture", reg);
    expect(heavy.model?.model).toBe("claude-sonnet-4-5");
  });

  it("refuses silent degradation for high-risk profiles with unverified models", () => {
    const reg = buildRegistry({ OPENAI_API_KEY: "sk-test" } as NodeJS.ProcessEnv);
    const d = routeModel("security-review", reg, { requireVerified: true });
    expect(d.status).toBe("blocked");
    expect(d.mode).toBe("deterministic-core");
  });

  it("deterministic core continues when nothing is available", () => {
    const d = routeModel("architecture", buildRegistry(NO_ENV), { requireVerified: true });
    expect(d.mode).toBe("deterministic-core");
    expect(d.reason).toMatch(/deterministic core|no authorized/);
  });
});
