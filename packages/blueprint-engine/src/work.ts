/**
 * WorkBlueprints for non-code deliverables (universal-upgrade §4.6).
 *
 * OMNIFORGE supports authorized architecture audits, interoperability specs,
 * reverse-engineered behavior reports, comparative studies, test harnesses
 * and migration plans as first-class deliverables — every one with explicit
 * evidence criteria suited to its type. Analytical work is COMPLETE without
 * generating an application; nothing is forced into dist/index.html.
 */
import { ProductBlueprint, type ProductBlueprint as Blueprint, type GoalSpec } from "@omniforge/shared-types";
import { nowIso } from "@omniforge/utils";
import { OmniforgeError } from "@omniforge/shared-types";

type Criteria = Array<{ id: string; criterion: string; evidenceMethod: string }>;

interface DeliverableSpec {
  mvp: string[];
  criteria: Criteria;
  evidenceDir: string;
}

const DELIVERABLE_SPECS: Record<string, DeliverableSpec> = {
  "analysis-report": {
    mvp: [
      "Executive summary of the analyzed target",
      "Method + provenance section (rights basis recorded)",
      "Findings with cited evidence for every claim",
      "Explicit separation of observed behavior vs inference vs assumptions",
      "Risks, limitations and open questions",
    ],
    criteria: [
      { id: "W1", criterion: "Report document exists with the required sections", evidenceMethod: "file-exists:report/ANALYSIS.md" },
      { id: "W2", criterion: "Findings cite concrete evidence", evidenceMethod: "file-contains:report/ANALYSIS.md:## evidence" },
      { id: "W3", criterion: "Observed behavior is separated from inference", evidenceMethod: "file-contains:report/ANALYSIS.md:inference" },
      { id: "W4", criterion: "No secrets in the report", evidenceMethod: "no-secrets" },
    ],
    evidenceDir: "report",
  },
  "behavior-spec": {
    mvp: [
      "Behavior matrix: input → expected observable output",
      "Interface/data-format specification",
      "Reproduction commands for every behavior row",
      "Clean-room note: spec derived from observed behavior, not protected source",
    ],
    criteria: [
      { id: "W1", criterion: "Behavior specification exists", evidenceMethod: "file-exists:spec/BEHAVIOR.md" },
      { id: "W2", criterion: "Reproduction commands are recorded", evidenceMethod: "file-contains:spec/BEHAVIOR.md:reproduce" },
      { id: "W3", criterion: "Behavior matrix present", evidenceMethod: "file-contains:spec/BEHAVIOR.md:| input |" },
      { id: "W4", criterion: "No secrets in the spec", evidenceMethod: "no-secrets" },
    ],
    evidenceDir: "spec",
  },
  "test-harness": {
    mvp: [
      "Runnable test suite covering the agreed behaviors",
      "Fixture data with explicit provenance",
      "Exit-code contract (0 = pass) and CI wiring notes",
    ],
    criteria: [
      { id: "W1", criterion: "Harness structure is complete", evidenceMethod: "structure-check" },
      { id: "W2", criterion: "Harness suite passes", evidenceMethod: "run-project-tests" },
      { id: "W3", criterion: "No secrets in harness files", evidenceMethod: "no-secrets" },
    ],
    evidenceDir: "tests",
  },
  "migration-plan": {
    mvp: [
      "Current-state inventory with evidence",
      "Target-state architecture and step plan",
      "Rollback strategy for every step",
      "Risk register with owners",
    ],
    criteria: [
      { id: "W1", criterion: "Migration plan exists", evidenceMethod: "file-exists:plan/MIGRATION.md" },
      { id: "W2", criterion: "Rollback strategy documented", evidenceMethod: "file-contains:plan/MIGRATION.md:rollback" },
      { id: "W3", criterion: "No secrets in the plan", evidenceMethod: "no-secrets" },
    ],
    evidenceDir: "plan",
  },
  "comparison-study": {
    mvp: [
      "Comparable criteria table across options",
      "Evidence per criterion (benchmarks, docs, licenses)",
      "Recommendation with stated assumptions",
    ],
    criteria: [
      { id: "W1", criterion: "Study document exists", evidenceMethod: "file-exists:report/COMPARISON.md" },
      { id: "W2", criterion: "Comparison table present", evidenceMethod: "file-contains:report/COMPARISON.md:| criterion |" },
      { id: "W3", criterion: "No secrets in the study", evidenceMethod: "no-secrets" },
    ],
    evidenceDir: "report",
  },
};

/**
 * Build a blueprint for a NON-CODE deliverable. The result is a
 * ProductBlueprint-compatible record (same persistence + verification
 * machinery), with deliverable-specific acceptance criteria.
 */
export function buildWorkBlueprint(goal: GoalSpec): Blueprint {
  if (goal.operation === "create" || goal.operation === "modify") {
    throw new OmniforgeError("E_INTENT_UNCLEAR", "create/modify goals use buildBlueprint (product blueprints), not buildWorkBlueprint", {});
  }
  const kind = goal.requestedDeliverables[0] ?? "analysis-report";
  const spec = DELIVERABLE_SPECS[kind];
  if (!spec) {
    throw new OmniforgeError(
      "E_DELIVERABLE_UNSUPPORTED",
      `deliverable kind '${kind}' has no blueprint specification yet — supported: ${Object.keys(DELIVERABLE_SPECS).join(", ")}`,
      { requested: kind }
    );
  }
  return ProductBlueprint.parse({
    intentId: goal.sourceIntentId ?? goal.goalId,
    contractVersion: "1.1.0",
    productBrief: `${goal.operation} work product: ${kind}. Goal: "${goal.objective.slice(0, 160)}". Deliverable is analytical/organizational — completion does NOT require generating an application.`,
    scope: {
      mvp: spec.mvp,
      later: ["additional deliverable kinds requested by the user"],
      excluded: ["unauthorized targets", "DRM or access-control circumvention", "copying protected source or branding"],
    },
    rolesAndFlows: [{ role: "analyst", flow: "plan → inspect authorized sources → record evidence → write deliverable → independent verification" }],
    architecture: {
      family: "work-product",
      stack: ["markdown + reproducible scripts", "no runtime dependency on OMNIFORGE"],
      hosting: ["artifact export only"],
      isolation: "workspace under projects/ (git-ignored), independent export",
    },
    dataModel: { type: "documents", store: "plain files", pii: "only what the rights basis allows" },
    contracts: [],
    threatModel: {
      findings: [
        {
          id: "WTM1",
          severity: "low",
          title: "Analysis-only deliverable",
          detail: "No executable product surface; confidentiality honored per AnalysisPlan",
          remediation: "keep sources authorized; never include restricted excerpts beyond the rights basis",
        },
      ],
    },
    acceptanceCriteria: spec.criteria,
    deploymentRequirements: {
      family: "work-product",
      approved: false,
      note: "analytical deliverables are exported as artifacts; no hosting step",
    },
    costEstimateId: undefined,
  });
}

export function workStamp(): string {
  return nowIso();
}
