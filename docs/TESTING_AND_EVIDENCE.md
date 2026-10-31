# Testing and evidence

Testing is evidence: a task is complete only when a reproducible check passes
and an `Evidence` record exists.

## Repository-level verification

```bash
pnpm verify    # pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm e2e
```

- `lint` — eslint across the monorepo.
- `typecheck` — `turbo run typecheck`.
- `test` — `vitest run`, covering colocated package unit tests plus the root
  suites: `tests/integration/cli.test.ts` (CLI integration),
  `tests/routing-evals/routing.test.ts` (acceptance-table cases A01–A12),
  `tests/acceptance/acceptance.test.ts`, and
  `tests/security/security.test.ts` (adversarial: path escape, injection,
  spend-gate).
- `build` — `turbo run build`.
- `e2e` — `node tests/e2e/run.mjs`.

## Template self-tests

Every generated project runs its own tests: each template ships `tests/`
(e.g. `templates/commerce-lite/tests/store.test.mjs`,
`templates/static-business/tests/site.test.mjs`) and the pipeline executes the
workspace's own test script against its rendered `dist/` during `execute` and
`omniforge test`.

## Evidence records

- `packages/shared-types` defines the versioned `Evidence` schema.
- Each run keeps a JSONL journal at `infra/runs/<run-id>/journal.jsonl`
  (one event per graph node) and appends evidence records to
  `evidence.jsonl` in the same run directory (`journal.append`).
- Verification checks re-derive each acceptance criterion from the closed
  `evidenceMethod` vocabulary (`file-exists`, `file-contains`,
  `run-project-tests`, `no-secrets`, `link-check`, `structure-check`), and
  `independentFinalVerification` produces the final verdict from that
  evidence.

## Honest statuses

Check statuses are `passed | failed | skipped`, and a run can end `blocked`
(e.g. repair budget exhausted). Skipped is a real, reported outcome: the e2e
harness detects browser availability and **skips honestly when Playwright
chromium is absent — never fakes results**. Unavailable capabilities surface
typed gaps (`E_*` errors), not simulations. Never delete assertions to make a
suite pass; never hardcode results.
