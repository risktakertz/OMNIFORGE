# Release manifest — v0.1.0 "foundation release"

Statuses are honest and match `integrations/catalog.yaml` vocabulary. Proof
points to where the evidence lives.

## Implemented and verified

| Item | Proof |
| --- | --- |
| CLI command set: `doctor`, `skills`, `integrations`, `models`, `plan`, `create`, `inspect`, `modify`, `test`, `status`, `resume`, `export`, `deploy` (human + `--json`) | `apps/cli/src/index.ts`; `tests/integration/cli.test.ts` |
| Intent parsing, English + Swahili | `packages/intent-engine` (+ lexicons); unit tests in package |
| Product blueprints (mvp/later/excluded, evidence methods, cost) | `packages/blueprint-engine`; unit tests |
| Capability registry validation (unique ids, reference integrity, no execution) | `packages/capability-registry`; `omniforge skills validate` |
| Hybrid skill routing with explainable selection | `packages/skill-router`; `tests/routing-evals` (A01–A12) |
| Task planner (DAG, cycle detection, budgets, idempotency) | `packages/task-planner`; unit tests |
| Policy tool gateway (path safety, spend gate, approvals, audit) | `packages/tool-gateway`; `tests/security` |
| Workspaces + locks (`.omniforge-lock.json`, 30-min TTL, holder check) | `packages/workspace-manager`; unit tests |
| LangGraph pipeline with durable file checkpoints + resume | `packages/orchestration`; `tests/orchestration` (resume verified by tests) |
| Export with provenance (tar.gz, provenance.json, sha256) | `packages/workspace-manager`; unit tests |
| 11 templates with self-tests (static-business, commerce-lite, booking-lite, dashboard-lite, api, astro-business, next-web, phaser-2d, expo-mobile, tauri-desktop, godot-native) | `templates/*/tests/`; executed during `create` and `omniforge test` |
| DAG-governed execution: plan drives real work (`executeDag`, durable `dag-state.json`, per-task timeouts/retries, idempotent resume) | `packages/orchestration/src/dag.ts`; `tests/orchestration/autonomy.test.ts` |
| Bounded repair engine consuming real failure evidence (deterministic fixers, regression vs original criteria, stop conditions) | `packages/orchestration/src/repair.ts`; adversarial paths in package tests |
| Verification contract v2 (persisted original criteria; critical non-runs block PASS; independent verifier compares original blueprint vs evidence) | `packages/verification`; `apps/cli` create/modify flows |
| CodingBackend v2: real OpenCode adapter (`opencode run`, argv, smoke gate), cross-platform detection, argv-allowlisted local backend | `packages/agent-runtime`; unit tests |
| Novelty gate: unmatched prompts yield typed E_INTENT_NOVEL (NEEDS_MODEL), never a silent template map; coding-agent domain recognition | `packages/intent-engine`; `tests/routing-evals` |
| Agent-MVP composer (decisive E2 scenario): original runnable coding agent from one sentence, own passing suite, exportable | `packages/orchestration/src/agent-mvp.ts`; `tests/acceptance` E2 case |
| Executable skill entrypoints (testing skill runs through the gateway with typed JSON I/O) | `skills/testing/scripts/run-project-tests.mjs`; `packages/orchestration/src/skills.ts`; `tests/orchestration/autonomy.test.ts` |
| Enforced execution policy: sandbox probe (docker/podman), host allowlist, argv-only, E_SANDBOX_UNAVAILABLE; scoped approvals (action+targets+run) | `packages/tool-gateway`; gateway tests |
| Cross-process resume with exactly-once effects | `tests/orchestration/resume-child.mjs` + autonomy tests |
| Real browser E2E (chromium: render, nav, form submit, responsive) | `tests/e2e/browser.e2e.mjs`; `pnpm e2e` |
| 174+ passing tests | `pnpm test` (vitest run) at release time |
| Lean CI (push/PR, docs excluded) | `.github/workflows/ci.yml` |

## Configured, not operationally verified

| Item | Status | Proof |
| --- | --- | --- |
| Skill packs as instructions (21 SKILL.md files, data not executables) | configured | `skills/`; `scripts/gen-skills.mjs`; registry validation |
| gstack / superpowers methodology (advisory only) | configured | `integrations/catalog.yaml` (host smoke test pending) |
| astro / next on-demand integration builds | configured | `.github/workflows/integration.yml` (dispatch-only) |
| Trivy scheduled/dispatch security scan | configured | `.github/workflows/security.yml` |

## Blocked (prerequisites absent — never simulated)

| Item | Reason | Proof |
| --- | --- | --- |
| godot / expo native builds | engine/toolchain binaries absent; EAS cloud builds paid | `doctor` reports `absent`; catalog `blocked`/`configured` |
| REA tools | authorization-gated; no analysis without recorded basis | catalog status `blocked` |
| Hosted docs (Context7) | credentials + accepted terms required (`E_BACKEND_UNAVAILABLE` until then) | catalog `blocked`; `packages/research-engine` |
| Real deployments | typed-blocked until approved host + approval record | `E_DEPLOY_BLOCKED`; `packages/deployment` tests |

## Planned (next, see `docs/ROADMAP.md`)

Playwright headless chromium wiring; SQLite checkpointer adapter; Studio
read-only UI over the run journal; OpenCode/OpenHands live smoke; Medusa
commerce path (mock checkout stays the no-credential default).

---

## v0.2.0 — universal capability upgrade (2026-10-31)

Directive: `OMNIFORGE_UNIVERSAL_SKILL_AUTONOMY_UPGRADE_MASTER_PROMPT.md`.
Baseline audit: `docs/audits/2026-10-31-universal-upgrade-audit.md` (gap matrix
with one retracted finding, recorded transparently). Test totals at release:
**237 passed / 0 failed** (27 files), lint clean, typecheck+build 17/17.

| Item | Proof |
| --- | --- |
| GoalSpec contract + deterministic/model-hybrid interpretation with policy-immutability | `packages/shared-types`, `packages/intent-engine/src/goal.ts`; `goal.test.ts` |
| Capability operations metadata + operation-compatibility routing | SKILL.md `operations:`, `CapabilityRegistry.findByOperation`, `packages/skill-router` |
| exceeds-scope typed blocker (no silent misroute of data-entity + access-control products) | `E_SCOPE_EXCEEDS_DETERMINISTIC` in router; U03/U16 acceptance tests |
| Composable primitives with dependency/conflict constraints | `packages/blueprint-engine/src/primitives.ts`; tests |
| Work blueprints for non-code deliverables (5 kinds, executable evidence criteria) | `packages/blueprint-engine/src/work.ts`; tests |
| Composite goal decomposition | `decomposeComposite`; U04 test |
| Prompt-injection scan for third-party skill content | `scanExternalInstructions`; hostile-SKILL.md adversarial test |
| CodingBackend v3 (task id/scope/criteria/budget; features flags; prepare/cancel) | `packages/agent-runtime`; `v3.test.ts` |
| Baseline-manifest change detection (no git required; untracked counts) | `snapshotManifest`/`diffManifests`; tests |
| Typed execution routing (template → backend → NEEDS_MODEL/BACKEND_BLOCKED) | `selectExecutionRoute`; tests |
| Container isolation provider + script provenance trust boundary | `runIsolated`, `scriptTrust`, `runWorkspaceScript`; isolation tests |
| repo-push approval gating + path-normalized scoped approvals | `packages/tool-gateway`; security tests |
| Generalized regression-safe modify (services/sections/text; rollback manifest; typed handoff) | `packages/orchestration/src/modify.ts`; CLI integration tests; U11 |
| Evidence-driven seeded-failure repair | U12 acceptance test (real seeded failure → re-render fixer → re-verification) |
| Authorized REA: analysis plan, denials, toy-fixture → spec → original impl → equivalence | `packages/research-engine/src/rea.ts`; `rea.test.ts`; U13 |
| Typed DAG artifact handoffs + job-graph report | `registerArtifact`/`requireArtifacts`, `buildJobGraphReport`, `omniforge status`; unbound-operation adversarial test |
| U01–U18 universal acceptance harness + adversarial additions | `tests/acceptance/universal.test.ts` (22 scenarios) |
| Browser E2E required-mode flag + CI integration (cached chromium) | `tests/e2e/browser.e2e.mjs` (`OF_E2E_REQUIRED`), `.github/workflows/ci.yml` |

## Explicitly NOT verified on this host (typed, reproducible prerequisites)

| Item | Blocker | Reproduction path |
| --- | --- | --- |
| Live OpenCode backend execution (novel code by a real model) | no `opencode` binary, no model credentials | install opencode + authorize a model → `omniforge doctor` shows the smoke gate → opt-in live smoke test runs |
| Containerized execution of untrusted workspace scripts | no docker/podman | install docker → `runWorkspaceScript` on a tampered script executes inside the container (argv recorded) |
| Model-assisted interpretation of novel domains (live) | no verified authorized model route | supply explicit ModelCallPolicy + interpreterPolicy and gated interpreter; key presence alone never activates a call |
| Mobile/desktop/3D builds | no Android SDK / Rust / Godot toolchain | `omniforge doctor` names each absent toolchain; templates stay honestly `blocked` |
| Real payments, deployment, repository pushes | `APPROVED_SPEND=0`; approval gates (incl. repo-push) | explicit scoped approval required per action+target+run |

## Surgical integration — 2026-11-01

Implemented bridges: validated GoalSpec propagation; explicit model authorization
with shared durable reservations; backend-driven DAG execution with staged,
measured, independently verified changes; structural analysis workspaces/reports;
general modification/repair service; final outcome/report/CLI exit corrections;
shared workspace execution governance and detached provenance authority.

The concrete offline OpenCode container driver is implemented and tested with an
injected runtime. Its actual local-model image and live container/model smoke
remain blocked on this host. Composite execution without dependency contracts
and arbitrary behavioral analysis remain explicit blockers. No production or
live-model capability is inferred from the injected tests.

Measured commands, source SHA, I01–I16 ledger, setup steps and residual risks:
[`audits/2026-11-01-surgical-handoff.md`](audits/2026-11-01-surgical-handoff.md).
All existing templates and skill packs are retained; no dependency versions were
upgraded, and default paid spend remains zero.
