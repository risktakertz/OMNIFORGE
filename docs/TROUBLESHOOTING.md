# Troubleshooting

Common issues and their real causes. All errors are typed (`E_*` codes from
`packages/shared-types`) and printed as JSON on stderr with exit code 2.

## `pnpm: command not found`

Enable it via corepack (the repo pins `pnpm@9.15.9`), or install globally:

```bash
corepack enable pnpm        # recommended; doctor suggests exactly this
npm i -g pnpm               # alternative
```

`omniforge doctor` reports pnpm as `unavailable` with the same hint when it is
not on PATH.

## `E_GATEWAY_PATH_ESCAPE`

A write or file operation targeted a path outside the approved writable roots
(workspaces under `projects/`, `infra/runs/`, and the repo root). The policy
tool gateway (`packages/tool-gateway`) blocks symlink and traversal escapes.
Fix: keep writes inside the selected workspace and approved temp dirs — this
is a safety guarantee, not a bug.

## `E_WORKSPACE_LOCKED`

Another writer holds `.omniforge-lock.json` (30-minute TTL, holder-recorded).
Wait for the TTL to expire, or — only if you have verified the holder process
is dead — delete the lock file. `releaseLease` refuses to remove a lock held
by a different holder.

## `E_CAPABILITY_MISSING`

An honest gap: the requested capability, template, or workspace id is not in
the registry (e.g. unknown `skill:...` id, unmatched intent, missing
template). Fix: install the documented toolchain for that capability, or
extend the registry/skill table and regenerate packs with
`node scripts/gen-skills.mjs`. It is never resolved by simulation.

## `E_BACKEND_UNAVAILABLE`

No model or hosted-docs provider is reachable (Ollama not running, Context7
credentials absent, OpenCode CLI absent). The deterministic core — intent,
blueprints, routing, planning, generation, verification — still works without
any backend; adapters report this typed gap truthfully instead of pretending.

## Template test failures

A generated project must be rendered before its tests run. Inside the
workspace:

```bash
node scripts/render.mjs     # or: npm run generate
npm test
```

If tests still fail, the failures are real; fix the params or code rather
than deleting assertions.

## Node version mismatch

The repo requires `node >=20.11.0` (enforced in root `package.json`; CI uses
a compatible Node). `omniforge doctor` reports node as `blocked` below v20 —
upgrade Node and re-run the command.
