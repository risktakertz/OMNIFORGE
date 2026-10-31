# Baseline audit — autonomy & CI recovery mission (2026-10-31)

Mission: surgical upgrade of the existing OMNIFORGE repository per
`OMNIFORGE_AUTONOMY_AND_CI_RECOVERY_MASTER_PROMPT.md`. This audit records the
verified baseline before any change. Labels: `CONFIRMED` (reproduced against
actual code/remote state), `NOT_REPRODUCED` (reported but not currently
blocking), `NEEDS_EXTERNAL_ACCESS` (requires resources this host lacks).

## Repository baseline

- Owner/repo: `risktakertz/OMNIFORGE` (public), default branch `main`.
- Baseline HEAD at mission start: `17af9dac4ddd14f619570887a72bade0a880f205`
  ("fix(ci): build before test — integration/acceptance suites execute the
  built CLI; root verify order aligned").
- Working tree: clean; no submodules; no open PRs; no other agents observed.
- Work branch for this mission: `fix/omniforge-autonomy-ci` (no force-push,
  no history rewrite).
- Local `pnpm verify` at baseline: lint 0 errors; typecheck 17/17 packages;
  tests 158/158 passed; build 17/17; e2e 6/6 checks (recorded in AGENT_LOG.md).

## GitHub Actions incident matrix (authoritative, retrieved via API)

Only four workflow runs exist in repository history (API
`/actions/runs?per_page=40`, retrieved 2026-10-31):

| Run ID | Workflow | HEAD SHA | Conclusion | Created (UTC) |
|---|---|---|---|---|
| 41187073618 | CI | `fc7c50e` | failure | 2026-10-31T09:03:12Z |
| 41187074957 | Release | `fc7c50e` | failure | 2026-10-31T09:03:13Z |
| 41187656408 | CI | `17af9da` | success | 2026-10-31T09:11:22Z |
| 41187658100 | Release | `17af9da` | success | 2026-10-31T09:11:24Z |

### Inc-1: CI failure on `fc7c50e` (run 41187073618) — NOT_REPRODUCED as current blocker; RESOLVED at HEAD

- Failed job/step: `verify` → `Test` (jobs API evidence; Build and E2E steps
  were skipped as downstream).
- Root cause: the root `test` script ran integration/acceptance suites that
  import the **built** CLI (`apps/cli/dist/index.js`) before `pnpm build` had
  produced it — ordering defect, not a product defect.
- Fix already on HEAD: commit `17af9da` re-ordered root verify and CI
  (build before test). CI is green on the exact HEAD revision
  (run 41187656408, success).
- Distinction recorded per mission rule B1: the failure notifications the user
  received correspond to `fc7c50e`; the same workflows have since passed on
  the relevant HEAD, so this incident is **historical, not currently
  blocking**.

### Inc-2: Release failure on `fc7c50e` (run 41187074957) — NOT_REPRODUCED as current blocker; RESOLVED at HEAD

- Same ordering root cause via the release workflow's verify step.
- Green on HEAD: run 41187658100 (success, tag `v0.1.0`).

No other workflows have ever run (`security.yml` is schedule/dispatch-only;
`integration.yml` is dispatch-only), so there are no further actionable
failures to recover at baseline. `CONFIRMED`: CI HEALTHY at `17af9da` on the
exact revision.

## Environment probe (execution host, 2026-10-31)

- Node v24.22.1, npm 11.19.1, git 2.47.3, corepack 0.36.0, pnpm 9.15.9 — verified.
- `opencode`: absent. `ollama`: absent. `gh`: absent.
- `docker`: absent. `podman`: absent → no host-enforced container sandbox.
- No model provider credentials in environment (names checked only:
  no `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / similar present).
- Playwright browser toolchain: not installed on PATH.

Consequence: live coding-backend smoke tests, real-browser E2E, and container
isolation are `NEEDS_EXTERNAL_ACCESS` on this host. Per the mission contract
these are implemented with executable tests that run when the prerequisite
exists, and honestly report BLOCKED otherwise — never fabricated.

## Code findings verified against baseline sources

1. `CONFIRMED` — verification false-green: `verifyWorkspace()` computes
   `passed` solely from `failed.length === 0`; critical criteria that are
   `skipped`/`blocked` do not block a PASS
   (`packages/verification/src/index.ts`).
2. `CONFIRMED` — `createCmd()` synthesizes a pseudo-blueprint from the run's
   own check results (with `as never` casts) before calling the "independent"
   verifier, so independent verification does not compare against the original
   blueprint (`apps/cli/src/index.ts`).
3. `CONFIRMED` — `modifyCmd()` uses an empty acceptance list for both baseline
   and post-change verification; no persisted original criteria exist in
   generated workspaces (`apps/cli/src/index.ts`,
   `packages/workspace-manager/src/index.ts`).
4. `CONFIRMED` — `templateCapabilities()` marks templates `verified` merely
   because `package.json` exists (`packages/capability-registry/src/index.ts`).
5. `CONFIRMED` — `tests/e2e/run.mjs` exercises the CLI but performs no real
   browser interaction; browser E2E is only reported as availability text.
6. `CONFIRMED` — `LocalNodeBackend.runTask()` executes via `sh -c <string>`
   (shell interpolation of composed commands) and `detectOpenCode()` relies on
   POSIX-only `which` (`packages/agent-runtime/src/index.ts`).
7. `CONFIRMED` — `OpenCodeBackend.runTask()` always throws
   `E_BACKEND_UNAVAILABLE`; no real invocation path exists.
8. `CONFIRMED` — the orchestration `repair` node classifies the failure and
   re-enters `execute`; it does not consume stderr/assertion context to
   produce a scoped fix (`packages/orchestration/src/index.ts`).
9. `CONFIRMED` — the task plan (`ExecutionPlan`) is produced but the graph's
   execute node does not schedule tasks from it; the DAG does not govern
   actual work (`packages/orchestration/src/index.ts`).
10. `CONFIRMED` — `detectKinds()` silently maps any unmatched prompt to
    `["website"]` (novel requests become bakery-style sites)
    (`packages/intent-engine/src/index.ts`).
11. `CONFIRMED` — approvals are blanket: any recorded `apr_*` token satisfies
    every approval-gated action; approvals are not action/scope/run-specific
    (`packages/tool-gateway/src/index.ts`).
12. `CONFIRMED` — `FileCheckpointSaver` keeps a single latest-only checkpoint
    file per thread (no parent chain, non-atomic replacement)
    (`packages/orchestration/src/index.ts`).
13. `CONFIRMED` — `runProjectTests()` shells the project's test command via
    `sh -c` (`packages/verification/src/index.ts`).
14. `CONFIRMED` — `exportWorkspace` invokes `tar` without allowlist gating and
    `modifyCmd`/execute paths call `execFileSync` directly
    (`packages/workspace-manager`, `apps/cli`, `packages/orchestration`).

## Baseline preservation commitments

- All existing public CLI commands, package boundaries, templates, skills,
  tests and commit history remain intact; changes are additive or narrowly
  scoped to the defects above.
- No dependency mass-upgrade; `pnpm-lock.yaml` untouched unless a fix requires
  it (none anticipated).
- Existing generated example (`examples/one-sentence-website`) and all
  recorded evidence preserved.

## Remediation plan

M0/B (this audit + incident matrix) → D1 verification contract → C4 DAG
executor → C5 repair engine → C1 coding backends → C2 intent/novelty → C3
executable skills → E2 agent-MVP scenario → D2 governed execution/approvals →
M4 resilience → M6 docs. Each step lands with tests; `pnpm verify` must stay
green before each push.
