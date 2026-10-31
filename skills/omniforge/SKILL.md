---
name: omniforge
description: "Primary OMNIFORGE entry skill. Use when any software or digital-product engineering request arrives (websites, apps, APIs, games, automation, analysis, authorized inspection): parse the goal, produce a blueprint, route capabilities, execute, verify and export via the omniforge CLI."
version: 0.2.0
license: MIT
capabilities: [orchestrate, intent-parsing, blueprint, routing, verification, export]
operations: [create, modify, debug, analyze, test, deploy]
cost: free
---

# OMNIFORGE — primary skill

Turn a short, ordinary request into original, working, tested, exportable
software or a verified analytical work product — free-first, with honest
capability statuses. OMNIFORGE is a general-purpose engineering system, not a
template factory: unsupported work returns a precise typed blocker
(E_NEEDS_MODEL / E_SCOPE_EXCEEDS_DETERMINISTIC / E_AUTHORIZATION_REQUIRED),
never a wrong product.

## Supported operation families

- **create** — products from one sentence (websites, stores, booking, dashboards,
  games, APIs, agent MVPs). Novel domains need an authorized model backend.
- **modify** — regression-safe scoped changes to an existing workspace:
  `set <key> <value>`, `add service "<desc>"`, `add section <id> "<heading>"`,
  `change text "<from>" to "<to>"`. Anything broader returns E_NEEDS_MODEL
  with the coding-backend handoff path.
- **analyze** — authorized audits, behavior specs, comparisons (work blueprints;
  completion does NOT require building an app). REA requires a documented
  rights basis; circumvention targets are refused outright.
- **test / debug / deploy** — checks-only pass, evidence-driven bounded repair,
  approval-gated dry-run-first deployment.

## Workflow

1. Read the request; run `omniforge plan "<request>" --json` to see intent
   (English + Swahili), goal spec, product blueprint, capability selection
   (with WHY each capability was selected/excluded) and the zero-cost estimate.
2. If blocking unknowns exist (e.g. store publishing), surface them; do not
   proceed on material unknowns without the user.
3. Run the operation: `omniforge create|modify|test ...`. The pipeline:
   interpret → research → specify → select → plan → execute (DAG-governed) →
   verify against the ORIGINAL persisted criteria → package → deliver → report.
4. Inspect `omniforge status <run-id>` — the job graph shows tasks executed,
   typed handoffs produced, verification evidence and precise blockers.
5. Export with `omniforge export <project-id>`. Deployment is always a
   separate, approved, dry-run-first step.

## Truthful status vocabulary

`verified` (smoke-tested on this host) · `configured` (present, not yet
smoke-tested) · `untested` · `blocked` (needs X — X is named) · `unavailable`.
A local verified MVP ≠ a deployed service. Model-backed generation is
reported separately from deterministic results.

See references/cli.md for commands, references/capabilities.md for the status
vocabulary, references/security.md for the non-negotiables.

## References

- [cli.md](./references/cli.md)
- [capabilities.md](./references/capabilities.md)
- [security.md](./references/security.md)
