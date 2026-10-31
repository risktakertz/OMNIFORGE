# LICENSE_COMPLIANCE — what OMNIFORGE may ship and under which terms

The OMNIFORGE repository itself is MIT (see `LICENSE`). Every upstream
integration records its license in `integrations/catalog.yaml`, reviewed
against official sources at bootstrap (2026-10-31), and mirrors the
`SourceProvenance.licenseStatus` vocabulary: `reviewed | review-required |
incompatible`.

## Review-required integrations

Four entries are flagged `license: review-required` and must not be adopted
beyond advisory or adapter-documentation status until reviewed: **gstack**
(advisory methodology), **rea** (authorization-gated reverse-engineering
support), **context7** (hosted docs API with credentials and accepted terms),
and **opencode** (CLI adapter). Review is a prerequisite for their smoke tests,
not a formality after the fact.

## Special licenses

- **Medusa** — MIT open-core; enterprise directories are a separate license.
  Enterprise dirs must never be vendored into templates or exports.
- **Activepieces** — MIT community edition plus restrictive enterprise
  directories; only the community edition is eligible, and only when
  license-justified.
- **Remotion** — custom free/commercial eligibility policy; reviewed per use
  case before any adoption (currently blocked in the catalog).
- **Blender** — GPL-2.0-or-later; invoked strictly as an installed binary with
  no source vendoring. If an OMNIFORGE deliverable redistributes the Blender
  binary itself, the corresponding GPL obligations (source availability,
  license propagation) apply to that distribution.

Apache-2.0 entries (playwright, playwright-mcp, supabase, trivy, maestro,
coolify) retain their notice requirements; MIT entries dominate the catalog.

## Source-integration gate rules

1. Never paste proprietary or license-incompatible code into this repository,
   into templates, or into generated deliverables (`E_LICENSE_INCOMPATIBLE` is
   the typed failure for violations).
2. Every template ships a `THIRD-PARTY-NOTICES.md` (all current templates do;
   repository-level notices live in `integrations/third-party-notices/`), and
   generated exports carry provenance references.
3. No trademark use in deliverables: generated products must not present
   themselves as affiliated with third parties (for example, an "Amazon"
   brand) — names of real companies appear only as factual references, never
   as client-facing branding.

## Re-verification obligation

The catalog header requires licenses to be re-verified at every integration
update and version bump, using the staged update strategy in
`integrations/lock.json` (catalog re-review → compatibility smoke → lock
re-record → changelog; no mass upgrades).
