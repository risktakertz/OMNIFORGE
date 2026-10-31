# dashboard-lite template

Zero-dependency business dashboard over fixture data: KPI cards, region/channel
filters, dependency-free SVG trend chart, sortable table with CSV export, and a
**role boundary demo** (viewer vs admin) that is enforced in pure logic and
covered by tests — not just hidden with CSS.

Honest scope: the data source is fixture JSON. Replace it with a real, approved
backend before making any production claim (see `docs/CAPABILITY_MATRIX.md`).

```bash
npm run generate && npm test && npx serve dist
```

Customize via `project.template.json` / workspace `params`: dashboard name/org,
`metrics` rows (`{date, region, channel, revenue, orders}`), `roles` map
(`{canExportCsv, sections}`).
