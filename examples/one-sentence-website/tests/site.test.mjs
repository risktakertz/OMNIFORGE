// Template self-test: verifies the RENDERED output in dist/.
// Run: npm run generate && npm test
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test("dist/index.html exists", () => {
  assert.ok(existsSync(join(DIST, "index.html")), "run `npm run generate` first");
});

const html = () => readFileSync(join(DIST, "index.html"), "utf8");

test("no unrendered {{TOKENS}} remain", () => {
  assert.ok(!/\{\{[A-Z_]+\}\}/.test(html()), "tokens left unrendered");
});

test("responsive viewport meta present", () => {
  assert.match(html(), /<meta[^>]+name="viewport"[^>]+content="[^"]*width=device-width/);
});

test("SEO description present", () => {
  assert.match(html(), /<meta name="description" content=".{10,}"/);
});

test("stylesheet + script referenced and present", () => {
  assert.ok(existsSync(join(DIST, "styles.css")));
  assert.ok(existsSync(join(DIST, "main.js")));
});

test("every <img> has alt (none expected, but rule enforced)", () => {
  const imgs = [...html().matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
  for (const img of imgs) assert.match(img, /alt=/);
});

test("form fields are labeled", () => {
  const h = html();
  assert.match(h, /<label for="cf-name">/);
  assert.match(h, /<label for="cf-email">/);
  assert.match(h, /<label for="cf-message">/);
});

test("skip link + landmarks for accessibility", () => {
  const h = html();
  assert.match(h, /skip-link/);
  assert.match(h, /<main id="main"/);
  assert.match(h, /aria-label="Main navigation"/);
});

test("internal anchors resolve to ids in the page", () => {
  const h = html();
  const hrefs = [...h.matchAll(/href="#([a-z-]+)"/g)].map((m) => m[1]);
  for (const id of hrefs) assert.ok(h.includes(`id="${id}"`), `anchor #${id} has no target`);
});

test("no TODO/lorem placeholder text", () => {
  assert.doesNotMatch(html(), /TODO|lorem ipsum/i);
});

test("no secret-like content in dist", () => {
  const files = listFiles(DIST);
  const suspicious = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{16,}|AKIA[0-9A-Z]{16})/;
  for (const f of files) {
    const text = readFileSync(join(DIST, f), "utf8");
    assert.ok(!suspicious.test(text), `secret-like pattern in ${f}`);
  }
});

function listFiles(dir, base = "") {
  const out = [];
  for (const e of readdirSync(dir)) {
    const rel = base ? `${base}/${e}` : e;
    if (statSync(join(dir, e)).isDirectory()) out.push(...listFiles(join(dir, e), rel));
    else out.push(rel);
  }
  return out;
}

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (e) {
    failed++;
    console.error(`FAIL - ${name}: ${e.message}`);
  }
}
if (failed > 0) {
  console.error(`${failed} test(s) failed`);
  process.exit(1);
}
console.log(`${tests.length} site tests passed`);
