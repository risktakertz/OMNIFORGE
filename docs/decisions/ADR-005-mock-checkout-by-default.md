# ADR-005: Mock checkout by default

- Status: Accepted
- Date: 2026-10-31 (bootstrap session, per AGENT_LOG.md M3)
- Context: `templates/commerce-lite/README.md`, `integrations/catalog.yaml`,
  `docs/COST_AND_HOSTING.md`

## Context

The commerce-lite factory ships a complete storefront MVP: catalog with
categories, search, product details, cart, and order history. Real payment
collection requires a payment provider account, credentials, PCI/compliance
steps, and commercial terms — none of which can exist by default in a
free-first, zero-credential system (`FREE_FIRST_MODE=true`,
`APPROVED_SPEND=0`).

## Decision

The commerce MVP uses a **loud mock checkout** by default: the flow is fully
testable end-to-end (cart → checkout → per-browser order history in
localStorage) but is clearly labeled as a mock and never touches money or
network calls. There are no hidden placeholders that could be mistaken for a
live payment path.

Real payments are **provider-agnostic approved milestones**: wiring a
specific provider (and its credentials, fees, and compliance obligations) is
a separate, explicitly approved step per project, never a default bundled
into templates.

## Consequences

- Generated stores are honest, testable, and safe to deliver without any
  billing relationship; `omniforge test` covers the mock flow.
- The continuation plan expands commerce toward Medusa open-core modules for
  multi-tenant stores **while keeping mock checkout as the no-credential
  default** (AGENT_LOG.md task 5).
- Provider selection stays open (no vendor lock-in): any real integration
  must pass the same blueprint acceptance criteria, free-first cost review,
  and approval gates as any other capability.
- Templates and docs must keep the mock visibly labeled so a client is never
  misled about what can and cannot collect payment.
