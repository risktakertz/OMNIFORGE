# Workspace lifecycle

A **workspace** is the isolated directory where one generated product lives.
Everything below is implemented in `packages/workspace-manager`.

## Creation

- A workspace is created under `projects/` by copying a template directory
  from `templates/` (`createWorkspace`). The copy includes the template's
  scripts, tests, and `project.template.json`.
- The workspace gets its own `project.config.json` (with `id`, `templateId`,
  and `params`), a unique workspace id, and a lease.
- `projects/` is git-ignored (`.gitignore`: `projects/*`,
  `!projects/.gitkeep`), so generated client work is never committed by
  default; export is the deliberate sharing path.

## Lease / lock

- While a writer works, a lock file `.omniforge-lock.json` is written into the
  workspace. It records the holder, a timestamp, and `expiresAt`.
- The TTL is 30 minutes (`LOCK_TTL_MS = 30 * 60 * 1000`). A second writer
  calling `acquireLease` while a valid lock exists gets the typed error
  `E_WORKSPACE_LOCKED` naming the holder and expiry.
- Locks are holder-checked: `releaseLease` refuses to remove a lock held by
  someone else. After the TTL lapses, the stale lock no longer blocks a new
  acquirer.
- For example, `omniforge modify` acquires the lease as `cli-modify` and
  releases it in a `finally` block.

## Isolation guarantee

Template changes must never mutate previously delivered workspaces: a
workspace is a physical copy, so editing `templates/<name>` affects only
future creations. The generated product's verification is self-contained
(its own `npm test` against its own `dist/`).

## Export

`exportWorkspace` produces, under `infra/runs/exports/<id>/`:

- `<id>.tar.gz` — a standalone archive of the workspace;
- `provenance.json` — a manifest with per-file sha256 hashes, template id and
  timestamps;
- an archive-level sha256 checksum recorded on the `ReleaseArtifact`.

The exported project is self-contained: unzip anywhere and follow its README.

## Cleanup

Workspaces and run state live outside version control by design. Deleting a
workspace directory is safe once its export exists; the export plus
provenance is the durable record. `infra/runs/` is git-ignored as well, so
curated evidence that must be committed goes through `tests/fixtures`.
