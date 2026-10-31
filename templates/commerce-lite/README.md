# commerce-lite template

A complete, honest MVP storefront with **zero dependencies and zero network
calls**: catalog with categories, search, product details, cart (localStorage),
**mock checkout**, and per-browser order history.

## Why mock checkout

Real payment collection requires an approved provider, credentials, and
compliance steps (see `docs/SECURITY_AND_PERMISSIONS.md`). This template ships a
clearly-labeled mock flow so the product is testable end-to-end without ever
touching money. Wiring a real provider is a separate, explicitly approved
milestone.

## Run

```bash
node scripts/render.mjs   # or: npm run generate
npm test                  # 11 logic + output tests
npx serve dist
```

## Customize

Edit `project.template.json` (or the generated workspace's
`project.config.json` → `params`): store name/tagline/currency/WhatsApp,
products (id, name, category, price, description, emoji). Re-render and re-test.

For larger catalogs, multi-user accounts or inventory backends, OMNIFORGE routes
to the Medusa-based path (see `docs/ROADMAP.md` and
`integrations/catalog.yaml`) — deliberately not bundled here.
