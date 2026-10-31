#!/usr/bin/env node
// Renders the storefront into dist/ (standalone, no dependencies, no network).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const exists = (p) => existsSync(join(ROOT, p));

function readJson(p) {
  return exists(p) ? JSON.parse(read(p)) : null;
}
const defaults = readJson("project.template.json") ?? {};
const generated = readJson("project.config.json");
const params = (generated && generated.params) || {};
const cfg = {
  ...defaults,
  ...params,
  store: { ...(defaults.store ?? {}), ...(params.store ?? {}) },
  products: Array.isArray(params.products) && params.products.length ? params.products : defaults.products ?? [],
};

const store = cfg.store ?? {};
const tokens = {
  LOCALE: cfg.locale || "en",
  STORE_NAME: store.name ?? "Sample Store",
  TAGLINE: store.tagline ?? "",
  CURRENCY: store.currency ?? "USD",
  YEAR: String(new Date().getFullYear()),
  PRIMARY: cfg.theme?.primary ?? "#0f766e",
  ACCENT: cfg.theme?.accent ?? "#f59e0b",
  BG: cfg.theme?.bg ?? "#fafaf9",
  TEXT: cfg.theme?.text ?? "#1c1917",
  CHECKOUT_DISABLED_ATTR: "",
};

mkdirSync(join(ROOT, "dist"), { recursive: true });
const files = ["index.html", "styles.css", "app.js", "catalog-logic.js", "cart-logic.js", "checkout.js"];
for (const f of files) {
  let out = read(join("src", f));
  if (f === "index.html") {
    // inject store config for the app (safe JSON, escaped for <script>)
    const configScript = `<script id="store-config" type="application/json">${JSON.stringify(cfg).replace(/</g, "\\u003c")}</script>`;
    out = out
      .replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => tokens[k] ?? "")
      .replace("<script type=\"module\" src=\"./app.js\"></script>", `${configScript}\n  <script type="module" src="./app.js"></script>`);
  } else {
    out = out.replace(/\{\{([A-Z_]+)\}\}/g, (_, k) => tokens[k] ?? "");
  }
  const dest = join(ROOT, "dist", f);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, out, "utf8");
}
if (exists("THIRD-PARTY-NOTICES.md")) writeFileSync(join(ROOT, "dist", "THIRD-PARTY-NOTICES.md"), read("THIRD-PARTY-NOTICES.md"), "utf8");
console.log("rendered dist/ — run: npx serve dist");
