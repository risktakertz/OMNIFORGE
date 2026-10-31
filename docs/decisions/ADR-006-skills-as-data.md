# ADR-006: Skills as data

- Status: Accepted
- Date: 2026-10-31 (bootstrap session, per AGENT_LOG.md M2)
- Context: `skills/omniforge/SKILL.md`, `scripts/gen-skills.mjs`,
  `packages/capability-registry`, `integrations/catalog.yaml`

## Context

OMNIFORGE adopts the Agent Skills specification: capabilities are described
by `SKILL.md` files with validated frontmatter. A tempting shortcut is to
treat writing a skill file as "installing" a tool. That would let a
description claim capabilities the host does not have, violating the
repository's honesty rule (`verified | configured | unavailable | blocked |
untested`).

## Decision

Skill packs are **generated data files**, validated by the registry — never
executable installers.

- Skill packs are generated under `skills/` by `node scripts/gen-skills.mjs`
  from a single table; 21 SKILL.md files plus an `.agents/skills` host shim
  exist as of the bootstrap session.
- `packages/capability-registry` performs Agent Skills frontmatter discovery
  and validation (unique IDs, reference integrity, metadata schema)
  **without executing untrusted files**.
- `omniforge skills list | inspect | validate` reports availability as data
  (`omniforge doctor` surfaces registry health); validation failures exit
  non-zero rather than being silently absorbed.

**Writing a SKILL.md never makes a tool operational.** A capability becomes
selectable only when the underlying toolchain/backend is real and smoke-tested
in this repository — e.g. the OpenCode backend "reports truthfully when the
CLI is absent; becomes selectable only after a live smoke task"
(`integrations/catalog.yaml`).

## Consequences

- No untrusted-file execution surface during discovery; the attack surface is
  limited to parsing.
- Availability claims are auditable: the registry, `doctor`, and the catalog
  must agree, and routing treats absent capabilities as typed gaps
  (`E_CAPABILITY_MISSING`), with structured fallbacks.
- Editing skills means editing the source table and regenerating; hand-edited
  SKILL.md files that drift from validation are flagged, not trusted.
