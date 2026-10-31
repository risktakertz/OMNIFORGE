# omniforge CLI reference

```
omniforge doctor                # environment + capability health (honest statuses)
omniforge skills list|inspect|validate
omniforge integrations audit   # licenses, status, cost
omniforge models list          # providers + routing decision
omniforge plan "<request>"     # read-only: intent, blueprint, routing, cost
omniforge create "<request>"   # build into projects/ (never publishes)
omniforge inspect <project-path>
omniforge modify <project-path> "set business.name ..."
omniforge test <project-path>
omniforge status <run-id>
omniforge resume <run-id>      # durable checkpoint resume
omniforge export <project-id>  # standalone tar.gz + provenance
omniforge deploy <project-id> --dry-run
```

Every command supports `--json` for machine-readable output. Exit codes: 0 ok, 2 policy/typed error, 3 validation failure.
