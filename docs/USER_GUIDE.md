# User guide

OMNIFORGE turns one ordinary sentence into a working, tested, exportable software
product — locally, deterministically, and free-first.

## Prerequisites

- Node.js >= 20.11 (the root `package.json` enforces `node >=20.11.0`).
- pnpm 9, enabled through corepack: `corepack enable pnpm` (the repo pins
  `pnpm@9.15.9` via `packageManager`).

## Setup

From the repository root:

```bash
pnpm install               # bootstrap the workspace
pnpm build                 # build all packages (turbo run build)
node apps/cli/dist/index.js doctor   # environment and capability report
```

`doctor` prints an honest health table (node, git, pnpm, npm registry, optional
tools, backends, models, skill registry, free-first policy). Statuses are
`verified | configured | unavailable | blocked | absent` — nothing is simulated.

## Create your first product

```bash
omniforge create "Create a responsive website for a local bakery"
```

The pipeline (interpret, research, specify, select, plan, prepare-workspace,
execute, verify, approve, package, deliver, report) builds an original site in
an isolated workspace under `projects/`. It prints the run id, workspace path,
verification results, and an independent verifier verdict. Creation never
publishes anything.

## Preview

Open `<workspace>/dist/index.html` in a browser, or serve it:

```bash
npx serve <workspace>/dist    # http://localhost:3000
```

## Customize

Edit the `params` object of the generated `project.config.json` (business,
services, contact, theme, seo), then re-render and re-test inside the
workspace:

```bash
node scripts/render.mjs
npm test
```

Small scoped edits can also be made regression-safe with
`omniforge modify <project-path> "set business.name Kali Salon"` (supported
keys: `business.name`, `business.tagline`, `theme.primary`, `theme.accent`,
`contact.phone`, `contact.email`, `contact.whatsapp`).

## Export

```bash
omniforge export <project-id>
```

Produces a standalone `tar.gz` plus `provenance.json` and a sha256 checksum
under `infra/runs/exports/`. Unzip it anywhere; it has its own README.

## Publishing rule

Generation and publication are separate. Publishing requires
`omniforge deploy <project-id> --dry-run` first, which prints free-first
hosting options and required approvals; a real deploy is typed-blocked
(`E_DEPLOY_BLOCKED`) until an approved host and approval record exist.
