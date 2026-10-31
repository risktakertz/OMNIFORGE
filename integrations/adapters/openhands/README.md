# openhands adapter

- **Mode:** Process adapter (Python server + HTTP API)
- **Status:** untested (honest vocabulary — see catalog.yaml)

## Purpose
Optional alternative execution backend.

## Enable
Run the official Python agent server; call it via its documented HTTP API from packages/agent-runtime. No JS SDK is invented.

## Smoke test
Server boot + one task round-trip + graceful shutdown.

## Notes
Off by default; FREE_FIRST_MODE applies to any usage it causes.
