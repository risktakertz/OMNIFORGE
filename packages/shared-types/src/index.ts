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
});
export type ProjectIntent = z.infer<typeof ProjectIntent>;

export const Capability = z.object({
  id: z.string().min(3),
  kind: CapabilityKind,
  source: z.string().min(1),
  version: z.string().min(1),
  capabilities: z.array(z.string()).default([]),
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
  status: z.enum(["passed", "failed", "skipped", "blocked"]),
  message: z.string().default(""),
  evidencePaths: z.array(z.string()).default([]),
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
