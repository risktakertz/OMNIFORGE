/**
 * OMNIFORGE skill router — hybrid deterministic routing:
 *   1. policy eligibility (free-first, availability)
 *   2. dependency/conflict resolution
 *   3. explainable ranking (token overlap over trusted registry metadata)
 *   4. risk/cost check
 *   5. final SkillSelection with structured evidence and fallback
 * No embeddings, no model calls: every decision is reproducible in tests.
 */
import { OmniforgeError, SkillSelection, type ProjectIntent, type SkillSelection as Selection, type Capability } from "@omniforge/shared-types";
import { wordOverlap } from "@omniforge/utils";
import type { CapabilityRegistry } from "@omniforge/capability-registry";
import { exceedsDeterministicScope } from "@omniforge/intent-engine";

export interface RouteOptions {
  /** Allow 'paid' cost capabilities (requires approval records). Default false. */
  allowPaid?: boolean;
}

type TemplateRule = {
  template: string;
  when: (intent: ProjectIntent) => boolean;
  why: string;
};

const TAG = (intent: ProjectIntent, re: RegExp): boolean => {
  const hay = `${intent.request} ${intent.explicitRequirements.join(" ")}`.toLowerCase();
  return re.test(hay);
};

const RE_COMMERCE = /\b(shops?|stores?|dukas?|e-?commerce|commerce|amazons?|marketplaces?|carts?)\b/;
const RE_BOOKING = /\b(book|books|booking|appointments?|reservations?|scheduling)\b/;
const RE_DASHBOARD = /\b(dashboards?|metrics|analytics|kpis?|admin panels?)\b/;

const TEMPLATE_RULES: TemplateRule[] = [
  { template: "generator:agent-mvp", when: (i) => i.productKinds.includes("ai") && i.domainHints.includes("coding-agent"), why: "cloud coding agent maps to the original agent-MVP generator (composable runtime, never a copied or renamed template)" },
  { template: "template:phaser-2d", when: (i) => i.productKinds.includes("game-2d"), why: "browser 2D game maps to the Phaser template" },
  { template: "template:godot-native", when: (i) => i.productKinds.includes("game-3d"), why: "engine-native 3D maps to the Godot template" },
  { template: "template:expo-mobile", when: (i) => i.productKinds.includes("mobile"), why: "mobile kind maps to the Expo template" },
  { template: "template:tauri-desktop", when: (i) => i.productKinds.includes("desktop"), why: "desktop kind maps to the Tauri template" },
  { template: "template:api", when: (i) => i.productKinds.includes("api") || i.productKinds.includes("automation") || i.productKinds.includes("ai"), why: "backend/automation/ai kinds map to the typed API template" },
  { template: "template:next-web", when: (i) => i.productKinds.includes("saas") || (i.productKinds.includes("web-app") && !TAG(i, RE_COMMERCE) && !TAG(i, RE_BOOKING) && !TAG(i, RE_DASHBOARD)), why: "interactive web app/SaaS maps to the Next.js template" },
  { template: "template:commerce-lite", when: (i) => TAG(i, RE_COMMERCE), why: "commerce intent maps to the storefront template" },
  { template: "template:booking-lite", when: (i) => TAG(i, RE_BOOKING), why: "booking intent maps to the booking template" },
  { template: "template:dashboard-lite", when: (i) => TAG(i, RE_DASHBOARD), why: "dashboard intent maps to the dashboard template" },
  { template: "template:static-business", when: (i) => i.productKinds.includes("website"), why: "business/content site maps to the static business template" },
];

const KIND_PACKS: Record<string, string[]> = {
  website: ["ui-design", "web-apps", "testing", "documentation"],
  "web-app": ["web-apps", "ui-design", "testing", "documentation"],
  saas: ["web-apps", "security", "testing", "architecture"],
  api: ["backend-and-data", "security", "testing"],
  mobile: ["mobile-apps", "testing"],
  desktop: ["desktop-apps", "testing"],
  "game-2d": ["2d-games", "testing", "performance"],
  "game-3d": ["3d-games", "testing"],
  ai: ["ai-products", "testing", "security"],
  automation: ["business-automation", "security", "testing"],
};

function packsFor(intent: ProjectIntent): string[] {
  const ids = new Set<string>(["omniforge", "architecture"]);
  for (const k of intent.productKinds) for (const p of KIND_PACKS[k] ?? []) ids.add(p);
  if (TAG(intent, RE_COMMERCE)) ids.add("ecommerce");
  if (TAG(intent, RE_BOOKING)) ids.add("web-apps");
  if (intent.operation === "debug") ids.add("debugging");
  if (intent.operation === "analyze") ids.add("research");
  if (TAG(intent, /(reverse|recreate|rebuild).*(app|apk|software)/)) ids.add("reverse-engineering");
  if (TAG(intent, /(deploy|publish)/)) ids.add("release");
  return [...ids];
}

export interface RouteResult {
  selection: Selection;
  templateId: string;
  missing: string[];
}

/**
 * Deterministic scope keywords the built-in templates/generators genuinely
 * cover. Requirements mentioning data entities + access control beyond these
 * exceed deterministic scope and must NOT be silently routed to an unrelated
 * template (§4.7) — they get a typed model-required blocker instead.
 */
const DETERMINISTIC_SCOPE_KEYWORDS = [
  "commerce", "shop", "store", "cart", "booking", "appointment", "dashboard",
  "metrics", "analytics", "game", "agent", "salon", "bakery", "restaurant",
  "hotel", "portfolio", "landing", "blog", "reminder", "api", "endpoint",
  "website", "mobile", "desktop", "3d", "phaser", "godot", "expo", "tauri",
];

export function routeIntent(
  intent: ProjectIntent,
  registry: CapabilityRegistry,
  opts: RouteOptions = {}
): RouteResult {
  registry.ensure();
  const excluded: Array<{ capabilityId: string; reason: string }> = [];
  const missing: string[] = [];

  if (intent.novelty === "novel") {
    // a novel request is a typed gap (NEEDS_MODEL), never a silent template map
    throw new OmniforgeError("E_INTENT_NOVEL", "novel request matches no known capability — model-assisted interpretation required", {
      kinds: intent.productKinds,
      hints: intent.domainHints,
    });
  }

  // §4.7: never silently route a new product to an unrelated template. When
  // requirements name data entities + access control beyond every built-in
  // scope, the honest answer is a typed model-required blocker.
  if (intent.operation === "create" || intent.operation === "modify") {
    if (exceedsDeterministicScope([...intent.explicitRequirements, intent.request], DETERMINISTIC_SCOPE_KEYWORDS)) {
      throw new OmniforgeError(
        "E_SCOPE_EXCEEDS_DETERMINISTIC",
        "requirements (data entities + access control) exceed every deterministic template scope — novel code generation via an authorized model backend is required",
        {
          kinds: intent.productKinds,
          prerequisite: "configure an authorized model-backed coding backend (docs/MODEL_ROUTING.md), then re-run",
        }
      );
    }
  }

  /* 1. template resolution (deterministic rules, first match wins) */
  const rule = TEMPLATE_RULES.find((r) => r.when(intent));
  if (!rule) {
    throw new OmniforgeError("E_CAPABILITY_MISSING", "no template rule matches this intent", {
      kinds: intent.productKinds,
    });
  }
  const templateId = rule.template;
  let template: Capability | null = null;
  if (registry.has(templateId)) {
    template = registry.get(templateId);
    if (template.availability === "blocked" || template.availability === "unavailable") {
      excluded.push({ capabilityId: templateId, reason: `template present but ${template.availability}` });
      missing.push(templateId);
    }
  } else {
    missing.push(templateId);
  }

  /* 2. skill pack resolution: mapped packs first, then rank all others for evidence */
  const wanted = packsFor(intent);
  const allSkills = registry.list().filter((c) => c.kind === "skill");
  const selected: Selection["selected"] = [];
  // §4.4 operation-compatibility pass FIRST: capabilities that declare the
  // requested operation are eligible; those without it are excluded with an
  // explicit reason (never selected merely because a word appears in the prompt)
  const operationEligible = new Set(registry.findByOperation(intent.operation).map((c) => c.id));
  for (const id of wanted) {
    const capId = id === "omniforge" ? "skill:omniforge" : `skill:${id}`;
    if (!registry.has(capId)) {
      missing.push(capId);
      continue;
    }
    const cap = registry.get(capId);
    if (cap.availability === "blocked") {
      excluded.push({ capabilityId: capId, reason: "skill failed validation" });
      continue;
    }
    if (!operationEligible.has(capId)) {
      excluded.push({ capabilityId: capId, reason: `does not declare operation '${intent.operation}' (machine-readable operations metadata)` });
      continue;
    }
    selected.push({ capabilityId: capId, role: roleFor(id), reason: `mapped by policy for kinds=${intent.productKinds.join("+")} (operation '${intent.operation}' declared)` });
  }
  for (const s of allSkills) {
    const capId = s.id;
    if (selected.some((x) => x.capabilityId === capId)) continue;
    const score = wordOverlap(intent.request, `${s.capabilities.join(" ")} ${s.requirements.join(" ")}`);
    excluded.push({
      capabilityId: capId,
      reason: !operationEligible.has(capId)
        ? `does not declare operation '${intent.operation}'`
        : score > 0
          ? `lower semantic rank (overlap=${score.toFixed(2)})`
          : "not mapped for this intent",
    });
  }

  /* 3. risk/cost policy (free-first) */
  const approvalsRequired: string[] = [];
  const paid = [...selected].filter((s) => {
    const cap = registry.get(s.capabilityId);
    return cap.cost === "paid" || (cap.cost === "conditional" && opts.allowPaid !== true);
  });
  for (const p of paid) approvalsRequired.push(p.capabilityId);

  const selection = SkillSelection.parse({
    intentId: intent.id,
    selected,
    excluded,
    fallback: null,
    estimatedCost: "0 USD (free-first)",
    approvalsRequired,
    evidence: [
      `template rule: ${templateId} — ${rule.why}`,
      `packs mapped from kinds=${intent.productKinds.join("+")} operation=${intent.operation}`,
      `operation-eligible capabilities (machine-readable metadata): ${[...operationEligible].length}`,
      `registry size: ${registry.list().length} capabilities`,
      ...(missing.length > 0 ? [`MISSING (typed gap, not simulated): ${missing.join(", ")}`] : []),
    ],
  });

  if (template) selected.unshift({ capabilityId: template.id, role: "product-template", reason: rule.why });

  return { selection, templateId, missing };
}

function roleFor(packId: string): string {
  const roles: Record<string, string> = {
    omniforge: "coordinator",
    architecture: "architecture-lead",
    "ui-design": "ux-designer",
    "web-apps": "frontend-engineer",
    "backend-and-data": "backend-engineer",
    "mobile-apps": "mobile-engineer",
    "desktop-apps": "desktop-engineer",
    "2d-games": "game-engineer",
    "3d-games": "game-engineer",
    "ai-products": "ai-integration",
    "business-automation": "automation-engineer",
    ecommerce: "commerce-engineer",
    testing: "qa-engineer",
    security: "security-reviewer",
    debugging: "diagnostics",
    performance: "performance-engineer",
    release: "release-engineer",
    documentation: "docs-engineer",
    research: "technical-researcher",
    "reverse-engineering": "rea-analyst",
  };
  return roles[packId] ?? "contributor";
}

/**
 * Explainable routing eval: returns the exact template + pack list the router
 * would pick, used by tests/routing-evals to prove prompt changes change
 * selection deterministically.
 */
export function evaluateRouting(intent: ProjectIntent, registry: CapabilityRegistry): { templateId: string; packs: string[]; missing: string[] } {
  const { templateId, missing } = routeIntent(intent, registry);
  return { templateId, packs: packsFor(intent), missing };
}
