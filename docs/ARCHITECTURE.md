# ARCHITECTURE — one control plane

OMNIFORGE turns short, ordinary, nontechnical requests into original, working,
tested, exportable software. It is a pnpm + Turborepo TypeScript monorepo
(pnpm 9.15.9, turbo ^2.3.3, TypeScript ^5.7.3 per `integrations/lock.json`)
with one orchestration owner: the LangGraph.js state graph in
`packages/orchestration`. No second orchestration engine is permitted
(`AGENTS.md`).

## Package map

| Package | Role |
| --- | --- |
| `packages/shared-types` | Versioned Zod contracts (CONTRACT_VERSION 1.0.0) for intent, blueprint, planning, evidence, selection, approvals, cost, tool calls, workspaces, validation, releases, models, run events — plus typed `E_*` failure codes |
| `packages/intent-engine` | Deterministic interpretation, English + Swahili lexicons |
| `packages/blueprint-engine` | Blueprints: MVP/later/excluded scope, acceptance criteria, free-first cost estimates |
| `packages/research-engine` | Offline knowledge providers; sanitizer that flags injection attempts in fetched content |
| `packages/capability-registry` | Agent Skills `SKILL.md` discovery/validation without executing untrusted files |
| `packages/skill-router` | Eligibility, dependency/conflict resolution, explainable ranking, free-first policy |
| `packages/task-planner` | DAG planning, cycle detection, budgets, idempotency keys |
| `packages/tool-gateway` | Deterministic policy in front of all tools and external actions |
| `packages/agent-runtime` | Execution backends (`LocalNodeBackend`; OpenCode adapter, blocked until smoke-tested) |
| `packages/model-router` | Environment-derived model registry, profiles, deterministic-core fallback |
| `packages/workspace-manager` | Workspace creation, locks/leases, export under `projects/` |
| `packages/verification` | Check execution and bounded failure classification |
| `packages/deployment` | Dry-run-first deployment adapter |
| `packages/orchestration` | The graph plus `FileCheckpointSaver` |
| `packages/observability` | `RunJournal` and logger for per-run evidence |
| `packages/utils`, `packages/config` | Shared helpers, strict TS base config |
| `apps/cli` | The `omniforge` CLI (doctor, plan, create, resume, export, deploy, ...) |

## Pipeline

`intake → permission-check → interpret → research → specify → select → plan →
prepare-workspace → execute → verify → repair → approve → package → deliver →
report`. `verify` branches conditionally: passing runs continue to `approve`;
failures go to `repair` (budget of 2 attempts, then the run ends blocked),
which loops back to `execute`.

The resolved GoalSpec feeds a validated compatibility intent, then product or
work blueprints, routing and the executable DAG. Original request, intake
identity, operation and policy authority are retained. Novel coding uses a
verified CodingBackend with an enforced execution boundary, shared durable model
budget, staged source tree, measured diff, scoped writes and independent
acceptance before applying changes. The same engine handles generalized edits
and backend repairs. An injected runtime proves these contracts in tests; a real
model/container smoke is a separate prerequisite-gated milestone.

Structural analysis uses a work blueprint and the same workspace/execute/verify/
package DAG. It records source rights, observations, hashes, inference limits and
exportable reports without generating a site. Unsupported analyses and composite
goals without per-component dependency contracts have explicit typed blockers.

All workspace commands, including verification suites and repair scripts, use
one provenance/isolation gate. Host trust needs versioned template identity or a
detached authority record; workspace manifests cannot authorize themselves.
Every verify/repair terminal branch reaches report. CLI failure exits, durable
run outcomes and delivery gates agree; a green acceptance check cannot outweigh
a failed DAG task. Run locks prevent simultaneous resume side effects.

## Durable state and isolation

Every node appends to a per-run `RunJournal`; `FileCheckpointSaver` persists
graph state per thread id, so interrupted runs resume from the checkpoint
store, not memory. Products are built in isolated `projects/` workspaces
(git-ignored); templates never mutate previously delivered projects.

## Honesty and engine boundaries

Status vocabulary is `verified | configured | unavailable | blocked |
untested` (`packages/shared-types`); gaps surface typed failures, never
simulations. External engines (Godot, Blender) stay outside the pnpm/turbo TS
build graph: invoked as installed binaries when present, reported blocked when
absent.
