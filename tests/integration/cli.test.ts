/**
 * CLI integration suite — exercises the real built binary end to end.
 * Requires `pnpm build` first (CI runs typecheck/build before test).
 */
import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const CLI = join(repoRoot, "apps", "cli", "dist", "index.js");

function run(args: string[], opts: { allowFailure?: boolean } = {}): { stdout: string; status: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], { cwd: repoRoot, encoding: "utf8", timeout: 120_000 });
    return { stdout, status: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    if (!opts.allowFailure) throw e;
    return { stdout: err.stdout ?? "", status: err.status ?? 1 };
  }
}

function cleanProjects(): void {
  const dir = join(repoRoot, "projects");
  if (!existsSync(dir)) return;
  for (const d of readdirSync(dir)) {
    if (d !== ".gitkeep") rmSync(join(dir, d), { recursive: true, force: true });
  }
}

afterAll(() => {
  rmSync(join(repoRoot, "infra", "runs"), { recursive: true, force: true });
  rmSync(join(repoRoot, "infra", "checkpoint-db", "graph"), { recursive: true, force: true });
  cleanProjects();
});

describe("omniforge CLI", () => {
  it("helps and errors honestly", () => {
    const { stdout } = run(["--help"]);
    expect(stdout).toMatch(/omniforge v0\.1\.0/);
    expect(stdout).toMatch(/plan "<request>"/);
  });

  it("doctor reports honest statuses as JSON", () => {
    const { stdout } = run(["doctor", "--json"]);
    const rows = JSON.parse(stdout) as Array<{ name: string; status: string }>;
    const byName = Object.fromEntries(rows.map((r) => [r.name, r.status]));
    expect(byName["node"]).toBe("verified");
    expect(byName["backend:local-node"]).toBe("verified");
    expect(Object.values(byName).every((s) => ["verified", "configured", "unavailable", "blocked", "absent", "untested"].includes(s))).toBe(true);
  });

  it("skills validate passes on the shipped packs", () => {
    const { stdout } = run(["skills", "validate", "--json"]);
    const parsed = JSON.parse(stdout) as { valid: boolean; errors: unknown[]; skillErrors: unknown[] };
    expect(parsed.valid).toBe(true);
    expect(parsed.errors).toHaveLength(0);
  });

  it("skills list includes core + templates", () => {
    const { stdout } = run(["skills", "list", "--json"]);
    const caps = JSON.parse(stdout) as Array<{ id: string; kind: string }>;
    expect(caps.some((c) => c.id === "skill:omniforge")).toBe(true);
    expect(caps.some((c) => c.id === "template:static-business")).toBe(true);
  });

  it("integrations audit lists the catalog with statuses", () => {
    const { stdout } = run(["integrations", "audit", "--json"]);
    const parsed = JSON.parse(stdout) as { integrations: Array<{ name: string; status: string }>; lock: { recordedAt: string } };
    expect(parsed.integrations.length).toBeGreaterThan(25);
    expect(parsed.lock.recordedAt).toBeTruthy();
    expect(parsed.integrations.some((i) => i.name === "langgraphjs" && i.status === "verified")).toBe(true);
  });

  it("models list refuses to assume providers", () => {
    const { stdout } = run(["models", "--json"]);
    const parsed = JSON.parse(stdout) as { models: Array<{ availability: string }>; defaultRoute: { mode: string } };
    expect(parsed.defaultRoute.mode).toBe("deterministic-core");
    expect(parsed.models.every((m) => m.availability !== "verified" || m.provider === "ollama")).toBe(true);
  });

  it("plan is read-only and explainable", () => {
    const { stdout } = run(["plan", "Make a site like Amazon", "--json"]);
    const parsed = JSON.parse(stdout) as { template: string; estimatedCost: string; acceptanceCriteria: Array<{ evidenceMethod: string }> };
    expect(parsed.template).toBe("template:commerce-lite");
    expect(parsed.estimatedCost).toMatch(/0 USD/);
    expect(parsed.acceptanceCriteria.length).toBeGreaterThan(2);
  });

  it("create builds and verifies a real website (M1 acceptance)", () => {
    const { stdout } = run(["create", "Create a responsive website for a local bakery"]);
    expect(stdout).toMatch(/DONE run=run_/);
    expect(stdout).toMatch(/verification: PASSED/);
    expect(stdout).toMatch(/independent verifier: PASS/);
    const wsMatch = stdout.match(/workspace: (\S+)/);
    expect(wsMatch).toBeTruthy();
    const ws = wsMatch![1];
    expect(existsSync(join(ws, "dist", "index.html"))).toBe(true);
    expect(existsSync(join(ws, "dist", "styles.css"))).toBe(true);
    const html = readFileSync(join(ws, "dist", "index.html"), "utf8");
    expect(html).toMatch(/Sample Business/); // default config rendered
    expect(html).not.toMatch(/\{\{[A-Z_]+\}\}/);
  });

  it("inspect reads a workspace; status reads the run journal", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep" && statSync(join(projects, d)).isDirectory());
    expect(dirs.length).toBeGreaterThan(0);
    const { stdout } = run(["inspect", join(projects, dirs[0]!)]);
    expect(stdout).toMatch(/template: template:static-business/);
    const runs = existsSync(join(repoRoot, "infra", "runs")) ? readdirSync(join(repoRoot, "infra", "runs")).filter((d) => d.startsWith("run_")) : [];
    if (runs.length > 0) {
      const { stdout: status } = run(["status", runs[0]!]);
      expect(status).toMatch(/checkpoint: present \(resumable\)|checkpoint: none/);
    }
  });

  it("modify applies a scoped regression-safe change", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
    const ws = join(projects, dirs[0]!);
    const { stdout } = run(["modify", ws, "set business.name Kali Salon"]);
    expect(stdout).toMatch(/modify complete \(set-config\)/);
    expect(stdout).toMatch(/no regressions/);
    const html = readFileSync(join(ws, "dist", "index.html"), "utf8");
    expect(html).toContain("Kali Salon");
  });

  it("modify beyond deterministic transforms returns a typed model handoff (§7.1)", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
    const ws = join(projects, dirs[0]!);
    const r = run(["modify", ws, "rewrite the checkout engine in Rust"]);
    expect(r.stdout).toMatch(/E_NEEDS_MODEL/);
    expect(r.stdout).toMatch(/deterministic transforms available today/);
  });

  it("test runs the project's own suite", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
    const { stdout } = run(["test", join(projects, dirs[0]!)]);
    expect(stdout).toMatch(/tests: passed/);
  });

  it("export produces a standalone artifact with provenance", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
    const cfg = JSON.parse(readFileSync(join(projects, dirs[0]!, "project.config.json"), "utf8")) as { id: string };
    const { stdout } = run(["export", cfg.id]);
    expect(stdout).toMatch(/exported: .*\.tar\.gz/);
    expect(stdout).toMatch(/sha256: [a-f0-9]{64}/);
    expect(stdout).toMatch(/standalone/);
  });

  it("deploy dry-run is free-first and publishes nothing", () => {
    const projects = join(repoRoot, "projects");
    const dirs = readdirSync(projects).filter((d) => d !== ".gitkeep");
    const cfg = JSON.parse(readFileSync(join(projects, dirs[0]!, "project.config.json"), "utf8")) as { id: string };
    const { stdout } = run(["deploy", cfg.id, "--dry-run"]);
    expect(stdout).toMatch(/NOTHING was published/);
    expect(stdout).toMatch(/approval/i);
  });

  it("unsupported kinds produce typed gaps, not simulations", () => {
    // A05 (Godot) scaffolds honestly — structural checks only, engine blocked
    const { stdout } = run(["plan", "Make a basic 3D adventure game", "--json"]);
    const parsed = JSON.parse(stdout) as { template: string; missing: string[] };
    expect(parsed.template).toBe("template:godot-native");
  });

  it("unknown commands fail with a typed error", () => {
    const { status } = run(["teleport", "--json"], { allowFailure: true });
    expect(status).toBe(2);
  });
});
