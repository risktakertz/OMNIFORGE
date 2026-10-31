# ADR-007 — The task DAG governs execution; verification contract v2

Date: 2026-10-31
Status: accepted (autonomy & CI recovery mission)

## Context

The original orchestration graph executed a fixed node sequence and treated
the task plan as data produced for reports. Several false-green patterns were
confirmed in the baseline audit: `verifyWorkspace` passed on
`failed.length === 0` even when critical criteria never ran; `create` built a
pseudo-blueprint from its own results before the "independent" verifier;
`modify` used empty acceptance lists as its regression baseline; templates
were marked `verified` because `package.json` existed.

## Decision

1. **DAG governance.** The `execute` graph node drives the project task plan
   through `executeDag`: dependency-ready tasks only, durable per-task ledger
   (`dag-state.json`, atomic writes), timeouts, retry budgets with
   idempotency, and exactly-once resume. Graph phases record their outcomes
   into the same ledger — one source of truth for CLI, graph, journal and UI.
   A failed DAG task can never be outweighed by a parallel green signal.
2. **Repair consumes real evidence.** The repair stage classifies actual
   verification failures, applies the smallest scoped deterministic fixer
   (config-driven re-render, workspace fix entrypoints), reruns the project
   suite AND the persisted original acceptance criteria, and stops on
   repeated identical failures (`E_REPAIR_NONIMPROVING`), budget exhaustion,
   or a missing model backend (`E_MODEL_UNAVAILABLE`) — actionable blockers,
   never loops and never masked tests.
3. **Verification contract v2.** The ORIGINAL blueprint is persisted into the
   workspace (`project.blueprint.json`) before implementation. Every
   criterion maps to executable evidence; outcomes distinguish
   passed/failed/skipped/blocked/not-run with critical vs advisory severity.
   `passed` requires zero failures AND zero critical non-runs. Independent
   verification compares the original criteria against observed evidence —
   never criteria derived from the results being judged.

## Consequences

- Legacy workspaces without a persisted blueprint refuse `modify` with a
  typed error instead of a fake baseline.
- Template availability is "configured" until its self-test is observed;
  "verified" is reserved for observed evidence (browser E2E, generator runs).
- Novel prompts that match no capability yield `E_INTENT_NOVEL` (NEEDS_MODEL)
  instead of silently becoming a known template.

# ADR-008 — Enforced execution isolation and scoped approvals

Date: 2026-10-31
Status: accepted (autonomy & CI recovery mission)

## Context

A policy-classification function is not an operating-system boundary.
`sh -c` composition, blanket `apr_*` approvals and POSIX-only binary
detection were confirmed weaknesses. The mission requires host-enforced
sandboxing for untrusted code or a safe, honest blocked mode.

## Decision

1. **Sandbox probe.** `resolveSandbox()` probes docker/podman with argv calls
   (cross-platform). Modes: `container` (untrusted code may run isolated),
   `host-allowlist` (only known-safe argv commands on the host) — never a
   silent fallback to "run anything".
2. **argv-only execution.** `gateway.authorizeExec()` accepts argument arrays
   only; shell metacharacters are refused outright; binaries outside the host
   allowlist require a container runtime or fail with `E_SANDBOX_UNAVAILABLE`.
   `LocalNodeBackend` routes all execution through this gate and policy
   denials fail loud (typed errors).
3. **Scoped approvals.** Approval records bind action + target paths + run.
   An `apr_*` id without a matching action/target authorizes nothing.
   `auto:<tool>` self-scoped approvals remain for explicitly safe internal
   operations.
4. **Environment hygiene.** Generated sandboxes strip test-runner context
   variables (`NODE_TEST_CONTEXT`, …) from spawned children — observed to
   change exit-code semantics in real runs.

## Consequences

- Environments without docker/podman (including CI runners used here) cannot
  execute non-allowlisted binaries — the system says so with a typed error
  and the exact prerequisite instead of pretending.
- Repair delegation to a coding backend without a model is a typed
  `E_MODEL_UNAVAILABLE` blocker with the smallest user action documented.
