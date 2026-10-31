#!/usr/bin/env node
// Renders phaser-2d into dist/. Phaser itself loads from CDN at runtime.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const readJson = (p) => (existsSync(join(ROOT, p)) ? JSON.parse(readFileSync(join(ROOT, p), "utf8")) : null);

const defaults = readJson("project.template.json") ?? {};
const generated = readJson("project.config.json");
const params = (generated && generated.params) || {};
const cfg = { ...defaults, ...params };

const tokens = {
  GAME_TITLE: cfg.game?.title ?? "Star Dash",
  GAME_DESCRIPTION: cfg.game?.description ?? "Dodge, collect stars, beat your best.",
  BG: cfg.theme?.bg ?? "#fafaf9",
  TEXT: cfg.theme?.text ?? "#1c1917",
  PRIMARY: cfg.theme?.primary ?? "#0f766e",
  PHASER_URL: cfg.phaserUrl ?? "https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js",
  CONFIG_JSON: JSON.stringify(cfg).replace(/</g, "\\u003c"),
};

mkdirSync(join(ROOT, "dist"), { recursive: true });
for (const f of ["index.html", "game.js", "game-logic.js"]) {
  const out = read(join("src", f)).replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => tokens[k] ?? "");
  const dest = join(ROOT, "dist", f);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out, "utf8");
}
if (existsSync(join(ROOT, "THIRD-PARTY-NOTICES.md"))) {
  writeFileSync(join(ROOT, "dist", "THIRD-PARTY-NOTICES.md"), read("THIRD-PARTY-NOTICES.md"), "utf8");
}
console.log("rendered dist/ — run: npx serve dist (needs internet for the Phaser CDN)");
