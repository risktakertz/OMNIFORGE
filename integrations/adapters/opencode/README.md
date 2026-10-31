# opencode adapter

- **Mode:** CLI execution adapter
- **Status:** blocked (honest vocabulary — see catalog.yaml)

## Purpose
Optional coding execution backend alongside the verified local executor.

## Enable
Install `opencode`, then `omniforge doctor` detects it; a live smoke task flips status to verified.

## Smoke test
One real task (create a file, run its test) via the documented CLI/API.

## Notes
OpenCode is an execution adapter, not an orchestrator; packaging/names changed across releases — verify the current CLI.
