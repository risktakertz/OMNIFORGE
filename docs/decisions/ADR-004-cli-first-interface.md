# ADR-004: CLI-first interface

- Status: Accepted
- Date: 2026-10-31 (bootstrap session, per AGENT_LOG.md)
- Context: `apps/cli`, `docs/ROADMAP.md`, `skills/omniforge/SKILL.md`

## Context

OMNIFORGE must serve two kinds of consumers: autonomous agents and machines
that need deterministic, parseable output, and non-technical humans who need
a readable, guided experience. A graphical Studio was an option, but M5 scope
marked it optional and the bootstrap session shipped the engine and CLI
first.

## Decision

The CLI is the first and primary interface. `apps/cli` exposes the full
command set (`doctor`, `skills`, `integrations`, `models`, `plan`, `create`,
`inspect`, `modify`, `test`, `status`, `resume`, `export`, `deploy`) with two
output modes over the **same backend**:

- `--json` for machines and agents — structured, stable payloads on stdout;
  typed errors as JSON on stderr with exit codes 0 / 2 / 3.
- Beginner (human) mode by default — readable tables and step-by-step
  instructions (e.g. `create` prints the workspace path, preview command,
  verification summary, and export command in plain language).

Every command path funnels through the same deterministic packages and the
policy tool gateway; there is no separate "human pipeline" and no separate
"agent pipeline".

## Consequences

- Agents integrate without scraping prose: `omniforge plan "<request>" --json`
  and `--json` everywhere are the machine contract.
- Beginners get the same guarantees with no extra surface to maintain.
- The future `apps/studio` becomes a thin read-only view over the same run
  journal (`infra/runs/<run-id>/journal.jsonl`), not a second orchestration
  engine — consistent with AGENTS.md's single-source-of-truth rule.
- Any new capability must land in the CLI (both modes) before any GUI exposes
  it.
