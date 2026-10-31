# Example: one sentence → verified website

This site is the exact output of the M1 acceptance command, committed as a
curated example:

```bash
omniforge create "Create a responsive website for a local bakery"
```

Contents:

- `src/` + `scripts/render.mjs` — original template source and generator
- `project.config.json` — the workspace config OMNIFORGE wrote for this project
- `dist/` — the rendered, standalone site (open `dist/index.html`, or `npx serve dist`)
- `tests/site.test.mjs` — the project's own suite (`npm test` → 11 checks:
  tokens rendered, viewport, SEO, labels/alt/landmarks, links resolve, no secrets)
- `THIRD-PARTY-NOTICES.md` — license notices shipped with the deliverable

Verification during generation: all 6 blueprint acceptance criteria passed and
the independent final verifier confirmed the verdict from collected evidence.
Nothing was published — deployment is a separate, approved, dry-run-first step.
