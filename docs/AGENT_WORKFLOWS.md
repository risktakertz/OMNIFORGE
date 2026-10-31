# Agent workflows

How an autonomous coding agent should operate inside OMNIFORGE.

## Contract and entry point

1. Read `AGENTS.md` first — it is the repository-level contract
   (no forks, no secrets, honest statuses, free-first economics, approval-gated
   destructive operations, writes confined to workspaces).
2. Use `skills/omniforge/SKILL.md` as the primary entry point for any
   software-creation request; its references (`references/cli.md`,
   `references/capabilities.md`, `references/security.md`) cover commands,
   status vocabulary and non-negotiables.

## The plan → create → verify loop

```bash
omniforge plan "<request>" --json     # read-only intent, blueprint, routing, cost
omniforge create "<request>"          # full pipeline into projects/
omniforge status <run-id>             # progress + journal events
omniforge resume <run-id>             # continue an interrupted run from durable state
omniforge test <project-path>         # project checks and tests
omniforge export <project-id>         # standalone artifact + provenance
```

Every command accepts `--json` for machine-readable output. Exit codes: 0 ok,
2 policy/typed error, 3 validation failure. If `plan` reports blocking
unknowns, surface them to the user before running `create`.

## Run journal

Each run writes `infra/runs/<run-id>/journal.jsonl` (durable JSONL events per
graph node) and `evidence.jsonl` records. `status` reads this journal; `resume`
replays from the durable file-backed checkpoint stored under
`infra/checkpoint-db/graph/`. Do not edit journal files by hand.

## Evidence discipline

A task is complete only when a reproducible check passes and an `Evidence`
record exists. Never delete assertions to make tests pass, never hardcode
results, never report a capability as verified when it is not. Skipped checks
(e.g. e2e without a browser) are reported as skipped, never faked.

## Exact continuation plan (from AGENT_LOG.md)

1. Install and smoke-test Playwright (headless chromium) for browser-verified
   acceptance runs; wire `tests/e2e` to use it when present.
2. Add a SQLite checkpointer adapter
   (`@langchain/langgraph-checkpoint-sqlite`) and benchmark it against the
   file checkpointer.
3. Implement `apps/studio` as a read-only view over the same run journal.
4. Verify OpenCode/OpenHands adapters against real CLIs when authorized.
5. Expand the commerce factory toward Medusa open-core modules for
   multi-tenant stores, keeping mock checkout as the no-credential default.
