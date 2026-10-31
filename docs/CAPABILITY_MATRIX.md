# CAPABILITY_MATRIX — product categories, honest status today

Statuses use the shared vocabulary (`verified | configured | unavailable |
blocked | untested`) per `skills/omniforge/references/capabilities.md`:
templates shipped with passing tests are verified. "Verified" always means
smoke-tested in this repository; nothing is simulated.

| Product category | Template | Status today | What works now | Honestly blocked and why |
| --- | --- | --- | --- | --- |
| Website (standard) | `static-business` | verified (template tests + browser E2E) | Generation, render to `dist/`, dependency-free tests, export, **real chromium interactions (render, nav anchors, contact form, mobile viewport)** | — (browser E2E green where chromium exists; honestly BLOCKED elsewhere) |
| Website (content-heavy) | `astro-business` | configured | Template + structure tests; astro ^5.2.5 pinned | Install/build proven only via the on-demand dispatch integration workflow |
| Web app | `next-web` | configured | Template + structure tests; next ^15.1.6 / react ^19.0.0 | Same on-demand build model; hosting terms rechecked at deploy time |
| Commerce storefront | `commerce-lite` | verified (template tests) | Catalog, search, cart, mock checkout, order history | Real payments: `APPROVED_SPEND=0`, no credentials; Medusa path untested |
| Booking | `booking-lite` | verified (template tests) | Services, slot logic, WhatsApp deep-link, demo mode | Reminders/payments need the approved automation adapter |
| Dashboard | `dashboard-lite` | verified (template tests) | Generation, render step, dashboard logic tests | Deeper analytics is later scope, not claimed |
| 2D browser game | `phaser-2d` | verified logic tests | Pure game-logic modules pass node tests; Phaser CDN 3.80.1 pinned | Browser loop not e2e-verified without a browser; CDN is runtime-external |
| 3D native game | `godot-native` | blocked | Real Godot project structure + structure tests | Godot binary absent; engine stays outside the pnpm/turbo graph |
| Mobile | `expo-mobile` | blocked | Real Expo scaffold + structure tests (expo ~53.0.0, react-native 0.79.1) | Builds need Android SDK locally or paid EAS; iOS needs Mac + certificates |
| Desktop | `tauri-desktop` | blocked | Real Tauri 2 scaffold + structure tests | Rust toolchain required; signing is a separate approved milestone |
| API / automation | `api` (+ automation adapter) | verified (template tests); automation configured | Zero-dependency Node HTTP API: `/health`, validated CRUD, node:test suite | Real deploy/automation needs approved credentials; Coolify blocked (no free server) |
| SaaS (multi-tenant) | `saas` composition guide, base `next-web` | blocked | White-label foundation with honest roadmap note | Auth, tenant isolation (RLS), billing not implemented yet |
| AI coding agent (cloud-ready MVP) | `generator:agent-mvp` | verified (composed + self-tested + exported) | One-sentence request composes an ORIGINAL agent: CLI loop (plan→edit→test→diff→checkpoint), pluggable model adapter (honest MOCK offline), exactly-once journal, credential-gated GitHub adapter, allowlist sandbox, scoped approvals, own passing suite | Live AI behavior needs an authorized model credential; hosted multi-user service is a separate approved milestone |

Cross-cutting (autonomy mission): the task plan GOVERNS execution
(`executeDag` + durable `dag-state.json`, idempotent resume); repair is
evidence-driven and bounded (deterministic fixers, typed blockers
E_REPAIR_NONIMPROVING / E_MODEL_UNAVAILABLE); verification contract v2 —
original acceptance criteria are persisted per workspace and critical
skipped/blocked/not-run checks can never produce a PASS; selected skills with
executable entrypoints really run through the gateway; execution isolation
probes docker/podman and refuses untrusted host execution without a container
(E_SANDBOX_UNAVAILABLE); approvals are action-, target- and run-specific.
Browser E2E is a real Playwright suite (`tests/e2e/browser.e2e.mjs`) that runs
where chromium exists and reports BLOCKED honestly where it does not.

---

## v0.2.0 additions — universal capability upgrade (2026-10-31)

The sections below record the universal-upgrade mission additions with their
evidence, using the same honest vocabulary.

| Capability | Status | Evidence | Honest limits |
| --- | --- | --- | --- |
| Universal GoalSpec contract (§4.1) | verified | `packages/shared-types` GoalSpec schema; `packages/intent-engine/src/goal.ts`; intent-engine tests | model-assisted interpretation activates only with an authorized provider credential |
| Model-assisted interpretation hook (§4.2) | verified (code path) / BLOCKED_HOST (live) | `mergeModelGoalSpec` policy-immutability tests; `packages/model-router` `buildModelInterpreter` (activates only when a key exists) | no model credentials on this host — live interpretation stays typed-blocked, never faked |
| Machine-readable capability operations (§4.3/§4.4) | verified | SKILL.md `operations:` + registry `findByOperation()`; router excludes non-matching operations with explicit reasons | untagged skills default conservatively (declared defaults in registry) |
| Composable primitives (§4.5) | verified | `packages/blueprint-engine/src/primitives.ts` (19 primitives, dep/conflict graph); primitives tests | primitives without deterministic impls report `modelRequired` honestly |
| Non-code work blueprints (§4.6) | verified | `buildWorkBlueprint` (analysis-report / behavior-spec / test-harness / migration-plan / comparison-study) with executable evidence criteria | unsupported deliverable kinds → typed E_DELIVERABLE_UNSUPPORTED |
| Composite decomposition (§4.8) | verified | `decomposeComposite` tests; recorded in run journals | per-part execution is sequential today |
| Prompt-injection scanning of skill content (§4.9) | verified | `scanExternalInstructions` + registry blocks hostile SKILL.md (adversarial test) | heuristic patterns; adversarial evasion remains possible |
| CodingBackend v3 contract (§3.1) | verified (contract + fake backends) | task id/context/scope/criteria/budget fields; `features()` flags; prepare/cancel | live OpenCode execution BLOCKED_HOST (no binary/model) |
| Baseline-manifest change detection (§3.3) | verified | `snapshotManifest`/`diffManifests` — untracked counts, no git repo required | bounded depth 8 / 5000 files |
| Capability-aware execution routing (§3.5) | verified | `selectExecutionRoute` typed decisions: template / backend / E_NEEDS_MODEL / E_BACKEND_BLOCKED | selection is policy-deterministic; model quality is not evaluable without a model |
| Container isolation provider (§6.3) | verified (refusal path) / BLOCKED_HOST (real containers) | `runIsolated` composes real docker/podman argv (no-network default, non-root, bounded CPU/mem/pids); typed refusal without runtime | no docker/podman on this host — containerized execution untested live |
| Script provenance trust boundary (§6.2) | verified | `scriptTrust` (template byte-identity + compose-time provenance manifest); tampered scripts refused or containerized; `runWorkspaceScript` gates every workspace script execution | manifest + files tampered together is detectable only via repo re-verification |
| repo-push approval gating (§6.5) | verified | ACTION_RISK `repo-push` needsApproval; scoped-approval regression test (incl. path-normalization bypass attempt) | — |
| Generalized modify (§7.1) | verified | `add service` / `add section` / `change text` transforms + understanding pass + rollback manifest + baseline regression re-verify; typed E_NEEDS_MODEL handoff beyond scope | arbitrary edits still require a model-backed backend |
| Authorized REA pipeline (§9) | verified (toy fixture) | `planAnalysis` authorization gate + denials (DRM/circumvention, missing evidence, binary-without-sandbox); `analyzePricingFixture` behavior probe → spec → ORIGINAL implementation → equivalence test (piecewise-linear archetype) | one supported archetype today; other targets → typed NEEDS_MODEL |
| Typed DAG handoffs (§5.5) | verified | `registerArtifact`/`requireArtifacts` + durable ledger rebuild on resume | — |
| Job-graph report (§5.8) | verified | `buildJobGraphReport` + `omniforge status` enrichment (tasks, handoffs, verification, blockers) | — |
| U01–U18 acceptance harness (§12) | verified | `tests/acceptance/universal.test.ts` — real executed paths (U01/U02/U04/U07/U09/U11/U12/U13/U14/U18) + precise typed blockers (U03/U05/U06/U08/U15/U16/U17) + adversarial additions | live model/toolchain scenarios assert blockers, never completion |
| Browser E2E required mode (§11.3) | verified | `OF_E2E_REQUIRED=1` flips BLOCKED→exit 1; CI installs chromium (cached) and runs required mode | — |
