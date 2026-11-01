import { describe, it, expect, vi } from "vitest";
import { authorizeModelCall, buildModelInterpreter, type ModelCallPolicy } from "./index.js";

const policy: ModelCallPolicy = { approvalId: "operator-test", provider: "openai", model: "test", endpoint: "https://example.invalid/v1", cost: "paid", approvedSpend: 1, taskBudget: 0.5, reservedPerCall: 0.25, maxCalls: 2 };
const route = { provider: policy.provider, model: policy.model, endpoint: policy.endpoint };

describe("model call authorization", () => {
  it("key presence and zero spend never activate network", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(buildModelInterpreter({ OPENAI_API_KEY: "test-only", APPROVED_SPEND: "0" })).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("blocks paid zero budgets and unknown costs before fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const p of [{ ...policy, approvedSpend: 0 }, { ...policy, cost: "unknown" as const }]) {
      const interpreter = buildModelInterpreter({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "test", OPENAI_BASE_URL: route.endpoint }, p)!;
      await expect(interpreter("a goal")).rejects.toThrow();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
  it("reserves failed attempts across reuse of a restored ledger", () => {
    const ledger = { calls: 0, reserved: 0 };
    authorizeModelCall(policy, route, ledger);
    const restored = JSON.parse(JSON.stringify(ledger));
    authorizeModelCall(policy, route, restored);
    expect(() => authorizeModelCall(policy, route, restored)).toThrow(/exhausted/);
    expect(restored.reserved).toBe(0.5);
  });
  it("allows explicitly verified free routes and refuses route substitution", () => {
    const p = { ...policy, cost: "verified-free" as const, approvedSpend: 0, taskBudget: 0, reservedPerCall: 0 };
    expect(() => authorizeModelCall(p, route, { calls: 0, reserved: 0 })).not.toThrow();
    expect(() => authorizeModelCall(p, { ...route, endpoint: "https://other.invalid" }, { calls: 0, reserved: 0 })).toThrow(/route/);
  });
  it("an authorized fake free provider performs exactly one bounded interpreter call", async () => {
    const p = { ...policy, cost: "verified-free" as const, approvedSpend: 0, taskBudget: 0, reservedPerCall: 0, maxCalls: 1 };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ objective: "Original goal" }) } }] }), { status: 200 }));
    try {
      const interpreter = buildModelInterpreter({ OPENAI_API_KEY: "test-only", OPENAI_MODEL: "test", OPENAI_BASE_URL: route.endpoint }, p)!;
      expect(await interpreter("a goal")).toEqual({ objective: "Original goal" });
      await expect(interpreter("retry beyond approved count")).rejects.toThrow(/exhausted/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
      expect(payload.max_tokens).toBe(1500);
    } finally { fetchSpy.mockRestore(); }
  });
});
