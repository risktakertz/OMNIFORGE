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
