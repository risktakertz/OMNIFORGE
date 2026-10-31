# Changelog

All notable changes to OMNIFORGE are documented here. Format based on
Keep a Changelog; versioning: semver, foundation releases until 1.0.

## [0.1.0] — 2026-10-31 — foundation release

### Added (M0 — safety, source audit, reproducibility)
- pnpm + Turborepo monorepo scaffold with strict TypeScript base config, ESLint
  (typescript-eslint flat), Vitest, `.env.example`, `.editorconfig`, `.gitattributes`.
- `integrations/catalog.yaml` + `integrations/lock.json`: 36 upstream projects with
  honest statuses and pinned versions; 13 adapter specs; third-party notices.
- Lean CI (`ci.yml`), monthly/on-demand security scans (`security.yml`), dispatch-only
  heavy template builds (`integration.yml`), tag-gated release (`release.yml`).
- `AGENTS.md` (cross-host agent contract), `AGENT_LOG.md` (durable state log).

### Added (M1 — real core engine and CLI)
- `packages/shared-types`: versioned Zod contracts (ProjectIntent, ProductBlueprint,
  TaskNode, Evidence, SkillSelection, ExecutionRun, …) + typed failure codes.
- `packages/intent-engine`: deterministic interpretation, English + Swahili lexicons,
  assumptions with confidence, unknowns ranked by impact.
- `packages/blueprint-engine`: per-kind scopes, architecture families, machine-checkable
  acceptance criteria, free-first cost estimates.
- `packages/orchestration`: LangGraph.js pipeline (15 nodes) with a durable
  file-backed checkpointer implementing the BaseCheckpointSaver contract; interruption
  resume verified exactly-once; run journal (JSONL) for status/evidence.
- `apps/cli`: `omniforge` with doctor, skills (list/inspect/validate), integrations
  audit, models, plan, create, inspect, modify, test, status, resume, export, deploy
  (`--json` mode everywhere; typed errors; human mode for beginners).

### Added (M2 — dynamic skills and engineering discipline)
- `packages/capability-registry`: Agent Skills discovery + frontmatter/reference
  validation without executing untrusted files; adversarial secret-solicitation blocking.
- `packages/skill-router`: hybrid deterministic routing with structured selection
  evidence, missing-capability gaps, free-first approvals policy.
- `packages/task-planner`: DAG with cycle detection, budgets, idempotency keys.
- `packages/tool-gateway`: 12 action classes, symlink-safe path confinement, spend
  gate at APPROVED_SPEND=0, approval records, full audit log.
- 21 generated skill packs + `.agents/skills` host shim (`scripts/gen-skills.mjs`).
- 20+ documents under `docs/` incl. six ADRs and an honest release manifest.

### Added (M3–M5 — delivered portions, honestly scoped)
- Zero-dependency product factories: `static-business`, `commerce-lite` (catalog,
  search, cart, mock checkout, order history), `booking-lite`, `dashboard-lite`.
- `phaser-2d` (playable, logic-tested), `godot-native`, `expo-mobile`,
  `tauri-desktop`, `next-web`, `astro-business`, `api` templates with self-tests.
- `packages/workspace-manager` (isolation, leases, export+provenance),
  `packages/verification` (evidence checks, failure classification, independent
  final verifier), `packages/deployment` (free-first dry-run, typed deploy gate),
  `packages/agent-runtime` (local executor; honest OpenCode stub),
  `packages/model-router` (env-based registry, requireVerified refusals),
  `packages/research-engine` (injection-sanitizing providers),
  `packages/observability` (redacting logger, run journal).
- Test suites: 158 checks across unit/integration/routing-evals (A01–A12)/acceptance/
  adversarial security/e2e; committed `examples/one-sentence-website`.

### Not included (honest)
- Studio web UI (optional per directive; CLI-first), SQLite checkpointer adapter,
  Playwright browser-verified e2e (wiring documented), Medusa/Supabase/shadcn
  integrations (catalogued, not installed), native mobile/desktop/game builds
  (blocked without local toolchains), real deployment execution (typed-blocked
  until an approved host + approval record).

[0.1.0]: https://github.com/risktakertz/OMNIFORGE/releases/tag/v0.1.0
