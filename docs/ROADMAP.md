# Roadmap

Milestone status honestly restated from `AGENT_LOG.md` (bootstrap session,
M0–M5). No dates; statuses match `integrations/catalog.yaml` vocabulary
(`verified | configured | untested | blocked`).

## Done — M0–M2 (verified)

- **M0:** repository scaffold (pnpm + Turborepo, strict TS, ESLint, Vitest),
  integration catalog and lock with honest statuses, lean CI workflows
  (ci.yml, security.yml, integration.yml, release.yml), `.env.example`,
  `AGENTS.md`.
- **M1:** versioned Zod contracts in `packages/shared-types`; intent engine
  with English + Swahili lexicons; blueprint engine (MVP/later/excluded,
  evidence methods, cost estimates); LangGraph.js orchestration with durable
  file checkpoints + verified resume; CLI command set
  (`doctor | skills | integrations | models | plan | create | inspect |
  modify | test | status | resume | export | deploy`); one-sentence website
  path producing a real, tested site in an isolated workspace.
- **M2:** capability registry (Agent Skills discovery/validation, no
  execution of untrusted files); skill router with explainable ranking;
  task planner (DAG, cycles, budgets, idempotency); policy tool gateway
  (path safety, spend gate, approvals, audit); 21 generated skill packs.

## Partial — M3

- Done: zero-dependency product factories (`static-business`, `commerce-lite`
  with catalog/search/cart/mock checkout/order history, `booking-lite`,
  `dashboard-lite`).
- Present but on-demand: `astro-business` and `next-web` templates with
  integration builds via workflow dispatch.
- Catalogued, not installed: shadcn/ui, Supabase, Medusa, Playwright MCP —
  all `configured`/`untested` in the catalog, never claimed as working.

## Scaffolds — M4 (blocked where toolchains are absent)

- `expo-mobile`, `tauri-desktop`, `phaser-2d`, `godot-native` templates exist
  with real structure and truthful verification: missing engines are reported
  `blocked/absent` by `doctor`, never simulated.

## Partial — M5

- Done: durable checkpoints/resume, workspace locks, approval gates, export
  with provenance, deployment dry-run, adversarial security tests, Trivy
  workflow.
- Not built: Studio web UI — optional per spec, CLI-first by decision.

## Next exact tasks

1. Playwright headless chromium wiring for browser-verified acceptance runs.
2. SQLite checkpointer adapter + benchmark against the file checkpointer.
3. `apps/studio` read-only UI over the run journal.
4. OpenCode/OpenHands live smoke tests against real CLIs when authorized.
5. Commerce factory expansion toward Medusa open-core modules, keeping mock
   checkout as the no-credential default.

No completion is claimed beyond what tests and the catalog record.
