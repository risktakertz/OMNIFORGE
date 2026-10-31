# local-models adapter

- **Mode:** Local service adapter
- **Status:** untested (honest vocabulary — see catalog.yaml)

## Purpose
Ollama / llama.cpp inference when local hardware permits.

## Enable
Install Ollama or llama.cpp, pull a suitable model; model-router probes health.

## Smoke test
GET /api/tags + one small completion with latency recorded.

## Notes
Warn when local inference is too slow; never silently degrade high-risk results.
