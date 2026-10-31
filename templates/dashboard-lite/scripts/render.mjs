#!/usr/bin/env node
// Renders dashboard-lite into dist/ (standalone, zero dependencies).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));
const readJson = (p) => (exists(p) ? JSON.parse(read(p)) : null);

const defaults = readJson("project.template.json") ?? {};
const generated = readJson("project.config.json");
const params = (generated && generated.params) || {};
const cfg = {
  ...defaults,
  ...params,
  dashboard: { ...(defaults.dashboard ?? {}), ...(params.dashboard ?? {}) },
  metrics: Array.isArray(params.metrics) && params.metrics.length ? params.metrics : defaults.metrics ?? [],
  roles: { ...(defaults.roles ?? {}), ...(params.roles ?? {}) },
};

const tokens = {
  LOCALE: cfg.locale || "en",
  DASHBOARD_NAME: cfg.dashboard?.name ?? "Sample Dashboard",
  ORG: cfg.dashboard?.org ?? "Sample Org",
  DASH_NOTE: cfg.dashboard?.note ?? "",
  YEAR: String(new Date().getFullYear()),
  PRIMARY: cfg.theme?.primary ?? "#0f766e",
  ACCENT: cfg.theme?.accent ?? "#f59e0b",
  BG: cfg.theme?.bg ?? "#fafaf9",
  TEXT: cfg.theme?.text ?? "#1c1917",
  CONFIG_JSON: JSON.stringify(cfg).replace(/</g, "\\u003c"),
};

mkdirSync(join(ROOT, "dist"), { recursive: true });
for (const f of ["index.html", "styles.css", "app.js", "dashboard-logic.js"]) {
  const out = read(join("src", f)).replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => tokens[k] ?? "");
  const dest = join(ROOT, "dist", f);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out, "utf8");
}
if (exists("THIRD-PARTY-NOTICES.md")) writeFileSync(join(ROOT, "dist", "THIRD-PARTY-NOTICES.md"), read("THIRD-PARTY-NOTICES.md"), "utf8");
console.log("rendered dist/ — run: npx serve dist");
