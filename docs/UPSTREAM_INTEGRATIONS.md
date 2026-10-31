# UPSTREAM_INTEGRATIONS — no forks, honest statuses

OMNIFORGE consumes upstream projects without forking them and without copying
upstream source trees into this repository (rule 1 in `AGENTS.md`). An
integration enters as a dependency, CLI adapter, MCP adapter, methodology,
template, hosted API, or documented spec — and is recorded in
`integrations/catalog.yaml` plus `integrations/lock.json`.

## Source of truth and pinning

`integrations/catalog.yaml` is the authoritative record: name, upstream URL,
tier (C foundation / P prioritized / O optional / X evaluate-only), license,
integration mode, status, cost, adapter path, and notes. Resolved versions live
in `integrations/lock.json` (for example `@langchain/langgraph` 0.2.74,
`@langchain/langgraph-checkpoint` ~0.0.18, pnpm 9.15.9, turbo ^2.3.3, plus
template pins such as next ^15.1.6, astro ^5.2.5, expo ~53.0.0, tauri 2, and
the phaser-2d CDN build phaser@3.80.1). Uncontrolled `latest` is never used in
repeatable builds; updates follow the staged strategy in the lock (catalog
re-review → compatibility smoke → lock re-record → changelog).

## Integration modes in use

- **Library dependency:** langgraphjs via `packages/orchestration`.
- **Spec:** agent-skills-spec via `packages/capability-registry` (frontmatter
  parsing and validation; no execution during discovery).
- **CLI adapter:** openspec, repomix, opencode, maestro (adapter directories
  under `integrations/adapters/`).
- **MCP adapter:** playwright-mcp, rea (gateway interface is MCP-shaped).
- **Methodology:** gstack and superpowers are advisory only, never a second
  source of truth.
- **Template:** astro, nextjs, expo, tauri, phaser, godot.
- **Component copying:** shadcn/ui source is copied into generated React apps
  when used — never installed globally into OMNIFORGE.

## Status honesty

Statuses use the shared vocabulary (`verified | configured | unavailable |
blocked | untested`). **Verified means smoke-tested operational in this
repository.** Currently verified: `langgraphjs` (state graph + durable file
checkpointer, proven in `tests/orchestration`), `agent-skills-spec`
(frontmatter validation implemented), and `turborepo` (build/typecheck task
graph). Everything else stays honestly unverified: `configured` items
(gstack, superpowers, astro, nextjs, expo, tauri, phaser, trivy) are present
or loadable but not operationally proven here; `untested` items have a
documented path but have not been exercised; `blocked` items (rea, opencode,
context7, blender, electron, maestro, coolify, remotion) lack prerequisites
such as toolchains, credentials, or accepted terms — and are never simulated.
Each adapter's pending smoke test is listed in
`integrations/adapters/README.md`; a capability becomes verified only after
its smoke test passes in this repository.
