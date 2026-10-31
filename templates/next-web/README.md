# next-web template

Interactive full-stack starter on Next.js 15 (App Router, React 19,
TypeScript strict): a client-side task list demonstrating honest local state —
no fake "production" data claims. Wire Supabase/Postgres only when the product
needs a real backend.

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # structural checks (no install needed)
npm run build    # full build (needs deps installed)
```

The integration CI workflow (workflow_dispatch) installs dependencies and runs
`next build` to verify this template periodically without consuming routine CI
minutes.
