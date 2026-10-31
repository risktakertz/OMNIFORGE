# static-business template

Zero-dependency, responsive, accessible one-page business website. Original
code, MIT licensed — no copied assets, no trackers, no external fonts.

## Use it standalone

```bash
node scripts/render.mjs     # renders dist/ from project.template.json
npm test                    # runs the site self-tests against dist/
npx serve dist              # preview at http://localhost:3000
```

## Customize

Edit `project.template.json` (or the `params` object of the generated
`project.config.json`) and re-run `node scripts/render.mjs`:

- `business`: name, tagline, description
- `services`: list of `{name, description}` cards
- `contact`: phone, email, address, hours, `whatsapp` (international format, digits)
- `theme`: primary/accent/bg/text colors
- `seo`: page title + meta description

Everything renders to `dist/` — a fully standalone folder you can upload to any
static host. Deployment is a separate, explicitly approved step (`omniforge
deploy --dry-run` prints free-first options); generating never publishes.
