# Universal capability upgrade — source audit (2026-10-31)

Mission: surgical, backward-compatible upgrade of the existing OMNIFORGE monorepo per
`OMNIFORGE_UNIVERSAL_SKILL_AUTONOMY_UPGRADE_MASTER_PROMPT.md` (universal skill,
autonomous engineering, capability expansion). This audit was performed against the
actual current source at baseline HEAD `53dffd6` (merge of PR #1, CI green), not
against any earlier report. Labels: `CONFIRMED` (reproduced against source/remote),
`ALREADY_CLOSED` (directive requirement demonstrably implemented and tested —
evidence referenced, not reimplemented), `BLOCKED_HOST` (feasible code path
implemented; live proof needs an external prerequisite).

## Baseline (verified)

- Repo `risktakertz/OMNIFORGE`, default branch `main`, HEAD `53dffd6`, clean tree,
  origin in sync. CI+Release workflows green on this exact SHA (runs API, checked
  once, read-only).
- Local: Node 24.22.1, pnpm 9.15.9, git 2.47.3. `opencode` absent, `ollama` absent,
  `docker`/`podman` absent, no model credentials in env (names checked only).
  Playwright 1.57.0 devDependency + chromium 143 present (browser E2E ran in PR #1).
- Prior upgrades preserved: DAG-governed execution with durable ledger, verification
  contract v2 (original persisted criteria; critical skipped/blocked/not-run can
  never PASS), real OpenCode adapter (honest unavailable), novelty gate
  (`E_INTENT_NOVEL`), executable skill entrypoints via gateway, enforced execution
  policy (argv-only, allowlist, `E_SANDBOX_UNAVAILABLE`, scoped approvals),
  agent-MVP composition, cross-process resume, real browser E2E locally.

## Gap matrix (directive section → finding)

| # | Directive | Finding | Severity | Evidence / correction |
|---|---|---|---|---|
| G1 | §3.1 CodingBackend contract | `AgentTaskSpec` lacks task id, project context, bounded file scope enforcement, acceptance criteria, allowed tools, expected artifacts, risk/budget; contract lacks `prepare`/`cancel`/`streamEvents` (capability-flagged) | high | agent-runtime v3 added; fake-backend contract tests |
| G2 | §3.3 change detection | `collectDiff` requires `.git` — untracked/non-git workspaces report zero changes; smoke gate would mis-judge | high | baseline-manifest hash detection (git optional, never required) |
| G3 | §3.5 capability-aware selection | No selection layer between deterministic template and coding backend; no typed `NEEDS_MODEL`/`BACKEND_BLOCKED` decision record | high | `selectExecutionRoute()` + typed decisions + tests |
| G4 | §4.1 GoalSpec | No extensible GoalSpec (assets/repos, environment, NFRs, privacy, licensing, risks, budget, requested deliverables, acceptance criteria, unresolved questions) | high | versioned `GoalSpec` in shared-types; deterministic + model-assisted (schema-validated) construction |
| G5 | §4.2/4.8 model-assisted interpretation | Novel requests are honestly blocked, but no path exists that USES a model when one is available | high | `interpretWithModel()` hook, policy-immutable fields, fake-model tests; BLOCKED_HOST live |
| G6 | §4.3/4.4 capability metadata routing | Skills carry no machine-readable `operations` metadata; router is keyword-only; no operation-compatibility pass; no exceeds-scope typed blocker (a management app with data+roles can misroute to a static site) | high | frontmatter `operations:` + registry `findByOperation()` + router operation pass + `E_SCOPE_EXCEEDS_DETERMINISTIC` |
| G7 | §4.5 primitives | No composable architectural primitives with dependency constraints | medium | `blueprint-engine/primitives.ts` (17 primitives, dep/conflict graph, tests) |
| G8 | §4.6 non-code deliverables | `buildBlueprint` throws `E_NOT_IMPLEMENTED` for analyze/debug/test/deploy — no WorkBlueprint for audits/specs/reports | high | `buildWorkBlueprint()` multi-deliverable blueprints with per-kind evidence criteria |
| G9 | §4.9 prompt injection | Injection scan exists for research notes; none for third-party SKILL.md content / external docs | medium | `scanExternalInstructions()` applied by registry scan + tests |
| G10 | §5.1 CapabilityInvocation | Skill invocation is ad-hoc; no versioned invocation/result contract | medium | typed `CapabilityInvocation` records from `invokeSkill` |
| G11 | §5.3 passthrough abuse | Any unknown task operation silently maps to the `passthrough` executor and is marked passed | high | passthrough restricted to graph-phase whitelist; unknown operations fail the DAG |
| G12 | §5.5 typed handoffs | DAG tasks receive only workspace context; no artifact handoff records between tasks | medium | DAG artifact registry (`registerArtifacts`/`consumeArtifacts`) + report |
| G13 | §5.8 job graph report | No human+JSON report of selected capabilities, executors invoked, files changed, skipped/blocked prerequisites | medium | `buildJobGraphReport()` + `omniforge status` enrichment |
| G14 | §6.5 approval scope | `repo-push` classified `needsApproval:false` — directive requires approval gating for repo push | high | policy fix + regression test |
| G15 | §6.3 isolation provider | Sandbox probe detects docker/podman but nothing executes untrusted jobs inside a container; generated workspace scripts are executed on the host with no provenance trust check | high | container provider `runIsolated()` (real docker/podman exec when present, typed refusal otherwise) + template-provenance trust gate for workspace scripts |
| G16 | §7.1 generalized modify | `modify` accepts 7 config keys only; everything else `E_NOT_IMPLEMENTED` | high | repo-understanding pass + deterministic scoped transforms (add section/page/content) + backend handoff typed blocker; existing config behavior preserved |
| G17 | §9 REA | No `AnalysisPlan`, no authorization gate, no analysis→spec→original-implementation pipeline, no denial tests | high | research-engine REA module + toy-fixture equivalence test + authorization denials |
| G18 | §11.3 browser E2E required mode | `browser.e2e.mjs` exits 0 when chromium absent; no required-mode flag; CI never runs browser E2E | high | `OF_E2E_REQUIRED=1` mode (BLOCKED→exit 1); CI installs chromium (cached) and runs required mode |
| G19 | §11.8 CI health | ~~`ci.yml` trigger corrupt~~ RETRACTED on verification: the working-tree file contains the correct `branches: [main]`; an earlier terminal transcript that showed `branches: ain]` was a display artifact (the `[m` of `[main]` was consumed as an escape sequence in that transcript, not in the file). CI ran correctly on `main` pushes, consistent with the valid filter | none (retracted) | corrected during implementation after Read-tool verification |
| G20 | §12 U-matrix | No U01–U18 acceptance harness; adversarial set incomplete (hostile skill metadata, unexpected file changes, unauthorized REA) | high | `tests/acceptance/universal.test.ts` — real paths for deterministic scenarios, precise typed blockers elsewhere; never hardcoded switch-cases in the router |
| G21 | §14 SKILL.md | Entry skill documents only the create flow; analyze/modify/test/debug operations and delivery kinds not surfaced | low | SKILL.md updated with operation families + honest vocabulary (kept compact) |
| G22 | §8 integrations | Catalog statuses already honest (verified/configured/untested/blocked with reasons). MCP/Playwright-MCP remain `untested` — implementing an MCP client with no reachable server on this host would be a documented stub, violating the "no stubs for vanity counts" rule | accepted-gap | left honestly blocked; prerequisite documented |

## Non-goals (deliberate, evidence-preserving)

- No rewrite of packages/templates/tests that PR #1 already fixed (C4/C5/D1/C1/C2/C3/D2/E2 all verified present at `53dffd6`).
- No dependency upgrades beyond what is already pinned; `pnpm-lock.yaml` untouched.
- No fork/vendor of upstream repos; no paid services; `APPROVED_SPEND=0` preserved.
- Live OpenCode autonomy, container-isolated execution, and model-assisted
  interpretation are implemented with executable tests + fake backends and marked
  `BLOCKED_HOST`: the host has no opencode binary, no container runtime and no model
  credentials. Nothing is fabricated (directive §13 milestone discipline, §16).

## Remediation order (this mission)

M1 security/verification/CI (G14, G15, G18, G19, G11) → M2 backend contract v3
(G1, G2, G3) → M3 universal intent (G4, G5, G6, G7, G8, G9) → M4 execution (G10,
G12, G13) → M5 modify (G16) → M6 REA (G17) → M7 acceptance + docs (G20, G21).
Each milestone lands with tests; `pnpm verify` stays green before the push.
