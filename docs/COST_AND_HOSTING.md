# Cost and hosting

The economics defaults live in `.env.example` and are enforced by the policy
gateway:

```bash
FREE_FIRST_MODE=true
AUTO_PROVISION_PAID=false
APPROVED_SPEND=0
```

`omniforge doctor` reports a `free-first` row showing these values, and flags
the configuration as `blocked` if free-first is disabled with a non-zero
`APPROVED_SPEND`.

## What is genuinely free locally

Everything in the creation path. Intent parsing, blueprints, routing,
planning, workspace creation, rendering, project self-tests, verification,
checkpointing, and export run deterministically on your machine with zero
dependencies at runtime for the shipped factories and zero network calls for
the generated products. No API key is required; model providers
(`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, Ollama) are optional and empty by
default.

## Hosting options — re-verify terms first

`omniforge deploy <project-id> --dry-run` prints free-first options with
their own warnings. The rule: **never rely on historical free-tier
assumptions** — recheck the provider's current quotas and commercial terms
before recommending or performing a client deploy.

| Option | Reported cost note |
| --- | --- |
| Cloudflare Pages (free tier) | 0 USD at current limits — reverify quotas and commercial terms before client deploys |
| GitHub Pages | 0 USD for public repos; private repos need a paid plan |
| Existing nginx / static host you own | 0 USD marginal cost on infrastructure you already own |

## Paid items to watch

- **EAS cloud builds** (Expo): local mobile builds need the Android SDK;
  EAS builds are paid — the catalog records expo as `cost: conditional`.
- **Code signing** (e.g. Tauri desktop): a separate approved milestone.
- **Domains**: registration and renewal are always billable.
- **Managed databases** (e.g. Supabase beyond local dev): recorded
  `cost: conditional`; not bundled into templates.

## The dry-run-then-approval flow for any spend

1. `omniforge deploy <project-id> --dry-run` — free report, nothing published.
2. Review options, warnings, and `approvalsRequired` (explicit human approval
   for any real deployment action).
3. Only with an approved host and a recorded approval does a real deploy
   become possible; until then `executeDeploy` throws `E_DEPLOY_BLOCKED`.
4. TLS, domains, and host-side backups are configured at the host during that
   approved deploy.

No billable action is ever triggered without an explicit approval record.
