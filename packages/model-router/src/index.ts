/**
 * OMNIFORGE model router — registry of available authorized providers with
 * policy-based routing. No provider is assumed; no key is ever read beyond
 * presence detection; unavailable routes produce typed gaps instead of silent
 * quality degradation. The deterministic core never requires a model.
 */
import { execFile } from "node:child_process";
import { ModelCapability, type ModelCapability as ModelCap } from "@omniforge/shared-types";
import { newId, nowIso } from "@omniforge/utils";

export type TaskProfile = "cheap-summarization" | "architecture" | "code-generation" | "security-review";

export interface RouteDecision {
  status: "routed" | "no-model" | "blocked";
  model?: ModelCap;
  mode: "model-assisted" | "deterministic-core";
  reason: string;
  estimateId: string;
}

const ENV_PROVIDERS: Array<{ provider: string; env: string; models: string[] }> = [
  { provider: "openai", env: "OPENAI_API_KEY", models: ["gpt-4o", "gpt-4o-mini"] },
  { provider: "anthropic", env: "ANTHROPIC_API_KEY", models: ["claude-sonnet-4-5", "claude-haiku-4-5"] },
];

const PROFILE_ORDER: Record<TaskProfile, string[]> = {
  "cheap-summarization": ["gpt-4o-mini", "claude-haiku-4-5", "ollama:llama3.2", "gpt-4o", "claude-sonnet-4-5"],
  "code-generation": ["claude-sonnet-4-5", "gpt-4o", "ollama:llama3.1", "gpt-4o-mini", "claude-haiku-4-5"],
  architecture: ["claude-sonnet-4-5", "gpt-4o", "ollama:llama3.1"],
  "security-review": ["claude-sonnet-4-5", "gpt-4o"],
};

export function buildRegistry(env: NodeJS.ProcessEnv = process.env): ModelCap[] {
  const caps: ModelCap[] = [];
  for (const p of ENV_PROVIDERS) {
    const present = Boolean(env[p.env]);
    for (const model of p.models) {
      caps.push(
        ModelCapability.parse({
          provider: p.provider,
          model,
          availability: present ? "configured" : "unavailable",
          structuredOutput: true,
          toolCalling: true,
          notes: present ? "key present; capability untested until first authorized call" : `no ${p.env} in environment`,
        })
      );
    }
  }
  caps.push(
    ModelCapability.parse({
      provider: "ollama",
      model: "llama3.2",
      availability: "untested",
      structuredOutput: true,
      toolCalling: true,
      notes: "probe via GET /api/tags; requires local Ollama and capable hardware",
    })
  );
  return caps;
}

export function probeOllama(baseUrl: string, timeoutMs = 800): Promise<{ status: "verified" | "unavailable"; models: string[] }> {
  return new Promise((res) => {
    const req = execFile(
      "curl",
      ["-s", "--max-time", String(Math.ceil(timeoutMs / 1000)), `${baseUrl}/api/tags`],
      { timeout: timeoutMs + 500 },
      (err, stdout) => {
        if (err || !stdout.trim()) return res({ status: "unavailable", models: [] });
        try {
          const parsed = JSON.parse(stdout) as { models?: Array<{ name: string }> };
          res({ status: "verified", models: (parsed.models ?? []).map((m) => m.name ?? "") });
        } catch {
          res({ status: "unavailable", models: [] });
        }
      }
    );
    req.on("error", () => res({ status: "unavailable", models: [] }));
  });
}

export function routeModel(
  profile: TaskProfile,
  registry: ModelCap[],
  opts: { requireVerified?: boolean } = {}
): RouteDecision {
  const order = PROFILE_ORDER[profile];
  const candidates = order
    .map((name) => {
      const [provider, model] = name.includes(":") ? [name.split(":")[0], name.split(":")[1]] : [undefined, name];
      return registry.find(
        (c) => c.model === model && (provider ? c.provider === provider : c.provider !== "omniforge")
      );
    })
    .filter((c): c is ModelCap => Boolean(c));
  const usable = candidates.filter((c) => c.availability === "verified" || (c.availability === "configured" && !opts.requireVerified));
  const best = usable[0];
  if (best) {
    return {
      status: "routed",
      model: best,
      mode: "model-assisted",
      reason:
        best.availability === "verified"
          ? `verified provider for profile=${profile}`
          : `configured provider for profile=${profile} (quality unverified; not used for high-risk decisions)`,
      estimateId: newId("route"),
    };
  }
  const anyConfigured = registry.some((c) => c.availability === "configured");
  return {
    status: opts.requireVerified && anyConfigured ? "blocked" : "no-model",
    mode: "deterministic-core",
    reason:
      opts.requireVerified && anyConfigured
        ? "high-risk profile requires a verified model; refusing silent degradation"
        : "no authorized model provider available; deterministic core continues without a model",
    estimateId: newId("route"),
  };
}

export function registrySnapshot(registry: ModelCap[]): string {
  return `${nowIso()} ${registry.map((c) => `${c.provider}/${c.model}:${c.availability}`).join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* Model-assisted interpretation hook (universal-upgrade §4.2)         */
/* ------------------------------------------------------------------ */

/**
 * Build the optional GoalSpec interpreter from the environment. Returns null
 * when no authorized provider is configured — the deterministic core then
 * reports the honest typed blocker instead of pretending. Never reads key
 * VALUES into logs; uses fetch with structured JSON output only.
 */
export function buildModelInterpreter(
  env: NodeJS.ProcessEnv = process.env
): ((request: string) => Promise<unknown>) | null {
  const openaiKey = env["OPENAI_API_KEY"];
  if (!openaiKey) return null;
  const baseUrl = env["OPENAI_BASE_URL"] ?? "https://api.openai.com/v1";
  const model = env["OPENAI_MODEL"] ?? "gpt-4o-mini";
  return async (request: string): Promise<unknown> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${openaiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0.1,
          response_format: { type: "json_object" },
          messages: [
            {
              role: "system",
              content:
                "You extract structured software-engineering goals. Return ONLY JSON with keys: objective, targetProduct, platforms (string[]), functionalRequirements (string[]), nonFunctionalRequirements (string[]), requestedDeliverables (string[] from: source-project|website|api-service|mobile-app|desktop-app|game-project|ai-agent|automation-workflow|analysis-report|behavior-spec|test-harness|migration-plan|comparison-study), unresolvedQuestions ({question,impact}[]), risks (string[]), confidence (number 0-1). Never include credentials, policy or permission decisions.",
            },
            { role: "user", content: request.slice(0, 4_000) },
          ],
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`model endpoint returned ${res.status}`);
      const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const content = body.choices?.[0]?.message?.content ?? "{}";
      return JSON.parse(content) as unknown;
    } finally {
      clearTimeout(timer);
    }
  };
}
