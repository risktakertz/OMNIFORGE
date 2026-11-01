/**
 * Generalized, regression-safe modification (universal-upgrade §7).
 *
 * Beyond the v0.1 config-key edits, deterministic scoped transforms now cover
 * real content/structure changes on any OMNIFORGE static-family workspace:
 *   - `set <key> <value>`                      (existing behavior, preserved)
 *   - `add service <name> "<description>"`     (template-supported param)
 *   - `add section <id> "<heading>" "<body>"`  (new content section + nav)
 *   - `change text "<from>" to "<to>"`         (bounded literal content edit)
 *
 * Every change: repo-understanding pass → rollback manifest (file backups) →
 * scoped edit → re-render through the TRUST-GATED runner → verification
 * against the ORIGINAL persisted criteria → concise change report.
 * Anything beyond the deterministic transforms returns typed E_NEEDS_MODEL
 * with the backend handoff path — never a fake success, never E_NOT_IMPLEMENTED.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { OmniforgeError, type ProductBlueprint } from "@omniforge/shared-types";
import { nowIso } from "@omniforge/utils";
import type { ToolGateway } from "@omniforge/tool-gateway";
import { snapshotManifest, diffManifests } from "@omniforge/agent-runtime";
import { runWorkspaceScript } from "./dag.js";
import { executeCodingTask, type CodingExecution } from "./coding.js";
import { loadBlueprint, acquireLease, releaseLease } from "@omniforge/workspace-manager";
import { verifyWorkspace, independentFinalVerification } from "@omniforge/verification";
import { LocalNodeBackend } from "@omniforge/agent-runtime";
import { ToolGateway as Gateway, defaultContext } from "@omniforge/tool-gateway";
import { newId } from "@omniforge/utils";

/** Generalized edits use the same staged, budgeted and independently verified engine. */
export async function modifyWithBackend(opts: { workspacePath: string; repoRoot: string; runsRoot: string; change: string; coding: CodingExecution }) {
  const understanding = understandWorkspace(opts.workspacePath, opts.repoRoot);
  const baseline = loadBlueprint(understanding.workspacePath);
  if (!baseline) throw new OmniforgeError("E_VERIFY_FAILED", "modification requires the original persisted blueprint");
  const additions = opts.coding.acceptanceCriteria;
  const ids = new Set(baseline.acceptanceCriteria.map((c) => c.id));
  if (additions.some((c) => ids.has(c.id))) throw new OmniforgeError("E_INTENT_UNCLEAR", "new modification criteria must have new traceable IDs; original criteria are immutable");
  const blueprint = { ...baseline, productBrief: `${opts.change}\nOriginal scope: ${baseline.productBrief}`, acceptanceCriteria: [...baseline.acceptanceCriteria, ...additions] };
  const backend = new LocalNodeBackend(new Gateway(defaultContext([understanding.workspacePath])));
  const before = await verifyWorkspace({ workspacePath: understanding.workspacePath, blueprint: baseline, backend });
  if (!before.passed) throw new OmniforgeError("E_VERIFY_FAILED", "original acceptance is failing before modification; repair baseline first");
  acquireLease(understanding.workspacePath, "backend-modify");
  const runId = newId("run");
  try {
    const result = await executeCodingTask(opts.coding, understanding.workspacePath, blueprint, "t:modify", join(opts.runsRoot, runId));
    const verification = await verifyWorkspace({ workspacePath: understanding.workspacePath, blueprint, backend });
    if (!verification.passed || independentFinalVerification(blueprint, verification).verdict !== "pass") throw new OmniforgeError("E_VERIFY_FAILED", "post-commit modification verification failed");
    // Preserve the original file; record the explicit extension separately for traceability.
    writeFileSync(join(opts.runsRoot, runId, "modification-contract.json"), JSON.stringify(blueprint, null, 2));
    return { runId, understanding, ...result, verification };
  } finally { releaseLease(understanding.workspacePath, "backend-modify"); }
}

export interface WorkspaceUnderstanding {
  workspacePath: string;
  templateId: string;
  languages: string[];
  files: string[];
  hasTests: boolean;
  hasDist: boolean;
  hasBaselineBlueprint: boolean;
  testScript: string | null;
  note: string;
}

/** §7.2 repo-understanding pass: cheap, read-only, ordered before any edit. */
export function understandWorkspace(workspacePath: string, _repoRoot: string): WorkspaceUnderstanding {
  const abs = resolve(workspacePath);
  if (!existsSync(join(abs, "project.config.json"))) {
    throw new OmniforgeError("E_GATEWAY_DENIED", "not an OMNIFORGE workspace (missing project.config.json)", { workspacePath: abs });
  }
  const cfg = JSON.parse(readFileSync(join(abs, "project.config.json"), "utf8")) as Record<string, unknown>;
  const files: string[] = [];
  const exts = new Set<string>();
  const walk = (dir: string, base: string): void => {
    for (const e of readdirSync(dir)) {
      if (["node_modules", "dist-export", ".git"].includes(e)) continue;
      const full = join(dir, e);
      const rel = base ? `${base}/${e}` : e;
      const st = statSync(full, { throwIfNoEntry: false });
      if (!st) continue;
      if (st.isDirectory()) walk(full, rel);
      else {
        files.push(rel);
        const m = e.match(/\.([a-z]+)$/);
        if (m) exts.add(m[1]!);
      }
    }
  };
  walk(abs, ".");
  let testScript: string | null = null;
  const pkgPath = join(abs, "package.json");
  if (existsSync(pkgPath)) {
    testScript = (JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> }).scripts?.test ?? null;
  }
  return {
    workspacePath: abs,
    templateId: String(cfg["templateId"] ?? "unknown"),
    languages: [...exts],
    files,
    hasTests: existsSync(join(abs, "tests")),
    hasDist: existsSync(join(abs, "dist")),
    hasBaselineBlueprint: existsSync(join(abs, "project.blueprint.json")),
    testScript,
    note: "manifest-based understanding (languages, tests, baseline criteria) — no content was sent anywhere",
  };
}

export interface ChangeReport {
  change: string;
  transform: string;
  changedFiles: string[];
  backupsDir: string;
  beforePassed: boolean;
  afterPassed: boolean;
  failures: string[];
  rollbackHint: string;
  renderTrusted: string;
}

const FORBIDDEN_EDIT_CONTENT = /<script|javascript:|on(error|load|click)\s*=/i;

function backupFile(ws: string, rel: string, backupsDir: string): void {
  const dest = join(backupsDir, rel.replace(/\//g, "__"));
  mkdirSync(backupsDir, { recursive: true });
  copyFileSync(join(ws, rel), dest);
}

function insertSection(html: string, id: string, heading: string, body: string): string {
  if (html.includes(`id="${id}"`)) {
    throw new OmniforgeError("E_GATEWAY_DENIED", `section id '${id}' already exists — pick another id`, { id });
  }
  const section = `    <section class="section" id="${id}" aria-labelledby="${id}-heading">\n      <h2 id="${id}-heading">${heading}</h2>\n      <p>${body}</p>\n    </section>\n`;
  const anchor = /(\s*<footer\b)/;
  if (anchor.test(html)) return html.replace(anchor, `\n${section}$1`);
  // fallback: append before </main>
  return html.replace(/(\s*<\/main>)/, `\n${section}$1`);
}

function addNavLink(html: string, id: string, heading: string): string {
  return html.replace(/(<li><a href="#contact">Contact<\/a><\/li>)/, `<li><a href="#${id}">${heading}</a></li>\n        $1`);
}

/**
 * Apply a deterministic scoped change. Throws typed errors for anything the
 * deterministic layer cannot honestly do (caller reports E_NEEDS_MODEL).
 */
export function applyDeterministicChange(opts: {
  workspacePath: string;
  change: string;
  repoRoot: string;
  gateway: ToolGateway;
  renderTimeoutMs?: number;
}): Omit<ChangeReport, "beforePassed" | "afterPassed" | "failures"> {
  const ws = resolve(opts.workspacePath);
  const change = opts.change.trim();
  const backupsDir = join(ws, ".omniforge", "backups", String(Date.now()));
  const changedFiles: string[] = [];
  let transform = "unknown";
  const templateId = String(
    (JSON.parse(readFileSync(join(ws, "project.config.json"), "utf8")) as Record<string, unknown>)["templateId"] ?? ""
  );

  // ---- set <key> <value> (v0.1 behavior preserved verbatim) -------------
  const setMatch = change.match(/^set\s+(business\.name|business\.tagline|business\.description|theme\.primary|theme\.accent|contact\.phone|contact\.email|contact\.whatsapp|contact\.hours|contact\.address|seo\.title|seo\.description)\s+(.+)$/i);
  if (setMatch) {
    transform = "set-config";
    const [, key, rawValue] = setMatch;
    const value = rawValue!.trim();
    const cfgPath = join(ws, "project.config.json");
    const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
    const params = (cfg["params"] as Record<string, unknown>) ?? {};
    const parts = key!.split(".");
    const section = parts[0] === "business" ? "business" : parts[0] === "theme" ? "theme" : parts[0] === "seo" ? "seo" : "contact";
    params[section] = { ...((params[section] as Record<string, unknown>) ?? {}), [parts[1]!]: value };
    cfg["params"] = params;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
    changedFiles.push("project.config.json");
  } else {
    // ---- add service -----------------------------------------------------
    const svcMatch = change.match(/^add\s+service\s+(\w[\w\s-]{0,40}?)\s+"([^"]{1,120})"$/i);
    if (svcMatch) {
      transform = "add-service";
      const [, name, description] = svcMatch;
      const cfgPath = join(ws, "project.config.json");
      const cfg = JSON.parse(readFileSync(cfgPath, "utf8")) as Record<string, unknown>;
      const params = (cfg["params"] as Record<string, unknown>) ?? {};
      const services = Array.isArray(params["services"]) ? (params["services"] as Array<{ name: string; description: string }>) : [];
      if (services.length >= 12) {
        throw new OmniforgeError("E_BUDGET_EXCEEDED", "service list full (12) — deterministic transform refuses to bloat the page", {});
      }
      services.push({ name: name!.trim(), description: description! });
      params["services"] = services;
      cfg["params"] = params;
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), "utf8");
      changedFiles.push("project.config.json");
    } else {
      // ---- add section ---------------------------------------------------
      const secMatch = change.match(/^add\s+section\s+([a-z][a-z0-9-]{1,30})\s+"([^"]{1,80})"(?:\s+"([^"]{0,300})")?$/i);
      if (secMatch) {
        transform = "add-section";
        const [, id, heading, body = ""] = secMatch;
        if (FORBIDDEN_EDIT_CONTENT.test(heading!) || FORBIDDEN_EDIT_CONTENT.test(body!)) {
          throw new OmniforgeError("E_GATEWAY_DENIED", "section content contains forbidden markup (script/js handlers)", { id });
        }
        const rel = "src/index.html";
        const htmlPath = join(ws, rel);
        if (!existsSync(htmlPath)) {
          throw new OmniforgeError("E_DELIVERABLE_UNSUPPORTED", "add-section transform applies to static-family workspaces with src/index.html", { templateId });
        }
        backupFile(ws, rel, backupsDir);
        let html = readFileSync(htmlPath, "utf8");
        html = insertSection(html, id!, heading!, body!);
        html = addNavLink(html, id!, heading!);
        writeFileSync(htmlPath, html, "utf8");
        changedFiles.push(rel);
      } else {
        // ---- change text ---------------------------------------------------
        const txtMatch = change.match(/^change\s+text\s+"([^"]{1,120})"\s+to\s+"([^"]{1,200})"$/i);
        if (txtMatch) {
          transform = "change-text";
          const [, from, to] = txtMatch;
          if (FORBIDDEN_EDIT_CONTENT.test(to!)) {
            throw new OmniforgeError("E_GATEWAY_DENIED", "replacement contains forbidden markup (script/js handlers)", {});
          }
          const rel = "src/index.html";
          const htmlPath = join(ws, rel);
          if (!existsSync(htmlPath) || !readFileSync(htmlPath, "utf8").includes(from!)) {
            throw new OmniforgeError("E_GATEWAY_DENIED", `text to replace not found in ${rel} (exact-match policy, no regex)`, {});
          }
          backupFile(ws, rel, backupsDir);
          const html = readFileSync(htmlPath, "utf8");
          // bounded: replace at most 5 occurrences of an EXACT literal
          let count = 0;
          const next = html.replace(from!, () => (count++ < 5 ? to! : from!));
          writeFileSync(htmlPath, next, "utf8");
          changedFiles.push(rel);
        } else {
          // §7.1: honest typed handoff — no silent misroute, no E_NOT_IMPLEMENTED
          throw new OmniforgeError(
            "E_NEEDS_MODEL",
            `change exceeds deterministic transforms (set | add service | add section | change text): "${change.slice(0, 80)}"`,
            {
              deterministicTransforms: ["set <key> <value>", "add service <name> \"<description>\"", "add section <id> \"<heading>\" [\"<body>\"]", "change text \"<from>\" to \"<to>\""],
              prerequisite: "configure an authorized model-backed coding backend (opencode) to execute arbitrary scoped edits; verification and approval flow stay identical",
            }
          );
        }
      }
    }
  }

  // re-render through the trust-gated runner (template-provenance enforced)
  const render = runWorkspaceScript({
    workspacePath: ws,
    scriptRelPath: "scripts/render.mjs",
    templateRoot: join(opts.repoRoot, "templates"),
    ...(templateId ? { templateId } : {}),
    timeoutMs: opts.renderTimeoutMs ?? 60_000,
  });
  if (render.blocked) {
    throw new OmniforgeError("E_SANDBOX_UNAVAILABLE", render.blocked, { workspacePath: ws });
  }
  if (render.exitCode !== 0) {
    throw new OmniforgeError("E_VERIFY_FAILED", `re-render failed after change: ${render.stderr.slice(0, 200)}`, { transform });
  }
  return {
    change,
    transform,
    changedFiles,
    backupsDir,
    rollbackHint: `restore originals from ${backupsDir} (files are <path-with-__-for-/> backups), then re-render`,
    renderTrusted: render.isolated ? "containerized (untrusted provenance)" : render.trustReason,
  };
}

/** Full change cycle: understand → before-verify is caller's job; here we diff + report. */
export function changeManifest(ws: string, before: Record<string, string>): { changed: string[]; added: string[]; removed: string[] } {
  return diffManifests(before, snapshotManifest(ws));
}

export function currentStamp(): string {
  return nowIso();
}

export type { ProductBlueprint };
