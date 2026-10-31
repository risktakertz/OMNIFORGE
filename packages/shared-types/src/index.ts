/**
 * OMNIFORGE shared domain contracts — versioned, validated with Zod.
 * Contract version: 1.0.0. Breaking changes require a migration note in
 * docs/decisions/ and a CONTRACT_VERSION bump.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "1.0.0";

/* ------------------------------------------------------------------ */
/* Enumerations                                                        */
/* ------------------------------------------------------------------ */

export const OperationKind = z.enum([
  "create",
  "modify",
  "debug",
  "analyze",
  "test",
  "deploy",
]);
export type OperationKind = z.infer<typeof OperationKind>;

export const ProductKind = z.enum([
  "website",
  "web-app",
  "mobile",
  "desktop",
  "api",
  "saas",
  "game-2d",
  "game-3d",
  "ai",
  "automation",
  // v1.1: recognized-but-unmapped product domains. A "novel" intent must
  // never silently become a website/api scaffold — see intent-engine.
  "other",
]);
export type ProductKind = z.infer<typeof ProductKind>;

export const CapabilityKind = z.enum([
  "skill",
  "tool",
  "engine",
  "template",
  "agent-backend",
  "model",
  "deployment",
]);
export type CapabilityKind = z.infer<typeof CapabilityKind>;

export const Availability = z.enum([
  "verified",
  "configured",
  "unavailable",
  "blocked",
  "untested",
]);
export type Availability = z.infer<typeof Availability>;

export const RiskLevel = z.enum(["low", "medium", "high"]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const CostTier = z.enum(["free", "conditional", "paid", "unknown"]);
export type CostTier = z.infer<typeof CostTier>;

export const Impact = z.enum(["low", "material", "blocking"]);
export type Impact = z.infer<typeof Impact>;

export const TaskStatus = z.enum([
  "pending",
  "running",
  "waiting",
  "passed",
  "failed",
  "blocked",
  "skipped",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const RunStatus = z.enum([
  "planned",
  "running",
  "waiting-approval",
  "passed",
  "failed",
  "blocked",
  "interrupted",
]);
export type RunStatus = z.infer<typeof RunStatus>;

/* ------------------------------------------------------------------ */
/* Core contracts (section 5 of the master directive)                  */
/* ------------------------------------------------------------------ */

export const Assumption = z.object({
  text: z.string().min(1),
  confidence: z.number().min(0).max(1),
});
export type Assumption = z.infer<typeof Assumption>;

export const Unknown = z.object({
  question: z.string().min(1),
  impact: Impact,
});
export type Unknown = z.infer<typeof Unknown>;

export const ProjectIntent = z.object({
  id: z.string().min(3),
  request: z.string().min(1),
  locale: z.string().min(2).default("en"),
  operation: OperationKind,
  productKinds: z.array(ProductKind).min(1),
  platforms: z.array(z.string()).default([]),
  explicitRequirements: z.array(z.string()).default([]),
  inferredAssumptions: z.array(Assumption).default([]),
  constraints: z.array(z.string()).default([]),
  unknowns: z.array(Unknown).default([]),
  permissions: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
  // v1.1: novelty + interpreter provenance. novel=true means no deterministic
  // rule confidently matched the domain; interpretation requires a model
  // (NEEDS_MODEL) instead of silently falling back to a known template.
  novelty: z.enum(["known", "novel"]).default("known"),
  interpreter: z.enum(["deterministic", "model-assisted"]).default("deterministic"),
  domainHints: z.array(z.string()).default([]),
});
export type ProjectIntent = z.infer<typeof ProjectIntent>;

export const Capability = z.object({
  id: z.string().min(3),
  kind: CapabilityKind,
  source: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
  /** machine-readable supported operations (§4.3): create/modify/debug/analyze/test/deploy */
  operations: z.array(z.string()).default([]),
  inputSchemaRef: z.string().default("none"),
  outputSchemaRef: z.string().default("none"),
  requirements: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  availability: Availability,
  risk: RiskLevel,
  cost: CostTier,
  healthCheck: z.string().default("none"),
});
export type Capability = z.infer<typeof Capability>;

export const AcceptanceCriterion = z.object({
  id: z.string(),
  criterion: z.string().min(5),
  evidenceMethod: z.string().min(3),
});
export type AcceptanceCriterion = z.infer<typeof AcceptanceCriterion>;

export const ProductBlueprint = z.object({
  intentId: z.string(),
  contractVersion: z.string().default(CONTRACT_VERSION),
  productBrief: z.string().min(10),
  scope: z.object({
    mvp: z.array(z.string()),
    later: z.array(z.string()),
    excluded: z.array(z.string()),
  }),
  rolesAndFlows: z.array(z.unknown()),
  architecture: z.unknown(),
  dataModel: z.unknown(),
  contracts: z.array(z.unknown()),
  threatModel: z.unknown(),
  acceptanceCriteria: z.array(AcceptanceCriterion).min(1),
  deploymentRequirements: z.unknown(),
  costEstimateId: z.string().optional(),
});
export type ProductBlueprint = z.infer<typeof ProductBlueprint>;

export const TaskNode = z.object({
  id: z.string().min(1),
  operation: z.string().min(1),
  dependencies: z.array(z.string()).default([]),
  capabilityIds: z.array(z.string()).default([]),
  inputs: z.unknown(),
  expectedArtifacts: z.array(z.string()).default([]),
  timeoutMs: z.number().int().positive(),
  retryBudget: z.number().int().min(0),
  idempotencyKey: z.string().min(1),
  approvalRequired: z.boolean().default(false),
  status: TaskStatus.default("pending"),
});
export type TaskNode = z.infer<typeof TaskNode>;

export const Evidence = z.object({
  taskId: z.string(),
  commandOrTool: z.string(),
  environment: z.string(),
  timestamp: z.string().datetime(),
  exitStatus: z.string(),
  artifactPaths: z.array(z.string()).default([]),
  summary: z.string(),
  redactedLogRef: z.string().optional(),
});
export type Evidence = z.infer<typeof Evidence>;

/* ------------------------------------------------------------------ */
/* Execution, selection, approvals, cost                               */
/* ------------------------------------------------------------------ */

export const SkillSelection = z.object({
  intentId: z.string(),
  selected: z.array(
    z.object({
      capabilityId: z.string(),
      role: z.string(),
      reason: z.string(),
    })
  ),
  excluded: z.array(
    z.object({ capabilityId: z.string(), reason: z.string() })
  ),
  fallback: z.string().nullable().default(null),
  estimatedCost: z.string(),
  approvalsRequired: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type SkillSelection = z.infer<typeof SkillSelection>;

export const ApprovalRequest = z.object({
  id: z.string(),
  action: z.string(),
  reason: z.string(),
  risk: RiskLevel,
  cost: CostTier.default("unknown"),
  createdAt: z.string().datetime(),
  status: z.enum(["pending", "approved", "denied", "expired"]).default("pending"),
  decidedBy: z.string().optional(),
  decidedAt: z.string().datetime().optional(),
  // v1.1: approvals are action-, scope- and run-specific. An apr_* token
  // never grants blanket permission beyond its recorded scope.
  runId: z.string().optional(),
  scope: z
    .object({
      actions: z.array(z.string()).default([]),
      targets: z.array(z.string()).default([]),
    })
    .optional(),
});
export type ApprovalRequest = z.infer<typeof ApprovalRequest>;

export const CostEstimate = z.object({
  id: z.string(),
  currency: z.literal("USD"),
  items: z.array(z.object({ label: z.string(), amount: z.number() })),
  total: z.number(),
  assumptions: z.array(z.string()).default([]),
  freeFirstMode: z.boolean().default(true),
});
export type CostEstimate = z.infer<typeof CostEstimate>;

export const ToolInvocation = z.object({
  id: z.string(),
  tool: z.string(),
  actionClass: z.string(),
  policyDecision: z.enum(["allow", "deny", "approval-required"]),
  timestamp: z.string().datetime(),
  durationMs: z.number().optional(),
  exit: z.string().optional(),
});
export type ToolInvocation = z.infer<typeof ToolInvocation>;

export const WorkspaceLease = z.object({
  workspacePath: z.string(),
  holder: z.string(),
  acquiredAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type WorkspaceLease = z.infer<typeof WorkspaceLease>;

export const CheckResult = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["passed", "failed", "skipped", "blocked", "not-run"]),
  message: z.string().default(""),
  evidencePaths: z.array(z.string()).default([]),
  // v1.1: critical checks (acceptance criteria) must actually run — a
  // skipped/blocked/not-run critical check can never produce a PASS.
  // advisory checks record extra evidence and never gate readiness.
  severity: z.enum(["critical", "advisory"]).default("critical"),
});
export type CheckResult = z.infer<typeof CheckResult>;

export const ValidationResult = z.object({
  target: z.string(),
  checks: z.array(CheckResult),
  passed: z.boolean(),
  failures: z.array(z.string()).default([]),
});
export type ValidationResult = z.infer<typeof ValidationResult>;

export const ReleaseArtifact = z.object({
  id: z.string(),
  path: z.string(),
  checksum: z.string(),
  provenanceRef: z.string(),
  createdAt: z.string().datetime(),
});
export type ReleaseArtifact = z.infer<typeof ReleaseArtifact>;

export const ThreatFinding = z.object({
  id: z.string(),
  severity: z.enum(["info", "low", "medium", "high", "critical"]),
  title: z.string(),
  detail: z.string(),
  remediation: z.string(),
});
export type ThreatFinding = z.infer<typeof ThreatFinding>;

export const SourceProvenance = z.object({
  name: z.string(),
  url: z.string().url(),
  version: z.string(),
  license: z.string(),
  licenseStatus: z.enum(["reviewed", "review-required", "incompatible"]),
  integrationMode: z.string(),
  recordedAt: z.string().datetime(),
});
export type SourceProvenance = z.infer<typeof SourceProvenance>;

export const ModelCapability = z.object({
  provider: z.string(),
  model: z.string(),
  availability: Availability,
  structuredOutput: z.boolean().default(false),
  toolCalling: z.boolean().default(false),
  codingScore: z.number().optional(),
  contextWindow: z.number().optional(),
  notes: z.string().default(""),
});
export type ModelCapability = z.infer<typeof ModelCapability>;

export const ExecutionRun = z.object({
  id: z.string(),
  threadId: z.string(),
  intentId: z.string(),
  status: RunStatus,
  startedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  nodeStates: z.record(z.string(), TaskStatus),
  evidenceRefs: z.array(z.string()).default([]),
  workspacePath: z.string().optional(),
  costEstimateId: z.string().optional(),
});
export type ExecutionRun = z.infer<typeof ExecutionRun>;

/* ------------------------------------------------------------------ */
/* Structured failure codes                                            */
/* ------------------------------------------------------------------ */

export const FailureCodes = [
  "E_INTENT_UNCLEAR",
  "E_INTENT_BLOCKING_UNKNOWN",
  "E_INTENT_NOVEL", // v1.1: novel request needs model-assisted interpretation (NEEDS_MODEL)
  "E_MODEL_UNAVAILABLE", // v1.1: no authorized model/backend for a model-required step
  "E_SANDBOX_UNAVAILABLE", // v1.1: untrusted code execution requested without an enforced sandbox
  "E_REPAIR_NONIMPROVING", // v1.1: repair attempts are not improving — stop instead of looping
  "E_CAPABILITY_MISSING",
  "E_CAPABILITY_UNAVAILABLE",
  "E_GATEWAY_DENIED",
  "E_GATEWAY_PATH_ESCAPE",
  "E_APPROVAL_REQUIRED",
  "E_BUDGET_EXCEEDED",
  "E_PLAN_CYCLE",
  "E_RUN_INTERRUPTED",
  "E_VERIFY_FAILED",
  "E_REPAIR_BUDGET_EXCEEDED",
  "E_EXPORT_FAILED",
  "E_DEPLOY_BLOCKED",
  "E_LICENSE_INCOMPATIBLE",
  "E_INJECTION_SUSPECTED",
  "E_NOT_IMPLEMENTED",
  "E_WORKSPACE_LOCKED",
  "E_BACKEND_UNAVAILABLE",
  // v1.2 (universal capability upgrade):
  "E_HANDOFF_MISSING", // typed DAG handoff: upstream artifact absent
  "E_NEEDS_MODEL", // model-assisted interpretation/generation required, none ready
  "E_BACKEND_BLOCKED", // coding backend cannot accept this task (typed, with prerequisite)
  "E_AUTHORIZATION_REQUIRED", // REA/inspection without a documented rights basis
  "E_SCOPE_EXCEEDS_DETERMINISTIC", // requirements exceed template scope — model-backed path required
  "E_DELIVERABLE_UNSUPPORTED", // requested deliverable kind has no available capability
] as const;
export type FailureCode = (typeof FailureCodes)[number];

export class OmniforgeError extends Error {
  readonly code: FailureCode;
  readonly details: Record<string, unknown>;
  constructor(code: FailureCode, message: string, details: Record<string, unknown> = {}) {
    super(`${code}: ${message}`);
    this.name = "OmniforgeError";
    this.code = code;
    this.details = details;
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function isOmniforgeError(e: unknown): e is OmniforgeError {
  return e instanceof OmniforgeError;
}

/* ------------------------------------------------------------------ */
/* Run lifecycle events                                                */
/* ------------------------------------------------------------------ */

export const RunEvent = z.object({
  id: z.string(),
  runId: z.string(),
  threadId: z.string(),
  node: z.string(),
  level: z.enum(["debug", "info", "warn", "error"]),
  message: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.string().datetime(),
});
export type RunEvent = z.infer<typeof RunEvent>;

export const GRAPH_NODES = [
  "intake",
  "permission-check",
  "interpret",
  "research",
  "specify",
  "select",
  "plan",
  "prepare-workspace",
  "execute",
  "verify",
  "repair",
  "approve",
  "package",
  "deliver",
  "report",
] as const;
export type GraphNode = (typeof GRAPH_NODES)[number];

/* ------------------------------------------------------------------ */
/* v1.2 — universal capability contracts                               */
/* ------------------------------------------------------------------ */

/** Deliverable kinds OMNIFORGE can produce (not every product is a webpage). */
export const DeliverableKind = z.enum([
  "source-project",
  "website",
  "api-service",
  "mobile-app",
  "desktop-app",
  "game-project",
  "ai-agent",
  "automation-workflow",
  "analysis-report",
  "behavior-spec",
  "test-harness",
  "migration-plan",
  "comparison-study",
]);
export type DeliverableKind = z.infer<typeof DeliverableKind>;

/**
 * GoalSpec — the extensible, universal form of a user goal (§4.1).
 * Compatible superset of ProjectIntent: everything deterministic parsing can
 * fill today, plus the fields a model-assisted interpreter may supply.
 * Security/permission policy fields (constraints, permissions) are NEVER
 * overridable by model output — they are merged only from trusted callers.
 */
export const GoalSpec = z.object({
  specVersion: z.literal("1.0").default("1.0"),
  goalId: z.string().min(3),
  sourceIntentId: z.string().optional(),
  objective: z.string().min(1),
  operation: OperationKind,
  targetProduct: z.string().default("unspecified"),
  platforms: z.array(z.string()).default([]),
  targetEnvironment: z.string().default("local"),
  suppliedAssets: z.array(z.object({ kind: z.string(), ref: z.string() })).default([]),
  repositories: z.array(z.string()).default([]),
  functionalRequirements: z.array(z.string()).default([]),
  nonFunctionalRequirements: z.array(z.string()).default([]),
  assumptions: z.array(Assumption).default([]),
  constraints: z.array(z.string()).default([]),
  privacy: z.string().default("no PII collection without explicit user statement"),
  licensing: z.string().default("user retains rights to supplied content; output is original"),
  risks: z.array(z.string()).default([]),
  budget: z.object({ currency: z.string().default("USD"), max: z.number().min(0).default(0) }).default({}),
  requestedDeliverables: z.array(DeliverableKind).min(1).default(["source-project"]),
  acceptanceCriteria: z
    .array(z.object({ id: z.string(), criterion: z.string(), evidenceMethod: z.string() }))
    .default([]),
  unresolvedQuestions: z.array(Unknown).default([]),
  interpreter: z.enum(["deterministic", "model-assisted", "hybrid"]).default("deterministic"),
  confidence: z.number().min(0).max(1).default(0.5),
});
export type GoalSpec = z.infer<typeof GoalSpec>;

/**
 * CapabilityInvocation — the versioned executable skill contract (§5.1).
 * What a gateway records when it actually invokes a capability.
 */
export const CapabilityInvocation = z.object({
  id: z.string().min(3),
  capabilityId: z.string().min(3),
  capabilityVersion: z.string().default("0.0.0"),
  operation: z.string().min(1),
  protocol: z.enum(["library", "process", "mcp", "skill-script", "engine-cli", "coding-backend"]),
  input: z.unknown().optional(),
  workspace: z.string().optional(),
  permissions: z.array(z.string()).default([]),
  budgetMs: z.number().int().positive().default(90_000),
  timeoutMs: z.number().int().positive().default(90_000),
  idempotencyKey: z.string().optional(),
  status: z.enum(["passed", "failed", "skipped", "blocked"]),
  output: z.unknown().optional(),
  artifacts: z.array(z.string()).default([]),
  logsRedacted: z.string().default(""),
  error: z.string().optional(),
  costMeasured: z.string().default("0 USD"),
  durationMs: z.number().int().nonnegative().default(0),
  evidence: z.array(Evidence).default([]),
});
export type CapabilityInvocation = z.infer<typeof CapabilityInvocation>;

/**
 * AnalysisPlan — authorized reverse-engineering contract (§9.3).
 * No analysis runs without a documented rights basis; tool and output scopes
 * are explicit; confidentiality is honored in every produced artifact.
 */
export const AnalysisPlan = z.object({
  id: z.string().min(3),
  target: z.string().min(1),
  format: z.enum(["source-repo", "binary", "package", "documented-api", "protocol", "fixture"]),
  provenance: z.string().min(1),
  rightsBasis: z.enum(["owner", "authorized", "public-documentation", "interoperability-research"]),
  rightsEvidence: z.string().default(""),
  allowedTools: z.array(z.string()).default([]),
  sandboxRequired: z.boolean().default(true),
  expectedArtifacts: z.array(DeliverableKind).min(1),
  confidentiality: z.enum(["public", "internal", "restricted"]).default("internal"),
  riskNotes: z.array(z.string()).default([]),
  createdAt: z.string().datetime().optional(),
});
export type AnalysisPlan = z.infer<typeof AnalysisPlan>;
