# Operations

Day-to-day operation of the OMNIFORGE repository and CI.

## Local

```bash
pnpm verify        # lint + typecheck + test + build + e2e — run before every push
pnpm omniforge doctor   # environment/capability report (honest statuses)
node scripts/gen-skills.mjs   # regenerate skill packs after editing the table
```

CI runs the same gates, so a green local `pnpm verify` is the contract.

## CI on push (`.github/workflows/ci.yml`)

The lean CI workflow runs on push and pull requests and executes the same
stages as `pnpm verify`: lint, typecheck, test, build, and e2e. It is
intentionally lean, with documentation-only changes excluded (`paths-ignore`
for docs), to conserve GitHub Actions minutes.

## Security workflow (`.github/workflows/security.yml`)

- Monthly scheduled Trivy scan plus a secret scan.
- Also runnable on demand via `workflow_dispatch`.
- Trivy is catalogued in `integrations/catalog.yaml` as `configured`
  (adapter: `.github/workflows/security.yml`); it also runs locally when
  installed (`omniforge doctor` detects it).

## Integration workflow (`.github/workflows/integration.yml`)

Dispatch-only, on-demand builds for the heavy templates (`astro-business`,
`next-web`, `api`). These install real toolchain dependencies and verify full
builds; keeping them off the default push path conserves CI minutes. Template
self-tests in the default path report honestly when dependencies are not
installed (skipped, with the reason).

## Release workflow (`.github/workflows/release.yml`)

Tag-triggered on `v*` tags; the current release is v0.1.0 (see
`docs/RELEASE_MANIFEST.md`).

## Cost posture

- GitHub Actions is free for this public repository; the practical cost is
  minutes, so workflows stay lean: docs excluded from CI, heavy template
  builds dispatch-only, no scheduled heavy jobs.
- All repo economics remain free-first: `FREE_FIRST_MODE=true`,
  `AUTO_PROVISION_PAID=false`, `APPROVED_SPEND=0` (see
  `docs/COST_AND_HOSTING.md`). No workflow triggers billable external
  services.

## Where things live (quick map)

Packages, CLI, skills, integrations, templates, and tests are mapped in
`AGENTS.md` § "Where things live"; run state lives under `infra/`
(`docs/DATA_AND_BACKUPS.md`).
