# Deployment and rollback

## Generation is not publication

`omniforge create` builds and verifies a product in an isolated workspace
under `projects/`. It **never publishes** — the CLI help states this
explicitly, and the deployment package enforces it in code.

## Dry-run first

```bash
omniforge deploy <project-id> --dry-run
```

The dry-run (`packages/deployment` → `dryRunDeploy`) publishes nothing. It
reports free-first options, for example:

| Option | Cost note (as reported) |
| --- | --- |
| Cloudflare Pages (free tier) | 0 USD at current limits — reverify quotas and commercial terms before client deploys |
| GitHub Pages | 0 USD for public repos; private repos need a paid plan |
| Any static file host / existing nginx | 0 USD marginal cost on infrastructure you already own |

The report also lists required approvals ("explicit human approval for any
real deployment action") and warnings, including the rule that every
provider's current terms must be rechecked before recommending commercial
client use — historical free-tier assumptions are not accepted.

## Real deploys are typed-blocked

Without an approved host adapter and a recorded approval,
`omniforge deploy <project-id>` (without `--dry-run`) calls `executeDeploy`,
which throws `E_DEPLOY_BLOCKED`. This is a deliberate gate, not a missing
feature: publication happens only through an approved adapter once an
authorized human has approved the target and its commercial terms.

## Rollback

Every export under `infra/runs/exports/<id>/` is a self-contained `tar.gz`
with `provenance.json` (per-file sha256 manifest) and an archive-level sha256
checksum. Rollback therefore means: pick the previous exported artifact,
unpublish the current one at the host, and redeploy the earlier artifact
during an approved deploy. Because artifacts are content-addressed by
checksum, the rolled-back version is exactly the version that was verified.

## TLS, domains, backups

TLS certificates, domain configuration, and host-side backups are configured
at the hosting provider during the approved deploy step. OMNIFORGE does not
provision any of them on its own, and never spends money without an approval
record (see `docs/COST_AND_HOSTING.md`).
