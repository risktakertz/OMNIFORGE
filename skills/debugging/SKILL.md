---
name: debugging
description: "Failure classification and bounded repair: smallest scoped fix, reproducible command, redacted logs, escalation on repeated identical failures."
version: 0.1.0
license: MIT
capabilities: [debugging, repair]
cost: free
---

# Debugging skill

Classify before repairing (test-logic / environment / permissions / missing-tool / external-api / resources / architecture / unverifiable). Bounded retries; repeated identical errors escalate instead of retrying forever. Re-run affected + regression tests after any fix. See packages/verification.classifyFailure.