# saas template (composition guide — v0.2 milestone)

Multi-tenant SaaS is composed, not duplicated: start from `next-web`, then add —
in separately tested milestones — authentication, tenant isolation (Postgres RLS
via the Supabase adapter), role-based admin, metering and a billing *interface*
(real billing needs an approved provider).

Why not a copy-paste template: the directive forbids pretending multi-tenant
security exists before it is implemented and tested. The composition path is
tracked in `docs/ROADMAP.md` (M3→M5) with acceptance tests
(`tests/acceptance/` — A10 client isolation).

Until then, `omniforge create "Generate a SaaS product I can customize for shops"`
produces the white-label foundation (branding, per-client config isolation) with
an honest note that auth/billing are roadmap items.
