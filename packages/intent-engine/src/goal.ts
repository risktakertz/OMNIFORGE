/**
 * Universal goal interpretation (universal-upgrade §4.1/§4.2/§4.8/§4.9).
 *
 *  - `buildGoalSpec`: deterministic ProjectIntent → GoalSpec mapping (the
 *    safe first pass — every field is traceable to the parsed intent).
 *  - `mergeModelGoalSpec`: schema-validated merge of model-assisted
 *    extraction. Security/permission policy fields from model output are
 *    DISCARDED — they can only come from the deterministic baseline or an
 *    explicit trusted caller (§4.2: model text never overrides policy).
 *  - `decomposeComposite`: splits composite requests (e.g. SaaS dashboard +
 *    payments + mobile companion) into per-deliverable sub-goals instead of
 *    collapsing to the first matching category (§4.8).
 *  - `scanExternalInstructions`: adversarial prompt-injection scan for
 *    third-party SKILL.md content, repo READMEs and retrieved webpages
 *    (§4.9) — external text is untrusted data, never instructions.
 */
import {
  GoalSpec,
  ProjectIntent as IntentSchema,
  ProductKind,
  OmniforgeError,
  type GoalSpec as Goal,
  type ProjectIntent,
} from "@omniforge/shared-types";
import { newId } from "@omniforge/utils";

/** Map the deterministic intent to the universal GoalSpec contract. */
export function buildGoalSpec(intent: ProjectIntent): Goal {
  return GoalSpec.parse({
    goalId: newId("goal"),
    sourceIntentId: intent.id,
    objective: intent.request,
    operation: intent.operation,
    targetProduct: intent.productKinds.join("+"),
    platforms: intent.platforms,
    targetEnvironment: intent.platforms.some((p) => p !== "web") ? "multi-platform" : "web",
    functionalRequirements: intent.explicitRequirements,
    nonFunctionalRequirements: intent.inferredAssumptions.map((a) => a.text),
    assumptions: intent.inferredAssumptions,
    constraints: intent.constraints,
    requestedDeliverables: deliverablesFor(intent),
    unresolvedQuestions: intent.unknowns,
    interpreter: "deterministic",
    confidence: intent.inferredAssumptions.length > 0
      ? Math.min(0.9, 0.4 + 0.1 * intent.inferredAssumptions.length)
      : 0.5,
  });
}

function deliverablesFor(intent: ProjectIntent): Goal["requestedDeliverables"] {
  switch (intent.operation) {
    case "analyze":
      return ["analysis-report"];
    case "test":
      return ["test-harness"];
    case "debug":
      return ["analysis-report", "source-project"];
    case "deploy":
      return ["source-project"];
    default:
      return ["source-project"];
  }
}

/** Fields model output is allowed to fill (everything EXCEPT policy fields). */
const MODEL_FILLABLE: Array<keyof Goal> = [
  "objective",
  "targetProduct",
  "platforms",
  "targetEnvironment",
  "functionalRequirements",
  "nonFunctionalRequirements",
  "assumptions",
  "risks",
  "requestedDeliverables",
  "acceptanceCriteria",
  "unresolvedQuestions",
];

/**
 * Merge model-assisted structured extraction into a deterministic GoalSpec.
 * The model provides understanding; it can NEVER supply constraints,
 * permissions, budget or licensing policy (§4.2). Returns a NEW validated
 * spec; throws on schema-invalid model output (never silently patched).
 */
export function mergeModelGoalSpec(base: Goal, modelOutput: unknown): Goal {
  if (typeof modelOutput !== "object" || modelOutput === null) {
    throw new OmniforgeError("E_INTENT_UNCLEAR", "model interpretation must be a structured object", {});
  }
  const raw = modelOutput as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...base };
  for (const key of MODEL_FILLABLE) {
    if (raw[key] !== undefined) merged[key] = raw[key];
  }
  // policy fields stay exactly as the deterministic side produced them
  merged.constraints = base.constraints;
  merged.privacy = base.privacy;
  merged.licensing = base.licensing;
  merged.budget = base.budget;
  merged.interpreter = "hybrid";
  merged.confidence = typeof raw["confidence"] === "number" ? Math.min(0.95, raw["confidence"] as number) : base.confidence;
  // specVersion/goalId identity are preserved from the base
  merged.specVersion = "1.0";
  merged.goalId = base.goalId;
  merged.sourceIntentId = base.sourceIntentId;
  return GoalSpec.parse(merged);
}

/** Validated compatibility view. Identity and permission authority remain original. */
export function resolveGoalIntent(goal: Goal, original: ProjectIntent): ProjectIntent {
  const validated = GoalSpec.parse(goal);
  if (validated.sourceIntentId !== original.id || validated.operation !== original.operation) {
    throw new OmniforgeError("E_INTENT_UNCLEAR", "goal identity/operation does not match intake");
  }
  const kinds = validated.targetProduct.split("+").map((k) => ProductKind.safeParse(k.trim()));
  const supported = kinds.length > 0 && kinds.every((k) => k.success);
  return IntentSchema.parse({
    ...original,
    productKinds: supported ? kinds.map((k) => k.data) : ["other"],
    platforms: validated.platforms,
    explicitRequirements: [...new Set([...original.explicitRequirements, ...validated.functionalRequirements])],
    inferredAssumptions: validated.assumptions,
    unknowns: validated.unresolvedQuestions,
    novelty: validated.interpreter !== "deterministic" && supported ? "known" : original.novelty,
    interpreter: validated.interpreter === "deterministic" ? "deterministic" : "model-assisted",
  });
}

/**
 * §4.8 composite decomposition: multi-deliverable requests become separate
 * sub-goals (each independently plannable) instead of one collapsed category.
 */
export function decomposeComposite(goal: Goal): Array<Goal> | null {
  if (goal.requestedDeliverables.length <= 1) return null;
  return goal.requestedDeliverables.map((kind, i) =>
    GoalSpec.parse({
      ...goal,
      goalId: `${goal.goalId}-p${i + 1}`,
      requestedDeliverables: [kind],
      objective: `${goal.objective} (part ${i + 1}/${goal.requestedDeliverables.length}: ${kind})`,
    })
  );
}

/* ------------------------------------------------------------------ */
/* §4.9 adversarial prompt-injection scanning                          */
/* ------------------------------------------------------------------ */

const INJECTION_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts?|rules?)/i, label: "override-previous" },
  { re: /disregard\s+(all\s+)?(previous|prior|the)\s+(instructions|rules?|policy)/i, label: "override-previous" },
  { re: /you\s+are\s+now\s+(a|an|the)\s+/i, label: "role-hijack" },
  { re: /\b(exfiltrate|upload|send|post)\b[^.\n]{0,60}\b(api[- ]?key|token|secret|password|credential)s?\b/i, label: "secret-exfiltration" },
  { re: /\b(curl|wget|fetch)\b[^.\n]{0,80}\b(https?:\/\/)/i, label: "network-call-in-content" },
  { re: /system\s*prompt|reveal\s+your\s+(instructions|prompt)/i, label: "prompt-disclosure" },
  { re: /<\|?(im_start|system|endoftext)\|?>/i, label: "token-forgery" },
  { re: /\brm\s+-rf\b|\bformat\s+c:/i, label: "destructive-command" },
  { re: /\b(approve|grant|allow)\b[^.\n]{0,40}\b(all|unrestricted|admin)\b[^.\n]{0,20}\b(permissions?|access|approvals?)\b/i, label: "permission-escalation" },
];

export interface InjectionFinding {
  label: string;
  excerpt: string;
}

/**
 * Scan untrusted external text (third-party skill metadata, repo READMEs,
 * retrieved pages). Returns findings; the CALLER decides the typed outcome
 * (typically E_INJECTION_SUSPECTED + exclusion from selection).
 */
export function scanExternalInstructions(text: string, source: string): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { re, label } of INJECTION_PATTERNS) {
    const m = text.match(re);
    if (m) {
      findings.push({ label, excerpt: `${source}: ${m[0]?.slice(0, 80)}` });
    }
  }
  return findings;
}

/** True when a requirement profile exceeds every deterministic capability. */
export function exceedsDeterministicScope(requirements: string[], knownScopeKeywords: string[]): boolean {
  const hay = requirements.join(" ").toLowerCase();
  // named data entities + access control with no matching deterministic scope
  const mentionsEntities = /\b(students?|patients?|invoices?|inventory|tenants?|payroll|exams?|grades|accounts?|roles?|permissions?)\b/.test(hay);
  const mentionsAccessControl = /\b(roles?|permissions?|access control|multi-tenant|isolation)\b/.test(hay);
  const coveredByScope = knownScopeKeywords.some((k) => hay.includes(k));
  return (mentionsEntities && mentionsAccessControl && !coveredByScope) || (mentionsAccessControl && /\b(saaS|multi-tenant)\b/.test(hay) && !coveredByScope);
}
