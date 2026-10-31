# phaser-2d template

Playable browser 2D game with a deliberate architecture split:

- `src/game-logic.js` — **pure rules** (movement, bounds, obstacles, collision,
  scoring, restart) with **zero dependencies**, unit-tested in Node.
- `src/game.js` — a thin Phaser 3 scene consuming those rules: player movement
  (arrows/WASD), obstacle collision ends the run, SPACE restarts, stars add
  bonus score.

Honest notes: Phaser loads from a CDN, so first load needs internet (config
`phaserUrl` can point to a self-hosted copy or npm-installed build). No export
to native is included — that is an optional later milestone. If the CDN is
unreachable the page shows a visible, honest fallback instead of a blank canvas.

```bash
npm run generate && npm test && npx serve dist
```

Customize via `project.template.json` / workspace `params`: title, description,
obstacle count, theme colors, `phaserUrl`.
