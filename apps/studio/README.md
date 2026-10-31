# apps/studio — planned (M5, optional)

Web Studio is intentionally **not built yet**. The directive makes it optional
and requires that it consume the same backend and persistent state as the CLI —
never a second orchestration engine.

Planned scope (read-only views first): new request, interpreted brief, selected
capabilities, task progress, approvals, logs, preview, delivery report.

The run journal (`infra/runs/<run-id>/journal.jsonl`), checkpoint store
(`infra/checkpoint-db/graph/`) and CLI JSON mode (`--json`) already expose every
datum the Studio will need. See `docs/ROADMAP.md`.
