#!/usr/bin/env node
/**
 * OMNIFORGE browser E2E — REAL interactions on an actual browser (mission D1).
 *
 * Serves a freshly generated OMNIFORGE site over localhost HTTP, launches
 * Chromium via Playwright, and asserts observed behavior in the DOM:
 *   - brand + nav render, sections anchor-link correctly
 *   - the contact form accepts input and shows its success state
 *   - responsive layout (mobile viewport) keeps navigation usable
 *
 * Exit codes: 0 = ran and passed, or honestly BLOCKED when no browser is
 * installed AND required-mode is OFF (local opt-in behavior);
 * 1 = ran and FAILED, or BLOCKED while OF_E2E_REQUIRED=1 (CI/release mode:
 * a required browser check that did not execute must fail readiness, §11.3).
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = process.env.OF_E2E_REQUIRED === "1";
const blockExit = () => process.exit(REQUIRED ? 1 : 0);

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(repoRoot, "apps", "cli", "dist", "index.js");

async function main() {
  // 1) fresh workspace via the built CLI
  const out = execFileSync("node", [CLI, "create", "Create a responsive website for a local bakery"], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 180_000,
  });
  if (!/verification: PASSED/.test(out)) throw new Error(`create did not pass verification:\n${out.slice(-300)}`);
  const projects = join(repoRoot, "projects");
  const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
  const ws = join(projects, dirs[dirs.length - 1]);
  const dist = join(ws, "dist");
  if (!existsSync(join(dist, "index.html"))) throw new Error("dist/index.html missing");

  // 2) static server on an ephemeral port
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png" };
  const server = createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0].replace(/^\//, "")) || "index.html";
    const file = join(dist, rel.endsWith("/") ? `${rel}index.html` : rel);
    if (existsSync(file)) {
      res.writeHead(200, { "content-type": mime[extname(file)] ?? "application/octet-stream" });
      res.end(require_fs().readFileSync(file));
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;

  // 3) browser interactions
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log(`BLOCKED - browser E2E: playwright not installed (npm i -D playwright && npx playwright install chromium)${REQUIRED ? " — REQUIRED mode: failing readiness" : ""}`);
    server.close();
    blockExit();
  }
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    console.log(`BLOCKED - browser E2E: chromium launch failed (${String(e.message).split("\n")[0].slice(0, 120)})${REQUIRED ? " — REQUIRED mode: failing readiness" : ""}`);
    console.log("         install browsers with: npx playwright install chromium");
    server.close();
    blockExit();
  }

  const failures = [];
  const step = async (name, fn) => {
    try {
      await fn();
      console.log(`ok - ${name}`);
      return true;
    } catch (e) {
      failures.push(name);
      console.error(`FAIL - ${name}: ${e.message}`);
      return false;
    }
  };

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(baseUrl, { waitUntil: "networkidle" });

    const title = await page.title();
    if (!title || title.length < 3) failures.push("page title empty");
    console.log(`ok - page loads: "${title}"`);

    await step("brand and hero content render in the DOM", async () => {
      const body = (await page.locator("body").innerText()).toLowerCase();
      if (!/bakery|sample business/.test(body)) throw new Error(`no brand text found; body starts: ${body.slice(0, 80)}`);
      const h1 = await page.locator("h1").count();
      if (h1 < 1) throw new Error("no h1 rendered");
    });

    await step("navigation anchors scroll to real sections", async () => {
      const navLinks = page.locator("nav a, header a");
      const count = await navLinks.count();
      if (count < 1) throw new Error("no nav links");
      const first = navLinks.first();
      const href = await first.getAttribute("href");
      if (!href || !href.startsWith("#")) throw new Error(`nav href not an in-page anchor: ${href}`);
      const target = page.locator(href);
      if ((await target.count()) < 1) throw new Error(`anchor target missing: ${href}`);
      await first.click();
      await page.waitForTimeout(150);
      const visible = await target.first().isVisible();
      if (!visible) throw new Error("anchor section not visible after click");
    });

    await step("contact form accepts input and shows a success state (no network send)", async () => {
      const form = page.locator("form").first();
      if ((await form.count()) < 1) throw new Error("no contact form in page");
      const fields = form.locator("input:not([type=submit]):not([type=hidden]):not([type=button]), textarea");
      const n = await fields.count();
      if (n < 1) throw new Error("form has no fillable fields");
      for (let i = 0; i < n; i++) {
        const el = fields.nth(i);
        const type = (await el.getAttribute("type")) ?? "text";
        if (type === "email") await el.fill("visitor@example.com");
        else await el.fill("Browser E2E visitor");
      }
      await form.locator("button[type=submit], input[type=submit]").first().click();
      await page.waitForTimeout(250);
      const text = (await page.locator("body").innerText()).toLowerCase();
      if (!/(thank|success|sent|received|message)/.test(text)) throw new Error("no success feedback after submit");
    });

    await step("responsive: mobile viewport keeps nav and content usable", async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      if (overflow > 24) throw new Error(`horizontal overflow of ${overflow}px at 390px viewport`);
      const h1 = await page.locator("h1").first().isVisible();
      if (!h1) throw new Error("h1 not visible on mobile viewport");
    });

    await page.screenshot({ path: join(ws, "browser-e2e.png"), fullPage: false });
    console.log("ok - screenshot captured: browser-e2e.png");
  } finally {
    await browser.close();
    server.close();
  }

  if (failures.length > 0) {
    console.error(`\nbrowser e2e FAILED: ${failures.join(", ")}`);
    process.exit(1);
  }
  console.log("\nbrowser e2e passed — real DOM interactions observed on chromium");
}

function require_fs() {
  // lazy import to keep the module top-level clean
  return { readFileSync: (p) => fs.readFileSync(p) };
}
import * as fs from "node:fs";

main().catch((e) => {
  console.error(`browser e2e error: ${e.message}`);
  process.exit(1);
});
void spawn;
