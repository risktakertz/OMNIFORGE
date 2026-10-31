# OMNIFORGE

**Turn one ordinary sentence into original, working, tested, exportable software — free-first, with honest capability statuses.**

OMNIFORGE is a TypeScript monorepo that takes requests like *"Create a website for my
bakery"* or *"Make a site like Amazon"* and produces a real, isolated, verified project —
a deterministic core (intent parsing in English + Swahili, product blueprints, a validated
Agent Skills registry, explainable routing, a policy gateway, durable orchestration,
verification with evidence) with LLM assistance as an optional layer, never a requirement.

> **Honesty first:** capabilities are labeled `verified` only after a smoke test in this
> repository. Everything else is `configured`, `untested`, or `blocked` — never simulated.
> Generating software never publishes anything. Zero spend by default
> (`FREE_FIRST_MODE=true`, `APPROVED_SPEND=0`).

---

## Quick start (beginner)

Prerequisites: **Node.js ≥ 20.11** and **pnpm 9** (`corepack enable && corepack prepare pnpm@9.15.9 --activate`).

```bash
pnpm install                 # workspace bootstrap (lockfile pinned)
pnpm build                   # compile all packages + the CLI

# environment & capability health (honest report)
node apps/cli/dist/index.js doctor

# one sentence → a real, tested website in projects/
node apps/cli/dist/index.js create "Create a responsive website for a local bakery"

# preview it (nothing was published — this is your machine only)
cd projects/<your-workspace> && npx serve dist

# package it as a standalone artifact with provenance
node apps/cli/dist/index.js export <project-id>
```

Or with the workspace linked: `pnpm exec omniforge --help`.

A complete generated example is committed under
[`examples/one-sentence-website/`](examples/one-sentence-website).

## What you can ask for

| You say | OMNIFORGE builds (v0.1) | Status |
| --- | --- | --- |
| "Create a website for a salon." | `static-business` — responsive site + contact + tests | verified |
| "Make a site like Amazon." | `commerce-lite` — catalog, search, cart, **mock** checkout, order history | verified |
| "Create a business dashboard." | `dashboard-lite` — KPIs, filters, SVG chart, role boundaries | verified |
| "Book appointments for my barbershop." | `booking-lite` — slots, WhatsApp confirmation (demo mode) | verified |
| "Create a simple 2D racing game." | `phaser-2d` — playable loop, pure logic tested in Node | verified |
| "Build my restaurant Android app." | `expo-mobile` scaffold — native builds need the Android SDK | blocked (honest) |
| "Make a basic 3D adventure game." | `godot-native` scaffold — engine validation needs Godot | blocked (honest) |
| "Generate a SaaS product I can customize for shops." | `next-web` white-label base + isolation tests | verified scaffold |
| "Create a REST API for orders." | `api` — strict TS, validated input, node:test suite | verified |

Full matrix with evidence pointers: [docs/CAPABILITY_MATRIX.md](docs/CAPABILITY_MATRIX.md).

## CLI

```text
omniforge doctor                         # environment, tools, models, skills health
omniforge skills list|inspect|validate   # capability registry operations
omniforge integrations audit             # licenses, statuses, versions, costs
omniforge models list                    # authorized providers + routing decision
omniforge plan "<request>"               # read-only intent, blueprint, routing, cost
omniforge create "<request>"             # build a product into projects/ (never publishes)
omniforge inspect <project-path>         # workspace structure + config
omniforge modify <project-path> "..."    # regression-safe scoped change
omniforge test <project-path>            # run the project's own checks
omniforge status <run-id>                # progress + evidence journal
omniforge resume <run-id>                # resume interrupted runs from durable checkpoints
omniforge export <project-id>            # standalone tar.gz + provenance + sha256
omniforge deploy <project-id> --dry-run  # free-first hosting plan (publishes nothing)
```

Every command accepts `--json` for machine-readable output. Exit code `2` = typed policy
error (e.g. `E_GATEWAY_PATH_ESCAPE`, `E_DEPLOY_BLOCKED`), `3` = validation failure.

## How it works

```text
request → intake → permission-check → interpret → research → specify → select
        → plan → prepare-workspace → execute → verify → (repair) → approve
        → package → deliver → report
```

- **Orchestration**: LangGraph.js (pinned `0.2.74`) with a **durable file-backed
  checkpointer** — interrupted runs resume exactly-once from disk (tested).
- **Routing**: deterministic eligibility → dependency/conflict resolution → explainable
  ranking → free-first risk/cost policy. Changing one word in the prompt changes the
  selection in provable ways (`tests/routing-evals`).
- **Policy gateway**: every write/execute/push/pay action is classified, path-confined
  (symlink-safe), spend-gated, and audited.
- **Verification**: each blueprint criterion maps to executable evidence
  (`file-exists`, `run-project-tests`, `no-secrets`, …) plus an independent final
  verifier that re-derives the verdict from collected evidence.
- **Skills**: 21 Agent Skills packs (`skills/`, `SKILL.md` + frontmatter) validated by the
  registry — loading instructions never makes a tool operational; statuses stay honest.

Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) ·
Agent instructions: [AGENTS.md](AGENTS.md) · Primary skill:
[skills/omniforge/SKILL.md](skills/omniforge/SKILL.md)

## Development

```bash
pnpm install
pnpm verify     # lint + typecheck + test (158 checks) + build + e2e
pnpm test       # vitest only
pnpm e2e        # built-CLI acceptance run
pnpm gen:skills # regenerate skill packs after editing scripts/gen-skills.mjs
```

CI is deliberately lean: `ci.yml` runs the full gate on push/PR (docs-only changes
skipped); `security.yml` scans monthly and on demand; heavy template builds
(Next/Astro/api) run only via `integration.yml` (workflow_dispatch); `release.yml` gates
tagged releases on the full verify. GitHub Actions is free for this public repository.

## Customizing generated products

Edit the workspace's `project.config.json` → `params` (business name, services,
contact, WhatsApp, theme colors, products, metrics …), then re-run
`node scripts/render.mjs` inside the workspace and `npm test`. `omniforge modify`
applies regression-safe scoped changes automatically (baseline → change → re-verify).

## Upgrade, FAQ, troubleshooting

- Upgrading: bump pinned versions in `integrations/lock.json`, re-run `pnpm verify`,
  update the catalog statuses — never mass-upgrade (`docs/OPERATIONS.md`).
- Generated products are independent; update them explicitly per project.
- FAQ & troubleshooting: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md),
  [docs/COST_AND_HOSTING.md](docs/COST_AND_HOSTING.md).

## Repository map

```
apps/cli          omniforge CLI (13 commands)      packages/*        16 focused packages
skills/           21 Agent Skills packs            integrations/     catalog, lock, adapters
templates/        11 product templates             tests/            integration, evals, acceptance, security
docs/             20+ documents + ADRs             examples/         committed generated example
.github/          lean CI/security/integration/release
```

## License & provenance

Framework code: **MIT** (see [LICENSE](LICENSE)). Upstream projects are integrated as
pinned dependencies, external tools, or documented adapters — **never forked or
vendored**; licenses and review status live in
[integrations/catalog.yaml](integrations/catalog.yaml) and
[docs/LICENSE_COMPLIANCE.md](docs/LICENSE_COMPLIANCE.md). Every template ships a
`THIRD-PARTY-NOTICES.md`. Security policy: [SECURITY.md](SECURITY.md).
