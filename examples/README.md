# examples/

Small, curated, committed artifacts that show what OMNIFORGE produces.

| Directory | What it is | How it was produced |
| --- | --- | --- |
| `one-sentence-website/` | Complete generated bakery site (source + rendered dist + tests + notices) | `omniforge create "Create a responsive website for a local bakery"` |

Other categories are generated on demand from templates rather than committed
(to keep the repository lean):

- **store-demo** — `omniforge create "Make a site like Amazon"` → commerce-lite
  (catalog, search, cart, mock checkout, order history)
- **mobile-demo** — `omniforge create "Build my restaurant Android app"` → Expo
  scaffold (native builds need the Android SDK — status honestly blocked)
- **game-demo** — `omniforge create "Create a simple 2D racing game"` →
  Phaser template with pure logic tests

Generated client work always lands in `projects/` (git-ignored); copy from
there into `examples/` deliberately if you want to commit a demonstration.
