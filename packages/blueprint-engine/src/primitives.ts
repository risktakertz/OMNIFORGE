/**
 * Composable architectural primitives (universal-upgrade §4.5).
 *
 * New product designs are composed from primitives (UI, auth, storage, API,
 * payments…) with dependency/conflict constraints — instead of requiring a
 * hand-written template per product type. Pure data + pure functions: the
 * composition is validated deterministically and recorded in the blueprint.
 */

export interface Primitive {
  id: string;
  description: string;
  /** primitives that MUST be present when this one is selected */
  requires: string[];
  /** primitives that CANNOT coexist with this one */
  conflicts: string[];
  /** deterministic implementations available today (honest, evidence-backed) */
  deterministicImpl: string | null;
  /** capabilities needed when no deterministic implementation exists */
  needsModelWhenAbsent?: boolean;
}

export const PRIMITIVES: Primitive[] = [
  { id: "ui", description: "Responsive user interface layer", requires: [], conflicts: [], deterministicImpl: "static-business/commerce-lite/booking-lite/dashboard-lite renderers" },
  { id: "authentication", description: "User identity and sessions", requires: ["storage"], conflicts: [], deterministicImpl: null, needsModelWhenAbsent: true },
  { id: "authorization", description: "Roles, permissions, tenant isolation", requires: ["authentication", "storage"], conflicts: [], deterministicImpl: "dashboard-logic.js (demo role boundary)" },
  { id: "storage", description: "Persistent data (local or DB)", requires: [], conflicts: [], deterministicImpl: "localStorage / in-memory stores" },
  { id: "api", description: "Typed HTTP interface", requires: [], conflicts: [], deterministicImpl: "node template (Zod-validated contracts)" },
  { id: "background-jobs", description: "Deferred/scheduled work", requires: ["storage"], conflicts: [], deterministicImpl: null, needsModelWhenAbsent: true },
  { id: "notifications", description: "Outbound messaging (email/SMS/push)", requires: ["storage"], conflicts: [], deterministicImpl: null, needsModelWhenAbsent: true },
  { id: "payments", description: "Payment collection", requires: ["api"], conflicts: [], deterministicImpl: "mock checkout (clearly labeled, never live)" },
  { id: "realtime", description: "WebSocket/live updates", requires: ["api"], conflicts: [], deterministicImpl: null, needsModelWhenAbsent: true },
  { id: "analytics", description: "Usage metrics and reporting", requires: ["storage"], conflicts: [], deterministicImpl: "dashboard-lite KPI/CSV export" },
  { id: "rendering-2d", description: "2D canvas/WebGL rendering", requires: [], conflicts: [], deterministicImpl: "phaser-2d template" },
  { id: "rendering-3d", description: "3D engine rendering", requires: [], conflicts: [], deterministicImpl: "godot-native template (engine toolchain required)" },
  { id: "game-loop", description: "Fixed-step game loop + input", requires: ["rendering-2d"], conflicts: [], deterministicImpl: "phaser-2d template game-logic module" },
  { id: "model-inference", description: "LLM/ML inference integration", requires: ["api"], conflicts: [], deterministicImpl: "agent-MVP pluggable adapter (honest MOCK mode)" },
  { id: "git-operations", description: "Repository automation", requires: [], conflicts: [], deterministicImpl: "agent-MVP github-adapter (credential-gated)" },
  { id: "data-ingestion", description: "File/CSV/external data import", requires: ["storage"], conflicts: [], deterministicImpl: "dashboard-lite CSV export (import via model when novel)" },
  { id: "ci", description: "Continuous integration pipeline", requires: [], conflicts: [], deterministicImpl: "generated GitHub Actions workflow" },
  { id: "packaging", description: "Distribution package/build", requires: [], conflicts: [], deterministicImpl: "tar.gz export + provenance" },
  { id: "hosting", description: "Deployment target", requires: ["packaging"], conflicts: [], deterministicImpl: "dry-run deploy plan only (approval-gated)" },
];

export const PRIMITIVE_IDS = new Set(PRIMITIVES.map((p) => p.id));

export function getPrimitive(id: string): Primitive | null {
  return PRIMITIVES.find((p) => p.id === id) ?? null;
}

export interface CompositionResult {
  ok: boolean;
  missingDependencies: Array<{ primitive: string; requires: string[] }>;
  conflicts: Array<{ a: string; b: string }>;
  unknownPrimitives: string[];
  /** honest capability notes for primitives without deterministic impls */
  modelRequired: string[];
}

/** Validate a primitive composition against dependency + conflict constraints. */
export function composePrimitives(selected: string[]): CompositionResult {
  const unknown = selected.filter((id) => !PRIMITIVE_IDS.has(id));
  const known = selected.filter((id) => PRIMITIVE_IDS.has(id));
  const chosen = new Set(known);
  const missingDependencies: CompositionResult["missingDependencies"] = [];
  const conflicts: CompositionResult["conflicts"] = [];
  for (const id of known) {
    const p = getPrimitive(id)!;
    const missing = p.requires.filter((r) => !chosen.has(r));
    if (missing.length > 0) missingDependencies.push({ primitive: id, requires: missing });
    for (const c of p.conflicts) {
      if (chosen.has(c)) conflicts.push({ a: id, b: c });
    }
  }
  const modelRequired = known
    .map((id) => getPrimitive(id)!)
    .filter((p) => !p.deterministicImpl)
    .map((p) => p.id);
  return {
    ok: unknown.length === 0 && missingDependencies.length === 0 && conflicts.length === 0,
    missingDependencies,
    conflicts,
    unknownPrimitives: unknown,
    modelRequired,
  };
}

/** Suggest the minimal missing additions to make a composition valid. */
export function suggestAdditions(selected: string[]): string[] {
  const res = composePrimitives(selected);
  const add = new Set<string>();
  for (const m of res.missingDependencies) for (const r of m.requires) add.add(r);
  return [...add];
}
