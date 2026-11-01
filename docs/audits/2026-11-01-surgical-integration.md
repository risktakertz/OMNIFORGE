# Surgical integration audit — 2026-11-01

Base: `f2fd9b6af988bf844d63faf95f411eba14c4c27a` (fresh clone of main).

## Confirmed source findings

- Enriched GoalSpec is recorded, but specify/select/plan consume the original intent.
- Interpreter activation depends only on OPENAI_API_KEY; no spend authorization precedes fetch.
- Main execution binds template rendering/tests, without CodingBackend.executeTask.
- analyze planning omits workspace/execution/export; CLI has no analyze command.
- CLI create prints DONE and returns zero even when independent verification fails.
- verify/repair early exits bypass report; runProjectTests invokes workspace code directly.
- The quoted browser step and required Chromium mode are already present; preserve them.

## Remote evidence

The connected GitHub account can read this repository but cannot push; the separately supplied runtime-only credential has push permission. No credential was stored in the repository. The connector's commit-workflow lookup returned no associated runs; a bounded GitHub CLI lookup established the latest code CI: `41203874904`, success at `9608efc027d3decd668bbfde267bfed9d11eff17`. The current HEAD is a documentation-only successor. Historical failures `41203190435` and `41202234818` are not current incidents. No workflows were dispatched or rerun during audit.

## Checklist

- [x] Read repository/skill contracts and architecture, capability, release and routing documentation.
- [x] Inspect current integration source and fresh HEAD.
- [x] Canonical goal resolution and execution routing.
- [x] Explicit model policy before network calls, including exported agent planning/editing.
- [x] Backend DAG execution and scoped modification/repair service; file-writing fake tested through CLI main.
- [x] Analysis structural inventory workspace/report/verification/export.
- [x] Graph final reports, CLI failure exits and shared workspace command governance.
- [x] Regression checks and measured handoff (see `2026-11-01-surgical-handoff.md`).

External model/container milestones require separately verified prerequisites. No model calls are authorized by this integration task.

## Additional defects established during implementation

- Windows path-confinement assembled missing suffixes with POSIX separators, rejecting valid workspace writes; fixed at the gateway boundary.
- Dashboard acceptance referred to nonexistent `roles-logic.js`; the actual tested role logic is in `dashboard-logic.js`. Corrected the contract and its exact-path regression assertion.
- Repair's `runGoverned` and local backend commands bypassed workspace code trust; both now use the common command runner.
- A workspace-authored provenance manifest could grant itself host trust; host authority is now detached from generated mounts. Staged trusted acceptance harnesses are explicitly rebound before implementation.
- Arbitrary analysis fixture paths were imported on the host despite a comment claiming repo ownership; the behavior probe now accepts only the actual versioned fixture, rechecks authorization, and bounds case counts.
- OneDrive briefly denied an atomic DAG-state rename during packaging. Added bounded Windows transient-lock retries without a non-atomic fallback.

## Explicit remaining capability limits

Composite execution without typed per-deliverable dependency contracts is blocked with component details. The CLI analysis executor implements structural inventories; arbitrary behavioral analysis remains blocked. Real OpenCode execution needs an installed, health-verified backend, approved model/cost route and an operator-supplied enforced isolated executor. This host has no opencode, Docker or Podman command. Injected backend tests are not evidence of live-model quality or a live container smoke.
