#!/usr/bin/env node
// Generates package.json + tsconfig.json for every OMNIFORGE workspace package.
// Keeps manifests consistent; re-run after adding a package.
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const E = {
  ST: "@omniforge/shared-types",
  UT: "@omniforge/utils",
  OB: "@omniforge/observability",
  IE: "@omniforge/intent-engine",
  RE: "@omniforge/research-engine",
  BE: "@omniforge/blueprint-engine",
  CR: "@omniforge/capability-registry",
  SR: "@omniforge/skill-router",
  TP: "@omniforge/task-planner",
  TG: "@omniforge/tool-gateway",
  AR: "@omniforge/agent-runtime",
  MR: "@omniforge/model-router",
  WM: "@omniforge/workspace-manager",
  VE: "@omniforge/verification",
  DP: "@omniforge/deployment",
  OR: "@omniforge/orchestration",
};

/** @type {Record<string, {desc:string, deps?:Record<string,string>, bin?:Record<string,string>}>} */
const packages = {
  "shared-types": {
    desc: "Versioned OMNIFORGE domain contracts: Zod schemas, types, error codes, events.",
    deps: { zod: "^3.24.1" },
  },
  utils: { desc: "Pure reusable helpers: ids, slugs, redaction, path safety, time." },
  observability: {
    desc: "Structured logging, run events, secret redaction, run journal persistence.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "intent-engine": {
    desc: "Deterministic request interpretation (English + Swahili) with assumptions and unknowns.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "research-engine": {
    desc: "Documentation/evidence adapters with external-content sanitization (prompt-injection defense).",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "blueprint-engine": {
    desc: "Product blueprints: scope, architecture, threat model, acceptance criteria, cost estimates.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "capability-registry": {
    desc: "Agent Skills discovery, frontmatter validation and capability indexing (no execution during scan).",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*", yaml: "^2.7.0" },
  },
  "skill-router": {
    desc: "Hybrid deterministic routing: eligibility, dependency/conflict resolution, explainable ranking.",
    deps: { [E.ST]: "workspace:*", [E.CR]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "task-planner": {
    desc: "Dependency-aware task DAG with budgets, idempotency keys and cycle detection.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "tool-gateway": {
    desc: "Deterministic policy gateway: action classification, path safety, spend gate, approvals, audit.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*", [E.OB]: "workspace:*" },
  },
  "agent-runtime": {
    desc: "Coding-backend adapter interface with a local executor; OpenCode adapter stub (honest availability).",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*", [E.TG]: "workspace:*", [E.OB]: "workspace:*" },
  },
  "model-router": {
    desc: "Model registry and routing policy over available authorized providers; no silent fallbacks.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  "workspace-manager": {
    desc: "Isolated project workspaces from templates: leases/locks, rendering, export with provenance.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*", [E.TG]: "workspace:*", [E.OB]: "workspace:*" },
  },
  verification: {
    desc: "File/artifact/behavior checks, evidence collection, failure classification and bounded repair policy.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*", [E.AR]: "workspace:*", [E.OB]: "workspace:*" },
  },
  deployment: {
    desc: "Deployment capability detection and free-first dry-run plans; real deploys require approval.",
    deps: { [E.ST]: "workspace:*", [E.UT]: "workspace:*" },
  },
  orchestration: {
    desc: "LangGraph.js pipeline with durable file-backed checkpoints, run journal and resume.",
    deps: {
      [E.ST]: "workspace:*",
      [E.UT]: "workspace:*",
      [E.OB]: "workspace:*",
      [E.IE]: "workspace:*",
      [E.RE]: "workspace:*",
      [E.BE]: "workspace:*",
      [E.CR]: "workspace:*",
      [E.SR]: "workspace:*",
      [E.TP]: "workspace:*",
      [E.TG]: "workspace:*",
      [E.WM]: "workspace:*",
      [E.VE]: "workspace:*",
      [E.MR]: "workspace:*",
      [E.AR]: "workspace:*",
      [E.DP]: "workspace:*",
      "@langchain/langgraph": "0.2.74",
      "@langchain/langgraph-checkpoint": "~0.0.18",
      "@langchain/core": "^0.3.50",
    },
  },
  "cli": {
    desc: "omniforge — the user-facing CLI for planning, creating, verifying and exporting software.",
    deps: {
      [E.ST]: "workspace:*",
      [E.UT]: "workspace:*",
      [E.OB]: "workspace:*",
      [E.IE]: "workspace:*",
      [E.BE]: "workspace:*",
      [E.CR]: "workspace:*",
      [E.SR]: "workspace:*",
      [E.TP]: "workspace:*",
      [E.TG]: "workspace:*",
      [E.WM]: "workspace:*",
      [E.VE]: "workspace:*",
      [E.MR]: "workspace:*",
      [E.OR]: "workspace:*",
      [E.DP]: "workspace:*",
      [E.RE]: "workspace:*",
      [E.AR]: "workspace:*",
      yaml: "^2.7.0",
    },
    bin: { omniforge: "./dist/index.js" },
  },
};

const tsconfig = null; void tsconfig;

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
}

for (const [name, meta] of Object.entries(packages)) {
  const isCli = name === "cli";
  const pkgName = isCli ? "@omniforge/cli" : `@omniforge/${name}`;
  const dir = isCli ? join(ROOT, "apps/cli") : join(ROOT, "packages", name);
  const tsconfigFor = {
    extends: isCli ? "../../packages/config/tsconfig.base.json" : "../config/tsconfig.base.json",
    compilerOptions: { outDir: "dist", rootDir: "src" },
    include: ["src"],
    exclude: ["dist", "src/**/*.test.ts"],
  };
  const pkg = {
    name: pkgName,
    private: true,
    version: "0.1.0",
    description: meta.desc,
    type: "module",
    main: "./dist/index.js",
    types: "./dist/index.d.ts",
    ...(meta.bin ? { bin: meta.bin } : {}),
    files: ["dist"],
    scripts: {
      build: "tsc -p tsconfig.json",
      typecheck: "tsc -p tsconfig.json --noEmit",
    },
    ...(meta.deps ? { dependencies: meta.deps } : {}),
  };
  writeJson(join(dir, "package.json"), pkg);
  writeJson(join(dir, "tsconfig.json"), tsconfigFor);
}

// config package is configuration-only
const cfgPath = join(ROOT, "packages/config/package.json");
const cfgJson = JSON.parse(readFileSync(cfgPath, "utf8"));
writeJson(cfgPath, cfgJson);

console.log("scaffolded", Object.keys(packages).length + 1, "package manifests");
