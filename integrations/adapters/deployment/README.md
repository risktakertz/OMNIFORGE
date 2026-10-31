# deployment adapter

- **Mode:** Dry-run adapter
- **Status:** configured (honest vocabulary — see catalog.yaml)

## Purpose
Free-first deployment plans (static hosts, node hosts, Coolify when infrastructure exists).

## Enable
`omniforge deploy <project> --dry-run`. Real deploys require an approved host + explicit approval record; the execute path throws E_DEPLOY_BLOCKED until then.

## Smoke test
Dry-run report on every template family; external health check after any real deploy.

## Notes
Provider terms and commercial-use limits are re-verified at deploy time — no historical free-tier assumptions.
