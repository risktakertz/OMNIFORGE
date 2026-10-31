---
name: testing
description: "Evidence-based verification: acceptance criteria mapped to executable checks, honest skip/blocked states, regression discipline and an independent final verifier."
version: 0.1.0
license: MIT
capabilities: [testing, verification, evidence]
entrypoint: scripts/run-project-tests.mjs
cost: free
---

# Testing skill

A task is complete only with applicable evidence. Statuses: not run / skipped / blocked / failed / passed — explicit. Never delete assertions to pass. The independent final verifier re-derives the verdict from collected evidence, not implementer claims. See packages/verification.