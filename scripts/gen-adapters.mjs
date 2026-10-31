#!/usr/bin/env node
// Generates the per-adapter spec READMEs under integrations/adapters/<name>/.
// Statuses mirror integrations/catalog.yaml — regenerate via `node scripts/gen-skills.mjs`-style runs.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** @type {Record<string, {mode:string, status:string, purpose:string, enable:string, smoke:string, notes:string}>} */
const ADAPTERS = {
  openspec: {
    mode: "CLI adapter",
    status: "untested",
    purpose: "Versioned spec/change lifecycle as the single source of truth for blueprints and acceptance criteria.",
    enable: "Install the OpenSpec CLI, run its init against this repository, point `docs/decisions/` intake at it.",
    smoke: "Create a sample change -> list -> validate -> archive, asserting the CLI exit codes.",
    notes: "Until wired, spec lifecycle is file-based (blueprints + tests) — documented honestly as untested.",
  },
  gstack: {
    mode: "Methodology (advisory)",
    status: "configured",
    purpose: "Product/design/engineering/review/QA role methods under OMNIFORGE's single orchestration owner.",
    enable: "Follow the upstream host setup for the detected agent host; capability stays advisory.",
    smoke: "One advisory review pass applied to a sample diff, recorded as evidence.",
    notes: "Never a second source of truth; Codex-host support may be experimental upstream — label per host.",
  },
  superpowers: {
    mode: "Methodology (advisory)",
    status: "configured",
    purpose: "Planning, TDD, debugging and code-review methods.",
    enable: "Reference the method docs during planning/verification nodes.",
    smoke: "Apply TDD to one template bugfix; assert red->green evidence.",
    notes: "Advisory only; all execution remains in the OMNIFORGE graph.",
  },
  rea: {
    mode: "MCP/CLI adapter",
    status: "blocked",
    purpose: "Authorized reverse-engineering support for software the user owns or is licensed to analyze.",
    enable: "Record an authorization basis (scope, methods, retention), then follow the official REA setup. Confirm live MCP registration — a SKILL.md alone does NOT install anything.",
    smoke: "Authorization record -> one bounded, authorized analysis operation -> observed-vs-inferred evidence.",
    notes: "Never runs because a product name was mentioned. Native analysis engines may require separate licenses; never acquired silently.",
  },
  opencode: {
    mode: "CLI execution adapter",
    status: "blocked",
    purpose: "Optional coding execution backend alongside the verified local executor.",
    enable: "Install `opencode`, then `omniforge doctor` detects it; a live smoke task flips status to verified.",
    smoke: "One real task (create a file, run its test) via the documented CLI/API.",
    notes: "OpenCode is an execution adapter, not an orchestrator; packaging/names changed across releases — verify the current CLI.",
  },
  openhands: {
    mode: "Process adapter (Python server + HTTP API)",
    status: "untested",
    purpose: "Optional alternative execution backend.",
    enable: "Run the official Python agent server; call it via its documented HTTP API from packages/agent-runtime. No JS SDK is invented.",
    smoke: "Server boot + one task round-trip + graceful shutdown.",
    notes: "Off by default; FREE_FIRST_MODE applies to any usage it causes.",
  },
  "playwright-mcp": {
    mode: "MCP adapter",
    status: "untested",
    purpose: "Agent-driven browser inspection and interactive validation.",
    enable: "Configure the official MCP endpoint for the current host; install a browser.",
    smoke: "Tool discovery + one harmless page inspection (read-only).",
    notes: "MCP servers are not security boundaries; the policy gateway still gates every action.",
  },
  repomix: {
    mode: "CLI adapter",
    status: "untested",
    purpose: "Selective repository packing for authorized architecture analysis (omniforge inspect flows).",
    enable: "Install repomix; run with include/exclude filters limited to the target project.",
    smoke: "Pack a fixture repo; assert output shape and file scope.",
    notes: "Used read-only; respect the authorization policy for third-party code.",
  },
  context7: {
    mode: "Hosted API adapter",
    status: "blocked",
    purpose: "Version-specific library documentation retrieval for the research node.",
    enable: "Provide CONTEXT7_API_KEY via approved secret storage and accept the provider terms.",
    smoke: "One docs fetch for a pinned library version.",
    notes: "Hosted/keyed service — cost and terms checked before enabling; provider throws E_BACKEND_UNAVAILABLE until then.",
  },
  "local-models": {
    mode: "Local service adapter",
    status: "untested",
    purpose: "Ollama / llama.cpp inference when local hardware permits.",
    enable: "Install Ollama or llama.cpp, pull a suitable model; model-router probes health.",
    smoke: "GET /api/tags + one small completion with latency recorded.",
    notes: "Warn when local inference is too slow; never silently degrade high-risk results.",
  },
  commerce: {
    mode: "Template + optional library",
    status: "configured",
    purpose: "Commerce MVP today (templates/commerce-lite); Medusa open-core path for serious stores; Supabase adapter when a backend is justified.",
    enable: "commerce-lite is automatic via the router. Medusa: follow upstream install, record license review (open-core vs enterprise dirs) before any adoption.",
    smoke: "commerce-lite suite (passing). Medusa: boot + catalog API round-trip in sandbox.",
    notes: "Real payments are provider-agnostic, sandbox-first, approved-milestone work.",
  },
  automation: {
    mode: "Mock-first workflow adapter",
    status: "configured",
    purpose: "Reminder/CRM-style automations with human-approved external actions.",
    enable: "Compose from templates + tool-gateway approval records; Activepieces CE only when license-eligible and justified.",
    smoke: "Full workflow in mock mode with evidence; external sends stay denied without approval.",
    notes: "Least-privilege service accounts; redacted logs; execution quotas.",
  },
  deployment: {
    mode: "Dry-run adapter",
    status: "configured",
    purpose: "Free-first deployment plans (static hosts, node hosts, Coolify when infrastructure exists).",
    enable: "`omniforge deploy <project> --dry-run`. Real deploys require an approved host + explicit approval record; the execute path throws E_DEPLOY_BLOCKED until then.",
    smoke: "Dry-run report on every template family; external health check after any real deploy.",
    notes: "Provider terms and commercial-use limits are re-verified at deploy time — no historical free-tier assumptions.",
  },
};

for (const [name, a] of Object.entries(ADAPTERS)) {
  const dir = join(ROOT, "integrations", "adapters", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "README.md"),
    `# ${name} adapter

- **Mode:** ${a.mode}
- **Status:** ${a.status} (honest vocabulary — see catalog.yaml)

## Purpose
${a.purpose}

## Enable
${a.enable}

## Smoke test
${a.smoke}

## Notes
${a.notes}
`,
    "utf8"
  );
}
console.log(`generated ${Object.keys(ADAPTERS).length} adapter READMEs`);
