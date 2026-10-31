# ADR-002 — Zero-dependency static templates as the default

**Status:** Accepted (bootstrap, 2026-10-31)

## Context

Most requests resolve to a small business website, storefront, booking page,
or dashboard. A framework-first default would force an npm install, a build
toolchain, and supply-chain risk onto every delivery, and would make
generation slow, network-dependent, and costly to verify in CI.

## Decision

The default business templates — `static-business`, `commerce-lite`,
`booking-lite`, `dashboard-lite` — plus `phaser-2d` and `api` produce original
zero-dependency HTML/CSS/JS (and a dependency-free Node runtime for `api`):

- **Instant generation:** a `scripts/render.mjs` step materializes the product;
  no package installation is part of the create path.
- **No install:** verification runs dependency-free suites with plain node
  (`node:test`), so tests prove the product without fetching anything.
- **Works offline:** the delivered artifact is self-contained static files.
- **Free hosting:** static output deploys on any static host, matching
  free-first economics; contact and checkout flows stay in mock/demo mode
  until real credentials are approved.

For larger scopes, heavier stacks remain available and honestly labeled:
`astro-business` (astro ^5.2.5) for content-heavy sites and `next-web`
(next ^15.1.6, react ^19.0.0) for interactive full-stack apps. Their install +
build are verified on demand via the dispatch integration workflow to conserve
CI minutes, so they are `configured`, not verified-by-default. Medusa and
Supabase are never bundled into templates; multi-tenant and real-payment
paths are separately specced milestones.

## Consequences

- One-sentence requests to working, tested products in seconds, even offline.
- Framework conveniences (HMR, component ecosystems) are absent in lite
  templates by design; the escape hatch is explicit and pinned.
- Every template ships `THIRD-PARTY-NOTICES.md`, keeping the supply chain and
  attribution surface minimal and auditable.
