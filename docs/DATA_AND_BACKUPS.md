# Data and backups

Where product data lives, and how it is protected.

## Generated products keep state client-side

In v0.1 the generated products are zero-dependency, zero-network static apps.
Persistent state is client-side: for example, the `commerce-lite` template
stores the cart and per-browser order history in `localStorage`, with no
server and no external calls. There is no server-side database to lose.

## Run state under `infra/`

- Run journals: `infra/runs/<run-id>/journal.jsonl` plus `evidence.jsonl`
  records — the durable record of what happened and which evidence passed.
- Checkpoints: `infra/checkpoint-db/graph/` (durable file-backed LangGraph
  checkpoints that power `omniforge resume`).
- Exports: `infra/runs/exports/<id>/` containing `<id>.tar.gz`,
  `provenance.json`, and sha256 checksums.

Per `.gitignore`, `infra/runs/` and `infra/checkpoint-db/*.sqlite*` are
git-ignored by default; exports are preserved on disk as the durable artifact
record. Evidence that must live in version control goes through curated
fixtures under `tests/fixtures`.

## Privacy posture

- Templates collect no PII and include no trackers, analytics, or external
  fonts (`templates/static-business/README.md`); commerce state stays in the
  visitor's browser.
- Logs are redacted: the CLI and tooling route messages through
  `redactSecrets`, and the gateway redacts targets in typed errors. Secrets
  belong in `.env` (git-ignored) or an approved secret store — never in
  journals, tests, or documentation.

## Backup guidance

- **Exported artifacts are self-contained.** A `tar.gz` export plus
  `provenance.json` is the complete product; copy it to any storage you
  control. The sha256 checksum lets you verify integrity later.
- **Run journals and exports live on local disk only.** If the machine is
  lost, `projects/` can be regenerated, but exports are the durable record —
  back them up externally when the delivery matters.
- **Host-side backups** (TLS, domains, scheduled backups) are configured at
  the hosting provider during an approved deploy — see
  `docs/DEPLOYMENT_AND_ROLLBACK.md`. OMNIFORGE never configures paid hosting
  services on its own.
