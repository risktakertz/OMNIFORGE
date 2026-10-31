---
name: omniforge
description: "Primary OMNIFORGE entry skill. Use when any software-creation request arrives (websites, apps, APIs, games, automation): parse intent, produce a blueprint, route capabilities, build, verify and export via the omniforge CLI."
version: 0.1.0
license: MIT
capabilities: [orchestrate, intent-parsing, blueprint, routing, verification, export]
cost: free
---

# OMNIFORGE — primary skill

Turn a short, ordinary request into original, working, tested, exportable
software — free-first, with honest capability statuses.

## Workflow

1. Read the request; run `omniforge plan "<request>" --json` to see intent
   (English + Swahili), product blueprint, capability selection, missing
   capabilities and the zero-cost estimate. Nonblocking assumptions are stated,
   never silently invented.
2. If blocking unknowns exist (e.g. store publishing), surface them; do not
   proceed on material unknowns without the user.
3. Run `omniforge create "<request>"`. The pipeline: interpret → research →
   specify → select → plan → prepare-workspace → execute → verify (evidence per
   acceptance criterion) → approve → package → deliver → report.
4. Inspect the report. Preview per the printed instructions. Failures produce
   typed errors (E_*) with classification — never fabricated success.
5. Export with `omniforge export <project-id>` when the user wants a standalone
   artifact. Deployment is always a separate, approved, dry-run-first step.

See references/cli.md for commands, references/capabilities.md for status
vocabulary, references/security.md for the non-negotiables.
## References

- [cli.md](./references/cli.md)
- [capabilities.md](./references/capabilities.md)
- [security.md](./references/security.md)
