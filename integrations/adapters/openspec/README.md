# openspec adapter

- **Mode:** CLI adapter
- **Status:** untested (honest vocabulary — see catalog.yaml)

## Purpose
Versioned spec/change lifecycle as the single source of truth for blueprints and acceptance criteria.

## Enable
Install the OpenSpec CLI, run its init against this repository, point `docs/decisions/` intake at it.

## Smoke test
Create a sample change -> list -> validate -> archive, asserting the CLI exit codes.

## Notes
Until wired, spec lifecycle is file-based (blueprints + tests) — documented honestly as untested.
