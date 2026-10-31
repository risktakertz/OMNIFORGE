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
