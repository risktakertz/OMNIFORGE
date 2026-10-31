# ADR-001 — Deterministic core first, LLM assistance as an optional layer

**Status:** Accepted (bootstrap, 2026-10-31)

## Context

Agent-built software typically leans on live LLM calls from the first line of
code. That makes behavior expensive, flaky, and hard to test, and it produces
dishonest failure modes: when a model is missing or wrong, the system either
hallucinates success or degrades silently. OMNIFORGE's rules require honest
statuses, evidence-backed completion, and free-first economics
(`APPROVED_SPEND=0`), which a model-dependent core cannot guarantee.

## Decision

The vertical slice is deterministic end to end and works with zero models:

- `intent-engine` parses requests with English + Swahili lexicons — no
  inference call.
- `blueprint-engine`, `skill-router`, and `task-planner` are pure functions
  over validated contracts.
- `tool-gateway` policy is rule-based, never model-consulted.
- `orchestration` runs the LangGraph graph with injected services so tests can
  force failures and verify bounded repair and resume.

LLM assistance is layered on top through `packages/model-router`: profiles
(`cheap-summarization`, `code-generation`, `architecture`,
`security-review`), a registry derived from environment presence, and a
`deterministic-core` mode that engages whenever no verified model exists. Any
model output is untrusted input — validated before it affects a run.

## Consequences

- **Testable:** every node is reproducible in Vitest; resume and injected
  failure tests in `tests/orchestration` pass without network or keys.
- **Free:** the whole pipeline runs at zero cost, honoring `FREE_FIRST_MODE`.
- **Honest:** missing models surface as typed gaps (`no-model`, `blocked`),
  not silent degradation; high-risk profiles refuse unverified models.

The trade-off is a quality ceiling on interpretation and generation until
models are attached — but attaching one upgrades individual nodes without
changing the graph, the contracts, or the evidence discipline.
