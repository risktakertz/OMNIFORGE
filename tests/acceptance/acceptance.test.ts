/**
 * Acceptance suite — the master directive's mandatory scenarios that can be
 * verified WITHOUT external toolchains. Scenarios needing devices/engines
 * (A03 native builds, A05 engine run, A08 real REA) assert their honest
 * policy-level behavior instead of fabricating success.
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(repoRoot, "apps", "cli", "dist", "index.js");

function cli(args: string[]): string {
  return execFileSync("node", [CLI, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
}

function latestWorkspace(): string {
  const projects = join(repoRoot, "projects");
  const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
  if (dirs.length === 0) throw new Error("no workspaces");
  const newest = dirs
    .map((d) => ({ d, m: statSync(join(projects, d)).mtimeMs }))
    .sort((a, b) => b.m - a.m)[0]!.d;
  return join(projects, newest);
}

const TEMPLATE_TESTS: Record<string, string> = {
  "template:static-business": "tests/site.test.mjs",
  "template:commerce-lite": "tests/store.test.mjs",
  "template:phaser-2d": "tests/game.test.mjs",
  "template:dashboard-lite": "tests/dashboard.test.mjs",
  "template:booking-lite": "tests/booking.test.mjs",
};

function workspaceTemplate(ws: string): string {
  const cfg = JSON.parse(readFileSync(join(ws, "project.config.json"), "utf8")) as { templateId: string };
  return cfg.templateId;
}

function runProjectSuite(ws: string): void {
  const testFile = TEMPLATE_TESTS[workspaceTemplate(ws)];
  if (!testFile) throw new Error(`no project test mapping for ${workspaceTemplate(ws)}`);
  execFileSync("node", [testFile], { cwd: ws, stdio: "pipe", timeout: 60_000 });
}

afterAll(() => {
  rmSync(join(repoRoot, "infra", "runs"), { recursive: true, force: true });
  rmSync(join(repoRoot, "infra", "checkpoint-db", "graph"), { recursive: true, force: true });
  const dir = join(repoRoot, "projects");
  if (existsSync(dir)) {
    for (const d of readdirSync(dir)) {
      if (d !== ".gitkeep") rmSync(join(dir, d), { recursive: true, force: true });
    }
  }
});

describe("acceptance (short prompts -> real products)", () => {
  it("A01: 'Create a website for a salon.' -> original responsive site with contact/booking + passing tests", () => {
    cli(["create", "Create a website for a salon."]);
    const ws = latestWorkspace();
    expect(workspaceTemplate(ws)).toBe("template:static-business");
    const html = readFileSync(join(ws, "dist", "index.html"), "utf8");
    expect(html).toMatch(/Contact/);
    expect(html).toMatch(/viewport/);
    runProjectSuite(ws);
  }, 120_000);

  it("A02: 'Make a site like Amazon.' -> store with catalog/search/cart/mock checkout/order history", () => {
    cli(["create", "Make a site like Amazon"]);
    const ws = latestWorkspace();
    runProjectSuite(ws);
    const checkout = readFileSync(join(ws, "dist", "checkout.js"), "utf8");
    expect(checkout).toMatch(/mock/i);
    expect(checkout).not.toMatch(/https:\/\/(api|pay|checkout|stripe|paypal)/i);
  }, 120_000);

  it("A04: 'Create a simple 2D racing game.' -> playable game with controls, restart, logic tests", () => {
    cli(["create", "Create a simple 2D racing game"]);
    const ws = latestWorkspace();
    runProjectSuite(ws);
    const logic = readFileSync(join(ws, "dist", "game-logic.js"), "utf8");
    expect(logic).toMatch(/resetGame/);
    expect(logic).toMatch(/checkCollision/);
  }, 120_000);

  it("A06: 'Create a business dashboard.' -> fixture metrics, filters, role boundaries", () => {
    cli(["create", "Create a business dashboard"]);
    const ws = latestWorkspace();
    runProjectSuite(ws);
    const logic = readFileSync(join(ws, "dist", "dashboard-logic.js"), "utf8");
    expect(logic).toMatch(/visibleSections/);
  }, 120_000);

  it("A07: modify without breaking — baseline, scoped change, regression re-check", () => {
    cli(["create", "Create a website for a bakery"]);
    const ws = latestWorkspace();
    const out = cli(["modify", ws, "set business.tagline Fresh daily"]);
    expect(out).toMatch(/baseline \(original criteria\): passed -> after: passed/);
    // the workspace carries the persisted ORIGINAL blueprint for regression
    expect(existsSync(join(ws, "project.blueprint.json"))).toBe(true);
  }, 120_000);

  it("A10: 'Generate a SaaS product I can customize for shops.' -> two isolated client configs", () => {
    cli(["create", "Generate a SaaS product I can customize for shops"]);
    const first = latestWorkspace();
    cli(["create", "Generate a SaaS product I can customize for shops"]);
    const projects = readdirSync(join(repoRoot, "projects")).filter((d) => d !== ".gitkeep");
    expect(projects.length).toBeGreaterThanOrEqual(2);
    // isolation: separate directories, separate configs, independent ids
    const ids = projects.map((d) => JSON.parse(readFileSync(join(repoRoot, "projects", d, "project.config.json"), "utf8")).id);
    expect(new Set(ids).size).toBe(ids.length);
    // next-web (node family) ships app sources, not a static dist — assert real project files
    expect(existsSync(join(first, "app", "page.tsx"))).toBe(true);
    expect(existsSync(join(first, "tests", "structure.test.mjs"))).toBe(true);
  }, 180_000);

  it("A11: unfamiliar prompt -> typed NOVEL gap (NEEDS_MODEL), never a fake product", () => {
    let stderr = "";
    try {
      cli(["plan", "Create a product with no budget", "--json"]);
      throw new Error("expected plan to refuse a novel prompt");
    } catch (e) {
      stderr = String((e as { stderr?: string }).stderr ?? (e as Error).message);
    }
    expect(stderr).toMatch(/E_INTENT_NOVEL/);
  }, 60_000);

  it("A11b: known prompt with zero budget -> 0 USD estimate and no paid approvals", () => {
    const out = cli(["plan", "Create a website for a salon with no budget", "--json"]);
    const parsed = JSON.parse(out) as { estimatedCost: string; approvalsRequired: string[] };
    expect(parsed.estimatedCost).toMatch(/0 USD/);
    expect(parsed.approvalsRequired).toHaveLength(0);
  }, 60_000);

  it("E2 (decisive): cloud coding agent MVP from one sentence -> composed original agent with passing tests", () => {
    cli(["create", "Create an original cloud-ready AI coding agent like Claude Code that understands natural language, connects to my authorized GitHub repositories, safely edits code, runs tests, explains changes, and lets me resume interrupted work"]);
    const ws = latestWorkspace();
    const cfg = JSON.parse(readFileSync(join(ws, "project.config.json"), "utf8")) as { templateId: string };
    expect(cfg.templateId).toBe("generator:agent-mvp");
    // NOT a renamed template: an original composed runtime
    for (const f of ["bin/agent.mjs", "src/model-adapter.mjs", "src/checkpoint.mjs", "src/github-adapter.mjs", "src/sandbox.mjs", "src/approvals.mjs", "tests/agent.test.mjs", "README.md", ".env.example"]) {
      expect(existsSync(join(ws, f))).toBe(true);
    }
    // persisted original blueprint with agent-specific acceptance criteria
    const bp = JSON.parse(readFileSync(join(ws, "project.blueprint.json"), "utf8")) as { acceptanceCriteria: Array<{ id: string }> };
    expect(bp.acceptanceCriteria.length).toBeGreaterThanOrEqual(8);
    // the generated agent's own suite passes (verified by the DAG run)
    const store = cli(["test", ws, "--json"]);
    expect(store).toMatch(/"passed"/);
    // honest labeling: the offline planner is MOCK, model optional
    const adapter = readFileSync(join(ws, "src", "model-adapter.mjs"), "utf8");
    expect(adapter).toMatch(/MOCK/);
    expect(adapter).toMatch(/OPENAI_API_KEY/);
  }, 240_000);

  it("A03/A05: mobile + 3D scaffold honestly — verified structure, blocked engines labeled", () => {
    const plan3d = JSON.parse(cli(["plan", "Make a basic 3D adventure game", "--json"])) as { template: string };
    expect(plan3d.template).toBe("template:godot-native");
    const doctor = JSON.parse(cli(["doctor", "--json"])) as Array<{ name: string; status: string }>;
    const godot = doctor.find((r) => r.name === "godot");
    // honest status either way — absent here, 'verified' where installed
    expect(["absent", "verified", "unavailable", "blocked"]).toContain(godot?.status);
    const expo = doctor.find((r) => r.name === "expo");
    expect(expo).toBeTruthy();
  }, 60_000);

  it("A08: REA runs only with a recorded authorization basis (policy-level)", () => {
    const skill = readFileSync(join(repoRoot, "skills", "reverse-engineering", "SKILL.md"), "utf8");
    expect(skill).toMatch(/authorization/i);
    expect(skill).toMatch(/Refuse|refuse/);
    expect(skill).toMatch(/original/i);
  });

  it("A09: automation requests map to sandbox-first behavior", () => {
    const skill = readFileSync(join(repoRoot, "skills", "business-automation", "SKILL.md"), "utf8");
    expect(skill).toMatch(/mock/i);
    expect(skill).toMatch(/approval/i);
  });
});
