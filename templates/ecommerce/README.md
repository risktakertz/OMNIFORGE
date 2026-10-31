# ecommerce template (composition guide)

- **Small catalog / demo store:** use `commerce-lite` (zero-dependency, mock
  checkout, order history) — selected automatically by the router today.
- **Serious commerce:** Medusa open-core modules via the documented adapter
  (see `integrations/adapters/commerce/`), installed only for products whose
  scope justifies it. License boundaries (open-core vs enterprise dirs) are
  recorded in `docs/LICENSE_COMPLIANCE.md`.

Real payment collection is provider-agnostic, sandbox-by-default, and always an
approved milestone (`docs/SECURITY_AND_PERMISSIONS.md`).
