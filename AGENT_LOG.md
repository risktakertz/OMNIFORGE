# AGENT_LOG.md — durable state and continuation log

Auditable log of autonomous work on OMNIFORGE. Each entry records what was
actually done, with evidence pointers. Statuses are honest: implemented and
tested vs configured vs blocked.

## 2026-10-31 — Bootstrap session (M0 → M2 vertical slice)

**Target repo:** `risktakertz/OMNIFORGE` (public, default branch `main`, empty at
session start, no existing content affected). Execution host: Linux sandbox with
Node 24, pnpm 9.15.9 (user-prefix install via npm), git 2.47, network access to
npm registry and GitHub API. No forks created; no billable services touched.

### M0 — safety, source audit, reproducibility
- Verified target repository metadata and push permissions via one authenticated
  GitHub API call; repo was empty, so nothing needed preservation.
- Audited the upstream catalog from the master directive; recorded integration
  decisions in `integrations/catalog.yaml` + `integrations/lock.json` with
  verified/unverified statuses (no uncontrolled `latest`; versions pinned where
  installed).
- Root scaffold: pnpm workspace, Turborepo pipeline, strict TS base config,
  ESLint (typescript-eslint flat config), Vitest, `.gitignore`, `.env.example`,
  `.npmrc`, `.editorconfig`, `.gitattributes`, `LICENSE` (MIT), `AGENTS.md`.
- CI: lean `ci.yml` (push/PR), `security.yml` (scheduled Trivy + secret scan,
  also dispatch-only), `integration.yml` (dispatch-only heavy template builds),
  `release.yml` (tag-triggered).

### M1 — real core engine and CLI
- `packages/shared-types`: versioned Zod schemas for `ProjectIntent`,
  `Capability`, `ProductBlueprint`, `TaskNode`, `Evidence`, `ExecutionRun`,
  `SkillSelection`, `ApprovalRequest`, `CostEstimate`, `ToolInvocation`,
  `WorkspaceLease`, `ValidationResult`, `ReleaseArtifact`, `ThreatFinding`,
  `SourceProvenance`, `ModelCapability`, plus typed failure codes.
- `packages/intent-engine`: deterministic request interpretation with English +
  Swahili lexicons, assumptions with confidence, blocking unknowns, operation and
  product-kind detection.
- `packages/blueprint-engine`: product blueprints with MVP/later/excluded scope,
  acceptance criteria with evidence methods, free-first cost estimates.
- `packages/orchestration`: LangGraph.js state graph (`intake → … → report`)
  with durable file-backed checkpoints + run journal; resume verified by tests.
- `apps/cli`: `omniforge doctor | skills | integrations | models | plan | create |
  inspect | modify | test | status | resume | export | deploy` (human + `--json`).
- One-sentence website path: `omniforge create "Create a responsive website for a
  local bakery"` produces a real, original, tested site in an isolated workspace.

### M2 — dynamic skills and engineering discipline
- `packages/capability-registry`: Agent Skills frontmatter discovery and
  validation (unique IDs, reference integrity, metadata schema) without executing
  untrusted files.
- `packages/skill-router`: deterministic eligibility → dependency/conflict
  resolution → explainable ranking → free-first risk/cost policy → `SkillSelection`
  with structured evidence and fallbacks.
- `packages/task-planner`: DAG with cycles detection, budgets, idempotency keys.
- `packages/tool-gateway`: action classification, path safety (symlink/traversal),
  spend gate at `APPROVED_SPEND=0`, approval workflow, audit events.
- Skill packs generated under `skills/` (21 SKILL.md files) + `.agents/skills`
  host shim. Routing evals and adversarial fixtures in `tests/`.

### M3–M5 status (honest)
- **M3 (partial, real):** zero-dependency product factories shipped and tested —
  `static-business`, `commerce-lite` (catalog/search/cart/mock checkout/order
  history), `booking-lite`, `dashboard-lite`; `astro-business` and `next-web`
  templates present with integration builds available on demand (workflow
  dispatch) to conserve CI minutes. shadcn/ui, Supabase, Medusa, Playwright MCP:
  catalogued as configured/unverified — not installed globally, not claimed as
  working.
- **M4 (scaffolds, honestly blocked where toolchains are absent):** `expo-mobile`,
  `tauri-desktop`, `phaser-2d`, `godot-native` templates with real structure and
  truthful verification (toolchain checks in `doctor`; missing engines reported as
  `blocked/absent`, never simulated). OpenHands/Ollama/Context7 adapters
  documented, off by default.
- **M5 (partial):** durable checkpoints/resume, workspace locks, approval gates,
  export with provenance, deployment dry-run, adversarial security tests, Trivy
  workflow. Studio web UI intentionally not built (optional per spec; CLI-first).

### Continuation plan (exact next tasks)
1. Install and smoke-test Playwright (headless chromium) for browser-verified
   acceptance runs; wire `tests/e2e` to use it when present.
2. Add SQLite checkpointer adapter (`@langchain/langgraph-checkpoint-sqlite`) and
   benchmark against the file checkpointer.
3. Implement `apps/studio` as a read-only view over the same run journal.
4. Verify OpenCode/OpenHands adapters against real CLIs when authorized.
5. Expand commerce factory toward Medusa open-core modules for multi-tenant
   stores; keep mock checkout as the no-credential default.

### Final verification of this session (evidence)
- `pnpm verify` green locally: lint (0 errors), typecheck (17 packages), tests
  **158 passed / 0 failed** (unit + orchestration resume + routing evals A01–A12 +
  integration CLI + acceptance A01–A11 subsets + adversarial security), build (17
  packages), e2e (built-CLI acceptance: create → verify → export → deploy gate).
- Live acceptance evidence: `omniforge create "Create a responsive website for a
  local bakery"` → workspace with rendered site, all blueprint criteria passed,
  independent verifier PASS, export artifact with sha256; committed under
  `examples/one-sentence-website/`.
- Resume proof: injected execute failure → run interrupted → `resumeRun` from the
  file checkpointer completed exactly-once reusing the pre-failure workspace.
- GitHub usage discipline: zero forks, zero releases faked, ONE push of logical
  commits + one tag; heavy builds dispatched on demand only; public repo → free
  Actions minutes; no billable third-party service touched (APPROVED_SPEND=0).

## 2026-10-31 — Autonomy & CI recovery session (surgical upgrade mission)

**Branch:** `fix/omniforge-autonomy-ci` off `17af9da` (no force-push; baseline
preserved). Directive: `OMNIFORGE_AUTONOMY_AND_CI_RECOVERY_MASTER_PROMPT.md`.
Baseline audit with the incident matrix: `docs/audits/2026-10-31-autonomy-baseline-audit.md`.

### B — CI recovery (verified via API, not notifications)
- Repo history contains exactly four Actions runs: CI+Release failed on
  `fc7c50e` (tests executed the built CLI before `pnpm build`), both green on
  HEAD `17af9da`. Root cause and fix already on HEAD — incident recorded as
  RESOLVED, not currently blocking. CI HEALTHY confirmed on the exact SHA.
- GitHub usage discipline: 3 authenticated API calls total (runs list, failed
  jobs, none wasted); no forks; no re-runs; routine pushes stay lean.

### C/D — autonomy gaps closed (evidence-verified)
- **C4:** the task plan now governs execution — `executeDag` with durable
  per-task ledger, dependency readiness, timeouts, retry budgets, idempotent
  resume; graph phases record into the same ledger; failed tasks can no
  longer be outweighed by parallel signals.
- **C5:** repair engine consumes real failures (classification + stderr +
  persisted criteria), applies deterministic scoped fixers, reruns the
  project suite plus the ORIGINAL acceptance criteria, stops typed
  (non-improving / budget / model-missing).
- **D1:** verification contract v2 — original blueprint persisted per
  workspace; critical skipped/blocked/not-run can never PASS; independent
  verifier compares original criteria vs observed evidence; `create`/`modify`
  no longer synthesize pseudo-criteria; template registry honesty
  (configured until self-test observed).
- **C1:** CodingBackend v2 — real OpenCode adapter (`opencode run`, argv,
  timeouts, redaction, live smoke gate with a novel seeded-bug task), honest
  `unsupported` for the deterministic backend, cross-platform detection.
  Live smoke marked BLOCKED on this host (no opencode binary / no model
  credentials) with the executable test left in place.
- **C2:** novelty gate — unmatched prompts return typed `E_INTENT_NOVEL`
  (NEEDS_MODEL) instead of silently becoming bakery sites; coding-agent
  domain recognition; explicit low-confidence inference for generic wording.
- **C3:** executable skill entrypoints — `skills/testing` ships a real
  entrypoint (typed JSON stdin/stdout) validated by the registry and actually
  invoked by the DAG verify task through the gateway with evidence.
- **D2:** enforced execution policy — sandbox probe (docker/podman, cross-
  platform argv), host binary allowlist, argv-only (metachar refusal),
  `E_SANDBOX_UNAVAILABLE` for untrusted host execution, scoped approvals
  (action+targets+run; blanket apr_* dead), fail-loud denials.
- **E2 (decisive):** `omniforge create "Create an original cloud-ready AI
  coding agent like Claude Code ..."` composes an ORIGINAL agent-MVP project
  (CLI loop, pluggable model adapter with honest MOCK labeling, exactly-once
  checkpoint journal, credential-gated GitHub adapter, allowlist sandbox,
  scoped approvals) whose own node:test suite passes; export verified; NOT a
  renamed template and NOT falsely claimed as a hosted service.
- **M4:** cross-process resume — two real OS processes, durable checkpoint +
  dag-state, exactly-once workspace effects.

### Final verification of this session (evidence)
- `pnpm verify` green: lint 0 errors; typecheck+build 17/17 packages; tests
  **174 passed / 0 failed** (incl. new routing evals: agent/novel/adversarial/
  Swahili; autonomy suite: skill invocation + cross-process resume; gateway
  adversarial: scoped approvals, sandbox refusal, metachar argv);
  e2e 6 steps + **real browser E2E on chromium 143**: page load, brand render,
  nav anchor scrolling, contact form fill+submit success state, mobile
  viewport without horizontal overflow, screenshot captured.
- Live acceptance evidence regenerated under `projects/` during e2e (git-
  ignored); Playwright 1.57.0 pinned as devDependency; integration workflow
  gained a dispatch-only `browser-e2e` job.
- Honest gaps recorded: opencode binary, model credentials, container
  runtime, Godot/Expo toolchains — all probed and reported by `doctor`; live
  backend smoke and container isolation stay BLOCKED until the operator
  supplies them. Nothing fabricated.

## 2026-10-31 — Universal capability upgrade session (surgical enhancement mission)

**Baseline:** `main` @ `53dffd6` (PR #1 merge, CI green). Directive:
`OMNIFORGE_UNIVERSAL_SKILL_AUTONOMY_UPGRADE_MASTER_PROMPT.md`. Audit first, no
re-implementation of PR #1 work: gap matrix in
`docs/audits/2026-10-31-universal-upgrade-audit.md` (22 findings; one retracted
after Read-tool verification — recorded transparently).

### What actually changed (evidence-first, backward compatible)

- **M1 security/verification:** repo-push is now approval-gated with
  path-normalized scoped approvals (a raw `root/../elsewhere` target can no
  longer satisfy a scoped approval — found by the new regression test);
  `runIsolated` container provider composes real docker/podman argv (no-network
  default, non-root, bounded CPU/mem/pids) and refuses typed without a runtime;
  `scriptTrust` provenance boundary (template byte-identity OR compose-time
  `.omniforge/provenance.json`) gates EVERY workspace script execution through
  `runWorkspaceScript` — tampered workspace scripts require a container or are
  refused, never silently host-executed; browser E2E gained `OF_E2E_REQUIRED=1`
  (BLOCKED → exit 1) and CI now installs cached chromium and runs REQUIRED mode
  (§11.3: BLOCKED ≠ passed); unknown DAG operations are BLOCKED, never
  passthrough-passed (§5.3).
- **M2 CodingBackend v3:** AgentTaskSpec carries task id, project context,
  bounded writable/forbidden file scope, acceptance criteria, allowed tools,
  expected artifacts, budget and risk; `features()` capability flags;
  `prepare()` baseline manifests; cooperative `cancel()`; async cancellable
  OpenCode execution (full instruction as ONE argv element, no shell); change
  detection via baseline-manifest hashes — a git repo is NO longer required and
  untracked changes always count (§3.3); scope violations fail the task
  (§3.6); `selectExecutionRoute()` typed decisions (template reuse → backend →
  E_NEEDS_MODEL / E_BACKEND_BLOCKED with prerequisites).
- **M3 universal intent:** versioned `GoalSpec` (assets, environment, NFRs,
  privacy, licensing, risks, budget, deliverables, unresolved questions);
  `mergeModelGoalSpec` — model text can fill understanding but NEVER policy
  fields (constraints/privacy/licensing/budget stay deterministic); composite
  decomposition; `scanExternalInstructions` prompt-injection scan wired into
  the capability registry (hostile SKILL.md → blocked, adversarial test);
  machine-readable `operations:` metadata + `findByOperation()` operation-first
  routing with explicit exclusion reasons; `E_SCOPE_EXCEEDS_DETERMINISTIC`
  typed blocker for data-entity + access-control products (U03/U16 no longer
  misroute to static templates); 19 composable primitives with dependency/
  conflict constraints; `buildWorkBlueprint` for five non-code deliverable
  kinds with executable evidence criteria.
- **M4 execution:** typed `registerArtifact`/`requireArtifacts` handoffs with
  durable ledger rebuild on resume; `buildJobGraphReport` (tasks, handoffs,
  verification, blockers) surfaced via `omniforge status`; GoalSpec built every
  run; `modelInterpreter` hook activates ONLY with an authorized credential
  (env-based OpenAI-compatible client in model-router).
- **M5 generalized modify:** repo-understanding pass + deterministic transforms
  (`add service`, `add section` with nav wiring, bounded exact `change text`)
  with per-file rollback backups, trust-gated re-render and regression
  re-verification against the ORIGINAL criteria; broader changes → typed
  E_NEEDS_MODEL handoff listing the deterministic routes (never
  E_NOT_IMPLEMENTED).
- **M6 authorized REA:** `planAnalysis` gate (refuses DRM/circumvention
  regardless of claimed authorization; requires rights evidence; refuses
  binary/package analysis without a container); `analyzePricingFixture` —
  authorized toy fixture → behavior matrix → reproducible spec (observation
  labeled separately from inference) → ORIGINAL clean-room implementation →
  equivalence proof over the domain (archetype: continuous piecewise-linear
  functions; others → typed NEEDS_MODEL).
- **M7 acceptance + docs:** `tests/acceptance/universal.test.ts` implements the
  U-series (10 executed real paths incl. full create/modify/repair/REA flows;
  7 precise typed blockers; 5 adversarial additions incl. hostile skill
  metadata, unbound-operation DAG, zero-spend gate); SKILL.md now documents
  operation families + truthful vocabulary; CAPABILITY_MATRIX and
  RELEASE_MANIFEST record every addition with evidence and explicit
  not-verified-here prerequisites.

### Final verification of this session (evidence)

- `pnpm lint` clean; typecheck+build 17/17; tests **237 passed / 0 failed**
  (up from 174 — 63 new tests, zero existing tests weakened; the repo-push test
  was STRENGTHENED from allow-always to scoped-approval semantics); e2e green;
  manual CLI runs: create → verification PASSED + independent verifier PASS;
  modify add-service/add-section/change-text all regression-safe; E_NEEDS_MODEL
  handoff verified live.
- Live acceptance evidence regenerated under `projects/` (git-ignored);
  REA fixture under `tests/fixtures/rea-sample-app/` (repo-owned, MIT).
- GitHub discipline: zero forks, one push, no re-runs, read-only API use only;
  `APPROVED_SPEND=0` preserved everywhere; no secrets in logs (redaction on
  every backend output).

### Honest gaps (unchanged prerequisites, typed)

opencode binary + model credentials (live autonomy), docker/podman (real
container isolation), Android/Rust/Godot toolchains (native builds), model
credentials (live model-assisted interpretation). All four are probed by
`omniforge doctor`, produce typed blockers with setup instructions, and have
executable opt-in tests that run the moment the prerequisite exists.

### Final SHAs and CI (exact, this session)

- Mission commit: `2e9afaa` (full universal upgrade; 237 tests).
- `2e9afaa` CI startup_failure: the browser-E2E step name contained an unquoted
  `: ` — invalid YAML (caught because the run had 0 jobs and the workflow name
  rendered as the file path). Fixed in `536b302` (step name quoted; all four
  workflow files validated with a YAML parser locally).
- `536b302` CI failed at Test: the REA binary-analysis test assumed no docker,
  but GitHub runners provide docker — an environment-dependent assumption.
  Fixed in `9608efc` by injecting a deterministic sandbox probe into
  `planAnalysis` (no-runtime refusal + with-docker acceptance both covered on
  any host; 238 tests).
- **Final: `9608efc` — CI success on `main`, including the REQUIRED-mode
  browser E2E step (real chromium on the runner).** Total: 3 pushes, zero
  re-runs, zero forks, read-only API calls otherwise; docs-only updates ride
  the `**.md`/`docs/**` paths-ignore (no CI minutes).


## 2026-11-01 — surgical integration

Base f2fd9b6af988bf844d63faf95f411eba14c4c27a; final executable source
5bc15138561c57220b2bd34f25ec573f0d444f51. Audit and measured I01–I16 ledger:
docs/audits/2026-11-01-surgical-integration.md and
2026-11-01-surgical-handoff.md.

Implemented canonical goal resolution into effective intent/blueprints/routing;
explicit model policy and shared durable pre-call budgets; actual CodingBackend
DAG tasks with staging, measured new/untracked diffs and independent acceptance;
structural analysis CLI/workspaces/reports/export; the same scoped engine for
general modification/repair; outcome/CLI exit/delivery corrections; detached
provenance and common workspace command governance. A concrete offline OpenCode
container driver is contract-tested with an injected runtime, not a live model.

Additional evidenced fixes: Windows gateway path suffixes; actual dashboard
artifact name; bounded Windows atomic-rename retries; linked CLI entrypoints;
thrown-outcome reporting and workspace-lease recovery on resume. No assertions
were removed to conceal failures. Existing templates, skills, U-series and
LangGraph/checkpoint contracts are retained. The lockfile changed only for the
verification-to-gateway workspace dependency, without version upgrades.

Measured local validation: pnpm verify PASS (lint, typecheck/build, 254 tests in
30 files, CLI E2E and actual Chromium); required browser mode PASS; deliberately
missing browser correctly exits nonzero. Final linked-entrypoint correction:
affected CLI/integration suite 26/26 PASS. Final outcome/lease changes: lint,
typecheck/build and 37/37 affected tests PASS; freshly rebuilt cross-process and
source resume suites 11/11 PASS. The newly added linked-entrypoint test belongs
to final CI; the earlier full local count is not artificially increased here.

CI baseline independently retrieved: 41203874904 success at 9608efc; its two
prior failures are historical, not active incidents. No reruns or heavy workflow
dispatches. New PR-head CI is reported in PR Checks and the final task response.
No paid model calls, hosting/deployment/payments, forks, force pushes or history
rewrites. The provided GitHub credential is authentication-only and excluded from
all repository files, commits, workflow configuration and PR content.

Live model/container smoke remains BLOCKED (no opencode, Docker or Podman on this
host). Arbitrary behavioral analyses and composite dependency execution without
explicit contracts remain typed blockers. No universal live-AI/production claim.


### First PR CI incident and correction

PR #2 first head 998bf9450067517dacfb99472cc7e91785b2e723:
run 41298995303 failed only the generated agent-MVP acceptance case (254 pass,
1 fail); install, lint, typecheck and build passed. No blind rerun was requested.
Windows Node 22 reproduction passed. The generated command runner now binds Node
to process.execPath instead of relying on ambient PATH, with a no-PATH assertion;
failed suite stdout and DAG task details are surfaced for actionable diagnostics.
Lint/build and Node 22 acceptance+surgical suites passed 22/22. Corrected code:
dcaaeac3944b1d6b425996189926a771ca3d9596. New exact-head Linux CI is required before
claiming the incident resolved; its retrieved result is in the final task response.
