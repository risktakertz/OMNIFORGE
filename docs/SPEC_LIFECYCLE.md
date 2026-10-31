# Spec lifecycle

How a one-sentence request becomes a versioned, verifiable blueprint.

## 1. ProjectIntent

`packages/intent-engine` parses the request (English + Swahili lexicons) into
a `ProjectIntent` (Zod schema in `packages/shared-types`):

- operation and product-kind detection;
- **assumptions** — each with a confidence value; stated, never silently
  invented;
- **unknowns** — each with an impact level and the question that would resolve
  it.

Run `omniforge plan "<request>" --json` to inspect all of this read-only.
**Blocking unknowns must be surfaced before creation** (see
`docs/AGENT_WORKFLOWS.md`); the agent does not proceed on material unknowns
without the user.

## 2. ProductBlueprint

`packages/blueprint-engine` turns the intent into a `ProductBlueprint`:

- scope partitioned into **mvp / later / excluded**;
- acceptance criteria, each carrying an `evidenceMethod` drawn from a **closed
  vocabulary**: `file-exists:<path>`, `file-contains:<path>:<needle>`,
  `run-project-tests`, `no-secrets`, `link-check`, `structure-check`;
- a free-first cost estimate.

## 3. Verification evidence

`packages/verification` executes each criterion and records a check with an
honest status (`passed`, `failed`, `skipped`) plus a message, e.g. "5 internal
refs resolved" or "secret-like content in: dist/app.js". The orchestration
journal writes these records to `evidence.jsonl` under the run directory, and
`independentFinalVerification` re-derives the verdict from the run's own
evidence rather than trusting the builder's claim.

## 4. Independent final verifier

The final verdict is computed by a verifier that is independent of the
generation path, so a failed check can never be repackaged as a pass. Failures
are classified (missing-tool, etc.) with suggested actions, never masked.

## Where specs live today

Specifications currently live in code and contracts: Zod schemas in
`packages/shared-types`, blueprints in `packages/blueprint-engine`, and
decision records in `docs/decisions/`. The OpenSpec CLI adapter is recorded in
`integrations/catalog.yaml` with status `untested` (integration-mode
`cli-adapter`, adapter `integrations/adapters/openspec`) — documented, not yet
exercised.
