# Contributing to OMNIFORGE

Thanks for helping build a system whose whole point is honesty about what works.

## Ground rules

1. **Never fork or vendor upstream projects.** Integrate via pinned dependencies,
   CLI adapters, MCP, or catalog entries (`integrations/catalog.yaml` + `lock.json`).
2. **Never commit secrets** — including in tests, fixtures, logs, or examples.
   `.env` is git-ignored; `.env.example` carries dummy names only.
3. **Honest statuses only.** A capability is `verified` only after a smoke test in
   this repo. If your change affects a capability's status, update
   `integrations/catalog.yaml` in the same PR.
4. **Evidence or it did not happen.** Behavior changes need tests. Do not delete
   assertions to make suites pass; do not fake verification output.
5. **Free-first.** Do not add flows that spend money without an explicit,
   approval-gated design (`packages/tool-gateway`).
6. **Generated products are isolated.** Templates change; delivered workspaces in
   `projects/` never mutate automatically.

## Workflow

```bash
pnpm install
pnpm verify        # lint + typecheck + test + build + e2e — must pass before every PR
```

- Regenerate skill packs with `node scripts/gen-skills.mjs` after editing the
  generator table — never hand-edit generated `skills/*/SKILL.md` files.
- Regenerate adapter docs with `node scripts/gen-adapters.mjs`.
- Package manifests come from `scripts/scaffold-packages.mjs`.
- Docs live in `docs/`; significant design choices need an ADR in `docs/decisions/`.

## Commit style

Small, descriptive commits (`feat(intent-engine): …`, `fix(gateway): …`,
`docs: …`, `test: …`, `chore: …`). CI runs on push to `main` and on PRs; heavy
template builds run on demand via the `integration.yml` workflow — please trigger
it when touching `templates/next-web`, `templates/astro-business`, or `templates/api`.

## Reporting security issues

See [SECURITY.md](SECURITY.md). Please do not open public issues for
vulnerabilities; use the private contact there.
