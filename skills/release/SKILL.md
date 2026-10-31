---
name: release
description: "Export, versioning, changelog discipline, deployment dry-runs and rollback planning; releases gated on CI and acceptance evidence."
version: 0.1.0
license: MIT
capabilities: [release, export, deployment]
cost: free
---

# Release skill

Generate ≠ publish. Export produces standalone artifacts with provenance + checksums. Deployment: dry-run first, explicit approval, external health check after; no invented 'deployed successfully'. Tags only after CI + acceptance pass. See docs/DEPLOYMENT_AND_ROLLBACK.md.