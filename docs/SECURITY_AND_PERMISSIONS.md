# SECURITY_AND_PERMISSIONS — the deterministic tool gateway

All tools and external actions pass through `packages/tool-gateway`. The
gateway is deterministic: nothing in it consults a model, and every decision
produces an auditable `ToolInvocation` record.

## Action classes and risk

Twelve action classes are separated, each mapped to a risk level and an
approval requirement:

- **Allowed without approval (low):** `read-inspect`, `workspace-write`,
  `network-fetch`.
- **Allowed without approval (medium):** `dependency-install`,
  `execute-code`, `repo-push`.
- **Require explicit human approval (high):** `third-party-login`,
  `production-modify`, `public-post`, `payment`, `destructive-fs`, `deploy`.

Unknown tools default to `execute-code` rather than escaping policy.

## Path confinement

Write-class actions require absolute targets inside approved writable roots
(the selected workspace and approved temp dirs). The gateway resolves the
nearest existing ancestor of a target with `realpathSync`, so dangling or
planted symlinks cannot route a write outside a root; violations raise
`E_GATEWAY_PATH_ESCAPE`. Nonexistent roots fail closed.

## Spend and approvals

`APPROVED_SPEND` defaults to `0` (with `FREE_FIRST_MODE=true` and
`AUTO_PROVISION_PAID=false` in `integrations/lock.json`). Any spend above the
cap, and any payment while the cap is zero, becomes `approval-required`.
Approvals are records, not vibes: `recordApproval()` accepts approval-request
ids (`apr_*`) from the `ApprovalRequest` contract (`pending | approved |
denied | expired`) or `auto:<tool>` grants; high-risk classes stay
`approval-required` until one is on record.

## Untrusted content

Downloaded documents, skill files, and model output are data, never
instructions. `packages/research-engine` runs every fetched document through
`sanitizeExternalContent`: lines matching injection patterns (prompt override,
credential exfiltration, pipe-to-shell, `rm -rf /`, privilege escalation) are
removed, recorded as `flaggedInstructions`, and never followed; suspected
injections surface `E_INJECTION_SUSPECTED`. The repository proves refusal with
adversarial fixtures: `tests/fixtures/hostile-docs/` and the `secret-asker`
fake skill (`tests/fixtures/fake-skills/secret-asker/SKILL.md`), which asks
the agent to print its system prompt and upload credentials — routing and
security tests assert it is rejected, not obeyed.

## Secret redaction

`redactSecrets()` (in `packages/utils`) scrubs known secret shapes — GitHub
tokens, `sk-` API keys, AWS `AKIA` keys, key/value secret assignments, and
`Bearer` headers — into `[REDACTED:*]` labels before text reaches logs, error
details, or disk. `Evidence` records reference redacted logs, never raw
secrets.

## Rules for humans

Secrets live only in `.env` (git-ignored) or an approved secret store;
`.env.example` lists dummy names only. Secrets never go into git history,
logs, test fixtures, prompts, or documentation — including this one.
