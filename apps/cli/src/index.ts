#!/usr/bin/env node
/**
 * omniforge — OMNIFORGE CLI.
 * Real operations, structured JSON mode (--json) and readable beginner mode.
 * Every command runs through the deterministic policy gateway.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { parseArgs, slugify, redactSecrets } from "@omniforge/utils";
import { OmniforgeError, ProductBlueprint } from "@omniforge/shared-types";
import { createLogger } from "@omniforge/observability";
import { parseRequest, describeIntent } from "@omniforge/intent-engine";
import { buildBlueprint, classifyFamily } from "@omniforge/blueprint-engine";
import { CapabilityRegistry } from "@omniforge/capability-registry";
import { routeIntent } from "@omniforge/skill-router";
import { ToolGateway, defaultContext } from "@omniforge/tool-gateway";
import { LocalNodeBackend, OpenCodeBackend, detectOpenCode } from "@omniforge/agent-runtime";
import { buildRegistry, probeOllama, routeModel } from "@omniforge/model-router";
import { listWorkspaces, readWorkspaceConfig, exportWorkspace, acquireLease, releaseLease, loadBlueprint } from "@omniforge/workspace-manager";
import { verifyWorkspace, runProjectTests, classifyFailure, independentFinalVerification } from "@omniforge/verification";
import { dryRunDeploy, executeDeploy } from "@omniforge/deployment";
import { createRun, resumeRun, runStatus } from "@omniforge/orchestration";

const VERSION = "0.1.0";

interface Ctx {
  json: boolean;
  repoRoot: string;
  runsRoot: string;
  checkpointRoot: string;
  projectsRoot: string;
  log: ReturnType<typeof createLogger>;
}

function ctx(flags: Record<string, string | boolean>): Ctx {
  const repoRoot = resolve(String(flags.repo ?? process.cwd()));
  return {
    json: flags.json === true,
    repoRoot,
    runsRoot: join(repoRoot, "infra", "runs"),
    checkpointRoot: join(repoRoot, "infra", "checkpoint-db", "graph"),
    projectsRoot: join(repoRoot, "projects"),
    log: createLogger(undefined, "warn"),
  };
}

function out(ctx: Ctx, data: unknown, human: string): void {
  if (ctx.json) process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  else process.stdout.write(human + "\n");
}

function fail(e: unknown): never {
  if (e instanceof OmniforgeError) {
    process.stderr.write(JSON.stringify({ error: e.code, message: e.message, details: e.details }) + "\n");
    process.exit(2);
  }
  process.stderr.write(`error: ${redactSecrets(e instanceof Error ? e.message : String(e))}\n`);
  process.exit(1);
}

function registryOf(c: Ctx): CapabilityRegistry {
  return new CapabilityRegistry([join(c.repoRoot, "skills")], join(c.repoRoot, "templates"));
}

function orchestratorConfig(c: Ctx) {
  return { repoRoot: c.repoRoot, runsRoot: c.runsRoot, checkpointRoot: c.checkpointRoot, logger: c.log };
}

function gatewayFor(c: Ctx, extraRoots: string[] = []): ToolGateway {
  // repoRoot is included so doctor/local probes can execute inside the repo
  return new ToolGateway(defaultContext([c.projectsRoot, c.runsRoot, c.repoRoot, ...extraRoots]));
}

/* ------------------------------------------------------------------ */
/* doctor                                                              */
/* ------------------------------------------------------------------ */

interface DoctorRow { name: string; status: string; detail: string }

async function doctor(c: Ctx): Promise<void> {
  const rows: DoctorRow[] = [];
  const check = async (name: string, fn: () => Promise<[string, string]> | [string, string]) => {
    try {
      const [status, detail] = await fn();
      rows.push({ name, status, detail });
    } catch (e) {
      rows.push({ name, status: "absent", detail: redactSecrets(e instanceof Error ? e.message : String(e)) });
    }
  };
  const probe = (cmd: string, args: string[] = ["--version"]) =>
    new Promise<string>((res) => {
      import("node:child_process").then(({ execFile }) =>
        execFile(cmd, args, { timeout: 5000 }, (err, stdout) => res(err ? "" : String(stdout).trim()))
      );
    });

  const nodeV = process.version;
  rows.push({ name: "node", status: Number(nodeV.slice(1).split(".")[0]) >= 20 ? "verified" : "blocked", detail: nodeV });
  const gitV = await probe("git");
  rows.push({ name: "git", status: gitV ? "verified" : "absent", detail: gitV || "not found" });
  const pnpmV = await probe("pnpm");
  rows.push({ name: "pnpm", status: pnpmV ? "verified" : "unavailable", detail: pnpmV || "not on PATH (corepack enable pnpm)" });

  await check("npm-registry", async () => {
    const { execFile } = await import("node:child_process");
    return new Promise<[string, string]>((res) => {
      execFile("curl", ["-s", "-o", "/dev/null", "-w", "%{http_code}", "--max-time", "5", "https://registry.npmjs.org/"], { timeout: 8000 }, (err, stdout) =>
        res(String(stdout) === "200" ? ["verified", "registry reachable"] : ["unavailable", `status ${String(stdout) || (err?.message ?? "error")}`])
      );
    });
  });
  for (const [tool, label] of [["trivy", "security scanner"], ["docker", "containers"], ["godot", "Godot engine"], ["blender", "3D asset tool"], ["playwright", "browser tests"], ["opencode", "coding backend"], ["ffmpeg", "media"], ["java", "JVM"], ["expo", "mobile toolchain"], ["cargo", "rust toolchain"]]) {
    const v = await probe(tool);
    rows.push({ name: tool, status: v ? "verified" : "absent", detail: v || `${label}: not installed (optional)` });
  }
  const ollama = await probeOllama(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
  rows.push({ name: "ollama", status: ollama.status === "verified" ? "verified" : "unavailable", detail: ollama.status === "verified" ? `models: ${ollama.models.slice(0, 3).join(", ") || "(none pulled)"}` : "local inference not running (optional)" });

  const backend = new LocalNodeBackend(gatewayFor(c));
  const localHealth = await backend.health();
  rows.push({ name: "backend:local-node", status: localHealth.status, detail: localHealth.detail });
  const opencode = new OpenCodeBackend(gatewayFor(c), await detectOpenCode());
  const ocHealth = await opencode.health();
  rows.push({ name: "backend:opencode", status: ocHealth.status, detail: ocHealth.detail });

  const models = buildRegistry();
  for (const m of models.filter((x) => x.availability !== "unavailable")) {
    rows.push({ name: `model:${m.provider}/${m.model}`, status: m.availability, detail: m.notes });
  }

  const reg = registryOf(c);
  const validation = reg.validateAll();
  rows.push({
    name: "skills",
    status: validation.valid ? "verified" : "blocked",
    detail: `${reg.list().length} capabilities; ${validation.errors.length} registry issues; ${validation.skillErrors.length} invalid skills`,
  });

  const freeFirst = (process.env.FREE_FIRST_MODE ?? "true") === "true";
  rows.push({ name: "free-first", status: freeFirst ? "verified" : "blocked", detail: `FREE_FIRST_MODE=${freeFirst} APPROVED_SPEND=${process.env.APPROVED_SPEND ?? "0"}` });

  if (c.json) return out(c, rows, "");
  const lines = rows.map((r) => `${r.status.padEnd(12)} ${r.name.padEnd(24)} ${r.detail}`);
  out(c, rows, `omniforge doctor — environment report\n${"-".repeat(72)}\n${lines.join("\n")}\n${"-".repeat(72)}\nStatus vocabulary: verified | configured | unavailable | blocked | absent`);
}

/* ------------------------------------------------------------------ */
/* skills / integrations / models                                      */
/* ------------------------------------------------------------------ */

function skills(c: Ctx, args: string[]): Promise<void> {
  const reg = registryOf(c);
  const sub = args[0] ?? "list";
  if (sub === "list") {
    const caps = reg.list().map((x) => ({ id: x.id, kind: x.kind, availability: x.availability, cost: x.cost }));
    return out(c, caps, caps.map((x) => `${x.availability.padEnd(11)} ${x.kind.padEnd(9)} ${x.id}`).join("\n") || "(no capabilities found)"), Promise.resolve();
  }
  if (sub === "inspect") {
    const id = args[1];
    if (!id) throw new OmniforgeError("E_INTENT_UNCLEAR", "usage: omniforge skills inspect <skill-id>");
    const cap = reg.get(id.startsWith("skill:") || id.startsWith("template:") ? id : `skill:${id}`);
    return out(c, cap, `${cap.id} [${cap.kind}] availability=${cap.availability} cost=${cap.cost}\n  source: ${cap.source}\n  capabilities: ${cap.capabilities.join(", ")}`), Promise.resolve();
  }
  if (sub === "validate") {
    const result = reg.validateAll();
    if (!c.json) {
      process.stdout.write(`${result.valid ? "OK" : "INVALID"}: ${result.errors.length} registry issues, ${result.skillErrors.length} invalid skills\n`);
      for (const e of result.errors) process.stdout.write(`  issue: ${e.path}: ${e.error}\n`);
      for (const s of result.skillErrors) process.stdout.write(`  skill ${s.id}: ${s.errors.join("; ")}\n`);
    }
    if (!result.valid && !c.json) process.exit(3);
    return out(c, result, ""), Promise.resolve();
  }
  throw new OmniforgeError("E_INTENT_UNCLEAR", `unknown skills subcommand: ${sub}`);
}

function integrationsAudit(c: Ctx): Promise<void> {
  const catalogPath = join(c.repoRoot, "integrations", "catalog.yaml");
  const lockPath = join(c.repoRoot, "integrations", "lock.json");
  const catalog = existsSync(catalogPath) ? (parseYaml(readFileSync(catalogPath, "utf8")) as { integrations?: unknown[] }) : { integrations: [] };
  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : {};
  const rows = ((catalog.integrations ?? []) as Array<Record<string, unknown>>).map((i) => ({
    name: String(i.name),
    tier: String(i.tier ?? "?"),
    mode: String(i["integration-mode"] ?? i.integrationMode ?? "?"),
    license: String(i.license ?? "?"),
    status: String(i.status ?? "unverified"),
    cost: String(i.cost ?? "unknown"),
  }));
  const flagged = rows.filter((r) => r.cost === "paid" || r.status !== "verified");
  if (c.json) {
    out(c, { integrations: rows, lock, flagged }, "");
    return Promise.resolve();
  }
  {
    const lines = rows.map((r) => `${r.tier.padEnd(2)} ${r.name.padEnd(28)} ${r.mode.padEnd(14)} ${r.license.padEnd(10)} ${r.status.padEnd(12)} ${r.cost}`);
    process.stdout.write(`integrations audit — ${rows.length} recorded, ${flagged.length} need attention\n${lines.join("\n")}\n`);
    process.stdout.write(`lock snapshot: recorded-at=${(lock as Record<string, unknown>)["recordedAt"] ?? "?"}\n`);
  }
  return Promise.resolve();
}

async function models(c: Ctx): Promise<void> {
  const registry = buildRegistry();
  const ollama = await probeOllama(process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434");
  const updated = registry.map((m) =>
    m.provider === "ollama"
      ? { ...m, availability: ollama.status === "verified" ? ("verified" as const) : ("unavailable" as const), notes: ollama.status === "verified" ? `local models: ${ollama.models.join(", ") || "(none pulled)"}` : "Ollama not reachable" }
      : m
  );
  const route = routeModel("code-generation", updated);
  return out(
    c,
    { models: updated, defaultRoute: route },
    updated.map((m) => `${m.availability.padEnd(12)} ${m.provider}/${m.model} — ${m.notes}`).join("\n") + `\n\ndefault route (code-generation): ${route.mode}${route.model ? ` -> ${route.model.provider}/${route.model.model}` : ` (${route.reason})`}`
  );
}

/* ------------------------------------------------------------------ */
/* plan / create / modify / test / export / deploy / status / resume   */
/* ------------------------------------------------------------------ */

function planCmd(c: Ctx, request: string): Promise<void> {
  const intent = parseRequest(request);
  const blueprint = buildBlueprint(intent);
  const reg = registryOf(c);
  const route = routeIntent(intent, reg);
  const family = classifyFamily(intent);
  const payload = {
    intent,
    intentSummary: describeIntent(intent),
    family: family.family,
    stack: family.stack,
    template: route.templateId,
    selected: route.selection.selected,
    missing: route.missing,
    acceptanceCriteria: blueprint.acceptanceCriteria,
    estimatedCost: route.selection.estimatedCost,
    approvalsRequired: route.selection.approvalsRequired,
  };
  if (!c.json) {
    const lines = [
      `intent:    ${payload.intentSummary}`,
      `family:    ${family.family} (${family.stack[0]})`,
      `template:  ${route.templateId}`,
      `packs:     ${route.selection.selected.filter((s) => s.capabilityId.startsWith("skill:")).map((s) => s.capabilityId.replace("skill:", "")).join(", ")}`,
      ...(route.missing.length > 0 ? [`missing:   ${route.missing.join(", ")} (typed gap — not simulated)`] : []),
      `cost:      ${payload.estimatedCost}`,
      `criteria:  ${blueprint.acceptanceCriteria.map((a) => `${a.id} ${a.evidenceMethod}`).join("; ")}`,
      `unknowns:  ${intent.unknowns.map((u) => `${u.impact}: ${u.question}`).join("; ") || "none"}`,
    ];
    process.stdout.write(`omniforge plan (read-only)\n${lines.join("\n")}\n`);
  }
  if (c.json) return Promise.resolve(out(c, payload, ""));
  return Promise.resolve();
}

async function createCmd(c: Ctx, request: string): Promise<void> {
  if (!c.json) process.stdout.write(`omniforge create — building: "${request}"\n`);
  const result = await createRun(request, orchestratorConfig(c));
  const v = result.state.verification;
  // Independent verification compares the ORIGINAL persisted blueprint
  // against observed evidence — never criteria derived from the results.
  const original = result.state.blueprint;
  const final = original && v
    ? independentFinalVerification(original, v)
    : { verdict: "fail" as const, checked: v?.checks.length ?? 0, unmatched: [], nonRunCritical: [], summary: v ? "no original blueprint on the run state — independent verification refused" : "run produced no verification evidence — see omniforge status <run-id> for the failure" };
  if (!c.json) {
    process.stdout.write(`\nDONE run=${result.runId}\nworkspace: ${result.state.workspacePath}\npreview:   open ${join(result.state.workspacePath, "dist", "index.html")} in a browser, or: npx serve ${join(result.state.workspacePath, "dist")}\nexport:    omniforge export ${result.state.workspacePath}\nverification: ${v?.passed ? "PASSED" : "FAILED"} (${v?.checks.map((chk) => `${chk.id}:${chk.status}`).join(" ")})\nindependent verifier: ${final.verdict.toUpperCase()} — ${final.summary}\n`);
    return;
  }
  return out(c, { runId: result.runId, workspacePath: result.state.workspacePath, verification: v, report: result.report, independent: final }, "");
}

function inspectCmd(c: Ctx, target: string): Promise<void> {
  const p = resolve(target);
  const cfg = readWorkspaceConfig(p);
  const files: string[] = [];
  const walk = (dir: string, base: string): void => {
    for (const e of readdirSync(dir)) {
      if (["node_modules", "dist-export"].includes(e)) continue;
      const rel = base ? `${base}/${e}` : e;
      if (statSync(join(dir, e)).isDirectory()) walk(join(dir, e), rel);
      else files.push(rel);
    }
  };
  walk(p, ".");
  return out(c, { config: cfg, files }, `${p}\n  template: ${cfg["templateId"]}  id: ${cfg["id"]}\n  files: ${files.length}\n  dist present: ${existsSync(join(p, "dist")) ? "yes" : "no (run omniforge test to render/verify)"}`), Promise.resolve();
}

async function modifyCmd(c: Ctx, target: string, change: string): Promise<void> {
  const p = resolve(target);
  const cfg = readWorkspaceConfig(p);
  acquireLease(p, "cli-modify");
  const gateway = gatewayFor(c, [p]);
  const backend = new LocalNodeBackend(gateway);
  try {
    // regression baseline: the ORIGINAL persisted acceptance criteria.
    // Legacy workspaces without a persisted blueprint are reported honestly
    // — an empty criteria list is never silently accepted as a baseline.
    const baseline = loadBlueprint(p);
    if (!baseline) {
      throw new OmniforgeError(
        "E_VERIFY_FAILED",
        "no persisted original blueprint (project.blueprint.json) in this workspace — regression baseline unavailable. Re-create the project with the current omniforge create, or run `omniforge test` for a checks-only pass.",
        { workspacePath: p }
      );
    }
    const before = await verifyWorkspace({ workspacePath: p, blueprint: baseline, backend });
    const m = change.match(/set\s+(business\.name|business\.tagline|theme\.primary|theme\.accent|contact\.phone|contact\.email|contact\.whatsapp)\s+(.+)/i);
    if (!m) {
      throw new OmniforgeError("E_NOT_IMPLEMENTED", "v0.1 modify supports: set business.name|business.tagline|theme.primary|theme.accent|contact.phone|contact.email|contact.whatsapp <value> — scoped changes only; broader edits arrive with the repair engine pack");
    }
    const [, key, rawValue] = m;
    const value = rawValue?.trim() ?? "";
    const params = (cfg["params"] as Record<string, unknown>) ?? {};
    const parts = key!.split(".");
    const section = parts[0] === "business" ? "business" : parts[0] === "theme" ? "theme" : "contact";
    const merged = { ...(params[section] as Record<string, unknown> ?? {}), [parts[1]!]: value };
    params[section] = merged;
    cfg["params"] = params;
    writeFileSync(join(p, "project.config.json"), JSON.stringify(cfg, null, 2), "utf8");
    gateway.authorize("render", { target: p });
    const { execFileSync } = await import("node:child_process");
    execFileSync("node", ["scripts/render.mjs"], { cwd: p, stdio: "pipe", timeout: 60_000 });
    const after = await verifyWorkspace({ workspacePath: p, blueprint: baseline, backend });
    const classification = after.passed ? null : classifyFailure(after.failures.join("; "), 1);
    return out(
      c,
      { changed: `${section}.${parts[1]}`, value, before: before.passed, after: after.passed, failures: after.failures, classification },
      `modify complete: ${section}.${parts[1]} = "${value}"\n  baseline (original criteria): ${before.passed ? "passed" : "failed"} -> after: ${after.passed ? "passed" : "failed"}\n${after.failures.length ? "  failures: " + after.failures.join("; ") : "  no regressions against original acceptance criteria"}`
    );
  } finally {
    releaseLease(p, "cli-modify");
  }
}

async function testCmd(c: Ctx, target: string): Promise<void> {
  const p = resolve(target);
  const gateway = gatewayFor(c, [p]);
  const backend = new LocalNodeBackend(gateway);
  const tests = runProjectTests(p, backend);
  // declared checks-only contract (schema-parsed, not a cast): run the
  // project's own suite + secrets scan
  const contract = ProductBlueprint.parse({
    intentId: "cli:test",
    productBrief: "checks-only test contract for an existing workspace",
    scope: { mvp: ["project test script"], later: [], excluded: [] },
    rolesAndFlows: [],
    architecture: {},
    dataModel: {},
    contracts: [],
    threatModel: {},
    acceptanceCriteria: [
      { id: "T1", criterion: "project test script", evidenceMethod: "run-project-tests" },
      { id: "T2", criterion: "no secrets", evidenceMethod: "no-secrets" },
    ],
    deploymentRequirements: {},
  });
  const result = await verifyWorkspace({ workspacePath: p, blueprint: contract, backend });
  return out(c, { projectTests: tests, result }, `tests: ${tests.status} — ${tests.message}\n${result.checks.map((chk) => `${chk.id}:${chk.status}`).join(" ")}`), Promise.resolve();
}

function statusCmd(c: Ctx, runId: string): Promise<void> {
  const s = runStatus(orchestratorConfig(c), runId);
  const state = s.state as { hasCheckpoint: boolean; completed: string[] };
  return out(
    c,
    s,
    `run ${s.runId}\n  checkpoint: ${state.hasCheckpoint ? "present (resumable)" : "none"}\n  journal events: ${s.journal.length}\n${s.journal.slice(-6).map((e) => `  [${e.node}] ${e.message}`).join("\n")}`
  ), Promise.resolve();
}

async function resumeCmd(c: Ctx, runId: string): Promise<void> {
  const result = await resumeRun(runId, orchestratorConfig(c));
  return out(
    c,
    { runId, verification: result.state.verification, workspacePath: result.state.workspacePath, report: result.report },
    `resumed run ${runId}\n  verification: ${result.state.verification?.passed ? "PASSED" : "FAILED"}\n  workspace: ${result.state.workspacePath}\n  ${result.report}`
  );
}

function exportCmd(c: Ctx, projectId: string): Promise<void> {
  const ws = listWorkspaces(c.projectsRoot).find((w) => w.id === projectId || resolve(w.path) === resolve(projectId));
  if (!ws) throw new OmniforgeError("E_CAPABILITY_MISSING", `workspace not found: ${projectId}`);
  const artifact = exportWorkspace(ws.path, join(c.runsRoot, "exports", ws.id), gatewayFor(c, [join(c.runsRoot, "exports")]));
  return out(
    c,
    artifact,
    `exported: ${artifact.path}\n  sha256: ${artifact.checksum}\n  provenance: ${artifact.provenanceRef}\nThe exported project is standalone — unzip anywhere and follow its README.`
  ), Promise.resolve();
}

function deployCmd(c: Ctx, projectId: string, flags: Record<string, string | boolean>): Promise<void> {
  const ws = listWorkspaces(c.projectsRoot).find((w) => w.id === projectId || resolve(w.path) === resolve(projectId));
  if (!ws) throw new OmniforgeError("E_CAPABILITY_MISSING", `workspace not found: ${projectId}`);
  if (flags["dry-run"] || flags.dryRun) {
    const report = dryRunDeploy(ws.path);
    return out(
      c,
      report,
      `deploy dry-run for ${ws.id} (target: ${report.target}) — NOTHING was published\n${report.options.map((o) => `  option: ${o.host} — ${o.costNote}\n    steps: ${o.steps.join(" -> ")}`).join("\n")}\n  approvals required: ${report.approvalsRequired.join("; ")}\n  warnings: ${report.warnings.join(" ") || "none"}`
    ), Promise.resolve();
  }
  executeDeploy(ws.path); // typed E_DEPLOY_BLOCKED until an approved adapter exists
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

const HELP = `omniforge v${VERSION} — turn one sentence into working, tested software (free-first).

Usage:
  omniforge <command> [args] [--json] [--repo <path>]

Commands:
  doctor                        environment, tools, models, skills health
  skills list|inspect|validate  capability registry operations
  integrations audit            licenses, status, versions and costs
  models list                   available providers and routing decision
  plan "<request>"              read-only intent, blueprint, routing and cost
  create "<request>"            build a product into projects/ (never publishes)
  inspect <project-path>        workspace structure and config
  modify <project-path> "..."   regression-safe scoped change (see --help modify)
  test <project-path>           run the project's checks and tests
  status <run-id>               progress and evidence for a run
  resume <run-id>               resume an interrupted run from durable state
  export <project-id>           standalone artifact + provenance
  deploy <project-id> --dry-run free-first deployment plan (no publishing)

Learn more: README.md and docs/USER_GUIDE.md. Add --json for machine output.`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const { positionals, flags } = parseArgs(argv);
  const c = ctx(flags);
  const cmd = positionals[0];
  const rest = positionals.slice(1);
  const request = rest.length > 0 ? rest.join(" ") : "";

  if (!cmd || cmd === "help" || flags.help) {
    process.stdout.write(HELP + "\n");
    return;
  }
  switch (cmd) {
    case "doctor": return doctor(c);
    case "skills": return skills(c, rest);
    case "integrations": return integrationsAudit(c);
    case "models": return models(c);
    case "plan": return planCmd(c, request);
    case "create": return createCmd(c, request);
    case "inspect": return inspectCmd(c, rest[0] ?? ".");
    case "modify":
      if (rest.length < 2) throw new OmniforgeError("E_INTENT_UNCLEAR", 'usage: omniforge modify <project-path> "set business.name Kali Salon"');
      return modifyCmd(c, rest[0]!, rest.slice(1).join(" "));
    case "test": return testCmd(c, rest[0] ?? ".");
    case "status": return statusCmd(c, rest[0] ?? "");
    case "resume": return resumeCmd(c, rest[0] ?? "");
    case "export": return exportCmd(c, rest[0] ?? "");
    case "deploy":
      if (!rest[0]) throw new OmniforgeError("E_INTENT_UNCLEAR", "usage: omniforge deploy <project-id> --dry-run");
      return deployCmd(c, rest[0]!, flags);
    default:
      throw new OmniforgeError("E_INTENT_UNCLEAR", `unknown command: ${cmd}\n\n${HELP}`);
  }
}

main().catch((e) => {
  fail(e);
});
void slugify;
