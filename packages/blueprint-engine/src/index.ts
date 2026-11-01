/**
 * OMNIFORGE blueprint engine — turns a validated intent into a versioned
 * ProductBlueprint: MVP scope, architecture family, threat model basics,
 * free-first cost estimate and machine-checkable acceptance criteria.
 * evidenceMethod values are a small closed vocabulary the verification package
 * implements: file-exists:<path> | file-contains:<path>:<needle> |
 * run-project-tests | no-secrets | link-check | structure-check |
 * isolated-clients | zero-billable
 */
import { ProductBlueprint, CostEstimate, OmniforgeError, type ProjectIntent, type ProductBlueprint as Blueprint, type CostEstimate as Estimate } from "@omniforge/shared-types";
import { newId, nowIso } from "@omniforge/utils";

export type Family = "static" | "node" | "engine";

export interface FamilyPlan {
  family: Family;
  stack: string[];
  hosting: string[];
}

export function classifyFamily(intent: ProjectIntent): FamilyPlan {
  // the FULL request participates in family detection (not only extracted
  // requirement fragments) — a "dashboard from CSV" request must not fall
  // through to the node family just because extraction missed the word
  const req = `${intent.request} ${intent.explicitRequirements.join(" ")}`.toLowerCase();
  const kinds = intent.productKinds;
  const isLiteStatic =
    kinds.includes("website") ||
    (kinds.includes("web-app") &&
      /(commerce|e-?commerce|shop|store|duka|amazon|market|marketplace|cart|booking|dashboard|school|salon|barber|bakery|restaurant|hotel)/.test(req));
  if (kinds.includes("game-2d")) {
    return { family: "static", stack: ["Phaser (CDN or npm)", "pure-TS game logic modules"], hosting: ["static hosting"] };
  }
  if (isLiteStatic) {
    return { family: "static", stack: ["HTML5", "CSS", "vanilla ES modules", "localStorage state"], hosting: ["static hosting"] };
  }
  if (kinds.includes("mobile") || kinds.includes("desktop") || kinds.includes("game-3d")) {
    return {
      family: "engine",
      stack: kinds.includes("mobile")
        ? ["Expo / React Native / TypeScript"]
        : kinds.includes("desktop")
          ? ["Tauri (Rust shell) + web UI"]
          : ["Godot project"],
      hosting: ["local toolchain required for builds"],
    };
  }
  return {
    family: "node",
    stack: ["TypeScript strict", "Zod-validated contracts", "Node runtime", "zero heavyweight frameworks"],
    hosting: ["Node host or approved platform"],
  };
}

interface KindScope {
  mvp: string[];
  later: string[];
  excluded: string[];
  criteria: Array<{ id: string; criterion: string; evidenceMethod: string }>;
}

const BASE_EXCLUDED = ["real payment collection", "production data migration", "third-party branding assets"];

function staticScope(domain: string | null): KindScope {
  const d = domain ?? "the business";
  return {
    mvp: [
      "Responsive landing page (mobile-first)",
      `Services/feature section for ${d}`,
      "Contact section with actionable link (form/mailto/WhatsApp)",
      "SEO metadata + accessible markup (labels, alt, landmarks)",
      "Zero-dependency build (open and run anywhere)",
    ],
    later: ["blog/news section", "photo gallery", "multilingual switch (EN/SW)", "analytics"],
    excluded: BASE_EXCLUDED,
    criteria: [
      { id: "AC1", criterion: "Rendered site contains dist/index.html", evidenceMethod: "file-exists:dist/index.html" },
      { id: "AC2", criterion: "dist/index.html declares a responsive viewport meta tag", evidenceMethod: "file-contains:dist/index.html:viewport" },
      { id: "AC3", criterion: "dist/styles.css exists (styling is not inline-only)", evidenceMethod: "file-exists:dist/styles.css" },
      { id: "AC4", criterion: "Project's own test suite passes", evidenceMethod: "run-project-tests" },
      { id: "AC5", criterion: "No secrets present in rendered output", evidenceMethod: "no-secrets" },
      { id: "AC6", criterion: "All internal links resolve to real files", evidenceMethod: "link-check" },
    ],
  };
}

const SCOPES: Record<string, KindScope> = {
  commerce: {
    mvp: [
      "Product catalog with categories",
      "Search + filter",
      "Product detail view",
      "Cart (client-side, localStorage)",
      "Mock checkout with clear 'no real payment' labeling",
      "Order history (local, per browser)",
    ],
    later: ["real payment provider (requires approval + credentials)", "inventory backend", "admin dashboard"],
    excluded: BASE_EXCLUDED,
    criteria: [
      { id: "AC1", criterion: "Rendered store contains dist/index.html", evidenceMethod: "file-exists:dist/index.html" },
      { id: "AC2", criterion: "Cart logic module exists and is testable", evidenceMethod: "file-exists:dist/cart-logic.js" },
      { id: "AC3", criterion: "Project's own test suite passes (cart, search, checkout)", evidenceMethod: "run-project-tests" },
      { id: "AC4", criterion: "No secrets present in rendered output", evidenceMethod: "no-secrets" },
      { id: "AC5", criterion: "Mock checkout does not reference real payment endpoints", evidenceMethod: "file-contains:dist/checkout.js:mock" },
    ],
  },
  booking: {
    mvp: ["Service list", "Date/time slot picker", "Booking summary with WhatsApp deep-link", "Local persistence", "Owner notes section"],
    later: ["real calendar sync", "SMS reminders (requires approval)"],
    excluded: BASE_EXCLUDED,
    criteria: [
      { id: "AC1", criterion: "Rendered booking app contains dist/index.html", evidenceMethod: "file-exists:dist/index.html" },
      { id: "AC2", criterion: "Slot logic module exists and is testable", evidenceMethod: "file-exists:dist/slots-logic.js" },
      { id: "AC3", criterion: "Project's own test suite passes", evidenceMethod: "run-project-tests" },
      { id: "AC4", criterion: "No secrets present in rendered output", evidenceMethod: "no-secrets" },
    ],
  },
  dashboard: {
    mvp: ["KPI cards from fixture data", "Filterable table", "SVG trend chart", "Role-boundary demo (viewer vs admin)", "Exportable CSV"],
    later: ["real auth backend", "live data source"],
    excluded: BASE_EXCLUDED,
    criteria: [
      { id: "AC1", criterion: "Rendered dashboard contains dist/index.html", evidenceMethod: "file-exists:dist/index.html" },
      { id: "AC2", criterion: "Role boundary logic exists and is testable", evidenceMethod: "file-exists:dist/dashboard-logic.js" },
      { id: "AC3", criterion: "Project's own test suite passes (filters, role boundaries)", evidenceMethod: "run-project-tests" },
      { id: "AC4", criterion: "No secrets present in rendered output", evidenceMethod: "no-secrets" },
    ],
  },
  node: {
    mvp: ["Typed API or app entrypoint with strict TS", "Zod-validated inputs", "Health endpoint", "Structured error responses", "Tests runnable in CI"],
    later: ["database + migrations", "rate limiting hardening", "observability exporter"],
    excluded: BASE_EXCLUDED,
    criteria: [
      { id: "AC1", criterion: "Project structure is complete", evidenceMethod: "structure-check" },
      { id: "AC2", criterion: "Project's own suite passes or skips honestly without installed dependencies", evidenceMethod: "run-project-tests" },
      { id: "AC3", criterion: "No secrets in source", evidenceMethod: "no-secrets" },
    ],
  },
  "agent-mvp": {
    mvp: [
      "CLI agent loop: plan -> edit -> test -> diff -> checkpoint (one command)",
      "Pluggable model adapter (OpenAI-compatible via env credential) with an honestly-labeled deterministic offline planner",
      "Durable checkpoint journal with exactly-once resume of interrupted jobs",
      "GitHub repository adapter gated on GITHUB_TOKEN (clone/status/diff; push requires explicit approval)",
      "Allowlist command sandbox (argument-array execution, no shell interpolation)",
      "Action- and scope-specific approval gate for high-risk steps",
      "Original test suite covering the loop, resume, sandbox and approvals",
    ],
    later: ["hosted multi-user service (separate approved milestone)", "real model quality evals once a provider is authorized", "browser UI"],
    excluded: [...BASE_EXCLUDED, "deploying a public hosted service", "collecting payments", "using any branded model name or proprietary code"],
    criteria: [
      { id: "AC1", criterion: "Agent CLI entrypoint exists and is runnable", evidenceMethod: "file-exists:bin/agent.mjs" },
      { id: "AC2", criterion: "Model adapter is pluggable and labels offline mode honestly", evidenceMethod: "file-exists:src/model-adapter.mjs" },
      { id: "AC3", criterion: "Durable checkpoint journal exists", evidenceMethod: "file-exists:src/checkpoint.mjs" },
      { id: "AC4", criterion: "GitHub adapter is credential-gated", evidenceMethod: "file-exists:src/github-adapter.mjs" },
      { id: "AC5", criterion: "Allowlist sandbox module exists", evidenceMethod: "file-exists:src/sandbox.mjs" },
      { id: "AC6", criterion: "Agent's own test suite passes (loop, resume, approvals)", evidenceMethod: "run-project-tests" },
      { id: "AC7", criterion: "No secrets in generated source", evidenceMethod: "no-secrets" },
      { id: "AC8", criterion: "Project structure is complete", evidenceMethod: "structure-check" },
    ],
  },
  engine: {
    mvp: ["Complete project structure for the target engine", "Core scene/entry files", "README with exact toolchain prerequisites", "Structural validation script"],
    later: ["signed builds", "store publishing (separate approved milestone)"],
    excluded: [...BASE_EXCLUDED, "store release without authorized accounts"],
    criteria: [
      { id: "AC1", criterion: "Engine project structure is complete", evidenceMethod: "structure-check" },
      { id: "AC2", criterion: "No secrets in project files", evidenceMethod: "no-secrets" },
    ],
  },
};

const RE_COMMERCE = /\b(shops?|stores?|dukas?|e-?commerce|commerce|amazons?|marketplaces?|carts?)\b/;
const RE_BOOKING = /\b(book|books|booking|appointments?|reservations?|scheduling)\b/;
const RE_DASHBOARD = /\b(dashboards?|metrics|analytics|kpis?|admin panels?)\b/;

function pickScope(intent: ProjectIntent, family: Family): KindScope {
  // full request participates (same rationale as classifyFamily)
  const req = `${intent.request} ${intent.explicitRequirements.join(" ")}`.toLowerCase();
  const kinds = intent.productKinds;
  // the decisive scenario: a cloud-ready AI coding agent MVP (original,
  // composable runtime — never a copied template or a renamed REST scaffold)
  if (kinds.includes("ai") && intent.domainHints.includes("coding-agent")) return SCOPES["agent-mvp"]!;
  if (family === "static") {
    if (kinds.includes("game-2d")) {
      return {
        mvp: ["Playable game loop", "Keyboard/touch controls", "Score/HUD", "Collision or core rules", "Restart flow", "Pure logic module tested in Node"],
        later: ["sound", "levels", "multiplayer"],
        excluded: BASE_EXCLUDED,
        criteria: [
          { id: "AC1", criterion: "Rendered game contains dist/index.html", evidenceMethod: "file-exists:dist/index.html" },
          { id: "AC2", criterion: "Pure game-logic module exists and is testable", evidenceMethod: "file-exists:dist/game-logic.js" },
          { id: "AC3", criterion: "Project's own logic tests pass", evidenceMethod: "run-project-tests" },
          { id: "AC4", criterion: "No secrets in output", evidenceMethod: "no-secrets" },
        ],
      };
    }
    if (RE_COMMERCE.test(req)) return SCOPES.commerce!;
    if (RE_BOOKING.test(req)) return SCOPES.booking!;
    if (RE_DASHBOARD.test(req)) return SCOPES.dashboard!;
    const domain = intent.explicitRequirements.find((r) => !/(responsive|contact|seo|mobile)/.test(r)) ?? null;
    return staticScope(domain);
  }
  if (family === "engine") return SCOPES.engine!;
  return SCOPES.node!;
}

export function buildCostEstimate(intent: ProjectIntent): Estimate {
  return CostEstimate.parse({
    id: newId("cost"),
    currency: "USD",
    items: [
      { label: "OMNIFORGE runtime (local execution)", amount: 0 },
      { label: "Template + generated source (MIT, original)", amount: 0 },
      { label: "Local verification (no cloud services)", amount: 0 },
    ],
    total: 0,
    assumptions: [
      "FREE_FIRST_MODE=true; APPROVED_SPEND=0",
      "Deployment hosting is out of scope for this estimate until dry-run approval",
      ...(intent.productKinds.includes("mobile") ? ["Cloud mobile builds (EAS) are paid; local builds only"] : []),
    ],
    freeFirstMode: true,
  });
}

export function buildBlueprint(intent: ProjectIntent): Blueprint {
  if (intent.operation !== "create" && intent.operation !== "modify") {
    throw new OmniforgeError("E_NOT_IMPLEMENTED", `blueprint for operation '${intent.operation}' arrives in a later capability pack`);
  }
  const family = classifyFamily(intent);
  const scope = pickScope(intent, family.family);
  const blueprint = ProductBlueprint.parse({
    intentId: intent.id,
    contractVersion: "1.0.0",
    productBrief: `${intent.operation === "modify" ? "Regression-safe change to" : "Original"} ${
      intent.productKinds.join("/")
    } product. Request: "${intent.request.slice(0, 160)}". Built free-first with ${family.stack[0]}.`,
    scope: { mvp: scope.mvp, later: scope.later, excluded: scope.excluded },
    rolesAndFlows: [{ role: "visitor", flow: "open site -> browse -> contact/convert" }],
    architecture: {
      family: family.family,
      stack: family.stack,
      hosting: family.hosting,
      isolation: "workspace under projects/ (git-ignored), independent export",
    },
    dataModel:
      family.family === "static"
        ? { type: "client-side", store: "localStorage only", pii: "none collected" }
        : { type: "in-memory or local", migrations: "when persistence lands" },
    contracts: family.family === "node" ? [{ kind: "http", validation: "zod" }] : [],
    threatModel: {
      findings: [
        {
          id: "TM1",
          severity: "low",
          title: "Static content only" ,
          detail: "No server, no secrets, no PII collection in MVP",
          remediation: "keep it that way until a backend is approved",
        },
      ],
    },
    acceptanceCriteria: scope.criteria,
    deploymentRequirements: {
      family: family.family,
      approved: false,
      note: "generation never publishes; deployment requires explicit approval and dry-run",
    },
    costEstimateId: undefined,
  });
  void buildCostEstimate(intent); // estimates are produced alongside runs
  return blueprint;
}

export function nowIsoBlueprintStamp(): string {
  return nowIso();
}

// Universal work blueprints + composable primitives (v1.2)
export { buildWorkBlueprint, workStamp } from "./work.js";
export {
  PRIMITIVES,
  PRIMITIVE_IDS,
  getPrimitive,
  composePrimitives,
  suggestAdditions,
  type Primitive,
  type CompositionResult,
} from "./primitives.js";
